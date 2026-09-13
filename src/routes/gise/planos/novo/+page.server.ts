/**
 * `/gise/planos/novo` — os parâmetros gerais do plano operacional.
 *
 * Rota própria, e não modal: são quinze campos mais um calendário, e o README
 * §10 é explícito ("formulário longo vira rota"). Tem endereço, sobrevive a um
 * reload e admite ser retomada.
 *
 * ## Ordem obrigatória: valida → cria o plano → cria as equipes
 *
 * O plano precisa existir antes das equipes (elas apontam para ele), e falhar
 * na criação das equipes deixa um plano SEM equipe — estado válido, que o
 * editor resolve com um clique. O inverso não é representável. É a mesma ordem
 * de `criar` em `/gise/operacoes`, e pelo mesmo motivo.
 *
 * ## O que é copiado na criação, e por quê
 *
 * `custo_parametro_id` e o par `diretor_nome`/`diretor_cargo` são CONGELADOS
 * aqui. O plano guarda a versão de valores vigente no momento em que nasceu e o
 * signatário de então — reajustar valores ou trocar o Diretor depois não pode
 * reescrever um documento já emitido.
 *
 * ## O signatário é escolhido AQUI, e não há padrão global
 *
 * Quem assina VARIA por operação (o Titular assina umas, o Adjunto outras),
 * então o formulário tem o campo. O nome vem da busca no cadastro, como o
 * coordenador, e o que se grava são os dois: `diretor_id` (para o editor
 * reabrir mostrando a seleção) e `diretor_nome` (o texto congelado que o PDF
 * imprime).
 *
 * Sem escolha, o plano nasce sem signatário e o documento imprime a linha de
 * assinatura em BRANCO — que é o estado honesto de um plano cujo signatário
 * ainda não foi definido, e visível para quem for emitir. Houve um padrão
 * global em `/config-custos`; ele saiu porque um padrão único para um dado que
 * varia ou é ignorado quase sempre, ou leva a mudar a configuração de todos os
 * planos seguintes para acertar um.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	criarPlano,
	criarEquipes,
	adicionarOpcao,
	definirOpcaoPadrao,
	listarMunicipios,
	type TipoOpcao,
	buscarCustoParametrosVigente,
	auditar,
	contextoDeEvento,
	buscarPolicial
} from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { hojeBrasilISO } from '$lib/utils/datas';
import { validarHora, normalizarHora } from '$lib/gise/horarios';
import { logger } from '$lib/server/logger';
import { textoLimitado } from '$lib/server/form-data';
import { FINALIDADE_PADRAO, ACOES_PADRAO, cargoSignatarioValido } from '$lib/planos/padroes';
import { departamentoDoPlano } from '$lib/server/planos/departamento';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!isAdminGeral(locals.usuario)) redirect(302, '/gise');

	const db = getDB(platform);
	const [vigente, municipios, depto] = await Promise.all([
		buscarCustoParametrosVigente(db),
		listarMunicipios(db),
		departamentoDoPlano(db)
	]);

	return {
		hoje: hojeBrasilISO(),
		finalidadePadrao: FINALIDADE_PADRAO,
		acoesPadrao: ACOES_PADRAO,
		/**
		 * Há tabela de valores gravada? A tela avisa quando não há — sem ela o
		 * Anexo II sairia zerado, e um custo zero indistinguível de "não custa
		 * nada" é pior do que um aviso na criação.
		 */
		temValores: vigente !== null,
		/** Os 184 do Ceará: as opções de origem/destino saem daqui, não de texto livre. */
		municipios,
		/** Sigla do departamento ativo — pré-preenche o campo, que continua editável. */
		departamentoSigla: depto.sigla,
		/** Os cargos do signatário para este departamento; o primeiro é o pré-selecionado. */
		cargos: depto.cargos
	};
};

/** Inteiro entre `min` e `max`, ou `null` quando não é número válido. */
function inteiro(fd: FormData, campo: string, min: number, max: number): number | null {
	const n = Number(String(fd.get(campo) ?? '').trim());
	if (!Number.isInteger(n) || n < min || n > max) return null;
	return n;
}

/** Texto aparado e limitado. */
const texto = textoLimitado;

/** Os três tipos de opção, na ordem em que a tela os apresenta. */
const TIPOS_OPCAO: readonly TipoOpcao[] = ['briefing', 'origem', 'destino'];

/**
 * Os valores repetidos sob o mesmo nome, aparados e sem repetição.
 *
 * A tela manda um campo oculto por opção. A deduplicação aqui é a mesma que
 * `acrescentarNaLista` já faz no cliente — repetida porque o corpo do POST não
 * é obrigado a ter passado por aquela tela, e duas linhas iguais no seletor não
 * ajudam ninguém a escolher.
 */
function listaDoCorpo(
	fd: FormData,
	tipo: TipoOpcao
): { valores: string[]; municipios: Map<string, string> } {
	const brutos = fd.getAll(`opcao_${tipo}`);
	// Os dois arrays viajam PAREADOS — um campo oculto de cada por opção, na mesma
	// ordem. É o índice que os liga, então a leitura precisa andar junta: ler o
	// município por posição errada amarraria a cidade de uma opção à outra, e o
	// trajeto sairia medido pelo lugar errado sem erro nenhum.
	const codigos = fd.getAll(`municipio_${tipo}`);

	const vistos = new Set<string>();
	const valores: string[] = [];
	const municipios = new Map<string, string>();
	for (let i = 0; i < brutos.length && valores.length < 50; i++) {
		const v = String(brutos[i]).trim().slice(0, 200);
		if (!v || vistos.has(v)) continue;
		vistos.add(v);
		valores.push(v);
		const ibge = String(codigos[i] ?? '').trim();
		if (/^\d{7}$/.test(ibge)) municipios.set(v, ibge);
	}
	return { valores, municipios };
}

export const actions: Actions = {
	criar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!isAdminGeral(u)) return fail(403, { error: 'Somente Administrador Geral' });

		const fd = await request.formData();

		const nome = texto(fd, 'nome', 160);
		if (!nome) return fail(400, { error: 'O nome da operação é obrigatório.' });

		const dataInicio = texto(fd, 'data_inicio', 10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
			return fail(400, { error: 'Escolha a data da operação no calendário.' });
		}

		// Horários: início é obrigatório; fim é opcional e, sem ele, a tela não
		// oferece a sugestão automática de horas (ver `classificarJanela`).
		const horaInicio = normalizarHora(texto(fd, 'hora_inicio', 5));
		if (!horaInicio || !validarHora(horaInicio)) {
			return fail(400, { error: 'Horário de início inválido. Use HH:MM.' });
		}
		const horaFimBruta = texto(fd, 'hora_fim', 5);
		let horaFim: string | null = null;
		if (horaFimBruta) {
			horaFim = normalizarHora(horaFimBruta);
			if (!horaFim || !validarHora(horaFim)) {
				return fail(400, { error: 'Horário de término inválido. Use HH:MM.' });
			}
		}

		const dataFimBruta = texto(fd, 'data_fim', 10);
		const dataFim = /^\d{4}-\d{2}-\d{2}$/.test(dataFimBruta) ? dataFimBruta : null;
		if (dataFim && dataFim < dataInicio) {
			return fail(400, { error: 'A data de término é anterior à de início.' });
		}

		const qtdEquipes = inteiro(fd, 'qtd_equipes', 0, 50);
		if (qtdEquipes === null) {
			return fail(400, { error: 'Quantidade de equipes deve ser um número de 0 a 50.' });
		}
		const oipPorEquipe = inteiro(fd, 'oip_por_equipe', 0, 99);
		if (oipPorEquipe === null) {
			return fail(400, { error: 'OIPs por equipe deve ser um número de 0 a 99.' });
		}

		const coordenadorId = inteiro(fd, 'coordenador_id', 1, Number.MAX_SAFE_INTEGER);
		const demandanteId = inteiro(fd, 'demandante_unidade_id', 1, Number.MAX_SAFE_INTEGER);
		const diretorId = inteiro(fd, 'diretor_id', 1, Number.MAX_SAFE_INTEGER);

		const db = getDB(platform);

		// A versão de valores e o signatário são congelados AGORA — ver o cabeçalho
		// do módulo. Sem escolha, o nome fica vazio e o documento imprime a linha
		// de assinatura em branco.
		const [vigente, escolhido, depto] = await Promise.all([
			buscarCustoParametrosVigente(db),
			diretorId ? buscarPolicial(db, diretorId) : Promise.resolve(null),
			departamentoDoPlano(db, demandanteId)
		]);

		const diretorNome = escolhido?.nome ?? '';
		const diretorCargo = cargoSignatarioValido(texto(fd, 'diretor_cargo', 160), depto.cargos);

		let criado: { id: number; numero: number; ano: number };
		try {
			criado = await criarPlano(db, {
				nome,
				finalidade: texto(fd, 'finalidade', 2000) || FINALIDADE_PADRAO,
				acoes: texto(fd, 'acoes', 2000) || ACOES_PADRAO,
				nup: texto(fd, 'nup', 40) || null,
				data_inicio: dataInicio,
				hora_inicio: horaInicio,
				data_fim: dataFim,
				hora_fim: horaFim,
				feriado: fd.get('feriado') != null,
				coordenador_id: coordenadorId,
				demandante_unidade_id: demandanteId,
				departamento: texto(fd, 'departamento', 60) || depto.sigla,
				oip_por_equipe_padrao: oipPorEquipe,
				diretor_id: escolhido?.id ?? null,
				diretor_nome: diretorNome,
				diretor_cargo: diretorCargo,
				custo_parametro_id: vigente?.id ?? null
			});
		} catch (e) {
			logger.error('[gise/planos/novo] criar', { error: String(e) });
			return fail(500, { error: 'Erro ao criar o plano operacional.' });
		}

		// As três listas montadas na tela viram opções agora que o plano tem id.
		// Insere na ordem em que o admin as declarou e só então marca a estrela:
		// `adicionarOpcao` faz da PRIMEIRA a padrão, então marcar depois é o que
		// respeita a escolha da tela sem depender da ordem de inserção.
		const padroes: Record<TipoOpcao, string> = {
			briefing: '',
			origem: '',
			destino: ''
		};
		try {
			for (const tipo of TIPOS_OPCAO) {
				const { valores, municipios } = listaDoCorpo(fd, tipo);
				const escolhida = texto(fd, `padrao_${tipo}`, 200);
				let idPadrao: number | null = null;

				for (const valor of valores) {
					const r = await adicionarOpcao(db, criado.id, tipo, valor, municipios.get(valor) ?? null);
					if (r.ok && valor === escolhida) idPadrao = r.id;
				}
				if (idPadrao !== null) await definirOpcaoPadrao(db, criado.id, idPadrao);

				// O que a equipe nova recebe COPIADO. Sem estrela na lista, fica vazio
				// — e o editor avisa, em vez de eleger uma opção por conta própria.
				padroes[tipo] = idPadrao !== null ? escolhida : '';
			}
		} catch (e) {
			logger.error('[gise/planos/novo] criar opções', { error: String(e), plano: criado.id });
		}

		// Equipes num terceiro passo: falhar aqui deixa o plano existindo sem
		// equipe, que o editor resolve. Derrubar a requisição esconderia isso.
		try {
			await criarEquipes(db, criado.id, {
				quantidade: qtdEquipes,
				comSeint: fd.get('tem_seint') != null,
				briefingPadrao: padroes.briefing,
				origemPadrao: padroes.origem,
				destinoPadrao: padroes.destino
			});
		} catch (e) {
			logger.error('[gise/planos/novo] criar equipes', { error: String(e), plano: criado.id });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'criar_plano_operacional',
				usuario: u,
				entidade: 'plano_operacional',
				entidade_id: criado.id,
				detalhes: `Plano ${criado.numero}/${criado.ano} "${nome}" criado`,
				dados_depois: {
					numero: criado.numero,
					ano: criado.ano,
					nome,
					data_inicio: dataInicio,
					equipes: qtdEquipes,
					seint: fd.get('tem_seint') != null,
					custo_parametro_id: vigente?.id ?? null
				},
				...contexto
			},
			{ env }
		);

		redirect(303, `/gise/planos/${criado.id}`);
	}
};
