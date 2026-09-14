/**
 * Linha de base dos indicadores: o valor inicial contra o qual a meta é medida.
 *
 * "Redução mínima de 20% do acervo de inquéritos pendentes" precisa de um
 * denominador que só a delegacia tem — e o Plano Operacional da CRAJUBAR lista a
 * falta dele como risco declarado ("ausência de linha de base consolidada").
 * Este módulo é onde esse número entra e de onde os gráficos o leem.
 *
 * Duas coisas que não estão no nome das funções:
 *
 * - `indicador_key` é a `key` da PERGUNTA, não a chave onde a resposta é
 *   gravada. Nos tipos de lista elas diferem (`extra_17` × `extra_17__qtd`); a
 *   tradução é de `chaveResposta()`, em `$lib/gise/indicadores`. Guardar a da
 *   pergunta é o que mantém a base ligada ao indicador quando o tipo muda;
 * - **este módulo não autoriza ninguém.** Quem decide se aquele usuário pode
 *   escrever a base daquela unidade é `unidadesLinhaBaseAdministradas`, em
 *   `$lib/server/operacoes/permissao`. A `unidade_id` chega de fora da URL (do
 *   corpo do POST), que é exatamente o caso em que confiar no cliente já custou
 *   caro neste projeto (FLW-ESC-002).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
	operacaoLinhaBase,
	giseEscalas,
	giseSeccionais,
	giseSeccionalUnidades,
	unidades
} from '$lib/server/schema';
import type { Database } from '../core';
import type { OperacaoLinhaBase } from '$lib/server/schema';

/** O que a tela grava: um valor por (operação, unidade, indicador). */
export interface LinhaBaseEntrada {
	operacaoId: number;
	unidadeId: number;
	indicadorKey: string;
	valor: number;
	observacao?: string;
	informadoPorId?: number | null;
	informadoPorNome?: string;
	/** 'aba' = /operacoes/dados-base; 'formulario' = capturado no relatório de produtividade. */
	origem?: 'aba' | 'formulario';
}

/**
 * As linhas de base de uma operação, opcionalmente recortadas às unidades
 * informadas.
 *
 * Passar `unidadeIds` vazio devolve `[]` sem ir ao banco — é o caso do usuário
 * sem escopo algum, e um `inArray` com lista vazia produz SQL inválido em alguns
 * drivers.
 */
export async function listarLinhaBase(
	db: Database,
	operacaoId: number,
	unidadeIds?: number[]
): Promise<OperacaoLinhaBase[]> {
	if (unidadeIds && unidadeIds.length === 0) return [];
	const filtro = unidadeIds
		? and(
				eq(operacaoLinhaBase.operacao_id, operacaoId),
				inArray(operacaoLinhaBase.unidade_id, unidadeIds)
			)
		: eq(operacaoLinhaBase.operacao_id, operacaoId);
	return db.select().from(operacaoLinhaBase).where(filtro).all();
}

/**
 * As bases de UMA unidade numa operação, indexadas pela `key` do indicador —
 * a forma que o formulário e os gráficos consomem.
 */
export async function mapaLinhaBaseDaUnidade(
	db: Database,
	operacaoId: number,
	unidadeId: number
): Promise<Map<string, number>> {
	const linhas = await db
		.select({ indicador_key: operacaoLinhaBase.indicador_key, valor: operacaoLinhaBase.valor })
		.from(operacaoLinhaBase)
		.where(
			and(
				eq(operacaoLinhaBase.operacao_id, operacaoId),
				eq(operacaoLinhaBase.unidade_id, unidadeId)
			)
		)
		.all();
	return new Map(linhas.map((l) => [l.indicador_key, l.valor]));
}

/**
 * Grava (ou atualiza) a base de um indicador.
 *
 * `ON CONFLICT DO UPDATE` sobre o índice único `uq_operacao_linha_base`, e não
 * "SELECT e depois INSERT ou UPDATE": entre a leitura e a escrita cabe outra
 * requisição, e duas seriam recusadas pelo índice de qualquer forma — melhor
 * resolver no próprio comando.
 *
 * `created_at` é preservado no conflito (só `updated_at` anda): a coluna conta
 * quando a unidade informou a base pela PRIMEIRA vez, que é o carimbo que
 * interessa para "a base foi definida antes ou depois de a operação começar?".
 */
export async function upsertLinhaBase(db: Database, dados: LinhaBaseEntrada) {
	return db
		.insert(operacaoLinhaBase)
		.values({
			operacao_id: dados.operacaoId,
			unidade_id: dados.unidadeId,
			indicador_key: dados.indicadorKey,
			valor: dados.valor,
			observacao: dados.observacao ?? '',
			informado_por_id: dados.informadoPorId ?? null,
			informado_por_nome: dados.informadoPorNome ?? '',
			origem: dados.origem ?? 'aba'
		})
		.onConflictDoUpdate({
			target: [
				operacaoLinhaBase.operacao_id,
				operacaoLinhaBase.unidade_id,
				operacaoLinhaBase.indicador_key
			],
			set: {
				valor: dados.valor,
				observacao: dados.observacao ?? '',
				informado_por_id: dados.informadoPorId ?? null,
				informado_por_nome: dados.informadoPorNome ?? '',
				origem: dados.origem ?? 'aba',
				updated_at: sql`datetime('now', '-3 hours')`
			}
		});
}

/**
 * As unidades que participam da operação — as que podem (e devem) informar base.
 *
 * "Participar" tem três formas no modelo da escala extra, e todas contam:
 *
 *  1. a seccional listada na escala (`gise_seccionais.seccional_id`);
 *  2. a unidade operacional da seccional (`unidade_operacional_id`);
 *  3. a unidade de um SLOT dentro da seccional (`gise_seccional_unidades`) — é
 *     por aqui que a Delegacia do Crato e a de Barbalha entram na CRAJUBAR.
 *
 * Ignorar (3) foi o erro tentador: seria a consulta mais curta, e deixaria de
 * fora exatamente as delegacias que o plano nomeia.
 */
export async function unidadesParticipantesDaOperacao(
	db: Database,
	operacaoId: number
): Promise<Array<{ id: number; nome: string; tipo: string }>> {
	const linhas = await db
		.selectDistinct({ id: unidades.id, nome: unidades.nome, tipo: unidades.tipo })
		.from(giseSeccionais)
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.leftJoin(giseSeccionalUnidades, eq(giseSeccionalUnidades.gise_seccional_id, giseSeccionais.id))
		.innerJoin(
			unidades,
			sql`${unidades.id} IN (
				${giseSeccionais.seccional_id},
				${giseSeccionais.unidade_operacional_id},
				${giseSeccionalUnidades.unidade_id}
			)`
		)
		.where(eq(giseEscalas.operacao_id, operacaoId))
		.all();

	return [...new Map(linhas.map((l) => [l.id, l])).values()].sort((a, b) =>
		a.nome.localeCompare(b.nome, 'pt-BR')
	);
}
