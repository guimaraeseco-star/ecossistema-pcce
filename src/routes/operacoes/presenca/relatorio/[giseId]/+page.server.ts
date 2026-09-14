/**
 * `/operacoes/presenca/relatorio/[giseId]` — o formulário de PRODUTIVIDADE em rota
 * própria, dividido nas etapas que o Admin Geral definiu no editor.
 *
 * Era um modal dentro de `/operacoes/presenca`. Virou rota porque o modelo operacional tem
 * 19 perguntas de nível 0 (mais os filhos condicionais): num modal isso é uma
 * coluna de rolagem sem fim, sem endereço próprio e sem como voltar a um trecho
 * específico. Aqui cada etapa é uma tela, o rascunho sobrevive a um fechar de
 * aba (autosave em localStorage, no componente) e a URL identifica o
 * preenchimento.
 *
 * O `?equipeId=` é opcional e só importa quando o policial está em MAIS DE UMA
 * equipe da mesma GISE — sem ele, vale a primeira equipe encontrada, que é o que
 * a tela de presença já assume ao montar o link.
 *
 * Duas regras são do SERVIDOR, e não da tela, porque a rota é endereçável e um
 * POST direto não passa pela UI:
 *
 * - **participação**: `resolverAlvoRelatorio` é quem diz de qual equipe é o
 *   relatório. O `equipeId` do cliente só FILTRA entre as equipes do próprio
 *   policial; nunca escolhe a equipe. Sem isso, um POST com `equipeId` alheio
 *   gravava o relatório de outra equipe (a action antiga, no `+page.server.ts`
 *   de `/operacoes/presenca`, confiava no valor do formulário);
 * - **entrada confirmada**: sem presença não há relatório a prestar. Era só o
 *   `disabled` de um botão.
 */

import { redirect, fail, error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { GiseModeloPerguntaConfig } from '$lib/types';
import {
	type Database,
	getDB,
	buscarGiseModeloFormulario,
	buscarRespostaGise,
	salvarRespostaGise,
	sincronizarStatusGiseAposPresencaRelatorios,
	mapaLinhaBaseDaUnidade,
	upsertLinhaBase,
	DEFAULT_SEINT_QUESTIONS,
	DEFAULT_QUESTIONS_FORM_OPERACIONAL
} from '$lib/db';
import { extrairIndicadores, indicadoresComLinhaBase } from '$lib/gise/indicadores';
import { logger } from '$lib/server/logger';
import {
	parseRespostasFormularioJsonLoose,
	parseRespostasFormularioJsonStrict
} from '$lib/schemas/gise-respostas-form';
import {
	giseEscalas,
	giseMembros,
	giseEquipes,
	giseSeccionais,
	giseSeccionalUnidades,
	gisePresencas,
	unidades
} from '$lib/server/schema';
import { eq, and, or } from 'drizzle-orm';

/** De quem é o relatório desta tela, já resolvido no banco. */
type AlvoRelatorio = {
	/** `null` no quadro de supervisão: a resposta do SEINT é individual. */
	equipeId: number | null;
	/** Só quem DEVE relatório chega aqui — assessor e supervisor não entregam. */
	equipeTipo: 'operacional' | 'seint';
	seccionalNome: string;
	dataInicio: string;
	/** A operação da escala. `null` só em linha anterior à migração 0048. */
	operacaoId: number | null;
	/**
	 * A UNIDADE por cuja linha de base este relatório responde.
	 *
	 * Resolvida aqui, no servidor, pela mesma razão que a equipe: o valor decide
	 * de quem é o número gravado em `operacao_linha_base`, e aceitá-lo do cliente
	 * deixaria um policial escrever a base de outra delegacia.
	 *
	 * Precedência: unidade do SLOT da equipe → unidade operacional da seccional →
	 * a própria seccional. É a mesma cadeia que a tela da escala usa para dizer
	 * "de que unidade é esta equipe", e o slot vem primeiro porque é o nível mais
	 * específico — na CRAJUBAR é ele que distingue Crato de Barbalha dentro da 2ª
	 * Seccional.
	 */
	unidadeId: number | null;
};

/**
 * A qual equipe/relatório este policial tem direito nesta GISE, ou `null` se a
 * nenhum. Única fonte da resposta — o `load` usa para montar a tela e a action
 * usa para decidir onde gravar, então não há como a tela e a gravação
 * discordarem sobre a equipe.
 *
 * `equipeIdFiltro` desempata quando o policial está em mais de uma equipe da
 * mesma GISE. Um valor de outra equipe não "escolhe" nada: some do `WHERE` e o
 * resultado é `null`.
 */
async function resolverAlvoRelatorio(
	db: Database,
	giseId: number,
	policialId: number,
	equipeIdFiltro: number | null
): Promise<AlvoRelatorio | null> {
	const membro = await db
		.select({
			equipe_id: giseEquipes.id,
			equipe_tipo: giseEquipes.tipo,
			seccional_nome: unidades.nome,
			data_inicio: giseEscalas.data_inicio,
			operacao_id: giseEscalas.operacao_id,
			seccional_unidade_id: giseSeccionais.seccional_id,
			unidade_operacional_id: giseSeccionais.unidade_operacional_id,
			slot_unidade_id: giseSeccionalUnidades.unidade_id
		})
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		// LEFT: equipe legada pode não ter slot (`gise_unidade_id` nulo), e nesse
		// caso a unidade cai nos níveis seguintes da precedência.
		.leftJoin(giseSeccionalUnidades, eq(giseEquipes.gise_unidade_id, giseSeccionalUnidades.id))
		.where(
			and(
				eq(giseMembros.policial_id, policialId),
				eq(giseEscalas.id, giseId),
				equipeIdFiltro !== null ? eq(giseEquipes.id, equipeIdFiltro) : undefined
			)
		)
		.get();

	if (membro) {
		if (membro.equipe_tipo !== 'operacional' && membro.equipe_tipo !== 'seint') return null;
		return {
			equipeId: membro.equipe_id,
			equipeTipo: membro.equipe_tipo,
			seccionalNome: membro.seccional_nome,
			dataInicio: membro.data_inicio,
			operacaoId: membro.operacao_id,
			unidadeId:
				membro.slot_unidade_id ?? membro.unidade_operacional_id ?? membro.seccional_unidade_id
		};
	}

	// Quadro de supervisão: só o SEINT entrega relatório, e a resposta dele é
	// INDIVIDUAL (sem equipe) — daí `equipeId: null`. Assessor e supervisor DPC
	// participam da GISE mas não devem relatório, e por isso não casam aqui.
	const supervisao = await db
		.select({ data_inicio: giseEscalas.data_inicio, operacao_id: giseEscalas.operacao_id })
		.from(giseEscalas)
		.where(
			and(
				eq(giseEscalas.id, giseId),
				or(eq(giseEscalas.seint1_id, policialId), eq(giseEscalas.seint2_id, policialId))
			)
		)
		.get();
	if (!supervisao) return null;

	return {
		equipeId: null,
		equipeTipo: 'seint',
		seccionalNome: 'Supervisão Geral',
		dataInicio: supervisao.data_inicio,
		operacaoId: supervisao.operacao_id,
		// O quadro de supervisão não responde por delegacia nenhuma — a linha de
		// base é da UNIDADE, e ele não tem uma. Sem `unidadeId`, o formulário não
		// mostra campo de base e nada é gravado.
		unidadeId: null
	};
}

/** Entrada confirmada? É o pré-requisito das duas pontas (tela e gravação). */
async function entradaConfirmada(db: Database, giseId: number, policialId: number) {
	const presenca = await db
		.select({ entrada_timestamp: gisePresencas.entrada_timestamp })
		.from(gisePresencas)
		.where(and(eq(gisePresencas.gise_id, giseId), eq(gisePresencas.policial_id, policialId)))
		.get();
	return !!presenca?.entrada_timestamp;
}

/** `?equipeId=` da URL como número, ou `null` quando ausente/inválido. */
function lerEquipeIdFiltro(valor: string | null): number | null {
	if (!valor) return null;
	const n = Number(valor);
	return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Grava as linhas de base que o policial informou dentro do formulário.
 *
 * Duas defesas, ambas necessárias porque o payload é do cliente:
 *
 * - a `key` recebida é confrontada com os indicadores do MODELO daquela
 *   operação. Uma chave inventada não vira linha — senão o blob de base viraria
 *   um depósito de chaves arbitrárias que nenhum gráfico leria;
 * - só grava indicador que AINDA não tem base. Quem já informou pela aba é o
 *   admin da unidade, e uma retificação de relatório não deve sobrescrever o
 *   número oficial dela pelas costas.
 */
async function gravarLinhasBaseDoFormulario(
	db: Database,
	basesStr: string,
	destino: {
		operacaoId: number;
		unidadeId: number;
		equipeTipo: 'operacional' | 'seint';
	},
	u: { id: number; nome: string }
) {
	const bruto: unknown = JSON.parse(basesStr);
	if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return;

	const modeloRow = await buscarGiseModeloFormulario(db, destino.operacaoId, destino.equipeTipo);
	if (!modeloRow?.config) return;
	const modelo = JSON.parse(modeloRow.config) as GiseModeloPerguntaConfig[];

	const permitidas = new Set(indicadoresComLinhaBase(extrairIndicadores(modelo)).map((i) => i.key));
	if (permitidas.size === 0) return;

	const jaInformadas = await mapaLinhaBaseDaUnidade(db, destino.operacaoId, destino.unidadeId);

	for (const [key, valorBruto] of Object.entries(bruto as Record<string, unknown>)) {
		if (!permitidas.has(key) || jaInformadas.has(key)) continue;
		const valor = typeof valorBruto === 'number' ? valorBruto : Number(valorBruto);
		if (!Number.isFinite(valor) || valor < 0) continue;

		await upsertLinhaBase(db, {
			operacaoId: destino.operacaoId,
			unidadeId: destino.unidadeId,
			indicadorKey: key,
			valor,
			informadoPorId: u.id,
			informadoPorNome: u.nome,
			origem: 'formulario'
		});
	}
}

export const load: PageServerLoad = async ({ params, url, locals, platform }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	// Admin Geral edita o MODELO em `/operacoes/presenca`; quem responde é o policial.
	if (u.tipo !== 'policial') redirect(302, '/operacoes/presenca');

	const giseId = Number(params.giseId);
	if (!Number.isInteger(giseId) || giseId <= 0) error(404, 'Escala não encontrada');

	const db = getDB(platform);
	const alvo = await resolverAlvoRelatorio(
		db,
		giseId,
		u.id,
		lerEquipeIdFiltro(url.searchParams.get('equipeId'))
	);

	// Não participa, ou participa num papel que não deve relatório. Devolver à
	// tela de presença em vez de 403: o assessor/supervisor legitimamente abriu a
	// própria escala, e é lá que está escrito o que lhe cabe.
	if (!alvo) redirect(302, `/operacoes/presenca?giseId=${giseId}`);

	const voltarUrl = `/operacoes/presenca?giseId=${giseId}${alvo.equipeId ? `&equipeId=${alvo.equipeId}` : ''}`;
	if (!(await entradaConfirmada(db, giseId, u.id))) redirect(302, voltarUrl);

	const [modeloRow, respostaRow] = await Promise.all([
		alvo.operacaoId != null
			? buscarGiseModeloFormulario(db, alvo.operacaoId, alvo.equipeTipo)
			: Promise.resolve(null),
		buscarRespostaGise(db, giseId, u.id, alvo.equipeId ?? undefined)
	]);

	let modelo: GiseModeloPerguntaConfig[] =
		alvo.equipeTipo === 'seint' ? DEFAULT_SEINT_QUESTIONS : DEFAULT_QUESTIONS_FORM_OPERACIONAL;
	if (modeloRow?.config) {
		try {
			modelo = JSON.parse(modeloRow.config);
		} catch (err) {
			logger.warn(`[res-gise/relatorio] modelo ${alvo.equipeTipo} JSON inválido`, {
				err: String(err)
			});
		}
	}

	// Indicadores que ainda NÃO têm linha de base para a unidade desta equipe.
	//
	// É o caminho de escape do pedido: a base deveria vir da aba `/operacoes/dados-base`,
	// preenchida pelo admin da unidade. Quando não veio, é aqui que ela é
	// pedida — no campo da própria pergunta, a quem está com o formulário aberto.
	// Sem isso o indicador percentual fica sem denominador e o gráfico não tem o
	// que mostrar.
	//
	// Só indicador PERCENTUAL entra: meta absoluta não tem base a informar.
	const basesPendentes: Array<{ key: string; texto: string; rotulo: string; unidade: string }> = [];
	if (alvo.operacaoId != null && alvo.unidadeId != null) {
		const indicadores = indicadoresComLinhaBase(extrairIndicadores(modelo));
		if (indicadores.length > 0) {
			const jaInformadas = await mapaLinhaBaseDaUnidade(db, alvo.operacaoId, alvo.unidadeId);
			for (const ind of indicadores) {
				if (jaInformadas.has(ind.key)) continue;
				basesPendentes.push({
					key: ind.key,
					texto: ind.texto,
					rotulo: ind.config.rotuloBase?.trim() || `${ind.texto} — valor antes da operação`,
					unidade: ind.config.unidadeMedida ?? ''
				});
			}
		}
	}

	return {
		giseId,
		...alvo,
		voltarUrl,
		modelo,
		basesPendentes,
		respostas: respostaRow?.respostas
			? parseRespostasFormularioJsonLoose(respostaRow.respostas)
			: {},
		respostaEnviadaEm: respostaRow?.created_at ?? null,
		respostaAtualizadaEm: respostaRow?.updated_at ?? null
	};
};

export const actions: Actions = {
	/**
	 * Envia ou RETIFICA o relatório de produtividade. O parser é o `strict`: o
	 * conteúdo vai para um documento assinável, então formato inesperado é
	 * recusado em vez de sanitizado. Ao final, o status da GISE é recalculado — o
	 * último relatório pode deixá-la pronta para finalizar.
	 *
	 * A equipe de destino NÃO vem do formulário: é resolvida no banco a partir do
	 * policial logado (ver `resolverAlvoRelatorio`).
	 */
	salvarResposta: async ({ request, locals, platform, params, url }) => {
		const u = locals.usuario;
		if (!u || u.tipo !== 'policial') return fail(401, { error: 'Não autorizado' });

		const giseId = Number(params.giseId);
		if (!Number.isInteger(giseId) || giseId <= 0) return fail(400, { error: 'Escala inválida' });

		const formData = await request.formData();
		const respostasStr = formData.get('respostas') as string;
		if (!respostasStr) return fail(400, { error: 'Dados inválidos', giseId });

		const parsed = parseRespostasFormularioJsonStrict(respostasStr);
		if (!parsed.ok) return fail(400, { error: 'Respostas em formato inválido', giseId });

		const db = getDB(platform);
		const alvo = await resolverAlvoRelatorio(
			db,
			giseId,
			u.id,
			lerEquipeIdFiltro(url.searchParams.get('equipeId'))
		);
		if (!alvo) return fail(403, { error: 'Você não responde por esta escala GISE.', giseId });
		if (!(await entradaConfirmada(db, giseId, u.id))) {
			return fail(403, { error: 'Confirme sua entrada antes de enviar o relatório.', giseId });
		}

		await salvarRespostaGise(
			db,
			giseId,
			u.id,
			JSON.stringify(parsed.data),
			alvo.equipeId ?? undefined
		);

		// Linhas de base informadas dentro do formulário (o caminho de escape de
		// quando a aba `/operacoes/dados-base` não foi preenchida).
		//
		// A OPERAÇÃO e a UNIDADE vêm do `alvo`, resolvido no banco — o cliente manda
		// apenas quais indicadores e com que valor. Aceitar `unidadeId` do corpo
		// deixaria um policial gravar a base de outra delegacia, que é o parâmetro
		// de um resultado divulgado.
		//
		// Grava DEPOIS da resposta e sem derrubar a requisição em caso de falha: o
		// relatório é a entrega obrigatória do policial, e perdê-lo por causa de um
		// número auxiliar seria a troca errada.
		const operacaoId = alvo.operacaoId;
		const unidadeId = alvo.unidadeId;
		if (operacaoId != null && unidadeId != null) {
			const basesStr = formData.get('linhasBase');
			if (typeof basesStr === 'string' && basesStr.trim()) {
				try {
					await gravarLinhasBaseDoFormulario(
						db,
						basesStr,
						{ operacaoId, unidadeId, equipeTipo: alvo.equipeTipo },
						u
					);
				} catch (err) {
					logger.warn('[res-gise/relatorio] falha ao gravar linha de base', {
						giseId,
						err: String(err)
					});
				}
			}
		}

		await sincronizarStatusGiseAposPresencaRelatorios(db, giseId);

		return { success: true, giseId, equipeId: alvo.equipeId };
	}
};
