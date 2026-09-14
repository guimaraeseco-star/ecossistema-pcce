/**
 * Cobertura territorial (fase 2, migração 0086): os municípios de uma
 * unidade com o plantão de cada período, e a contagem por unidade.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import {
	municipiosCobertura,
	plantaoCobertura,
	unidadeMunicipios,
	unidades
} from '$lib/server/schema';
import { contagemMunicipiosPorUnidade, municipiosDaUnidade } from '../cobertura';
import { rotuloTipoPlantao } from '$lib/unidades/plantao';

let db: Database;

async function unidade(nome: string, tipo: 'departamento' | 'delegacia', pai: number | null) {
	const [l] = await db
		.insert(unidades)
		.values({ nome, tipo, seccional_id: pai })
		.returning({ id: unidades.id });
	return l.id;
}

// `municipios` já vem semeada pelas migrações (os 184 do Ceará + o Brasil):
// Iguatu 2305506, Quixelô 2311355, Icó 2305407.
beforeEach(() => {
	db = drizzleSobre(bancoMigrado());
});

describe('municípios de uma unidade', () => {
	it('lista em ordem alfabética, com AIS do município e o plantão de cada período', async () => {
		const dep = await unidade('DPI SUL', 'departamento', null);
		const iguatu = await unidade('DP de Iguatu', 'delegacia', dep);
		const ico = await unidade('DP de Icó', 'delegacia', dep);
		await db.insert(municipiosCobertura).values([
			{ ibge: '2305506', departamento_id: dep, ais: 'AIS 10' },
			{ ibge: '2311355', departamento_id: dep, ais: 'AIS 10' },
			{ ibge: '2305407', departamento_id: dep, ais: 'AIS 10' }
		]);
		await db.insert(unidadeMunicipios).values([
			{ unidade_id: iguatu, ibge: '2311355' },
			{ unidade_id: iguatu, ibge: '2305506' },
			{ unidade_id: ico, ibge: '2305407' }
		]);
		await db.insert(plantaoCobertura).values([
			{ ibge: '2305506', periodo: 'semana', plantonista_unidade_id: iguatu, tipo: 'fisico' },
			{ ibge: '2305506', periodo: 'fds', plantonista_unidade_id: iguatu, tipo: 'fisico' },
			// Icó: semana com Iguatu, fim de semana com a própria DP — o caso real.
			{ ibge: '2305407', periodo: 'semana', plantonista_unidade_id: iguatu, tipo: 'fisico_misto' },
			{ ibge: '2305407', periodo: 'fds', plantonista_unidade_id: ico, tipo: 'fisico' }
		]);

		const deIguatu = await municipiosDaUnidade(db, iguatu);
		expect(deIguatu.map((m) => m.nome)).toEqual(['Iguatu', 'Quixelô']);
		expect(deIguatu[0].ais).toBe('AIS 10');
		expect(deIguatu[0].semana?.plantonista).toBe('DP de Iguatu');
		// Quixelô sem plantão cadastrado: nulo, não erro.
		expect(deIguatu[1].semana).toBeNull();

		const deIco = await municipiosDaUnidade(db, ico);
		expect(deIco).toHaveLength(1);
		expect(deIco[0].semana?.plantonista).toBe('DP de Iguatu');
		expect(deIco[0].fds?.plantonista).toBe('DP de Icó');
		expect(rotuloTipoPlantao(deIco[0].semana!.tipo)).toBe('Físico misto');

		const contagem = await contagemMunicipiosPorUnidade(db);
		expect(contagem.get(iguatu)).toBe(2);
		expect(contagem.get(ico)).toBe(1);
		expect(contagem.get(dep)).toBeUndefined();
	});

	it('unidade sem município devolve lista vazia', async () => {
		const dep = await unidade('DPI SUL', 'departamento', null);
		expect(await municipiosDaUnidade(db, dep)).toEqual([]);
	});
});
