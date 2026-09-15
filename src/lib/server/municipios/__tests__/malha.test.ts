/**
 * A malha dos municípios: normalização da resposta do IBGE, cache no R2 e
 * recusa do que não é malha — tudo com R2 e fetch falsos.
 */
import { describe, it, expect } from 'vitest';
import { CHAVE_MALHA_CE, malhaDoCeara, normalizarMalha } from '../malha';

const feature = (codarea: string, extra: Record<string, unknown> = {}) => ({
	type: 'Feature',
	properties: { codarea, ...extra },
	geometry: {
		type: 'Polygon',
		coordinates: [
			[
				[-39, -6],
				[-38, -6],
				[-38, -5],
				[-39, -6]
			]
		]
	}
});
const RESPOSTA = { type: 'FeatureCollection', features: [feature('2305506', { lixo: 1 })] };

function r2Falso() {
	const guardado = new Map<string, string>();
	return {
		guardado,
		get: async (k: string) => (guardado.has(k) ? { text: async () => guardado.get(k)! } : null),
		put: async (k: string, v: string) => {
			guardado.set(k, v);
		}
	};
}

describe('normalizarMalha', () => {
	it('mantém só ibge e geometria; recusa o que não é malha de municípios', () => {
		const m = normalizarMalha(RESPOSTA)!;
		expect(m.features).toHaveLength(1);
		expect(m.features[0].properties).toEqual({ ibge: '2305506' });
		expect(normalizarMalha({ type: 'FeatureCollection', features: [] })).toBeNull();
		expect(normalizarMalha({ type: 'FeatureCollection', features: [feature('x')] })).toBeNull();
		expect(normalizarMalha({ erro: 'nada' })).toBeNull();
	});
});

describe('malhaDoCeara', () => {
	it('baixa do IBGE uma vez e depois serve do R2', async () => {
		const r2 = r2Falso();
		let chamadas = 0;
		const fetchFn = async () => {
			chamadas++;
			return { ok: true, status: 200, json: async () => RESPOSTA };
		};
		const a = await malhaDoCeara(r2, fetchFn);
		const b = await malhaDoCeara(r2, fetchFn);
		expect(chamadas).toBe(1);
		expect(a).toBe(b);
		expect(r2.guardado.has(CHAVE_MALHA_CE)).toBe(true);
		expect(JSON.parse(a).features[0].properties.ibge).toBe('2305506');
	});

	it('IBGE fora do ar ou resposta estranha: erro, e nada vai para o R2', async () => {
		const r2 = r2Falso();
		await expect(
			malhaDoCeara(r2, async () => ({ ok: false, status: 502, json: async () => null }))
		).rejects.toThrow(/502/);
		await expect(
			malhaDoCeara(r2, async () => ({ ok: true, status: 200, json: async () => ({ x: 1 }) }))
		).rejects.toThrow(/não é a malha/);
		expect(r2.guardado.size).toBe(0);
	});
});
