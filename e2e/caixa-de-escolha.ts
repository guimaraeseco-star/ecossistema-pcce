/**
 * Como a e2e mexe numa caixa de escolha com busca (`SearchableSelect`, E76).
 *
 * As listas de escolha deixaram de ser `<select>` nativo, então
 * `locator.selectOption` não serve mais. Aqui a e2e faz o que a pessoa faz:
 * clica no campo, digita um pedaço do nome e clica na opção. É de propósito
 * que passa pela BUSCA — um teste que escolhesse direto no campo escondido
 * provaria o formulário, não a caixa.
 *
 * `campo` é o campo de texto da caixa (papel `combobox`) — o `id` e o
 * `ariaLabel` do componente vão nele.
 */
import { expect, type Locator } from '@playwright/test';

const ITEM_DA_LISTA_ABERTA = '[data-part=content][data-state=open] [data-part=item]';
const ROTULO_DO_ITEM = '[data-part=item-text]';

function exatamente(texto: string): RegExp {
	const literal = texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp('^\\s*' + literal + '\\s*$');
}

/** Escolhe a opção cujo rótulo é EXATAMENTE `rotulo` (o segundo texto, o detalhe, não conta). */
export async function escolherNaCaixa(campo: Locator, rotulo: string): Promise<void> {
	const page = campo.page();
	await campo.click();
	await campo.fill(rotulo);
	await page
		.locator(ITEM_DA_LISTA_ABERTA)
		.filter({ has: page.locator(ROTULO_DO_ITEM, { hasText: exatamente(rotulo) }) })
		.first()
		.click();
	await expect(page.locator('[data-part=content][data-state=open]')).toHaveCount(0);
}

/** Os rótulos que a caixa oferece, com a lista inteira (sem nada digitado). Fecha ao terminar. */
export async function opcoesDaCaixa(campo: Locator): Promise<string[]> {
	const page = campo.page();
	await campo.click();
	await expect(page.locator(ITEM_DA_LISTA_ABERTA).first()).toBeVisible();
	const rotulos = await page.locator(`${ITEM_DA_LISTA_ABERTA} ${ROTULO_DO_ITEM}`).allInnerTexts();
	await campo.press('Escape');
	return rotulos.map((r) => r.trim());
}
