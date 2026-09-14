/**
 * `postFormAction` — o único `fetch` cru que o projeto autoriza (form action do
 * SvelteKit espera `FormData` + header de action, então `apiFetch` não serve).
 *
 * Sendo exceção à regra, é justamente onde o CSRF pode sumir sem ninguém notar:
 * fora de `/api`, quem barra a requisição forjada é o header. Por isso o teste
 * central aqui é "o token vai junto", e não o parse da resposta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const csrfHeaders = vi.fn(() => ({ 'x-csrf-token': 'tok-123' }));
vi.mock('$lib/csrf', () => ({ csrfHeaders: () => csrfHeaders() }));

const { postFormAction, postPageAction } = await import('../post-form-action');

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

/** Init da última chamada ao fetch. */
const ultimoInit = () => fetchMock.mock.calls.at(-1)![1] as RequestInit;
const ultimaUrl = () => fetchMock.mock.calls.at(-1)![0] as string;

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockResolvedValue({ json: async () => ({ type: 'success', status: 200 }) });
	csrfHeaders.mockClear();
});

describe('postFormAction', () => {
	it('envia POST com o body de FormData intacto', async () => {
		const fd = new FormData();
		fd.set('giseId', '7');

		await postFormAction('/rota?/acao', fd);

		expect(ultimaUrl()).toBe('/rota?/acao');
		expect(ultimoInit().method).toBe('POST');
		// O MESMO FormData, não uma cópia serializada.
		expect(ultimoInit().body).toBe(fd);
	});

	it('leva o token CSRF — sem ele a action é recusada', async () => {
		await postFormAction('/rota?/acao', new FormData());
		const headers = ultimoInit().headers as Record<string, string>;
		expect(headers['x-csrf-token']).toBe('tok-123');
	});

	it('marca a requisição como action do SvelteKit e pede JSON', async () => {
		await postFormAction('/rota?/acao', new FormData());
		const headers = ultimoInit().headers as Record<string, string>;
		expect(headers['x-sveltekit-action']).toBe('true');
		expect(headers.accept).toBe('application/json');
	});

	it('não define Content-Type: o browser precisa gerar o boundary do multipart', async () => {
		await postFormAction('/rota?/acao', new FormData());
		const headers = ultimoInit().headers as Record<string, string>;
		expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
	});

	it('devolve o ActionResult do corpo', async () => {
		fetchMock.mockResolvedValue({
			json: async () => ({ type: 'failure', status: 400, data: { error: 'x' } })
		});
		await expect(postFormAction('/rota?/acao', new FormData())).resolves.toEqual({
			type: 'failure',
			status: 400,
			data: { error: 'x' }
		});
	});

	it('sessão sem token → header ausente, mas a chamada acontece', async () => {
		csrfHeaders.mockReturnValueOnce({} as { 'x-csrf-token': string });
		await postFormAction('/rota?/acao', new FormData());
		const headers = ultimoInit().headers as Record<string, string>;
		expect(headers['x-csrf-token']).toBeUndefined();
		expect(headers['x-sveltekit-action']).toBe('true');
	});
});

describe('postPageAction', () => {
	it('monta `?/nome` sobre o pathname informado', async () => {
		await postPageAction('salvarEntrada', new FormData(), '/operacoes/presenca');
		expect(ultimaUrl()).toBe('/operacoes/presenca?/salvarEntrada');
	});

	it('mantém o mesmo contrato de headers do postFormAction', async () => {
		await postPageAction('salvarEntrada', new FormData(), '/operacoes/presenca');
		const headers = ultimoInit().headers as Record<string, string>;
		expect(headers['x-csrf-token']).toBe('tok-123');
		expect(headers['x-sveltekit-action']).toBe('true');
	});
});
