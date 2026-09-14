import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina } from './session';

/**
 * Smoke tests das telas GISE sobre a fixture semeada pelo global-setup
 * (GISE 'em_andamento' com seccional preenchida, 1 equipe operacional,
 * 1 membro e supervisor DPC designado) + sessão semeada (e2e/session.ts).
 *
 * O objetivo é dar rede de segurança MÍNIMA para refatorar os componentes
 * dessas telas (GiseSupervisao, GiseSeccional, RelatorioProdutividade):
 * carregamento, permissão de acesso e presença dos blocos principais.
 */

test.describe('GISE — detalhe (/operacoes/gise/[id])', () => {
	test('supervisor DPC designado acessa e vê o quadro de supervisão', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.supervisor.id);
		if (!ok) test.skip(true, 'wrangler/D1 local indisponível');

		await page.goto(`/operacoes/gise/${FIXTURE.gise.id}`);

		// Não foi redirecionado (permissão de supervisor reconhecida)
		await expect(page).toHaveURL(new RegExp(`/operacoes/gise/${FIXTURE.gise.id}`));

		// Quadro de supervisão com o supervisor designado
		await expect(page.getByText('DPC Supervisão').first()).toBeVisible();
		await expect(page.getByText(FIXTURE.supervisor.nome).first()).toBeVisible();

		// Card da seccional da fixture
		await expect(page.getByText(FIXTURE.seccional.nome).first()).toBeVisible();
	});

	test('policial sem vínculo com a GISE é redirecionado', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.policialB.id);
		if (!ok) test.skip(true, 'wrangler/D1 local indisponível');

		await page.goto(`/operacoes/gise/${FIXTURE.gise.id}`);
		// O load redireciona quem não é admin/supervisor/seccional participante.
		await expect(page).not.toHaveURL(new RegExp(`/operacoes/gise/${FIXTURE.gise.id}`));
	});
});

test.describe('Res. GISE — visão do membro (/operacoes/presenca)', () => {
	test('membro da equipe vê sua escala ativa listada', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.membroGise.id);
		if (!ok) test.skip(true, 'wrangler/D1 local indisponível');

		await page.goto('/operacoes/presenca');
		await expect(page).toHaveURL(/\/operacoes\/presenca/);

		// A linha da GISE da fixture aparece na lista "Minhas escalas extras"
		// (formato da linha: "01/06/2026 #99001 operacional ...").
		// O título perdeu o "GISE": a lista passou a incluir escalas de QUALQUER
		// operação, e nomeá-las GISE virou informação errada.
		await expect(page.getByText('Minhas escalas extras').first()).toBeVisible();
		await expect(page.getByText(`#${FIXTURE.gise.id}`).first()).toBeVisible();
	});

	test('policial sem vínculo GISE é redirecionado para fora', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.policialB.id);
		if (!ok) test.skip(true, 'wrangler/D1 local indisponível');

		await page.goto('/operacoes/presenca');
		await expect(page).not.toHaveURL(/\/operacoes\/presenca/);
	});
});
