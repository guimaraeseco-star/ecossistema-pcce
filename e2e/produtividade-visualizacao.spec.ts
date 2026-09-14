import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local, queryD1Local, expandirMaisFiltros } from './session';

/**
 * Ano das fixtures = ano CORRENTE, não `2026` fixo.
 *
 * Duas razões, e as duas são bomba-relógio:
 *  - desde o B-1 o painel abre recortado ao ANO CORRENTE no servidor; fixture
 *    de 2026 ficaria fora da janela em 01/jan/2027 e a tela abriria vazia;
 *  - o seletor `#f-ano` oferece só QUATRO anos (`currentYear-3`…`currentYear`),
 *    então `selectOption('2026')` deixaria de existir em 2030.
 */
const ANO = new Date().getFullYear();

/**
 * O eixo do painel de produtividade: comparar DELEGACIAS ou SECCIONAIS.
 *
 * O que este spec protege é a promessa que torna o seletor legítimo: trocar de
 * eixo **não recorta dado nenhum**, só muda por qual chave a mesma lista é
 * somada. Se o total mudasse ao alternar, o painel estaria afirmando duas
 * produções diferentes para o mesmo período — e nada na tela diria qual é a
 * verdadeira.
 *
 * Os dois casos que só aparecem com dado real no banco:
 *
 * - a soma por delegacia bate com a soma por seccional;
 * - a equipe escalada direto na seccional, SEM slot de delegacia, aparece como
 *   linha própria no modo Delegacias. É a decisão registrada em
 *   `gruposDaVisualizacao`, e sem ela a soma do ranking ficaria menor que o
 *   total do painel sem nada explicando a diferença.
 *
 * A conta em si (agrupar, ordenar, recortar) tem cobertura unitária em
 * `produtividade/__tests__/agrupamento` e `.../stats`.
 */

/** Ids exclusivos deste spec — não colidem com a fixture nem com os outros cenários. */
const C = {
	operacao: 'OPERACAO E2E VISUALIZACAO',
	seccional: { id: 99410, nome: 'SECCIONAL E2E VISU' },
	crato: { id: 99420, nome: 'DELEGACIA E2E CRATO' },
	barbalha: { id: 99430, nome: 'DELEGACIA E2E BARBALHA' },
	gise: 99401,
	giseSeccional: 99401,
	slotCrato: 99401,
	slotBarbalha: 99402,
	/** Três equipes: Crato, Barbalha e uma SEM slot (fica na seccional). */
	equipeCrato: 99401,
	equipeBarbalha: 99402,
	equipeSemSlot: 99403
};

/** Presos por equipe: 5 (Crato) + 3 (Barbalha) + 2 (sem slot) = 10 no período. */
const TOTAL = 10;

let cenarioOk = false;

test.beforeAll(() => {
	cenarioOk = execD1Local(`
		INSERT INTO operacoes (nome, sigla) VALUES ('${C.operacao}', 'E2E-VIS')
		ON CONFLICT(nome) DO NOTHING;
		INSERT INTO unidades (id, nome, tipo) VALUES
			(${C.seccional.id}, '${C.seccional.nome}', 'seccional'),
			(${C.crato.id}, '${C.crato.nome}', 'delegacia'),
			(${C.barbalha.id}, '${C.barbalha.nome}', 'delegacia')
		ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, tipo = excluded.tipo;

		INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, operacao_id)
		VALUES (${C.gise}, '${ANO}-05-04', 'finalizada', '08:00', '16:00',
			(SELECT id FROM operacoes WHERE nome = '${C.operacao}'))
		ON CONFLICT(id) DO UPDATE SET operacao_id = excluded.operacao_id;

		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status)
		VALUES (${C.giseSeccional}, ${C.gise}, ${C.seccional.id}, 'preenchida')
		ON CONFLICT(id) DO UPDATE SET gise_id = excluded.gise_id;

		DELETE FROM gise_seccional_unidades WHERE gise_seccional_id = ${C.giseSeccional};
		INSERT INTO gise_seccional_unidades (id, gise_seccional_id, unidade_id) VALUES
			(${C.slotCrato}, ${C.giseSeccional}, ${C.crato.id}),
			(${C.slotBarbalha}, ${C.giseSeccional}, ${C.barbalha.id});

		DELETE FROM gise_equipes WHERE gise_seccional_id = ${C.giseSeccional};
		INSERT INTO gise_equipes (id, gise_seccional_id, gise_unidade_id, tipo, slots_dpc, slots_oip) VALUES
			(${C.equipeCrato}, ${C.giseSeccional}, ${C.slotCrato}, 'operacional', 1, 3),
			(${C.equipeBarbalha}, ${C.giseSeccional}, ${C.slotBarbalha}, 'operacional', 1, 3),
			-- Sem slot: a produção dela resolve para a própria SECCIONAL.
			(${C.equipeSemSlot}, ${C.giseSeccional}, NULL, 'operacional', 1, 3);

		-- O modelo da operação. Sem ele o bloco de prisões nem apareceria: ele
		-- depende de o formulário TER a pergunta que o alimenta (\`temBlocoPrisoes\`),
		-- e a P7 só vira gráfico porque está MARCADA.
		DELETE FROM gise_modelo_formulario
			WHERE operacao_id = (SELECT id FROM operacoes WHERE nome = '${C.operacao}');
		INSERT INTO gise_modelo_formulario (operacao_id, tipo, config) VALUES
			((SELECT id FROM operacoes WHERE nome = '${C.operacao}'), 'operacional',
			 '[{"id":4,"texto":"4. FLAGRANTE","tipo":"prisoes_maiores","key":"procedimentos_flagrante_bool","filhos":[]},{"id":7,"texto":"7. PRISOES","tipo":"select_99","key":"prisoes_apreensoes_flagrante","grafico":{"colunas":true},"filhos":[]}]');

		-- Um policial POR equipe: há UNIQUE em (gise_id, policial_id), porque cada
		-- pessoa entrega um relatório por escala.
		DELETE FROM gise_respostas_formulario WHERE gise_id = ${C.gise};
		INSERT INTO gise_respostas_formulario (gise_id, policial_id, equipe_id, respostas) VALUES
			(${C.gise}, ${FIXTURE.membroGise.id}, ${C.equipeCrato}, '{"prisoes_apreensoes_flagrante":5}'),
			(${C.gise}, ${FIXTURE.policialA.id}, ${C.equipeBarbalha}, '{"prisoes_apreensoes_flagrante":3}'),
			(${C.gise}, ${FIXTURE.policialB.id}, ${C.equipeSemSlot}, '{"prisoes_apreensoes_flagrante":2}');
	`);
});

test.afterAll(() => {
	execD1Local(`
		DELETE FROM gise_escalas WHERE id = ${C.gise};
		DELETE FROM gise_modelo_formulario
			WHERE operacao_id = (SELECT id FROM operacoes WHERE nome = '${C.operacao}');
		DELETE FROM operacoes WHERE nome = '${C.operacao}';
	`);
});

function operacaoId(): number | null {
	const linhas = queryD1Local<{ id: number }>(
		`SELECT id FROM operacoes WHERE nome = '${C.operacao}'`
	);
	return linhas?.[0]?.id ?? null;
}

/** Os totais do card de prisões, na ordem em que a tela os mostra. */
async function totaisDoRanking(page: import('@playwright/test').Page): Promise<number[]> {
	const card = page.locator('.card').filter({ hasText: 'Ranking' }).first();
	const textos = await card.locator('p.text-xl').allInnerTexts();
	return textos.map((t) => Number(t.replace(/\D/g, '')) || 0);
}

test.describe.configure({ mode: 'serial' });

test('a barra tem os quatro controles de comparação e os dois de recorte', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId();
	test.skip(id == null, 'operação do cenário não foi criada');

	await page.goto(`/operacoes/produtividade?operacaoId=${id}`);

	// Linha 1: o que está em foco — eixo e tipo de equipe (a operação só aparece
	// quando há mais de uma).
	await expect(page.getByRole('button', { name: 'Seccionais', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Delegacias', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Operacional', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Mais filtros', exact: true })).toBeVisible();
	await expect(page.locator('#f-qtd')).toHaveCount(0);

	await expandirMaisFiltros(page);
	// Linha 2: o recorte — quantas unidades, em que ordem, em que período.
	await expect(page.locator('#f-qtd')).toBeVisible();
	await expect(page.locator('#f-ordem')).toBeVisible();
	await expect(page.locator('#f-ano')).toBeVisible();

	// O filtro de seccional saiu — quem escolhe o eixo é o "Visualizar por".
	await expect(page.locator('#f-sec')).toHaveCount(0);
});

test('trocar o eixo não muda o total, só a quebra', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId();
	test.skip(id == null, 'operação do cenário não foi criada');

	await page.goto(`/operacoes/produtividade?operacaoId=${id}`);
	await expandirMaisFiltros(page);
	await page.locator('#f-ano').selectOption(String(ANO));

	// Seccionais (padrão): tudo numa linha só, com o total do período.
	await expect(page.getByText(C.seccional.nome.split(' do ')[0]).first()).toBeVisible();
	const porSeccional = await totaisDoRanking(page);
	expect(porSeccional.reduce((a, b) => a + b, 0)).toBe(TOTAL);

	// Delegacias: a mesma produção, repartida.
	await page.getByRole('button', { name: 'Delegacias', exact: true }).click();
	const porDelegacia = await totaisDoRanking(page);
	expect(porDelegacia.reduce((a, b) => a + b, 0)).toBe(TOTAL);
	// E agora existe mais de uma linha com produção — é o ponto do pedido.
	expect(porDelegacia.filter((n) => n > 0).length).toBeGreaterThan(1);
});

test('a equipe sem slot aparece como linha própria no modo Delegacias', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId();
	test.skip(id == null, 'operação do cenário não foi criada');

	await page.goto(`/operacoes/produtividade?operacaoId=${id}`);
	await expandirMaisFiltros(page);
	await page.locator('#f-ano').selectOption(String(ANO));
	await page.getByRole('button', { name: 'Delegacias', exact: true }).click();

	const card = page.locator('.card').filter({ hasText: 'Ranking' }).first();
	// As duas delegacias E a seccional (que produziu 2 sem slot).
	await expect(card.getByText('CRATO', { exact: false }).first()).toBeVisible();
	await expect(card.getByText('BARBALHA', { exact: false }).first()).toBeVisible();
	await expect(card.getByText(C.seccional.nome, { exact: false }).first()).toBeVisible();
	// E o rótulo de cada linha deixa de dizer "Seccional".
	await expect(card.getByText('Delegacia', { exact: true }).first()).toBeVisible();
});

test('ordem e quantidade recortam o ranking', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId();
	test.skip(id == null, 'operação do cenário não foi criada');

	await page.goto(`/operacoes/produtividade?operacaoId=${id}`);
	await expandirMaisFiltros(page);
	await page.locator('#f-ano').selectOption(String(ANO));
	await page.getByRole('button', { name: 'Delegacias', exact: true }).click();

	// Melhores primeiro (padrão): o maior no topo.
	const melhores = await totaisDoRanking(page);
	expect(melhores[0]).toBe(5);

	// Piores primeiro: inverte.
	await page.locator('#f-ordem').selectOption('piores');
	const piores = await totaisDoRanking(page);
	expect(piores[0]).toBeLessThanOrEqual(piores[piores.length - 1]);

	// Top 5 sobre três unidades não corta nada; o controle existe e é aceito.
	await page.locator('#f-qtd').selectOption('5');
	expect((await totaisDoRanking(page)).length).toBeLessThanOrEqual(5);
});

test('operação de um tipo de equipe só desabilita o outro botão', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId();
	test.skip(id == null, 'operação do cenário não foi criada');

	// Desabilitado, e não escondido: o botão apagado diz que a operação NÃO usa
	// aquele tipo. Escondê-lo faria a barra parecer diferente sem explicar.
	execD1Local(`UPDATE operacoes SET usa_equipe_seint = 0 WHERE id = ${id};`);
	await page.goto(`/operacoes/produtividade?operacaoId=${id}`);

	await expect(page.getByRole('button', { name: 'Inteligência', exact: true })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Operacional', exact: true })).toBeEnabled();

	execD1Local(`UPDATE operacoes SET usa_equipe_seint = 1 WHERE id = ${id};`);
});
