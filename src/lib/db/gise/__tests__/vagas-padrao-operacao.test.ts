/**
 * Herança das vagas padrão: operação → global → fallback do código.
 *
 * O que estes testes fixam, e que é fácil quebrar sem perceber: **`0` e "não
 * definido" são respostas diferentes**. Uma equipe operacional sem vaga de DPC é
 * uma escolha legítima do Admin Geral; tratá-la como ausência faria a próxima
 * escala nascer com 1 DPC que ninguém pediu.
 *
 * O outro caso é a herança POR CAMPO: uma operação pode fixar só as vagas de OIP
 * e continuar herdando as de DPC. Um `??` no objeto inteiro em vez de campo a
 * campo passaria despercebido enquanto todas as operações definissem tudo.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import type { DatabaseSync } from 'node:sqlite';
import { buscarVagasPadraoEquipesGise } from '../vagas-padrao';
import type { Database } from '../../core';

let sqlite: DatabaseSync;
let db: Database;
let operacaoId: number;

/** Grava a chave global de vagas (a que a antiga `/operacoes/gise/config` editava). */
function definirGlobal(json: string) {
	sqlite
		.prepare(
			`INSERT INTO configuracoes (chave, valor) VALUES ('gise_equipes_vagas', ?)
			 ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
		)
		.run(json);
}

function definirNaOperacao(colunas: Record<string, number | null>) {
	for (const [col, val] of Object.entries(colunas)) {
		sqlite.prepare(`UPDATE operacoes SET ${col} = ? WHERE id = ?`).run(val, operacaoId);
	}
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	operacaoId = Number(
		(
			sqlite.prepare(`SELECT id FROM operacoes WHERE nome = 'OPERAÇÃO CRAJUBAR'`).get() as {
				id: number;
			}
		).id
	);
});

describe('sem nada configurado', () => {
	it('cai no fallback histórico do código', async () => {
		const v = await buscarVagasPadraoEquipesGise(db, null);
		expect(v).toEqual({ operacional: { dpc: 1, oip: 3 }, seint: { dpc: 0, oip: 2 } });
	});

	it('operação sem sobrescrita devolve o mesmo que sem operação', async () => {
		expect(await buscarVagasPadraoEquipesGise(db, operacaoId)).toEqual(
			await buscarVagasPadraoEquipesGise(db, null)
		);
	});
});

describe('herança do global', () => {
	it('a operação sem sobrescrita herda o valor global', async () => {
		definirGlobal(JSON.stringify({ op: { dpc: 2, oip: 5 }, seint: { dpc: 1, oip: 4 } }));
		const v = await buscarVagasPadraoEquipesGise(db, operacaoId);
		expect(v).toEqual({ operacional: { dpc: 2, oip: 5 }, seint: { dpc: 1, oip: 4 } });
	});
});

describe('sobrescrita da operação', () => {
	it('o valor da operação ganha do global', async () => {
		definirGlobal(JSON.stringify({ op: { dpc: 2, oip: 5 }, seint: { dpc: 1, oip: 4 } }));
		definirNaOperacao({ vagas_operacional_oip: 9 });

		const v = await buscarVagasPadraoEquipesGise(db, operacaoId);
		expect(v.operacional.oip).toBe(9);
		// …e o que ela NÃO definiu continua vindo do global.
		expect(v.operacional.dpc).toBe(2);
		expect(v.seint).toEqual({ dpc: 1, oip: 4 });
	});

	it('ZERO na operação é um valor, não ausência', async () => {
		// O caso que o `??` protege: `0 ?? 1` é 0; `0 || 1` seria 1.
		definirGlobal(JSON.stringify({ op: { dpc: 3, oip: 3 }, seint: { dpc: 3, oip: 3 } }));
		definirNaOperacao({ vagas_operacional_dpc: 0, vagas_seint_dpc: 0 });

		const v = await buscarVagasPadraoEquipesGise(db, operacaoId);
		expect(v.operacional.dpc).toBe(0);
		expect(v.seint.dpc).toBe(0);
		expect(v.operacional.oip).toBe(3);
	});

	it('voltar a coluna para NULL devolve a herança', async () => {
		definirGlobal(JSON.stringify({ op: { dpc: 2, oip: 5 }, seint: { dpc: 1, oip: 4 } }));
		definirNaOperacao({ vagas_operacional_dpc: 7 });
		expect((await buscarVagasPadraoEquipesGise(db, operacaoId)).operacional.dpc).toBe(7);

		definirNaOperacao({ vagas_operacional_dpc: null });
		expect((await buscarVagasPadraoEquipesGise(db, operacaoId)).operacional.dpc).toBe(2);
	});

	it('operações diferentes não se contaminam', async () => {
		const gise = Number(
			(sqlite.prepare(`SELECT id FROM operacoes WHERE nome = 'GISE'`).get() as { id: number }).id
		);
		definirNaOperacao({ vagas_operacional_oip: 8 });

		expect((await buscarVagasPadraoEquipesGise(db, operacaoId)).operacional.oip).toBe(8);
		expect((await buscarVagasPadraoEquipesGise(db, gise)).operacional.oip).toBe(3);
	});

	it('id de operação inexistente cai no global, sem lançar', async () => {
		definirGlobal(JSON.stringify({ op: { dpc: 2, oip: 5 }, seint: { dpc: 1, oip: 4 } }));
		const v = await buscarVagasPadraoEquipesGise(db, 999999);
		expect(v.operacional).toEqual({ dpc: 2, oip: 5 });
	});
});
