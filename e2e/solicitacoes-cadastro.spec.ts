import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local } from './session';

/**
 * O fluxo de correção cadastral, de ponta a ponta, DEPOIS de ago/2026: quem pede
 * é o administrador da unidade, na ficha do servidor; quem decide é o Admin
 * Geral; o servidor apenas VÊ o resultado em "Meu perfil".
 *
 * O spec cobre as três pontas porque a mudança foi de DONO, não de tela — e o
 * caso que ele protege é a volta do formulário para `/perfil`, que devolveria ao
 * servidor a capacidade de pedir alteração do próprio cadastro. Daí a última
 * asserção: nenhum botão de solicitar sobrou lá.
 *
 * Telefone no formulário é só dígitos (máx. 11) — preencher máscara antiga
 * `(85) …` com `maxlength=11` truncava antes do limpar e a action recusava
 * (TELEFONE_RE pede ≥8 chars).
 */

const ADMIN_TMP = 99003;
/** DDD + número, só dígitos — contrato do input da ficha. */
const NOVO_TELEFONE = '85999990000';
const JUSTIFICATIVA = 'Servidor informou o novo número por ofício interno.';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	execD1Local(
		`UPDATE policiais SET telefone=NULL WHERE id=${FIXTURE.policialA.id};` +
			`DELETE FROM cadastro_solicitacoes WHERE policial_id=${FIXTURE.policialA.id};` +
			`INSERT OR REPLACE INTO administradores (id, login, senha, nome, primeiro_acesso) VALUES (${ADMIN_TMP}, 'e2e-admin-solic', 'x', 'Admin Fixture Solic', 0);` +
			`DELETE FROM aceites_termos WHERE usuario_tipo='admin' AND usuario_id=${ADMIN_TMP};` +
			`INSERT INTO aceites_termos (usuario_tipo, usuario_id, versao_termo, hash_termo, aceitou_lgpd, aceitou_uso_email, aceitou_uso_localizacao) SELECT 'admin', ${ADMIN_TMP}, versao_termo, hash_termo, 1, 1, 1 FROM aceites_termos WHERE usuario_tipo='policial' LIMIT 1;`
	);
});

test.afterAll(() => {
	execD1Local(
		`UPDATE policiais SET telefone=NULL WHERE id=${FIXTURE.policialA.id};` +
			`DELETE FROM cadastro_solicitacoes WHERE policial_id=${FIXTURE.policialA.id};` +
			`DELETE FROM aceites_termos WHERE usuario_tipo='admin' AND usuario_id=${ADMIN_TMP};` +
			`DELETE FROM administradores WHERE id=${ADMIN_TMP};`
	);
});

test('admin de unidade solicita alteração de telefone na ficha do servidor', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto(`/servidores/${FIXTURE.policialA.id}`);
	await expect(page.getByRole('heading', { name: 'Ficha do Servidor' })).toBeVisible();
	// A ficha do modo solicitação avisa o que ela faz — e o que NÃO faz.
	await expect(page.getByText('Movimentação', { exact: false }).first()).toBeVisible();

	// Escopo explícito: os três modais de RH têm um campo de justificativa com o
	// MESMO rótulo, e o alvo aqui é o do formulário cadastral.
	const formulario = page.locator('form[action="?/solicitarAlteracao"]');
	const botao = page.getByRole('button', { name: 'Solicitar alteração' });
	await expect(botao).toBeDisabled(); // sem mudanças e sem justificativa

	await formulario.getByLabel('Telefone').fill(NOVO_TELEFONE);
	// Ainda falta o motivo: todo pedido vai com justificativa.
	await expect(botao).toBeDisabled();

	await formulario.getByLabel('Justificativa do pedido').fill(JUSTIFICATIVA);
	await expect(botao).toBeEnabled();
	await botao.click();

	await expect(page.getByText('Solicitação enviada')).toBeVisible();
	await expect(page.getByText('Solicitações deste servidor')).toBeVisible();
	await expect(page.getByText('Pendente', { exact: true }).first()).toBeVisible();
});

test('admin geral vê o pedido inteiro na fila e aprova', async ({ page }) => {
	const ok = await autenticarPagina(page, ADMIN_TMP, 'admin');
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto('/solicitacoes');
	await expect(page.getByRole('heading', { name: 'Solicitações' })).toBeVisible();
	// A fila cadastral pinta o MESMO pedido duas vezes no DOM — tabela (`md+`)
	// e cards (abaixo de `md`). `getByText` casa os dois mesmo com um
	// `display:none`, e o Chromium desktop deste spec só vê a tabela.
	const tabela = page.getByRole('table');
	await expect(tabela.getByText('Policial Fixture A')).toBeVisible();
	await expect(tabela.getByText(NOVO_TELEFONE)).toBeVisible();
	// Decidir sem o motivo à vista seria decidir no escuro.
	await expect(tabela.getByText(JUSTIFICATIVA)).toBeVisible();
	await expect(tabela.getByText(FIXTURE.adminUnidade.nome)).toBeVisible();

	await tabela.getByRole('button', { name: /Aprovar solicitação de Policial Fixture A/ }).click();
	await expect(page.getByText('Alteração aprovada e aplicada')).toBeVisible();
	// Asserção sobre a FIXTURE, não sobre o estado global da tabela. Antes era
	// `getByText('Nenhuma solicitação pendente.')`, que exige a lista INTEIRA
	// vazia: qualquer solicitação pendente não relacionada no D1 local (dado de
	// quem estava usando o app) derrubava o spec, com uma falha que parece
	// regressão e não é. Em CI passava sempre, porque lá o banco nasce limpo.
	await expect(
		page.getByRole('button', { name: /Aprovar solicitação de Policial Fixture A/ })
	).toBeHidden();
});

test('o servidor vê o telefone aplicado — e não tem como pedir nada em Meu perfil', async ({
	page
}) => {
	const ok = await autenticarPagina(page, FIXTURE.policialA.id);
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto('/perfil');
	await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible();
	await expect(page.getByText(NOVO_TELEFONE)).toBeVisible();

	// O que a página deixou de oferecer. `/perfil` virou leitura mais o e-mail
	// pessoal e a chave de assinatura, que são do titular.
	await expect(page.getByRole('button', { name: 'Solicitar alteração' })).toHaveCount(0);
	await expect(page.getByText('Minhas solicitações')).toHaveCount(0);
	await expect(page.getByText('administrador da sua unidade')).toBeVisible();
});
