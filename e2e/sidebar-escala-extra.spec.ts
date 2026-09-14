import { test, expect, type Page } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina } from './session';

/**
 * A gaveta de navegação em DOIS NÍVEIS.
 *
 * Até ago/2026 a barra era uma lista plana, e o admin de unidade/seccional via
 * até oito itens de uma vez — cinco deles do mesmo assunto (escala extra), sem
 * que nada na tela dissesse isso. Eles só estavam perto uns dos outros.
 *
 * Agora "Escala extra" é um pai que SUBSTITUI o conteúdo da barra pelo submenu.
 * O que este spec protege é o que o agrupamento não podia ter mudado: quem vê o
 * quê. Agrupar é apresentação, e cada filho manteve a condição que já tinha — um
 * `if` a mais ou a menos aqui muda o menu de um papel inteiro sem erro nenhum.
 *
 * Fica de fora de propósito o item "Dados base": ele depende de
 * `temLinhaBaseAPreencher`, que o servidor cacheia por 60s na borda. Montar o
 * cenário e conferir a virada dentro de um teste esbarraria no TTL, e o que
 * sobraria seria um teste que às vezes não afirma nada. A regra dele tem
 * cobertura própria em `operacoes-linha-base.spec.ts`.
 *
 * A barra não tinha cobertura automatizada até este arquivo; o que existia era o
 * roteiro manual do `TESTING.md` §4.12.
 */

/** Abre a gaveta e devolve o `<nav>` dela. */
async function abrirMenu(page: Page) {
	await page.getByRole('button', { name: 'Menu', exact: true }).click();
	const nav = page.locator('#navegacao-principal');
	await expect(nav).toBeVisible();
	return nav;
}

const PAI = 'Escala extra';

test.describe('Barra lateral — menu de dois níveis', () => {
	test('admin de unidade: a raiz encolhe e o submenu substitui a barra', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
		test.skip(!ok, 'D1 local indisponível');

		await page.goto('/escalas');
		const nav = await abrirMenu(page);

		// Produtividade saiu da raiz — é o pedido inteiro.
		await expect(nav.getByRole('button', { name: PAI })).toBeVisible();
		await expect(nav.getByRole('link', { name: 'Produtividade' })).toHaveCount(0);
		await expect(nav.getByRole('link', { name: 'Escalas ordinárias' })).toBeVisible();

		await nav.getByRole('button', { name: PAI }).click();

		// O submenu SUBSTITUI: o que estava na raiz sai de vista. Expandir dentro da
		// barra devolveria a lista comprida que o agrupamento veio desfazer.
		await expect(nav.getByRole('link', { name: 'Escalas ordinárias' })).toHaveCount(0);
		await expect(nav.getByRole('link', { name: 'Meu perfil' })).toHaveCount(0);
		await expect(nav.getByRole('link', { name: 'Produtividade' })).toBeVisible();

		// Voltar devolve a raiz — sem ele o submenu seria um beco.
		await nav.getByRole('button', { name: PAI }).click();
		await expect(nav.getByRole('link', { name: 'Escalas ordinárias' })).toBeVisible();
	});

	test('a gaveta abre JÁ no submenu quando a rota é de um filho', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
		test.skip(!ok, 'D1 local indisponível');

		// Sem isto, abrir o menu em /operacoes/produtividade mostraria a raiz e esconderia
		// justamente onde a pessoa está.
		await page.goto('/operacoes/produtividade');
		const nav = await abrirMenu(page);

		const item = nav.getByRole('link', { name: 'Produtividade' });
		await expect(item).toBeVisible();
		// E aceso: o destaque acompanha a rota, como nos demais itens.
		await expect(item).toHaveClass(/bg-primary-500\/15/);
	});

	test('fora do submenu a gaveta abre na raiz', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
		test.skip(!ok, 'D1 local indisponível');

		// A contraprova do caso acima: em rota que não é de filho, a raiz.
		await page.goto('/escalas');
		const nav = await abrirMenu(page);
		await expect(nav.getByRole('button', { name: PAI })).toBeVisible();
		await expect(nav.getByRole('link', { name: 'Produtividade' })).toHaveCount(0);
	});

	test('Admin Geral: Operações fica na RAIZ, fora do submenu', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
		test.skip(!ok, 'D1 local indisponível');

		await page.goto('/operacoes/gise/operacoes');
		const nav = await abrirMenu(page);

		// Cadastro de operação não é operação do dia a dia — decisão registrada.
		await expect(nav.getByRole('link', { name: 'Operações' })).toBeVisible();
		await expect(nav.getByRole('button', { name: PAI })).toBeVisible();

		await nav.getByRole('button', { name: PAI }).click();
		await expect(nav.getByRole('link', { name: 'Operações' })).toHaveCount(0);
		await expect(nav.getByRole('link', { name: 'Ativas', exact: true })).toBeVisible();
		await expect(nav.getByRole('link', { name: 'Finalizadas', exact: true })).toBeVisible();
		await expect(nav.getByRole('link', { name: 'Produtividade' })).toBeVisible();
		// Admin Geral não presta serviço: as duas abas do policial não são dele.
		await expect(nav.getByRole('link', { name: 'Minha presença' })).toHaveCount(0);
		await expect(nav.getByRole('link', { name: 'Meu histórico' })).toHaveCount(0);
	});

	test('policial comum: o pai existe com os filhos dele, e só eles', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.membroGise.id);
		test.skip(!ok, 'D1 local indisponível');

		await page.goto('/bem-vindo');
		const nav = await abrirMenu(page);
		await nav.getByRole('button', { name: PAI }).click();

		await expect(nav.getByRole('link', { name: 'Minha presença' })).toBeVisible();
		// Sem papel de admin ele não vê a lista de escalas nem a produtividade — as
		// mesmas condições de antes do agrupamento.
		await expect(nav.getByRole('link', { name: 'Ativas', exact: true })).toHaveCount(0);
		await expect(nav.getByRole('link', { name: 'Produtividade' })).toHaveCount(0);
		await expect(nav.getByRole('link', { name: 'Dados base' })).toHaveCount(0);
	});

	test('Admin Geral: Ativas é a lista em andamento; Finalizadas é o arquivo', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
		test.skip(!ok, 'D1 local indisponível');

		await page.goto('/operacoes/gise');
		const nav = await abrirMenu(page);

		const ativas = nav.getByRole('link', { name: 'Ativas', exact: true });
		const finalizadas = nav.getByRole('link', { name: 'Finalizadas', exact: true });
		await expect(ativas).toBeVisible();
		await expect(finalizadas).toBeVisible();
		await expect(ativas).toHaveClass(/bg-primary-500\/15/);
		await expect(finalizadas).not.toHaveClass(/bg-primary-500\/15/);

		await page.goto('/operacoes/gise/finalizadas');
		const navArquivo = await abrirMenu(page);
		await expect(navArquivo.getByRole('link', { name: 'Ativas', exact: true })).not.toHaveClass(
			/bg-primary-500\/15/
		);
		await expect(navArquivo.getByRole('link', { name: 'Finalizadas', exact: true })).toHaveClass(
			/bg-primary-500\/15/
		);
	});
});
