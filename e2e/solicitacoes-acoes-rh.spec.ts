import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local } from './session';

/**
 * A metade mais consequente do fluxo de solicitação: MOVIMENTAR um servidor.
 *
 * O que este spec protege, e que nenhum teste unitário alcança, é a promessa que
 * a tela faz ao administrador de unidade: **pedir não move ninguém**. Entre o
 * pedido e a aprovação o cadastro tem de continuar exatamente como estava — é
 * disso que depende a diferença entre "solicitação" e "execução", e é o tipo de
 * regressão que passa despercebida porque a tela de quem pediu não muda de jeito
 * nenhum quando o servidor grava cedo demais.
 *
 * As duas outras asserções fecham o ciclo: o Admin Geral vê o pedido INTEIRO
 * (destino e justificativa) antes de decidir, e a aprovação credita a linha do
 * tempo a quem PEDIU — não ao aprovador, que só autorizou.
 *
 * Restaura a lotação de `policialA` no fim: outros specs (cross-lotação,
 * assinatura) contam com ela na unidade A.
 */

const ADMIN_TMP = 99004;
const DESTINO = FIXTURE.unidadeB.nome;
const JUSTIFICATIVA = 'Portaria 45/2026 — reforço na unidade B.';

test.describe.configure({ mode: 'serial' });

/** Só o que este spec cria: movimentações para a unidade B. */
const LIMPAR =
	`DELETE FROM policial_acao_solicitacoes WHERE policial_id=${FIXTURE.policialA.id};` +
	`DELETE FROM policial_historico WHERE policial_id=${FIXTURE.policialA.id} AND tipo='movimentacao' AND unidade_destino='${DESTINO}';` +
	`UPDATE policiais SET lotacao='${FIXTURE.unidadeA.nome}' WHERE id=${FIXTURE.policialA.id};`;

test.beforeAll(() => {
	execD1Local(
		LIMPAR +
			`INSERT OR REPLACE INTO administradores (id, login, senha, nome, primeiro_acesso) VALUES (${ADMIN_TMP}, 'e2e-admin-acoes', 'x', 'Admin Fixture Acoes', 0);` +
			`DELETE FROM aceites_termos WHERE usuario_tipo='admin' AND usuario_id=${ADMIN_TMP};` +
			`INSERT INTO aceites_termos (usuario_tipo, usuario_id, versao_termo, hash_termo, aceitou_lgpd, aceitou_uso_email, aceitou_uso_localizacao) SELECT 'admin', ${ADMIN_TMP}, versao_termo, hash_termo, 1, 1, 1 FROM aceites_termos WHERE usuario_tipo='policial' LIMIT 1;`
	);
});

test.afterAll(() => {
	execD1Local(
		LIMPAR +
			`DELETE FROM aceites_termos WHERE usuario_tipo='admin' AND usuario_id=${ADMIN_TMP};` +
			`DELETE FROM administradores WHERE id=${ADMIN_TMP};`
	);
});

test('admin de unidade PEDE a movimentação — o servidor não sai do lugar', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto(`/servidores/${FIXTURE.policialA.id}`);
	await expect(page.getByRole('heading', { name: 'Ficha do Servidor' })).toBeVisible();

	await page.getByRole('button', { name: /Movimentação/ }).click();
	const modal = page.getByRole('dialog').filter({ hasText: 'Nova Movimentação' });
	await modal.getByLabel('Unidade Destino').selectOption(DESTINO);
	await modal.getByLabel('Data Movimentação').fill('2026-09-01');
	await modal.getByLabel('Justificativa do pedido').fill(JUSTIFICATIVA);

	// O verbo do botão é parte do contrato: "Salvar" faria o administrador
	// acreditar que transferiu quem continua onde estava.
	await modal.getByRole('button', { name: 'Solicitar' }).click();
	await expect(page.getByText('Solicitação enviada')).toBeVisible();

	// A promessa: nada mudou no cadastro. O campo Lotação da ficha ainda mostra
	// a unidade de origem.
	await expect(
		page.locator('form[action="?/solicitarAlteracao"]').getByRole('textbox', { name: 'Lotação' })
	).toHaveValue(FIXTURE.unidadeA.nome);
});

test('admin geral vê o pedido inteiro na fila e aprova', async ({ page }) => {
	const ok = await autenticarPagina(page, ADMIN_TMP, 'admin');
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto('/solicitacoes');
	await expect(page.getByText('Movimentação, afastamento e desvinculação')).toBeVisible();
	// Decidir sem ver o destino e o motivo seria decidir no escuro.
	await expect(page.getByText(JUSTIFICATIVA)).toBeVisible();
	await expect(page.getByText(DESTINO).first()).toBeVisible();

	await page.getByRole('button', { name: /Aprovar movimentação de Policial Fixture A/ }).click();
	await expect(page.getByText('Movimentação aprovada e aplicada')).toBeVisible();
});

test('aprovada: a lotação trocou e o evento credita quem PEDIU', async ({ page }) => {
	const ok = await autenticarPagina(page, ADMIN_TMP, 'admin');
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto(`/servidores/${FIXTURE.policialA.id}`);
	// Modo direto (Admin Geral): a lotação é um <select>, com a unidade nova.
	await expect(page.getByLabel('Lotação')).toHaveValue(DESTINO);

	// A linha do tempo credita o solicitante: foi ele quem apurou o fato e
	// anexou a portaria; o Admin Geral autorizou, e isso fica na auditoria.
	await expect(page.getByText(FIXTURE.adminUnidade.nome).first()).toBeVisible();
});
