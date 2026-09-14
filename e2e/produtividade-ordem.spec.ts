import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local, queryD1Local, expandirMaisFiltros } from './session';

/**
 * A ORDEM dos cards do painel de produtividade — arrastada pelo Admin Geral na
 * própria aba, e não herdada do formulário.
 *
 * O relato de ago/2026: não havia como escolher a ordem, e a pergunta marcada
 * depois caía onde calhava — no topo, se a forma dela fosse ranking, porque a
 * faixa dos rankings vem acima da das colunas. Mover o card exigia mover a
 * PERGUNTA no editor, o que renumera o enunciado ("4. HOUVE…") e reordena o
 * formulário que o policial preenche: arrumar a leitura mexia na coleta.
 *
 * Três coisas que só o navegador prova, e que este spec cerca:
 *
 * 1. **a ordem sai do banco e volta para ele** — as setas dos cards mudam o
 *    `painel_ordem` da (operação, tipo), e o painel recarregado obedece;
 * 2. **pergunta nova entra por ÚLTIMO** — é o pedido literal, e o mecanismo é
 *    negativo: o card sem posição gravada cai no fim do bloco dele. Testar isso
 *    exige marcar uma pergunta DEPOIS de a ordem existir, que é o que a fixture
 *    faz no meio do caminho;
 * 3. **organizar é do Admin Geral** — a tela é aberta também por admin de
 *    unidade e de seccional, que veem os dados recortados; a ordem é uma só e
 *    vale para todos.
 *
 * O ano é o CORRENTE pelo mesmo motivo dos outros specs do painel: o servidor
 * recorta a janela ao ano corrente (B-1) e o seletor só oferece quatro anos.
 */
const ANO = new Date().getFullYear();

/**
 * Ids exclusivos deste spec — faixa 9952x. `produtividade-graficos` usa 9951x e
 * `presenca-gise` usa 9950x; antes de reaproveitar qualquer número aqui,
 * procure-o em `e2e/` inteiro (foi assim que uma colisão passou entre aqueles
 * dois, cada um apagando a fixture do outro).
 */
const C = {
	operacao: 'OPERACAO E2E ORDEM PAINEL',
	seccional: { id: 99520, nome: 'SECCIONAL E2E ORDEM' },
	gise: 99521,
	sec: 99521,
	equipe: 99521
};

/**
 * Três perguntas do MESMO tipo e da mesma forma, e é isso que faz o teste valer:
 * o que as separa é só a posição. Fossem tipos diferentes, um card fora de lugar
 * poderia ser explicado por outra coisa.
 *
 * A quarta (`e2e_ordem_d`) nasce SEM marca — ela é a "pergunta nova", marcada no
 * meio do spec, depois de a ordem já existir.
 */
const PERGUNTAS = [
	{ id: 1, texto: 'ORDEM CARD A', tipo: 'numero', key: 'e2e_ordem_a', grafico: { colunas: true } },
	{ id: 2, texto: 'ORDEM CARD B', tipo: 'numero', key: 'e2e_ordem_b', grafico: { colunas: true } },
	{ id: 3, texto: 'ORDEM CARD C', tipo: 'numero', key: 'e2e_ordem_c', grafico: { colunas: true } },
	{ id: 4, texto: 'ORDEM CARD D', tipo: 'numero', key: 'e2e_ordem_d' }
].map((q) => ({ ...q, filhos: [] }));

const MODELO = JSON.stringify(PERGUNTAS);

let cenarioOk = false;

test.beforeAll(() => {
	cenarioOk = execD1Local(`
		INSERT INTO operacoes (nome, sigla) VALUES ('${C.operacao}', 'E2E-ORD')
		ON CONFLICT(nome) DO NOTHING;
		INSERT INTO unidades (id, nome, tipo) VALUES
			(${C.seccional.id}, '${C.seccional.nome}', 'seccional')
		ON CONFLICT(id) DO UPDATE SET nome = excluded.nome;

		INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, operacao_id) VALUES
			(${C.gise}, '${ANO}-05-21', 'finalizada', '08:00', '16:00',
				(SELECT id FROM operacoes WHERE nome = '${C.operacao}'))
		ON CONFLICT(id) DO UPDATE SET operacao_id = excluded.operacao_id;

		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status) VALUES
			(${C.sec}, ${C.gise}, ${C.seccional.id}, 'preenchida')
		ON CONFLICT(id) DO UPDATE SET gise_id = excluded.gise_id;

		DELETE FROM gise_equipes WHERE gise_seccional_id = ${C.sec};
		INSERT INTO gise_equipes (id, gise_seccional_id, gise_unidade_id, tipo, slots_dpc, slots_oip)
			VALUES (${C.equipe}, ${C.sec}, NULL, 'operacional', 1, 3);

		DELETE FROM gise_modelo_formulario WHERE operacao_id =
			(SELECT id FROM operacoes WHERE nome = '${C.operacao}');
		INSERT INTO gise_modelo_formulario (operacao_id, tipo, config) VALUES
			((SELECT id FROM operacoes WHERE nome = '${C.operacao}'), 'operacional', '${MODELO}');

		DELETE FROM gise_respostas_formulario WHERE gise_id = ${C.gise};
		INSERT INTO gise_respostas_formulario (gise_id, policial_id, equipe_id, respostas) VALUES
			(${C.gise}, ${FIXTURE.membroGise.id}, ${C.equipe},
				'{"e2e_ordem_a":5,"e2e_ordem_b":6,"e2e_ordem_c":7,"e2e_ordem_d":8}');
	`);
});

test.afterAll(() => {
	execD1Local(`
		DELETE FROM gise_escalas WHERE id = ${C.gise};
		DELETE FROM gise_modelo_formulario WHERE operacao_id =
			(SELECT id FROM operacoes WHERE nome = '${C.operacao}');
		DELETE FROM operacoes WHERE nome = '${C.operacao}';
	`);
});

function operacaoId(): number | null {
	const linhas = queryD1Local<{ id: number }>(
		`SELECT id FROM operacoes WHERE nome = '${C.operacao}'`
	);
	return linhas?.[0]?.id ?? null;
}

/** O `painel_ordem` gravado — `null` enquanto ninguém organizou nada. */
function ordemGravada(): string | null {
	const id = operacaoId();
	if (id == null) return null;
	const linhas = queryD1Local<{ painel_ordem: string | null }>(
		`SELECT painel_ordem FROM gise_modelo_formulario
		 WHERE operacao_id = ${id} AND tipo = 'operacional'`
	);
	return linhas?.[0]?.painel_ordem ?? null;
}

/** Zera a ordem, para cada caso partir do mesmo estado. */
function limparOrdem() {
	const id = operacaoId();
	if (id == null) return;
	execD1Local(
		`UPDATE gise_modelo_formulario SET painel_ordem = NULL
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);
}

async function abrirPainel(page: Page) {
	const id = operacaoId();
	if (id == null) return false;
	await page.goto(`/operacoes/produtividade?operacaoId=${id}`);
	await expandirMaisFiltros(page);
	await page.locator('#f-ano').selectOption(String(ANO));
	await expect(page.getByText('ORDEM CARD A')).toBeVisible();
	return true;
}

/**
 * Os títulos dos cards de coluna, de cima para baixo.
 *
 * `.card` casa com todo card do painel, e o filtro por prefixo isola os deste
 * cenário — assim o teste não quebra se a tela ganhar outro card no futuro.
 */
async function ordemNaTela(page: Page): Promise<string[]> {
	const textos = await page.locator('.card').allInnerTexts();
	return textos
		.map((t) => t.split('\n').find((l) => l.startsWith('ORDEM CARD')))
		.filter((t): t is string => !!t);
}

test.describe.configure({ mode: 'serial' });

test('sem ordem gravada, os cards saem na ordem do formulário', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	limparOrdem();
	test.skip(!(await abrirPainel(page)), 'operação do cenário não foi criada');

	expect(await ordemNaTela(page)).toEqual(['ORDEM CARD A', 'ORDEM CARD B', 'ORDEM CARD C']);
	// Fora do modo, nenhum card tem seta: o painel é o mesmo que todos veem.
	await expect(page.getByRole('button', { name: /Mover ORDEM CARD/ })).toHaveCount(0);
});

test('a ordem arrastada vai ao banco e o painel recarregado obedece', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	limparOrdem();
	test.skip(!(await abrirPainel(page)), 'operação do cenário não foi criada');

	await page.getByRole('button', { name: /Organizar painel/ }).click();
	await expect(page.getByText(/Organizando o painel/)).toBeVisible();

	// C sobe duas posições. As setas fazem o MESMO que o arraste e são o caminho
	// do teclado e do celular — `dragstart` não existe em toque.
	await page.getByRole('button', { name: 'Mover ORDEM CARD C para cima' }).click();
	await page.getByRole('button', { name: 'Mover ORDEM CARD C para cima' }).click();
	expect(await ordemNaTela(page)).toEqual(['ORDEM CARD C', 'ORDEM CARD A', 'ORDEM CARD B']);

	await page.getByRole('button', { name: /Salvar ordem/ }).click();
	// O toast é o sinal de que o PUT voltou — ler o banco antes dele pegaria a
	// coluna ainda vazia e o teste passaria pelo motivo errado.
	await expect(page.getByText(/Ordem do painel salva/)).toBeVisible();

	const gravada = JSON.parse(ordemGravada() ?? 'null') as string[] | null;
	// Faixas primeiro, cards depois. Só a de colunas tem card neste cenário — faixa
	// vazia não entra, senão o modo mostraria a barra de arraste sem nada embaixo.
	// O id do card de colunas é o id da pergunta em texto.
	expect(gravada).toEqual(['bloco-colunas', '3', '1', '2']);

	// A ida e volta pelo banco é o que este caso protege: sem o `load` devolvendo
	// a coluna, a tela mostraria a ordem nova até o primeiro reload.
	await abrirPainel(page);
	expect(await ordemNaTela(page)).toEqual(['ORDEM CARD C', 'ORDEM CARD A', 'ORDEM CARD B']);
});

test('arrastar um card sobre outro troca a posição dos dois', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	limparOrdem();
	test.skip(!(await abrirPainel(page)), 'operação do cenário não foi criada');

	await page.getByRole('button', { name: /Organizar painel/ }).click();

	// O gesto de verdade, e não as setas: o `draggable` fica no card inteiro e o
	// conteúdo dele é inerte. Sem isso o arraste pegaria a caixinha de seleção
	// que todo card tem no canto, e organizar marcaria cards para exportação.
	//
	// Os eventos vão DIRETO porque o Playwright não sintetiza HTML5 drag a partir
	// do mouse — mesma técnica do spec que cobre o arraste do editor de perguntas.
	//
	// `hasNotText: 'bloco ·'` separa os cards das FAIXAS: as duas coisas são
	// `listitem` (o gesto é o mesmo, e por isso o wrapper também é), e a faixa
	// contém o texto de todos os cards dela — sem o filtro, `nth(0)` seria ela.
	const cards = page
		.getByRole('listitem')
		.filter({ hasText: 'ORDEM CARD' })
		.filter({ hasNotText: 'bloco ·' });
	await expect(cards.nth(0)).toHaveAttribute('draggable', 'true');
	await cards.nth(2).dispatchEvent('dragstart');
	await cards.nth(0).dispatchEvent('dragenter');
	await cards.nth(0).dispatchEvent('drop');

	expect(await ordemNaTela(page)).toEqual(['ORDEM CARD C', 'ORDEM CARD A', 'ORDEM CARD B']);
	// E o arraste não marcou nada para exportação — o conteúdo do card é inerte.
	await expect(page.getByText(/Baixar \(imagem\) \(\d+\)/)).toHaveCount(0);
});

test('a pergunta marcada DEPOIS entra por último, não no topo', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId();
	test.skip(id == null, 'operação do cenário não foi criada');

	// O estado que o caso descreve: uma ordem já organizada, que não menciona a
	// pergunta D. Marcar D é o que o editor do formulário faz.
	execD1Local(`
		UPDATE gise_modelo_formulario
		SET painel_ordem = '["3","1","2"]',
		    config = json_set(config, '$[3].grafico', json('{"colunas":true}'))
		WHERE operacao_id = ${id} AND tipo = 'operacional';
	`);

	await abrirPainel(page);
	// D é a QUARTA no formulário e a última aqui — mas o que o caso prova é que
	// ela não pulou para o topo por não ter posição gravada.
	expect(await ordemNaTela(page)).toEqual([
		'ORDEM CARD C',
		'ORDEM CARD A',
		'ORDEM CARD B',
		'ORDEM CARD D'
	]);

	// Repõe o modelo, para o spec rodar de novo sobre o mesmo banco local.
	execD1Local(`
		UPDATE gise_modelo_formulario
		SET config = json_remove(config, '$[3].grafico'), painel_ordem = NULL
		WHERE operacao_id = ${id} AND tipo = 'operacional';
	`);
});

test('"Ordem do formulário" desfaz a organização', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId();
	test.skip(id == null, 'operação do cenário não foi criada');

	execD1Local(
		`UPDATE gise_modelo_formulario SET painel_ordem = '["3","2","1"]'
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);
	await abrirPainel(page);
	expect(await ordemNaTela(page)).toEqual(['ORDEM CARD C', 'ORDEM CARD B', 'ORDEM CARD A']);

	await page.getByRole('button', { name: /Organizar painel/ }).click();
	await page.getByRole('button', { name: /Ordem do formulário/ }).click();
	// Vira RASCUNHO, não gravação: o admin vê o resultado antes de confirmar.
	expect(await ordemNaTela(page)).toEqual(['ORDEM CARD A', 'ORDEM CARD B', 'ORDEM CARD C']);

	await page.getByRole('button', { name: /Salvar ordem/ }).click();
	await expect(page.getByText(/Ordem do painel salva/)).toBeVisible();
	// VAZIA, e não a ordem do formulário escrita por extenso: a lista explícita
	// congelaria a ordem atual das perguntas, e reordená-las no editor deixaria
	// de chegar ao painel. "Ordem do formulário" é seguir o formulário.
	expect(JSON.parse(ordemGravada() ?? 'null')).toEqual([]);

	limparOrdem();
});

test('arrastar de volta ao arranjo do formulário grava a lista VAZIA', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId();
	test.skip(id == null, 'operação do cenário não foi criada');

	execD1Local(
		`UPDATE gise_modelo_formulario SET painel_ordem = '["bloco-colunas","3","1","2"]'
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);
	await abrirPainel(page);
	expect(await ordemNaTela(page)).toEqual(['ORDEM CARD C', 'ORDEM CARD A', 'ORDEM CARD B']);

	// O admin arrasta C de volta para baixo, sem usar "Ordem do formulário": o
	// arranjo volta a ser o do formulário POR ACIDENTE. O painel precisa perceber
	// isso e voltar a SEGUIR o formulário, em vez de congelar a ordem atual das
	// perguntas numa lista explícita que diz a mesma coisa.
	await page.getByRole('button', { name: /Organizar painel/ }).click();
	await page.getByRole('button', { name: 'Mover ORDEM CARD C para baixo' }).click();
	await page.getByRole('button', { name: 'Mover ORDEM CARD C para baixo' }).click();
	expect(await ordemNaTela(page)).toEqual(['ORDEM CARD A', 'ORDEM CARD B', 'ORDEM CARD C']);

	await page.getByRole('button', { name: /Salvar ordem/ }).click();
	await expect(page.getByText(/Ordem do painel salva/)).toBeVisible();
	expect(JSON.parse(ordemGravada() ?? 'null')).toEqual([]);

	limparOrdem();
});

test('a FAIXA inteira se move, e a ordem dela vai ao banco', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId();
	test.skip(id == null, 'operação do cenário não foi criada');

	// Duas faixas com card: marcar a pergunta D como RANKING cria a de rankings ao
	// lado da de colunas. Com uma só, não há ordem de faixa a testar.
	execD1Local(`
		UPDATE gise_modelo_formulario
		SET painel_ordem = NULL,
		    config = json_set(config, '$[3].grafico', json('{"ranking":true}'))
		WHERE operacao_id = ${id} AND tipo = 'operacional';
	`);
	await abrirPainel(page);

	// Natural: rankings antes de colunas — era a ordem fixa no markup da página.
	await page.getByRole('button', { name: /Organizar painel/ }).click();
	await page.getByRole('button', { name: 'Mover Gráficos de colunas para cima' }).click();
	await page.getByRole('button', { name: /Salvar ordem/ }).click();
	await expect(page.getByText(/Ordem do painel salva/)).toBeVisible();

	const gravada = JSON.parse(ordemGravada() ?? 'null') as string[];
	// As faixas trocaram; os cards de cada uma continuam na ordem do formulário.
	expect(gravada.filter((x) => x.startsWith('bloco-'))).toEqual([
		'bloco-colunas',
		'bloco-listagem'
	]);

	// E o card de colunas passa a vir ANTES do ranking na página.
	await abrirPainel(page);
	// Em CAIXA ALTA porque `allInnerTexts` devolve o texto RENDERIZADO, e o título
	// do card sai de um `uppercase` do CSS — comparar com o texto do código acha -1.
	const titulos = (await page.locator('.card').allInnerTexts()).map((t) => t.toUpperCase());
	const iColuna = titulos.findIndex((t) => t.includes('ORDEM CARD A'));
	const iRanking = titulos.findIndex((t) => t.includes('RANKING DE ORDEM CARD D'));
	expect(iColuna).toBeGreaterThanOrEqual(0);
	expect(iRanking).toBeGreaterThanOrEqual(0);
	expect(iColuna).toBeLessThan(iRanking);

	execD1Local(`
		UPDATE gise_modelo_formulario
		SET config = json_remove(config, '$[3].grafico'), painel_ordem = NULL
		WHERE operacao_id = ${id} AND tipo = 'operacional';
	`);
});

test('organizar é do Admin Geral: o admin de unidade não vê o botão', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id, 'policial');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId();
	test.skip(id == null, 'operação do cenário não foi criada');

	await page.goto(`/operacoes/produtividade?operacaoId=${id}`);
	// Ele ENTRA na tela — é quem informa a linha de base dos indicadores — e vê os
	// dados recortados às unidades que administra. O que ele não faz é reordenar
	// o painel de todo mundo.
	await expect(page.getByRole('heading', { name: /Produção/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Organizar painel/ })).toHaveCount(0);
});

test('o PUT da ordem recusa quem não é Admin Geral', async ({ request, page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const id = operacaoId();
	test.skip(id == null, 'operação do cenário não foi criada');

	// Esconder o botão não é autorização: o POST direto tem de morrer no servidor.
	const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id, 'policial');
	test.skip(!ok, 'D1 local indisponível');
	const cookies = await page.context().cookies();
	const sessao = cookies.find((c) => c.name === 'session_token');
	test.skip(!sessao, 'sessão não semeada');

	const resposta = await request.put('/api/produtividade/ordem', {
		headers: {
			cookie: `session_token=${sessao!.value}`,
			origin: 'http://localhost:4173',
			'content-type': 'application/json'
		},
		data: { operacaoId: id, tipo: 'operacional', ordem: ['3', '2', '1'] }
	});
	expect(resposta.status()).toBe(403);
	expect(ordemGravada()).toBeNull();
});
