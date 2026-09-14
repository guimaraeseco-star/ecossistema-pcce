/**
 * `/operacoes/gise` — lista das escalas GISE ativas.
 *
 * A GISE é a operação extraordinária: uma escala por data, montada pelo Admin
 * Geral e preenchida pelas seccionais. Esta rota é a porta de entrada dos
 * quatro públicos que a enxergam — Admin Geral, admin seccional/unidade,
 * supervisor DPC e policial escalado —, cada um com um recorte diferente.
 *
 * O arquivo das escalas já encerradas mora em `/operacoes/gise/finalizadas` (Admin Geral).
 *
 * Só o Admin Geral CRIA escalas; a `criar` aceita várias datas de uma vez, do
 * zero ou clonando uma escala existente.
 */

import type { PageServerLoad, Actions } from './$types';
import { redirect, fail } from '@sveltejs/kit';
import {
	getDB,
	listarGiseEscalas,
	criarGiseEscala,
	clonarGiseParaData,
	upsertGiseSeccional,
	listarOperacoes,
	buscarOperacao,
	buscarOperacaoPorNome,
	NOME_OPERACAO_PADRAO,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { lerPapelGise } from '$lib/server/gise/papel-cache';
import { buscarUnidadeIdSupervisaoExtra } from '$lib/server/gise/supervisao-extra';
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';
import { buscarConfiguracao } from '$lib/db/configuracoes';
import { mensagemDeErro } from '$lib/utils/erro';
import { horaHhMm, informado } from '$lib/server/form-data';

export const load: PageServerLoad = async ({ locals, platform, depends }) => {
	depends('app:gise-list');

	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const db = getDB(platform);

	const isGeral = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);

	let isSupervisor = false;
	let isMembro = false;
	if (u.tipo === 'policial') {
		// Reutiliza o cache edge (TTL 60s) já populado pelo layout — evita 2 queries ao D1
		const papel = await lerPapelGise(db, u.id);
		isSupervisor = papel.isSupervisor;
		isMembro = papel.isMembro;
	}

	// Servidores sem qualquer vínculo com GISE: redirecionar
	if (!isGeral && !isSeccional && !isSupervisor && !isMembro) {
		redirect(302, '/');
	}

	const isUnidade = isAdminUnidade(u);
	// Escopo da lista (Opção B): admin geral vê todas; os demais veem a UNIÃO das
	// GISEs a que têm vínculo — participação da própria seccional (admin
	// seccional/unidade) E/OU GISEs onde são quadro de supervisão/membro
	// (qualquer policial — inclui um admin seccional que supervisiona GISE de
	// outra seccional, evitando regressão).
	const seccionalParticipanteId =
		!isGeral && (isSeccional || isUnidade) ? (u.papel_unidade_id ?? undefined) : undefined;
	const policialId = !isGeral && u.tipo === 'policial' ? u.id : undefined;
	const [escalas, supervisaoExtraUnidadeId, defaultHoraEntrada, defaultHoraSaida] =
		await Promise.all([
			listarGiseEscalas(db, undefined, policialId, seccionalParticipanteId),
			buscarUnidadeIdSupervisaoExtra(db),
			buscarConfiguracao(db, 'gise_default_hora_entrada'),
			buscarConfiguracao(db, 'gise_default_hora_saida')
		]);

	const minhaSeccionalId = isSeccional || isUnidade ? u.papel_unidade_id : null;

	// Filtro por operação: aplicado no CLIENTE, sobre a mesma lista que a tela já
	// recebe inteira. Não vale uma ida ao servidor — o filtro é de leitura, não de
	// escopo (o escopo por participação continua no `listarGiseEscalas`).
	const operacoes = await listarOperacoes(db);

	return {
		escalas,
		operacoes,
		isGeral,
		isSeccional,
		isUnidade,
		isSupervisor,
		isMembro,
		minhaSeccionalId,
		supervisaoExtraUnidadeId,
		defaultHoraEntrada: defaultHoraEntrada ?? '08:00',
		defaultHoraSaida: defaultHoraSaida ?? '16:00'
	};
};

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function parseDatasCriacaoGise(
	raw: string | undefined
): { ok: true; dias: { data: string; feriado: boolean }[] } | { ok: false; error: string } {
	if (!raw?.trim()) return { ok: false, error: 'Selecione pelo menos um dia no calendário' };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'Lista de datas inválida' };
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		return { ok: false, error: 'Selecione pelo menos um dia no calendário' };
	}
	const vistos = new Set<string>();
	const dias: { data: string; feriado: boolean }[] = [];
	for (const item of parsed) {
		if (!item || typeof item !== 'object') return { ok: false, error: 'Lista de datas inválida' };
		const data = (item as { data?: unknown }).data;
		const feriado = !!(item as { feriado?: unknown }).feriado;
		if (typeof data !== 'string' || !DATA_ISO.test(data))
			return { ok: false, error: 'Data inválida na seleção' };
		if (vistos.has(data)) continue;
		vistos.add(data);
		dias.push({ data, feriado });
	}
	dias.sort((a, b) => a.data.localeCompare(b.data));
	if (dias.length === 0) return { ok: false, error: 'Selecione pelo menos um dia no calendário' };
	return { ok: true, dias };
}

export const actions: Actions = {
	/**
	 * Cria uma ou VÁRIAS escalas GISE de uma vez (uma por data do calendário).
	 *
	 * Dois modos: do zero, com os horários padrão da operação, ou clonada de
	 * uma escala existente — que copia a estrutura (seccionais, unidades, equipes
	 * e vagas), mas não as pessoas nem as presenças. Datas repetidas na seleção
	 * são descartadas antes de gravar.
	 */
	criar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!isAdminGeral(u))
			return fail(403, { error: 'Apenas o Administrador Geral pode criar escalas GISE' });

		const data = await request.formData();
		const datasJson = data.get('datas_json')?.toString();

		const db = getDB(platform);
		const modo = (data.get('modo')?.toString() || 'completa') as 'completa' | 'clonada' | 'branco';
		const clonar_de = data.get('clonar_de') ? Number(data.get('clonar_de')) : undefined;

		const parsed = parseDatasCriacaoGise(datasJson);
		if (!parsed.ok) return fail(400, { error: parsed.error });
		if (modo === 'clonada' && !clonar_de) {
			return fail(400, { error: 'Escolha a escala de origem para copiar' });
		}

		// A operação da escala nova. No modo CLONADA ela não vem do formulário: a
		// cópia herda a do original (`clonarGiseParaData`), senão clonar uma escala
		// da CRAJUBAR poderia produzir uma do GISE — com outro formulário e outros
		// indicadores — sem ninguém ter pedido.
		let operacaoId: number | null = null;
		if (modo !== 'clonada') {
			const bruto = Number(data.get('operacao_id'));
			if (Number.isInteger(bruto) && bruto > 0) {
				const operacao = await buscarOperacao(db, bruto);
				if (!operacao) return fail(400, { error: 'Operação inválida' });
				if (!operacao.ativo) {
					return fail(400, {
						error: `A operação ${operacao.nome} está desativada e não recebe escalas novas.`
					});
				}
				operacaoId = operacao.id;
			} else {
				// Sem escolha explícita, a escala fica com a operação histórica — é o
				// comportamento de antes de existirem operações, e o que mantém um POST
				// de versão anterior do formulário funcionando durante o deploy.
				operacaoId = (await buscarOperacaoPorNome(db, NOME_OPERACAO_PADRAO))?.id ?? null;
			}
		}

		// Horário: o que o formulário mandou; na falta, o padrão DA OPERAÇÃO; na
		// falta dele, o padrão do sistema. A ordem importa — desde a migração 0051 a
		// operação pode fixar o próprio horário, e ignorá-lo aqui faria a escala
		// nascer com o horário de outra operação.
		const operacaoParaHorario = operacaoId != null ? await buscarOperacao(db, operacaoId) : null;
		const defaultHoraEntrada =
			operacaoParaHorario?.hora_entrada_padrao ??
			(await buscarConfiguracao(db, 'gise_default_hora_entrada')) ??
			'08:00';
		const defaultHoraSaida =
			operacaoParaHorario?.hora_saida_padrao ??
			(await buscarConfiguracao(db, 'gise_default_hora_saida')) ??
			'16:00';

		// Ausente cai no padrão (da operação, da configuração, ou o literal);
		// preenchido tem de ser HH:MM. É o horário que o portão da janela de
		// presença compara, e ele libera quando a hora não parseia — ver `dataIso`.
		const hora_entrada = informado(data, 'hora_entrada')
			? horaHhMm(data, 'hora_entrada')
			: defaultHoraEntrada;
		const hora_saida = informado(data, 'hora_saida')
			? horaHhMm(data, 'hora_saida')
			: defaultHoraSaida;
		if (!hora_entrada || !hora_saida) {
			return fail(400, { error: 'Horário inválido — use HH:MM.' });
		}

		try {
			let ids: number[];

			if (modo === 'clonada' && clonar_de) {
				// Paralelize: cada data é independente, sem conflito de FK
				ids = await Promise.all(
					parsed.dias.map(({ data: d, feriado }) =>
						clonarGiseParaData(db, clonar_de, d, 'clonada', hora_entrada, hora_saida, feriado)
					)
				);
			} else if (modo === 'branco') {
				ids = await Promise.all(
					parsed.dias.map(({ data: d, feriado }) =>
						criarGiseEscala(
							db,
							d,
							hora_entrada,
							hora_saida,
							'em_definicao_supervisor',
							feriado,
							operacaoId
						)
					)
				);
			} else {
				// Buscar seccionais uma vez; depois criar todas as escalas + suas seccionais em paralelo
				const seccionais = await db
					.select({ id: unidades.id, nome: unidades.nome })
					.from(unidades)
					.where(eq(unidades.tipo, 'seccional'))
					.all();

				ids = await Promise.all(
					parsed.dias.map(async ({ data: d, feriado }) => {
						const novaId = await criarGiseEscala(
							db,
							d,
							hora_entrada,
							hora_saida,
							'em_definicao_supervisor',
							feriado,
							operacaoId
						);
						await Promise.all(seccionais.map((sec) => upsertGiseSeccional(db, novaId, sec.id)));
						return novaId;
					})
				);
			}

			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'criar_gise',
					usuario: u,
					entidade: 'gise',
					entidade_id: ids[0] ?? null,
					detalhes: `${ids.length} escala(s) GISE criada(s) (modo ${modo})`,
					metadados: { count: ids.length, ids, datas: parsed.dias.map((d) => d.data), modo },
					...contexto
				},
				{ env }
			);

			return { success: true, count: ids.length, ids, datas: parsed.dias.map((d) => d.data) };
		} catch (e: unknown) {
			const msg = mensagemDeErro(e);
			return fail(500, { error: msg });
		}
	}
};
