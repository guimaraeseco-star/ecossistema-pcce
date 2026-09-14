import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local, queryD1Local } from './session';

/**
 * O tipo de pergunta `lista_detalhada` — "quantidade + lista de nome e
 * procedimento", o mesmo layout dos tipos originais, mas REUTILIZÁVEL.
 *
 * O que estes testes protegem é a diferença que justifica o tipo existir: os
 * originais gravam em chave fixa (`prisoes_lista`) e por isso só funcionam uma
 * vez no formulário — duas perguntas do mesmo tipo escreveriam uma por cima da
 * outra. Este deriva as chaves da `key` da pergunta, então o teste central é
 * "duas perguntas, dois blobs".
 *
 * A expansão dessas listas no relatório (o caminho que termina em PDF assinado)
 * tem cobertura unitária em `db/__tests__/produtividade-lista-reutilizavel`.
 * Aqui é a ponta da ESCRITA: o que a tela realmente grava no banco.
 */

const GISE = FIXTURE.gise.id;
const EQUIPE = FIXTURE.giseEquipe.id;
const ROTA = `/operacoes/presenca/relatorio/${GISE}?equipeId=${EQUIPE}`;

async function silenciar(page: import('@playwright/test').Page) {}

const MODELO = JSON.stringify([
	{
		id: 1,
		key: 'extra_10',
		texto: 'Houve PRISÕES?',
		tipo: 'lista_detalhada',
		etapa: 'Ocorrências',
		subtexto_qtd: '1.1 QUANTIDADE:',
		subtexto_lista: '1.2 INFORMAR NOMES E PROCEDIMENTOS:'
	},
	{
		id: 2,
		key: 'extra_20',
		texto: 'Houve APREENSÕES?',
		tipo: 'lista_detalhada',
		etapa: 'Ocorrências',
		subtexto_qtd: '2.1 QUANTIDADE:',
		subtexto_lista: '2.2 INFORMAR NOMES E PROCEDIMENTOS:'
	}
]).replace(/'/g, "''");

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	execD1Local(`DELETE FROM gise_respostas_formulario WHERE gise_id = ${GISE};`);
	execD1Local(
		// Por (operação, tipo) desde a migração 0048; a escala da fixture é do GISE.
		`INSERT OR REPLACE INTO gise_modelo_formulario (operacao_id, tipo, config)
		 VALUES ((SELECT id FROM operacoes WHERE nome = 'GISE'), 'operacional', '${MODELO}');`
	);
	execD1Local(
		`INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp) SELECT ${GISE}, ${FIXTURE.membroGise.id}, datetime('now','-3 hours') WHERE NOT EXISTS (SELECT 1 FROM gise_presencas WHERE gise_id = ${GISE} AND policial_id = ${FIXTURE.membroGise.id});`
	);
});

test.afterAll(() => {
	// Escopado ao GISE: sem o WHERE, o modelo da CRAJUBAR (migração 0050) sumia.
	execD1Local(
		`DELETE FROM gise_modelo_formulario WHERE operacao_id = (SELECT id FROM operacoes WHERE nome = 'GISE');`
	);
});

test('tipo reutilizável: quantidade + detalhamento, e duas perguntas não se misturam', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 900 });
	await silenciar(page);
	const ok = await autenticarPagina(page, FIXTURE.membroGise.id);
	test.skip(!ok, 'D1 local indisponível');
	await page.goto(ROTA);

	await expect(page.getByText('Houve PRISÕES?')).toBeVisible();

	// Marca Sim na 1ª → abre quantidade + o primeiro item já preenchível.
	const cartao1 = page.locator('.nested-card').filter({ hasText: 'Houve PRISÕES?' });
	await cartao1.getByRole('button', { name: 'Sim', exact: true }).click();
	await expect(cartao1.getByText('1.1 QUANTIDADE:')).toBeVisible();
	await expect(cartao1.getByText('1.2 INFORMAR NOMES E PROCEDIMENTOS:')).toBeVisible();
	await expect(cartao1.getByText('Procedimento', { exact: true })).toBeVisible();

	await cartao1.getByPlaceholder('Nome Completo').fill('Fulano');
	await cartao1.getByPlaceholder('Número').fill('818181');

	// Segunda pergunta do MESMO tipo: lista própria, vazia.
	const cartao2 = page.locator('.nested-card').filter({ hasText: 'Houve APREENSÕES?' });
	await cartao2.getByRole('button', { name: 'Sim', exact: true }).click();
	await expect(cartao2.getByPlaceholder('Nome Completo')).toHaveValue('');
	await cartao2.getByPlaceholder('Nome Completo').fill('Sicrano');
	await cartao2.getByPlaceholder('Número').fill('929292');

	// A da primeira não foi tocada.
	await expect(cartao1.getByPlaceholder('Nome Completo')).toHaveValue('Fulano');

	// Quantidade 2 na primeira → dois blocos de item.
	await cartao1.locator('select').first().selectOption('2');
	await expect(cartao1.getByPlaceholder('Nome Completo')).toHaveCount(2);

	await page.getByRole('button', { name: 'Finalizar entrega' }).click();
	await expect(page).toHaveURL(/\/operacoes\/presenca\?giseId=/);

	// O blob gravado tem as DUAS listas, cada uma na sua chave.
	const linhas = queryD1Local<{ respostas: string }>(
		`SELECT respostas FROM gise_respostas_formulario WHERE gise_id = ${GISE};`
	);
	const blob = JSON.parse(linhas![0].respostas);
	expect(blob.extra_10__lista[0]).toEqual({ nome: 'Fulano', mandado: '818181' });
	expect(blob.extra_20__lista[0]).toEqual({ nome: 'Sicrano', mandado: '929292' });
});

test('editor: o novo tipo aparece e abre os campos de rótulo', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await silenciar(page);
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	await page.goto('/operacoes/presenca');
	await expect(page.getByRole('heading', { name: 'Configurar Formulário' })).toBeVisible();

	// Pelo id da pergunta, e não `select.first()`: o editor ganhou o seletor de
	// OPERAÇÃO no topo, e o primeiro `<select>` da página deixou de ser o do tipo
	// de campo. Locator posicional em tela que cresce é falha esperando acontecer.
	const select = page.locator('#p-tp-1');
	await expect(select).toHaveValue('lista_detalhada');
	await expect(select.locator('option[value="lista_detalhada"]')).toHaveText(
		/Quantidade \+ Lista Nome\/Procedimento/
	);

	// Os campos de rótulo estão visíveis para o tipo novo (ids `subqtd-`/`sublst-`).
	await expect(page.locator('#subqtd-1')).toHaveValue('1.1 QUANTIDADE:');
	await expect(page.locator('#sublst-1')).toHaveValue('1.2 INFORMAR NOMES E PROCEDIMENTOS:');
	// E o botão de sub-pergunta também (o tipo aceita filhos).
	await expect(page.getByTitle('Adicionar Sub-pergunta (se SIM)').first()).toBeVisible();
});
