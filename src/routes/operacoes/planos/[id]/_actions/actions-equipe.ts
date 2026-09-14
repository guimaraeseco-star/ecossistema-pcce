/**
 * Form actions das EQUIPES do plano — o que vai no Anexo I e o que decide o
 * custo de cada uma.
 *
 * Toda action entra por `equipeDaRota`, que prova que o id vindo do formulário
 * pertence ao plano da URL. Ver o cabeçalho de `shared.ts`.
 */
import { fail } from '@sveltejs/kit';
import {
	criarEquipes,
	atualizarEquipe,
	opcoesDoPlano,
	valorPadrao,
	briefingDaEquipe,
	origemDaEquipe,
	destinoDaEquipe,
	matrizDoPlano,
	excluirEquipe,
	renumerarEquipes,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { validarHora, normalizarHora } from '$lib/gise/horarios';
import { meiasDiariasValidas } from '$lib/planos/meias-diarias';
import { distanciaDoTrajeto } from '$lib/planos/distancia';
import { logger } from '$lib/server/logger';
import {
	planoDaRota,
	equipeDaRota,
	getInt,
	getTexto,
	getTextoOuNulo,
	type EventoPlano
} from './shared';

/** Normaliza um horário opcional. `null` = herda do plano; `'invalido'` = recusa. */
function horaOuHerda(fd: FormData, campo: string): string | null | 'invalido' {
	const bruto = getTexto(fd, campo, 5);
	if (bruto === '') return null;
	const h = normalizarHora(bruto);
	return h && validarHora(h) ? h : 'invalido';
}

export const actionsEquipe = {
	/** Acrescenta uma equipe ao plano, continuando a numeração. */
	adicionarEquipe: async (event: EventoPlano) => {
		const ctx = await planoDaRota(event);
		if ('erro' in ctx) return ctx.erro;
		const { db, plano } = ctx;

		const fd = await event.request.formData();
		const tipo = getTexto(fd, 'tipo', 20) === 'seint' ? 'seint' : 'operacional';

		await criarEquipes(db, plano.id, {
			quantidade: tipo === 'operacional' ? 1 : 0,
			comSeint: tipo === 'seint'
		});

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Equipe ${tipo} acrescentada ao plano ${plano.numero}/${plano.ano}`,
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/**
	 * Patch de uma equipe: identidade, viatura, destino, horário próprio,
	 * briefing e — o que importa para o dinheiro — tipo de custo e quantidade.
	 *
	 * As três quantidades são validadas em conjunto com o TIPO: horas só fazem
	 * sentido em `hora_extra`, diárias em `diaria`. Gravar as duas ao mesmo tempo
	 * deixaria a linha ambígua, e o Anexo II teria de escolher uma — em silêncio.
	 */
	salvarEquipe: async (event: EventoPlano) => {
		const fd = await event.request.formData();
		const ctx = await equipeDaRota(event, getInt(fd, 'equipe_id'));
		if ('erro' in ctx) return ctx.erro;
		const { db, plano, equipe } = ctx;

		const nome = getTexto(fd, 'nome', 80);
		if (!nome) return fail(400, { error: 'A equipe precisa de um nome.' });

		const horaInicio = horaOuHerda(fd, 'hora_inicio');
		const horaFim = horaOuHerda(fd, 'hora_fim');
		if (horaInicio === 'invalido' || horaFim === 'invalido') {
			return fail(400, { error: 'Horário da equipe inválido. Use HH:MM ou deixe vazio.' });
		}

		const tipoCustoBruto = getTexto(fd, 'tipo_custo', 20);
		const tipoCusto =
			tipoCustoBruto === 'hora_extra' || tipoCustoBruto === 'diaria' ? tipoCustoBruto : 'sem_custo';

		let horasNormais = 0;
		let horasPlus = 0;
		let diariaTipo: 'estadual' | 'interestadual' | null = null;
		let diariasMeias = 0;

		if (tipoCusto === 'hora_extra') {
			horasNormais = getInt(fd, 'horas_normais');
			horasPlus = getInt(fd, 'horas_plus');
			const okNormais = Number.isInteger(horasNormais) && horasNormais >= 0 && horasNormais <= 744;
			const okPlus = Number.isInteger(horasPlus) && horasPlus >= 0 && horasPlus <= 744;
			if (!okNormais || !okPlus) {
				return fail(400, { error: 'Quantidade de horas inválida (0 a 744).' });
			}
			if (horasNormais + horasPlus === 0) {
				return fail(400, {
					error: 'Informe a quantidade de horas — ou marque a equipe como "sem custo".'
				});
			}
		} else if (tipoCusto === 'diaria') {
			diariaTipo =
				getTexto(fd, 'diaria_tipo', 20) === 'interestadual' ? 'interestadual' : 'estadual';
			diariasMeias = getInt(fd, 'diarias_meias');
			if (!meiasDiariasValidas(diariasMeias)) {
				return fail(400, { error: 'Quantidade de diárias inválida (de 0,5 a 15).' });
			}
		}

		// Campo vazio é `null` — "ninguém mediu" —, e não zero: zero é a afirmação
		// de que origem e destino são a mesma cidade. A diferença decide se a tela
		// avisa que falta a medida ou trata a rubrica como conferida
		// (ver `sugerirCusteio`).
		const distanciaBruta = getTexto(fd, 'distancia_km', 8);
		let distanciaKm: number | null = null;
		if (distanciaBruta) {
			const n = Number(distanciaBruta);
			if (!Number.isInteger(n) || n < 0 || n > 9999) {
				return fail(400, {
					error: 'Distância inválida — informe um número inteiro de 0 a 9999 km.'
				});
			}
			distanciaKm = n;
		}

		// O SERVIDOR remede o trajeto com as cidades que estão sendo gravadas, e
		// compara. Não é para corrigir o número — o que o admin gravou vale, porque
		// uma equipe pode ter um desvio real — é para a AUDITORIA registrar se
		// aquele valor é a medida ou uma correção. Confiar num campo do formulário
		// para dizer isso deixaria o corpo do POST afirmar a procedência de um
		// número que vira dinheiro.
		const cidadeOrigem = getTexto(fd, 'cidade_origem', 120);
		const cidadeDestino = getTexto(fd, 'cidade_destino', 120);
		const localBriefing = getTextoOuNulo(fd, 'local_briefing', 200);

		const [opcoes, matriz] = await Promise.all([
			opcoesDoPlano(db, plano.id),
			matrizDoPlano(db, plano.id)
		]);
		const ibgePorValor = new Map(
			[...opcoes.briefing, ...opcoes.origem, ...opcoes.destino]
				.filter((o) => o.municipio_ibge)
				.map((o) => [o.valor, o.municipio_ibge as string])
		);
		const medido = distanciaDoTrajeto(
			{
				origem:
					ibgePorValor.get(
						origemDaEquipe({ cidade_origem: cidadeOrigem }, valorPadrao(opcoes.origem))
					) ?? null,
				briefing:
					ibgePorValor.get(
						briefingDaEquipe({ local_briefing: localBriefing }, valorPadrao(opcoes.briefing))
					) ?? null,
				destino:
					ibgePorValor.get(
						destinoDaEquipe({ cidade_destino: cidadeDestino }, valorPadrao(opcoes.destino))
					) ?? null
			},
			matriz
		);
		const distanciaProcedencia =
			distanciaKm === null ? 'ausente' : distanciaKm === medido?.km ? 'medida' : 'manual';

		try {
			await atualizarEquipe(db, equipe.id, {
				nome,
				tipo: getTexto(fd, 'tipo', 20) === 'seint' ? 'seint' : 'operacional',
				viatura_modelo: getTexto(fd, 'viatura_modelo', 60),
				viatura_placa: getTexto(fd, 'viatura_placa', 20),
				hora_inicio: horaInicio,
				hora_fim: horaFim,
				cidade_origem: cidadeOrigem,
				cidade_destino: cidadeDestino,
				distancia_km: distanciaKm,
				local_briefing: localBriefing,
				tipo_custo: tipoCusto,
				horas_normais: horasNormais,
				horas_plus: horasPlus,
				diaria_tipo: diariaTipo,
				diarias_meias: diariasMeias
			});
		} catch (e) {
			logger.error('[planos/editor] salvarEquipe', { error: String(e), equipe: equipe.id });
			return fail(500, { error: 'Erro ao salvar a equipe.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Equipe "${nome}" alterada (custo: ${tipoCusto})`,
				dados_antes: {
					nome: equipe.nome,
					tipo_custo: equipe.tipo_custo,
					horas_normais: equipe.horas_normais,
					horas_plus: equipe.horas_plus,
					diarias_meias: equipe.diarias_meias
				},
				dados_depois: {
					nome,
					distancia_km: distanciaKm,
					distancia_procedencia: distanciaProcedencia,
					tipo_custo: tipoCusto,
					horas_normais: horasNormais,
					horas_plus: horasPlus,
					diarias_meias: diariasMeias
				},
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/** Exclui a equipe (os membros vão junto) e fecha a lacuna na numeração. */
	excluirEquipe: async (event: EventoPlano) => {
		const fd = await event.request.formData();
		const ctx = await equipeDaRota(event, getInt(fd, 'equipe_id'));
		if ('erro' in ctx) return ctx.erro;
		const { db, plano, equipe } = ctx;

		await excluirEquipe(db, equipe.id);
		// A ordem fica com buraco depois da exclusão do meio; o Anexo I imprime
		// pela ordem, então ela é reapertada aqui. Os NOMES não mudam — ver
		// `renumerarEquipes`.
		await renumerarEquipes(db, plano.id);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Equipe "${equipe.nome}" excluída do plano ${plano.numero}/${plano.ano}`,
				dados_antes: { nome: equipe.nome, tipo: equipe.tipo },
				...contexto
			},
			{ env }
		);

		return { success: true };
	}
};
