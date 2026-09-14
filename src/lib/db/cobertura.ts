/**
 * Cobertura territorial — os municípios atendidos e o plantão de cada um
 * (fase 2, migração 0086; decisões E32 e E39). Lê `municipios_cobertura`,
 * `unidade_municipios` e `plantao_cobertura`, sempre cruzando com
 * `municipios` (a lista-mãe do IBGE) para o nome.
 *
 * Duas perguntas que a Gestão de unidade faz: "quais municípios esta unidade
 * atende, e quem faz o plantão em cada um?" (a ficha) e "quantos municípios
 * cada unidade atende?" (a lista). A tela de Municípios (a inversa: "quem
 * atende este município?") entra no PR seguinte, neste mesmo arquivo.
 *
 * Só leitura por enquanto: a carga é do script
 * `scripts/importar-delegacias-municipios.mjs`, e edição pela tela entra com o
 * módulo Municípios (Admin Geral, sem proposta — E6).
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';
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

/** Um município atendido por uma unidade, como a ficha mostra. */
export interface MunicipioDaUnidade {
	ibge: string;
	nome: string;
	ais: string;
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
			ais: municipiosCobertura.ais
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
		semana: plantoes.get(l.ibge)?.semana ?? null,
		fds: plantoes.get(l.ibge)?.fds ?? null
	}));
}

/** Quantos municípios cada unidade atende — para a coluna da lista. Unidade sem município não aparece. */
export async function contagemMunicipiosPorUnidade(db: Database): Promise<Map<number, number>> {
	const linhas = await db
		.select({ unidadeId: unidadeMunicipios.unidade_id, n: sql<number>`count(*)` })
		.from(unidadeMunicipios)
		.groupBy(unidadeMunicipios.unidade_id);
	return new Map(linhas.map((l) => [l.unidadeId, Number(l.n)]));
}
