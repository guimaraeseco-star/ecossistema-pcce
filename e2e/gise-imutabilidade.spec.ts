/**
 * GISE finalizada não muda mais — FLW-GISE-006 (e a fatia de GISE-007 nas
 * actions de equipe).
 *
 * Finalizar é terminal: o modal diz "não poderá ser desfeita", e voltar atrás
 * tem caminho próprio e auditado (`reabrirEscala`). `salvarSlotsEquipe`
 * contornava esse caminho de um jeito particularmente ruim — mutava as vagas
 * ANTES de olhar o status, e então apagava o `gise_documentos` da escala
 * assinada e a devolvia a `em_preenchimento`.
 *
 * Os dois cenários abaixo não se substituem:
 *
 *   1. **escala finalizada** — o gate de estado. Nenhuma das quatro actions de
 *      equipe pode tocar nela.
 *   2. **equipe de OUTRA GISE** — o gate de escopo. As funções de banco filtram
 *      só por `equipes.id`, então um id alheio no corpo do formulário caía na
 *      equipe de outra escala enquanto o descarte de documento caía na GISE da
 *      URL. Escala finalizada não testa isso: o primeiro gate barra antes.
 */
import { test, expect, request as contextoDeApi } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { VERSAO as TERMO_VERSAO, calcularHashTermo } from '../src/lib/server/termo/termo-vigente';
import { FIXTURE } from './global-setup';
import { BASE_URL, execD1Local, queryD1Local, seedSession, headersFormAction } from './session';

/** Faixa 994xx: exclusiva deste spec. */
const GISE_FINALIZADA = 99401;
const GISE_VIZINHA = 99402;
const SEC_FINALIZADA = 99401;
const SEC_VIZINHA = 99402;
const EQ_FINALIZADA = 99401;
const EQ_VIZINHA = 99402;
const SLOTS_ORIGINAIS = 3;

async function semear(): Promise<boolean> {
	const termoHash = await calcularHashTermo();
	return execD1Local(
		`DELETE FROM gise_documentos WHERE gise_id IN (${GISE_FINALIZADA}, ${GISE_VIZINHA});
		 DELETE FROM gise_equipes WHERE id IN (${EQ_FINALIZADA}, ${EQ_VIZINHA});
		 DELETE FROM gise_seccionais WHERE id IN (${SEC_FINALIZADA}, ${SEC_VIZINHA});
		 DELETE FROM gise_escalas WHERE id IN (${GISE_FINALIZADA}, ${GISE_VIZINHA});
		 DELETE FROM aceites_termos WHERE usuario_tipo='admin' AND usuario_id=${FIXTURE.adminGeral.id};

		 INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, supervisor_id)
		 VALUES (${GISE_FINALIZADA}, '2026-07-01', 'finalizada', '08:00', '16:00', ${FIXTURE.supervisor.id}),
		        (${GISE_VIZINHA}, '2026-07-02', 'em_preenchimento', '08:00', '16:00', ${FIXTURE.supervisor.id});

		 INSERT INTO gise_seccionais (id, gise_id, seccional_id, status)
		 VALUES (${SEC_FINALIZADA}, ${GISE_FINALIZADA}, ${FIXTURE.seccional.id}, 'preenchida'),
		        (${SEC_VIZINHA}, ${GISE_VIZINHA}, ${FIXTURE.seccional.id}, 'preenchida');

		 INSERT INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip)
		 VALUES (${EQ_FINALIZADA}, ${SEC_FINALIZADA}, 'operacional', ${SLOTS_ORIGINAIS}, ${SLOTS_ORIGINAIS}),
		        (${EQ_VIZINHA}, ${SEC_VIZINHA}, 'operacional', ${SLOTS_ORIGINAIS}, ${SLOTS_ORIGINAIS});

		 INSERT INTO gise_documentos (gise_id, r2_key, assinante_nome, assinante_cpf, verificacao_hash)
		 VALUES (${GISE_FINALIZADA}, 'test/gise-${GISE_FINALIZADA}.pdf', 'Supervisor Fixture DPC', 'x', 'HASH-${GISE_FINALIZADA}');

		 INSERT INTO aceites_termos (usuario_tipo, usuario_id, versao_termo, hash_termo, aceitou_lgpd, aceitou_uso_email, aceitou_uso_localizacao)
		 VALUES ('admin', ${FIXTURE.adminGeral.id}, '${TERMO_VERSAO}', '${termoHash}', 1, 1, 1);`
	);
}

const statusDa = (id: number) =>
	queryD1Local<{ status: string }>(`SELECT status FROM gise_escalas WHERE id=${id}`)?.[0]?.status;
const slotsDa = (id: number) =>
	queryD1Local<{ slots_dpc: number }>(`SELECT slots_dpc FROM gise_equipes WHERE id=${id}`)?.[0]
		?.slots_dpc;
const documentosDa = (id: number) =>
	queryD1Local<{ n: number }>(`SELECT COUNT(*) AS n FROM gise_documentos WHERE gise_id=${id}`)?.[0]
		?.n;

/** Contexto novo a cada chamada — o mesmo motivo de `revogacao-credencial`. */
async function postAction(url: string, token: string, campos: Record<string, string>) {
	const ctx: APIRequestContext = await contextoDeApi.newContext({ baseURL: BASE_URL });
	try {
		const res = await ctx.post(url, { headers: headersFormAction(token), multipart: campos });
		return (await res.json()) as { type?: string; status?: number; data?: string };
	} finally {
		await ctx.dispose();
	}
}

test.describe.configure({ mode: 'serial' });

test.describe('GISE finalizada é imutável', () => {
	const acoes = [
		['salvarSlotsEquipe', { equipeId: String(EQ_FINALIZADA), slots_dpc: '9', slots_oip: '9' }],
		[
			'salvarHorariosEquipe',
			{ eqId: String(EQ_FINALIZADA), hora_entrada: '07:00', hora_saida: '19:00' }
		],
		[
			'adicionarEquipe',
			{ secId: String(SEC_FINALIZADA), tipo: 'operacional', slots_dpc: '1', slots_oip: '1' }
		],
		['removerEquipe', { equipeId: String(EQ_FINALIZADA) }],
		['solicitarAssinatura', {}],
		[
			'salvarDatasHorarios',
			{ data_inicio: '2026-07-15', hora_entrada: '09:00', hora_saida: '17:00', feriado: 'false' }
		],
		[
			'adicionarMembro',
			{
				secId: String(SEC_FINALIZADA),
				equipe_id: String(EQ_FINALIZADA),
				policial_id: String(FIXTURE.policialA.id)
			}
		],
		['adicionarSeccional', { seccionalId: String(FIXTURE.seccional.id) }],
		['removerSeccional', { secId: String(SEC_FINALIZADA) }],
		[
			'salvarHorariosSec',
			{ secId: String(SEC_FINALIZADA), hora_entrada: '07:00', hora_saida: '19:00' }
		]
	] as const;

	for (const [acao, campos] of acoes) {
		test(`${acao} é recusada e não altera nada`, async () => {
			test.skip(!(await semear()), 'D1 local indisponível');
			const token = seedSession(FIXTURE.adminGeral.id, 'admin');
			test.skip(!token, 'D1 local indisponível');

			const corpo = await postAction(`/operacoes/gise/${GISE_FINALIZADA}?/${acao}`, token!, campos);

			expect(corpo.type, `resposta: ${JSON.stringify(corpo)}`).toBe('failure');
			expect(corpo.status, 'estado que não pode mudar é 409, não 400').toBe(409);

			// O documento assinado e o status são o que `salvarSlotsEquipe`
			// destruía — em silêncio, sem auditoria e deixando o PDF órfão no R2.
			expect(statusDa(GISE_FINALIZADA), 'a escala não pode sair de finalizada').toBe('finalizada');
			expect(documentosDa(GISE_FINALIZADA), 'o documento assinado tem de sobreviver').toBe(1);
			expect(slotsDa(EQ_FINALIZADA), 'as vagas não podem ter mudado').toBe(SLOTS_ORIGINAIS);
		});
	}
});

test.describe('equipe de outra GISE (FLW-GISE-007)', () => {
	test('id alheio no formulário não altera a equipe nem descarta o documento', async () => {
		test.skip(!(await semear()), 'D1 local indisponível');
		const token = seedSession(FIXTURE.adminGeral.id, 'admin');
		test.skip(!token, 'D1 local indisponível');

		// A GISE da URL está EDITÁVEL — o gate de estado deixa passar, e o que
		// sobra é exatamente o de escopo. Com a escala finalizada este caso não
		// testaria nada: o primeiro gate barraria antes.
		const corpo = await postAction(`/operacoes/gise/${GISE_VIZINHA}?/salvarSlotsEquipe`, token!, {
			equipeId: String(EQ_FINALIZADA),
			slots_dpc: '9',
			slots_oip: '9'
		});

		expect(corpo.type, `resposta: ${JSON.stringify(corpo)}`).toBe('failure');
		expect(corpo.status).toBe(404);
		expect(slotsDa(EQ_FINALIZADA), 'a equipe alheia não pode ter sido alterada').toBe(
			SLOTS_ORIGINAIS
		);
		expect(statusDa(GISE_VIZINHA), 'nem a GISE da URL pode ter sido remexida').toBe(
			'em_preenchimento'
		);
	});
});

test.afterAll(() => {
	execD1Local(
		`DELETE FROM gise_documentos WHERE gise_id IN (${GISE_FINALIZADA}, ${GISE_VIZINHA});
		 DELETE FROM gise_equipes WHERE id IN (${EQ_FINALIZADA}, ${EQ_VIZINHA});
		 DELETE FROM gise_seccionais WHERE id IN (${SEC_FINALIZADA}, ${SEC_VIZINHA});
		 DELETE FROM gise_escalas WHERE id IN (${GISE_FINALIZADA}, ${GISE_VIZINHA});`
	);
});
