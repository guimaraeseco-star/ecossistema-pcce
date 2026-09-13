/**
 * Efetivo por lotação (Gestão de unidade, decisão E39): contagem por cargo e
 * afastados HOJE pela mesma régua de `afastamentoVigente`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { policiais, policialHistorico } from '$lib/server/schema';
import { efetivoPorLotacao, efetivoVazio, somarEfetivos } from '../efetivo';
import { afastamentoVigente } from '../policiais/historico';

let db: Database;

async function policial(nome: string, cargo: 'DPC' | 'OIP', lotacao: string, ativo = 1) {
	const [l] = await db
		.insert(policiais)
		.values({ nome, matricula: `${Math.random()}`.slice(2, 10), cargo, lotacao, ativo, senha: 'x' })
		.returning({ id: policiais.id });
	return l.id;
}

async function afastar(policialId: number, inicio: string, fim: string | null) {
	await db.insert(policialHistorico).values({
		policial_id: policialId,
		tipo: 'afastamento',
		subtipo: 'ferias',
		data_inicio: inicio,
		data_fim: fim
	});
}

beforeEach(() => {
	db = drizzleSobre(bancoMigrado());
});

describe('efetivo por lotação', () => {
	it('conta ativos por cargo, ignora inativos e devolve só as lotações com gente', async () => {
		await policial('A', 'DPC', 'DP de Iguatu');
		await policial('B', 'OIP', 'DP de Iguatu');
		await policial('C', 'OIP', 'DP de Iguatu');
		await policial('D', 'OIP', 'DP de Iguatu', 0);
		await policial('E', 'OIP', 'DP de Icó');

		const mapa = await efetivoPorLotacao(db, '2026-09-13');
		expect(mapa.get('DP de Iguatu')).toEqual({ dpc: 1, oip: 2, total: 3, afastados: 0 });
		expect(mapa.get('DP de Icó')).toEqual({ dpc: 0, oip: 1, total: 1, afastados: 0 });
		expect(mapa.get('DP de Crato')).toBeUndefined();
	});

	it('afastado hoje = afastamento aberto ou que cobre a data; encerrado e futuro não contam', async () => {
		const a = await policial('A', 'OIP', 'DP de Iguatu');
		const b = await policial('B', 'OIP', 'DP de Iguatu');
		const c = await policial('C', 'OIP', 'DP de Iguatu');
		const d = await policial('D', 'OIP', 'DP de Iguatu');
		await afastar(a, '2026-09-01', '2026-09-30'); // cobre hoje
		await afastar(b, '2026-09-10', null); // aberto
		await afastar(c, '2026-08-01', '2026-08-31'); // encerrado
		await afastar(d, '2026-10-01', '2026-10-15'); // futuro
		await afastar(a, '2026-09-05', '2026-09-20'); // segundo evento do MESMO servidor: conta um

		const hoje = '2026-09-13';
		const mapa = await efetivoPorLotacao(db, hoje);
		expect(mapa.get('DP de Iguatu')?.afastados).toBe(2);
		expect(mapa.get('DP de Iguatu')?.total).toBe(4);

		// A mesma régua que a ficha do servidor usa em memória.
		const regra = (inicio: string, fim: string | null) =>
			afastamentoVigente(
				[
					{ tipo: 'afastamento', data_inicio: inicio, data_fim: fim } as Parameters<
						typeof afastamentoVigente
					>[0][number]
				],
				hoje
			) !== null;
		expect(regra('2026-09-01', '2026-09-30')).toBe(true);
		expect(regra('2026-09-10', null)).toBe(true);
		expect(regra('2026-08-01', '2026-08-31')).toBe(false);
		expect(regra('2026-10-01', '2026-10-15')).toBe(false);
	});

	it('afastamento de servidor inativo não conta', async () => {
		const a = await policial('A', 'OIP', 'DP de Iguatu', 0);
		await afastar(a, '2026-09-01', null);
		await policial('B', 'OIP', 'DP de Iguatu');
		expect((await efetivoPorLotacao(db, '2026-09-13')).get('DP de Iguatu')).toEqual({
			dpc: 0,
			oip: 1,
			total: 1,
			afastados: 0
		});
	});

	it('soma efetivos eixo a eixo', () => {
		expect(
			somarEfetivos([
				{ dpc: 1, oip: 2, total: 3, afastados: 1 },
				{ dpc: 0, oip: 5, total: 5, afastados: 0 },
				efetivoVazio()
			])
		).toEqual({ dpc: 1, oip: 7, total: 8, afastados: 1 });
	});
});
