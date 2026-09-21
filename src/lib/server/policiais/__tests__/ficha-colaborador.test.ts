/**
 * O portão da ficha para o COLABORADOR (E61): entra só com `servidores.ver`,
 * só na unidade dele, e cada action só com a chave que declara — action sem
 * chave é action que ele não faz.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import type { UsuarioLogado } from '$lib/auth';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { carregarFichaDoPolicial, podeAbrirFichaDePolicial } from '../ficha-permissao';

let db: Database;

const colab = (acessos: string[], unidadeId = 97010): UsuarioLogado => ({
	id: 7,
	tipo: 'colaborador',
	nome: 'Ana',
	primeiro_acesso: false,
	papel_unidade_id: unidadeId,
	lotacao: unidadeId === 97010 ? 'DP de Aurora' : 'DP de Barro',
	acessos: acessos as UsuarioLogado['acessos']
});

beforeEach(() => {
	const sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (97010, 'DP de Aurora', 'delegacia'), (97011, 'DP de Barro', 'delegacia');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES
			(97001, '97001', 'DE AURORA', 'OIP', 'DP de Aurora', 'h'),
			(97002, '97002', 'DE BARRO', 'OIP', 'DP de Barro', 'h');
	`);
});

describe('carregarFichaDoPolicial — colaborador', () => {
	it('sem servidores.ver não abre ficha nenhuma', async () => {
		expect(podeAbrirFichaDePolicial(colab([]))).toBe(false);
		const r = await carregarFichaDoPolicial(db, colab([]), '97001', 'servidores.ver');
		expect('erro' in r && r.erro.status).toBe(403);
	});

	it('com a chave, só o servidor da unidade dele, em modo solicitação', async () => {
		const u = colab(['servidores.ver', 'servidores.afastamento']);
		const ok = await carregarFichaDoPolicial(db, u, '97001', 'servidores.afastamento');
		expect('erro' in ok).toBe(false);
		if (!('erro' in ok)) {
			expect(ok.modo).toBe('solicitacao');
			expect([...(ok.escopo ?? [])]).toEqual(['DP de Aurora']);
		}
		const outra = await carregarFichaDoPolicial(db, u, '97002', 'servidores.afastamento');
		expect('erro' in outra && outra.erro.status).toBe(403);
	});

	it('a action pede a chave dela: sem ela, ou sem chave declarada, 403', async () => {
		const u = colab(['servidores.ver']);
		const semChave = await carregarFichaDoPolicial(db, u, '97001', 'servidores.ferias');
		expect('erro' in semChave && semChave.erro.data.error).toMatch(/não liberou/);
		const semDeclarar = await carregarFichaDoPolicial(db, u, '97001', null);
		expect('erro' in semDeclarar && semDeclarar.erro.status).toBe(403);
		const ver = await carregarFichaDoPolicial(db, u, '97001', 'servidores.ver');
		expect('erro' in ver).toBe(false);
	});

	it('admin de unidade não é afetado pelo parâmetro', async () => {
		const admin: UsuarioLogado = {
			id: 1,
			tipo: 'policial',
			nome: 'Guardião',
			primeiro_acesso: false,
			papel: 'admin_unidade',
			papel_unidade_id: 97010
		};
		const r = await carregarFichaDoPolicial(db, admin, '97001', null);
		expect('erro' in r).toBe(false);
	});
});
