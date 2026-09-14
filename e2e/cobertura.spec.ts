import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local, queryD1Local } from './session';

/**
 * O tipo de pergunta `proporcao` — "total existente + parte atendida", a meta de
 * COBERTURA ("atender 100% das ocorrências").
 *
 * Dois riscos justificam este spec, e nenhum dos dois aparece em teste unitário:
 *
 * 1. **as chaves.** A resposta não mora em `p.key`, e sim em `${key}__total` e
 *    `${key}__parte`. Escrever numa e ler de outra não quebra nada visível — o
 *    campo simplesmente some do relatório e o gráfico soma zero. É a armadilha
 *    documentada no cabeçalho de `tipos-pergunta.ts`, e o motivo de
 *    `lista-reutilizavel.spec.ts` existir para o outro tipo derivado;
 * 2. **duas perguntas de cobertura no mesmo formulário** não podem se misturar —
 *    é a promessa de reutilização que a derivação por `key` compra.
 *
 * A conta em si (cobertura, meta, atingimento) tem cobertura unitária em
 * `gise/__tests__/indicadores` e `produtividade/__tests__/metas`. Aqui é a ponta
 * da ESCRITA: o que a tela realmente grava no banco.
 */

const GISE = FIXTURE.gise.id;
const EQUIPE = FIXTURE.giseEquipe.id;
const ROTA = `/operacoes/presenca/relatorio/${GISE}?equipeId=${EQUIPE}`;

async function silenciar(page: import('@playwright/test').Page) {}

const MODELO = JSON.stringify([
	{
		id: 1,
		key: 'cob_fds',
		texto: 'Atendimentos em fins de semana',
		tipo: 'proporcao',
		etapa: 'Cobertura',
		subtexto_total: 'Ocorrências no período',
		subtexto_parte: 'Ocorrências atendidas',
		indicador: { metaTipo: 'proporcao', metaValor: 100, unidadeMedida: 'ocorrências' }
	},
	{
		id: 2,
		key: 'cob_plantao',
		texto: 'Plantões cobertos',
		tipo: 'proporcao',
		etapa: 'Cobertura',
		subtexto_total: 'Plantões previstos',
		subtexto_parte: 'Plantões cobertos'
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

test('cobertura: dois campos, a razão na tela e duas perguntas que não se misturam', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 900 });
	await silenciar(page);
	const ok = await autenticarPagina(page, FIXTURE.membroGise.id);
	test.skip(!ok, 'D1 local indisponível');
	await page.goto(ROTA);

	const cartao1 = page
		.locator('.nested-card')
		.filter({ hasText: 'Atendimentos em fins de semana' });
	const cartao2 = page.locator('.nested-card').filter({ hasText: 'Plantões cobertos' });

	// Os rótulos vêm do modelo, não fixos no componente.
	await expect(cartao1.getByText('Ocorrências no período')).toBeVisible();
	await expect(cartao1.getByText('Ocorrências atendidas')).toBeVisible();
	await expect(cartao2.getByText('Plantões previstos')).toBeVisible();

	// 9 de 12 = 75%. A porcentagem é DERIVADA na tela — não existe campo para ela.
	await cartao1.locator('input[type="number"]').first().fill('12');
	await cartao1.locator('input[type="number"]').nth(1).fill('9');
	await expect(cartao1.getByText('75%')).toBeVisible();
	await expect(cartao1.getByText('(9 de 12)')).toBeVisible();

	// Parte maior que o total: avisa, mas não bloqueia (o número pode estar certo
	// e o total errado — quem corrige é quem preenche).
	await cartao1.locator('input[type="number"]').nth(1).fill('15');
	await expect(cartao1.getByText(/maior que o total/)).toBeVisible();
	await cartao1.locator('input[type="number"]').nth(1).fill('9');
	await expect(cartao1.getByText(/maior que o total/)).toHaveCount(0);

	// Segunda pergunta do MESMO tipo: campos próprios, vazios.
	await expect(cartao2.locator('input[type="number"]').first()).toHaveValue('');
	await cartao2.locator('input[type="number"]').first().fill('4');
	await cartao2.locator('input[type="number"]').nth(1).fill('4');
	await expect(cartao2.getByText('100%')).toBeVisible();

	// A primeira não foi tocada.
	await expect(cartao1.locator('input[type="number"]').first()).toHaveValue('12');

	// Total zero não é 0% de cobertura: não houve o que atender.
	await cartao2.locator('input[type="number"]').first().fill('0');
	await cartao2.locator('input[type="number"]').nth(1).fill('0');
	await expect(cartao2.getByText(/Sem ocorrências no período/)).toBeVisible();

	// Volta a um valor real para gravar.
	await cartao2.locator('input[type="number"]').first().fill('4');
	await cartao2.locator('input[type="number"]').nth(1).fill('4');

	await page.getByRole('button', { name: 'Finalizar entrega' }).click();
	await expect(page).toHaveURL(/\/operacoes\/presenca\?giseId=/);

	// O blob tem as QUATRO chaves derivadas, cada pergunta na sua — e nenhuma
	// porcentagem gravada, que é o ponto: ela se recalcula, não se guarda.
	const linhas = queryD1Local<{ respostas: string }>(
		`SELECT respostas FROM gise_respostas_formulario WHERE gise_id = ${GISE};`
	);
	const blob = JSON.parse(linhas![0].respostas);
	expect(Number(blob.cob_fds__total)).toBe(12);
	expect(Number(blob.cob_fds__parte)).toBe(9);
	expect(Number(blob.cob_plantao__total)).toBe(4);
	expect(Number(blob.cob_plantao__parte)).toBe(4);
	expect(blob.cob_fds).toBeUndefined();
});

test('editor: cobertura traz os rótulos dos dois campos e uma meta SEM objetivo', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await silenciar(page);
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	await page.goto('/operacoes/presenca');
	await expect(page.getByRole('heading', { name: 'Configurar Formulário' })).toBeVisible();

	// Pelo id da pergunta, e não `select.first()`: o editor tem o seletor de
	// OPERAÇÃO no topo (ver `lista-reutilizavel.spec.ts`).
	await expect(page.locator('#p-tp-1')).toHaveValue('proporcao');
	await expect(page.locator('#p-total-1')).toHaveValue('Ocorrências no período');
	await expect(page.locator('#p-parte-1')).toHaveValue('Ocorrências atendidas');

	// A pergunta 1 é indicador de cobertura: some o Objetivo, fica a meta em %.
	await expect(page.locator('#ind-tipo-1')).toHaveValue('proporcao');
	await expect(page.locator('#ind-obj-1')).toHaveCount(0);
	await expect(page.locator('#ind-meta-1')).toHaveValue('100');

	// A 2 não é indicador — o bloco existe (o tipo aceita), mas desmarcado.
	await expect(page.locator('#ind-tipo-2')).toHaveCount(0);
});

test('editor: trocar o tipo de meta reconstrói o objeto, sem deixar objetivo pendurado', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await silenciar(page);
	const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
	test.skip(!ok, 'D1 local indisponível');
	await page.goto('/operacoes/presenca');
	await expect(page.getByRole('heading', { name: 'Configurar Formulário' })).toBeVisible();

	// Cobertura → percentual: o Objetivo REAPARECE.
	await page.locator('#ind-tipo-1').selectOption('percentual');
	await expect(page.locator('#ind-obj-1')).toBeVisible();

	// E de volta: some outra vez.
	await page.locator('#ind-tipo-1').selectOption('proporcao');
	await expect(page.locator('#ind-obj-1')).toHaveCount(0);

	await page
		.getByRole('button', { name: /Salvar/ })
		.first()
		.click();
	await expect(page.getByText(/salvo|sucesso/i).first()).toBeVisible({ timeout: 10_000 });

	// O JSON gravado não pode carregar `objetivo` nem `rotuloBase`: campo morto
	// que a próxima leitura interpretaria como intenção.
	const linhas = queryD1Local<{ config: string }>(
		`SELECT config FROM gise_modelo_formulario
		 WHERE tipo = 'operacional'
		   AND operacao_id = (SELECT id FROM operacoes WHERE nome = 'GISE');`
	);
	const perguntas = JSON.parse(linhas![0].config) as Array<{
		key: string;
		indicador?: Record<string, unknown>;
	}>;
	const fds = perguntas.find((p) => p.key === 'cob_fds');
	expect(fds?.indicador).toMatchObject({ metaTipo: 'proporcao', metaValor: 100 });
	expect(fds?.indicador).not.toHaveProperty('objetivo');
	expect(fds?.indicador).not.toHaveProperty('rotuloBase');
});
