/**
 * As três exceções ao append-only do histórico (decisão de 20/09): o retorno
 * antecipado encurta; o Admin Geral corrige e exclui. E, nas férias, o
 * Admin Geral corrige uma fração intacta e apaga um exercício com vínculos.
 * Contra SQLite real, porque o que se testa são as escritas e os lotes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import {
	corrigirAfastamento,
	encurtarAfastamento,
	excluirAfastamento,
	registrarHistorico
} from '../historico';
import {
	abrirReprogramacao,
	corrigirFracao,
	excluirProgramacao,
	listarFeriasDoPolicial,
	registrarAbono,
	registrarProgramacao
} from '../ferias';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;
const POL = 7101;
const QUEM = { id: 1, nome: 'Admin Geral' };

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, data_posse)
		VALUES (${POL}, '7101', 'SERVIDOR CORRIGIDO', 'OIP', 'DP de Aurora', 'h', '2019-03-15');
	`);
});

const evento = (id: number) =>
	sqlite
		.prepare(
			`SELECT data_inicio, data_fim, qtd_dias, descricao FROM policial_historico WHERE id = ?`
		)
		.get(id) as
		{ data_inicio: string; data_fim: string; qtd_dias: number; descricao: string } | undefined;

async function lts(inicio = '2026-10-01', fim: string | null = '2026-10-30') {
	const r = await registrarHistorico(db, {
		policial_id: POL,
		tipo: 'afastamento',
		subtipo: 'lts',
		data_inicio: inicio,
		data_fim: fim,
		qtd_dias: fim ? 30 : null,
		descricao: 'LTS'
	});
	return r;
}

describe('retorno antecipado', () => {
	it('encurta até a véspera do retorno e anota o NUP; fora do período não cabe', async () => {
		const id = await lts();
		const r = await encurtarAfastamento(db, id, '2026-10-11', '10051.028034/2026-64');
		expect(r?.data_fim).toBe('2026-10-10');
		expect(evento(id)).toMatchObject({
			data_fim: '2026-10-10',
			qtd_dias: 10,
			descricao: 'LTS — Retorno antecipado em 2026-10-11 (NUP 10051.028034/2026-64)'
		});
		expect(await encurtarAfastamento(db, id, '2026-10-01', '')).toBeNull(); // no 1º dia
		expect(await encurtarAfastamento(db, id, '2026-12-01', '')).toBeNull(); // depois do fim
	});

	it('afastamento em aberto aceita qualquer retorno depois do início', async () => {
		const id = await lts('2026-10-01', null);
		expect((await encurtarAfastamento(db, id, '2027-03-01', ''))?.data_fim).toBe('2027-02-28');
	});

	it('férias não passam por aqui', async () => {
		const r = await registrarHistorico(db, {
			policial_id: POL,
			tipo: 'afastamento',
			subtipo: 'ferias',
			data_inicio: '2026-10-01',
			data_fim: '2026-10-10'
		});
		expect(await encurtarAfastamento(db, r, '2026-10-05', '')).toBeNull();
	});
});

describe('corrigir e excluir (Admin Geral)', () => {
	it('corrigir devolve o antes e grava o depois', async () => {
		const id = await lts();
		const antes = await corrigirAfastamento(db, id, {
			subtipo: 'acompanhamento_familiar',
			descricao: null,
			data_inicio: '2026-10-05',
			data_fim: '2026-10-14',
			qtd_dias: 10,
			nup: null,
			tipo_cid: null
		});
		expect(antes?.subtipo).toBe('lts');
		expect(evento(id)).toMatchObject({
			data_inicio: '2026-10-05',
			data_fim: '2026-10-14',
			qtd_dias: 10
		});
	});

	it('excluir some com o evento', async () => {
		const id = await lts();
		expect((await excluirAfastamento(db, id))?.subtipo).toBe('lts');
		expect(evento(id)).toBeUndefined();
	});
});

describe('férias: corrigir a fração e excluir o exercício com vínculos', () => {
	it('corrigir move a fração e o evento dela; com abono ou pedido, não', async () => {
		const r = await registrarProgramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				periodos: [
					{ inicio: '2026-11-03', fim: '2026-11-12', dias: 10 },
					{ inicio: '2026-12-01', fim: '2026-12-20', dias: 20 }
				]
			},
			QUEM
		);
		if (!r.ok) throw new Error('não criou');
		const c = await corrigirFracao(db, r.ids[0], {
			data_inicio: '2026-11-09',
			data_fim: '2026-11-18'
		});
		expect(c.ok).toBe(true);
		const { fracoes } = await listarFeriasDoPolicial(db, POL);
		const f = fracoes.find((x) => x.id === r.ids[0]);
		expect(f?.data_inicio).toBe('2026-11-09');
		expect(evento(f!.historico_id!)).toMatchObject({
			data_inicio: '2026-11-09',
			data_fim: '2026-11-18',
			qtd_dias: 10
		});

		await registrarAbono(
			db,
			{ fracao_id: r.ids[1], policial_id: POL, posicao: 'finais', status: 'deferido' },
			QUEM
		);
		expect(
			await corrigirFracao(db, r.ids[1], { data_inicio: '2026-12-02', data_fim: '2026-12-21' })
		).toEqual({
			ok: false,
			motivo: 'tem_vinculo'
		});
	});

	it('excluir forçado apaga frações, pedido, abono e eventos; sem forçar, recusa', async () => {
		const r = await registrarProgramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				periodos: [
					{ inicio: '2026-11-03', fim: '2026-11-12', dias: 10 },
					{ inicio: '2026-12-01', fim: '2026-12-20', dias: 20 }
				]
			},
			QUEM
		);
		if (!r.ok) throw new Error('não criou');
		await registrarAbono(
			db,
			{ fracao_id: r.ids[0], policial_id: POL, posicao: 'finais', status: 'deferido' },
			QUEM
		);
		await abrirReprogramacao(
			db,
			{
				policial_id: POL,
				exercicio: 2026,
				tipo: 'sustacao',
				fracoes_ids: [r.ids[1]],
				novos_periodos: [{ inicio: '2027-02-01', fim: '2027-02-20', dias: 20 }],
				texto_oficio: 'x'
			},
			QUEM
		);
		expect(await excluirProgramacao(db, POL, 2026)).toEqual({ ok: false, motivo: 'tem_vinculo' });
		expect(await excluirProgramacao(db, POL, 2026, true)).toEqual({ ok: true, apagadas: 2 });
		const { fracoes, pedidos } = await listarFeriasDoPolicial(db, POL);
		expect(fracoes).toEqual([]);
		expect(pedidos).toEqual([]);
		expect(
			sqlite.prepare(`SELECT COUNT(*) n FROM policial_historico WHERE policial_id = ?`).get(POL)
		).toEqual({ n: 0 });
		expect(
			sqlite.prepare(`SELECT COUNT(*) n FROM ferias_abonos WHERE policial_id = ?`).get(POL)
		).toEqual({ n: 0 });
	});
});
