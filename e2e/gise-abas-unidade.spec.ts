import { test, expect, type Page } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local } from './session';

/**
 * As ABAS de unidade no quadro da seccional (`/operacoes/gise/[id]`).
 *
 * Até ago/2026 cada delegacia era uma CAIXA empilhada: uma faixa com o nome e o
 * "Remover DP", a moldura, e as equipes espremidas dentro. Agora cada unidade é
 * uma aba, e o painel abaixo mostra as equipes da aba aberta.
 *
 * O que só o navegador prova, e por isso mora aqui:
 *
 *   - **trocar de aba troca as equipes.** É o comportamento inteiro da mudança;
 *     um `.svelte` não tem teste unitário neste projeto (vitest roda em `node`,
 *     sem DOM);
 *   - **a aba nova abre selecionada.** Criada e deixada fechada, a unidade
 *     nasceria escondida atrás da anterior — quem acabou de criá-la iria
 *     procurar o slot que "não apareceu";
 *   - **a barra não rola na vertical.** `overflow-x: auto` faz o navegador
 *     computar o eixo Y como `auto` também, e a faixa das abas ganhava uma barra
 *     de rolagem vertical de 1px de conteúdo. É invisível numa asserção de
 *     markup e evidente na tela;
 *   - **horário herdado não é escrito, e fora da edição nem o relógio aparece.**
 *     A regra de "tem horário próprio?" é de `$lib/gise/horarios` (com teste
 *     unitário); o que se prova aqui é que o card usa a regra, e que o ícone
 *     acompanha o lápis em vez de decorar o quadro inteiro.
 */

/** Fora da faixa de produção e das ids usadas pelos demais specs. */
const C = {
	gise: 99080,
	seccional: 99081,
	dpA: { id: 99082, nome: 'DELEGACIA E2E ABAS ALFA' },
	dpB: { id: 99083, nome: 'DELEGACIA E2E ABAS BETA' },
	slotA: 99080,
	slotB: 99081,
	equipeA: 99080,
	equipeB: 99081
};

let cenarioOk = false;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
	cenarioOk = execD1Local(`
		INSERT INTO unidades (id, nome, tipo, seccional_id) VALUES
			(${C.dpA.id}, '${C.dpA.nome}', 'delegacia', ${FIXTURE.seccional.id}),
			(${C.dpB.id}, '${C.dpB.nome}', 'delegacia', ${FIXTURE.seccional.id})
		ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, tipo = excluded.tipo,
			seccional_id = excluded.seccional_id;

		-- 'em_preenchimento' porque 'em_andamento' (o da fixture) desliga a edição.
		INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, supervisor_id, operacao_id)
		VALUES (${C.gise}, '2026-06-03', 'em_preenchimento', '08:00', '16:00',
			${FIXTURE.supervisor.id}, (SELECT id FROM operacoes WHERE nome = 'GISE'))
		ON CONFLICT(id) DO UPDATE SET status = excluded.status, hora_entrada = excluded.hora_entrada,
			hora_saida = excluded.hora_saida;

		-- Seccional SEM horário próprio: herda o da escala, e é o que o relógio diz.
		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status, hora_entrada, hora_saida)
		VALUES (${C.seccional}, ${C.gise}, ${FIXTURE.seccional.id}, 'pendente', NULL, NULL)
		ON CONFLICT(id) DO UPDATE SET gise_id = excluded.gise_id, status = excluded.status,
			hora_entrada = NULL, hora_saida = NULL;

		DELETE FROM gise_seccional_unidades WHERE id IN (${C.slotA}, ${C.slotB});
		INSERT INTO gise_seccional_unidades (id, gise_seccional_id, unidade_id) VALUES
			(${C.slotA}, ${C.seccional}, ${C.dpA.id}),
			(${C.slotB}, ${C.seccional}, ${C.dpB.id});

		DELETE FROM gise_equipes WHERE gise_seccional_id = ${C.seccional};
		-- A equipe de ALFA herda o horário; a de BETA tem horário PRÓPRIO.
		INSERT INTO gise_equipes (id, gise_seccional_id, gise_unidade_id, tipo, slots_dpc, slots_oip, hora_entrada, hora_saida) VALUES
			(${C.equipeA}, ${C.seccional}, ${C.slotA}, 'operacional', 1, 3, NULL, NULL),
			(${C.equipeB}, ${C.seccional}, ${C.slotB}, 'seint', 0, 2, '07:00', '13:00');
	`);
});

test.afterAll(() => {
	execD1Local(`
		DELETE FROM gise_escalas WHERE id = ${C.gise};
		DELETE FROM unidades WHERE id IN (${C.dpA.id}, ${C.dpB.id});
	`);
});

async function abrirQuadro(page: Page) {
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	await page.goto(`/operacoes/gise/${C.gise}`);
}

test('a aba aberta decide quais equipes aparecem', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	await abrirQuadro(page);

	const abaAlfa = page.getByRole('tab', { name: /ABAS ALFA/ });
	const abaBeta = page.getByRole('tab', { name: /ABAS BETA/ });
	await expect(abaAlfa).toBeVisible();
	await expect(abaBeta).toBeVisible();

	// Abre na primeira: só a equipe de ALFA está na tela.
	await expect(abaAlfa).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByText(C.dpA.nome, { exact: true })).toBeVisible();
	await expect(page.getByText('Equipe Operacional')).toBeVisible();
	await expect(page.getByText('Equipe SEINT')).toHaveCount(0);

	// Trocar de aba troca o painel inteiro.
	await abaBeta.click();
	await expect(abaBeta).toHaveAttribute('aria-selected', 'true');
	await expect(abaAlfa).toHaveAttribute('aria-selected', 'false');
	await expect(page.getByText(C.dpB.nome, { exact: true })).toBeVisible();
	await expect(page.getByText('Equipe SEINT')).toBeVisible();
	await expect(page.getByText('Equipe Operacional')).toHaveCount(0);
});

test('a barra de abas não ganha rolagem VERTICAL', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	await abrirQuadro(page);

	// `overflow-x: auto` computa o eixo Y como `auto` também; sem o
	// `overflow-y-hidden` a faixa das abas ganha uma barra de rolagem vertical.
	const barra = page.getByRole('tablist', { name: 'Unidades participantes' });
	await expect(barra).toBeVisible();
	expect(await barra.evaluate((el) => getComputedStyle(el).overflowY)).toBe('hidden');
	expect(await barra.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
});

test('o relógio do horário herdado só acompanha o lápis; o próprio sai sempre', async ({
	page
}) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	await abrirQuadro(page);

	// FORA da edição não há relógio nenhum: o horário herdado já está no
	// cabeçalho da escala, e o ícone só dizia onde clicar para personalizar.
	await expect(page.getByLabel(/Horário herdado/)).toHaveCount(0);
	await expect(page.getByLabel(/Horário da escala/)).toHaveCount(0);
	await expect(page.getByText('08:00h-16:00h')).toHaveCount(0);

	// O horário PRÓPRIO é outra coisa: só existe naquele card, então aparece
	// escrito mesmo com a edição concluída.
	await page.getByRole('tab', { name: /ABAS BETA/ }).click();
	await expect(page.getByText('07:00h-13:00h')).toBeVisible();

	// Ligada a edição, o relógio volta — ao lado do lápis que ele anuncia.
	await page.getByRole('button', { name: 'Editar escala' }).click();
	await expect(page.getByRole('button', { name: 'Concluir Edição' })).toBeVisible();
	await page.getByRole('tab', { name: /ABAS ALFA/ }).click();
	await expect(page.getByLabel('Horário herdado: 08:00h-16:00h')).toBeVisible();
});

test('a unidade recém-adicionada abre na aba nova', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	await abrirQuadro(page);

	await page.getByRole('button', { name: 'Editar escala' }).click();
	await expect(page.getByRole('button', { name: 'Concluir Edição' })).toBeVisible();

	// A última aba é o "+", onde a próxima aba nasce.
	await page.getByRole('button', { name: '+ Unidades' }).first().click();
	await page.getByRole('button', { name: 'Confirmar' }).click();

	// Três abas, e a nova (sem unidade escolhida) é a que está aberta — não a
	// primeira, que era o comportamento a evitar.
	const abas = page.getByRole('tab');
	await expect(abas).toHaveCount(3);
	await expect(abas.nth(2)).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByText('Unidade não definida').first()).toBeVisible();
});
