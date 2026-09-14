import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import {
	seedSession,
	cookieDeSessao,
	headersDeSessaoMutacao,
	headersFormAction,
	execD1Local
} from './session';

/**
 * Ciclo de vida da chave de assinatura (fases 2 e 3): cadastro só no celular,
 * reposição com os dois e-mails, ler sem assinar, um-tiro recusado com a flag.
 *
 * Cerimônia biométrica real fica de fora — o gate é status + body, como em
 * `assinatura-simples.spec.ts`.
 */

const UA_DESKTOP =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_CELULAR =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const BODY_REGISTRO_FALSO = {
	desafioId: 'a'.repeat(32),
	credentialId: 'AAAA',
	clientDataJSON: 'AAAA',
	authenticatorData: 'AAAA',
	publicKey: 'AAAA',
	algoritmo: -7
};

test.describe('Chave de assinatura — cadastro, reposição e recusas', () => {
	test.describe.configure({ mode: 'serial' });

	test.afterAll(() => {
		execD1Local(
			`DELETE FROM credenciais_webauthn WHERE usuario_tipo='policial' AND usuario_id=${FIXTURE.policialA.id};`
		);
	});

	test('GET/POST registro no desktop → 403', async ({ request }) => {
		const token = seedSession(FIXTURE.policialA.id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível');

		const get = await request.get('/api/webauthn/registro', {
			headers: { ...cookieDeSessao(token!), 'user-agent': UA_DESKTOP }
		});
		expect(get.status()).toBe(403);
		expect((await get.json()).error).toMatch(/celular/i);

		const post = await request.post('/api/webauthn/registro', {
			headers: { ...headersDeSessaoMutacao(token!), 'user-agent': UA_DESKTOP },
			data: BODY_REGISTRO_FALSO
		});
		expect(post.status()).toBe(403);
		expect((await post.json()).error).toMatch(/celular/i);
	});

	test('primeiro cadastro no celular não exige os dois e-mails', async ({ request }) => {
		const token = seedSession(FIXTURE.policialA.id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível');

		const get = await request.get('/api/webauthn/registro', {
			headers: { ...cookieDeSessao(token!), 'user-agent': UA_CELULAR }
		});
		expect(get.status()).toBe(200);
		expect((await get.json()).exigeReposicao).toBe(false);

		const post = await request.post('/api/webauthn/registro', {
			headers: { ...headersDeSessaoMutacao(token!), 'user-agent': UA_CELULAR },
			data: BODY_REGISTRO_FALSO
		});
		const body = await post.json();
		expect(post.status()).toBe(400);
		expect(String(body.error)).not.toMatch(/institucional e ao pessoal|reposição/i);
	});

	test('reposição sem os dois códigos → 400; solicitar no desktop → 403', async ({ request }) => {
		const token = seedSession(FIXTURE.policialA.id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível');

		expect(
			execD1Local(
				`DELETE FROM credenciais_webauthn WHERE credential_id='e2e-chave-policial-a'; ` +
					`INSERT INTO credenciais_webauthn (usuario_tipo, usuario_id, credential_id, public_key_spki, contador) ` +
					`VALUES ('policial', ${FIXTURE.policialA.id}, 'e2e-chave-policial-a', 'AAAA', 0);`
			)
		).toBe(true);

		const desktop = await request.post('/api/webauthn/solicitar-codigo-reposicao', {
			headers: { ...headersDeSessaoMutacao(token!), 'user-agent': UA_DESKTOP }
		});
		expect(desktop.status()).toBe(403);

		// Fixture nasce sem e-mail (2FA fail-closed). Sem institucional a
		// reposição trava antes dos códigos — recusa "com um só / nenhum".
		const semEmail = await request.post('/api/webauthn/registro', {
			headers: { ...headersDeSessaoMutacao(token!), 'user-agent': UA_CELULAR },
			data: BODY_REGISTRO_FALSO
		});
		expect(semEmail.status()).toBe(400);
		expect((await semEmail.json()).error).toMatch(/e-mail institucional cadastrado/i);

		expect(
			execD1Local(
				`UPDATE policiais SET email='e2e-a@pc.ce.gov.br', email_pessoal='e2e-a@example.com', email_pessoal_verificado=1 WHERE id=${FIXTURE.policialA.id};`
			)
		).toBe(true);

		try {
			const post = await request.post('/api/webauthn/registro', {
				headers: { ...headersDeSessaoMutacao(token!), 'user-agent': UA_CELULAR },
				data: BODY_REGISTRO_FALSO
			});
			expect(post.status()).toBe(400);
			expect((await post.json()).error).toMatch(/institucional e ao pessoal/i);
		} finally {
			execD1Local(
				`UPDATE policiais SET email=NULL, email_pessoal=NULL, email_pessoal_verificado=0 WHERE id=${FIXTURE.policialA.id};`
			);
		}
	});

	test('sem chave: lê a escala (200) e o POST de avançada morre (403)', async ({ request }) => {
		const token = seedSession(FIXTURE.adminUnidade.id);
		if (!token) test.skip(true, 'wrangler/D1 local indisponível');

		const leitura = await request.get(`/escalas/${FIXTURE.escalaAssinavel.id}`, {
			headers: cookieDeSessao(token!)
		});
		expect(leitura.status()).toBe(200);

		// `assinatura-simples` (arquivo anterior na ordem alfabética) já assinou
		// esta escala. Sem apagar o documento o preparar morre em 409 de
		// "já assinado" antes do 403 de chave — e o teste passaria com o gate
		// errado, ou falharia quando a suíte rodasse completa.
		expect(
			execD1Local(`DELETE FROM escala_documentos WHERE escala_id = ${FIXTURE.escalaAssinavel.id};`)
		).toBe(true);

		const preparar = await request.post(
			`/api/escalas/${FIXTURE.escalaAssinavel.id}/preparar-assinatura-avancada`,
			{
				headers: headersDeSessaoMutacao(token!),
				data: {}
			}
		);
		expect(preparar.status()).toBe(403);
		expect((await preparar.json()).error).toMatch(/Token A3|Meu Perfil|celular/i);
	});
});

test.describe('Chave de assinatura — GISE, extra e presença', () => {
	test.describe.configure({ mode: 'serial' });

	test('um-tiro com flag ligada → 403; preparar sem chave → 403', async ({ request }) => {
		const tokenSup = seedSession(FIXTURE.supervisor.id);
		const tokenMembro = seedSession(FIXTURE.membroGise.id);
		const tokenSuper = seedSession(FIXTURE.superAdmin.id, 'admin');
		if (!tokenSup || !tokenMembro || !tokenSuper) test.skip(true, 'wrangler/D1 local indisponível');

		const ligar = await request.put('/api/configuracoes/assinatura', {
			headers: headersDeSessaoMutacao(tokenSuper!),
			data: { exigirPasskey: true }
		});
		test.skip(ligar.status() === 403, 'fixture não é Super Admin neste ambiente');
		expect(ligar.status()).toBe(200);

		try {
			const giseUmTiro = await request.post(`/api/gise/${FIXTURE.gise.id}/assinar-simples`, {
				headers: headersDeSessaoMutacao(tokenSup!),
				data: {}
			});
			expect(giseUmTiro.status()).toBe(403);
			expect((await giseUmTiro.json()).error).toMatch(/chave do seu celular|passkey/i);

			const gisePrep = await request.post(
				`/api/gise/${FIXTURE.gise.id}/preparar-assinatura-avancada`,
				{
					headers: headersDeSessaoMutacao(tokenSup!),
					data: {}
				}
			);
			expect(gisePrep.status()).toBe(403);
			expect((await gisePrep.json()).error).toMatch(/Token A3|Meu Perfil|celular/i);

			execD1Local(
				`DELETE FROM gise_presencas WHERE gise_id = ${FIXTURE.gise.id}; ` +
					`INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp, saida_timestamp) ` +
					`VALUES (${FIXTURE.gise.id}, ${FIXTURE.membroGise.id}, '2026-06-01T08:00:00.000Z', '2026-06-01T16:00:00.000Z');`
			);

			const extraUmTiro = await request.post(
				`/api/gise/${FIXTURE.gise.id}/relatorios/${FIXTURE.seccional.id}/assinar`,
				{
					headers: headersDeSessaoMutacao(tokenSup!),
					data: { type: 'simples' }
				}
			);
			expect(extraUmTiro.status()).toBe(403);
			expect((await extraUmTiro.json()).error).toMatch(/chave do seu celular|passkey/i);

			const extraPrep = await request.post(
				`/api/gise/${FIXTURE.gise.id}/relatorios/${FIXTURE.seccional.id}/preparar-assinatura-avancada`,
				{
					headers: headersDeSessaoMutacao(tokenSup!),
					data: { type: 'simples' }
				}
			);
			expect(extraPrep.status()).toBe(403);

			const presencaPrep = await request.post(
				`/api/gise/${FIXTURE.gise.id}/presenca/preparar-assinatura-avancada`,
				{
					headers: headersDeSessaoMutacao(tokenMembro!),
					data: { tipo: 'entrada' }
				}
			);
			expect(presencaPrep.status()).toBe(403);

			const presencaUmTiro = await request.post('/operacoes/presenca?/salvarEntrada', {
				headers: headersFormAction(tokenMembro!),
				form: { giseId: String(FIXTURE.gise.id) }
			});
			const presencaTxt = await presencaUmTiro.text();
			expect(presencaTxt).toMatch(/chave do seu celular|403/);
		} finally {
			await request.put('/api/configuracoes/assinatura', {
				headers: headersDeSessaoMutacao(tokenSuper!),
				data: { exigirPasskey: false }
			});
			execD1Local(`DELETE FROM gise_presencas WHERE gise_id = ${FIXTURE.gise.id};`);
		}
	});

	test('finalizar GISE/extra/presença sem preparação → recusado', async ({ request }) => {
		const tokenSup = seedSession(FIXTURE.supervisor.id);
		const tokenMembro = seedSession(FIXTURE.membroGise.id);
		if (!tokenSup || !tokenMembro) test.skip(true, 'wrangler/D1 local indisponível');

		const fake = {
			intencao: 'f'.repeat(64),
			preparedPdf: 'JVBERi0xLjQK' + 'A'.repeat(200),
			assercao: {
				credentialId: 'AAAA',
				clientDataJSON: 'AAAA',
				authenticatorData: 'AAAA',
				assinatura: 'AAAA'
			}
		};

		const gise = await request.post(`/api/gise/${FIXTURE.gise.id}/finalizar-assinatura-avancada`, {
			headers: headersDeSessaoMutacao(tokenSup!),
			data: fake
		});
		expect(gise.status()).toBe(400);

		const extra = await request.post(
			`/api/gise/${FIXTURE.gise.id}/relatorios/${FIXTURE.seccional.id}/finalizar-assinatura-avancada`,
			{
				headers: headersDeSessaoMutacao(tokenSup!),
				data: fake
			}
		);
		expect(extra.status()).toBe(400);

		const presenca = await request.post(
			`/api/gise/${FIXTURE.gise.id}/presenca/finalizar-assinatura-avancada?tipo=entrada`,
			{
				headers: headersDeSessaoMutacao(tokenMembro!),
				data: fake
			}
		);
		expect(presenca.status()).toBe(400);
	});
});
