import { test, expect } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { cargosSignatario } from '../src/lib/planos/padroes';
import {
	seedSession,
	cookieDeSessao,
	headersFormAction,
	execD1Local,
	queryD1Local
} from './session';

/**
 * Plano operacional de ponta a ponta: valores → plano → equipes → PDF.
 *
 * O que só ESTA suíte alcança (os unitários cobrem as regras isoladas):
 *
 *  - a **cadeia de papéis**: os valores são do Super Admin, o plano é do Admin
 *    Geral, e o plano nasce amarrado à versão de valores vigente NAQUELE
 *    momento;
 *  - a **recusa de emissão por cadastro incompleto**, no servidor. A tela
 *    desabilita o botão, mas o teste que importa é o GET direto: sem ele, colar
 *    a URL na barra emitiria um documento orçado a menor;
 *  - o **congelamento**: gravar uma tabela de valores NOVA depois do plano não
 *    pode mudar o PDF dele. É a razão de a tabela ser versionada, e nenhum
 *    unitário prova isso ponta a ponta.
 *
 * Como as contas fixture entram: sessão semeada no D1 local (ver `session.ts`)
 * — o login por senha é fail-closed no 2FA e o runner não tem caixa de entrada.
 *
 * O Super Admin depende de `SUPER_ADMIN_LOGIN` bater com o login do fixture; o
 * `servidor-e2e.ts` garante isso, mas um dev com o seu próprio valor faz a
 * sessão não virar super admin — daí o probe e o skip, como em `auditoria.spec`.
 */

/** Matrículas dos servidores criados aqui — o `afterAll` apaga por elas. */
const MAT_COM_CLASSE = 'PLANE2E01';
const MAT_SEM_CLASSE = 'PLANE2E02';
const NOME_PLANO = 'OPERACAO E2E PLANO OPERACIONAL';
/** Um SEGUNDO plano, só para provar que a lista dele não é alcançável do primeiro. */
const NOME_VIZINHO = 'OPERACAO E2E PLANO VIZINHO';
/** Um plano com as três cidades resolvidas, para a medição automática. */
const NOME_MEDIDO = 'OPERACAO E2E DISTANCIA MEDIDA';

/**
 * Admin Geral grava os valores desde a decisão E39 (`/valores` é da sessão de
 * admin). Antes era o Super Admin, e o spec dependia de `SUPER_ADMIN_LOGIN`
 * bater com o fixture — o que nunca acontecia na máquina de um dev com o seu
 * próprio login, e deixava metade do spec pulada.
 */
let tokenAdmin: string | null = null;
/** Policial comum: quem a tela de valores RECUSA. */
let tokenPolicial: string | null = null;
let planoId: number | null = null;
let planoVizinhoId: number | null = null;
let planoMedidoId: number | null = null;
/** As versões de valores que ESTE spec gravou — apagadas no fim. */
const versoesCriadas: number[] = [];

/** Um `<form>` do SvelteKit: `FormData` serializado como urlencoded. */
function form(campos: Record<string, string>): string {
	return new URLSearchParams(campos).toString();
}

/**
 * O resultado de uma form action postada com `x-sveltekit-action`.
 *
 * **O HTTP é SEMPRE 200 nesse modo.** Um `fail()` vira
 * `action_json({ type: 'failure', status }, undefined)` — sem `init` —, então o
 * status real viaja no CORPO e `res.status()` não distingue sucesso de recusa.
 * Asserir o status da resposta dá falso verde em toda recusa, e já deu: o teste
 * do limite de km passou no meu run e reprovou no CI por isso.
 */
async function resultadoDaAction(res: APIResponse) {
	const corpo = JSON.parse(await res.text());
	return {
		tipo: String(corpo.type),
		status: Number(corpo.status),
		dados: String(corpo.data ?? '')
	};
}

/** O `id` do único registro que a consulta devolve, ou `null`. */
function idDe(sql: string): number | null {
	const linhas = queryD1Local<{ id: number }>(sql);
	return linhas && linhas.length > 0 ? Number(linhas[0].id) : null;
}

/**
 * A versão VIGENTE pela regra do app — `ORDER BY vigente_desde DESC, id DESC`.
 *
 * Não é `MAX(id)`, e a diferença já reprovou este spec: vigência é por DATA, e
 * uma versão gravada depois com data anterior continua não sendo a vigente.
 */
function versaoVigente(): number | null {
	return idDe(`SELECT id FROM custo_parametros ORDER BY vigente_desde DESC, id DESC LIMIT 1;`);
}

/**
 * Uma data de vigência que ganha de tudo o que já está no banco.
 *
 * O D1 local é COMPARTILHADO com o desenvolvimento — pode ter versões de
 * qualquer data. Fixar `'2026-01-01'` aqui fazia o spec depender de o banco
 * estar limpo, que é a forma mais silenciosa de teste frágil: ele passa na
 * máquina de quem escreveu e reprova na do próximo.
 */
function proximaVigencia(): string {
	const linhas = queryD1Local<{ d: string | null }>(
		`SELECT MAX(vigente_desde) AS d FROM custo_parametros;`
	);
	const atual = linhas?.[0]?.d;
	const base = atual ? new Date(atual + 'T12:00:00Z') : new Date();
	base.setUTCDate(base.getUTCDate() + 1);
	return base.toISOString().slice(0, 10);
}

test.beforeAll(async () => {
	tokenAdmin = seedSession(FIXTURE.adminGeral.id, 'admin');
	tokenPolicial = seedSession(FIXTURE.policialA.id);
	if (!tokenAdmin || !tokenPolicial) return;

	// Dois servidores no MESMO cargo e classes diferentes: um resolve faixa de
	// custo, o outro não. É a diferença que o gate de emissão enxerga.
	execD1Local(
		`INSERT OR REPLACE INTO policiais (matricula, nome, cargo, classe, lotacao, telefone, senha, primeiro_acesso, ativo)
		 VALUES
		   ('${MAT_COM_CLASSE}', 'SERVIDOR E2E COM CLASSE', 'OIP', 'C', '${FIXTURE.unidadeA.nome}', '85 90000-0001', 'x', 0, 1),
		   ('${MAT_SEM_CLASSE}', 'SERVIDOR E2E SEM CLASSE', 'OIP', '',  '${FIXTURE.unidadeA.nome}', '85 90000-0002', 'x', 0, 1);`
	);
});

test.afterAll(() => {
	// O plano leva equipes e membros junto (CASCADE); os servidores saem por
	// matrícula. Sem isto, a próxima execução acha efetivo de sobra.
	// Ordem obrigatória: `custo_parametro_id` é RESTRICT, então o plano sai antes
	// das versões que ele referencia.
	if (planoId) execD1Local(`DELETE FROM planos_operacionais WHERE id = ${planoId};`);
	if (planoVizinhoId) execD1Local(`DELETE FROM planos_operacionais WHERE id = ${planoVizinhoId};`);
	if (planoMedidoId) execD1Local(`DELETE FROM planos_operacionais WHERE id = ${planoMedidoId};`);
	if (versoesCriadas.length > 0) {
		execD1Local(`DELETE FROM custo_parametros WHERE id IN (${versoesCriadas.join(',')});`);
	}
	execD1Local(
		`DELETE FROM policiais WHERE matricula IN ('${MAT_COM_CLASSE}', '${MAT_SEM_CLASSE}');`
	);
});

test.describe.serial('Plano operacional — valores, plano e PDF', () => {
	test.skip(() => !tokenAdmin || !tokenPolicial, 'D1 local indisponível');

	test('Admin Geral grava a tabela de valores; policial não alcança a tela', async ({
		request
	}) => {
		const res = await request.post('/valores?/salvarValores', {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				oip_cd_normal: '27,30',
				oip_ab_normal: '34,13',
				dpc_12_normal: '50,00',
				dpc_3e_normal: '60,00',
				oip_cd_plus: '35,49',
				oip_ab_plus: '44,37',
				dpc_12_plus: '65,00',
				dpc_3e_plus: '78,00',
				diaria_estadual: '350,00',
				diaria_interestadual: '600,00',
				distancia_minima_diaria_km: '100',
				vigente_desde: proximaVigencia()
			})
		});
		expect(res.status()).toBe(200);

		const versao = versaoVigente();
		expect(versao, 'a gravação tem de criar uma versão').not.toBeNull();
		versoesCriadas.push(versao!);

		// A tela é da sessão de admin (Admin Geral e Super Admin — E39). O
		// policial é redirecionado — o `load` recusa, não o menu.
		const negado = await request.get('/valores', {
			headers: cookieDeSessao(tokenPolicial!),
			maxRedirects: 0
		});
		expect(negado.status()).toBeGreaterThanOrEqual(300);
		expect(negado.status()).toBeLessThan(400);
	});

	test('o limite de km é GRAVADO na versão, e a versão o congela', async ({ request }) => {
		const valores = {
			oip_cd_normal: '27,30',
			oip_ab_normal: '34,13',
			dpc_12_normal: '50,00',
			dpc_3e_normal: '60,00',
			oip_cd_plus: '35,49',
			oip_ab_plus: '44,37',
			dpc_12_plus: '65,00',
			dpc_3e_plus: '78,00',
			diaria_estadual: '350,00',
			diaria_interestadual: '600,00'
		};

		// Km vazio é ERRO, como os valores: gravar 100 por omissão faria a versão
		// afirmar um limite que ninguém escolheu.
		const semKm = await request.post('/valores?/salvarValores', {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({ ...valores, distancia_minima_diaria_km: '', vigente_desde: proximaVigencia() })
		});
		const recusaVazio = await resultadoDaAction(semKm);
		expect(recusaVazio.tipo).toBe('failure');
		expect(recusaVazio.status).toBe(400);

		// Fora da faixa também — inclusive o zero, que pagaria diária a quem não
		// sai da cidade.
		for (const km of ['0', '2001', '99,5']) {
			const invalido = await request.post('/valores?/salvarValores', {
				headers: {
					...headersFormAction(tokenAdmin!),
					'content-type': 'application/x-www-form-urlencoded'
				},
				data: form({
					...valores,
					distancia_minima_diaria_km: km,
					vigente_desde: proximaVigencia()
				})
			});
			const recusa = await resultadoDaAction(invalido);
			expect(recusa.tipo, `km ${km} devia ser recusado`).toBe('failure');
			expect(recusa.status, `km ${km} devia ser recusado`).toBe(400);
		}

		const ok = await request.post('/valores?/salvarValores', {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				...valores,
				distancia_minima_diaria_km: '120',
				vigente_desde: proximaVigencia()
			})
		});
		// `tipo === 'success'` e não só o 200: nesse modo a recusa TAMBÉM devolve
		// 200, então conferir só o status faria este teste passar por não ter
		// gravado nada.
		expect((await resultadoDaAction(ok)).tipo).toBe('success');

		const versao = versaoVigente();
		versoesCriadas.push(versao!);
		const gravado = queryD1Local<{ km: number }>(
			`SELECT distancia_minima_diaria_km AS km FROM custo_parametros WHERE id = ${versao};`
		);
		expect(gravado![0].km).toBe(120);
	});

	test('Admin Geral cria o plano, que nasce amarrado à versão vigente', async ({ request }) => {
		const res = await request.post('/operacoes/planos/novo?/criar', {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				nome: NOME_PLANO,
				nup: '2026.E2E.00001',
				departamento: 'DPI SUL',
				// Sábado: toda hora da janela é hora extra PLUS. Escolhido de
				// propósito — em dia útil das 08:00 às 18:00 o custo seria zero, e
				// zero legítimo não distingue "sem custo" de "cálculo quebrado".
				data_inicio: '2026-08-01',
				hora_inicio: '05:00',
				hora_fim: '11:00',
				// As listas viajam como campos REPETIDOS, montados na tela de criação.
				// `padrao_*` elege a estrela — e a de origem é deliberadamente a
				// SEGUNDA da lista, para provar que a escolha vence a ordem de
				// inserção (é `adicionarOpcao` que faria da primeira a padrão).
				opcao_briefing: 'Sede E2E',
				opcao_origem: 'Origem E2E',
				opcao_destino: 'Cidade E2E',
				padrao_briefing: 'Sede E2E',
				padrao_origem: 'Origem E2E',
				padrao_destino: 'Cidade E2E',
				qtd_equipes: '2',
				oip_por_equipe: '4',
				// Cargo INVÁLIDO de propósito: o `<select>` da tela oferece três
				// opções, o POST direto não é obrigado a respeitá-las, e este campo
				// sai impresso sob a assinatura do documento.
				diretor_cargo: 'Imperador Supremo do DPI SUL'
			})
		});
		expect(res.status()).toBe(200);

		planoId = idDe(
			`SELECT id FROM planos_operacionais WHERE nome = '${NOME_PLANO}' ORDER BY id DESC LIMIT 1;`
		);
		expect(planoId, 'o plano tem de existir depois da action').not.toBeNull();

		const doPlano = idDe(
			`SELECT custo_parametro_id AS id FROM planos_operacionais WHERE id = ${planoId};`
		);
		expect(doPlano).toBe(versaoVigente());

		const equipes = queryD1Local<{ id: number }>(
			`SELECT id FROM plano_equipes WHERE plano_id = ${planoId} ORDER BY ordem;`
		);
		expect(equipes?.length).toBe(2);

		// O cargo inventado no POST não pode ter chegado à coluna que o PDF
		// imprime — o servidor recai na lista fechada.
		const assinatura = queryD1Local<{ diretor_cargo: string; diretor_id: number | null }>(
			`SELECT diretor_cargo, diretor_id FROM planos_operacionais WHERE id = ${planoId};`
		);
		// A lista é gerada do departamento em `unidades` — o DPI SUL semeado.
		expect(cargosSignatario('Departamento de Polícia do Interior Sul')).toContain(
			assinatura![0].diretor_cargo
		);
		// Sem `diretor_id` no formulário, o plano nasce com o padrão global e
		// nenhum servidor amarrado — o editor mostra isso e deixa escolher.
		expect(assinatura![0].diretor_id).toBeFalsy();
	});

	test('o briefing e o destino da criação viram opção PADRÃO e chegam copiados nas equipes', async () => {
		const opcoes = queryD1Local<{ tipo: string; valor: string; padrao: number }>(
			`SELECT tipo, valor, padrao FROM plano_opcoes WHERE plano_id = ${planoId} ORDER BY tipo;`
		);
		expect(opcoes).toEqual([
			{ tipo: 'briefing', valor: 'Sede E2E', padrao: 1 },
			{ tipo: 'destino', valor: 'Cidade E2E', padrao: 1 },
			{ tipo: 'origem', valor: 'Origem E2E', padrao: 1 }
		]);

		// COPIADOS, não herdados por cascata: a equipe é dona do que o Anexo I
		// imprime, e trocar a opção padrão depois não pode reescrever equipe já
		// montada. Sem esta asserção, `criarEquipes` podia voltar a ignorar os
		// padrões sem que nada reprovasse.
		const equipes = queryD1Local<{
			local_briefing: string;
			cidade_origem: string;
			cidade_destino: string;
			distancia_km: number | null;
		}>(
			`SELECT local_briefing, cidade_origem, cidade_destino, distancia_km FROM plano_equipes WHERE plano_id = ${planoId} ORDER BY ordem;`
		);
		expect(equipes).toHaveLength(2);
		for (const e of equipes!) {
			expect(e.local_briefing).toBe('Sede E2E');
			expect(e.cidade_origem).toBe('Origem E2E');
			expect(e.cidade_destino).toBe('Cidade E2E');
			// A distância NÃO é copiada de padrão nenhum: ela é do par origem→destino
			// daquela equipe, e herdá-la embutiria no cálculo da diária um número que
			// ninguém mediu para este trajeto.
			expect(e.distancia_km).toBeNull();
		}
	});

	test('com as três cidades resolvidas, a equipe nasce com a distância MEDIDA', async ({
		request
	}) => {
		// Códigos IBGE reais. O trajeto é Jucás → Iguatu → Acopiara: 35 + 37 = 72 km,
		// e NÃO os 70 km do caminho direto — é o briefing entrando na conta.
		const JUCAS = '2307403';
		const IGUATU = '2305506';
		const ACOPIARA = '2300309';

		const res = await request.post('/operacoes/planos/novo?/criar', {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				nome: NOME_MEDIDO,
				departamento: 'DPI SUL',
				data_inicio: '2026-08-01',
				hora_inicio: '05:00',
				opcao_origem: 'Jucás',
				municipio_origem: JUCAS,
				padrao_origem: 'Jucás',
				opcao_briefing: 'Sede E2E Medida',
				municipio_briefing: IGUATU,
				padrao_briefing: 'Sede E2E Medida',
				opcao_destino: 'Acopiara',
				municipio_destino: ACOPIARA,
				padrao_destino: 'Acopiara',
				qtd_equipes: '1',
				oip_por_equipe: '1'
			})
		});
		expect(res.status()).toBe(200);

		planoMedidoId = idDe(
			`SELECT id FROM planos_operacionais WHERE nome = '${NOME_MEDIDO}' ORDER BY id DESC LIMIT 1;`
		);
		expect(planoMedidoId).not.toBeNull();

		// O município chegou junto do valor — é ele que permite medir.
		const opcoes = queryD1Local<{ tipo: string; municipio_ibge: string | null }>(
			`SELECT tipo, municipio_ibge FROM plano_opcoes WHERE plano_id = ${planoMedidoId} ORDER BY tipo;`
		);
		expect(opcoes).toEqual([
			{ tipo: 'briefing', municipio_ibge: IGUATU },
			{ tipo: 'destino', municipio_ibge: ACOPIARA },
			{ tipo: 'origem', municipio_ibge: JUCAS }
		]);

		// A matriz semeada pela 0072 tem de responder pelos três pares do trajeto.
		const perna = (a: string, b: string) =>
			queryD1Local<{ km: number }>(
				`SELECT km FROM distancias_municipios WHERE origem_ibge = '${a < b ? a : b}' AND destino_ibge = '${a < b ? b : a}';`
			)?.[0]?.km ?? null;
		const esperado = (perna(JUCAS, IGUATU) ?? 0) + (perna(IGUATU, ACOPIARA) ?? 0);
		expect(esperado).toBeGreaterThan(0);
		// Passar pelo briefing custa mais do que ir direto: é a razão de a regra
		// somar as duas pernas, e o que este teste fixa contra uma volta ao direto.
		expect(esperado).toBeGreaterThan(perna(JUCAS, ACOPIARA) ?? 0);

		const equipe = queryD1Local<{ distancia_km: number | null }>(
			`SELECT distancia_km FROM plano_equipes WHERE plano_id = ${planoMedidoId};`
		);
		// A equipe NASCE sem distância: a medida é da TELA (o `load` calcula e o card
		// preenche). Gravar no `criarEquipes` faria o número entrar no banco sem
		// ninguém ter visto o trajeto que o produziu.
		expect(equipe![0].distancia_km).toBeNull();

		// E a tela mede: mesma função, mesmos dados.
		const editor = await request.get(`/operacoes/planos/${planoMedidoId}`, {
			headers: cookieDeSessao(tokenAdmin!)
		});
		expect(editor.status()).toBe(200);
		expect(await editor.text()).toContain(String(esperado));
	});

	test('a distância e a rubrica escolhidas chegam ao banco e voltam', async ({ request }) => {
		// Caminho da PERSISTÊNCIA — que `distancia_km` e `tipo_custo` atravessam a
		// action —, não a regra em si, que é dos unitários (`custeio.test.ts`). A
		// action grava o que o admin escolheu: a sugestão é da tela, e sobrepor-se
		// a ela aqui impediria a correção que o card existe para permitir.
		const equipe = idDe(
			`SELECT id FROM plano_equipes WHERE plano_id = ${planoId} ORDER BY ordem LIMIT 1;`
		);

		const res = await request.post(`/operacoes/planos/${planoId}?/salvarEquipe`, {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				equipe_id: String(equipe),
				nome: 'Equipe 01',
				tipo: 'operacional',
				cidade_origem: 'Origem E2E',
				cidade_destino: 'Cidade E2E',
				distancia_km: '180',
				tipo_custo: 'diaria',
				diaria_tipo: 'estadual',
				diarias_meias: '2'
			})
		});
		expect(res.status()).toBe(200);

		const linha = queryD1Local<{ distancia_km: number | null; tipo_custo: string }>(
			`SELECT distancia_km, tipo_custo FROM plano_equipes WHERE id = ${equipe};`
		);
		expect(linha![0].distancia_km).toBe(180);
		expect(linha![0].tipo_custo).toBe('diaria');

		// Campo VAZIO volta a NULL, e não a zero: zero é a afirmação de que origem e
		// destino são a mesma cidade, e a tela precisa distinguir "não medido" para
		// poder avisar (ver `sugerirCusteio`).
		const limpa = await request.post(`/operacoes/planos/${planoId}?/salvarEquipe`, {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				equipe_id: String(equipe),
				nome: 'Equipe 01',
				tipo: 'operacional',
				cidade_origem: 'Origem E2E',
				cidade_destino: 'Cidade E2E',
				distancia_km: '',
				tipo_custo: 'sem_custo'
			})
		});
		expect(limpa.status()).toBe(200);
		expect(
			queryD1Local<{ distancia_km: number | null }>(
				`SELECT distancia_km FROM plano_equipes WHERE id = ${equipe};`
			)![0].distancia_km
		).toBeNull();

		// Distância fora da faixa é recusada — não gravada truncada.
		const ruim = await request.post(`/operacoes/planos/${planoId}?/salvarEquipe`, {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				equipe_id: String(equipe),
				nome: 'Equipe 01',
				tipo: 'operacional',
				distancia_km: '99999',
				tipo_custo: 'sem_custo'
			})
		});
		expect(String(await ruim.text())).toContain('Distância inválida');
	});

	test('opção de OUTRO plano não é alcançável pela rota deste', async ({ request }) => {
		// A classe do FLW-ESC-002: o id da opção vem do FORMULÁRIO, e ser Admin
		// Geral não pode bastar para mexer na lista do plano vizinho por POST
		// direto. Quem recusa é a camada de dados, que confere o `plano_id` —
		// nenhum índice faria isso, porque o único parcial conta padrões POR
		// PLANO e ficaria satisfeito com a troca no plano errado.
		// O plano vizinho é CRIADO aqui, e não procurado no banco: depender de já
		// existir outro plano no D1 local faria este teste passar por skip na
		// máquina limpa do CI, que é onde ele mais precisa rodar.
		const criacao = await request.post('/operacoes/planos/novo?/criar', {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				nome: NOME_VIZINHO,
				departamento: 'DPI SUL',
				data_inicio: '2026-08-01',
				hora_inicio: '05:00',
				opcao_destino: 'Cidade Vizinha E2E',
				padrao_destino: 'Cidade Vizinha E2E',
				qtd_equipes: '1',
				oip_por_equipe: '1'
			})
		});
		expect(criacao.status()).toBe(200);
		planoVizinhoId = idDe(
			`SELECT id FROM planos_operacionais WHERE nome = '${NOME_VIZINHO}' ORDER BY id DESC LIMIT 1;`
		);
		expect(planoVizinhoId).not.toBeNull();

		const alheia = idDe(`SELECT id FROM plano_opcoes WHERE plano_id = ${planoVizinhoId};`);
		expect(alheia, 'o plano vizinho tem de ter a opção que nasceu com ele').not.toBeNull();

		const antes = queryD1Local<{ padrao: number }>(
			`SELECT padrao FROM plano_opcoes WHERE id = ${alheia};`
		);

		for (const acao of ['definirOpcaoPadrao', 'removerOpcao']) {
			const res = await request.post(`/operacoes/planos/${planoId}?/${acao}`, {
				headers: {
					...headersFormAction(tokenAdmin!),
					'content-type': 'application/x-www-form-urlencoded'
				},
				data: form({ opcao_id: String(alheia) })
			});
			// Form action recusada volta 200 com `type: 'failure'` no corpo — o
			// status HTTP do `fail()` não sobe até aqui.
			expect(String(await res.text())).toContain('não encontrada neste plano');
		}

		// E, sobretudo, a linha alheia continua exatamente como estava.
		expect(queryD1Local(`SELECT padrao FROM plano_opcoes WHERE id = ${alheia};`)).toEqual(antes);
	});

	test('servidor sem classe resolvida faz o download recusar com 409', async ({ request }) => {
		const equipe = idDe(
			`SELECT id FROM plano_equipes WHERE plano_id = ${planoId} ORDER BY ordem LIMIT 1;`
		);
		const semClasse = idDe(`SELECT id FROM policiais WHERE matricula = '${MAT_SEM_CLASSE}';`);

		// A equipe cobra hora extra; sem faixa resolvida a linha dele valeria R$ 0.
		execD1Local(
			`UPDATE plano_equipes SET tipo_custo = 'hora_extra', horas_plus = 6 WHERE id = ${equipe};`
		);
		const add = await request.post(`/operacoes/planos/${planoId}?/adicionarMembro`, {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({ equipe_id: String(equipe), policial_id: String(semClasse) })
		});
		expect(add.status()).toBe(200);

		const res = await request.get(`/api/planos/${planoId}/download`, {
			headers: cookieDeSessao(tokenAdmin!)
		});
		expect(res.status()).toBe(409);
		const corpo = await res.json();
		// A mensagem NOMEIA quem falta: "corrija o cadastro" sem dizer de quem
		// manda o admin procurar linha a linha.
		expect(String(corpo.error)).toContain('SERVIDOR E2E SEM CLASSE');
	});

	test('resolvido o cadastro, o PDF sai com nome de arquivo e tipo corretos', async ({
		request
	}) => {
		const semClasse = idDe(`SELECT id FROM policiais WHERE matricula = '${MAT_SEM_CLASSE}';`);
		const comClasse = idDe(`SELECT id FROM policiais WHERE matricula = '${MAT_COM_CLASSE}';`);
		const equipe = idDe(
			`SELECT id FROM plano_equipes WHERE plano_id = ${planoId} ORDER BY ordem LIMIT 1;`
		);

		// Troca o pendente por quem tem classe — é o que o admin faria na tela.
		const membro = idDe(
			`SELECT id FROM plano_equipe_membros WHERE plano_id = ${planoId} AND policial_id = ${semClasse};`
		);
		const rem = await request.post(`/operacoes/planos/${planoId}?/removerMembro`, {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({ membro_id: String(membro) })
		});
		expect(rem.status()).toBe(200);

		const add = await request.post(`/operacoes/planos/${planoId}?/adicionarMembro`, {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({ equipe_id: String(equipe), policial_id: String(comClasse) })
		});
		expect(add.status()).toBe(200);

		const res = await request.get(`/api/planos/${planoId}/download`, {
			headers: cookieDeSessao(tokenAdmin!)
		});
		expect(res.status()).toBe(200);
		expect(res.headers()['content-type']).toContain('application/pdf');

		const numero = queryD1Local<{ numero: number; ano: number }>(
			`SELECT numero, ano FROM planos_operacionais WHERE id = ${planoId};`
		);
		const esperado = `plano_operacional_${numero![0].numero}_${numero![0].ano}.pdf`;
		expect(res.headers()['content-disposition']).toContain(esperado);

		const bytes = await res.body();
		expect(bytes.length).toBeGreaterThan(5000);
		expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
	});

	test('o download fica registrado na auditoria antes de qualquer byte', async () => {
		const linhas = queryD1Local<{ n: number }>(
			`SELECT COUNT(*) AS n FROM audit_log
			 WHERE acao = 'exportar_plano_operacional' AND entidade_id = ${planoId};`
		);
		// Duas tentativas de download acima: a recusada por 409 TAMBÉM audita —
		// baixar é acesso a dado pessoal, e o registro vem antes da emissão.
		expect(Number(linhas![0].n)).toBeGreaterThanOrEqual(2);
	});

	test('reajustar os valores NÃO muda o PDF do plano já criado', async ({ request }) => {
		const antes = await request.get(`/api/planos/${planoId}/download`, {
			headers: cookieDeSessao(tokenAdmin!)
		});
		const bytesAntes = await antes.body();

		// Uma versão NOVA, com o dobro do valor da hora do OIP C.
		const reajuste = await request.post('/valores?/salvarValores', {
			headers: {
				...headersFormAction(tokenAdmin!),
				'content-type': 'application/x-www-form-urlencoded'
			},
			data: form({
				oip_cd_normal: '54,60',
				oip_ab_normal: '68,26',
				dpc_12_normal: '100,00',
				dpc_3e_normal: '120,00',
				oip_cd_plus: '70,98',
				oip_ab_plus: '88,74',
				dpc_12_plus: '130,00',
				dpc_3e_plus: '156,00',
				diaria_estadual: '700,00',
				diaria_interestadual: '1200,00',
				distancia_minima_diaria_km: '100',
				vigente_desde: proximaVigencia()
			})
		});
		expect(reajuste.status()).toBe(200);
		versoesCriadas.push(versaoVigente()!);
		// O reajuste É a nova vigente — se não fosse, o teste abaixo passaria por
		// não ter acontecido nada.
		expect(versaoVigente()).not.toBe(
			idDe(`SELECT custo_parametro_id AS id FROM planos_operacionais WHERE id = ${planoId};`)
		);

		const depois = await request.get(`/api/planos/${planoId}/download`, {
			headers: cookieDeSessao(tokenAdmin!)
		});
		const bytesDepois = await depois.body();

		// Byte a byte não serve: o jsPDF grava um /ID aleatório no trailer. O que
		// tem de bater é o TAMANHO e o total impresso — se o plano tivesse migrado
		// para a versão nova, o valor no Anexo II dobraria e o arquivo mudaria de
		// tamanho junto com o texto.
		expect(bytesDepois.length).toBe(bytesAntes.length);
		// A equipe cobra 6h PLUS de um OIP C: 6 × 35,49 = 212,94 com a tabela do
		// plano, e 6 × 70,98 = 425,88 com a do reajuste. É o par que distingue
		// "congelou" de "migrou" — o tamanho igual acima sozinho não distinguiria
		// dois valores de mesma largura.
		expect(bytesDepois.toString('latin1')).toContain('R$ 212,94');
		expect(bytesDepois.toString('latin1')).not.toContain('R$ 425,88');
	});
});
