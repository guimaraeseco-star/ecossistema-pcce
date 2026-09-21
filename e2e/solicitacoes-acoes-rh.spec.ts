import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import {
	autenticarPagina,
	execD1Local,
	headersFormAction,
	queryD1Local,
	seedSession
} from './session';

/**
 * A metade mais consequente do fluxo de solicitação: o AFASTAMENTO pedido pela
 * unidade — e o que a unidade NÃO alcança.
 *
 * O que este spec protege, e que nenhum teste unitário alcança, é a promessa que
 * a tela faz ao administrador de unidade: **pedir não afasta ninguém**. Entre o
 * pedido e a aprovação o histórico tem de continuar exatamente como estava — é
 * disso que depende a diferença entre "solicitação" e "execução", e é o tipo de
 * regressão que passa despercebida porque a tela de quem pediu não muda de jeito
 * nenhum quando o servidor grava cedo demais.
 *
 * Desde 20/09 (decisão do responsável) movimentação e desvinculação são do
 * Admin Geral: o admin de unidade não vê os botões e o POST direto recebe 403.
 * É a segunda promessa que este spec fecha — esconder botão não é autorização.
 *
 * As outras asserções fecham o ciclo: o Admin Geral vê o pedido INTEIRO (tipo,
 * período, CID e NUP — o afastamento não tem justificativa à parte) antes de decidir, e a aprovação credita a linha do
 * tempo a quem PEDIU — não ao aprovador, que só autorizou.
 */

const ADMIN_TMP = 99004;
const NUP = '10051.028034/2026-64';
const INICIO = '2026-09-01';

test.describe.configure({ mode: 'serial' });

/** Só o que este spec cria: o afastamento pedido para `policialA`. */
const LIMPAR =
	`DELETE FROM policial_acao_solicitacoes WHERE policial_id=${FIXTURE.policialA.id};` +
	`DELETE FROM policial_historico WHERE policial_id=${FIXTURE.policialA.id} AND tipo='afastamento' AND data_inicio='${INICIO}';`;

test.beforeAll(() => {
	execD1Local(
		LIMPAR +
			`INSERT OR REPLACE INTO administradores (id, login, senha, nome, primeiro_acesso) VALUES (${ADMIN_TMP}, 'e2e-admin-acoes', 'x', 'Admin Fixture Acoes', 0);` +
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

const afastamentosDoA = () =>
	queryD1Local<{ n: number }>(
		`SELECT COUNT(*) AS n FROM policial_historico WHERE policial_id=${FIXTURE.policialA.id} AND tipo='afastamento' AND data_inicio='${INICIO}';`
	)?.[0]?.n;

test('admin de unidade só vê Afastamento; movimentação e desvinculação são do DPI SUL', async ({
	page,
	request
}) => {
	const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto(`/servidores/${FIXTURE.policialA.id}`);
	await expect(page.getByRole('heading', { name: 'Ficha do Servidor' })).toBeVisible();
	await expect(page.getByRole('button', { name: /Afastamento/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Movimentação/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Desvinculação/ })).toHaveCount(0);

	// Esconder o botão não é autorização: o POST direto é recusado antes de
	// ler o corpo.
	const token = seedSession(FIXTURE.adminUnidade.id);
	test.skip(!token, 'D1 indisponível');
	for (const action of ['registrarMovimentacao', 'registrarDesvinculacao']) {
		const res = await request.post(`/servidores/${FIXTURE.policialA.id}?/${action}`, {
			headers: headersFormAction(token!),
			form: { unidade_destino: FIXTURE.unidadeB.nome, destino: 'x', data_evento: INICIO }
		});
		const corpo = (await res.json()) as { type?: string; status?: number };
		expect(corpo.status, action).toBe(403);
	}
});

test('admin de unidade PEDE o afastamento — nada entra no histórico', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto(`/servidores/${FIXTURE.policialA.id}`);
	await page.getByRole('button', { name: /Afastamento/ }).click();
	const modal = page.getByRole('dialog').filter({ hasText: 'Registrar Afastamento' });
	// Abre SEM tipo: "Selecione o tipo…" é a primeira coisa que o usuário vê.
	await expect(modal.locator('select[name="subtipo"]')).toHaveValue('');
	// Férias não estão na lista: entram pelo cartão Férias.
	await expect(modal.locator('select[name="subtipo"] option', { hasText: 'Férias' })).toHaveCount(
		0
	);
	await modal.locator('select[name="subtipo"]').selectOption('lts');
	// LTS pede o CID; CID-F abre a Portaria 39 na hora, para quem cadastra.
	await modal.getByLabel(/CID-F/).check();
	await expect(modal.getByRole('alert')).toContainText('Portaria nº 39/2026');
	await modal.getByLabel('Data Início').fill(INICIO);
	await modal.getByLabel(/Qtd Dias/).fill('5');
	// A data final é calculada, nunca digitada.
	await expect(modal.locator('input[name="data_fim"]')).toHaveValue('2026-09-05');
	// Sem descrição, PDF ou justificativa: o NUP é o fundamento do pedido.
	await modal.getByLabel(/NUP do processo/).fill('10051028034202664');
	await expect(modal.getByLabel('Justificativa do pedido')).toHaveCount(0);

	// O verbo do botão é parte do contrato: "Salvar" faria o administrador
	// acreditar que afastou quem continua em serviço.
	await modal.getByRole('button', { name: 'Solicitar' }).click();
	await expect(page.getByText('Solicitação enviada')).toBeVisible();

	// A promessa: nada mudou. O pedido aparece no quadro, o histórico não.
	await expect(page.getByText(NUP).first()).toBeVisible();
	expect(afastamentosDoA()).toBe(0);
});

test('admin geral vê o pedido inteiro na fila e aprova', async ({ page }) => {
	const ok = await autenticarPagina(page, ADMIN_TMP, 'admin');
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto('/solicitacoes');
	await expect(page.getByText('Movimentação, afastamento e desvinculação')).toBeVisible();
	// Decidir sem ver o período e o processo seria decidir no escuro.
	await expect(page.getByText(NUP).first()).toBeVisible();
	await expect(page.getByText(/tratamento de saúde/i).first()).toBeVisible();
	// O DPI SUL vê a Portaria 39 ANTES de aprovar.
	await expect(page.getByRole('alert').filter({ hasText: 'Portaria nº 39/2026' })).toBeVisible();

	await page.getByRole('button', { name: /Aprovar afastamento de Policial Fixture A/ }).click();
	await expect(page.getByText('Afastamento aprovada e aplicada')).toBeVisible();
	expect(afastamentosDoA()).toBe(1);
});

test('aprovado: a linha do tempo credita quem PEDIU', async ({ page }) => {
	const ok = await autenticarPagina(page, ADMIN_TMP, 'admin');
	if (!ok) test.skip(true, 'D1 indisponível');

	await page.goto(`/servidores/${FIXTURE.policialA.id}`);
	// Escopo na linha do tempo: o <option> do modal também diz "tratamento de saúde".
	const historico = page
		.locator('section, div', { has: page.getByRole('heading', { name: /Histórico do Servidor/ }) })
		.last();
	await expect(historico.getByText(/tratamento de saúde/i).first()).toBeVisible();
	await expect(historico.getByText('CID-F').first()).toBeVisible();
	// A linha do tempo credita o solicitante: foi ele quem apurou o fato; o
	// Admin Geral autorizou, e isso fica na auditoria.
	await expect(historico.getByText(FIXTURE.adminUnidade.nome).first()).toBeVisible();
});
