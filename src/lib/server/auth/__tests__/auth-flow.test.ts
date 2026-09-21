/**
 * Testes de integração leve do `tentarLogin` — foco no FAIL-CLOSED do 2º fator
 * (auditoria A1): uma conta com a senha correta mas SEM e-mail NÃO recebe
 * sessão (403), exceto no onboarding (primeiro_acesso=1, sessão confinada a
 * /alterar-senha). Cobre também os caminhos adjacentes (2FA quando há e-mail;
 * credencial inválida) para travar regressões do fluxo de login.
 *
 * Harness sem better-sqlite3: nestes caminhos o `tentarLogin` só consulta
 * `login_attempts` (rate-limit), `policiais`/`administradores` (lookup) e faz
 * inserts (tentativa / sessão / desafio 2FA). O `fakeDb` responde por tabela;
 * o envio de e-mail (fire-and-forget) é mockado para não tocar a rede.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { administradores, policiais, colaboradores } from '$lib/server/schema';
import { hashSenha } from '$lib/auth';
import type { Database } from '$lib/db';

// E-mail é disparado em background no fluxo 2FA; mock evita rede/efeitos.
vi.mock('$lib/server/email', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/email')>();
	return { ...actual, enviarCodigo2FA: vi.fn().mockResolvedValue(undefined) };
});

// O alerta de credencial root vai para o Sentry; capturamos para checar QUANDO
// ele dispara (ver o describe de bootstrap no fim do arquivo).
const captureMessage = vi.fn();
vi.mock('@sentry/cloudflare', () => ({
	captureMessage: (...a: unknown[]) => captureMessage(...a)
}));

import { tentarLogin } from '../auth-flow';

const SENHA = 'SenhaForte1';
let senhaHash: string;
beforeAll(async () => {
	senhaHash = await hashSenha(SENHA);
});

type Row = Record<string, unknown>;

/**
 * fakeDb mínimo, discriminando por tabela:
 *  - `login_attempts`: nunca tem registros (rate-limit por IP e por conta liberado);
 *  - `policiais`/`administradores`: devolvem a conta injetada (ou undefined);
 *  - inserts/updates: no-op.
 *
 * O objeto de `where()` é thenable porque `checkAccountRateLimit` faz
 * `await db.select({ n: count() })...where(...)` (sem `.get()`/`.all()`).
 */
function fakeDb(opts: { policial?: Row; admin?: Row }): Database {
	const select = (fields?: Record<string, unknown>) => ({
		from: (table: unknown) => ({
			where: () => {
				const isCount = !!fields && 'n' in fields;
				return {
					all: async () => [] as Row[],
					get: async () => {
						if (table === policiais) return opts.policial;
						if (table === administradores) return opts.admin;
						return undefined;
					},
					then: (resolve: (v: Row[]) => unknown, reject: (e: unknown) => unknown) =>
						Promise.resolve(isCount ? [{ n: 0 }] : ([] as Row[])).then(resolve, reject)
				};
			}
		})
	});
	const insert = () => ({ values: async () => undefined });
	const update = () => ({ set: () => ({ where: async () => undefined }) });
	return { select, insert, update } as unknown as Database;
}

function basePolicial(over: Row = {}): Row {
	return {
		id: 1,
		matricula: '12345',
		nome: 'Fulano de Tal',
		senha: senhaHash,
		ativo: 1,
		primeiro_acesso: 0,
		email: null,
		papel: null,
		papel_unidade_id: null,
		cargo: 'OIP',
		cpf: null,
		lotacao: 'Unidade X',
		...over
	};
}

function baseAdmin(over: Row = {}): Row {
	return {
		id: 1,
		login: 'admin1',
		nome: 'Admin Um',
		senha: senhaHash,
		primeiro_acesso: 0,
		email: null,
		...over
	};
}

describe('tentarLogin — fail-closed do 2º fator (A1)', () => {
	it('POLICIAL sem e-mail e fora do primeiro acesso → 403 (não cria sessão)', async () => {
		const db = fakeDb({ policial: basePolicial({ email: null, primeiro_acesso: 0 }) });
		const r = await tentarLogin({
			db,
			ip: '1.2.3.4',
			matricula: '12345',
			senha: SENHA,
			tipo: 'policial',
			platform: undefined
		});
		expect(r.sucesso).toBe(false);
		expect(r.statusCode).toBe(403);
		if (!r.sucesso && 'erro' in r) expect(r.erro).toContain('segundo fator');
	});

	it('POLICIAL com e-mail e fora do primeiro acesso → 2FA pendente', async () => {
		const db = fakeDb({
			policial: basePolicial({ email: 'fulano@exemplo.com', primeiro_acesso: 0 })
		});
		const r = await tentarLogin({
			db,
			ip: '1.2.3.4',
			matricula: '12345',
			senha: SENHA,
			tipo: 'policial',
			platform: undefined
		});
		expect(r.sucesso).toBe(false);
		expect('pendente2FA' in r).toBe(true);
		if (!r.sucesso && 'pendente2FA' in r) {
			expect(r.pendente2FA.tipoUsuario2FA).toBe('policial');
			expect(r.pendente2FA.emailMascarado).toContain('@');
		}
	});

	it('POLICIAL sem e-mail MAS em primeiro acesso → sessão (onboarding preservado)', async () => {
		const db = fakeDb({ policial: basePolicial({ email: null, primeiro_acesso: 1 }) });
		const r = await tentarLogin({
			db,
			ip: '1.2.3.4',
			matricula: '12345',
			senha: SENHA,
			tipo: 'policial',
			platform: undefined
		});
		expect(r.sucesso).toBe(true);
		if (r.sucesso) {
			expect(r.token).toBeTruthy();
			expect(r.primeiroAcesso).toBe(true);
			expect(r.role).toBe('policial');
		}
	});

	it('ADMIN (de banco) sem e-mail e fora do primeiro acesso → 403', async () => {
		const db = fakeDb({ admin: baseAdmin({ email: null, primeiro_acesso: 0 }) });
		const r = await tentarLogin({
			db,
			ip: '1.2.3.4',
			matricula: 'admin1',
			senha: SENHA,
			tipo: 'admin',
			platform: undefined
		});
		expect(r.sucesso).toBe(false);
		expect(r.statusCode).toBe(403);
	});

	it('ADMIN (de banco) sem e-mail MAS em primeiro acesso → sessão (onboarding)', async () => {
		const db = fakeDb({ admin: baseAdmin({ email: null, primeiro_acesso: 1 }) });
		const r = await tentarLogin({
			db,
			ip: '1.2.3.4',
			matricula: 'admin1',
			senha: SENHA,
			tipo: 'admin',
			platform: undefined
		});
		expect(r.sucesso).toBe(true);
		if (r.sucesso) {
			expect(r.token).toBeTruthy();
			expect(r.role).toBe('admin');
		}
	});

	it('ADMIN (de banco) com e-mail → 2FA pendente', async () => {
		const db = fakeDb({ admin: baseAdmin({ email: 'admin@exemplo.com', primeiro_acesso: 0 }) });
		const r = await tentarLogin({
			db,
			ip: '1.2.3.4',
			matricula: 'admin1',
			senha: SENHA,
			tipo: 'admin',
			platform: undefined
		});
		expect('pendente2FA' in r).toBe(true);
		if (!r.sucesso && 'pendente2FA' in r) {
			expect(r.pendente2FA.tipoUsuario2FA).toBe('admin');
		}
	});
});

describe('tentarLogin — credenciais (sanity, sem mascarar o A1)', () => {
	it('senha incorreta → 401 (mesmo com e-mail cadastrado)', async () => {
		const db = fakeDb({ policial: basePolicial({ email: 'fulano@exemplo.com' }) });
		const r = await tentarLogin({
			db,
			ip: '1.2.3.4',
			matricula: '12345',
			senha: 'SenhaErrada9',
			tipo: 'policial',
			platform: undefined
		});
		expect(r.sucesso).toBe(false);
		expect(r.statusCode).toBe(401);
	});

	it('conta inexistente → 401', async () => {
		const db = fakeDb({});
		const r = await tentarLogin({
			db,
			ip: '1.2.3.4',
			matricula: '99999',
			senha: SENHA,
			tipo: 'policial',
			platform: undefined
		});
		expect(r.sucesso).toBe(false);
		expect(r.statusCode).toBe(401);
	});
});

/**
 * O alerta de "credencial de bootstrap usada" (log + Sentry) só pode disparar
 * quando alguém REALMENTE entrou por esse caminho.
 *
 * Os dois blocos de bootstrap — SUPER_ADMIN e ADMIN_GERAL — são cópias da mesma
 * lógica, e divergiram: no ADMIN_GERAL o alerta saía ANTES da conferência da
 * senha. Bastava adivinhar o LOGIN (que costuma ser previsível) para disparar à
 * vontade um alerta de segurança dizendo que a conta root tinha sido usada.
 * Alerta que grita sem motivo é alerta que o operador aprende a ignorar — e o
 * dia em que a credencial for mesmo usada, ninguém olha.
 */
describe('tentarLogin — alerta de credencial de bootstrap', () => {
	const envBootstrap = {
		env: { ADMIN_GERAL_LOGIN: 'root', ADMIN_GERAL_SENHA: SENHA }
	} as unknown as App.Platform;

	beforeEach(() => captureMessage.mockReset());

	it('senha ERRADA não dispara o alerta (só o login certo não basta)', async () => {
		const db = fakeDb({});
		const r = await tentarLogin({
			db,
			ip: '1.2.3.4',
			matricula: 'root',
			senha: 'SenhaErrada9',
			tipo: 'admin',
			platform: envBootstrap
		});
		expect(r.sucesso).toBe(false);
		expect(r.statusCode).toBe(401);
		expect(captureMessage).not.toHaveBeenCalled();
	});

	it('senha CERTA dispara o alerta uma vez', async () => {
		const db = fakeDb({ admin: baseAdmin({ login: 'root', email: null }) });
		const r = await tentarLogin({
			db,
			ip: '1.2.3.4',
			matricula: 'root',
			senha: SENHA,
			tipo: 'admin',
			platform: envBootstrap
		});
		expect(r.sucesso).toBe(true);
		expect(captureMessage).toHaveBeenCalledTimes(1);
		expect(String(captureMessage.mock.calls[0][0])).toContain('ADMIN_GERAL');
	});

	it('com 2FA configurado o login para no 2º fator e não alerta "sem 2FA"', async () => {
		const db = fakeDb({ admin: baseAdmin({ login: 'root', email: null }) });
		const r = await tentarLogin({
			db,
			ip: '1.2.3.4',
			matricula: 'root',
			senha: SENHA,
			tipo: 'admin',
			platform: {
				env: { ...envBootstrap.env, ADMIN_GERAL_EMAIL: 'root@pc.ce.gov.br' }
			} as unknown as App.Platform
		});
		expect('pendente2FA' in r).toBe(true);
		expect(captureMessage).not.toHaveBeenCalled();
	});
});

describe('tentarLogin — colaborador (terceira identidade, por CPF — E55)', () => {
	function fakeDbColaborador(conta: Row | undefined): Database {
		const select = (fields?: Record<string, unknown>) => ({
			from: (table: unknown) => ({
				where: () => {
					const isCount = !!fields && 'n' in fields;
					return {
						all: async () => [] as Row[],
						get: async () => (table === colaboradores ? conta : undefined),
						then: (resolve: (v: Row[]) => unknown, reject: (e: unknown) => unknown) =>
							Promise.resolve(isCount ? [{ n: 0 }] : ([] as Row[])).then(resolve, reject)
					};
				}
			})
		});
		const insert = () => ({ values: async () => undefined });
		const update = () => ({ set: () => ({ where: async () => undefined }) });
		return { select, insert, update } as unknown as Database;
	}
	const conta = (over: Row = {}): Row => ({
		id: 7,
		nome: 'Ana Servidora',
		cpf: '52998224725',
		email_pessoal: 'ana@gmail.com',
		senha: senhaHash,
		ativo: 1,
		primeiro_acesso: 0,
		vinculo: 'Empresa X',
		...over
	});

	it('entra por CPF (com ou sem máscara) e para SEMPRE no 2º fator no e-mail pessoal', async () => {
		const r = await tentarLogin({
			db: fakeDbColaborador(conta()),
			ip: '1.2.3.4',
			matricula: '529.982.247-25',
			senha: SENHA,
			tipo: 'colaborador',
			platform: undefined
		});
		expect(r.sucesso).toBe(false);
		expect('pendente2FA' in r).toBe(true);
		if (!r.sucesso && 'pendente2FA' in r) {
			expect(r.pendente2FA.tipoUsuario2FA).toBe('colaborador');
			expect(r.pendente2FA.nome).toBe('Ana Servidora');
			expect(r.pendente2FA.emailMascarado).toBe('a*a@***.com');
		}
	});

	it('no primeiro acesso TAMBÉM passa pelo 2FA — não há atalho sem segundo fator', async () => {
		const r = await tentarLogin({
			db: fakeDbColaborador(conta({ primeiro_acesso: 1 })),
			ip: '1.2.3.4',
			matricula: '52998224725',
			senha: SENHA,
			tipo: 'colaborador',
			platform: undefined
		});
		expect(r.sucesso).toBe(false);
		expect('pendente2FA' in r && r.pendente2FA.primeiroAcesso).toBe(true);
	});

	it('senha errada e conta inexistente dão a MESMA resposta (401, sem oráculo)', async () => {
		const errada = await tentarLogin({
			db: fakeDbColaborador(conta()),
			ip: '1.2.3.4',
			matricula: '52998224725',
			senha: 'outra',
			tipo: 'colaborador',
			platform: undefined
		});
		const inexistente = await tentarLogin({
			db: fakeDbColaborador(undefined),
			ip: '1.2.3.4',
			matricula: '11144477735',
			senha: SENHA,
			tipo: 'colaborador',
			platform: undefined
		});
		expect(errada.sucesso).toBe(false);
		expect(inexistente.sucesso).toBe(false);
		if (!errada.sucesso && !inexistente.sucesso && 'erro' in errada && 'erro' in inexistente) {
			expect(errada.statusCode).toBe(401);
			expect(inexistente.statusCode).toBe(401);
			expect(errada.erro).toBe(inexistente.erro);
		}
	});
});
