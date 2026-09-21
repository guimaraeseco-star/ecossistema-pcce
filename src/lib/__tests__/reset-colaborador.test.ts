/**
 * Recuperação de senha do COLABORADOR (E55): o desafio `reset_colaborador`
 * cabe no CHECK do banco (migração 0095) e o link de redefinição aceita a
 * terceira identidade (`reset_senha_tokens.tipo_usuario = 'colaborador'`).
 * Contra SQLite real, porque o que está sob teste é o CHECK — TypeScript
 * aceitaria o tipo novo mesmo com o banco recusando.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import {
	criarDesafio2FA,
	verificarDesafio2FA,
	criarTokenRedefinicao,
	consumirTokenRedefinicao
} from '$lib/auth';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';

let sqlite: DatabaseSync;
let db: Database;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('reset_colaborador', () => {
	it('o desafio grava e só é aceito por quem espera o tipo dele', async () => {
		const id = await criarDesafio2FA(db, 'reset_colaborador', 7, '123456');
		// O 2FA do login NÃO aceita um código de recuperação, e vice-versa.
		expect(await verificarDesafio2FA(db, id, '123456', ['colaborador'])).toBeNull();
		const ok = await verificarDesafio2FA(db, id, '123456', [
			'reset_policial',
			'reset_admin',
			'reset_colaborador'
		]);
		expect(ok).toMatchObject({ tipo: 'reset_colaborador', usuarioId: 7 });
	});

	it('o link de redefinição devolve a identidade colaborador', async () => {
		const token = await criarTokenRedefinicao(db, 'colaborador', 7);
		await expect(consumirTokenRedefinicao(db, token)).resolves.toEqual({
			tipo: 'colaborador',
			usuarioId: 7
		});
	});
});
