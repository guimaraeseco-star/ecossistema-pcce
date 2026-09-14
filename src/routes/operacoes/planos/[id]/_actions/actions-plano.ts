/**
 * Form actions dos PARÂMETROS GERAIS do plano — o cabeçalho do documento.
 *
 * Tudo o que a criação pediu pode ser corrigido aqui: nome, finalidade, ações,
 * NUP, calendário, coordenador, demandante e briefing padrão. O que NÃO se
 * edita é `numero`/`ano` (o documento já pode ter circulado com eles) e
 * `custo_parametro_id` (a versão de valores é congelada na criação — reajustar
 * não pode reescrever o que foi orçado).
 */
import { fail } from '@sveltejs/kit';
import {
	atualizarPlano,
	ressincronizarSnapshots,
	auditar,
	contextoDeEvento,
	buscarPolicial
} from '$lib/db';
import { cargoSignatarioValido } from '$lib/planos/padroes';
import { departamentoDoPlano } from '$lib/server/planos/departamento';
import { validarHora, normalizarHora } from '$lib/gise/horarios';
import { logger } from '$lib/server/logger';
import { planoDaRota, getInt, getTexto, type EventoPlano } from './shared';

export const actionsPlano = {
	/** Patch dos parâmetros gerais. */
	salvarPlano: async (event: EventoPlano) => {
		const ctx = await planoDaRota(event);
		if ('erro' in ctx) return ctx.erro;
		const { db, plano } = ctx;

		const fd = await event.request.formData();

		const nome = getTexto(fd, 'nome', 160);
		if (!nome) return fail(400, { error: 'O nome da operação é obrigatório.' });

		const dataInicio = getTexto(fd, 'data_inicio', 10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
			return fail(400, { error: 'Data da operação inválida.' });
		}

		const horaInicio = normalizarHora(getTexto(fd, 'hora_inicio', 5));
		if (!horaInicio || !validarHora(horaInicio)) {
			return fail(400, { error: 'Horário de apresentação inválido. Use HH:MM.' });
		}

		const horaFimBruta = getTexto(fd, 'hora_fim', 5);
		let horaFim: string | null = null;
		if (horaFimBruta) {
			horaFim = normalizarHora(horaFimBruta);
			if (!horaFim || !validarHora(horaFim)) {
				return fail(400, { error: 'Previsão de término inválida. Use HH:MM.' });
			}
		}

		const dataFimBruta = getTexto(fd, 'data_fim', 10);
		const dataFim = /^\d{4}-\d{2}-\d{2}$/.test(dataFimBruta) ? dataFimBruta : null;
		if (dataFim && dataFim < dataInicio) {
			return fail(400, { error: 'A data de término é anterior à de início.' });
		}

		const oipPorEquipe = getInt(fd, 'oip_por_equipe');
		if (!Number.isInteger(oipPorEquipe) || oipPorEquipe < 0 || oipPorEquipe > 99) {
			return fail(400, { error: 'OIPs por equipe deve ser um número de 0 a 99.' });
		}

		const coordenadorId = getInt(fd, 'coordenador_id');
		const demandanteId = getInt(fd, 'demandante_unidade_id');

		// Signatário: o nome vai CONGELADO no plano, resolvido do cadastro agora.
		// Sem escolha, o que já estava gravado permanece — limpar o campo não pode
		// esvaziar em silêncio a linha de assinatura de um documento pronto.
		const diretorId = getInt(fd, 'diretor_id');
		const [escolhido, depto] = await Promise.all([
			Number.isInteger(diretorId) ? buscarPolicial(db, diretorId) : Promise.resolve(null),
			departamentoDoPlano(db, Number.isInteger(demandanteId) ? demandanteId : null)
		]);

		try {
			await atualizarPlano(db, plano.id, {
				nome,
				finalidade: getTexto(fd, 'finalidade', 2000),
				acoes: getTexto(fd, 'acoes', 2000),
				nup: getTexto(fd, 'nup', 40) || null,
				data_inicio: dataInicio,
				hora_inicio: horaInicio,
				data_fim: dataFim,
				hora_fim: horaFim,
				feriado: fd.get('feriado') != null,
				// `NaN` do campo vazio vira `null`: limpar o coordenador é uma edição
				// legítima, e gravar NaN estouraria a FK.
				coordenador_id: Number.isInteger(coordenadorId) ? coordenadorId : null,
				demandante_unidade_id: Number.isInteger(demandanteId) ? demandanteId : null,
				departamento: getTexto(fd, 'departamento', 60) || depto.sigla,
				oip_por_equipe_padrao: oipPorEquipe,
				diretor_id: escolhido?.id ?? plano.diretor_id,
				diretor_nome: escolhido?.nome ?? plano.diretor_nome,
				diretor_cargo: cargoSignatarioValido(getTexto(fd, 'diretor_cargo', 160), depto.cargos)
			});
		} catch (e) {
			logger.error('[planos/editor] salvarPlano', { error: String(e), plano: plano.id });
			return fail(500, { error: 'Erro ao salvar o plano.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Plano ${plano.numero}/${plano.ano} alterado`,
				dados_antes: { nome: plano.nome, data_inicio: plano.data_inicio, feriado: plano.feriado },
				dados_depois: { nome, data_inicio: dataInicio, feriado: fd.get('feriado') != null },
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/**
	 * Reaplica cargo e classe ATUAIS do cadastro a todos os membros.
	 *
	 * Botão explícito, nunca automático. O snapshot congela a base de cálculo de
	 * propósito; a exceção é o servidor alocado ANTES de alguém corrigir a classe
	 * que faltava — nesse caso o snapshot guardou o vazio e corrigir o cadastro
	 * sozinho não desbloqueia a emissão. Automático, isto desfaria o congelamento:
	 * uma promoção qualquer reescreveria em silêncio o custo de um plano já
	 * conferido.
	 */
	ressincronizarCadastro: async (event: EventoPlano) => {
		const ctx = await planoDaRota(event);
		if ('erro' in ctx) return ctx.erro;
		const { db, plano } = ctx;

		const atualizados = await ressincronizarSnapshots(db, plano.id);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Cargo/classe reaplicados do cadastro em ${atualizados} membro(s)`,
				...contexto
			},
			{ env }
		);

		return { success: true, atualizados };
	},

	/**
	 * Alterna entre rascunho e concluído.
	 *
	 * O status é informativo — ele NÃO trava a edição nem libera o PDF. Quem
	 * decide se o documento pode ser emitido é a ausência de pendências de
	 * cadastro (`podeEmitir`), e isso o status não sabe. Travar a edição em
	 * "concluído" só criaria um passo de destravar antes de toda correção.
	 */
	alternarStatus: async (event: EventoPlano) => {
		const ctx = await planoDaRota(event);
		if ('erro' in ctx) return ctx.erro;
		const { db, plano } = ctx;

		const novo = plano.status === 'concluido' ? 'rascunho' : 'concluido';
		await atualizarPlano(db, plano.id, { status: novo });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Plano ${plano.numero}/${plano.ano} marcado como ${novo}`,
				...contexto
			},
			{ env }
		);

		return { success: true, status: novo };
	}
};
