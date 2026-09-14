/**
 * Linha de base dos indicadores — a aba `/operacoes/dados-base` e o escopo dela.
 *
 * O que este spec prova, e nenhum teste unitário prova: a `unidadeId` chega no
 * CORPO do POST. `unidadesLinhaBaseAdministradas` tem cobertura unitária, mas
 * "o resolvedor está certo" e "o handler o chama antes de escrever" são coisas
 * diferentes — e é a segunda que já custou caro neste projeto (FLW-ESC-002).
 *
 * Por isso o caso central aqui é o NEGATIVO: um admin de unidade postando a
 * base de outra delegacia tem de ser recusado, e a linha não pode existir no
 * banco depois.
 *
 * O cenário é próprio do spec (ids na faixa 993xx), montado no `beforeAll` e
 * não na fixture compartilhada: a fixture GISE é consumida por meia dúzia de
 * outros specs, e acrescentar uma operação e um slot a ela mudaria contagens
 * que eles afirmam.
 */
import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import {
	autenticarPagina,
	seedSession,
	headersFormAction,
	execD1Local,
	queryD1Local
} from './session';

/** Ids exclusivos deste spec — não colidem com a fixture compartilhada. */
const CENARIO = {
	operacao: { nome: 'OPERACAO E2E LINHA BASE' },
	seccional: { id: 99310, nome: 'SECCIONAL E2E LINHA BASE' },
	/** A unidade que o `adminUnidade` da fixture administra entra por SLOT. */
	minhaUnidade: FIXTURE.unidadeA,
	/** Participa da operação, mas NÃO é administrada pelo usuário do teste. */
	outraUnidade: { id: 99320, nome: 'DELEGACIA E2E ALHEIA' },
	gise: { id: 99301, dataInicio: '2026-07-04' },
	giseSeccional: { id: 99301 },
	indicador: 'e2e_acervo_pendentes'
};

/** O modelo da operação, com um indicador percentual — é ele que a aba lista. */
const MODELO = JSON.stringify([
	{
		id: 1,
		texto: 'Acervo de inquéritos pendentes (E2E)',
		tipo: 'numero',
		key: CENARIO.indicador,
		filhos: [],
		indicador: {
			objetivo: 'diminuir',
			metaTipo: 'percentual',
			metaValor: 20,
			unidadeMedida: 'procedimentos',
			rotuloBase: 'Acervo atual antes da operação (E2E)'
		}
	}
]);

let cenarioOk = false;

test.beforeAll(() => {
	cenarioOk = execD1Local(`
		INSERT INTO operacoes (nome, sigla, descricao) VALUES
			('${CENARIO.operacao.nome}', 'E2E-LB', 'Cenário do spec de linha de base')
		ON CONFLICT(nome) DO NOTHING;
		INSERT INTO unidades (id, nome, tipo) VALUES
			(${CENARIO.seccional.id}, '${CENARIO.seccional.nome}', 'seccional'),
			(${CENARIO.outraUnidade.id}, '${CENARIO.outraUnidade.nome}', 'delegacia')
		ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, tipo = excluded.tipo;
		INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, operacao_id)
		VALUES (${CENARIO.gise.id}, '${CENARIO.gise.dataInicio}', 'em_andamento', '08:00', '16:00',
			(SELECT id FROM operacoes WHERE nome = '${CENARIO.operacao.nome}'))
		ON CONFLICT(id) DO UPDATE SET operacao_id = excluded.operacao_id, status = excluded.status;
		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status)
		VALUES (${CENARIO.giseSeccional.id}, ${CENARIO.gise.id}, ${CENARIO.seccional.id}, 'preenchida')
		ON CONFLICT(id) DO UPDATE SET gise_id = excluded.gise_id, seccional_id = excluded.seccional_id;
		DELETE FROM gise_seccional_unidades WHERE gise_seccional_id = ${CENARIO.giseSeccional.id};
		INSERT INTO gise_seccional_unidades (gise_seccional_id, unidade_id) VALUES
			(${CENARIO.giseSeccional.id}, ${CENARIO.minhaUnidade.id}),
			(${CENARIO.giseSeccional.id}, ${CENARIO.outraUnidade.id});
		DELETE FROM gise_modelo_formulario
			WHERE operacao_id = (SELECT id FROM operacoes WHERE nome = '${CENARIO.operacao.nome}');
		INSERT INTO gise_modelo_formulario (operacao_id, tipo, config) VALUES
			((SELECT id FROM operacoes WHERE nome = '${CENARIO.operacao.nome}'), 'operacional', '${MODELO}');
		DELETE FROM operacao_linha_base
			WHERE operacao_id = (SELECT id FROM operacoes WHERE nome = '${CENARIO.operacao.nome}');
	`);
});

/** O id da operação do cenário, lido do banco (o autoincrement decide). */
function operacaoId(): number | null {
	const linhas = queryD1Local<{ id: number }>(
		`SELECT id FROM operacoes WHERE nome = '${CENARIO.operacao.nome}'`
	);
	return linhas?.[0]?.id ?? null;
}

function baseGravada(unidadeId: number): number | null {
	const linhas = queryD1Local<{ valor: number }>(
		`SELECT valor FROM operacao_linha_base
		 WHERE unidade_id = ${unidadeId} AND indicador_key = '${CENARIO.indicador}'`
	);
	return linhas?.[0]?.valor ?? null;
}

test.describe('Dados base (linha de base dos indicadores)', () => {
	test('admin de unidade vê a aba com a SUA unidade e o indicador da operação', async ({
		page
	}) => {
		test.skip(!cenarioOk, 'D1 local indisponível');
		const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
		test.skip(!ok, 'D1 local indisponível');

		const id = operacaoId();
		test.skip(id == null, 'operação do cenário não foi criada');

		const res = await page.goto(`/operacoes/dados-base/${id}`);
		expect(res?.status()).toBe(200);

		await expect(page.getByRole('heading', { name: 'Dados base' })).toBeVisible();
		// A unidade administrada aparece…
		await expect(page.getByRole('heading', { name: CENARIO.minhaUnidade.nome })).toBeVisible();
		// …e a que ele não administra, não — mesmo participando da operação.
		await expect(page.getByRole('heading', { name: CENARIO.outraUnidade.nome })).toHaveCount(0);
		// O rótulo vem do indicador configurado no formulário da operação.
		await expect(page.getByText('Acervo atual antes da operação (E2E)')).toBeVisible();

		// E NÃO há como trocar de operação daqui: ela vem do caminho. Um seletor ao
		// lado dos campos é o convite a gravar o acervo sob a operação errada.
		await expect(page.locator('#op')).toHaveCount(0);
	});

	test('id de operação inexistente → 404, e não a tela de outra operação', async ({ page }) => {
		test.skip(!cenarioOk, 'D1 local indisponível');
		const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
		test.skip(!ok, 'D1 local indisponível');

		// Antes, um id inválido caía na PRIMEIRA operação ativa — mesma tela, outra
		// operação, e o admin preencheria sem perceber a troca.
		const res = await page.goto('/operacoes/dados-base/99999999');
		expect(res?.status()).toBe(404);
	});

	test('o índice leva direto ao preenchimento quando há uma pendência só', async ({ page }) => {
		test.skip(!cenarioOk, 'D1 local indisponível');
		const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
		test.skip(!ok, 'D1 local indisponível');
		const id = operacaoId();
		test.skip(id == null, 'operação do cenário não foi criada');

		// Com uma só, a escolha não existe — e não se pergunta.
		await page.goto('/operacoes/dados-base');
		await expect(page).toHaveURL(new RegExp(`/operacoes/dados-base/${id}`));
	});

	test('com uma pendência só NÃO há botão de voltar', async ({ page }) => {
		test.skip(!cenarioOk, 'D1 local indisponível');
		const ok = await autenticarPagina(page, FIXTURE.adminUnidade.id);
		test.skip(!ok, 'D1 local indisponível');
		const id = operacaoId();
		test.skip(id == null, 'operação do cenário não foi criada');

		await page.goto(`/operacoes/dados-base/${id}`);
		// O índice redirecionaria de volta para cá: um "Voltar" que não sai do
		// lugar é pior que nenhum. O caminho de volta é a barra lateral.
		await expect(page.getByRole('link', { name: /^Voltar/ })).toHaveCount(0);
	});

	test('o voltar do Admin Geral leva às operações — a porta por onde ele entrou', async ({
		page
	}) => {
		test.skip(!cenarioOk, 'D1 local indisponível');
		const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
		test.skip(!ok, 'D1 local indisponível');
		const id = operacaoId();
		test.skip(id == null, 'operação do cenário não foi criada');

		await page.goto(`/operacoes/dados-base/${id}`);
		const voltar = page.getByRole('link', { name: 'Voltar às operações' });
		await expect(voltar).toBeVisible();
		await voltar.click();

		// E não de volta para esta mesma tela, que é o que o `href` fixo fazia.
		await expect(page).toHaveURL(/\/operacoes\/gise\/operacoes/);
		await expect(page).not.toHaveURL(/\/operacoes\/dados-base/);
	});

	test('grava a base da própria unidade', async ({ request }) => {
		test.skip(!cenarioOk, 'D1 local indisponível');
		const token = seedSession(FIXTURE.adminUnidade.id);
		test.skip(!token, 'D1 local indisponível');
		const id = operacaoId();
		test.skip(id == null, 'operação do cenário não foi criada');

		const res = await request.post(`/operacoes/dados-base/${id}?/salvar`, {
			headers: headersFormAction(token!),
			form: {
				operacaoId: String(id),
				unidadeId: String(CENARIO.minhaUnidade.id),
				[`valor__${CENARIO.indicador}`]: '1240',
				[`obs__${CENARIO.indicador}`]: 'levantamento inicial'
			}
		});

		expect(res.status()).toBe(200);
		expect(baseGravada(CENARIO.minhaUnidade.id)).toBe(1240);
	});

	test('POST direto na base de OUTRA unidade é recusado e nada é gravado', async ({ request }) => {
		test.skip(!cenarioOk, 'D1 local indisponível');
		const token = seedSession(FIXTURE.adminUnidade.id);
		test.skip(!token, 'D1 local indisponível');
		const id = operacaoId();
		test.skip(id == null, 'operação do cenário não foi criada');

		const res = await request.post(`/operacoes/dados-base/${id}?/salvar`, {
			headers: headersFormAction(token!),
			form: {
				operacaoId: String(id),
				// A unidade participa da operação — só não é administrada por ele.
				// Esconder o card na tela não impede este POST; quem impede é a action.
				// A operação no CAMINHO também não impede: quem decide o que se grava
				// é o corpo, e é ele que a action confronta com a permissão.
				unidadeId: String(CENARIO.outraUnidade.id),
				[`valor__${CENARIO.indicador}`]: '999'
			}
		});

		// Form action recusada devolve 200 com `type: 'failure'` no corpo — o que
		// importa é o efeito: a linha não existe.
		const corpo = await res.text();
		expect(corpo).toContain('não administra esta unidade');
		expect(baseGravada(CENARIO.outraUnidade.id)).toBeNull();
	});

	test('policial sem papel não entra na aba', async ({ page }) => {
		test.skip(!cenarioOk, 'D1 local indisponível');
		const ok = await autenticarPagina(page, FIXTURE.policialB.id);
		test.skip(!ok, 'D1 local indisponível');

		const res = await page.goto('/operacoes/dados-base');
		expect(res?.status()).toBe(403);
	});

	test('anônimo → /login', async ({ page }) => {
		await page.goto('/operacoes/dados-base');
		await expect(page).toHaveURL(/\/login/);
	});
});

test.describe('Cadastro de operações', () => {
	test('Admin Geral abre a tela e vê as operações semeadas', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
		test.skip(!ok, 'D1 local indisponível');

		const res = await page.goto('/operacoes/gise/operacoes');
		expect(res?.status()).toBe(200);
		await expect(page.getByRole('heading', { name: 'Operações', exact: true })).toBeVisible();
		// A migração 0048/0050 semeia as duas.
		await expect(page.getByText('GISE', { exact: true }).first()).toBeVisible();
		await expect(page.getByText('OPERAÇÃO CRAJUBAR').first()).toBeVisible();
	});

	test('"Dados base" só na linha da operação que pede base', async ({ page }) => {
		test.skip(!cenarioOk, 'D1 local indisponível');
		const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
		test.skip(!ok, 'D1 local indisponível');
		const id = operacaoId();
		test.skip(id == null, 'operação do cenário não foi criada');

		await page.goto('/operacoes/gise/operacoes');

		// A do cenário tem indicador percentual → tem o botão, apontando para ELA.
		const doCenario = page.locator('li').filter({ hasText: CENARIO.operacao.nome });
		const botao = doCenario.getByRole('link', { name: 'Dados base' });
		await expect(botao).toBeVisible();
		await expect(botao).toHaveAttribute('href', `/operacoes/dados-base/${id}`);

		// A GISE não tem indicador nenhum → não tem o que perguntar às delegacias.
		const gise = page.locator('li').filter({ hasText: 'Grupo de Investigação' });
		await expect(gise.getByRole('link', { name: 'Dados base' })).toHaveCount(0);
	});

	test('policial comum é redirecionado', async ({ page }) => {
		const ok = await autenticarPagina(page, FIXTURE.policialB.id);
		test.skip(!ok, 'D1 local indisponível');

		await page.goto('/operacoes/gise/operacoes');
		await expect(page).not.toHaveURL(/\/operacoes\/gise\/operacoes/);
	});
});
