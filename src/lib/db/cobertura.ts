/**
 * Cobertura territorial — os municípios atendidos e o plantão de cada um
 * (fase 2, migração 0086; decisões E32 e E39). Lê `municipios_cobertura`,
 * `unidade_municipios` e `plantao_cobertura`, sempre cruzando com
 * `municipios` (a lista-mãe do IBGE) para o nome.
 *
 * Duas perguntas que a Gestão de unidade faz: "quais municípios esta unidade
 * atende, e quem faz o plantão em cada um?" (a ficha) e "quantos municípios
 * cada unidade atende?" (a lista). E as duas inversas, da tela de Municípios
 * (`/municipios`, fase 2-B): "que municípios o departamento cobre, e quem
 * atende cada um?" (`municipiosDoDepartamento`) e "tudo sobre este
 * município" (`fichaDoMunicipio`).
 *
 * Só leitura por enquanto: a carga é do script
 * `scripts/importar-delegacias-municipios.mjs`, e edição pela tela entra com o
 * módulo Municípios (Admin Geral, sem proposta — E6).
 */
import { asc, eq, inArray } from 'drizzle-orm';
import {
	municipios,
	municipiosCobertura,
	plantaoCobertura,
	unidadeMunicipios,
	unidades
} from '../server/schema';
import type { Database } from './core';

import type { TipoPlantao } from '$lib/unidades/plantao';

/** Quem faz o plantão num período. */
interface PlantaoDoMunicipio {
	tipo: TipoPlantao;
	plantonistaId: number | null;
	plantonista: string;
}

/** Uma unidade que atende um município — nome e id, para o link. */
interface UnidadeAtendente {
	id: number;
	nome: string;
}

/** Um município na lista do departamento: quem atende, AIS e plantão. */
export interface MunicipioCoberto {
	ibge: string;
	nome: string;
	ais: string;
	macrorregiao: string;
	/** A estimativa do IBGE quando já foi baixada, senão o Censo 2022. */
	populacao: number | null;
	/** De onde veio `populacao`: "estimativa 2026" ou "Censo 2022". */
	populacaoFonte: string;
	/** Mais de uma quando duas DPs dividem a sede (Juazeiro do Norte). */
	unidades: UnidadeAtendente[];
	semana: PlantaoDoMunicipio | null;
	fds: PlantaoDoMunicipio | null;
}

/** A ficha completa de um município: cobertura (0086) mais quem atende e o plantão. */
export interface FichaMunicipio extends MunicipioCoberto {
	departamentoId: number;
	populacaoCenso: number | null;
	populacaoAtualizadaEm: string | null;
	areaKm2: number | null;
	nucleoCustodia: string;
	risp: string;
	comandoPm: string;
	batalhaoPm: string;
	batalhaoBm: string;
	companhiaBm: string;
	pefoce: string;
	lat: number;
	lon: number;
}

/** Um município atendido por uma unidade, como a ficha mostra. */
export interface MunicipioDaUnidade {
	ibge: string;
	nome: string;
	ais: string;
	/** Estimativa do IBGE quando baixada, senão Censo 2022; `null` sem dado. */
	populacao: number | null;
	semana: PlantaoDoMunicipio | null;
	fds: PlantaoDoMunicipio | null;
}

/** O plantão (semana e fim de semana) de uma lista de municípios, indexado por IBGE. */
async function plantoesDe(
	db: Database,
	ibges: string[]
): Promise<Map<string, { semana: PlantaoDoMunicipio | null; fds: PlantaoDoMunicipio | null }>> {
	const mapa = new Map<
		string,
		{ semana: PlantaoDoMunicipio | null; fds: PlantaoDoMunicipio | null }
	>();
	if (ibges.length === 0) return mapa;
	const linhas = await db
		.select({
			ibge: plantaoCobertura.ibge,
			periodo: plantaoCobertura.periodo,
			tipo: plantaoCobertura.tipo,
			plantonistaId: plantaoCobertura.plantonista_unidade_id,
			plantonista: unidades.nome
		})
		.from(plantaoCobertura)
		.leftJoin(unidades, eq(unidades.id, plantaoCobertura.plantonista_unidade_id))
		.where(inArray(plantaoCobertura.ibge, ibges));
	for (const l of linhas) {
		const e = mapa.get(l.ibge) ?? { semana: null, fds: null };
		e[l.periodo] = {
			tipo: l.tipo,
			plantonistaId: l.plantonistaId,
			plantonista: l.plantonista ?? ''
		};
		mapa.set(l.ibge, e);
	}
	return mapa;
}

/** Os municípios que a unidade atende, em ordem alfabética, com o plantão de cada um. */
export async function municipiosDaUnidade(
	db: Database,
	unidadeId: number
): Promise<MunicipioDaUnidade[]> {
	const linhas = await db
		.select({
			ibge: municipios.ibge,
			nome: municipios.nome,
			ais: municipiosCobertura.ais,
			censo: municipiosCobertura.populacao_2022,
			estimada: municipiosCobertura.populacao_estimada
		})
		.from(unidadeMunicipios)
		.innerJoin(municipios, eq(municipios.ibge, unidadeMunicipios.ibge))
		.leftJoin(municipiosCobertura, eq(municipiosCobertura.ibge, unidadeMunicipios.ibge))
		.where(eq(unidadeMunicipios.unidade_id, unidadeId))
		.orderBy(asc(municipios.nome));
	const plantoes = await plantoesDe(
		db,
		linhas.map((l) => l.ibge)
	);
	return linhas.map((l) => ({
		ibge: l.ibge,
		nome: l.nome,
		ais: l.ais ?? '',
		populacao: l.estimada ?? l.censo ?? null,
		semana: plantoes.get(l.ibge)?.semana ?? null,
		fds: plantoes.get(l.ibge)?.fds ?? null
	}));
}

/**
 * Os IBGEs que cada unidade atende — para a coluna da lista e para somar por
 * subárvore SEM repetir (Juazeiro do Norte tem duas DPs: contado uma vez no
 * total da seccional e do departamento). Unidade sem município não aparece.
 */
export async function municipiosPorUnidade(db: Database): Promise<Map<number, string[]>> {
	const linhas = await db
		.select({ unidadeId: unidadeMunicipios.unidade_id, ibge: unidadeMunicipios.ibge })
		.from(unidadeMunicipios);
	const mapa = new Map<number, string[]>();
	for (const l of linhas) {
		const lista = mapa.get(l.unidadeId) ?? [];
		lista.push(l.ibge);
		mapa.set(l.unidadeId, lista);
	}
	return mapa;
}

/** As unidades que atendem cada município de uma lista, indexadas por IBGE. */
async function atendentesDe(
	db: Database,
	ibges: string[]
): Promise<Map<string, UnidadeAtendente[]>> {
	const mapa = new Map<string, UnidadeAtendente[]>();
	if (ibges.length === 0) return mapa;
	const linhas = await db
		.select({ ibge: unidadeMunicipios.ibge, id: unidades.id, nome: unidades.nome })
		.from(unidadeMunicipios)
		.innerJoin(unidades, eq(unidades.id, unidadeMunicipios.unidade_id))
		.where(inArray(unidadeMunicipios.ibge, ibges))
		.orderBy(asc(unidades.nome));
	for (const l of linhas) {
		const lista = mapa.get(l.ibge) ?? [];
		lista.push({ id: l.id, nome: l.nome });
		mapa.set(l.ibge, lista);
	}
	return mapa;
}

/**
 * Os municípios cobertos por um departamento (`municipios_cobertura.departamento_id`),
 * em ordem alfabética, cada um com quem o atende e o plantão. É a lista de
 * `/municipios`; o recorte por departamento é o que impede um Admin Geral de
 * ver o mapa de outro.
 */
export async function municipiosDoDepartamento(
	db: Database,
	departamentoId: number
): Promise<MunicipioCoberto[]> {
	const linhas = await db
		.select({
			ibge: municipios.ibge,
			nome: municipios.nome,
			ais: municipiosCobertura.ais,
			macrorregiao: municipiosCobertura.macrorregiao,
			censo: municipiosCobertura.populacao_2022,
			estimada: municipiosCobertura.populacao_estimada,
			ano: municipiosCobertura.populacao_ano
		})
		.from(municipiosCobertura)
		.innerJoin(municipios, eq(municipios.ibge, municipiosCobertura.ibge))
		.where(eq(municipiosCobertura.departamento_id, departamentoId))
		.orderBy(asc(municipios.nome));
	const ibges = linhas.map((l) => l.ibge);
	const [plantoes, atendentes] = await Promise.all([
		plantoesDe(db, ibges),
		atendentesDe(db, ibges)
	]);
	return linhas.map((l) => ({
		ibge: l.ibge,
		nome: l.nome,
		ais: l.ais,
		macrorregiao: l.macrorregiao,
		...populacaoDe(l),
		unidades: atendentes.get(l.ibge) ?? [],
		semana: plantoes.get(l.ibge)?.semana ?? null,
		fds: plantoes.get(l.ibge)?.fds ?? null
	}));
}

/** A ficha de um município coberto, ou `null` quando o IBGE não está em `municipios_cobertura`. */
export async function fichaDoMunicipio(db: Database, ibge: string): Promise<FichaMunicipio | null> {
	const l = await db
		.select({
			ibge: municipios.ibge,
			nome: municipios.nome,
			lat: municipios.lat,
			lon: municipios.lon,
			departamentoId: municipiosCobertura.departamento_id,
			ais: municipiosCobertura.ais,
			macrorregiao: municipiosCobertura.macrorregiao,
			censo: municipiosCobertura.populacao_2022,
			estimada: municipiosCobertura.populacao_estimada,
			ano: municipiosCobertura.populacao_ano,
			populacaoAtualizadaEm: municipiosCobertura.populacao_atualizada_em,
			areaKm2: municipiosCobertura.area_km2,
			nucleoCustodia: municipiosCobertura.nucleo_custodia,
			risp: municipiosCobertura.risp,
			comandoPm: municipiosCobertura.comando_pm,
			batalhaoPm: municipiosCobertura.batalhao_pm,
			batalhaoBm: municipiosCobertura.batalhao_bm,
			companhiaBm: municipiosCobertura.companhia_bm,
			pefoce: municipiosCobertura.pefoce
		})
		.from(municipiosCobertura)
		.innerJoin(municipios, eq(municipios.ibge, municipiosCobertura.ibge))
		.where(eq(municipiosCobertura.ibge, ibge))
		.get();
	if (!l) return null;
	const [plantoes, atendentes] = await Promise.all([
		plantoesDe(db, [ibge]),
		atendentesDe(db, [ibge])
	]);
	const { censo, estimada, ano, ...resto } = l;
	return {
		...resto,
		...populacaoDe({ censo, estimada, ano }),
		populacaoCenso: censo,
		unidades: atendentes.get(ibge) ?? [],
		semana: plantoes.get(ibge)?.semana ?? null,
		fds: plantoes.get(ibge)?.fds ?? null
	};
}

/** A população a mostrar e de onde veio — estimativa do IBGE quando baixada, senão Censo 2022. */
function populacaoDe(l: { censo: number | null; estimada: number | null; ano: number | null }) {
	if (l.estimada != null)
		return { populacao: l.estimada, populacaoFonte: `estimativa ${l.ano ?? ''}`.trim() };
	return { populacao: l.censo, populacaoFonte: l.censo != null ? 'Censo 2022' : '' };
}

/**
 * A população de cada município coberto, por IBGE — para a Gestão de unidade
 * somar a população atendida por unidade e por subárvore (sem repetir
 * Juazeiro, como os municípios). Mesma escolha de fonte de `populacaoDe`.
 */
export async function populacaoPorIbge(db: Database): Promise<Map<string, number>> {
	const linhas = await db
		.select({
			ibge: municipiosCobertura.ibge,
			censo: municipiosCobertura.populacao_2022,
			estimada: municipiosCobertura.populacao_estimada
		})
		.from(municipiosCobertura);
	const mapa = new Map<string, number>();
	for (const l of linhas) {
		const p = l.estimada ?? l.censo;
		if (p != null) mapa.set(l.ibge, p);
	}
	return mapa;
}
