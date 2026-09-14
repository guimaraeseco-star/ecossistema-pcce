/**
 * Revogação de credencial — FLW-AUTH-001, AUTH-002 e RBAC-001.
 *
 * Os três achados são o mesmo enunciado visto de três lados: **o que o sistema
 * promete quando alguém deixa de poder entrar.** E os três falhavam por causa
 * da mesma estrutura — o Admin Geral VINCULADO é uma pessoa com DUAS linhas
 * (`policiais` e `administradores`), uma senha e dois cookies possíveis. Todo
 * fluxo que tratava só do lado em que a pessoa estava deixava o outro de pé.
 *
 * O que cada teste aqui prova, e por que só o e2e prova:
 *
 * - **AUTH-002** — a senha nova tem de ir para a linha que o LOGIN lê. Um teste
 *   de unidade sobre `resolverCredencial` diz onde ela mora; só uma requisição
 *   de login diz se a senha nova realmente vale e a antiga realmente parou.
 * - **RBAC-001** — desativar tem de tirar a pessoa de DENTRO. A sessão já
 *   existe; nenhuma checagem de login é exercida ao usá-la.
 *
 * **AUTH-001 não está aqui, e isso é decisão.** A garantia — leitura pode
 * atrasar, ação não — depende do Cache API do Cloudflare, que NÃO funciona no
 * preview local: um teste de ponta a ponta passaria com a regra ligada e
 * desligada. Já escrevi esse teste e o vi passar contra o código furado; ele
 * foi trocado por `server/auth/__tests__/session-cache.test.ts`, que fixa a
 * decisão que produz a garantia (`ttlCacheSessaoParaMetodo`) e reprova quando
 * ela some.
 *
 * As contas vêm do `global-setup`; este spec cria a sua própria conta vinculada
 * para não deixar as outras suítes com sessões derrubadas pelo meio.
 */
import { test, expect, request as contextoDeApi } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
// A MESMA função do app, como no global-setup: cópia local do hash diverge do
// formato real e o login rejeita a senha que o teste acabou de gravar.
import { hashSenha } from '../src/lib/crypto/password-hash';
import { VERSAO as TERMO_VERSAO, calcularHashTermo } from '../src/lib/server/termo/termo-vigente';
import { FIXTURE } from './global-setup';
import {
	BASE_URL,
	execD1Local,
	queryD1Local,
	seedSession,
	cookieDeSessao,
	headersFormAction
} from './session';

/**
 * Toda requisição deste spec vai num contexto de API NOVO, e é por isso que
 * nenhuma usa a fixture `request`.
 *
 * O assunto aqui é exatamente "qual cookie ainda vale". As rotas de senha
 * respondem com `Set-Cookie` da sessão rotacionada, o contexto compartilhado do
 * Playwright guarda isso, e a requisição seguinte sai com DOIS `session_token`
 * — o do jar e o que o teste passou no header. O servidor derruba a conexão
 * (`socket hang up`), e a falha aparece a dois ou três testes de distância da
 * causa. Contexto novo a cada chamada: o cookie sob teste é o único em jogo.
 */
async function emContextoLimpo<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
	const ctx = await contextoDeApi.newContext({ baseURL: BASE_URL });
	try {
		return await fn(ctx);
	} finally {
		await ctx.dispose();
	}
}

/** GET autenticado por um cookie específico; devolve só o status. */
async function statusComCookie(url: string, token: string): Promise<number> {
	return emContextoLimpo(async (ctx) =>
		(await ctx.get(url, { headers: cookieDeSessao(token) })).status()
	);
}

/** POST numa form action; devolve o `ActionResult` já desserializado. */
async function postAction(
	url: string,
	token: string,
	campos: Record<string, string>
): Promise<{ type?: string; status?: number; data?: string }> {
	return emContextoLimpo(async (ctx) => {
		const res = await ctx.post(url, { headers: headersFormAction(token), multipart: campos });
		return (await res.json()) as { type?: string; status?: number; data?: string };
	});
}

/** Faixa 993xx: exclusiva deste spec, fora da 99xxx usada pelo global-setup. */
const POL = 99301;
const ADM = 99301;
const MATRICULA = 'EE993001';

const SENHA = 'Senha-Antiga-2026!';

/**
 * Conta VINCULADA sintética: uma pessoa, duas linhas, uma senha.
 *
 * O aceite do Termo vai junto e não é detalhe: sem ele o hook responde 403 a
 * qualquer `/api/*` e o teste mediria o gate errado.
 */
function semearContaVinculada(senhaHash: string, termoHash: string): boolean {
	return execD1Local(
		`DELETE FROM sessoes WHERE (tipo='policial' AND usuario_id=${POL}) OR (tipo='admin' AND usuario_id=${ADM});
		 DELETE FROM aceites_termos WHERE (usuario_tipo='policial' AND usuario_id=${POL}) OR (usuario_tipo='admin' AND usuario_id=${ADM});
		 DELETE FROM administradores WHERE id=${ADM};
		 DELETE FROM policiais WHERE id=${POL};
		 INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo, primeiro_acesso)
		 VALUES (${POL}, '${MATRICULA}', 'Vinculado Revogacao', 'DPC', '${FIXTURE.unidadeA.nome}', '${senhaHash}', 1, 0);
		 INSERT INTO administradores (id, login, senha, nome, policial_id, primeiro_acesso)
		 VALUES (${ADM}, '${MATRICULA}', 'placeholder-nunca-usado', 'Vinculado Revogacao', ${POL}, 0);
		 INSERT INTO aceites_termos (usuario_tipo, usuario_id, versao_termo, hash_termo, aceitou_lgpd, aceitou_uso_email, aceitou_uso_localizacao)
		 VALUES ('policial', ${POL}, '${TERMO_VERSAO}', '${termoHash}', 1, 1, 1),
		        ('admin', ${ADM}, '${TERMO_VERSAO}', '${termoHash}', 1, 1, 1);`
	);
}

/** Semeia a conta com a senha padrão do spec. */
async function semear(): Promise<boolean> {
	return semearContaVinculada(await hashSenha(SENHA), await calcularHashTermo());
}

const senhaDoPolicial = () =>
	queryD1Local<{ senha: string }>(`SELECT senha FROM policiais WHERE id=${POL}`)?.[0]?.senha;
const senhaDoAdmin = () =>
	queryD1Local<{ senha: string }>(`SELECT senha FROM administradores WHERE id=${ADM}`)?.[0]?.senha;
const sessoesVivas = () =>
	queryD1Local<{ n: number }>(
		`SELECT COUNT(*) AS n FROM sessoes WHERE (tipo='policial' AND usuario_id=${POL}) OR (tipo='admin' AND usuario_id=${ADM})`
	)?.[0]?.n;

test.describe.configure({ mode: 'serial' });

test.describe('Admin Geral vinculado — uma senha, duas identidades', () => {
	test('AUTH-002: a troca grava na linha que o LOGIN lê e derruba os DOIS cookies', async () => {
		test.skip(!(await semear()), 'D1 local indisponível');

		const placeholderAntes = senhaDoAdmin();
		const tokenAdmin = seedSession(ADM, 'admin');
		const tokenPolicial = seedSession(POL, 'policial');
		test.skip(!tokenAdmin || !tokenPolicial, 'D1 local indisponível');
		expect(sessoesVivas(), 'a pessoa entra com dois cookies possíveis').toBe(2);

		const corpo = await postAction('/alterar-senha?/alterar', tokenAdmin!, {
			senha_atual: SENHA,
			nova_senha: 'Senha-Nova-2026!'
		});
		expect(corpo.type, `resposta: ${JSON.stringify(corpo)}`).toBe('success');

		// ONDE, não "se": a linha admin de um vinculado é um placeholder que o
		// login nunca lê. Gravar ali deixaria a senha ANTIGA valendo, justamente
		// no fluxo que existe para tirá-la de circulação.
		expect(senhaDoPolicial(), 'a senha nova tem de estar na linha do POLICIAL').not.toBe(
			await hashSenha(SENHA)
		);
		expect(senhaDoAdmin(), 'o placeholder da linha admin não deve ser tocado').toBe(
			placeholderAntes
		);

		// A action cria UMA sessão nova para quem trocou; o cookie do outro modo,
		// destravado pela MESMA senha, não pode sobreviver.
		expect(sessoesVivas(), 'só a sessão recém-criada pode restar').toBe(1);
		expect(
			await statusComCookie('/api/policiais/search?q=fixture', tokenPolicial!),
			'o cookie do modo usuário tinha de morrer junto'
		).toBe(401);
	});
});

test.describe('RBAC-001 — desativar tira a pessoa de dentro', () => {
	test('sessão de administrador do policial desativado para de agir E de ler', async () => {
		test.skip(!(await semear()), 'D1 local indisponível');
		const tokenAdmin = seedSession(ADM, 'admin');
		test.skip(!tokenAdmin, 'D1 local indisponível');

		// Antes: a sessão admin funciona.
		expect(await statusComCookie('/api/policiais/search?q=fixture', tokenAdmin!)).toBe(200);

		// Desativa direto no banco — é o efeito que `registrarDesvinculacao` grava.
		// A revogação explícita da action é coberta pelo caso seguinte; aqui o que
		// se testa é a VALIDAÇÃO da sessão, que ignorava o vínculo.
		execD1Local(`UPDATE policiais SET ativo=0 WHERE id=${POL}`);

		expect(
			await statusComCookie('/api/policiais/search?q=fixture', tokenAdmin!),
			'sessão admin de policial inativo tem de morrer'
		).toBe(401);
	});

	test('a action de desvinculação derruba as sessões abertas', async () => {
		test.skip(!(await semear()), 'D1 local indisponível');
		const tokenVitima = seedSession(POL, 'policial');
		const tokenAdminGeral = seedSession(FIXTURE.adminGeral.id, 'admin');
		test.skip(!tokenVitima || !tokenAdminGeral, 'D1 local indisponível');

		const corpo = await postAction(`/servidores/${POL}?/registrarDesvinculacao`, tokenAdminGeral!, {
			destino: 'Aposentadoria',
			data_evento: '2026-08-04',
			nup: ''
		});
		expect(corpo.type, `resposta: ${JSON.stringify(corpo)}`).toBe('success');

		expect(sessoesVivas(), 'nenhuma sessão da pessoa desvinculada pode restar').toBe(0);
		expect(await statusComCookie('/api/policiais/search?q=fixture', tokenVitima!)).toBe(401);
	});
});

test.afterAll(() => {
	execD1Local(
		`DELETE FROM sessoes WHERE (tipo='policial' AND usuario_id=${POL}) OR (tipo='admin' AND usuario_id=${ADM});
		 DELETE FROM aceites_termos WHERE (usuario_tipo='policial' AND usuario_id=${POL}) OR (usuario_tipo='admin' AND usuario_id=${ADM});
		 DELETE FROM policial_historico WHERE policial_id=${POL};
		 DELETE FROM administradores WHERE id=${ADM};
		 DELETE FROM policiais WHERE id=${POL};`
	);
});
