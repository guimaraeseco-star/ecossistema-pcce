/**
 * A camada de férias mantém o EVENTO de afastamento em dia — é dele que a
 * situação de hoje lê. Cada operação aqui tem de deixar `policial_historico`
 * dizendo a verdade: fração programada = evento; sustada = evento some;
 * suspensa = evento encurta até a véspera do retorno; abono = evento cobre só
 * o gozo. Contra SQLite real, porque o que se testa são lotes e FKs.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import {
	abrirReprogramacao,
	darCienciaDoAbono,
	decidirReprogramacao,
	excluirFracao,
	listarFeriasDoPolicial,
	pendenciasDeFerias,
	registrarAbono,
	registrarFracao
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

describe('fração programada', () => {
	it('cria a fração E o evento de afastamento, ligados', async () => {
		const r = await registrarFracao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				ordem: 1,
				data_inicio: '2026-07-01',
				data_fim: '2026-07-15'
			},
			QUEM
		);
		expect(r.ok).toBe(true);
		const [f] = await listarFeriasDoPolicial(db, POL);
		expect(f.status).toBe('programada');
		expect(f.historico_id).not.toBeNull();
		expect(eventosDeFerias()).toEqual([
			{ data_inicio: '2026-07-01', data_fim: '2026-07-15', qtd_dias: 15 }
		]);
	});

	it('recusa a mesma ordem digitada duas vezes', async () => {
		const dados = {
			policial_id: POL,
			exercicio: 2026,
			ordem: 1 as const,
			data_inicio: '2026-07-01',
			data_fim: '2026-07-15'
		};
		await registrarFracao(db, dados, QUEM);
		const r = await registrarFracao(db, dados, QUEM);
		expect(r).toEqual({ ok: false, motivo: 'duplicada' });
	});

	it('excluir a fração leva o evento junto', async () => {
		const r = await registrarFracao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				ordem: 1,
				data_inicio: '2026-07-01',
				data_fim: '2026-07-15'
			},
			QUEM
		);
		if (!r.ok) throw new Error('não criou');
		expect((await excluirFracao(db, r.id)).ok).toBe(true);
		expect(eventosDeFerias()).toEqual([]);
		expect(await listarFeriasDoPolicial(db, POL)).toEqual([]);
	});
});

describe('reprogramação', () => {
	let fracaoId: number;
	beforeEach(async () => {
		const r = await registrarFracao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				ordem: 2,
				data_inicio: '2026-12-01',
				data_fim: '2026-12-15'
			},
			QUEM
		);
		if (!r.ok) throw new Error('não criou');
		fracaoId = r.id;
	});

	it('pedido pendente conta como pendência; segundo pedido é recusado', async () => {
		const r = await abrirReprogramacao(
			db,
			{
				fracao_id: fracaoId,
				policial_id: POL,
				tipo: 'sustacao',
				novo_inicio: '2027-01-12',
				novo_fim: '2027-01-26',
				texto_oficio: 'ofício'
			},
			QUEM
		);
		expect(r.ok).toBe(true);
		const pend = await pendenciasDeFerias(db, [POL]);
		expect(pend.get(POL)?.reprogramacoesPendentes).toBe(1);

		const segundo = await abrirReprogramacao(
			db,
			{
				fracao_id: fracaoId,
				policial_id: POL,
				tipo: 'sustacao',
				novo_inicio: '2027-02-01',
				novo_fim: '2027-02-15',
				texto_oficio: 'x'
			},
			QUEM
		);
		expect(segundo).toEqual({ ok: false, motivo: 'ja_pendente' });
	});

	it('SUSTAÇÃO deferida: a antiga vira sustada, o evento dela some, a nova nasce com evento', async () => {
		const r = await abrirReprogramacao(
			db,
			{
				fracao_id: fracaoId,
				policial_id: POL,
				tipo: 'sustacao',
				novo_inicio: '2027-01-12',
				novo_fim: '2027-01-26',
				texto_oficio: 'ofício',
				nup: '08100.1/2026-00'
			},
			QUEM
		);
		if (!r.ok) throw new Error('não abriu');
		const decidida = await decidirReprogramacao(db, r.id, true, QUEM, '2026-11-20');
		expect(decidida?.status).toBe('deferida');

		const fracoes = await listarFeriasDoPolicial(db, POL);
		const antiga = fracoes.find((f) => f.id === fracaoId);
		const nova = fracoes.find((f) => f.id !== fracaoId);
		expect(antiga?.status).toBe('sustada');
		expect(antiga?.substituida_por_id).toBe(nova?.id);
		expect(nova?.status).toBe('programada');
		expect(nova?.origem).toBe('reprogramacao');
		// Só o evento novo: as férias de dezembro não aconteceram.
		expect(eventosDeFerias()).toEqual([
			{ data_inicio: '2027-01-12', data_fim: '2027-01-26', qtd_dias: 15 }
		]);
		// A pendência sumiu.
		expect((await pendenciasDeFerias(db, [POL])).get(POL)).toBeUndefined();
	});

	it('SUSPENSÃO deferida: o evento antigo encurta até a véspera do retorno', async () => {
		const r = await abrirReprogramacao(
			db,
			{
				fracao_id: fracaoId,
				policial_id: POL,
				tipo: 'suspensao',
				novo_inicio: '2027-01-12',
				novo_fim: '2027-01-19',
				data_suspensao: '2026-12-09',
				justificativa: 'Operação',
				texto_oficio: 'ofício'
			},
			QUEM
		);
		if (!r.ok) throw new Error('não abriu');
		await decidirReprogramacao(db, r.id, true, QUEM, '2026-12-10');
		expect(eventosDeFerias()).toEqual([
			{ data_inicio: '2026-12-01', data_fim: '2026-12-08', qtd_dias: 8 },
			{ data_inicio: '2027-01-12', data_fim: '2027-01-19', qtd_dias: 8 }
		]);
	});

	it('INDEFERIDA: nada muda na fração nem no evento', async () => {
		const r = await abrirReprogramacao(
			db,
			{
				fracao_id: fracaoId,
				policial_id: POL,
				tipo: 'sustacao',
				novo_inicio: '2027-01-12',
				novo_fim: '2027-01-26',
				texto_oficio: 'x'
			},
			QUEM
		);
		if (!r.ok) throw new Error('não abriu');
		await decidirReprogramacao(db, r.id, false, QUEM, '2026-11-20');
		const [f] = await listarFeriasDoPolicial(db, POL);
		expect(f.status).toBe('programada');
		expect(eventosDeFerias()).toEqual([
			{ data_inicio: '2026-12-01', data_fim: '2026-12-15', qtd_dias: 15 }
		]);
	});

	it('decidir duas vezes: a segunda devolve null (tranca)', async () => {
		const r = await abrirReprogramacao(
			db,
			{
				fracao_id: fracaoId,
				policial_id: POL,
				tipo: 'sustacao',
				novo_inicio: '2027-01-12',
				novo_fim: '2027-01-26',
				texto_oficio: 'x'
			},
			QUEM
		);
		if (!r.ok) throw new Error('não abriu');
		await decidirReprogramacao(db, r.id, false, QUEM, '2026-11-20');
		expect(await decidirReprogramacao(db, r.id, true, QUEM, '2026-11-21')).toBeNull();
	});
});

describe('abono', () => {
	let fracaoId: number;
	beforeEach(async () => {
		const r = await registrarFracao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				ordem: 1,
				data_inicio: '2026-12-01',
				data_fim: '2026-12-30'
			},
			QUEM
		);
		if (!r.ok) throw new Error('não criou');
		fracaoId = r.id;
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

	it('segundo abono na mesma fração é recusado', async () => {
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
	});
});
