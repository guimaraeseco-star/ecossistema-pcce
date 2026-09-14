import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { seedSession, cookieDeSessao, execD1Local } from './session';

/**
 * `GET /api/sync/estado` — o endpoint de carimbos que alimenta o poll de
 * revalidação (`useInvalidateOnFocus`).
 *
 * O ponto destes testes é a AUTORIZAÇÃO, e a razão é que o carimbo não é
 * opaco: ele é a concatenação dos campos que mudam. O de uma GISE traz
 * `status|data|hora_entrada|hora_saida|supervisor_id`; o de uma escala traz
 * `policial_id:data:horário` de cada escalado. Um endpoint só com
 * `requireAuth` deixaria qualquer autenticado enumerar `?giseId=1..N` e montar
 * o calendário de operações e a escala de trabalho de terceiros — exatamente o
 * que `/operacoes/gise/[id]` e `/escalas/[id]` recusam.
 *
 * Recurso sem permissão vem AUSENTE do corpo, não como 403: um erro distinto
 * revelaria a existência, que é o que se quer esconder. Daí as asserções serem
 * `toBeUndefined()` e não `toBe(403)`.
 */

/** Existe no banco, mas o membro fixture não participa dela. */
const GISE_ALHEIA = 99002;
/** Escala de DELEGACIA E2E FIXTURE A, com um escalado. */
const ESCALA_ALHEIA = FIXTURE.escalaAssinavel.id;

let token: string | null = null;
let tokenAdmin: string | null = null;

// Fora do describe: `test.skip(() => ...)` de escopo é avaliado ANTES do
// `beforeAll` dele.
test.beforeAll(() => {
	execD1Local(
		`INSERT OR REPLACE INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, supervisor_id)` +
			` VALUES (${GISE_ALHEIA},'2026-09-09','em_andamento','07:11','19:22',${FIXTURE.supervisor.id});`
	);
	// `policialB` não tem vínculo GISE nenhum nem é da lotação da escala.
	token = seedSession(FIXTURE.policialB.id);
	tokenAdmin = seedSession(FIXTURE.adminGeral.id, 'admin');
});

test.describe('GET /api/sync/estado', () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(() => !token || !tokenAdmin, 'D1 local indisponível');

	test('anônimo → 401', async ({ request }) => {
		expect((await request.get('/api/sync/estado')).status()).toBe(401);
	});

	test('parâmetro inválido → 400', async ({ request }) => {
		for (const q of ['giseId=abc', 'giseId=0', 'giseId=-1', 'escalaId=abc', 'escalaId=0']) {
			const res = await request.get(`/api/sync/estado?${q}`, { headers: cookieDeSessao(token!) });
			expect(res.status(), q).toBe(400);
		}
	});

	test('GISE de que não participa → carimbo ausente', async ({ request }) => {
		const res = await request.get(`/api/sync/estado?giseId=${GISE_ALHEIA}`, {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.gise).toBeUndefined();
		// E o corpo inteiro não pode conter os horários daquela GISE por outra via.
		expect(JSON.stringify(body)).not.toContain('07:11');
	});

	test('escala de outra lotação → carimbo ausente', async ({ request }) => {
		const res = await request.get(`/api/sync/estado?escalaId=${ESCALA_ALHEIA}`, {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(200);
		expect((await res.json()).escala).toBeUndefined();
	});

	test('sem vínculo GISE → giseList ausente', async ({ request }) => {
		const res = await request.get('/api/sync/estado', { headers: cookieDeSessao(token!) });
		const body = await res.json();
		expect(body.giseList).toBeUndefined();
		expect(JSON.stringify(body)).not.toContain(String(GISE_ALHEIA));
	});

	test('recurso inexistente → 200 sem o campo (não revela existência)', async ({ request }) => {
		for (const q of ['giseId=4242', 'escalaId=4242']) {
			const res = await request.get(`/api/sync/estado?${q}`, {
				headers: cookieDeSessao(tokenAdmin!)
			});
			expect(res.status(), q).toBe(200);
			const body = await res.json();
			expect(body.gise ?? body.escala, q).toBeUndefined();
		}
	});

	test('Admin Geral continua recebendo os carimbos (a correção não quebrou o poll)', async ({
		request
	}) => {
		const res = await request.get(
			`/api/sync/estado?giseId=${GISE_ALHEIA}&escalaId=${ESCALA_ALHEIA}`,
			{ headers: cookieDeSessao(tokenAdmin!) }
		);
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.gise?.stamp).toContain('07:11');
		expect(body.escala?.stamp).toBeTruthy();
		expect(body.giseList?.stamp).toContain(String(GISE_ALHEIA));
		expect(body.recebidos).toBeDefined();
		expect(body.painel).toBeDefined();
	});
});
