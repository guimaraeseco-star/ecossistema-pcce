import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { seedSession, autenticarPagina, cookieDeSessao } from './session';

/**
 * Redirecionamentos pós-login por papel (telas de boas-vindas) e RBAC de
 * rotas/APIs — automatiza os roteiros 1.1 e 15 do TESTING.md que dependiam
 * de conferência manual por perfil.
 *
 * Papéis exercitados com sessões semeadas:
 *   - policial comum (fixture A)         → /bem-vindo
 *   - policial admin_unidade (fixture)   → / (home de módulos, decisão E39)
 *   - Admin Geral standalone (fixture)   → / (home de módulos), /painel OK,
 *                                          consoles de auditoria vetados
 *                                          (são exclusivos do Super Admin)
 *
 * Desde a fase 1 do Ecossistema os perfis administrativos entram pela home de
 * módulos em `/`; `/escalas/bem-vindo` e `/gise/bem-vindo` só redirecionam.
 */

test.describe('Boas-vindas por papel', () => {
	test('policial comum → /bem-vindo', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.policialA.id);
		test.skip(!ok, 'D1 local indisponível');
		await page.goto('/');
		await expect(page).toHaveURL(/\/bem-vindo$/);
	});

	test('admin de unidade → home de módulos com os quatro grupos', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
		test.skip(!ok, 'D1 local indisponível');
		await page.goto('/bem-vindo');
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByRole('heading', { name: 'Gestão de pessoal' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Gestão de unidade' })).toBeVisible();
		// A delegacia vê a própria unidade, não a lista.
		await expect(page.getByRole('heading', { name: 'Minha delegacia' })).toBeVisible();
	});

	test('Admin Geral → home de módulos; o endereço antigo redireciona', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
		test.skip(!ok, 'D1 local indisponível');
		await page.goto('/escalas/bem-vindo');
		await expect(page).toHaveURL(/\/$/);
		await expect(page.getByRole('heading', { name: 'Departamento' })).toBeVisible();
		// Planejado aparece desligado, não some.
		await expect(page.getByRole('heading', { name: 'Diárias' })).toBeVisible();
	});

	test('policial comum não tem gestão de unidade', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.policialA.id);
		test.skip(!ok, 'D1 local indisponível');
		// O `+error.svelte` mostra o status com a mensagem genérica de permissão.
		await page.goto('/unidade');
		await expect(page.getByText('403')).toBeVisible();
		await expect(page.getByText('não tem permissão')).toBeVisible();
	});

	test('anônimo → /login', async ({ page }) => {
		await page.goto('/bem-vindo');
		await expect(page).toHaveURL(/\/login/);
	});
});

test.describe('RBAC de rotas', () => {
	test('policial comum não entra no /painel nem nos consoles de auditoria', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.policialA.id);
		test.skip(!ok, 'D1 local indisponível');

		await page.goto('/painel');
		await expect(page).not.toHaveURL(/\/painel/);

		await page.goto('/auditoria');
		await expect(page).not.toHaveURL(/\/auditoria/);
	});

	test('Admin Geral acessa /painel, mas auditoria é só do Super Admin', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
		test.skip(!ok, 'D1 local indisponível');

		await page.goto('/painel');
		await expect(page).toHaveURL(/\/painel/);

		await page.goto('/auditoria');
		await expect(page).not.toHaveURL(/\/auditoria/);

		await page.goto('/auditoria/logs');
		await expect(page).not.toHaveURL(/\/auditoria\/logs/);
	});
});

test.describe('RBAC de API (audit log é do Super Admin)', () => {
	test('anônimo → 401; policial → 403; Admin Geral → 403', async ({ request }) => {
		const anon = await request.get('/api/admin/audit');
		expect(anon.status()).toBe(401);

		const tokenPolicial = seedSession(FIXTURE.policialA.id);
		test.skip(!tokenPolicial, 'D1 local indisponível');
		const policial = await request.get('/api/admin/audit', {
			headers: cookieDeSessao(tokenPolicial!)
		});
		expect(policial.status()).toBe(403);

		const tokenAdmin = seedSession(FIXTURE.adminGeral.id, 'admin');
		test.skip(!tokenAdmin, 'D1 local indisponível');
		const admin = await request.get('/api/admin/audit', {
			headers: cookieDeSessao(tokenAdmin!)
		});
		expect(admin.status()).toBe(403);
	});
});
