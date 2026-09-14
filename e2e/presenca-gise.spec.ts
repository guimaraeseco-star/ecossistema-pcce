import { test, expect } from '@playwright/test';
import { FIXTURE } from './global-setup';
import { SELFIE_JPEG } from './evidencias';
import {
	seedSession,
	seedDesafioAssinatura,
	seedReauthAssinatura,
	cookieDeSessao,
	headersFormAction,
	execD1Local,
	queryD1Local,
	BASE_URL
} from './session';

/**
 * Presença GISE em TELA (fluxo avançado, mobile-first) + comprovante — cobre a
 * parte do roteiro 6.2 do TESTING.md que não exige hardware: entrada e saída
 * com evidências (2FA semeado + GPS) via form actions do /operacoes/presenca,
 * e o comprovante sob demanda (GET /api/gise/[id]/presenca/termo).
 *
 * As actions são chamadas como o `use:enhance` chamaria (POST form-encoded com
 * header `origin` + `x-sveltekit-action`), com o desafio 2FA semeado no D1 —
 * mesma técnica do assinatura-simples.spec. Fica de fora: câmera/liveness
 * (client-side por decisão de produto) e a presença por Token A3 (validação de
 * janela de horário depende da hora corrente — roteiro manual/QA A3).
 *
 * **Evidências são EXIGIDAS pelo servidor** (flags padrão do banco: foto e GPS
 * ligadas), e é o que os três testes de política cobrem: sem evidência e sem
 * motivo → recusado e nada gravado; motivo de lista fechada → aceito, com o
 * motivo na trilha; evidência completa → aceito com a selfie no R2. Até
 * ago/2026 as duas flags viviam só no `SignaturePad`, então o caso de sucesso
 * daqui passava mandando apenas GPS — o spec documentava a lacuna sem notá-la.
 */

const GISE = FIXTURE.gise.id;
const CODIGO = '424242';

/**
 * O que a tela de presença captura com as flags de foto e GPS ligadas.
 * Form-encoded (só strings) — é assim que o `use:enhance` manda; a selfie é a
 * mesma JPEG 1x1 dos specs de assinatura avançada (`./evidencias`).
 */
const EVIDENCIAS = {
	latitude: '-3.7319',
	longitude: '-38.5267',
	selfieBase64: SELFIE_JPEG
};

/** POST de form action do SvelteKit como o enhance faz (fora de /api, o CSRF é
 *  o check de origin do próprio kit). */
async function postAction(
	request: import('@playwright/test').APIRequestContext,
	token: string,
	action: 'salvarEntrada' | 'salvarSaida',
	form: Record<string, string>
) {
	return request.post(`/operacoes/presenca?/${action}`, {
		headers: {
			...cookieDeSessao(token),
			origin: BASE_URL,
			'x-sveltekit-action': 'true'
		},
		form
	});
}

let token: string | null = null;

test.beforeAll(() => {
	// Presença limpa a cada suíte (o global-setup também limpa, mas este spec
	// pode rodar isolado via --grep).
	execD1Local(`DELETE FROM gise_presencas WHERE gise_id = ${GISE};`);
	token = seedSession(FIXTURE.membroGise.id);
});

test.describe('Presença GISE em tela + comprovante', () => {
	test.describe.configure({ mode: 'serial' });
	test.skip(() => !token, 'D1 local indisponível — seed de sessão falhou');

	test('sem código 2FA → falha (é sempre obrigatório)', async ({ request }) => {
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!reauthId, 'D1 local indisponível');
		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE),
			reauthId: reauthId!
		});
		// A mensagem DO 2FA, não 'obrigat' solto: o gate de evidência introduzido
		// em ago/2026 também diz "obrigatória", e a asserção larga passaria a
		// aceitar a recusa errada como prova de que o 2FA é exigido.
		expect(await res.text()).toContain('Código de verificação por e-mail é obrigatório');
	});

	test('comprovante antes da presença → 404', async ({ request }) => {
		const res = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=entrada`, {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(404);
	});

	test('sem foto e sem motivo declarado → recusada e nada gravado', async ({ request }) => {
		// Este era o payload do caso de SUCESSO deste spec (GPS e mais nada) —
		// enquanto as flags viviam só na tela, ele gravava presença sem foto.
		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!desafioId || !reauthId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE),
			latitude: '-3.7319',
			longitude: '-38.5267',
			codigoEmail: CODIGO,
			desafioId: desafioId!,
			reauthId: reauthId!
		});
		const body = await res.text();
		expect(body, `status=${res.status()} body=${body}`).toMatch(/foto é obrigatória/i);
		expect(body).not.toContain('"success":1');
		expect(presencasDa(GISE)).toBe(0);
	});

	test('foto ausente COM motivo declarado → aceita, e o motivo fica na trilha', async ({
		request
	}) => {
		// O caminho de exceção: a ausência é aceita, mas precisa vir DECLARADA com
		// um motivo de lista fechada — e o que a torna auditável é ela aparecer nos
		// metadados do evento, não só a presença ter sido gravada.
		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!desafioId || !reauthId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE),
			latitude: '-3.7319',
			longitude: '-38.5267',
			motivoSemFoto: 'permissao_negada',
			codigoEmail: CODIGO,
			desafioId: desafioId!,
			reauthId: reauthId!
		});
		// `fail()` em form action responde HTTP 200 com `{"type":"failure"}` no
		// CORPO — `toBe(200)` não distingue aceito de recusado aqui.
		const corpo = await res.text();
		expect(corpo, corpo).toContain('"type":"success"');
		expect(presencasDa(GISE)).toBe(1);

		// Gravou SEM selfie (é o ponto da exceção) e o motivo está na auditoria.
		const linha = queryD1Local<{ entrada_selfie_key: string | null }>(
			`SELECT entrada_selfie_key FROM gise_presencas
			 WHERE gise_id=${GISE} AND policial_id=${FIXTURE.membroGise.id}`
		)?.[0];
		expect(linha?.entrada_selfie_key ?? null).toBeNull();

		const evento = queryD1Local<{ metadados: string | null }>(
			`SELECT metadados FROM audit_log
			 WHERE acao='presenca_gise_entrada' AND entidade_id=${GISE}
			 ORDER BY id DESC LIMIT 1`
		)?.[0];
		expect(evento?.metadados ?? '').toContain('motivoSemFoto');
		expect(evento?.metadados ?? '').toContain('permissao_negada');

		// Limpa para os testes seguintes: a entrada já registrada recusaria a
		// entrada COM evidência completa que vem a seguir.
		execD1Local(`DELETE FROM gise_presencas WHERE gise_id = ${GISE};`);
	});

	test('entrada com 2FA + GPS + foto → registrada e auditável no comprovante', async ({
		request
	}) => {
		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!desafioId || !reauthId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE),
			...EVIDENCIAS,
			codigoEmail: CODIGO,
			desafioId: desafioId!,
			reauthId: reauthId!
		});
		const corpo = await res.text();
		expect(corpo, corpo).toContain('"type":"success"');

		// Comprovante AVANÇADO gerado sob demanda a partir das evidências.
		const termo = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=entrada`, {
			headers: cookieDeSessao(token!)
		});
		expect(termo.status(), await termo.text().catch(() => '')).toBe(200);
		expect(termo.headers()['content-type']).toContain('application/pdf');
		expect((await termo.body()).subarray(0, 5).toString()).toBe('%PDF-');
	});

	test('comprovante de saída antes da saída → 404', async ({ request }) => {
		const res = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=saida`, {
			headers: cookieDeSessao(token!)
		});
		expect(res.status()).toBe(404);
	});

	test('saída com 2FA + evidências → registrada, comprovante disponível', async ({ request }) => {
		// A saída passa pelo MESMO gate de evidência da entrada (é o mesmo
		// `prepararConfirmacaoPresenca`) — antes deste spec ela era exercitada sem
		// nenhuma evidência, o que só passava porque o gate não existia.
		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!desafioId || !reauthId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarSaida', {
			giseId: String(GISE),
			...EVIDENCIAS,
			codigoEmail: CODIGO,
			desafioId: desafioId!,
			reauthId: reauthId!
		});
		const corpo = await res.text();
		expect(corpo, corpo).toContain('"type":"success"');

		const termo = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=saida`, {
			headers: cookieDeSessao(token!)
		});
		expect(termo.status()).toBe(200);
		expect((await termo.body()).subarray(0, 5).toString()).toBe('%PDF-');
	});

	test('não-participante com 2FA válido → 403 (vínculo é exigido na escrita)', async ({
		request
	}) => {
		// policialA é conta legítima (sessão + termo aceito) mas NÃO participa da
		// GISE fixture. Passa pelo 2FA (desafio próprio) e ainda assim a action
		// deve recusar por vínculo — antes desta guarda, gravava presença alheia.
		const tokenForasteiro = seedSession(FIXTURE.policialA.id);
		const desafioForasteiro = seedDesafioAssinatura(FIXTURE.policialA.id, CODIGO);
		const reauthForasteiro = tokenForasteiro
			? seedReauthAssinatura(FIXTURE.policialA.id, tokenForasteiro)
			: null;
		test.skip(!tokenForasteiro || !desafioForasteiro || !reauthForasteiro, 'D1 local indisponível');

		const res = await postAction(request, tokenForasteiro!, 'salvarEntrada', {
			giseId: String(GISE),
			codigoEmail: CODIGO,
			desafioId: desafioForasteiro!,
			reauthId: reauthForasteiro!
		});
		const body = await res.text();
		expect(body).toContain('não participa');
		expect(body).not.toContain('"success":1');
	});

	test('guardas do comprovante: anônimo 401, não-participante 403, tipo inválido 400', async ({
		request
	}) => {
		const anon = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=entrada`);
		expect(anon.status()).toBe(401);

		const tokenForasteiro = seedSession(FIXTURE.policialA.id);
		test.skip(!tokenForasteiro, 'D1 local indisponível');
		const forasteiro = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=entrada`, {
			headers: cookieDeSessao(tokenForasteiro!)
		});
		expect(forasteiro.status()).toBe(403);

		const tipoInvalido = await request.get(`/api/gise/${GISE}/presenca/termo?tipo=x`, {
			headers: cookieDeSessao(token!)
		});
		expect(tipoInvalido.status()).toBe(400);
	});
});

/** Calendário civil em Brasília — o mesmo critério de `horarioGiseLiberado`. */
function diaBrasiliaISO(offsetDias: number): string {
	const ms = Date.now() + offsetDias * 86_400_000;
	return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function semearGisePresenca(id: number, dataInicio: string, status: string): boolean {
	return execD1Local(
		`DELETE FROM gise_presencas WHERE gise_id=${id};
		 DELETE FROM gise_membros WHERE equipe_id=${id};
		 DELETE FROM gise_equipes WHERE id=${id};
		 DELETE FROM gise_seccionais WHERE id=${id};
		 DELETE FROM gise_escalas WHERE id=${id};

		 INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, supervisor_id)
		 VALUES (${id}, '${dataInicio}', '${status}', '08:00', '16:00', ${FIXTURE.supervisor.id});

		 INSERT INTO gise_seccionais (id, gise_id, seccional_id, status, hora_entrada, hora_saida)
		 VALUES (${id}, ${id}, ${FIXTURE.seccional.id}, 'preenchida', '08:00', '16:00');

		 INSERT INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip)
		 VALUES (${id}, ${id}, 'operacional', 1, 1);

		 INSERT INTO gise_membros (equipe_id, policial_id, gise_id)
		 VALUES (${id}, ${FIXTURE.membroGise.id}, ${id});`
	);
}

function limparGisePresenca(id: number): void {
	execD1Local(
		`DELETE FROM gise_presencas WHERE gise_id=${id};
		 DELETE FROM gise_membros WHERE equipe_id=${id};
		 DELETE FROM gise_equipes WHERE id=${id};
		 DELETE FROM gise_seccionais WHERE id=${id};
		 DELETE FROM gise_escalas WHERE id=${id};`
	);
}

function dataInicioDa(giseId: number): string | null {
	return (
		queryD1Local<{ data_inicio: string }>(
			`SELECT data_inicio FROM gise_escalas WHERE id=${giseId}`
		)?.[0]?.data_inicio ?? null
	);
}

function presencasDa(giseId: number): number {
	return Number(
		queryD1Local<{ n: number }>(
			`SELECT COUNT(*) AS n FROM gise_presencas WHERE gise_id=${giseId}`
		)?.[0]?.n ?? -1
	);
}

test.describe('FLW-AUT-006 / 007 — janela e GISE finalizada no /operacoes/presenca', () => {
	const GISE_FUTURA = 99501;
	const GISE_FECHADA = 99502;

	test.afterAll(() => {
		limparGisePresenca(GISE_FUTURA);
		limparGisePresenca(GISE_FECHADA);
	});

	test('entrada antes do horário → 409 e nada gravado (FLW-AUT-006)', async ({ request }) => {
		test.skip(!token, 'D1 local indisponível');
		test.skip(!semearGisePresenca(GISE_FUTURA, diaBrasiliaISO(1), 'em_andamento'), 'seed falhou');

		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!desafioId || !reauthId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE_FUTURA),
			codigoEmail: CODIGO,
			desafioId: desafioId!,
			reauthId: reauthId!
		});
		const body = await res.text();
		expect(body, `status=${res.status()} body=${body}`).toMatch(/ainda não está liberada/i);
		expect(body).not.toContain('"success":1');
		expect(presencasDa(GISE_FUTURA)).toBe(0);
	});

	test('entrada em GISE finalizada → 409 e nada gravado (FLW-AUT-007)', async ({ request }) => {
		test.skip(!token, 'D1 local indisponível');
		test.skip(!semearGisePresenca(GISE_FECHADA, diaBrasiliaISO(-1), 'finalizada'), 'seed falhou');

		const desafioId = seedDesafioAssinatura(FIXTURE.membroGise.id, CODIGO);
		const reauthId = seedReauthAssinatura(FIXTURE.membroGise.id, token!);
		test.skip(!desafioId || !reauthId, 'D1 local indisponível');

		const res = await postAction(request, token!, 'salvarEntrada', {
			giseId: String(GISE_FECHADA),
			codigoEmail: CODIGO,
			desafioId: desafioId!,
			reauthId: reauthId!
		});
		const body = await res.text();
		expect(body, `status=${res.status()} body=${body}`).toMatch(/finalizada/i);
		expect(body).not.toContain('"success":1');
		expect(presencasDa(GISE_FECHADA)).toBe(0);
	});
});

/**
 * O PISO do portão de janela.
 *
 * `horarioGiseLiberado` falha ABERTO quando a data/hora não parseia
 * (`isNaN(alvo.getTime()) → return true`), para não trancar a GISE inteira por
 * um dado ruim. A decisão é deliberada, e o preço é que a validade do dado
 * passa a ser a única coisa sustentando FLW-AUT-006 — que é o teste logo acima.
 * `salvarDatasHorarios` gravava com checagem de truthiness apenas, então
 * `data_inicio='banana'` liberava a confirmação fora do horário para todos os
 * membros daquela escala, sem erro nenhum.
 */
test.describe('o portão de janela tem piso: data e hora recusadas na escrita', () => {
	const GISE_EDITAVEL = 99503;

	test.afterAll(() => limparGisePresenca(GISE_EDITAVEL));

	for (const [rotulo, payload] of [
		['data que não é data', { data_inicio: 'banana', hora_entrada: '08:00', hora_saida: '16:00' }],
		[
			'data que só PARECE data (31 de fevereiro)',
			{ data_inicio: '2026-02-31', hora_entrada: '08:00', hora_saida: '16:00' }
		],
		[
			'hora fora do relógio',
			{ data_inicio: '2026-07-15', hora_entrada: '99:99', hora_saida: '16:00' }
		]
	] as const) {
		test(`${rotulo} → recusada, e a data gravada não muda`, async ({ request }) => {
			const semeou = semearGisePresenca(GISE_EDITAVEL, '2026-07-15', 'em_preenchimento');
			test.skip(!semeou, 'D1 local indisponível');
			const tokenAdmin = seedSession(FIXTURE.adminGeral.id, 'admin');
			test.skip(!tokenAdmin, 'D1 local indisponível');

			const res = await request.post(`/operacoes/gise/${GISE_EDITAVEL}?/salvarDatasHorarios`, {
				headers: headersFormAction(tokenAdmin!),
				form: { ...payload, feriado: 'false' }
			});
			const body = await res.text();
			expect(body, body).not.toContain('"type":"success"');
			expect(dataInicioDa(GISE_EDITAVEL)).toBe('2026-07-15');
		});
	}

	test('data e hora válidas passam — a recusa é do formato, não da action', async ({ request }) => {
		// O contraponto obrigatório: sem ele os três testes acima passariam mesmo
		// se a action tivesse quebrado por completo.
		const semeou = semearGisePresenca(GISE_EDITAVEL, '2026-07-15', 'em_preenchimento');
		test.skip(!semeou, 'D1 local indisponível');
		const tokenAdmin = seedSession(FIXTURE.adminGeral.id, 'admin');
		test.skip(!tokenAdmin, 'D1 local indisponível');

		const res = await request.post(`/operacoes/gise/${GISE_EDITAVEL}?/salvarDatasHorarios`, {
			headers: headersFormAction(tokenAdmin!),
			// `9:00` de propósito, e DIFERENTE do horário semeado (08:00): é o que a
			// tela manda (`validarHora` aceita um dígito e `normalizarHora` não
			// preenche o zero), e a diferença é o que prova que a gravação ocorreu —
			// esperar `08:00` sobre uma semente `08:00` passaria com a action morta.
			form: {
				data_inicio: '2026-07-20',
				hora_entrada: '9:00',
				hora_saida: '17:00',
				feriado: 'false'
			}
		});
		const body = await res.text();
		expect(body, body).not.toContain('"type":"failure"');
		expect(dataInicioDa(GISE_EDITAVEL)).toBe('2026-07-20');

		const hora = queryD1Local<{ hora_entrada: string }>(
			`SELECT hora_entrada FROM gise_escalas WHERE id=${GISE_EDITAVEL}`
		)?.[0]?.hora_entrada;
		expect(hora).toBe('09:00');
	});
});
