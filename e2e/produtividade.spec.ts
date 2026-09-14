import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina } from './session';

/**
 * Dashboard de produtividade (`/operacoes/produtividade`) — console de leitura do Admin
 * Geral. A agregação (stats/rankings) tem cobertura unitária em
 * `produtividade/stats`; aqui garantimos o acesso e a renderização:
 * Admin Geral entra e vê o dashboard (mesmo vazio), policial recebe 403
 * (guard `error(403)`, não redirect) e anônimo vai para o login.
 */

test.describe('Dashboard de produtividade', () => {
	test('Admin Geral acessa e vê o dashboard', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
		test.skip(!ok, 'D1 local indisponível');

		const res = await page.goto('/operacoes/produtividade');
		expect(res?.status()).toBe(200);
		await expect(page.getByRole('heading', { name: /Produção/ })).toBeVisible();
	});

	test('policial comum → 403', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.policialA.id);
		test.skip(!ok, 'D1 local indisponível');

		const res = await page.goto('/operacoes/produtividade');
		expect(res?.status()).toBe(403);
	});

	test('anônimo → /login', async ({ page }) => {
		await page.goto('/operacoes/produtividade');
		await expect(page).toHaveURL(/\/login/);
	});
});
