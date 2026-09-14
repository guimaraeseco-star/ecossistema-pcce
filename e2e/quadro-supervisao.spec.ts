import { test, expect, type Page } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { autenticarPagina, execD1Local, queryD1Local } from './session';

/**
 * A EDIÇÃO do quadro de supervisão da GISE — designar e remover os quatro
 * papéis (supervisor DPC, assessor e os dois NUIP OIP).
 *
 * Este roteiro existe porque a área trocou de arquitetura em ago/2026 e ficou
 * sem cobertura de interação. O quadro era um componente de 1028 linhas;
 * fatiá-lo produziu um repassador de 38 props, e o conserto foi mover o ESTADO
 * junto — `QuadroSupervisaoEstado` publicada com `setContext`, o primeiro uso
 * de contexto do projeto. `gise.spec.ts` e os irmãos só RENDERIZAM o quadro; o
 * risco daquela mudança está no que se clica.
 *
 * O que cada caso protege, e por que não é redundante com o resto da suíte:
 *
 *   - **exclusividade da edição por papel** é o caso central. Antes eram dois
 *     `$effect` sincronizando `editando` ↔ `editandoPapel` entre pai e filho;
 *     hoje é um `editandoPapel` só, dentro da classe de contexto. Se a
 *     exclusividade se perder, dois `SearchableSelect` ficam abertos ao mesmo
 *     tempo e o form submete o id de um papel no campo do outro — sem erro
 *     nenhum;
 *   - **cancelar** devolve o id PERSISTIDO ao formulário (`#idPersistido`), não
 *     um vazio: cancelar e salvar em seguida não pode apagar quem já estava lá;
 *   - **remover** é "limpa o id e submete o form", com um modal no meio. O que
 *     o teste fixa é a ponta: depois do modal, `supervisor_id` zera NO BANCO.
 *     Um `requestSubmit()` que não dispara deixa a tela correta e o banco
 *     intacto.
 *
 * **GISE própria, e não a fixture compartilhada.** A do `global-setup` está em
 * `em_andamento`, que é justamente um dos status em que `editaBloqueado` desliga
 * a edição — o quadro renderiza em leitura e não haveria o que clicar. Além
 * disso este spec REMOVE uma designação; fazer isso na fixture quebraria as
 * asserções de `gise.spec.ts` e `relatorio-extra-gise.spec.ts`, que contam com
 * o supervisor designado. Mesma razão pela qual `escalaAssinavelA3` existe
 * separada de `escalaAssinavel`.
 */

/** Fora da faixa de produção e das ids já usadas pelo `global-setup`. */
const GISE_EDICAO = 99002;

/** Candidato a assessor: precisa existir para o slot ter o que mostrar. */
const ASSESSOR = { id: 99006, matricula: 'EE990006', nome: 'Assessor Fixture Quadro' };

/** Semeia (ou repõe) a GISE deste spec em `em_preenchimento`, com supervisor. */
function semearGiseEditavel(): boolean {
	return execD1Local(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, primeiro_acesso, ativo)
		VALUES (${ASSESSOR.id}, '${ASSESSOR.matricula}', '${ASSESSOR.nome}', 'DPC',
			'${FIXTURE.seccional.nome}', 'x', 0, 1)
		ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, cargo = excluded.cargo,
			lotacao = excluded.lotacao, ativo = excluded.ativo;
		INSERT INTO gise_escalas
			(id, data_inicio, status, hora_entrada, hora_saida, supervisor_id, operacao_id)
		VALUES (${GISE_EDICAO}, '2026-06-02', 'em_preenchimento', '08:00', '16:00',
			${FIXTURE.supervisor.id}, (SELECT id FROM operacoes WHERE nome = 'GISE'))
		ON CONFLICT(id) DO UPDATE SET status = excluded.status,
			supervisor_id = excluded.supervisor_id, assessor_id = NULL,
			seint1_id = NULL, seint2_id = NULL;
	`);
}

/** `supervisor_id` PERSISTIDO — `undefined` quando o wrangler falha. */
function supervisorNoBanco(): number | null | undefined {
	const linhas = queryD1Local<{ supervisor_id: number | null }>(
		`SELECT supervisor_id FROM gise_escalas WHERE id = ${GISE_EDICAO};`
	);
	return linhas?.[0]?.supervisor_id;
}

/**
 * Abre a GISE e liga o Modo Edição Geral pelo BOTÃO, como o Admin Geral faz.
 *
 * O `?edit=true` que a página aceita não serve aqui: o `$effect` que o lê chama
 * `replaceState` do SvelteKit, que numa carga direta (o `goto` do teste) roda
 * antes de o roteiro do cliente estar pronto. Clicar é o caminho real, e o
 * `Concluir Edição` no rótulo é a confirmação de que o modo entrou.
 */
async function abrirQuadroEmEdicao(page: Page) {
	await page.goto(`/operacoes/gise/${GISE_EDICAO}`);
	await page.getByRole('button', { name: 'Editar escala' }).click();
	await expect(page.getByRole('button', { name: 'Concluir Edição' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Editar DPC de supervisão' })).toBeVisible();
}

const editarSupervisor = (page: Page) =>
	page.getByRole('button', { name: 'Editar DPC de supervisão' });
const editarAssessor = (page: Page) => page.getByRole('button', { name: 'Editar assessor' });
const seletorSupervisor = (page: Page) =>
	page.getByLabel('Selecionar DPC de supervisão', { exact: true });
const seletorAssessor = (page: Page) => page.getByLabel('Selecionar assessor', { exact: true });

test.describe('Quadro de supervisão — edição por papel', () => {
	test.beforeEach(async ({ page }) => {
		if (!semearGiseEditavel()) test.skip(true, 'D1 local indisponível — sem fixture');
		const ok = await autenticarPagina(page, FIXTURE.adminGeral.id, 'admin');
		if (!ok) test.skip(true, 'sessão de Admin Geral não pôde ser semeada');
	});

	test('abrir a edição do supervisor troca o nome pelo seletor', async ({ page }) => {
		await abrirQuadroEmEdicao(page);

		// Em leitura: o nome persistido, sem seletor.
		await expect(page.getByText(FIXTURE.supervisor.nome)).toBeVisible();
		await expect(seletorSupervisor(page)).toHaveCount(0);

		await editarSupervisor(page).click();
		await expect(seletorSupervisor(page)).toBeVisible();
	});

	test('cancelar volta à leitura com o nome persistido', async ({ page }) => {
		await abrirQuadroEmEdicao(page);
		await editarSupervisor(page).click();
		await expect(seletorSupervisor(page)).toBeVisible();

		// "Fechar", não "Cancelar": é o rótulo do par Adicionar/Fechar da edição
		// inline (`BotoesSalvarCancelar`). "Cancelar" é do modal de remoção.
		await page.getByRole('button', { name: 'Fechar', exact: true }).click();

		await expect(seletorSupervisor(page)).toHaveCount(0);
		// O ponto: cancelar não apaga quem já estava designado.
		await expect(page.getByText(FIXTURE.supervisor.nome)).toBeVisible();
	});

	test('a exclusividade sobrevive ao contexto: abrir o assessor fecha o supervisor', async ({
		page
	}) => {
		await abrirQuadroEmEdicao(page);

		await editarSupervisor(page).click();
		await expect(seletorSupervisor(page)).toBeVisible();

		await editarAssessor(page).click();

		// Um `editandoPapel` só — o do supervisor tem de sumir sozinho.
		await expect(seletorAssessor(page)).toBeVisible();
		await expect(seletorSupervisor(page)).toHaveCount(0);
	});

	test('remover designação: confirma no modal e o supervisor_id zera NO BANCO', async ({
		page
	}) => {
		await abrirQuadroEmEdicao(page);
		expect(supervisorNoBanco()).toBe(FIXTURE.supervisor.id);

		await page.getByRole('button', { name: 'Remover DPC de supervisão' }).click();

		const modal = page.getByText('Remover designação?');
		await expect(modal).toBeVisible();

		await page.getByRole('button', { name: 'Remover', exact: true }).click();

		// O NOME sumindo, e não "Não definido": os outros três slots já dizem isso.
		await expect(page.getByText(FIXTURE.supervisor.nome)).toHaveCount(0);
		await expect(() => {
			expect(supervisorNoBanco()).toBeNull();
		}).toPass({ timeout: 10_000 });
	});
});
