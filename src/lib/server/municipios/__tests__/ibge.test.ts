/**
 * População pelo IBGE: o parse da resposta de agregados (forma real, recortada
 * de set/2026) e a gravação na cobertura com `fetch` injetado.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { municipiosCobertura, unidades } from '$lib/server/schema';
import { atualizarPopulacaoIbge, lerPopulacaoAgregado, urlsPopulacaoIbge } from '../ibge';

const serie = (id: string, serie: Record<string, string>) => ({
	localidade: { id, nivel: { id: 'N6', nome: 'Município' }, nome: 'x' },
	serie
});
const RESPOSTA_CENSO = [
	{
		id: '93',
		variavel: 'População residente',
		unidade: 'Pessoas',
		resultados: [
			{
				classificacoes: [],
				series: [serie('2305506', { '2022': '98064' }), serie('2307304', { '2022': '286120' })]
			}
		]
	}
];
const RESPOSTA_ESTIMATIVA = [
	{
		id: '9324',
		variavel: 'População residente estimada',
		unidade: 'Pessoas',
		resultados: [
			{
				classificacoes: [],
				series: [
					serie('2305506', { '2026': '102907' }),
					// sem dado publicado: ignorado
					serie('2307304', { '2026': '-' }),
					// fora da cobertura: baixado, não gravado
					serie('2304400', { '2026': '2500000' })
				]
			}
		]
	}
];

let db: Database;
beforeEach(() => {
	db = drizzleSobre(bancoMigrado());
});

describe('lerPopulacaoAgregado', () => {
	it('lê o último ano numérico de cada município e ignora "-"', () => {
		const m = lerPopulacaoAgregado(RESPOSTA_ESTIMATIVA);
		expect(m.get('2305506')).toEqual({ valor: 102907, ano: 2026 });
		expect(m.has('2307304')).toBe(false);
		expect(lerPopulacaoAgregado({ nada: 1 }).size).toBe(0);
	});

	it('as URLs pedem a UF inteira nas duas tabelas', () => {
		const u = urlsPopulacaoIbge('23');
		expect(u.censo).toContain('/4714/periodos/2022/variaveis/93?localidades=N6[N3[23]]');
		expect(u.estimativa).toContain('/6579/periodos/-1/variaveis/9324?');
	});
});

describe('atualizarPopulacaoIbge', () => {
	it('grava Censo e estimativa só nos municípios da cobertura', async () => {
		const [dep] = await db
			.insert(unidades)
			.values({ nome: 'DPI SUL', tipo: 'departamento' })
			.returning({ id: unidades.id });
		await db.insert(municipiosCobertura).values([
			{ ibge: '2305506', departamento_id: dep.id, populacao_2022: 97733 },
			{ ibge: '2307304', departamento_id: dep.id, populacao_2022: 269435 },
			{ ibge: '2305407', departamento_id: dep.id }
		]);
		const fetchFn = async (url: string) => ({
			ok: true,
			status: 200,
			json: async () => (url.includes('/4714/') ? RESPOSTA_CENSO : RESPOSTA_ESTIMATIVA)
		});

		const r = await atualizarPopulacaoIbge(db, fetchFn, '2026-09-16T10:00:00');
		expect(r).toEqual({ atualizados: 2, semDado: 1, anoEstimativa: 2026 });

		const linhas = await db.select().from(municipiosCobertura);
		const de = (ibge: string) => linhas.find((l) => l.ibge === ibge)!;
		expect(de('2305506')).toMatchObject({
			populacao_2022: 98064,
			populacao_estimada: 102907,
			populacao_ano: 2026,
			populacao_atualizada_em: '2026-09-16T10:00:00'
		});
		// Censo veio, estimativa não: só o Censo muda.
		expect(de('2307304')).toMatchObject({ populacao_2022: 286120, populacao_estimada: null });
		expect(de('2305407').populacao_atualizada_em).toBeNull();
	});

	it('resposta não-2xx vira erro, sem gravar nada', async () => {
		const fetchFn = async () => ({ ok: false, status: 503, json: async () => null });
		await expect(atualizarPopulacaoIbge(db, fetchFn, '2026-09-16')).rejects.toThrow(/503/);
	});
});
