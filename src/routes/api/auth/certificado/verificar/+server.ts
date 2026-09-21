/**
 * Segunda metade do LOGIN POR CERTIFICADO (Token A3): recebe o CMS que o
 * assinador produziu sobre o desafio emitido em `/iniciar` e, se tudo fechar,
 * abre sessão.
 *
 * Este endpoint concede acesso sem senha e sem 2FA, então a ordem das
 * verificações é a própria segurança do fluxo — cada uma fecha um bypass:
 *
 *   1. RATE LIMIT, compartilhado com o login normal;
 *   2. DESAFIO válido, não usado e não expirado (uso único);
 *   3. ASSINATURA do CMS sobre os SignedAttributes — prova de posse da chave
 *      privada — **e** conteúdo assinado igual ao hash do nonce DESTE desafio.
 *      A identidade só é lida do certificado DEPOIS disso;
 *   4. VALIDADE temporal do certificado;
 *   5. CADEIA ICP-Brasil, obrigatória e fail-closed. É ela que garante que o CPF
 *      do subject pertence ao titular — uma AC só emite e-CPF após validar
 *      identidade. Sem esta checagem, um certificado AUTOASSINADO com o CPF da
 *      vítima passaria nos passos 3 e 4. Não existe modo permissivo: trust store
 *      indisponível responde 503 e manda usar matrícula e senha;
 *   6. REVOGAÇÃO (OCSP) — cadeia válida não cobre e-CPF revogado dentro da
 *      validade (token perdido ou roubado, M-1);
 *   7. casamento do CPF com um cadastro ATIVO, pelo índice cego `cpf_index`
 *      (o CPF é cifrado em repouso e o GCM não é determinístico, então não se
 *      pode comparar o valor cifrado). Em `policiais` — ou, no modo "Sou
 *      colaborador(a)" (`comoColaborador`, E55), em `colaboradores`.
 *
 * Toda falha registra tentativa (`recordAttempt`). Diferente do login por
 * senha, aqui a resposta final PODE dizer que o CPF não está cadastrado: para
 * chegar até esse ponto o requisitante já provou posse de um e-CPF válido
 * daquele CPF, então não há enumeração a proteger — ele só descobre sobre si.
 */
import { json } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { getDB, auditar, contextoDeEvento } from '$lib/db';
import { criarSessao, obterRotaBemVindo, consumirDesafio2FA } from '$lib/auth';
import { administradores, doisFatoresTokens, policiais } from '$lib/server/schema';
import {
	badRequest,
	unauthorized,
	forbidden,
	rateLimited,
	ErrorCode,
	apiError,
	validateBody
} from '$lib/server/api';
import { certificadoVerificarSchema } from '$lib/schemas';
import { buscarColaboradorAtivoPorCpf } from '$lib/db/colaboradores';
import { checkRateLimit, recordAttempt, cookieOptions } from '$lib/server/auth/auth-flow';
import {
	modulosDaContaAdmin,
	temAlgumModulo,
	cookieModuloParaGravar,
	preferenciaDoCookie
} from '$lib/server/auth/admin-modulos';
import {
	verificarRespostaDesafioCertificado,
	verificarRevogacaoParaLogin
} from '$lib/server/auth/cert-login';
import { verificarCadeiaIcpBrasil } from '$lib/server/assinatura/pdf-verification';
import { limparCPF } from '$lib/utils/formato';
import { cpfKeys, indiceCPF } from '$lib/crypto/cpf-cripto';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { platform, request, cookies, url, getClientAddress } = event;
	const db = getDB(platform);
	const ip = getClientAddress();

	const v = await validateBody(request, certificadoVerificarSchema);
	if (!v.ok) return v.response;
	const { desafioId, cmsBase64, comoAdmin, comoColaborador } = v.data;

	// Rate limit compartilhado com o fluxo normal de login
	const rateLimit = await checkRateLimit(db, ip);
	if (rateLimit.blocked) {
		return rateLimited('Muitas tentativas. Aguarde alguns minutos.');
	}

	// Buscar o desafio
	const desafio = await db
		.select()
		.from(doisFatoresTokens)
		.where(
			and(
				eq(doisFatoresTokens.desafio_id, desafioId),
				eq(doisFatoresTokens.tipo, 'login_certificado')
			)
		)
		.get();

	if (!desafio || desafio.usado === 1) {
		await recordAttempt(db, ip, false);
		return apiError('Desafio inválido ou já utilizado.', 401, ErrorCode.AUTH_REQUIRED);
	}
	if (new Date() > new Date(desafio.expires_at)) {
		await recordAttempt(db, ip, false);
		return apiError('Desafio expirado. Tente novamente.', 401, ErrorCode.AUTH_REQUIRED);
	}

	// Verificação criptográfica do desafio — fecha o bypass crítico. Confirma
	// (1) que o certificado e o algoritmo estão dentro da política criptográfica
	// mínima, (2) que o CMS tem assinatura válida sobre os SignedAttributes
	// (prova de posse da chave privada do Token A3) e (3) que o conteúdo assinado
	// é o hash do nonce DESTE desafio. `desafio.codigo` guarda exatamente o
	// messageDigest esperado (ver /iniciar). A identidade só é lida DEPOIS.
	const verif = await verificarRespostaDesafioCertificado(cmsBase64, desafio.codigo);
	if (!verif.ok) {
		await recordAttempt(db, ip, false);
		logger.warn('[cert-login] Verificação do desafio falhou', {
			motivo: verif.motivo,
			detalhe: verif.detalhe
		});
		// A recusa por POLÍTICA merece mensagem própria. O caso real que ela pega
		// não é ataque: é o titular escolhendo, no Assinador, o e-CPF de SIGILO
		// (par "S") em vez do de ASSINATURA (par "A") — certificado legítimo, sem
		// `keyUsage` de assinatura. "Não foi possível validar a assinatura" manda
		// essa pessoa tentar de novo exatamente do mesmo jeito.
		if (verif.motivo === 'politica_cripto') {
			return apiError(
				'O certificado apresentado não atende aos requisitos mínimos de assinatura ' +
					'(deve ser um e-CPF de assinatura, com chave RSA de 2048 bits ou mais e SHA-256). ' +
					'Se o seu token tem mais de um certificado, selecione o de ASSINATURA.',
				422,
				ErrorCode.VALIDATION
			);
		}
		return apiError(
			'Não foi possível validar a assinatura do certificado. Refaça o login com o seu certificado digital.',
			401,
			ErrorCode.AUTH_REQUIRED
		);
	}

	const cpfLimpo = limparCPF(verif.cpf);
	if (cpfLimpo.length !== 11) {
		await recordAttempt(db, ip, false);
		return badRequest('CPF não encontrado no certificado ou formato inválido.');
	}

	// Validade temporal do certificado (datas) — mensagem clara antes da cadeia.
	const agora = new Date();
	if (agora < verif.certificado.validity.notBefore || agora > verif.certificado.validity.notAfter) {
		await recordAttempt(db, ip, false);
		return badRequest('Certificado digital expirado ou ainda não válido.');
	}

	// Cadeia ICP-Brasil — OBRIGATÓRIA (fail-closed). É o que garante que o CPF
	// do subject pertence ao titular: uma AC ICP-Brasil só emite e-CPF após
	// validar a identidade. Sem isto, um certificado autoassinado com o CPF da
	// vítima (assinado com a chave do atacante) passaria pelos checks de
	// assinatura e nonce. Por isso aqui NÃO há mais "modo permissivo".
	//
	// Valida o MESMO certificado cuja assinatura foi conferida — o que o `sid` do
	// SignerInfo resolveu. Até ago/2026 esta checagem re-parseava o CMS por conta
	// própria e passava `p7.certificates` inteiro ao forge: a ordem de um
	// `SET OF` não é ordem de cadeia (para o forge, `chain[0]` é o PAI do
	// anterior), então um CMS legítimo com a folha fora da primeira posição
	// reprovava aqui. Era a terceira cópia da validação de cadeia; agora entra
	// pelo `verificarCadeiaIcpBrasil`, o mesmo helper do `/validar`.
	const cadeia = verificarCadeiaIcpBrasil(verif.certificado);
	if (cadeia === 'indisponivel') {
		await recordAttempt(db, ip, false);
		logger.error(
			'[cert-login] Trust store ICP-Brasil indisponível — login por certificado bloqueado'
		);
		return apiError(
			'Login por certificado indisponível no momento. Use matrícula e senha.',
			503,
			ErrorCode.UPSTREAM
		);
	}
	if (!cadeia) {
		await recordAttempt(db, ip, false);
		logger.warn('[cert-login] Cadeia ICP-Brasil inválida', {
			cpf: cpfLimpo.slice(0, 3) + '***'
		});
		return apiError(
			'Certificado não pertence a uma cadeia ICP-Brasil válida.',
			422,
			ErrorCode.VALIDATION
		);
	}

	// Revogação (OCSP) — M-1 da auditoria de segurança 2026-07-10: cadeia válida
	// não cobre e-CPF REVOGADO (token perdido/roubado reportado à AC) dentro da
	// validade. Política em `verificarRevogacaoParaLogin`: nega 'revoked' e
	// resposta não confiável; indisponibilidade do responder degrada para
	// 'unknown' e NÃO bloqueia (soft-fail auditado abaixo, em `metadados.ocsp`).
	const revogacao = await verificarRevogacaoParaLogin(verif.certificado);
	if (!revogacao.permitido) {
		await recordAttempt(db, ip, false);
		logger.warn('[cert-login] Certificado bloqueado pela checagem de revogação', {
			cpf: cpfLimpo.slice(0, 3) + '***',
			motivo: revogacao.motivo,
			revokedAt: revogacao.motivo === 'revogado' ? revogacao.revokedAt : undefined
		});
		return apiError(
			revogacao.motivo === 'revogado'
				? 'Certificado digital revogado junto à Autoridade Certificadora. Use matrícula e senha ou contate o administrador.'
				: 'Não foi possível confirmar o status de revogação do certificado (resposta OCSP não confiável). Tente novamente.',
			422,
			ErrorCode.VALIDATION
		);
	}
	if (revogacao.ocsp === 'unknown') {
		logger.warn('[cert-login] OCSP indisponível — login segue sem confirmação de revogação', {
			cpf: cpfLimpo.slice(0, 3) + '***',
			aviso: revogacao.aviso
		});
	}

	// COLABORADOR (E55): o mesmo e-CPF, casado com `colaboradores`. Não passa
	// pelo 2FA — o certificado é o fator forte, como para o policial. O
	// primeiro acesso segue para `/alterar-senha`, onde ele define a senha
	// (para entrar sem o token) e, se quiser, o e-mail de recuperação.
	if (comoColaborador) {
		const conta = await buscarColaboradorAtivoPorCpf(db, cpfLimpo, platform?.env);
		if (!conta) {
			await recordAttempt(db, ip, false);
			logger.info('[cert-login] CPF sem colaborador ativo', {
				cpf: cpfLimpo.slice(0, 3) + '***'
			});
			return unauthorized('CPF não cadastrado como colaborador(a) ou conta desativada.');
		}
		if (!(await consumirDesafio2FA(db, desafio.id))) {
			await recordAttempt(db, ip, false);
			return apiError('Desafio inválido ou já utilizado.', 401, ErrorCode.AUTH_REQUIRED);
		}
		await recordAttempt(db, ip, true);

		const token = await criarSessao(db, 'colaborador', conta.id);
		cookies.set('session_token', token, cookieOptions(url));

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'login_certificado',
				usuario: { id: conta.id, nome: conta.nome, tipo: 'colaborador' },
				entidade: 'colaborador',
				entidade_id: conta.id,
				alvo_tipo: 'colaborador',
				alvo_id: conta.id,
				alvo_nome: conta.nome,
				detalhes: 'Login por certificado digital (ICP-Brasil) — colaborador(a)',
				metadados: { via: 'certificado_a3', comoColaborador: true, ocsp: revogacao.ocsp },
				...contexto
			},
			{ env }
		);

		const primeiroAcesso = conta.primeiro_acesso === 1;
		return json({
			success: true,
			primeiro_acesso: primeiroAcesso,
			nome: conta.nome,
			redirect: primeiroAcesso ? '/alterar-senha' : '/colaborador'
		});
	}

	// Buscar policial pelo CPF. Como o `cpf` é cifrado em repouso (LGPD, GCM
	// não-determinístico), a busca usa o índice cego `cpf_index` quando a chave
	// está configurada; sem chave (fail-open), cai no `cpf` em texto.
	const { indexKey } = cpfKeys(platform?.env);
	const cpfFilter = indexKey
		? eq(policiais.cpf_index, await indiceCPF(cpfLimpo, indexKey))
		: eq(policiais.cpf, cpfLimpo);
	const policial = await db
		.select()
		.from(policiais)
		.where(and(cpfFilter, eq(policiais.ativo, 1)))
		.get();

	if (!policial) {
		await recordAttempt(db, ip, false);
		logger.info('[cert-login] CPF não encontrado ou policial inativo', {
			cpf: cpfLimpo.slice(0, 3) + '***'
		});
		return unauthorized('CPF não encontrado no sistema ou policial inativo.');
	}

	// Entrar no console de Admin Geral (aba "Administrador"): só se o CPF do
	// certificado tiver uma conta admin VINCULADA (`administradores.policial_id`)
	// — o mesmo vínculo que o login por senha usa. O certificado A3 substitui
	// senha + 2FA (é um fator mais forte: posse do token + PIN + cadeia ICP).
	if (comoAdmin) {
		const admin = await db
			.select()
			.from(administradores)
			.where(eq(administradores.policial_id, policial.id))
			.get();

		if (!admin) {
			await recordAttempt(db, ip, false);
			logger.info('[cert-login] Certificado sem conta de admin vinculada', {
				cpf: cpfLimpo.slice(0, 3) + '***'
			});
			return forbidden(
				'Este certificado não está vinculado a uma conta de Administrador Geral. Entre pela aba Policial ou use login e senha.'
			);
		}

		const permitidos = modulosDaContaAdmin(admin);
		if (!temAlgumModulo(permitidos)) {
			await recordAttempt(db, ip, false);
			return forbidden(
				'Esta conta de administrador não tem módulos liberados. Contate quem gerencia o cadastro.'
			);
		}
		const modulo = cookieModuloParaGravar(
			permitidos,
			preferenciaDoCookie(cookies.get('admin_modulo'))
		);

		// Consumo de uso único: se outra requisição gastou o desafio primeiro,
		// esta NÃO cria sessão. A checagem de `usado` lá em cima é diagnóstico;
		// a autorização é este UPDATE condicional.
		if (!(await consumirDesafio2FA(db, desafio.id))) {
			await recordAttempt(db, ip, false);
			return apiError('Desafio inválido ou já utilizado.', 401, ErrorCode.AUTH_REQUIRED);
		}
		await recordAttempt(db, ip, true);

		const token = await criarSessao(db, 'admin', admin.id);
		cookies.set('session_token', token, cookieOptions(url));
		cookies.set('admin_modulo', modulo, cookieOptions(url));

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'login_certificado',
				usuario: { id: admin.id, nome: admin.nome, tipo: 'admin' },
				entidade: 'admin',
				entidade_id: admin.id,
				alvo_tipo: 'admin',
				alvo_id: admin.id,
				alvo_nome: admin.nome,
				detalhes: 'Login por certificado digital (ICP-Brasil) — console de administração',
				metadados: { via: 'certificado_a3', comoAdmin: true, ocsp: revogacao.ocsp },
				...contexto
			},
			{ env }
		);

		const primeiroAcesso = policial.primeiro_acesso === 1;
		const rota = obterRotaBemVindo(
			{ id: admin.id, tipo: 'admin', nome: admin.nome, primeiro_acesso: primeiroAcesso },
			modulo
		);
		return json({
			success: true,
			primeiro_acesso: primeiroAcesso,
			nome: admin.nome,
			redirect: primeiroAcesso ? '/alterar-senha' : rota
		});
	}

	// Mesmo consumo de uso único do ramo de admin, acima.
	if (!(await consumirDesafio2FA(db, desafio.id))) {
		await recordAttempt(db, ip, false);
		return apiError('Desafio inválido ou já utilizado.', 401, ErrorCode.AUTH_REQUIRED);
	}

	await recordAttempt(db, ip, true);

	const token = await criarSessao(db, 'policial', policial.id);
	cookies.set('session_token', token, cookieOptions(url));

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'login_certificado',
			usuario: { id: policial.id, nome: policial.nome, tipo: 'policial' },
			entidade: 'policial',
			entidade_id: policial.id,
			alvo_tipo: 'policial',
			alvo_id: policial.id,
			alvo_nome: policial.nome,
			detalhes: 'Login por certificado digital (ICP-Brasil)',
			// `ocsp: 'unknown'` sinaliza login SEM confirmação de revogação
			// (responder indisponível) — rastreável na trilha para forense.
			metadados: { via: 'certificado_a3', ocsp: revogacao.ocsp },
			...contexto
		},
		{ env }
	);

	return json({
		success: true,
		primeiro_acesso: policial.primeiro_acesso === 1,
		nome: policial.nome
	});
};
