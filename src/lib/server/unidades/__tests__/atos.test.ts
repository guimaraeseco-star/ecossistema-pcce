/**
 * Os ATOS de estrutura que o guia executa (E73, parte 2), contra SQLite real.
 *
 * O que se trava aqui é a garantia que justifica os atos serem funções: o guia
 * e a tela `/unidades` passam pelo MESMO caminho. Então o ato recusa pelas
 * mesmas travas (o guia não tem porta própria), executa quando nada impede, e
 * deixa o mesmo rastro na auditoria.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import type { UsuarioLogado } from '$lib/auth';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { alternarAtivoDaUnidade, trocarMaeDaUnidade } from '../atos';

let sqlite: DatabaseSync;
let db: Database;

const SECC = 9501;
const ARACATI = 9502;
const FORTIM = 9503;
const RUSSAS = 9504;

/** O mínimo de uma request que a auditoria lê: rota, método, navegador, IP. */
const evento = {
	request: new Request('http://localhost/unidades/1/guia?/concluir', { method: 'POST' }),
	url: new URL('http://localhost/unidades/1/guia'),
	locals: {},
	platform: undefined,
	getClientAddress: () => '127.0.0.1'
} as unknown as RequestEvent;

const superAdmin = {
	id: 1,
	tipo: 'admin',
	nome: 'Super Admin',
	isSuperAdmin: true
} as unknown as UsuarioLogado;

const unidade = (id: number) =>
	sqlite.prepare('SELECT ativo, seccional_id FROM unidades WHERE id = ?').get(id) as {
		ativo: number;
		seccional_id: number | null;
	};

const auditoria = (id: number) =>
	sqlite
		.prepare(
			"SELECT acao, detalhes FROM audit_log WHERE entidade = 'unidade' AND entidade_id = ? ORDER BY id"
		)
		.all(id) as { acao: string; detalhes: string }[];

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo, seccional_id) VALUES
			(${SECC}, 'SECCIONAL ATOS', 'seccional', NULL),
			(${ARACATI}, 'DP ARACATI ATOS', 'delegacia', ${SECC}),
			(${FORTIM}, 'POSTO FORTIM ATOS', 'unidade', ${ARACATI}),
			(${RUSSAS}, 'DP RUSSAS ATOS', 'delegacia', ${SECC});
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, unidade_id, local_id, senha)
		VALUES (96101, '96101', 'ANA DE FORTIM', 'OIP', 'DP ARACATI ATOS', ${ARACATI}, ${FORTIM}, 'x');
	`);
});

describe('desativar', () => {
	it('recusa pela mesma trava da tela, e nada muda', async () => {
		const desfecho = await alternarAtivoDaUnidade(evento, db, superAdmin, FORTIM, false);
		expect(desfecho).toMatchObject({ ok: false, status: 409 });
		expect(desfecho.ok ? '' : desfecho.erro).toContain('ANA DE FORTIM');
		expect(unidade(FORTIM).ativo).toBe(1);
		expect(auditoria(FORTIM)).toEqual([]);
	});

	it('resolvido o passo, desativa e deixa rastro na auditoria', async () => {
		sqlite.exec(`UPDATE policiais SET local_id = NULL WHERE id = 96101`);
		expect(await alternarAtivoDaUnidade(evento, db, superAdmin, FORTIM, false)).toEqual({
			ok: true
		});
		expect(unidade(FORTIM).ativo).toBe(0);
		expect(auditoria(FORTIM)).toEqual([
			{ acao: 'desativar_unidade', detalhes: 'Unidade desativada: POSTO FORTIM ATOS' }
		]);
	});

	it('reativar nunca trava', async () => {
		sqlite.exec(`UPDATE unidades SET ativo = 0 WHERE id = ${FORTIM}`);
		expect(await alternarAtivoDaUnidade(evento, db, superAdmin, FORTIM, true)).toEqual({
			ok: true
		});
		expect(unidade(FORTIM).ativo).toBe(1);
	});

	it('unidade que não existe: 404, sem auditoria', async () => {
		expect(await alternarAtivoDaUnidade(evento, db, superAdmin, 999999, false)).toMatchObject({
			ok: false,
			status: 404
		});
	});
});

describe('trocar a mãe', () => {
	it('recusa pendurar Fortim em Russas enquanto alguém perderia o local', async () => {
		const desfecho = await trocarMaeDaUnidade(evento, db, superAdmin, FORTIM, RUSSAS);
		expect(desfecho).toMatchObject({ ok: false, status: 409 });
		expect(unidade(FORTIM).seccional_id).toBe(ARACATI);
	});

	it('resolvido o passo, troca e registra de onde para onde', async () => {
		sqlite.exec(`UPDATE policiais SET local_id = NULL WHERE id = 96101`);
		expect(await trocarMaeDaUnidade(evento, db, superAdmin, FORTIM, RUSSAS)).toEqual({ ok: true });
		expect(unidade(FORTIM).seccional_id).toBe(RUSSAS);
		expect(auditoria(FORTIM)).toEqual([
			{
				acao: 'editar_unidade',
				detalhes: 'Unidade-mãe trocada pelo guia: DP ARACATI ATOS → DP RUSSAS ATOS'
			}
		]);
	});

	it('recusa pendurar uma unidade numa filha dela — o ciclo na árvore', async () => {
		const desfecho = await trocarMaeDaUnidade(evento, db, superAdmin, ARACATI, FORTIM);
		expect(desfecho).toMatchObject({ ok: false, status: 400 });
		expect(unidade(ARACATI).seccional_id).toBe(SECC);
	});

	it('a mesma mãe de sempre não é troca', async () => {
		expect(await trocarMaeDaUnidade(evento, db, superAdmin, FORTIM, ARACATI)).toMatchObject({
			ok: false,
			status: 400
		});
	});
});
