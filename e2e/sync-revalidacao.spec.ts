import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local } from './session';

/**
 * O comportamento que o mecanismo de sync existe para entregar: **uma mudança
 * feita fora desta aba aparece ao voltar o foco, sem F5**.
 *
 * Vive em e2e e não em unitário porque `useInvalidateOnFocus` é um `$effect`
 * que depende de `document.visibilityState`, de `setInterval` e do `invalidate`
 * do SvelteKit — o vitest do projeto roda em `environment: 'node'`, sem DOM nem
 * runtime de runes. Testar as peças isoladas com mock provaria que o mock
 * funciona; aqui prova-se a coisa.
 *
 * O segundo teste é a contrapartida de custo: com dois pollers na mesma tela (o
 * badge do layout e o da página), o retorno de foco disparava DUAS requisições.
 * A coalescência de `fetchSyncEstado` funde as do mesmo tick.
 */

const GISE = FIXTURE.gise.id;

/** Sai e volta para a aba, como o usuário trocando de janela. */
async function alternarFoco(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await page.waitForTimeout(150);
	await page.evaluate(() => {
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
	});
}

test.beforeEach(async ({ page }) => {});

test.afterAll(() => {
	execD1Local(`UPDATE gise_escalas SET status = 'em_andamento' WHERE id = ${GISE};`);
});

test('mudança feita fora da aba aparece ao voltar o foco, sem reload', async ({ page }) => {
	execD1Local(`UPDATE gise_escalas SET status = 'em_andamento' WHERE id = ${GISE};`);
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');

	await page.goto(`/operacoes/gise/${GISE}`);
	await expect(page.getByText('GISE em operação').first()).toBeVisible();

	// Marca a instância da página: se houver reload, o marcador some — é assim
	// que o teste distingue "revalidou" de "recarregou".
	await page.evaluate(() => ((window as unknown as { __marca?: number }).__marca = 42));

	// Outra sessão altera a GISE.
	execD1Local(`UPDATE gise_escalas SET status = 'finalizada' WHERE id = ${GISE};`);

	// UM retorno de foco basta: o carimbo de referência é semeado na montagem.
	await alternarFoco(page);

	await expect(page.getByText('Concluída').first()).toBeVisible({ timeout: 15000 });
	expect(await page.evaluate(() => (window as unknown as { __marca?: number }).__marca)).toBe(42);
});

test('os dois pollers da tela fazem UMA requisição por retorno de foco', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');

	const chamadas: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/api/sync/estado')) chamadas.push(new URL(r.url()).search);
	});

	await page.goto(`/operacoes/gise/${GISE}`);
	await page.waitForLoadState('networkidle');
	chamadas.length = 0;

	const RETORNOS = 3;
	for (let i = 0; i < RETORNOS; i++) {
		await alternarFoco(page);
		await page.waitForTimeout(900);
	}

	// Antes da coalescência eram 2 por retorno: `(sem query)` do badge do layout
	// e `?giseId=N` da página. Fundidas, sobra a com o parâmetro — que já traz
	// as fatias da outra no mesmo corpo.
	expect(chamadas.length).toBeLessThanOrEqual(RETORNOS);
	expect(chamadas.every((q) => q.includes(`giseId=${GISE}`))).toBe(true);
});
