/**
 * O COMPLEMENTO da carga da planilha de pessoal (fase 2-C, migração 0088) —
 * o que vai além do upsert do cadastro: a designação (catálogo), o evento de
 * afastamento da linha e quem responde pela unidade.
 *
 * Três regras, todas sobre "de quem é o dado":
 *
 * - **Designação**: a planilha é dona. Nome desconhecido entra no catálogo
 *   (a planilha do DPI Sul tem 18; outro departamento pode ter outros) — o
 *   Admin Geral arruma símbolo e ordem depois, pela tela.
 * - **Afastamentos legados**: a planilha traz UM evento por servidor (o
 *   último ou o próximo). A carga apaga os `legado = 1` daquele servidor e
 *   grava os recebidos; os `legado = 0` (registrados pela tela) não são
 *   tocados. Reexecutar a carga na implantação não duplica nada.
 * - **Histórico da planilha de histórico** (`legado = 2`, fase 2-C): a célula
 *   OBSERVAÇÕES vira eventos (`$lib/servidores/historico-texto`). A carga
 *   apaga os `legado = 2` do servidor e grava os recebidos, PULANDO o que já
 *   existe com outra origem — o mesmo afastamento (tipo + subtipo + datas) que
 *   veio da planilha de servidores ou que a tela registrou. "Repetido" é só
 *   igualdade exata; datas diferentes entram as duas e o relatório aponta.
 * - **Responsável pela unidade** (`Delegado Titular`, `Delegado Seccional`,
 *   `Diretor de Departamento` → titular da própria lotação): a carga só mexe
 *   no que tem `origem = 'planilha'`. Vigente da mesma pessoa fica como está
 *   (preserva o início da primeira carga); vigente de outra pessoa vindo da
 *   planilha é encerrado hoje e substituído; vigente cadastrado pela tela
 *   (`origem = 'sistema'`) vence e a carga só relata.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { designacoes, policialHistorico, unidadeResponsaveis, unidades } from '../../server/schema';
import type { Database } from '../core';
import type { SubtipoAfastamento } from '$lib/servidores/afastamentos';

/** As designações que fazem do servidor o TITULAR da própria lotação. */
export const DESIGNACOES_DE_TITULAR = [
	'Delegado Titular',
	'Delegado Seccional',
	'Diretor de Departamento'
] as const;

/** Um evento da planilha de HISTÓRICO, já extraído do texto. */
export interface EventoDoHistorico {
	tipo: 'afastamento' | 'movimentacao' | 'observacao';
	subtipo?: string;
	data_inicio?: string;
	data_fim?: string;
	data_evento?: string;
	unidade_destino?: string;
	nup?: string;
	descricao: string;
}

/** A chave de "mesmo evento": tipo, subtipo e datas; anotação também pelo texto. */
function chaveDoEvento(e: {
	tipo: string;
	subtipo?: string | null;
	data_inicio?: string | null;
	data_fim?: string | null;
	data_evento?: string | null;
	descricao?: string | null;
}): string {
	const texto =
		e.tipo === 'observacao' || e.tipo === 'movimentacao' ? (e.descricao ?? '').slice(0, 80) : '';
	return [
		e.tipo,
		e.subtipo ?? '',
		e.data_inicio ?? '',
		e.data_fim ?? '',
		e.data_evento ?? '',
		texto
	].join('|');
}

/**
 * Regrava o histórico vindo da planilha de histórico (`legado = 2`), sem
 * duplicar o que já existe com outra origem. `created_at` recebe a data do
 * evento, que é o que ordena a linha do tempo — anotação sem data vai para o
 * fim (1970).
 */
export async function regravarHistoricoDaPlanilha(
	db: Database,
	policialId: number,
	eventos: EventoDoHistorico[],
	registradoPor: string
): Promise<{ gravados: number; repetidos: number }> {
	await db
		.delete(policialHistorico)
		.where(and(eq(policialHistorico.policial_id, policialId), eq(policialHistorico.legado, 2)));
	const existentes = await db
		.select({
			tipo: policialHistorico.tipo,
			subtipo: policialHistorico.subtipo,
			data_inicio: policialHistorico.data_inicio,
			data_fim: policialHistorico.data_fim,
			data_evento: policialHistorico.data_evento,
			descricao: policialHistorico.descricao
		})
		.from(policialHistorico)
		.where(eq(policialHistorico.policial_id, policialId));
	const vistos = new Set(existentes.map(chaveDoEvento));
	let gravados = 0;
	let repetidos = 0;
	for (const e of eventos) {
		const chave = chaveDoEvento(e);
		if (vistos.has(chave)) {
			repetidos++;
			continue;
		}
		vistos.add(chave);
		const data = e.data_inicio ?? e.data_evento ?? '1970-01-01';
		await db.insert(policialHistorico).values({
			policial_id: policialId,
			tipo: e.tipo,
			subtipo: e.subtipo ?? null,
			descricao: e.descricao || null,
			data_inicio: e.data_inicio ?? null,
			data_fim: e.data_fim ?? null,
			data_evento: e.data_evento ?? null,
			unidade_destino: e.unidade_destino ?? null,
			qtd_dias: e.data_inicio && e.data_fim ? diasInclusivos(e.data_inicio, e.data_fim) : null,
			nup: e.nup || null,
			legado: 2,
			registrado_por_nome: registradoPor,
			created_at: `${data} 00:00:00`
		});
		gravados++;
	}
	return { gravados, repetidos };
}

/** Um evento de afastamento como a planilha o descreve. */
export interface AfastamentoDaPlanilha {
	subtipo: SubtipoAfastamento;
	data_inicio: string;
	data_fim: string;
	descricao: string;
	nup: string;
}

/** Id da designação pelo nome (sem diferenciar caixa/espaços); cria se não existe. `''` → null. */
export async function idDaDesignacao(db: Database, nome: string): Promise<number | null> {
	const limpo = nome.replace(/\s+/g, ' ').trim();
	if (!limpo) return null;
	const todas = await db.select({ id: designacoes.id, nome: designacoes.nome }).from(designacoes);
	const chave = limpo.toLowerCase();
	const achada = todas.find((d) => d.nome.toLowerCase() === chave);
	if (achada) return achada.id;
	const [nova] = await db
		.insert(designacoes)
		.values({ nome: limpo })
		.returning({ id: designacoes.id });
	return nova.id;
}

/** Apaga os afastamentos legados do servidor e grava os recebidos. Devolve quantos gravou. */
export async function regravarAfastamentosLegados(
	db: Database,
	policialId: number,
	eventos: AfastamentoDaPlanilha[],
	registradoPor: string
): Promise<number> {
	await db
		.delete(policialHistorico)
		.where(and(eq(policialHistorico.policial_id, policialId), eq(policialHistorico.legado, 1)));
	for (const e of eventos) {
		await db.insert(policialHistorico).values({
			policial_id: policialId,
			tipo: 'afastamento',
			subtipo: e.subtipo,
			descricao: e.descricao || null,
			data_inicio: e.data_inicio,
			data_fim: e.data_fim,
			qtd_dias: diasInclusivos(e.data_inicio, e.data_fim),
			nup: e.nup || null,
			legado: 1,
			registrado_por_nome: registradoPor
		});
	}
	return eventos.length;
}

function diasInclusivos(inicio: string, fim: string): number | null {
	const a = Date.parse(inicio + 'T00:00:00Z');
	const b = Date.parse(fim + 'T00:00:00Z');
	if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
	return Math.round((b - a) / 86400000) + 1;
}

export type ResultadoResponsavel =
	| { acao: 'mantido' | 'gravado' | 'substituido' }
	| { acao: 'unidade_desconhecida' }
	| { acao: 'vigente_do_sistema'; vigentePolicialId: number };

/**
 * Faz do servidor o titular (origem planilha) da unidade de nome `lotacao`.
 * `hojeISO` é a data da carga: início do novo vínculo e fim do substituído.
 */
export async function regravarTitularDaPlanilha(
	db: Database,
	policialId: number,
	lotacao: string,
	hojeISO: string
): Promise<ResultadoResponsavel> {
	const unidade = await db
		.select({ id: unidades.id })
		.from(unidades)
		.where(eq(unidades.nome, lotacao.trim()))
		.get();
	if (!unidade) return { acao: 'unidade_desconhecida' };

	const vigente = await db
		.select()
		.from(unidadeResponsaveis)
		.where(
			and(eq(unidadeResponsaveis.unidade_id, unidade.id), isNull(unidadeResponsaveis.data_fim))
		)
		.get();
	if (vigente?.policial_id === policialId) return { acao: 'mantido' };
	if (vigente && vigente.origem === 'sistema') {
		return { acao: 'vigente_do_sistema', vigentePolicialId: vigente.policial_id };
	}
	if (vigente) {
		await db
			.update(unidadeResponsaveis)
			.set({ data_fim: hojeISO })
			.where(eq(unidadeResponsaveis.id, vigente.id));
	}
	await db.insert(unidadeResponsaveis).values({
		unidade_id: unidade.id,
		policial_id: policialId,
		papel: 'titular',
		data_inicio: hojeISO,
		origem: 'planilha',
		observacao: 'Titular conforme a planilha de pessoal; data de início real a confirmar.'
	});
	return { acao: vigente ? 'substituido' : 'gravado' };
}
