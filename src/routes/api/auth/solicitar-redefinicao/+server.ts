/**
 * POST /api/auth/solicitar-redefinicao
 *
 * Rota pública. Recebe identificador (matrícula, login ou, para o colaborador,
 * o CPF — E55) e tipo de usuário, cria um desafio e envia um código ao e-mail
 * pessoal do usuário (para o colaborador, ao de recuperação, se ele informou
 * um; senão ao pessoal).
 *
 * **Anti-enumeração:** sempre retorna a mesma estrutura
 * (`{ message, requerCodigo:true, desafioId, emailMascarado }`), com valores
 * dummy quando o usuário não existe / não tem e-mail pessoal verificado /
 * está rate-limitado. Caller não consegue distinguir externamente entre
 * usuário real e usuário fake.
 *
 * **Rate-limit:** isolado em `recovery_attempts` para não contaminar
 * `login_attempts` (que rege o gate de login).
 */

import { json } from '@sveltejs/kit';
import { eq, and, gt, count } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { timestampSqliteBrasilia } from '$lib/db/core';
import { criarDesafio2FA, gerarCodigo2FA, gerarToken } from '$lib/auth';
import { enviarCodigoRedefinicaoSenha } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { administradores, policiais, doisFatoresTokens } from '$lib/server/schema';
import { buscarColaboradorAtivoPorCpf } from '$lib/db/colaboradores';
import { mascararEmail } from '$lib/server/auth/auth-flow';
import {
	contarRecoveryAttempts,
	registrarRecoveryAttempt
} from '$lib/server/auth/recovery-rate-limit';
import { podeAutoatenderResetSenha } from '$lib/server/auth/reset-elegibilidade';
import { solicitarRedefinicaoSchema } from '$lib/schemas';
import type { RequestHandler } from './$types';
import { mensagemDeErro } from '$lib/utils/erro';

const RESPOSTA_GENERICA = 'Você receberá um código de validação em instantes.';
const MAX_TENTATIVAS_IP = 5;
const JANELA_IP_MINUTOS = 15;
const MAX_CODIGOS_USUARIO = 3;
const JANELA_CODIGOS_USUARIO_MINUTOS = 10;

/**
 * Gera uma máscara de e-mail determinística a partir do identificador.
 * Usado quando o usuário não existe (ou não tem e-mail pessoal) — mesmo
 * identificador sempre retorna a mesma máscara, igual ao comportamento real.
 */
async function emailDummyMascarado(identificador: string): Promise<string> {
	const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identificador));
	const bytes = new Uint8Array(hashBuf);
	const first = String.fromCharCode(97 + (bytes[0] % 26)); // a-z
	const last = String.fromCharCode(97 + (bytes[1] % 26));
	return `${first}***${last}@***.com`;
}

function respostaDummy(identificadorMascaradoPromise: Promise<string>) {
	return identificadorMascaradoPromise.then((emailMascarado) =>
		json({
			message: RESPOSTA_GENERICA,
			requerCodigo: true,
			desafioId: gerarToken(),
			emailMascarado
		})
	);
}

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const body = await request.json().catch(() => null);
	const ip = getClientAddress();

	// Valida com Zod (caps de tamanho). Em falha, devolve a MESMA resposta dummy —
	// não revela se o erro foi identificador ausente/grande ou tipo inválido
	// (preserva a anti-enumeração).
	const parsed = solicitarRedefinicaoSchema.safeParse(body);
	if (!parsed.success) {
		const idRaw = String((body as { identificador?: unknown } | null)?.identificador ?? '').trim();
		return respostaDummy(emailDummyMascarado(idRaw || 'invalid'));
	}
	const { identificador, tipo } = parsed.data;

	try {
		const db = getDB(platform);

		// Rate limit por IP — em recovery_attempts (isolado de login_attempts).
		const limite = await contarRecoveryAttempts(
			db,
			ip,
			'solicitar_redefinicao',
			JANELA_IP_MINUTOS,
			MAX_TENTATIVAS_IP
		);
		if (limite.blocked) {
			return respostaDummy(emailDummyMascarado(identificador));
		}
		await registrarRecoveryAttempt(db, ip, 'solicitar_redefinicao');

		// Buscar usuário
		let usuario: {
			id: number;
			nome: string;
			email: string | null;
			email_pessoal: string | null;
			email_pessoal_verificado: number;
		} | null = null;

		if (tipo === 'policial') {
			const row = await db
				.select({
					id: policiais.id,
					nome: policiais.nome,
					email: policiais.email,
					email_pessoal: policiais.email_pessoal,
					email_pessoal_verificado: policiais.email_pessoal_verificado
				})
				.from(policiais)
				.where(and(eq(policiais.matricula, identificador), eq(policiais.ativo, 1)))
				.get();
			if (row) usuario = row;
		} else if (tipo === 'colaborador') {
			// O e-mail do colaborador já é o pessoal, provado pelo 2FA do login —
			// conta como verificado. O código vai para o de recuperação, se houver.
			const c = await buscarColaboradorAtivoPorCpf(db, identificador, platform?.env);
			if (c) {
				usuario = {
					id: c.id,
					nome: c.nome,
					email: c.email_pessoal,
					email_pessoal: c.email_recuperacao ?? c.email_pessoal,
					email_pessoal_verificado: 1
				};
			}
		} else {
			const row = await db
				.select({
					id: administradores.id,
					nome: administradores.nome,
					email: administradores.email,
					email_pessoal: administradores.email_pessoal,
					email_pessoal_verificado: administradores.email_pessoal_verificado
				})
				.from(administradores)
				.where(eq(administradores.login, identificador))
				.get();
			if (row) usuario = row;
		}

		// O JSDoc desta rota já prometia "não tem e-mail pessoal verificado" desde
		// sempre; o código só checava a PRESENÇA do endereço (SEC-29). Quem nunca
		// vinculou o e-mail pelo caminho autenticado não se autoatende aqui.
		if (!podeAutoatenderResetSenha(usuario)) {
			logger.info('[auth/redefinicao] usuário sem reset disponível', {
				tipo,
				ip,
				motivo: !usuario
					? 'inexistente'
					: !usuario.email_pessoal
						? 'sem_email_pessoal'
						: 'email_pessoal_nao_verificado'
			});
			return respostaDummy(emailDummyMascarado(identificador));
		}

		const tipoDesafio =
			tipo === 'policial'
				? 'reset_policial'
				: tipo === 'colaborador'
					? 'reset_colaborador'
					: 'reset_admin';

		// Rate limit por usuário (máx 3 códigos nos últimos 10 minutos)
		// `created_at` guarda horário de BRASÍLIA no formato do SQLite
		// (`datetime('now','-3 hours')`). Comparar com `toISOString()` deixava o
		// contador sempre em zero — o limite existia e nunca disparava.
		const windowUsuario = timestampSqliteBrasilia(
			Date.now() - JANELA_CODIGOS_USUARIO_MINUTOS * 60 * 1000
		);
		const [userCodeCount] = await db
			.select({ n: count() })
			.from(doisFatoresTokens)
			.where(
				and(
					eq(doisFatoresTokens.tipo, tipoDesafio),
					eq(doisFatoresTokens.usuario_id, usuario.id),
					gt(doisFatoresTokens.created_at, windowUsuario)
				)
			);

		if ((userCodeCount?.n ?? 0) >= MAX_CODIGOS_USUARIO) {
			logger.warn('[auth/redefinicao] rate limit por usuário', {
				tipo,
				usuario_id: usuario.id,
				ip
			});
			return respostaDummy(emailDummyMascarado(identificador));
		}

		const codigo = gerarCodigo2FA();
		const desafioId = await criarDesafio2FA(db, tipoDesafio, usuario.id, codigo);

		const emailJob = enviarCodigoRedefinicaoSenha(
			usuario.email_pessoal,
			codigo,
			usuario.nome,
			platform
		).catch((err) => {
			logger.error('[auth/redefinicao] falha ao enviar código', {
				tipo,
				usuario_id: usuario.id,
				error: mensagemDeErro(err)
			});
		});
		platform?.ctx?.waitUntil(emailJob);

		return json({
			message: RESPOSTA_GENERICA,
			requerCodigo: true,
			desafioId,
			emailMascarado: mascararEmail(usuario.email_pessoal)
		});
	} catch (err) {
		logger.error('[auth/redefinicao] falha inesperada', {
			error: mensagemDeErro(err)
		});
		return respostaDummy(emailDummyMascarado(identificador));
	}
};
