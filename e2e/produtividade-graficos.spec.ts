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
 * O que o painel de produtividade MOSTRA — e o que ele para de mostrar.
 *
 * Dois bugs relatados em ago/2026, e os dois são da mesma família: a tela
 * afirmava coisas sobre perguntas que o formulário não tinha.
 *
 * 1. **Os três blocos fixos apareciam sempre.** Prisões, drogas e armas eram
 *    cards escritos no código, e renderizavam em qualquer operação operacional.
 *    Numa operação nova, cujo formulário nunca teve pergunta de droga, a tela
 *    exibia "Ranking de Drogas" zerado. Apagar o campo do formulário não
 *    resolvia, porque o card nunca dependeu do campo. Drogas e armas viraram
 *    marcação da pergunta; prisões continua fixo, porque atravessa três.
 * 2. **Toda pergunta contável virava gráfico, e só em barras.** A quilometragem
 *    inicial da viatura ocupava um card ao lado das prisões, e o único jeito de
 *    tirá-la era apagar o campo — o que apagaria a coleta. Agora a pergunta diz
 *    em QUE forma aparece: colunas, ranking, detalhamento, ou nenhuma.
 *
 * O cenário é montado com DOIS modelos de propósito: um formulário "enxuto"
 * (sem droga, sem arma, com uma pergunta marcada e outra não) e um "completo".
 * É a comparação entre os dois que prova a regra, e nenhum teste unitário
 * consegue provar que a TELA obedece a ela.
 */

/**
 * Ids exclusivos deste spec. **A frase acima já foi falsa:** `gise`, `sec` e
 * `equipe` usavam 99501/99502, que são de `presenca-gise.spec.ts` — e o
 * `semearGisePresenca` de lá apaga por esse id em `gise_presencas`,
 * `gise_membros`, `gise_equipes`, `gise_seccionais` e `gise_escalas`, ou seja,
 * destruía a fixture DESTE spec nas cinco tabelas. Um dos dois sempre rodava
 * sobre restos do outro, dependendo da ordem.
 *
 * A faixa deste spec é 995**1**x, ancorada no 99510 da seccional, que já era
 * exclusivo. `presenca-gise` fica com 9950x. Antes de reaproveitar qualquer
 * número aqui, procure-o em `e2e/` inteiro — foi assim que a colisão passou.
 */
const C = {
	enxuta: 'OPERACAO E2E GRAFICOS ENXUTA',
	completa: 'OPERACAO E2E GRAFICOS COMPLETA',
	seccional: { id: 99510, nome: 'SECCIONAL E2E GRAFICOS' },
	giseEnxuta: 99511,
	giseCompleta: 99512,
	secEnxuta: 99511,
	secCompleta: 99512,
	equipeEnxuta: 99511,
	equipeCompleta: 99512
};

/**
 * O formulário enxuto: uma pergunta MARCADA como gráfico e uma não marcada.
 *
 * A não marcada é a quilometragem — o caso exato do relato. As duas são do mesmo
 * tipo (`numero`), então só a marca as separa; fosse o tipo, o teste não provaria
 * nada.
 */
const MODELO_ENXUTO = JSON.stringify([
	{
		id: 1,
		texto: 'ATENDIMENTOS REALIZADOS',
		tipo: 'numero',
		key: 'e2e_atendimentos',
		grafico: { colunas: true },
		filhos: []
	},
	{ id: 2, texto: 'KM INICIAL DA VIATURA', tipo: 'numero', key: 'e2e_km_inicial', filhos: [] },
	// O tipo GENÉRICO no lugar de `prisoes_maiores`: mesma coleta, chave derivada
	// da pergunta, e agora com ranking — que era o que faltava para ele poder
	// substituir os tipos de chave fixa.
	{
		id: 3,
		texto: 'HOUVE PROCEDIMENTO EM FLAGRANTE?',
		tipo: 'lista_detalhada',
		key: 'e2e_flagrante',
		subtexto_item: 'Procedimento',
		grafico: { ranking: true },
		filhos: []
	}
]);

/** O formulário completo: tem as perguntas que alimentam os três blocos fixos. */
const MODELO_COMPLETO = JSON.stringify([
	{
		id: 4,
		texto: 'HOUVE FLAGRANTE?',
		tipo: 'prisoes_maiores',
		key: 'procedimentos_flagrante_bool',
		filhos: []
	},
	{
		id: 10,
		texto: 'APREENSAO DE DROGAS',
		tipo: 'drogas_complex',
		key: 'apreensoes_drogas',
		// O par que os blocos fixos desenhavam, agora dito pela pergunta.
		grafico: { ranking: true, detalhe: true },
		filhos: []
	},
	{
		id: 11,
		texto: 'HOUVE APREENSAO DE ARMAS?',
		tipo: 'armas_complex',
		key: 'apreensoes_armas_bool',
		grafico: { ranking: true, detalhe: true },
		filhos: []
	}
]);

let cenarioOk = false;

test.beforeAll(() => {
	cenarioOk = execD1Local(`
		INSERT INTO operacoes (nome, sigla) VALUES
			('${C.enxuta}', 'E2E-GE'), ('${C.completa}', 'E2E-GC')
		ON CONFLICT(nome) DO NOTHING;
		INSERT INTO unidades (id, nome, tipo) VALUES
			(${C.seccional.id}, '${C.seccional.nome}', 'seccional')
		ON CONFLICT(id) DO UPDATE SET nome = excluded.nome;

		INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, operacao_id) VALUES
			(${C.giseEnxuta}, '${ANO}-05-11', 'finalizada', '08:00', '16:00',
				(SELECT id FROM operacoes WHERE nome = '${C.enxuta}')),
			(${C.giseCompleta}, '${ANO}-05-12', 'finalizada', '08:00', '16:00',
				(SELECT id FROM operacoes WHERE nome = '${C.completa}'))
		ON CONFLICT(id) DO UPDATE SET operacao_id = excluded.operacao_id;

		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status) VALUES
			(${C.secEnxuta}, ${C.giseEnxuta}, ${C.seccional.id}, 'preenchida'),
			(${C.secCompleta}, ${C.giseCompleta}, ${C.seccional.id}, 'preenchida')
		ON CONFLICT(id) DO UPDATE SET gise_id = excluded.gise_id;

		DELETE FROM gise_equipes WHERE gise_seccional_id IN (${C.secEnxuta}, ${C.secCompleta});
		INSERT INTO gise_equipes (id, gise_seccional_id, gise_unidade_id, tipo, slots_dpc, slots_oip) VALUES
			(${C.equipeEnxuta}, ${C.secEnxuta}, NULL, 'operacional', 1, 3),
			(${C.equipeCompleta}, ${C.secCompleta}, NULL, 'operacional', 1, 3);

		DELETE FROM gise_modelo_formulario WHERE operacao_id IN (
			SELECT id FROM operacoes WHERE nome IN ('${C.enxuta}', '${C.completa}'));
		INSERT INTO gise_modelo_formulario (operacao_id, tipo, config) VALUES
			((SELECT id FROM operacoes WHERE nome = '${C.enxuta}'), 'operacional', '${MODELO_ENXUTO}'),
			((SELECT id FROM operacoes WHERE nome = '${C.completa}'), 'operacional', '${MODELO_COMPLETO}');

		DELETE FROM gise_respostas_formulario WHERE gise_id IN (${C.giseEnxuta}, ${C.giseCompleta});
		INSERT INTO gise_respostas_formulario (gise_id, policial_id, equipe_id, respostas) VALUES
			(${C.giseEnxuta}, ${FIXTURE.membroGise.id}, ${C.equipeEnxuta},
				'{"e2e_atendimentos":7,"e2e_km_inicial":12345,"e2e_flagrante":"Sim","e2e_flagrante__qtd":4}'),
			-- A MESMA pergunta respondida "Não", com a quantidade que sobrou no blob.
			-- O relatório assinado ignora esse resto; o painel tem de ignorar também.
			(${C.giseEnxuta}, ${FIXTURE.policialA.id}, ${C.equipeEnxuta},
				'{"e2e_flagrante":"Não","e2e_flagrante__qtd":99}');
	`);
});

test.afterAll(() => {
	execD1Local(`
		DELETE FROM gise_escalas WHERE id IN (${C.giseEnxuta}, ${C.giseCompleta});
		DELETE FROM gise_modelo_formulario WHERE operacao_id IN (
			SELECT id FROM operacoes WHERE nome IN ('${C.enxuta}', '${C.completa}'));
		DELETE FROM operacoes WHERE nome IN ('${C.enxuta}', '${C.completa}');
	`);
});

function operacaoId(nome: string): number | null {
	const linhas = queryD1Local<{ id: number }>(`SELECT id FROM operacoes WHERE nome = '${nome}'`);
	return linhas?.[0]?.id ?? null;
}

/** Abre o painel na operação, com o ano do cenário já escolhido. */
async function abrirPainel(page: import('@playwright/test').Page, nome: string) {
	const id = operacaoId(nome);
	if (id == null) return false;
	await page.goto(`/operacoes/produtividade?operacaoId=${id}`);
	await expandirMaisFiltros(page);
	await page.locator('#f-ano').selectOption(String(ANO));
	return true;
}

test.describe.configure({ mode: 'serial' });

test('só a pergunta MARCADA vira gráfico', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	test.skip(!(await abrirPainel(page, C.enxuta)), 'operação do cenário não foi criada');

	// A marcada aparece, com o total do período.
	await expect(page.getByText('ATENDIMENTOS REALIZADOS')).toBeVisible();
	await expect(page.getByText('7', { exact: true }).first()).toBeVisible();

	// A quilometragem NÃO — é o pedido inteiro deste ciclo. O dado está gravado
	// (12345 no blob) e continua sendo coletado; só não vira card.
	await expect(page.getByText('KM INICIAL DA VIATURA')).toHaveCount(0);
	await expect(page.getByText('12345')).toHaveCount(0);
});

test('o tipo genérico de lista vira ranking, com o gate do "Sim"', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	test.skip(!(await abrirPainel(page, C.enxuta)), 'operação do cenário não foi criada');

	// "Quantidade + Lista" no lugar de `prisoes_maiores`: mesma coleta, e agora
	// com ranking — que é o que faltava para ele substituir os tipos de chave fixa.
	const card = page.locator('.card').filter({ hasText: 'HOUVE PROCEDIMENTO EM FLAGRANTE?' });
	await expect(card).toBeVisible();

	// 4 do "Sim", e NÃO 103: os 99 do relatório respondido "Não" não contam. O
	// número está no blob, e o PDF assinado já o ignorava.
	await expect(card.getByText('4', { exact: true }).first()).toBeVisible();
	await expect(card.getByText('103')).toHaveCount(0);
	await expect(card.getByText('99')).toHaveCount(0);
});

test('os blocos fixos SOMEM na operação cujo formulário não tem a pergunta', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	test.skip(!(await abrirPainel(page, C.enxuta)), 'operação do cenário não foi criada');

	// O bug relatado: os seis cards apareciam zerados numa operação que nunca
	// perguntou sobre droga, arma ou flagrante.
	await expect(page.getByText('Ranking de Prisões')).toHaveCount(0);
	await expect(page.getByText('Ranking de Drogas')).toHaveCount(0);
	await expect(page.getByText('Ranking de Armas')).toHaveCount(0);
	await expect(page.getByText('Detalhamento de Drogas')).toHaveCount(0);
});

test('e APARECEM na operação cujo formulário tem', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	test.skip(!(await abrirPainel(page, C.completa)), 'operação do cenário não foi criada');

	// Prisões vem do bloco FIXO (presença da pergunta de flagrante)…
	await expect(page.getByText('Ranking de Prisões')).toBeVisible();
	// …e droga e arma vêm da MARCA, com as duas formas cada uma. É a conversão da
	// migração 0054: os quatro cards que os blocos fixos desenhavam continuam ali,
	// agora ditos pelo formulário.
	await expect(page.getByText('Ranking de Drogas')).toBeVisible();
	await expect(page.getByText('Detalhamento de Drogas')).toBeVisible();
	await expect(page.getByText('Ranking de Armas')).toBeVisible();
	await expect(page.getByText('Detalhamento de Armas')).toBeVisible();
});

test('desligar UMA forma tira só o card dela', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.completa);
	test.skip(id == null, 'operação do cenário não foi criada');

	// É o controle que o pedido pede: escolher ENTRE ranking e detalhamento, e não
	// levar os dois de pacote como os blocos fixos obrigavam.
	execD1Local(
		`UPDATE gise_modelo_formulario
		 SET config = json_set(config, '$[1].grafico', json('{"detalhe":true}'))
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);

	await abrirPainel(page, C.completa);
	await expect(page.getByText('Detalhamento de Drogas')).toBeVisible();
	await expect(page.getByText('Ranking de Drogas')).toHaveCount(0);
	// A de armas, intocada, continua com as duas.
	await expect(page.getByText('Ranking de Armas')).toBeVisible();

	// Repõe para o spec poder rodar de novo sobre o mesmo banco local.
	execD1Local(
		`UPDATE gise_modelo_formulario
		 SET config = json_set(config, '$[1].grafico', json('{"ranking":true,"detalhe":true}'))
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);
});

test('a caixa "Detalhamento" fica desabilitada onde não há quebra por tipo', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.enxuta);
	test.skip(id == null, 'operação do cenário não foi criada');

	await page.goto(`/operacoes/presenca?operacaoId=${id}`);

	// As duas perguntas do formulário enxuto são `numero`: um valor só, nada a
	// quebrar. Desabilitada e não escondida — a caixa apagada é que diz por quê.
	const detalhe = page.getByRole('checkbox', { name: /Detalhamento por tipo/ });
	await expect(detalhe.first()).toBeDisabled();
	await expect(
		page.getByText(/Só em perguntas que guardam quebra por categoria/).first()
	).toBeVisible();

	// Colunas e ranking continuam disponíveis: são a mesma conta, outra leitura.
	await expect(page.getByRole('checkbox', { name: /Colunas por unidade/ }).first()).toBeEnabled();
	await expect(page.getByRole('checkbox', { name: /Ranking de unidades/ }).first()).toBeEnabled();
});

test('operação sem nada a mostrar explica o que fazer, em vez de ficar em branco', async ({
	page
}) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.enxuta);
	test.skip(id == null, 'operação do cenário não foi criada');

	// Desmarca as DUAS perguntas marcadas: o painel fica sem indicador, sem bloco
	// fixo e sem card nenhum. Basta uma sobrar para o aviso não aparecer — que é
	// exatamente o que ele promete.
	execD1Local(
		`UPDATE gise_modelo_formulario
		 SET config = json_remove(config, '$[2].grafico', '$[0].grafico')
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);

	await page.goto(`/operacoes/produtividade?operacaoId=${id}`);
	await expect(page.getByText('Nada a mostrar nesta operação')).toBeVisible();
	// O conserto não está nesta página, e a tela diz onde está.
	await expect(page.getByText('Mostrar na produtividade')).toBeVisible();

	// Repõe as marcas para não deixar o cenário sujo se o spec for reexecutado.
	execD1Local(
		`UPDATE gise_modelo_formulario
		 SET config = json_set(
		   json_set(config, '$[0].grafico', json('{"colunas":true}')),
		   '$[2].grafico', json('{"ranking":true}'))
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);
});

test('o editor traz a caixinha, e ela reflete o que está gravado', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.enxuta);
	test.skip(id == null, 'operação do cenário não foi criada');

	await page.goto(`/operacoes/presenca?operacaoId=${id}`);

	// Uma caixinha por pergunta graficável: as duas `numero` e a de lista — que
	// só passou a ter caixinha quando o painel deixou de resolver a chave por
	// tabela própria.
	const colunas = page.getByRole('checkbox', { name: /Colunas por unidade/ });
	await expect(colunas).toHaveCount(3);
	// Atendimentos marcada em colunas; quilometragem e flagrante, não.
	await expect(colunas.nth(0)).toBeChecked();
	await expect(colunas.nth(1)).not.toBeChecked();
	await expect(colunas.nth(2)).not.toBeChecked();

	// E o flagrante está marcado em RANKING, que é a forma dele.
	const rankings = page.getByRole('checkbox', { name: /Ranking de unidades/ });
	await expect(rankings.nth(0)).not.toBeChecked();
	await expect(rankings.nth(2)).toBeChecked();
});

test('o tipo de lista APOSENTADO não é oferecido para pergunta nova', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.enxuta);
	test.skip(id == null, 'operação do cenário não foi criada');

	await page.goto(`/operacoes/presenca?operacaoId=${id}`);

	// Nenhuma pergunta deste formulário usa os três, então nenhum aparece. O
	// genérico "Quantidade + Lista" faz o mesmo e ainda se repete.
	const seletor = page.locator('select[id^="p-tp-"]').first();
	await expect(seletor.locator('option[value="mandados_maiores"]')).toHaveCount(0);
	await expect(seletor.locator('option[value="prisoes_maiores"]')).toHaveCount(0);
	await expect(seletor.locator('option[value="apreensoes_menores"]')).toHaveCount(0);
	await expect(seletor.locator('option[value="lista_detalhada"]')).toHaveCount(1);
});

test('desmarcar no editor e salvar tira o card do painel', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.enxuta);
	test.skip(id == null, 'operação do cenário não foi criada');

	// A ida e volta pelo BANCO é o que este caso protege: a action grava o
	// `config` cru, e um campo perdido na serialização faria a caixinha "salvar"
	// sem efeito nenhum — a tela confirma, o gráfico volta no reload.
	await page.goto(`/operacoes/presenca?operacaoId=${id}`);
	await page
		.getByRole('checkbox', { name: /Colunas por unidade/ })
		.nth(0)
		.uncheck();
	await page.getByRole('button', { name: /Salvar Modelo/ }).click();
	// O toast é o sinal de que a action VOLTOU — ler o banco antes dele daria o
	// config antigo e o teste passaria pelo motivo errado.
	await expect(page.getByText(/Modelo operacional salvo com sucesso/)).toBeVisible();

	const gravado = queryD1Local<{ config: string }>(
		`SELECT config FROM gise_modelo_formulario WHERE operacao_id = ${id} AND tipo = 'operacional'`
	);
	const perguntas = JSON.parse(gravado?.[0]?.config ?? '[]') as Array<{
		key: string;
		grafico?: { colunas?: boolean };
	}>;
	// Ausente, e não `false`: a ausência já é a resposta.
	expect(perguntas.find((q) => q.key === 'e2e_atendimentos')?.grafico).toBeUndefined();

	await page.goto(`/operacoes/produtividade?operacaoId=${id}`);
	await expect(page.getByText('ATENDIMENTOS REALIZADOS')).toHaveCount(0);

	// Repõe, para o spec poder rodar de novo sobre o mesmo banco local.
	execD1Local(
		`UPDATE gise_modelo_formulario
		 SET config = json_set(config, '$[0].grafico', json('{"colunas":true}'))
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);
});

/**
 * O TÍTULO do card, que não é o enunciado da pergunta.
 *
 * A pergunta é escrita para quem preenche — numerada, em caixa alta,
 * interrogativa. O card é lido por quem acompanha, e ali serve o substantivo. Até
 * ago/2026 o painel exibia o enunciado inteiro, e o mesmo gráfico se chamava
 * "Drogas" no ranking e "10. HOUVE APREENSÃO DE DROGAS?" nas colunas.
 */
test('o campo de título só aparece na pergunta MARCADA', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.enxuta);
	test.skip(id == null, 'operação do cenário não foi criada');

	await page.goto(`/operacoes/presenca?operacaoId=${id}`);

	// Atendimentos (colunas) e flagrante (ranking) têm card no painel, logo têm o
	// que intitular. A quilometragem não tem — pedir um título ali seria pedir o
	// nome de uma coisa que não existe.
	await expect(page.locator('#rot-painel-1')).toBeVisible();
	await expect(page.locator('#rot-painel-3')).toBeVisible();
	await expect(page.locator('#rot-painel-2')).toHaveCount(0);

	// Vazio, com o padrão no placeholder: o campo diz o que sai se ninguém o
	// preencher, em vez de deixar adivinhar.
	await expect(page.locator('#rot-painel-1')).toHaveValue('');
	await expect(page.locator('#rot-painel-1')).toHaveAttribute(
		'placeholder',
		'ATENDIMENTOS REALIZADOS'
	);
});

test('as caixas de marcação vêm DEPOIS dos rótulos do campo', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.enxuta);
	test.skip(id == null, 'operação do cenário não foi criada');

	await page.goto(`/operacoes/presenca?operacaoId=${id}`);

	// A pergunta 3 é a única com os dois blocos: é de lista (tem rótulos de
	// quantidade e listagem) e é graficável (tem as caixas).
	const rotulos = await page.locator('#subqtd-3').boundingBox();
	const marcas = await page
		.locator('#rot-painel-3')
		.locator('xpath=ancestor::div[1]')
		.boundingBox();
	const caixa = await page
		.getByRole('checkbox', { name: /Ranking de unidades/ })
		.nth(2)
		.boundingBox();

	// Rótulos primeiro, marcas depois, título por último. O que se edita toda vez
	// não fica embaixo do que se marca uma vez só.
	expect(rotulos!.y).toBeLessThan(caixa!.y);
	expect(caixa!.y).toBeLessThan(marcas!.y);
});

test('o título gravado substitui o enunciado no card do painel', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	const id = operacaoId(C.enxuta);
	test.skip(id == null, 'operação do cenário não foi criada');

	// A ida e volta pelo BANCO, como no caso de desmarcar: um campo perdido na
	// serialização faria a tela confirmar e o título voltar ao enunciado no reload.
	await page.goto(`/operacoes/presenca?operacaoId=${id}`);
	await page.locator('#rot-painel-1').fill('Atendimentos do dia');
	await page.getByRole('button', { name: /Salvar Modelo/ }).click();
	await expect(page.getByText(/Modelo operacional salvo com sucesso/)).toBeVisible();

	await page.goto(`/operacoes/produtividade?operacaoId=${id}`);
	await expandirMaisFiltros(page);
	await page.locator('#f-ano').selectOption(String(ANO));
	await expect(page.getByText('Atendimentos do dia', { exact: true })).toBeVisible();
	await expect(page.getByText('ATENDIMENTOS REALIZADOS')).toHaveCount(0);

	// Repõe, para o spec poder rodar de novo sobre o mesmo banco local.
	execD1Local(
		`UPDATE gise_modelo_formulario
		 SET config = json_remove(config, '$[0].rotulo_painel')
		 WHERE operacao_id = ${id} AND tipo = 'operacional';`
	);
});

/**
 * O PDF do painel — que é `window.print()`, e por isso é CSS, não gerador.
 *
 * O bug relatado em ago/2026: gráfico partido no meio, com metade numa folha e
 * metade na seguinte, e a barra de filtros ocupando a primeira página. As regras
 * que evitariam isso existiam desde sempre no `<style>` da rota — só que
 * escopadas: o Svelte compilava `.card` para `.card.svelte-hash`, e TODO card do
 * painel é renderizado por um componente filho, com outro hash. As regras não
 * casavam com card nenhum.
 *
 * É um caso que só o navegador prova, e só em `media: print` — na tela as mesmas
 * regras não valem, e o CSS compilado "existe" mesmo quando não seleciona nada.
 */
test('em impressão, o card não quebra entre folhas e o cromo da tela some', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	test.skip(!(await abrirPainel(page, C.completa)), 'operação do cenário não foi criada');

	const cards = page.locator('.card');
	await expect(cards.first()).toBeVisible();

	await page.emulateMedia({ media: 'print' });

	// O pedido do relato: o card é indivisível. `avoid` é um PEDIDO ao paginador —
	// quando o card não cabe inteiro numa A4 o navegador quebra assim mesmo, que é
	// o comportamento desejado ("quebrar só se realmente não couber").
	await expect(cards.first()).toHaveCSS('break-inside', 'avoid');

	// Scroll interno vira CORTE no papel: o ranking rola na tela e precisa
	// transbordar na folha.
	await expect(cards.first()).toHaveCSS('overflow', 'visible');

	// Filtros e botões de exportação são controles de tela.
	await expect(page.locator('#f-ano')).toBeHidden();
	await expect(page.getByRole('button', { name: /Baixar \(PDF\)/ })).toBeHidden();

	await page.emulateMedia({ media: null });
});

test('com seleção, o PDF leva só os cards selecionados', async ({ page }) => {
	test.skip(!cenarioOk, 'D1 local indisponível');
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	test.skip(!(await abrirPainel(page, C.completa)), 'operação do cenário não foi criada');

	const selecionado = page.locator('.card').filter({ hasText: 'Ranking de Drogas' });
	const outro = page.locator('.card').filter({ hasText: 'Ranking de Armas' });
	await expect(selecionado).toBeVisible();

	await selecionado.getByRole('button').first().click();
	await expect(selecionado).toHaveClass(/selected-for-export/);

	await page.emulateMedia({ media: 'print' });
	await expect(selecionado).toBeVisible();
	// Sem isto o PDF sai com a tela inteira e a seleção só decora a borda na tela.
	await expect(outro).toBeHidden();
	await page.emulateMedia({ media: null });
});
