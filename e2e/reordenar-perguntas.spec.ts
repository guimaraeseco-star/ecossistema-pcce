import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local } from './session';

/**
 * Reordenar perguntas no editor do modelo — por arraste e pelas setas.
 *
 * O que estes testes de fato protegem é a RENUMERAÇÃO. O número da pergunta não
 * é um campo: mora dentro do texto que o admin escreveu ("4. Houve…") e se
 * repete nos sub-rótulos ("4.1 QUANTIDADE:"). O badge do card sai da posição e
 * se acerta sozinho, então um teste que só olhasse para ele passaria com o
 * texto errado — que é justamente o que o policial lê e o que sai no relatório.
 * Por isso as asserções são sobre o conteúdo dos `textarea` e dos sub-rótulos.
 *
 * A regra em si tem cobertura unitária em `lib/gise/__tests__/renumerar-perguntas.test`.
 */

async function silenciar(page: import('@playwright/test').Page) {}

const MODELO = JSON.stringify([
	{
		id: 1,
		key: 'a',
		texto: '1. Primeira',
		tipo: 'texto',
		etapa: 'Bloco'
	},
	{
		id: 2,
		key: 'b',
		texto: '2. Segunda',
		tipo: 'lista_detalhada',
		etapa: 'Bloco',
		subtexto_qtd: '2.1 QUANTIDADE:',
		subtexto_lista: '2.2 LISTAGEM:'
	},
	{ id: 3, key: 'c', texto: '3. Terceira', tipo: 'texto', etapa: 'Bloco' }
]).replace(/'/g, "''");

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	execD1Local(
		// O modelo é por (operação, tipo) desde a migração 0048 — sem `operacao_id`
		// a linha entra (o índice único trata NULL como distinto) mas o editor não
		// a encontra, e cai no modelo padrão do código.
		`INSERT OR REPLACE INTO gise_modelo_formulario (operacao_id, tipo, config)
		 VALUES ((SELECT id FROM operacoes WHERE nome = 'GISE'), 'operacional', '${MODELO}');`
	);
});
// Só o modelo do GISE: um DELETE sem WHERE levaria junto o da CRAJUBAR, semeado
// pela migração 0050 e usado por outros specs.
test.afterAll(() =>
	execD1Local(
		`DELETE FROM gise_modelo_formulario WHERE operacao_id = (SELECT id FROM operacoes WHERE nome = 'GISE');`
	)
);

/**
 * Textos dos cards de nível 0, na ordem da tela.
 *
 * O gate antes da leitura é o que impede uma corrida de virar falha com a
 * mensagem errada. Duas coisas se somam: `expect(await ordem(page))` é asserção
 * sobre VALOR, então não repete; e `evaluateAll` é das poucas APIs de locator
 * que NÃO esperam elemento — sem match, devolve `[]` na hora. Juntas, elas
 * traduzem "a tela ainda não renderizou" em `expected [...] to equal []`, que
 * aponta para persistência quebrada e manda quem investiga para o lado errado.
 *
 * Foi assim que o CI reprovou o último teste deste arquivo: depois do
 * `page.reload()` não havia nada esperando a lista voltar. Com `retries: 0` no
 * `playwright.config.ts`, uma corrida latente é falha dura na primeira vez que
 * o runner estiver lento.
 *
 * O gate mora AQUI, e não em cada chamador, porque quem escrever a próxima
 * chamada não vai saber da armadilha. As sete chamadas esperam três cards —
 * nenhuma espera lista vazia, então esperar pelo primeiro é seguro em todas.
 */
async function ordem(page: import('@playwright/test').Page) {
	const cards = page.locator('[role="list"] > [role="listitem"] textarea');
	await expect(cards.first()).toBeVisible();
	return cards.evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
}

test('setas movem e renumeram os rótulos', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await silenciar(page);
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	await page.goto('/operacoes/presenca');
	await expect(page.getByRole('heading', { name: 'Configurar Formulário' })).toBeVisible();

	expect(await ordem(page)).toEqual(['1. Primeira', '2. Segunda', '3. Terceira']);

	// Desce a primeira: ela vira "2." e a que era "2." vira "1.".
	await page.getByRole('button', { name: 'Mover a pergunta 1 para baixo' }).click();
	expect(await ordem(page)).toEqual(['1. Segunda', '2. Primeira', '3. Terceira']);

	// Os sub-rótulos do bloco acompanharam.
	await expect(page.locator('#subqtd-2')).toHaveValue('1.1 QUANTIDADE:');
	await expect(page.locator('#sublst-2')).toHaveValue('1.2 LISTAGEM:');

	// O badge do card também (é derivado da posição).
	const badges = await page.locator('[role="list"] > [role="listitem"] .w-8.h-8').allTextContents();
	expect(badges.map((b) => b.trim())).toEqual(['1', '2', '3']);

	// Sobe de volta: volta tudo ao estado inicial (renumeração é reversível).
	await page.getByRole('button', { name: 'Mover a pergunta 2 para cima' }).click();
	expect(await ordem(page)).toEqual(['1. Primeira', '2. Segunda', '3. Terceira']);
	await expect(page.locator('#subqtd-2')).toHaveValue('2.1 QUANTIDADE:');

	// Extremos desabilitados.
	await expect(page.getByRole('button', { name: 'Mover a pergunta 1 para cima' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Mover a pergunta 3 para baixo' })).toBeDisabled();
});

test('arrastar o card reordena e renumera', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await silenciar(page);
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	await page.goto('/operacoes/presenca');
	await expect(page.getByRole('heading', { name: 'Configurar Formulário' })).toBeVisible();
	expect(await ordem(page)).toEqual(['1. Primeira', '2. Segunda', '3. Terceira']);

	const cards = page.locator('[role="list"] > [role="listitem"]');
	const alca = cards.nth(0).locator('[title="Arraste para reordenar a pergunta"]');

	// A alça liga o `draggable` no mousedown; sem isso o card não arrasta.
	const caixaAlca = (await alca.boundingBox())!;
	await page.mouse.move(caixaAlca.x + caixaAlca.width / 2, caixaAlca.y + caixaAlca.height / 2);
	await page.mouse.down();
	await expect(cards.nth(0)).toHaveAttribute('draggable', 'true');

	// Playwright não sintetiza HTML5 drag por mouse; dispara os eventos direto.
	await cards.nth(0).dispatchEvent('dragstart');
	await cards.nth(2).dispatchEvent('dragenter');
	await cards.nth(2).dispatchEvent('drop');
	await page.mouse.up();

	expect(await ordem(page)).toEqual(['1. Segunda', '2. Terceira', '3. Primeira']);
});

test('salvar persiste a nova ordem já renumerada', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await silenciar(page);
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	await page.goto('/operacoes/presenca');
	await page.getByRole('button', { name: 'Mover a pergunta 3 para cima' }).click();
	expect(await ordem(page)).toEqual(['1. Primeira', '2. Terceira', '3. Segunda']);

	await page.getByRole('button', { name: /Salvar Modelo/ }).click();
	await expect(page.getByText('salvo com sucesso')).toBeVisible({ timeout: 10000 });

	await page.reload();
	expect(await ordem(page)).toEqual(['1. Primeira', '2. Terceira', '3. Segunda']);
	await expect(page.locator('#subqtd-2')).toHaveValue('3.1 QUANTIDADE:');
});
