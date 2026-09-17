/**
 * A camada de férias mantém o EVENTO de afastamento em dia — é dele que a
 * situação de hoje lê. Cada operação aqui tem de deixar `policial_historico`
 * dizendo a verdade: programação = um evento por fração; sustada = evento
 * some; suspensa = evento encurta até a véspera do retorno; abono = evento
 * cobre só o gozo. Contra SQLite real, porque o que se testa são lotes e FKs.
 *
 * As férias são UM período: a programação entra inteira, a sustação alcança
 * todas as frações não iniciadas e pode redividi-las; a suspensão é a exceção.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import {
	abrirReprogramacao,
	darCienciaDoAbono,
	decidirReprogramacao,
	excluirProgramacao,
	listarFeriasDoPolicial,
	pendenciasDeFerias,
	registrarAbono,
	registrarProgramacao
} from '../ferias';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;
const POL = 7001;
const QUEM = { id: 1, nome: 'Admin Geral' };

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, data_posse)
		VALUES (${POL}, '7001', 'SERVIDOR DE FÉRIAS', 'OIP', 'DP de Aurora', 'h', '2019-03-15');
	`);
});

const eventosDeFerias = () =>
	sqlite
		.prepare(
			`SELECT data_inicio, data_fim, qtd_dias FROM policial_historico WHERE policial_id = ? AND subtipo = 'ferias' ORDER BY data_inicio`
		)
		.all(POL) as { data_inicio: string; data_fim: string; qtd_dias: number }[];

const P = (inicio: string, fim: string, dias: number) => ({ inicio, fim, dias });

describe('programação do exercício', () => {
	it('cria TODAS as frações e os eventos, ligados, num lançamento só', async () => {
		const r = await registrarProgramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				periodos: [P('2026-07-01', '2026-07-10', 10), P('2026-12-01', '2026-12-20', 20)]
			},
			QUEM
		);
		expect(r.ok).toBe(true);
		const { fracoes } = await listarFeriasDoPolicial(db, POL);
		expect(fracoes.map((f) => [f.ordem, f.status, f.historico_id != null])).toEqual([
			[1, 'programada', true],
			[2, 'programada', true]
		]);
		expect(eventosDeFerias()).toEqual([
			{ data_inicio: '2026-07-01', data_fim: '2026-07-10', qtd_dias: 10 },
			{ data_inicio: '2026-12-01', data_fim: '2026-12-20', qtd_dias: 20 }
		]);
	});

	it('recusa o exercício lançado duas vezes', async () => {
		const dados = {
			policial_id: POL,
			exercicio: 2026,
			periodos: [P('2026-07-01', '2026-07-30', 30)]
		};
		await registrarProgramacao(db, dados, QUEM);
		expect(await registrarProgramacao(db, dados, QUEM)).toEqual({
			ok: false,
			motivo: 'ja_programado'
		});
	});

	it('excluir a programação leva todos os eventos junto', async () => {
		await registrarProgramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				periodos: [P('2026-07-01', '2026-07-15', 15), P('2026-12-01', '2026-12-15', 15)]
			},
			QUEM
		);
		expect((await excluirProgramacao(db, POL, 2026)).ok).toBe(true);
		expect(eventosDeFerias()).toEqual([]);
		expect((await listarFeriasDoPolicial(db, POL)).fracoes).toEqual([]);
	});
});

describe('reprogramação', () => {
	let ids: number[];
	// 1ª de 10 (gozada em março), 2ª de 10 e 3ª de 10 ainda por vir.
	beforeEach(async () => {
		const r = await registrarProgramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				periodos: [
					P('2026-03-02', '2026-03-11', 10),
					P('2026-11-03', '2026-11-12', 10),
					P('2026-12-01', '2026-12-10', 10)
				]
			},
			QUEM
		);
		if (!r.ok) throw new Error('não criou');
		ids = r.ids;
	});

	it('pedido pendente conta como pendência; segundo pedido no exercício é recusado', async () => {
		const r = await abrirReprogramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				tipo: 'sustacao',
				fracoes_ids: [ids[1], ids[2]],
				novos_periodos: [P('2027-01-12', '2027-01-31', 20)],
				texto_oficio: 'ofício'
			},
			QUEM
		);
		expect(r.ok).toBe(true);
		expect((await pendenciasDeFerias(db, [POL])).get(POL)?.reprogramacoesPendentes).toBe(1);

		const segundo = await abrirReprogramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				tipo: 'sustacao',
				fracoes_ids: [ids[2]],
				novos_periodos: [P('2027-02-01', '2027-02-10', 10)],
				texto_oficio: 'x'
			},
			QUEM
		);
		expect(segundo).toEqual({ ok: false, motivo: 'ja_pendente' });
	});

	it('fração de outro servidor ou já fechada é recusada', async () => {
		sqlite.exec(`
			INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES (7002, '7002', 'OUTRO', 'OIP', 'DP de Aurora', 'h');
			INSERT INTO ferias_fracoes (id, policial_id, exercicio, ordem, data_inicio, data_fim) VALUES (999, 7002, 2026, 1, '2026-12-01', '2026-12-30');
		`);
		const r = await abrirReprogramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				tipo: 'sustacao',
				fracoes_ids: [ids[2], 999],
				novos_periodos: [P('2027-02-01', '2027-02-10', 10)],
				texto_oficio: 'x'
			},
			QUEM
		);
		expect(r).toEqual({ ok: false, motivo: 'fracao_fechada' });
	});

	it('SUSTAÇÃO deferida: as antigas viram sustadas, os eventos somem, as novas nascem redivididas', async () => {
		const r = await abrirReprogramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				tipo: 'sustacao',
				fracoes_ids: [ids[1], ids[2]],
				// 10 + 10 voltam como 20.
				novos_periodos: [P('2027-01-12', '2027-01-31', 20)],
				texto_oficio: 'ofício',
				nup: '08100.1/2026-00'
			},
			QUEM
		);
		if (!r.ok) throw new Error('não abriu');
		const decidida = await decidirReprogramacao(db, r.id, true, QUEM, '2026-09-20');
		expect(decidida?.status).toBe('deferida');

		const { fracoes, pedidos } = await listarFeriasDoPolicial(db, POL);
		const nova = fracoes.find((f) => f.origem === 'reprogramacao');
		expect(nova?.ordem).toBe(2); // continua de onde as sustadas começavam
		expect(nova?.status).toBe('programada');
		for (const id of [ids[1], ids[2]]) {
			const antiga = fracoes.find((f) => f.id === id);
			expect(antiga?.status).toBe('sustada');
			expect(antiga?.substituida_por_id).toBe(nova?.id);
		}
		expect(fracoes.find((f) => f.id === ids[0])?.status).toBe('programada'); // a gozada fica
		// A 1ª gozada e a nova: as de novembro e dezembro não aconteceram.
		expect(eventosDeFerias()).toEqual([
			{ data_inicio: '2026-03-02', data_fim: '2026-03-11', qtd_dias: 10 },
			{ data_inicio: '2027-01-12', data_fim: '2027-01-31', qtd_dias: 20 }
		]);
		expect(pedidos[0].status).toBe('deferida');
		expect((await pendenciasDeFerias(db, [POL])).get(POL)).toBeUndefined();
	});

	it('SUSPENSÃO deferida: o evento antigo encurta até a véspera do retorno e a nova traz só o que restava', async () => {
		// A 2ª (03 a 12/11) suspensa em 10/11: 7 gozados, 3 restam.
		const r = await abrirReprogramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				tipo: 'suspensao',
				fracao_id: ids[1],
				data_suspensao: '2026-11-10',
				novos_periodos: [P('2027-01-12', '2027-01-14', 3)],
				justificativa: 'Operação',
				texto_oficio: 'ofício'
			},
			QUEM
		);
		if (!r.ok) throw new Error('não abriu');
		await decidirReprogramacao(db, r.id, true, QUEM, '2026-11-11');
		expect(eventosDeFerias()).toEqual([
			{ data_inicio: '2026-03-02', data_fim: '2026-03-11', qtd_dias: 10 },
			{ data_inicio: '2026-11-03', data_fim: '2026-11-09', qtd_dias: 7 },
			{ data_inicio: '2026-12-01', data_fim: '2026-12-10', qtd_dias: 10 }, // a 3ª não muda
			{ data_inicio: '2027-01-12', data_fim: '2027-01-14', qtd_dias: 3 }
		]);
		const { fracoes } = await listarFeriasDoPolicial(db, POL);
		expect(fracoes.find((f) => f.id === ids[1])?.status).toBe('suspensa');
		expect(fracoes.find((f) => f.id === ids[2])?.status).toBe('programada');
	});

	it('INDEFERIDA: nada muda nas frações nem nos eventos', async () => {
		const r = await abrirReprogramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				tipo: 'sustacao',
				fracoes_ids: [ids[1], ids[2]],
				novos_periodos: [P('2027-01-12', '2027-01-31', 20)],
				texto_oficio: 'x'
			},
			QUEM
		);
		if (!r.ok) throw new Error('não abriu');
		await decidirReprogramacao(db, r.id, false, QUEM, '2026-09-20');
		const { fracoes } = await listarFeriasDoPolicial(db, POL);
		expect(fracoes.every((f) => f.status === 'programada')).toBe(true);
		expect(eventosDeFerias()).toHaveLength(3);
	});

	it('decidir duas vezes: a segunda devolve null (tranca)', async () => {
		const r = await abrirReprogramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				tipo: 'sustacao',
				fracoes_ids: [ids[2]],
				novos_periodos: [P('2027-01-12', '2027-01-21', 10)],
				texto_oficio: 'x'
			},
			QUEM
		);
		if (!r.ok) throw new Error('não abriu');
		await decidirReprogramacao(db, r.id, false, QUEM, '2026-09-20');
		expect(await decidirReprogramacao(db, r.id, true, QUEM, '2026-09-21')).toBeNull();
	});

	it('exercício com pedido não se exclui', async () => {
		await abrirReprogramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				tipo: 'sustacao',
				fracoes_ids: [ids[2]],
				novos_periodos: [P('2027-01-12', '2027-01-21', 10)],
				texto_oficio: 'x'
			},
			QUEM
		);
		expect(await excluirProgramacao(db, POL, 2026)).toEqual({ ok: false, motivo: 'tem_vinculo' });
	});
});

describe('abono', () => {
	let fracaoId: number;
	beforeEach(async () => {
		const r = await registrarProgramacao(
			db,
			{ policial_id: POL, exercicio: 2026, periodos: [P('2026-12-01', '2026-12-30', 30)] },
			QUEM
		);
		if (!r.ok) throw new Error('não criou');
		fracaoId = r.ids[0];
	});

	it('deferido: o evento passa a cobrir só o gozo, e a unidade fica com ciência pendente', async () => {
		const r = await registrarAbono(
			db,
			{
				fracao_id: fracaoId,
				policial_id: POL,
				posicao: 'finais',
				status: 'deferido',
				nup: '08100.2/2026-00',
				decidido_em: '2026-09-15'
			},
			QUEM
		);
		expect(r.ok).toBe(true);
		expect(eventosDeFerias()).toEqual([
			{ data_inicio: '2026-12-01', data_fim: '2026-12-20', qtd_dias: 20 }
		]);
		expect((await pendenciasDeFerias(db, [POL])).get(POL)?.abonosSemCiencia).toBe(1);

		if (!r.ok) return;
		expect(await darCienciaDoAbono(db, r.id, { id: 9, nome: 'Titular' }, '2026-09-16')).toBe(true);
		expect((await pendenciasDeFerias(db, [POL])).get(POL)).toBeUndefined();
	});

	it('indeferido: o evento fica inteiro e não há ciência a dar', async () => {
		await registrarAbono(
			db,
			{ fracao_id: fracaoId, policial_id: POL, posicao: 'iniciais', status: 'indeferido' },
			QUEM
		);
		expect(eventosDeFerias()).toEqual([
			{ data_inicio: '2026-12-01', data_fim: '2026-12-30', qtd_dias: 30 }
		]);
		expect((await pendenciasDeFerias(db, [POL])).get(POL)).toBeUndefined();
	});

	it('segundo abono na mesma fração é recusado; fração com abono não se susta', async () => {
		await registrarAbono(
			db,
			{ fracao_id: fracaoId, policial_id: POL, posicao: 'finais', status: 'deferido' },
			QUEM
		);
		const r = await registrarAbono(
			db,
			{ fracao_id: fracaoId, policial_id: POL, posicao: 'iniciais', status: 'deferido' },
			QUEM
		);
		expect(r).toEqual({ ok: false, motivo: 'ja_tem' });
		const s = await abrirReprogramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				tipo: 'sustacao',
				fracoes_ids: [fracaoId],
				novos_periodos: [P('2027-02-01', '2027-03-02', 30)],
				texto_oficio: 'x'
			},
			QUEM
		);
		expect(s).toEqual({ ok: false, motivo: 'tem_abono' });
	});
});
