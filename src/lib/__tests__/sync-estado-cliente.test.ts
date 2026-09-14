/**
 * Coalescência de `fetchSyncEstado`.
 *
 * O que se protege aqui é uma medição: numa tela de detalhe existem DOIS
 * pollers (o do badge no layout e o da própria tela), ambos ouvindo
 * `visibilitychange`. Medido em Chromium na `/operacoes/gise/[id]`, 3 retornos de foco
 * produziam 6 requisições, aos pares `(sem query)` + `?giseId=N`.
 *
 * Descartar a segunda seria errado — as duas pedem coisas diferentes, e a de
 * `giseId` é superconjunto da outra. O certo é fundir os pedidos do mesmo tick
 * numa requisição com a UNIÃO dos parâmetros. Daí os testes olharem tanto a
 * contagem de chamadas quanto a URL resultante: unir errado economiza uma
 * requisição e devolve um corpo sem o campo que alguém pediu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const apiFetch = vi.fn();
vi.mock('$lib/api-fetch', () => ({ apiFetch: (url: string) => apiFetch(url) }));

const { fetchSyncEstado, _resetLoteSyncEstado } = await import('../sync-estado');

/** URLs pedidas ao `apiFetch`, na ordem. */
const urls = () => apiFetch.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
	apiFetch.mockReset();
	apiFetch.mockResolvedValue({});
	_resetLoteSyncEstado();
});
afterEach(() => _resetLoteSyncEstado());

describe('fetchSyncEstado — coalescência', () => {
	it('funde os dois pollers do mesmo tick numa requisição só', async () => {
		const [a, b] = await Promise.all([fetchSyncEstado(), fetchSyncEstado({ giseId: 7 })]);

		expect(apiFetch).toHaveBeenCalledTimes(1);
		// A união preserva o parâmetro de quem pediu mais.
		expect(urls()[0]).toBe('/api/sync/estado?giseId=7');
		// E os dois chamadores recebem o mesmo corpo.
		expect(a).toBe(b);
	});

	it('funde na ordem inversa também (quem pede mais chega primeiro)', async () => {
		await Promise.all([fetchSyncEstado({ giseId: 7 }), fetchSyncEstado()]);
		expect(apiFetch).toHaveBeenCalledTimes(1);
		expect(urls()[0]).toBe('/api/sync/estado?giseId=7');
	});

	it('une parâmetros DIFERENTES de recursos diferentes', async () => {
		await Promise.all([fetchSyncEstado({ giseId: 7 }), fetchSyncEstado({ escalaId: 9 })]);
		expect(apiFetch).toHaveBeenCalledTimes(1);
		expect(urls()[0]).toBe('/api/sync/estado?giseId=7&escalaId=9');
	});

	it('NÃO funde ids conflitantes — o endpoint aceita um de cada', async () => {
		await Promise.all([fetchSyncEstado({ giseId: 7 }), fetchSyncEstado({ giseId: 8 })]);
		expect(apiFetch).toHaveBeenCalledTimes(2);
		expect(urls().sort()).toEqual(['/api/sync/estado?giseId=7', '/api/sync/estado?giseId=8']);
	});

	it('três chamadas do mesmo tick viram uma', async () => {
		await Promise.all([fetchSyncEstado(), fetchSyncEstado(), fetchSyncEstado({ giseId: 7 })]);
		expect(apiFetch).toHaveBeenCalledTimes(1);
	});

	it('ticks SEPARADOS não são fundidos — nada de servir dado velho', async () => {
		await fetchSyncEstado({ giseId: 7 });
		await fetchSyncEstado({ giseId: 7 });
		expect(apiFetch).toHaveBeenCalledTimes(2);
	});

	it('o lote fecha antes da resposta chegar: pedido durante o voo abre outro', async () => {
		let resolver!: (v: unknown) => void;
		apiFetch.mockImplementationOnce(() => new Promise((r) => (resolver = r)));

		const primeira = fetchSyncEstado({ giseId: 7 });
		await Promise.resolve(); // fecha o lote e dispara a 1ª requisição
		expect(apiFetch).toHaveBeenCalledTimes(1);

		// Chega DURANTE o voo da primeira: como o lote já fechou, abre outro.
		const segunda = fetchSyncEstado({ giseId: 7 });
		await Promise.resolve();
		expect(apiFetch).toHaveBeenCalledTimes(2);

		resolver({});
		await Promise.all([primeira, segunda]);
	});

	it('sem parâmetros, a URL não ganha query', async () => {
		await fetchSyncEstado();
		expect(urls()[0]).toBe('/api/sync/estado');
	});

	it('o erro chega a TODOS os chamadores fundidos', async () => {
		apiFetch.mockRejectedValueOnce(new Error('rede caiu'));
		const a = fetchSyncEstado();
		const b = fetchSyncEstado({ giseId: 7 });
		await expect(a).rejects.toThrow('rede caiu');
		await expect(b).rejects.toThrow('rede caiu');
		expect(apiFetch).toHaveBeenCalledTimes(1);
	});

	it('falha de um lote não contamina o próximo', async () => {
		apiFetch.mockRejectedValueOnce(new Error('rede caiu'));
		await expect(fetchSyncEstado()).rejects.toThrow();
		apiFetch.mockResolvedValueOnce({ painel: { stamp: 'x' } });
		await expect(fetchSyncEstado()).resolves.toEqual({ painel: { stamp: 'x' } });
	});
});
