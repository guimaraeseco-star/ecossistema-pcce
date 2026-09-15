/**
 * Efetivo por lotação (Gestão de unidade, decisão E39): por cargo, quantos
 * estão ativos, de férias e afastados HOJE — pela mesma régua de
 * `afastamentoVigente`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { policiais, policialHistorico } from '$lib/server/schema';
import {
	afastamentosVigentesDe,
	efetivoPorLotacao,
	efetivoVazio,
	servidoresPorSituacao,
	situacaoDe,
	somarEfetivos
} from '../efetivo';
import { afastamentoVigente } from '../policiais/historico';

let db: Database;

async function policial(nome: string, cargo: 'DPC' | 'OIP', lotacao: string, ativo = 1) {
	const [l] = await db
		.insert(policiais)
		.values({ nome, matricula: `${Math.random()}`.slice(2, 10), cargo, lotacao, ativo, senha: 'x' })
		.returning({ id: policiais.id });
	return l.id;
}

async function afastar(
	policialId: number,
	inicio: string,
	fim: string | null,
	subtipo: 'ferias' | 'licenca_medica' | 'judicial' | 'licenca_outros' | 'outros' = 'ferias'
) {
	await db.insert(policialHistorico).values({
		policial_id: policialId,
		tipo: 'afastamento',
		subtipo,
		data_inicio: inicio,
		data_fim: fim
	});
}

beforeEach(() => {
	db = drizzleSobre(bancoMigrado());
});

describe('efetivo por lotação', () => {
	it('conta lotados por cargo, ignora inativos e devolve só as lotações com gente', async () => {
		await policial('A', 'DPC', 'DP de Iguatu');
		await policial('B', 'OIP', 'DP de Iguatu');
		await policial('C', 'OIP', 'DP de Iguatu');
		await policial('D', 'OIP', 'DP de Iguatu', 0);
		await policial('E', 'OIP', 'DP de Icó');

		const mapa = await efetivoPorLotacao(db, '2026-09-13');
		expect(mapa.get('DP de Iguatu')).toEqual({
			dpc: { ativos: 1, ferias: 0, afastados: 0, total: 1 },
			oip: { ativos: 2, ferias: 0, afastados: 0, total: 2 },
			total: 3
		});
		expect(mapa.get('DP de Icó')?.oip.ativos).toBe(1);
		expect(mapa.get('DP de Crato')).toBeUndefined();
	});

	it('férias e afastamento por outro motivo saem dos ativos, por cargo; encerrado e futuro não contam', async () => {
		const hoje = '2026-09-13';
		const a = await policial('A', 'DPC', 'DP de Iguatu');
		const b = await policial('B', 'OIP', 'DP de Iguatu');
		const c = await policial('C', 'OIP', 'DP de Iguatu');
		const d = await policial('D', 'OIP', 'DP de Iguatu');
		const e = await policial('E', 'OIP', 'DP de Iguatu');
		await afastar(a, '2026-09-01', '2026-09-30', 'ferias'); // DPC de férias
		await afastar(b, '2026-09-10', null, 'licenca_medica'); // OIP afastado (aberto)
		await afastar(c, '2026-08-01', '2026-08-31', 'ferias'); // encerrado: ativo
		await afastar(d, '2026-10-01', '2026-10-15', 'ferias'); // futuro: ativo
		// férias E licença ao mesmo tempo: conta UMA vez, como afastado
		await afastar(e, '2026-09-05', '2026-09-20', 'ferias');
		await afastar(e, '2026-09-10', '2026-09-25', 'judicial');

		const iguatu = (await efetivoPorLotacao(db, hoje)).get('DP de Iguatu')!;
		expect(iguatu.dpc).toEqual({ ativos: 0, ferias: 1, afastados: 0, total: 1 });
		expect(iguatu.oip).toEqual({ ativos: 2, ferias: 0, afastados: 2, total: 4 });
		expect(iguatu.total).toBe(5);

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
			dpc: { ativos: 0, ferias: 0, afastados: 0, total: 0 },
			oip: { ativos: 1, ferias: 0, afastados: 0, total: 1 },
			total: 1
		});
	});

	it('soma efetivos eixo a eixo', () => {
		expect(
			somarEfetivos([
				{
					dpc: { ativos: 1, ferias: 0, afastados: 0, total: 1 },
					oip: { ativos: 1, ferias: 1, afastados: 0, total: 2 },
					total: 3
				},
				{
					dpc: { ativos: 0, ferias: 0, afastados: 0, total: 0 },
					oip: { ativos: 4, ferias: 0, afastados: 1, total: 5 },
					total: 5
				},
				efetivoVazio()
			])
		).toEqual({
			dpc: { ativos: 1, ferias: 0, afastados: 0, total: 1 },
			oip: { ativos: 5, ferias: 1, afastados: 1, total: 7 },
			total: 8
		});
	});
});

describe('situação de hoje por servidor (fase 2-C)', () => {
	it('lista por situação e cargo; licença prevalece sobre férias; férias em dourado é só rótulo', async () => {
		const hoje = '2026-09-15';
		const a = await policial('A', 'DPC', 'DP de Iguatu');
		const b = await policial('B', 'OIP', 'DP de Iguatu');
		const c = await policial('C', 'OIP', 'DP de Iguatu');
		await policial('D', 'OIP', 'DP de Icó');
		await afastar(a, '2026-09-08', '2026-09-17', 'ferias');
		await afastar(b, '2026-09-01', null, 'licenca_medica');
		await afastar(c, '2026-09-10', '2026-09-20', 'ferias');
		await afastar(c, '2026-09-12', '2026-09-13', 'judicial'); // encerrado: não conta

		const vig = await afastamentosVigentesDe(db, [a, b, c], hoje);
		expect(situacaoDe(vig.get(a))).toBe('ferias');
		expect(situacaoDe(vig.get(b))).toBe('afastado');
		expect(vig.get(b)?.data_fim).toBeNull();
		expect(situacaoDe(vig.get(c))).toBe('ferias');
		expect(situacaoDe(undefined)).toBe('ativo');

		const ferias = await servidoresPorSituacao(db, ['DP de Iguatu', 'DP de Icó'], hoje, {
			situacao: 'ferias'
		});
		expect(ferias.map((s) => s.nome)).toEqual(['A', 'C']);
		expect(ferias[0].afastamento).toMatchObject({ subtipo: 'ferias', data_fim: '2026-09-17' });
		const ativosOip = await servidoresPorSituacao(db, ['DP de Iguatu', 'DP de Icó'], hoje, {
			situacao: 'ativos',
			cargo: 'OIP'
		});
		expect(ativosOip.map((s) => s.nome)).toEqual(['D']);
		expect(await servidoresPorSituacao(db, [], hoje)).toEqual([]);
	});
});
