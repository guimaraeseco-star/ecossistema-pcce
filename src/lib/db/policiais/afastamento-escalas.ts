/**
 * Afastamento × escalas (decisão do responsável, 20/09/2026): quem está
 * afastado — férias em gozo ou qualquer outro afastamento — não entra em
 * escala naquela data, ordinária ou extra (GISE); e um afastamento que cai
 * sobre datas em que o servidor JÁ está escalado deixa a escala DESFALCADA,
 * o que o sistema avisa (sem desescalar sozinho).
 *
 * A fonte do "está afastado" é a linha do tempo (`policial_historico`,
 * eventos de afastamento; o de férias já vem reduzido ao gozo, então os dias
 * vendidos não bloqueiam). Um afastamento sem `data_fim` é aberto.
 *
 * Duas direções, duas famílias de função:
 *   - ESCALAR: `afastamentosNasDatas` (um servidor, várias datas) e
 *     `afastadosNoPeriodo` (vários servidores, um período) — o que as actions
 *     de composição conferem antes de gravar;
 *   - AVISAR: `escalasDoServidorNoPeriodo` (onde ele já está escalado dentro
 *     do afastamento novo) e `desfalquesDaEscala`/`desfalquesDaGise` (quem, na
 *     escala aberta, está afastado hoje) — o que as telas mostram.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
	escalaPoliciais,
	escalas,
	giseEscalas,
	giseEquipes,
	giseMembros,
	giseSeccionais,
	operacoes,
	policiais,
	policialHistorico,
	unidades
} from '../../server/schema';
import type { Database } from '../core';
import { descreverAfastamento } from '$lib/servidores/afastamento-descricao';
export { descreverAfastamento };

/** Um afastamento como a regra o lê: período e o que é. */
export interface AfastamentoVigente {
	id: number;
	subtipo: string;
	data_inicio: string;
	data_fim: string | null;
}

const FATIA_D1 = 90;

/** O afastamento cobre a data? */
function cobre(a: AfastamentoVigente, dataISO: string): boolean {
	return a.data_inicio <= dataISO && (!a.data_fim || dataISO <= a.data_fim);
}

/** Os afastamentos de UM servidor que cobrem cada uma das datas dadas. */
export async function afastamentosNasDatas(
	db: Database,
	policialId: number,
	datas: readonly string[]
): Promise<Map<string, AfastamentoVigente>> {
	const mapa = new Map<string, AfastamentoVigente>();
	if (datas.length === 0) return mapa;
	const min = [...datas].sort()[0];
	const max = [...datas].sort().at(-1)!;
	const eventos = await db
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
				eq(policialHistorico.tipo, 'afastamento'),
				sql`${policialHistorico.data_inicio} <= ${max}`,
				or(isNull(policialHistorico.data_fim), sql`${policialHistorico.data_fim} >= ${min}`)
			)
		);
	const lista = eventos
		.filter((e): e is typeof e & { data_inicio: string } => !!e.data_inicio)
		.map((e) => ({ ...e, subtipo: e.subtipo ?? 'outros', data_fim: e.data_fim || null }));
	for (const d of datas) {
		const a = lista.find((e) => cobre(e, d));
		if (a) mapa.set(d, a);
	}
	return mapa;
}

/**
 * Os servidores, entre os dados, com afastamento que toca o período — para
 * "adicionar todos" a uma escala deixar de fora quem não pode ir.
 */
export async function afastadosNoPeriodo(
	db: Database,
	policialIds: readonly number[],
	inicio: string,
	fim: string
): Promise<Map<number, AfastamentoVigente>> {
	const mapa = new Map<number, AfastamentoVigente>();
	for (let i = 0; i < policialIds.length; i += FATIA_D1) {
		const fatia = policialIds.slice(i, i + FATIA_D1);
		if (fatia.length === 0) continue;
		const linhas = await db
			.select({
				policial_id: policialHistorico.policial_id,
				id: policialHistorico.id,
				subtipo: policialHistorico.subtipo,
				data_inicio: policialHistorico.data_inicio,
				data_fim: policialHistorico.data_fim
			})
			.from(policialHistorico)
			.where(
				and(
					inArray(policialHistorico.policial_id, fatia),
					eq(policialHistorico.tipo, 'afastamento'),
					sql`${policialHistorico.data_inicio} <= ${fim}`,
					or(isNull(policialHistorico.data_fim), sql`${policialHistorico.data_fim} >= ${inicio}`)
				)
			);
		for (const l of linhas) {
			if (!l.data_inicio || mapa.has(l.policial_id)) continue;
			mapa.set(l.policial_id, {
				id: l.id,
				subtipo: l.subtipo ?? 'outros',
				data_inicio: l.data_inicio,
				data_fim: l.data_fim || null
			});
		}
	}
	return mapa;
}

/** Uma escala em que o servidor está, dentro de um período — o que fica desfalcado. */
export interface EscalaDoServidor {
	tipo: 'ordinaria' | 'gise';
	id: number;
	titulo: string;
	/** A data escalada (plantão, dia da GISE) ou o início da escala de expediente. */
	data: string;
	/** A unidade dona da escala — quem recebe o aviso. */
	lotacao: string | null;
	link: string;
}

/**
 * Onde o servidor JÁ está escalado entre `inicio` e `fim` (aberto = sem
 * fim): plantões e expedientes da escala ordinária, e as GISEs de que é
 * membro. É a lista do aviso "escala desfalcada".
 */
export async function escalasDoServidorNoPeriodo(
	db: Database,
	policialId: number,
	inicio: string,
	fim: string | null
): Promise<EscalaDoServidor[]> {
	const teto = fim ?? '9999-12-31';
	const [ordinarias, gises] = await Promise.all([
		db
			.select({
				id: escalas.id,
				titulo: escalas.titulo,
				lotacao: escalas.lotacao,
				tipo: escalas.tipo,
				data_inicio: escalas.data_inicio,
				data_fim: escalas.data_fim,
				data_plantao: escalaPoliciais.data_plantao
			})
			.from(escalaPoliciais)
			.innerJoin(escalas, eq(escalas.id, escalaPoliciais.escala_id))
			.where(
				and(
					eq(escalaPoliciais.policial_id, policialId),
					sql`${escalas.data_inicio} <= ${teto}`,
					sql`${escalas.data_fim} >= ${inicio}`
				)
			),
		db
			.select({
				id: giseEscalas.id,
				data_inicio: giseEscalas.data_inicio,
				operacao: operacoes.nome,
				lotacao: unidades.nome
			})
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseEquipes.id, giseMembros.equipe_id))
			.innerJoin(giseSeccionais, eq(giseSeccionais.id, giseEquipes.gise_seccional_id))
			.innerJoin(giseEscalas, eq(giseEscalas.id, giseSeccionais.gise_id))
			.leftJoin(unidades, eq(unidades.id, giseSeccionais.seccional_id))
			.leftJoin(operacoes, eq(operacoes.id, giseEscalas.operacao_id))
			.where(
				and(
					eq(giseMembros.policial_id, policialId),
					sql`${giseEscalas.data_inicio} >= ${inicio}`,
					sql`${giseEscalas.data_inicio} <= ${teto}`
				)
			)
	]);
	const vistas = new Set<string>();
	const lista: EscalaDoServidor[] = [];
	for (const o of ordinarias) {
		// Plantão: só o dia escalado conta. Expediente: o período inteiro.
		const data = o.data_plantao ?? o.data_inicio;
		if (o.data_plantao && (o.data_plantao < inicio || o.data_plantao > teto)) continue;
		const chave = `o${o.id}|${data}`;
		if (vistas.has(chave)) continue;
		vistas.add(chave);
		lista.push({
			tipo: 'ordinaria',
			id: o.id,
			titulo: o.titulo,
			data,
			lotacao: o.lotacao,
			link: `/escalas/${o.id}`
		});
	}
	for (const g of gises) {
		const chave = `g${g.id}`;
		if (vistas.has(chave)) continue;
		vistas.add(chave);
		lista.push({
			tipo: 'gise',
			id: g.id,
			titulo: g.operacao ? `GISE ${g.operacao}` : `GISE ${g.data_inicio}`,
			data: g.data_inicio,
			lotacao: g.lotacao ?? null,
			link: `/operacoes/gise/${g.id}`
		});
	}
	return lista.sort((a, b) => a.data.localeCompare(b.data));
}

/** Quem, numa escala, está afastado na data escalada — a faixa "desfalcada". */
export interface Desfalque {
	policial_id: number;
	nome: string;
	data: string;
	afastamento: AfastamentoVigente;
}

/** Os desfalques de uma escala ordinária: por linha de plantão (ou o período, no expediente). */
export async function desfalquesDaEscala(db: Database, escalaId: number): Promise<Desfalque[]> {
	const escala = await db.select().from(escalas).where(eq(escalas.id, escalaId)).get();
	if (!escala) return [];
	const linhas = await db
		.select({
			policial_id: escalaPoliciais.policial_id,
			nome: policiais.nome,
			data_plantao: escalaPoliciais.data_plantao
		})
		.from(escalaPoliciais)
		.innerJoin(policiais, eq(policiais.id, escalaPoliciais.policial_id))
		.where(eq(escalaPoliciais.escala_id, escalaId));
	if (linhas.length === 0) return [];
	const ids = [...new Set(linhas.map((l) => l.policial_id))];
	const afastados = await afastadosNoPeriodo(db, ids, escala.data_inicio, escala.data_fim);
	const out: Desfalque[] = [];
	const vistos = new Set<string>();
	for (const l of linhas) {
		const a = afastados.get(l.policial_id);
		if (!a) continue;
		const data = l.data_plantao ?? escala.data_inicio;
		// Plantão: só conta se o afastamento cobre o dia; expediente: se toca o período.
		if (l.data_plantao && !cobre(a, l.data_plantao)) continue;
		const chave = `${l.policial_id}|${data}`;
		if (vistos.has(chave)) continue;
		vistos.add(chave);
		out.push({ policial_id: l.policial_id, nome: l.nome, data, afastamento: a });
	}
	return out.sort((x, y) => x.data.localeCompare(y.data) || x.nome.localeCompare(y.nome));
}

/** Os desfalques de uma GISE: membros afastados no dia dela. */
export async function desfalquesDaGise(db: Database, giseId: number): Promise<Desfalque[]> {
	const gise = await db
		.select({ data_inicio: giseEscalas.data_inicio })
		.from(giseEscalas)
		.where(eq(giseEscalas.id, giseId))
		.get();
	if (!gise) return [];
	const membros = await db
		.select({ policial_id: giseMembros.policial_id, nome: policiais.nome })
		.from(giseMembros)
		.innerJoin(policiais, eq(policiais.id, giseMembros.policial_id))
		.where(eq(giseMembros.gise_id, giseId));
	if (membros.length === 0) return [];
	const afastados = await afastadosNoPeriodo(
		db,
		membros.map((m) => m.policial_id),
		gise.data_inicio,
		gise.data_inicio
	);
	return membros
		.filter((m) => afastados.has(m.policial_id))
		.map((m) => ({
			policial_id: m.policial_id,
			nome: m.nome,
			data: gise.data_inicio,
			afastamento: afastados.get(m.policial_id)!
		}));
}
