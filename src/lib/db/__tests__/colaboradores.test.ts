/**
 * Cadastro de colaboradores (migração 0082, reconstruída pela 0094 — E55: o
 * CPF é o login) e a validação de sessão da terceira identidade: uma sessão
 * de tipo `colaborador` nunca vira "policial de mesmo id".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import {
	criarColaborador,
	listarColaboradores,
	buscarColaborador,
	buscarColaboradorAtivoPorCpf,
	definirColaboradorAtivo,
	definirEmailRecuperacao,
	normalizarEmailColaborador,
	CpfDeColaboradorJaCadastrado
} from '../colaboradores';
import { validarSessao, validarSessaoComAceite } from '$lib/auth';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const SUPER = { id: 1, nome: 'Super Admin' };
const CPF = '529.982.247-25';
const OUTRO_CPF = '111.444.777-35';

/** Chaves de teste (32 bytes em hex) — o caminho COM cifra e índice cego. */
const ENV = {
	CPF_ENCRYPTION_KEY: '11'.repeat(32),
	CPF_INDEX_KEY: '22'.repeat(32)
};

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('criarColaborador', () => {
	it('grava com e-mail normalizado, CPF preparado e sem devolver os campos sensíveis', async () => {
		const c = await criarColaborador(
			db,
			{
				nome: '  Ana Servidora ',
				cpf: CPF,
				emailPessoal: ' Ana.Servidora@Gmail.com ',
				senhaHash: 'pbkdf2v3:hash',
				vinculo: 'Empresa X',
				criadoPor: SUPER
			},
			undefined
		);
		expect(c).toMatchObject({
			nome: 'Ana Servidora',
			email_pessoal: 'ana.servidora@gmail.com',
			email_recuperacao: null,
			vinculo: 'Empresa X',
			primeiro_acesso: 1,
			ativo: 1,
			criado_por_id: 1,
			criado_por_nome: 'Super Admin'
		});
		expect(c).not.toHaveProperty('senha');
		expect(c).not.toHaveProperty('cpf');
		expect(c).not.toHaveProperty('cpf_index');

		// Sem chave configurada o CPF vai normalizado em texto (fail-open
		// documentado em `prepararCpfParaDB`); com chave, cifrado — o caminho é o
		// mesmo de `policiais`.
		const linha = sqlite
			.prepare('SELECT senha, cpf, cpf_index FROM colaboradores WHERE id = ?')
			.get(c.id) as { senha: string; cpf: string; cpf_index: string | null };
		expect(linha.senha).toBe('pbkdf2v3:hash');
		expect(linha.cpf).toBe('52998224725');
		expect(linha.cpf_index).toBeNull();
	});

	it('com chave: cifra o CPF, grava o índice cego e o login acha pelo índice', async () => {
		const c = await criarColaborador(
			db,
			{ nome: 'A', cpf: CPF, emailPessoal: 'a@x.br', senhaHash: 'h', criadoPor: SUPER },
			ENV
		);
		const linha = sqlite
			.prepare('SELECT cpf, cpf_index FROM colaboradores WHERE id = ?')
			.get(c.id) as { cpf: string; cpf_index: string | null };
		expect(linha.cpf.startsWith('enc:v1:')).toBe(true);
		expect(linha.cpf_index).toMatch(/^[0-9a-f]{64}$/);
		expect((await buscarColaboradorAtivoPorCpf(db, '52998224725', ENV))?.id).toBe(c.id);
		// Sem a chave a busca cai no texto — e o cifrado não casa.
		expect(await buscarColaboradorAtivoPorCpf(db, CPF, undefined)).toBeNull();
	});

	it('CPF duplicado recusa com erro próprio — com e sem chave, ativo ou não', async () => {
		const dados = { nome: 'A', cpf: CPF, emailPessoal: 'a@x.br', senhaHash: 'h', criadoPor: SUPER };
		const a = await criarColaborador(db, dados, undefined);
		await expect(
			criarColaborador(db, { ...dados, nome: 'B', cpf: '52998224725' }, undefined)
		).rejects.toBeInstanceOf(CpfDeColaboradorJaCadastrado);
		await definirColaboradorAtivo(db, a.id, false);
		await expect(criarColaborador(db, { ...dados, nome: 'C' }, undefined)).rejects.toThrow(/CPF/);

		await criarColaborador(db, { ...dados, cpf: OUTRO_CPF }, ENV);
		await expect(criarColaborador(db, { ...dados, cpf: OUTRO_CPF }, ENV)).rejects.toBeInstanceOf(
			CpfDeColaboradorJaCadastrado
		);
	});
});

describe('busca e listagem', () => {
	it('por CPF ignora a máscara, exige 11 dígitos e só devolve ativo', async () => {
		const c = await criarColaborador(
			db,
			{ nome: 'A', cpf: CPF, emailPessoal: 'a@x.br', senhaHash: 'h', criadoPor: SUPER },
			undefined
		);
		expect((await buscarColaboradorAtivoPorCpf(db, ' 529.982.247-25 ', undefined))?.id).toBe(c.id);
		expect(await buscarColaboradorAtivoPorCpf(db, '5299822472', undefined)).toBeNull();
		await definirColaboradorAtivo(db, c.id, false);
		expect(await buscarColaboradorAtivoPorCpf(db, CPF, undefined)).toBeNull();
		// A gestão continua vendo a conta desativada.
		expect((await buscarColaborador(db, c.id))?.ativo).toBe(0);
		expect(await listarColaboradores(db)).toHaveLength(1);
	});

	it('normalizarEmailColaborador é a regra do cadastro e do e-mail de recuperação', async () => {
		expect(normalizarEmailColaborador(' Ana@X.Br ')).toBe('ana@x.br');
		const c = await criarColaborador(
			db,
			{ nome: 'A', cpf: CPF, emailPessoal: 'a@x.br', senhaHash: 'h', criadoPor: SUPER },
			undefined
		);
		await definirEmailRecuperacao(db, c.id, ' Outro@Y.Br ');
		expect((await buscarColaborador(db, c.id))?.email_recuperacao).toBe('outro@y.br');
		await definirEmailRecuperacao(db, c.id, null);
		expect((await buscarColaborador(db, c.id))?.email_recuperacao).toBeNull();
	});
});

describe('desativar', () => {
	it('apaga as sessões DA CONTA, e só as de tipo colaborador', async () => {
		const c = await criarColaborador(
			db,
			{ nome: 'A', cpf: CPF, emailPessoal: 'a@x.br', senhaHash: 'h', criadoPor: SUPER },
			undefined
		);
		sqlite.exec(`
			INSERT INTO sessoes (token, tipo, usuario_id, expires_at) VALUES
			  ('t1', 'colaborador', ${c.id}, '2099-01-01T00:00:00.000Z'),
			  ('t2', 'policial', ${c.id}, '2099-01-01T00:00:00.000Z'),
			  ('t3', 'colaborador', ${c.id + 1}, '2099-01-01T00:00:00.000Z');
		`);
		expect(await definirColaboradorAtivo(db, c.id, false)).toBe(true);
		const restantes = (
			sqlite.prepare('SELECT token FROM sessoes ORDER BY token').all() as { token: string }[]
		).map((s) => s.token);
		expect(restantes).toEqual(['t2', 't3']);
		expect(await definirColaboradorAtivo(db, 999, false)).toBe(false);
	});
});

describe('sessão de colaborador', () => {
	it('sem linha em `colaboradores` é recusada, mesmo havendo policial com o mesmo id', async () => {
		sqlite.exec(`
			INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo)
			VALUES (42, 'M42', 'Policial 42', 'OIP', 'X', 'h', 1);
			INSERT INTO sessoes (token, tipo, usuario_id, expires_at)
			VALUES ('sha256:tok-col', 'colaborador', 42, '2099-01-01T00:00:00.000Z'),
			       ('sha256:tok-pol', 'policial', 42, '2099-01-01T00:00:00.000Z');
		`);
		// O token em claro que produz o hash acima não importa aqui: o fallback
		// legado aceita a linha cujo `token` é igual ao valor recebido.
		sqlite.exec(`UPDATE sessoes SET token = 'tok-col' WHERE token = 'sha256:tok-col'`);
		sqlite.exec(`UPDATE sessoes SET token = 'tok-pol' WHERE token = 'sha256:tok-pol'`);

		expect(await validarSessao(db, 'tok-col')).toBeNull();
		expect((await validarSessao(db, 'tok-pol'))?.nome).toBe('Policial 42');

		const termo = { versao: '2.0', hash: 'abc' };
		expect((await validarSessaoComAceite(db, 'tok-col', undefined, termo)).usuario).toBeNull();
		expect((await validarSessaoComAceite(db, 'tok-pol', undefined, termo)).usuario?.nome).toBe(
			'Policial 42'
		);
	});
});
