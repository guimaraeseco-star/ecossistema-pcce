/**
 * O recorte de `listarTodasRespostasGise` por OPERAÇÃO e por UNIDADE, contra
 * SQLite real.
 *
 * Não é teste de agregação: é o filtro que impede o admin de uma delegacia de
 * ver a produtividade de outra em `/operacoes/produtividade`. Um `WHERE` que some devolve
 * TUDO, e essa falha é silenciosa — a tela não fica quebrada, fica ampla demais.
 *
 * O caso mais importante aqui é o do escopo VAZIO: "nenhuma unidade permitida"
 * tem de devolver zero linhas, nunca todas.
 *
 * Também fixa a precedência da unidade de uma equipe (slot → unidade
 * operacional → seccional), que é a mesma cadeia usada pelo formulário para
 * decidir de quem é a linha de base.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import type { DatabaseSync } from 'node:sqlite';
import { listarTodasRespostasGise } from '../respostas';
import type { Database } from '../../core';

let sqlite: DatabaseSync;
let db: Database;
let opA: number;
let opB: number;
let seccional: number;
let slotCrato: number;
let unidadeOperacional: number;

/** Insere e devolve o id da última linha. */
function ultimoId(): number {
	return Number((sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
}

function novaUnidade(nome: string, tipo = 'delegacia'): number {
	sqlite.prepare('INSERT INTO unidades (nome, tipo) VALUES (?, ?)').run(nome, tipo);
	return ultimoId();
}

/**
 * Uma escala com uma seccional, uma equipe e uma resposta. `slotUnidadeId` e
 * `unidadeOperacionalId` controlam por qual nível da precedência a equipe
 * resolve a unidade.
 */
function respostaEm(opts: {
	operacaoId: number;
	seccionalId: number;
	unidadeOperacionalId?: number | null;
	slotUnidadeId?: number | null;
	policialId: number;
	valor: number;
}) {
	sqlite
		.prepare('INSERT INTO gise_escalas (data_inicio, operacao_id) VALUES (?, ?)')
		.run('2026-08-15', opts.operacaoId);
	const giseId = ultimoId();

	sqlite
		.prepare(
			'INSERT INTO gise_seccionais (gise_id, seccional_id, unidade_operacional_id) VALUES (?, ?, ?)'
		)
		.run(giseId, opts.seccionalId, opts.unidadeOperacionalId ?? null);
	const secId = ultimoId();

	let slotId: number | null = null;
	if (opts.slotUnidadeId) {
		sqlite
			.prepare('INSERT INTO gise_seccional_unidades (gise_seccional_id, unidade_id) VALUES (?, ?)')
			.run(secId, opts.slotUnidadeId);
		slotId = ultimoId();
	}

	sqlite
		.prepare('INSERT INTO gise_equipes (gise_seccional_id, gise_unidade_id, tipo) VALUES (?, ?, ?)')
		.run(secId, slotId, 'operacional');
	const equipeId = ultimoId();

	sqlite
		.prepare(
			'INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES (?, ?, ?, ?, ?, ?)'
		)
		.run(opts.policialId, `M${opts.policialId}`, `Policial ${opts.policialId}`, 'OIP', '', 'x');

	sqlite
		.prepare(
			'INSERT INTO gise_respostas_formulario (gise_id, policial_id, equipe_id, respostas) VALUES (?, ?, ?, ?)'
		)
		.run(giseId, opts.policialId, equipeId, JSON.stringify({ acervo: opts.valor }));
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);

	opA = Number(
		(sqlite.prepare(`SELECT id FROM operacoes WHERE nome = 'GISE'`).get() as { id: number }).id
	);
	opB = Number(
		(
			sqlite.prepare(`SELECT id FROM operacoes WHERE nome = 'OPERAÇÃO CRAJUBAR'`).get() as {
				id: number;
			}
		).id
	);

	seccional = novaUnidade('2ª SECCIONAL', 'seccional');
	slotCrato = novaUnidade('DELEGACIA DO CRATO');
	unidadeOperacional = novaUnidade('NÚCLEO OPERACIONAL');
});

describe('filtro por operação', () => {
	it('devolve só as respostas da operação pedida', async () => {
		respostaEm({ operacaoId: opA, seccionalId: seccional, policialId: 1, valor: 10 });
		respostaEm({ operacaoId: opB, seccionalId: seccional, policialId: 2, valor: 20 });

		const r = await listarTodasRespostasGise(db, { operacaoId: opB });
		expect(r.total).toBe(1);
		expect(JSON.parse(r.respostas[0].respostas).acervo).toBe(20);
		expect(r.respostas[0].operacao_id).toBe(opB);
	});

	it('sem filtro de operação, devolve todas', async () => {
		respostaEm({ operacaoId: opA, seccionalId: seccional, policialId: 1, valor: 10 });
		respostaEm({ operacaoId: opB, seccionalId: seccional, policialId: 2, valor: 20 });

		expect((await listarTodasRespostasGise(db)).total).toBe(2);
	});
});

describe('unidade da equipe (precedência)', () => {
	it('o SLOT ganha da unidade operacional e da seccional', async () => {
		respostaEm({
			operacaoId: opA,
			seccionalId: seccional,
			unidadeOperacionalId: unidadeOperacional,
			slotUnidadeId: slotCrato,
			policialId: 1,
			valor: 10
		});

		const r = await listarTodasRespostasGise(db);
		expect(r.respostas[0].unidade_id).toBe(slotCrato);
	});

	it('sem slot, cai na unidade operacional da seccional', async () => {
		respostaEm({
			operacaoId: opA,
			seccionalId: seccional,
			unidadeOperacionalId: unidadeOperacional,
			policialId: 1,
			valor: 10
		});

		expect((await listarTodasRespostasGise(db)).respostas[0].unidade_id).toBe(unidadeOperacional);
	});

	it('sem slot nem unidade operacional, cai na própria seccional', async () => {
		respostaEm({ operacaoId: opA, seccionalId: seccional, policialId: 1, valor: 10 });

		expect((await listarTodasRespostasGise(db)).respostas[0].unidade_id).toBe(seccional);
	});
});

describe('escopo por unidade', () => {
	beforeEach(() => {
		// Crato entra por slot; o Núcleo Operacional, pela unidade operacional.
		respostaEm({
			operacaoId: opA,
			seccionalId: seccional,
			slotUnidadeId: slotCrato,
			policialId: 1,
			valor: 10
		});
		respostaEm({
			operacaoId: opA,
			seccionalId: seccional,
			unidadeOperacionalId: unidadeOperacional,
			policialId: 2,
			valor: 20
		});
	});

	it('recorta às unidades permitidas', async () => {
		const r = await listarTodasRespostasGise(db, { unidadeIds: [slotCrato] });
		expect(r.total).toBe(1);
		expect(r.respostas[0].unidade_id).toBe(slotCrato);
	});

	it('aceita mais de uma unidade', async () => {
		const r = await listarTodasRespostasGise(db, {
			unidadeIds: [slotCrato, unidadeOperacional]
		});
		expect(r.total).toBe(2);
	});

	it('ESCOPO VAZIO devolve zero linhas — nunca todas', async () => {
		// A falha silenciosa que este teste existe para impedir: sem a guarda, o
		// `WHERE` sumiria e o admin sem escopo veria a produtividade inteira.
		const r = await listarTodasRespostasGise(db, { unidadeIds: [] });
		expect(r.total).toBe(0);
		expect(r.respostas).toEqual([]);
	});

	it('unidade que não produziu nada devolve zero', async () => {
		const outra = novaUnidade('DELEGACIA SEM RELATÓRIO');
		expect((await listarTodasRespostasGise(db, { unidadeIds: [outra] })).total).toBe(0);
	});

	it('a CONTAGEM concorda com as linhas devolvidas', async () => {
		// O `leftJoin` do slot precisa estar nas DUAS consultas: se a contagem
		// enxergasse mais linhas que a página, a paginação perderia respostas.
		const r = await listarTodasRespostasGise(db, { unidadeIds: [slotCrato] });
		expect(r.total).toBe(r.respostas.length);
	});

	it('combina escopo de unidade com filtro de operação', async () => {
		respostaEm({
			operacaoId: opB,
			seccionalId: seccional,
			slotUnidadeId: slotCrato,
			policialId: 3,
			valor: 99
		});

		const r = await listarTodasRespostasGise(db, {
			operacaoId: opB,
			unidadeIds: [slotCrato]
		});
		expect(r.total).toBe(1);
		expect(JSON.parse(r.respostas[0].respostas).acervo).toBe(99);
	});
});
