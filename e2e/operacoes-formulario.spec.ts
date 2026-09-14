import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import {
	autenticarPagina,
	seedSession,
	headersFormAction,
	execD1Local,
	queryD1Local
} from './session';

/**
 * O formulário único da operação e o slider de `/operacoes/gise/operacoes`.
 *
 * O que este spec protege é a UNIFICAÇÃO: até ago/2026 criar uma operação
 * preenchia só a identidade, e as vagas, horários e textos do PDF ficavam atrás
 * de um segundo botão, numa rota à parte. Quem criava saía da tela com metade da
 * operação por configurar, sem nada indicando isso.
 *
 * O caso central é o de ida e volta pelo BANCO: criar com os campos de
 * configuração preenchidos e conferir que as nove colunas chegaram lá. Sem isso,
 * um `name=` errado no formulário passaria despercebido — a tela salva, o toast
 * aparece, e o valor some.
 *
 * A distinção `NULL` × `0` também vive aqui, e é a que mais se perde numa
 * refatoração: vazio significa "herda o padrão do sistema" e zero significa
 * "esta equipe não tem essa vaga".
 *
 * A **exclusão** fecha o spec, e a asserção que importa é a negativa: a operação
 * COM escala não pode sumir nem por POST direto. O botão escondido na tela não é
 * autorização — quem recusa é a action, e é a contagem no servidor que decide.
 */

const NOME = 'OPERACAO E2E FORMULARIO';

/** Lê a operação do cenário direto do banco — é o efeito, não a tela, que importa. */
function operacaoGravada(): Record<string, unknown> | null {
	const linhas = queryD1Local<Record<string, unknown>>(
		`SELECT id, nome, sigla, usa_equipe_operacional, usa_equipe_seint,
		        vagas_operacional_dpc, vagas_operacional_oip, vagas_seint_dpc, vagas_seint_oip,
		        hora_entrada_padrao, hora_saida_padrao, breve_relatorio_titulo
		 FROM operacoes WHERE nome = '${NOME}'`
	);
	return linhas?.[0] ?? null;
}

/** Quantos formulários a operação tem gravados. `-1` quando o wrangler falha. */
function modelosDaOperacao(operacaoId: number): number {
	const linhas = queryD1Local<{ c: number }>(
		`SELECT count(*) AS c FROM gise_modelo_formulario WHERE operacao_id = ${operacaoId}`
	);
	return Number(linhas?.[0]?.c ?? -1);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	// O modelo sai junto: `gise_modelo_formulario.operacao_id` não tem FK, então
	// uma corrida interrompida deixaria a linha órfã ocupando `(operacao_id, tipo)`.
	execD1Local(`
		DELETE FROM gise_modelo_formulario
		 WHERE operacao_id IN (SELECT id FROM operacoes WHERE nome = '${NOME}');
		DELETE FROM operacoes WHERE nome = '${NOME}';
	`);
});

test.afterAll(() => {
	// O modelo sai junto: `gise_modelo_formulario.operacao_id` não tem FK, então
	// uma corrida interrompida deixaria a linha órfã ocupando `(operacao_id, tipo)`.
	execD1Local(`
		DELETE FROM gise_modelo_formulario
		 WHERE operacao_id IN (SELECT id FROM operacoes WHERE nome = '${NOME}');
		DELETE FROM operacoes WHERE nome = '${NOME}';
	`);
});

test('criar pede identificação E configuração no mesmo formulário, e grava as duas', async ({
	page
}) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');

	await page.goto('/operacoes/gise/operacoes');
	await page.getByRole('button', { name: 'Nova operação' }).click();

	// Desde ago/2026 o botão PERGUNTA o tipo antes de abrir: operação (este
	// fluxo, o catálogo de que as escalas extras dependem) ou plano operacional
	// (a operação com deslocamento, que vai para /operacoes/planos/novo). Escolher
	// "Operação" tem de cair exatamente no painel de sempre — é o que este
	// clique a mais garante que a bifurcação não mudou.
	await expect(page.getByText('O que você vai cadastrar?')).toBeVisible();
	await page.getByRole('button', { name: /^Operação/ }).click();

	// O painel aberto vive na URL — é o que faz o "voltar" do navegador desfazer.
	await expect(page).toHaveURL(/\?form=nova/);
	await expect(page.getByRole('heading', { name: 'Nova operação' })).toBeVisible();

	// Os campos que antes só existiam atrás do botão "Configurações" estão aqui.
	await expect(page.locator('#op_dpc')).toBeVisible();
	await expect(page.locator('#hora_entrada')).toBeVisible();
	await expect(page.locator('#breve_tit')).toBeVisible();

	await page.locator('#f_nome').fill(NOME);
	await page.locator('#f_sigla').fill('E2E-FORM');
	await page.locator('#op_dpc').fill('2');
	// ZERO, e não vazio: "esta equipe não tem vaga de DPC" é uma escolha.
	await page.locator('#seint_dpc').fill('0');
	await page.locator('#hora_entrada').fill('07:30');
	await page.locator('#breve_tit').fill('Relatório da operação E2E');
	// `op_oip` e `seint_oip` ficam VAZIOS de propósito: têm de gravar NULL.

	await page.getByRole('button', { name: 'Criar operação' }).click();
	await expect(page).not.toHaveURL(/\?form=/);

	const op = operacaoGravada();
	expect(op).not.toBeNull();
	expect(op!.sigla).toBe('E2E-FORM');
	expect(Number(op!.vagas_operacional_dpc)).toBe(2);
	expect(op!.hora_entrada_padrao).toBe('07:30');
	expect(op!.breve_relatorio_titulo).toBe('Relatório da operação E2E');

	// Zero é zero; vazio é NULL (herda). Confundir os dois faria "0 DPC" virar o
	// padrão do sistema no próximo salvamento.
	expect(Number(op!.vagas_seint_dpc)).toBe(0);
	expect(op!.vagas_operacional_oip).toBeNull();
	expect(op!.vagas_seint_oip).toBeNull();
	expect(op!.hora_saida_padrao).toBeNull();
});

test('editar abre o MESMO formulário, já preenchido com identidade e configuração', async ({
	page
}) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const op = operacaoGravada();
	test.skip(op == null, 'operação do cenário não foi criada');

	await page.goto('/operacoes/gise/operacoes');
	// Só a linha desta operação — a lista tem GISE e CRAJUBAR junto.
	const linha = page.locator('li').filter({ hasText: NOME });
	await linha.getByRole('button', { name: 'Editar' }).click();

	await expect(page).toHaveURL(new RegExp(`\\?form=${op!.id}`));
	await expect(page.getByRole('heading', { name: NOME })).toBeVisible();

	// Identidade e configuração, no mesmo lugar e com os valores de volta.
	await expect(page.locator('#f_sigla')).toHaveValue('E2E-FORM');
	await expect(page.locator('#op_dpc')).toHaveValue('2');
	await expect(page.locator('#seint_dpc')).toHaveValue('0');
	await expect(page.locator('#breve_tit')).toHaveValue('Relatório da operação E2E');
	// Campo herdado volta VAZIO, com o padrão do sistema no placeholder.
	await expect(page.locator('#op_oip')).toHaveValue('');
	await expect(page.locator('#op_oip')).toHaveAttribute('placeholder', /\d+/);

	// "Basear o formulário em" só existe ao criar: reclonar na edição
	// sobrescreveria um formulário já em uso.
	await expect(page.locator('#f_base')).toHaveCount(0);
});

test('o endereço antigo de configurações redireciona para o painel de edição', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const op = operacaoGravada();
	test.skip(op == null, 'operação do cenário não foi criada');

	await page.goto(`/operacoes/gise/operacoes/${op!.id}/config`);
	await expect(page).toHaveURL(new RegExp(`/operacoes/gise/operacoes\\?form=${op!.id}`));
	await expect(page.locator('#op_dpc')).toHaveValue('2');
});

test('a linha traz Formulário e Editar, e NÃO traz mais "Configurações"', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');

	await page.goto('/operacoes/gise/operacoes');

	const linha = page.locator('li').filter({ hasText: NOME });
	await expect(linha.getByRole('link', { name: 'Formulário' })).toBeVisible();
	await expect(linha.getByRole('button', { name: 'Editar' })).toBeVisible();
	// Virou parte de "Editar".
	await expect(linha.getByRole('link', { name: 'Configurações' })).toHaveCount(0);
	// E "Dados base" não aparece: esta operação não tem indicador percentual.
	// (a linha da que TEM está em `operacoes-linha-base.spec.ts`)
	await expect(linha.getByRole('link', { name: 'Dados base' })).toHaveCount(0);
});

test('o editor de formulário tem o voltar para as operações', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');

	await page.goto('/operacoes/presenca');
	// Acima do título, como nas demais telas de detalhe.
	const voltar = page.getByRole('link', { name: 'Voltar às operações' });
	await expect(voltar).toBeVisible();
	await voltar.click();
	await expect(page).toHaveURL(/\/operacoes\/gise\/operacoes/);
});

/** A GISE do cenário compartilhado — é a operação COM escalas do teste negativo. */
function operacaoComEscalas(): { id: number; escalas: number } | null {
	const linhas = queryD1Local<{ id: number; escalas: number }>(
		`SELECT o.id AS id, (SELECT count(*) FROM gise_escalas e WHERE e.operacao_id = o.id) AS escalas
		 FROM operacoes o WHERE o.nome = 'GISE'`
	);
	return linhas?.[0] ?? null;
}

test('"Excluir" só na operação sem escala nenhuma', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const com = operacaoComEscalas();
	test.skip(com == null || com.escalas === 0, 'a GISE do cenário está sem escalas');

	await page.goto('/operacoes/gise/operacoes');

	// A criada por este spec nunca recebeu escala: some de vez.
	const nova = page.locator('li').filter({ hasText: NOME });
	await expect(nova.getByRole('button', { name: 'Excluir', exact: true })).toBeVisible();

	// A GISE tem escala, e escala histórica é apontada por PDF assinado: só
	// desativar. O botão nem existe.
	const gise = page.locator('li').filter({ hasText: 'Grupo de Investigação' });
	await expect(gise.getByRole('button', { name: 'Excluir', exact: true })).toHaveCount(0);
	await expect(gise.getByRole('button', { name: 'Desativar' })).toBeVisible();
});

test('POST direto de exclusão numa operação COM escala é recusado', async ({ request }) => {
	const token = seedSession(FIXTURE.adminGeral.id, 'admin');
	test.skip(!token, 'D1 local indisponível');
	const com = operacaoComEscalas();
	test.skip(com == null || com.escalas === 0, 'a GISE do cenário está sem escalas');

	// Esconder o botão não é autorização: quem recusa é a action, recontando as
	// escalas no servidor. A contagem que a tela mostrou pode ter envelhecido.
	const res = await request.post('/operacoes/gise/operacoes?/excluir', {
		headers: headersFormAction(token!),
		form: { id: String(com!.id) }
	});

	const corpo = await res.text();
	expect(corpo).toContain('não pode ser excluída');
	// O efeito é o que importa: a operação continua lá, com as escalas dela.
	expect(operacaoComEscalas()?.escalas).toBe(com!.escalas);
});

test('excluir apaga a operação e o formulário dela', async ({ page }) => {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const op = operacaoGravada();
	test.skip(op == null, 'operação do cenário não foi criada');

	// O formulário é semeado aqui, e não pelo "basear em" da criação: o D1 local
	// pode estar sem os modelos da CRAJUBAR, e um clone vazio tornaria a asserção
	// de limpeza verdadeira sem provar nada.
	execD1Local(
		`INSERT INTO gise_modelo_formulario (operacao_id, tipo, config)
		 VALUES (${op!.id}, 'operacional', '[]');`
	);
	expect(modelosDaOperacao(Number(op!.id))).toBe(1);

	await page.goto('/operacoes/gise/operacoes');
	const linha = page.locator('li').filter({ hasText: NOME });
	await linha.getByRole('button', { name: 'Excluir', exact: true }).click();

	// Confirmação: o texto diz o que se perde junto, e o nome da operação.
	const modal = page.getByRole('dialog');
	await expect(modal).toContainText(NOME);
	await modal.getByRole('button', { name: 'Excluir operação' }).click();

	await expect(page.locator('li').filter({ hasText: NOME })).toHaveCount(0);
	expect(operacaoGravada()).toBeNull();
	// `gise_modelo_formulario.operacao_id` não tem FK (veio de `ALTER TABLE ADD
	// COLUMN`), então a limpeza é explícita — sem ela sobrariam linhas órfãs
	// ocupando o índice único `(operacao_id, tipo)` com um id que não existe mais.
	expect(modelosDaOperacao(Number(op!.id))).toBe(0);
});
