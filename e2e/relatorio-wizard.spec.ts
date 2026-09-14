import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local } from './session';

/**
 * Wizard do relatório de produtividade (`/operacoes/presenca/relatorio/[giseId]`) — o
 * formulário que saiu do modal de `/operacoes/presenca` e virou rota com etapas.
 *
 * Cobre o que só o navegador prova: o gate de entrada do `load`, o fatiamento
 * do modelo em etapas (as 4 do padrão operacional), a resposta sobrevivendo à
 * troca de etapa, o autosave em `localStorage` sobrevivendo a um reload, e o
 * envio devolvendo à tela de presença com a escala SELECIONADA (a URL é lida
 * de volta — antes o retorno caía na lista).
 *
 * Fica de fora: o rascunho em modo anônimo/cota estourada e a corrida entre
 * dois membros da mesma equipe — roteiro manual (TESTING.md §13.1).
 */

const GISE = FIXTURE.gise.id;
const EQUIPE = FIXTURE.giseEquipe.id;
const ROTA = `/operacoes/presenca/relatorio/${GISE}?equipeId=${EQUIPE}`;

/** Entrada confirmada é o pré-requisito da rota; o global-setup limpa presenças. */
function confirmarEntrada() {
	execD1Local(
		`INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp)` +
			` SELECT ${GISE}, ${FIXTURE.membroGise.id}, datetime('now','-3 hours')` +
			` WHERE NOT EXISTS (SELECT 1 FROM gise_presencas WHERE gise_id = ${GISE} AND policial_id = ${FIXTURE.membroGise.id});`
	);
}

test.describe('Wizard do relatório de produtividade', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(() => {
		// Sem modelo salvo o load cai no DEFAULT_QUESTIONS_FORM_OPERACIONAL, que é
		// justamente quem traz as 4 etapas.
		// Só o do GISE: um DELETE sem WHERE levaria o modelo da CRAJUBAR junto.
		execD1Local(
			`DELETE FROM gise_modelo_formulario WHERE operacao_id = (SELECT id FROM operacoes WHERE nome = 'GISE');`
		);
		execD1Local(`DELETE FROM gise_respostas_formulario WHERE gise_id = ${GISE};`);
	});

	test('sem entrada confirmada → volta para a tela de presença', async ({ page }) => {
		execD1Local(`DELETE FROM gise_presencas WHERE gise_id = ${GISE};`);
		const ok = await autenticarPagina(page, FIXTURE.membroGise.id);
		test.skip(!ok, 'D1 local indisponível');

		await page.goto(ROTA);
		await expect(page).toHaveURL(/\/operacoes\/presenca\?giseId=/);
	});

	test('etapas, navegação, autosave e envio', async ({ page }) => {
		confirmarEntrada();
		const ok = await autenticarPagina(page, FIXTURE.membroGise.id);
		test.skip(!ok, 'D1 local indisponível');

		await page.goto(ROTA);
		await expect(page.getByRole('heading', { name: 'Relatório de Produtividade' })).toBeVisible();

		const nav = page.getByRole('navigation', { name: 'Etapas do relatório' });
		await expect(nav.getByRole('button')).toHaveCount(4);
		await expect(nav.getByRole('button')).toContainText([
			'Viatura',
			'Ocorrências',
			'Apreensões',
			'Diligências'
		]);

		// Cada etapa mostra SÓ as perguntas dela — não as 19 de uma vez.
		await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
		await expect(page.getByText('1. DIGITE A VTR E A PLACA')).toBeVisible();
		await expect(page.getByText('19. Descreva resumidamente')).toHaveCount(0);

		await page.getByPlaceholder('Ex: XXX-0000').fill('ABC-1234');
		await expect(page.getByText(/Rascunho salvo às \d{2}:\d{2}/)).toBeVisible({ timeout: 5000 });

		// Trocar de etapa não perde resposta: o blob vive na página, não no passo.
		await page.getByRole('button', { name: 'Avançar' }).click();
		await expect(page.getByText('Etapa 2 de 4')).toBeVisible();
		await page.getByRole('button', { name: 'Anterior', exact: true }).click();
		await expect(page.getByPlaceholder('Ex: XXX-0000')).toHaveValue('ABC-1234');

		// Rascunho restaurado do localStorage (nada foi enviado ainda).
		await page.reload();
		await expect(page.getByPlaceholder('Ex: XXX-0000')).toHaveValue('ABC-1234');

		await nav.getByRole('button', { name: /Diligências/ }).click();
		await expect(page.getByText('Etapa 4 de 4')).toBeVisible();
		await page.getByRole('button', { name: 'Finalizar entrega' }).click();

		// Volta para a escala SELECIONADA, com o card do passo já atualizado: a
		// Produtividade entra em estado "concluído" (carimbo de envio + botão de
		// retificar), agora dentro do card único da etapa.
		await expect(page).toHaveURL(/\/operacoes\/presenca\?giseId=/);
		await expect(page.getByText(/Enviado em/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Retificar dados' })).toBeVisible();
	});

	test('desktop: coluna de leitura, sem estouro horizontal', async ({ page }) => {
		confirmarEntrada();
		await page.setViewportSize({ width: 1920, height: 900 });
		const ok = await autenticarPagina(page, FIXTURE.membroGise.id);
		test.skip(!ok, 'D1 local indisponível');
		await page.goto(ROTA);
		await expect(page.getByText('Etapa 1 de 4')).toBeVisible();

		// `max-w-3xl` no conteúdo: num viewport de 1920 o card da pergunta continua
		// em 768px. É a queixa que originou a rota — banda larga com o campo perdido.
		const cartao = await page.locator('.nested-card').first().boundingBox();
		expect(cartao?.width).toBeLessThanOrEqual(768);

		const estouro = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(estouro).toBeLessThanOrEqual(0);
	});

	test('celular: navegador mostra só a etapa anterior e a atual', async ({ page }) => {
		confirmarEntrada();
		await page.setViewportSize({ width: 390, height: 844 });
		const ok = await autenticarPagina(page, FIXTURE.membroGise.id);
		test.skip(!ok, 'D1 local indisponível');
		await page.goto(ROTA);
		await expect(page.getByText('Etapa 1 de 4')).toBeVisible();

		const nav = page.getByRole('navigation', { name: 'Etapas do relatório' });
		const visiveis = nav.getByRole('button');
		const caixaNav = (await nav.boundingBox())!;
		/** Distância entre a borda direita do botão e a da barra. */
		const folgaDireita = async (i: number) => {
			const b = (await visiveis.nth(i).boundingBox())!;
			return caixaNav.x + caixaNav.width - (b.x + b.width);
		};

		// 1ª etapa: não há anterior, e a atual continua encostada à direita — a
		// posição dela não pode mudar quando a anterior aparecer.
		await expect(visiveis).toHaveCount(1);
		expect(await folgaDireita(0)).toBeLessThan(2);

		// Daí em diante: anterior à esquerda, atual à direita.
		await page.getByRole('button', { name: 'Avançar' }).click();
		await expect(page.getByText('Etapa 2 de 4')).toBeVisible();
		await expect(visiveis).toHaveCount(2);
		await expect(visiveis.nth(0)).toContainText('Viatura');
		await expect(visiveis.nth(1)).toContainText('Ocorrências');
		const bAnterior = (await visiveis.nth(0).boundingBox())!;
		expect(bAnterior.x - caixaNav.x).toBeLessThan(2);
		expect(await folgaDireita(1)).toBeLessThan(2);

		// A anterior continua clicável, e nada empurra a página para os lados.
		await visiveis.nth(0).click();
		await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
		const estouro = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(estouro).toBeLessThanOrEqual(0);
	});

	test('editor do Admin Geral: campo Etapa por pergunta e prévia ao vivo', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
		test.skip(!ok, 'D1 local indisponível');
		await page.goto('/operacoes/presenca');
		await expect(page.getByRole('heading', { name: 'Configurar Formulário' })).toBeVisible();

		// A prévia usa a MESMA `agruparPorEtapa` do wizard: o que o admin vê aqui é
		// o que o policial vai ver lá.
		await expect(page.getByText('Etapas do formulário (4)')).toBeVisible();

		const campos = page.locator('input[list="etapas-em-uso"]');
		await expect(campos).toHaveCount(19); // só nível 0 — filhos herdam do pai
		await expect(campos.first()).toHaveValue('Viatura');

		await campos.first().fill('Início');
		await expect(page.getByText('Etapas do formulário (5)')).toBeVisible();
	});

	test('editor: o rodapé de salvar fica FIXO e diz se há alteração pendente', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
		test.skip(!ok, 'D1 local indisponível');
		await page.goto('/operacoes/presenca');
		await expect(page.getByRole('heading', { name: 'Configurar Formulário' })).toBeVisible();

		const salvar = page.getByRole('button', { name: /Salvar Modelo/ });

		// Recém-aberto: nada foi tocado. A barra dizia "Pronto para salvar" aqui,
		// que era o `else` de um `if` sobre o estado de carregamento — a mesma frase
		// tendo-se mexido em algo ou não.
		await expect(page.getByText('Tudo salvo')).toBeVisible();

		// E o botão está na tela SEM rolar: o modelo tem 19 perguntas de nível 0, e
		// antes disto gravar exigia percorrer a página inteira.
		await expect(salvar).toBeInViewport();

		// Mexer numa pergunta muda o estado — é a função que a barra não tinha.
		await page.locator('input[list="etapas-em-uso"]').first().fill('Início');
		await expect(page.getByText('Alterações não salvas')).toBeVisible();

		// Rolar até o fim não descola o rodapé: ele é `sticky`, então continua no pé
		// da tela em vez de sair por cima do conteúdo ou ficar para trás.
		await page.mouse.wheel(0, 20000);
		await expect(salvar).toBeInViewport();
	});
});
