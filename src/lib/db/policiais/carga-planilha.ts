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
 * - **Afastamentos da planilha `afastamentos.xlsx`** (`legado = 3`, a fonte
 *   mais organizada): manda no que for o MESMO afastamento — período que se
 *   sobrepõe — apagando o evento equivalente do histórico (`legado = 2`) e
 *   o da planilha de servidores (`legado = 1`), que é o mesmo fato com datas
 *   menos conferidas. A
 *   supressão nunca cruza férias com não-férias: um atestado não apaga férias.
 *   A ordem das cargas não importa: a regravação do histórico também pula o
 *   que sobrepõe um `legado = 3` já presente.
 * - **Responsável pela unidade** (`Delegado Titular`, `Delegado Seccional`,
 *   `Diretor de Departamento` → titular da própria lotação): a carga só mexe
 *   no que tem `origem = 'planilha'`. Vigente da mesma pessoa fica como está
 *   (preserva o início da primeira carga); vigente de outra pessoa vindo da
 *   planilha é encerrado hoje e substituído; vigente cadastrado pela tela
 *   (`origem = 'sistema'`) vence e a carga só relata.
 */
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { periodosSeSobrepoem } from '$lib/servidores/afastamentos-planilha';
import { designacoes, policialHistorico, unidadeResponsaveis, unidades } from '../../server/schema';
import type { Database } from '../core';
import type { SubtipoAfastamento } from '$lib/servidores/afastamentos';

/** Um INSERT montado e ainda NÃO executado — o builder do drizzle é thenable. */
type InsertPendente = ReturnType<ReturnType<Database['insert']>['values']>;

/**
 * Quantos statements vão num `db.batch`. O limite que importa não é o do D1 e
 * sim o do WORKER: cada query é uma subrequisição, e um servidor com quarenta
 * eventos de histórico gastava quarenta delas — quatro servidores por
 * requisição estouravam o tempo e o Cloudflare devolvia 503 com corpo vazio
 * (carga de produção de 16/09/2026, que travou com a base já em 3,7 mil
 * eventos). Em lote, os mesmos quarenta INSERTs viram UMA ida ao banco.
 */
const STATEMENTS_POR_LOTE = 50;

/**
 * Executa os INSERTs acumulados em lotes, e não um a um.
 *
 * `db.batch` exige builders PRONTOS — `await db.insert(...)` já teria executado
 * a query, que é justamente o que se quer evitar aqui (a mesma armadilha
 * descrita em `camposDeAtualizacao`). Lista vazia não vai ao banco: `batch([])`
 * é erro no D1.
 */
async function gravarEmLote(db: Database, inserts: InsertPendente[]): Promise<void> {
	for (let i = 0; i < inserts.length; i += STATEMENTS_POR_LOTE) {
		const fatia = inserts.slice(i, i + STATEMENTS_POR_LOTE);
		if (fatia.length > 0) await db.batch(fatia as [InsertPendente, ...InsertPendente[]]);
	}
}

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

/**
 * O evento do HISTÓRICO é o mesmo afastamento que um da planilha de
 * afastamentos? Período sobreposto, e nunca cruzando férias com outro motivo
 * (o atestado de março não apaga as férias de março).
 */
function mesmoAfastamento(
	a: { subtipo?: string | null; data_inicio?: string | null; data_fim?: string | null },
	b: { subtipo?: string | null; data_inicio?: string | null; data_fim?: string | null }
): boolean {
	if (!a.data_inicio || !b.data_inicio) return false;
	const feriasA = a.subtipo === 'ferias';
	const feriasB = b.subtipo === 'ferias';
	if (feriasA !== feriasB) return false;
	return periodosSeSobrepoem(
		{ inicio: a.data_inicio, fim: a.data_fim },
		{ inicio: b.data_inicio, fim: b.data_fim }
	);
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
			descricao: policialHistorico.descricao,
			legado: policialHistorico.legado
		})
		.from(policialHistorico)
		.where(eq(policialHistorico.policial_id, policialId));
	const vistos = new Set(existentes.map(chaveDoEvento));
	// Os afastamentos da planilha dedicada mandam: o histórico não regrava o
	// que eles já cobrem, independentemente da ordem das cargas.
	const daPlanilha = existentes.filter((x) => x.legado === 3 && x.tipo === 'afastamento');
	// Os INSERTs são MONTADOS no laço e executados de uma vez: ver `gravarEmLote`.
	const inserts: InsertPendente[] = [];
	let gravados = 0;
	let repetidos = 0;
	for (const e of eventos) {
		const chave = chaveDoEvento(e);
		if (vistos.has(chave)) {
			repetidos++;
			continue;
		}
		if (e.tipo === 'afastamento' && daPlanilha.some((x) => mesmoAfastamento(x, e))) {
			repetidos++;
			continue;
		}
		vistos.add(chave);
		const data = e.data_inicio ?? e.data_evento ?? '1970-01-01';
		inserts.push(
			db.insert(policialHistorico).values({
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
			})
		);
		gravados++;
	}
	await gravarEmLote(db, inserts);
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
	// A planilha de afastamentos manda no mesmo fato: não se regrava o que ela
	// já cobre, e a ordem das cargas deixa de importar.
	const daPlanilhaDeAfastamentos = await db
		.select({
			subtipo: policialHistorico.subtipo,
			data_inicio: policialHistorico.data_inicio,
			data_fim: policialHistorico.data_fim
		})
		.from(policialHistorico)
		.where(
			and(
				eq(policialHistorico.policial_id, policialId),
				eq(policialHistorico.legado, 3),
				eq(policialHistorico.tipo, 'afastamento')
			)
		);
	const inserts: InsertPendente[] = [];
	let gravados = 0;
	for (const e of eventos) {
		if (daPlanilhaDeAfastamentos.some((x) => mesmoAfastamento(x, e))) continue;
		inserts.push(
			db.insert(policialHistorico).values({
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
			})
		);
		gravados++;
	}
	await gravarEmLote(db, inserts);
	return gravados;
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

/**
 * Regrava os afastamentos da planilha `afastamentos.xlsx` (`legado = 3`) e
 * apaga do histórico (`legado = 2`) o que for o MESMO afastamento — decisão do
 * responsável em 16/09/2026: onde as duas fontes falam do mesmo fato, vale
 * esta, que tem datas, tipo e NUP conferidos.
 *
 * Não toca no que a tela registrou (`legado = 0`) nem no evento vigente da
 * planilha de servidores (`legado = 1`): a operação e a folha do dia mandam
 * no presente; esta planilha manda no que já passou.
 */
export async function regravarAfastamentosDaPlanilha(
	db: Database,
	policialId: number,
	eventos: EventoDoHistorico[],
	registradoPor: string
): Promise<{ gravados: number; suprimidosDoHistorico: number }> {
	await db
		.delete(policialHistorico)
		.where(and(eq(policialHistorico.policial_id, policialId), eq(policialHistorico.legado, 3)));
	const inserts: InsertPendente[] = [];
	for (const e of eventos) {
		const data = e.data_inicio ?? e.data_evento ?? '1970-01-01';
		inserts.push(
			db.insert(policialHistorico).values({
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
				legado: 3,
				registrado_por_nome: registradoPor,
				created_at: `${data} 00:00:00`
			})
		);
	}
	await gravarEmLote(db, inserts);

	const afastamentos = eventos.filter((e) => e.tipo === 'afastamento' && e.data_inicio);
	if (afastamentos.length === 0) return { gravados: eventos.length, suprimidosDoHistorico: 0 };
	const doHistorico = await db
		.select({
			id: policialHistorico.id,
			subtipo: policialHistorico.subtipo,
			data_inicio: policialHistorico.data_inicio,
			data_fim: policialHistorico.data_fim
		})
		.from(policialHistorico)
		.where(
			and(
				eq(policialHistorico.policial_id, policialId),
				inArray(policialHistorico.legado, [1, 2]),
				eq(policialHistorico.tipo, 'afastamento')
			)
		);
	const aApagar = doHistorico
		.filter((h) => afastamentos.some((e) => mesmoAfastamento(h, e)))
		.map((h) => h.id);
	if (aApagar.length > 0) {
		await db.delete(policialHistorico).where(inArray(policialHistorico.id, aApagar));
	}
	return { gravados: eventos.length, suprimidosDoHistorico: aApagar.length };
}
