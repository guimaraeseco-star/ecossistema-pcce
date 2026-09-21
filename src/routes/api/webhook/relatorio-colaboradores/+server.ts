/**
 * POST /api/webhook/relatorio-colaboradores
 *
 * Dispara o relatório diário dos colaboradores (E61-b): para cada unidade com
 * ação de colaborador no dia, o admin da unidade recebe por e-mail o que cada
 * um fez. A lógica vive em `enviarRelatoriosDoDia`; aqui é só o gatilho
 * automatizável — GitHub Actions cron em
 * `.github/workflows/relatorio-colaboradores.yml`, às 19h de Brasília, todo
 * dia (o Cloudflare Pages não tem cron nativo).
 *
 * Corpo opcional `{ "dia": "AAAA-MM-DD" }` para reenviar um dia específico
 * (à mão, na aba Actions); sem ele, hoje em Brasília. Idempotente: o "já
 * mandei" por unidade e dia fica em `relatorios_colaboradores`.
 *
 * Autenticado por SYNC_TOKEN (Bearer) com o mesmo anti-replay dos demais
 * webhooks (`X-Webhook-Timestamp` + `X-Webhook-Nonce`).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB } from '$lib/db';
import { enviarRelatoriosDoDia } from '$lib/server/colaboradores/relatorio-diario';
import {
	validarWebhookSync,
	validarReplayProtection,
	replayEnforceLigado,
	logFaltaReplayHeaders
} from '$lib/server/auth/webhook-auth';
import { logger } from '$lib/server/logger';
import { badRequest, unauthorized } from '$lib/server/api';
import { hojeBrasilISO } from '$lib/utils/datas';

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const env = platform?.env as Env | undefined;
	const rawBody = await request.text();
	const auth = await validarWebhookSync(env?.SYNC_TOKEN, request, rawBody);
	if (!auth.ok) {
		logger.warn('[relatorio-colaboradores] auth rejeitada', {
			ip: getClientAddress(),
			reason: auth.reason
		});
		return unauthorized();
	}

	const db = getDB(platform);
	const replay = await validarReplayProtection(db, request);
	if (!replay.ok) {
		const ctx = { ip: getClientAddress(), reason: replay.reason };
		if (replay.reason === 'missing-headers' && !replayEnforceLigado(env)) {
			logFaltaReplayHeaders('relatorio-colaboradores', ctx, import.meta.env.PROD);
		} else {
			logger.warn('[relatorio-colaboradores] replay protection rejeitou', ctx);
			return unauthorized();
		}
	}

	// O dia, se veio: só a forma AAAA-MM-DD; qualquer outra coisa é 400.
	let dia = hojeBrasilISO();
	if (rawBody.trim()) {
		let corpo: unknown;
		try {
			corpo = JSON.parse(rawBody);
		} catch {
			return badRequest('Corpo inválido');
		}
		const pedido = (corpo as { dia?: unknown } | null)?.dia;
		if (pedido !== undefined) {
			if (typeof pedido !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pedido)) {
				return badRequest('dia deve ser AAAA-MM-DD');
			}
			dia = pedido;
		}
	}

	const resumo = await enviarRelatoriosDoDia(db, platform, dia);
	logger.info('[relatorio-colaboradores] concluído', { ...resumo });
	return json({ ok: true, ...resumo });
};
