/**
 * POST /api/auth/confirmar-redefinicao
 *
 * Confirma o código enviado ao e-mail pessoal, cria o token de redefinição e
 * envia o link por e-mail — ao funcional do servidor; ao pessoal do colaborador
 * (E55), que não tem funcional.
 *
 * **Não marca `email_pessoal_verificado`.** Já marcou: confirmar o OTP aqui
 * promovia um endereço nunca vinculado a "verificado", e o flag passava a
 * significar "alguém leu um código" em vez de "o titular vinculou este
 * endereço" (SEC-29). Verificar o e-mail pessoal é ato próprio, com sessão, em
 * `/api/auth/solicitar-verificacao-email-pessoal` + `confirmar-…`.
 */

import { json } from '@sveltejs/kit';
import { and, count, eq, gt } from 'drizzle-orm';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { timestampSqliteBrasilia } from '$lib/db/core';
import { criarTokenRedefinicao, verificarDesafio2FA, type TipoUsuarioReset } from '$lib/auth';
import { enviarLinkRedefinicaoSenha } from '$lib/server/email';
import { administradores, colaboradores, policiais, resetSenhaTokens } from '$lib/server/schema';
import {
	contarRecoveryAttempts,
	registrarRecoveryAttempt
} from '$lib/server/auth/recovery-rate-limit';
import { badRequest, rateLimited, validateBody } from '$lib/server/api';
import { podeAutoatenderResetSenha } from '$lib/server/auth/reset-elegibilidade';
import { confirmarRedefinicaoSchema } from '$lib/schemas';
import { resolverAppOrigin } from '$lib/server/app-origin';
import type { RequestHandler } from './$types';

/**
 * Resposta única para conta inexistente, sem e-mail cadastrado ou limite de IP
 * atingido — os três casos precisam ser indistinguíveis, senão a rota vira um
 * oráculo para descobrir quais matrículas existem. Só erro do CÓDIGO (expirado,
 * inválido, tentativas esgotadas) responde de forma específica: aí o requisitante
 * já provou ter acesso ao e-mail.
 */
const RESPOSTA_GENERICA =
	'Dentro de instantes você receberá em seu e-mail funcional um link de redefinição de senha.';
const MAX_TENTATIVAS_IP = 5;
const JANELA_IP_MINUTOS = 15;
const MAX_TOKENS_USUARIO = 3;
const JANELA_USUARIO_MINUTOS = 60;

type UsuarioReset = {
	id: number;
	nome: string;
	email: string | null;
	email_pessoal: string | null;
	email_pessoal_verificado: number;
};

export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
	const v = await validateBody(request, confirmarRedefinicaoSchema);
	if (!v.ok) return v.response;
	const { desafioId, codigo } = v.data;

	const db = getDB(platform);
	const ip = getClientAddress();

	const limite = await contarRecoveryAttempts(
		db,
		ip,
		'confirmar_redefinicao',
		JANELA_IP_MINUTOS,
		MAX_TENTATIVAS_IP
	);
	if (limite.blocked) {
		return json({ message: RESPOSTA_GENERICA });
	}
	await registrarRecoveryAttempt(db, ip, 'confirmar_redefinicao');

	const resultado = await verificarDesafio2FA(db, desafioId, codigo, [
		'reset_policial',
		'reset_admin',
		'reset_colaborador'
	]);

	if (resultado === 'expirado') return badRequest('Código expirado. Solicite um novo código.');
	if (resultado === 'esgotado') {
		return rateLimited('Muitas tentativas incorretas. Solicite um novo código.');
	}
	if (!resultado) return badRequest('Código inválido');

	const tipo: TipoUsuarioReset =
		resultado.tipo === 'reset_policial'
			? 'policial'
			: resultado.tipo === 'reset_colaborador'
				? 'colaborador'
				: 'admin';
	let usuario: UsuarioReset | null = null;

	if (tipo === 'colaborador') {
		// O link vai para o e-mail PESSOAL (o único que ele tem); o código foi
		// para o de recuperação, se houver — dois canais, como no servidor.
		const c = await db
			.select({
				id: colaboradores.id,
				nome: colaboradores.nome,
				email_pessoal: colaboradores.email_pessoal,
				email_recuperacao: colaboradores.email_recuperacao
			})
			.from(colaboradores)
			.where(and(eq(colaboradores.id, resultado.usuarioId), eq(colaboradores.ativo, 1)))
			.get();
		if (c) {
			usuario = {
				id: c.id,
				nome: c.nome,
				email: c.email_pessoal,
				email_pessoal: c.email_recuperacao ?? c.email_pessoal,
				email_pessoal_verificado: 1
			};
		}
	} else if (tipo === 'policial') {
		const row = await db
			.select({
				id: policiais.id,
				nome: policiais.nome,
				email: policiais.email,
				email_pessoal: policiais.email_pessoal,
				email_pessoal_verificado: policiais.email_pessoal_verificado
			})
			.from(policiais)
			.where(and(eq(policiais.id, resultado.usuarioId), eq(policiais.ativo, 1)))
			.get();
		if (row) usuario = row;
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
			.where(eq(administradores.id, resultado.usuarioId))
			.get();
		if (row) usuario = row;
	}

	// Mesmo portão do `solicitar-redefinicao`: um desafio criado antes da regra
	// do SEC-29 ainda estaria vivo, e este é o passo que entrega o link.
	if (!podeAutoatenderResetSenha(usuario) || !usuario.email) {
		return json({ message: RESPOSTA_GENERICA });
	}

	// `created_at` guarda horário de BRASÍLIA no formato do SQLite
	// (`datetime('now','-3 hours')`). Comparar com `toISOString()` deixava o
	// contador sempre em zero — o limite existia e nunca disparava.
	const windowUsuario = timestampSqliteBrasilia(Date.now() - JANELA_USUARIO_MINUTOS * 60 * 1000);
	const [userTokenCount] = await db
		.select({ n: count() })
		.from(resetSenhaTokens)
		.where(
			and(
				eq(resetSenhaTokens.tipo_usuario, tipo),
				eq(resetSenhaTokens.usuario_id, usuario.id),
				gt(resetSenhaTokens.created_at, windowUsuario)
			)
		);

	if ((userTokenCount?.n ?? 0) >= MAX_TOKENS_USUARIO) {
		return json({ message: RESPOSTA_GENERICA });
	}

	const token = await criarTokenRedefinicao(db, tipo, usuario.id);
	const link = `${resolverAppOrigin(url, platform)}/redefinir-senha?token=${token}`;

	await enviarLinkRedefinicaoSenha(usuario.email, usuario.nome, link, platform);

	await registrarAuditComContexto(db, {
		usuario: { id: usuario.id, nome: usuario.nome },
		acao: 'solicitar_redefinicao_senha',
		entidade:
			tipo === 'policial'
				? 'policiais'
				: tipo === 'colaborador'
					? 'colaboradores'
					: 'administradores',
		entidade_id: usuario.id,
		ip
	});

	return json({ message: RESPOSTA_GENERICA });
};
