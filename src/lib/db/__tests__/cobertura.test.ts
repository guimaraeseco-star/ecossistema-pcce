/**
 * Cobertura territorial (fase 2, migração 0086): os municípios de uma
 * unidade com o plantão de cada período, a contagem por unidade, e as
 * inversas da tela de Municípios: a lista do departamento e a ficha.
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
import {
	municipiosPorUnidade,
	municipiosDaUnidade,
	municipiosDoDepartamento,
	fichaDoMunicipio
} from '../cobertura';
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

		const porUnidade = await municipiosPorUnidade(db);
		expect(porUnidade.get(iguatu)?.length).toBe(2);
		expect(porUnidade.get(ico)).toEqual(['2305407']);
		expect(porUnidade.get(dep)).toBeUndefined();
	});

	it('unidade sem município devolve lista vazia', async () => {
		const dep = await unidade('DPI SUL', 'departamento', null);
		expect(await municipiosDaUnidade(db, dep)).toEqual([]);
	});
});

describe('municípios do departamento (a tela /municipios)', () => {
	it('lista só os do departamento, com todas as unidades que atendem e o plantão; a ficha traz a cobertura', async () => {
		const dep = await unidade('DPI SUL', 'departamento', null);
		const outroDep = await unidade('DPI NORTE', 'departamento', null);
		const dp1 = await unidade('1ª DP de Iguatu', 'delegacia', dep);
		const dp2 = await unidade('2ª DP de Iguatu', 'delegacia', dep);
		await db.insert(municipiosCobertura).values([
			{
				ibge: '2305506',
				departamento_id: dep,
				ais: 'AIS 10',
				macrorregiao: 'CENTRO SUL',
				populacao_2022: 100000,
				area_km2: 1029.2,
				nucleo_custodia: 'IGUATU',
				risp: 'SUL',
				comando_pm: '5º CRPM'
			},
			{ ibge: '2305407', departamento_id: dep, ais: 'AIS 10', populacao_2022: 60000 },
			{ ibge: '2311355', departamento_id: outroDep, ais: 'AIS 99' }
		]);
		// Iguatu com DUAS delegacias (o caso de Juazeiro); Icó sem unidade nem plantão.
		await db.insert(unidadeMunicipios).values([
			{ unidade_id: dp1, ibge: '2305506' },
			{ unidade_id: dp2, ibge: '2305506' }
		]);
		await db
			.insert(plantaoCobertura)
			.values([
				{ ibge: '2305506', periodo: 'semana', plantonista_unidade_id: dp1, tipo: 'fisico' }
			]);

		const lista = await municipiosDoDepartamento(db, dep);
		expect(lista.map((m) => m.nome)).toEqual(['Icó', 'Iguatu']);
		const iguatu = lista[1];
		expect(iguatu.unidades.map((u) => u.nome)).toEqual(['1ª DP de Iguatu', '2ª DP de Iguatu']);
		expect(iguatu.semana?.plantonista).toBe('1ª DP de Iguatu');
		expect(iguatu.fds).toBeNull();
		expect(iguatu.populacao).toBe(100000);
		expect(lista[0].unidades).toEqual([]);
		expect(await municipiosDoDepartamento(db, outroDep)).toHaveLength(1);

		const ficha = await fichaDoMunicipio(db, '2305506');
		expect(ficha).toMatchObject({
			nome: 'Iguatu',
			departamentoId: dep,
			ais: 'AIS 10',
			macrorregiao: 'CENTRO SUL',
			areaKm2: 1029.2,
			nucleoCustodia: 'IGUATU',
			risp: 'SUL',
			comandoPm: '5º CRPM',
			batalhaoPm: ''
		});
		expect(ficha?.unidades).toHaveLength(2);
		expect(typeof ficha?.lat).toBe('number');
		// Fora da cobertura (Fortaleza): null, e é a tela que decide o 404.
		expect(await fichaDoMunicipio(db, '2304400')).toBeNull();
	});
});
