/**
 * Fluxo único de login (matrícula/senha/tipo) — formulário (+page.server) e API JSON.
 * Rate limit, auditoria, migração de hash legado e 2FA permanecem alinhados entre os canais.
 */
import { eq, and, gt, sql, count } from 'drizzle-orm';
import { sha256Hex } from '$lib/crypto/digest';
import { registrarAuditComContexto } from '$lib/db';
import {
	hashSenha,
	verificarSenha,
	isHashLegado,
	criarSessao,
	gerarCodigo2FA,
	criarDesafio2FA,
	compararSegredoUtf8TimingSafe,
	SESSION_TTL_MS
} from '$lib/auth';
import { HASH_SENTINELA } from '$lib/crypto/password-hash';
import { captureMessage } from '@sentry/cloudflare';
import { enviarCodigo2FA } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { administradores, policiais, loginAttempts } from '$lib/server/schema';
import { buscarColaboradorAtivoPorEmail, normalizarEmailColaborador } from '$lib/db/colaboradores';
import { colaboradores } from '$lib/server/schema';
import type { Database } from '$lib/db';
import { chaveRateLimitIp } from '$lib/server/auth/recovery-rate-limit';
import { mascararEmail } from '$lib/utils/pii';
import { mensagemDeErro } from '$lib/utils/erro';
import {
	modulosDaContaAdmin,
	temAlgumModulo,
	cookieModuloParaGravar,
	type AdminModuloPreferencia
} from '$lib/server/auth/admin-modulos';

export { mascararEmail };

// ---- Rate limit e utilitários (antes em login-helpers) ----

const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MINUTES = 15;
// Throttle por CONTA (account lockout) — complementa o por-IP, fechando o
// brute-force distribuído (vários IPs contra UMA matrícula). Teto mais alto que
// o por-IP (agrega vários IPs) e janela curta auto-expirável: o impacto de DoS
// (travar uma conta de propósito) fica limitado a ACCOUNT_WINDOW_MINUTES e se
// cura sozinho. Contas com 2FA por e-mail têm proteção adicional.
const ACCOUNT_MAX_ATTEMPTS = 10;
const ACCOUNT_WINDOW_MINUTES = 15;

/**
 * Fail-closed do 2º fator (auditoria A1): uma conta com a senha correta mas SEM
 * e-mail cadastrado para o 2FA NÃO recebe sessão — exceto no onboarding de
 * primeiro acesso (sessão confinada a /alterar-senha, onde o e-mail é
 * cadastrado/verificado). Antes, a ausência de e-mail pulava o 2FA
 * silenciosamente e o login caía para fator único (só senha). Quem não tem
 * e-mail pode autenticar pelo login com certificado digital (Token A3), que é
 * posse criptográfica e não depende de OTP por e-mail.
 */
const SEM_EMAIL_2FA_MSG =
	'Sua conta não possui e-mail cadastrado para o segundo fator de autenticação. ' +
	'Contate o administrador para cadastrar seu e-mail ou entre com certificado digital.';

/**
 * Opções de cookie de sessão pós-login (httpOnly, sameSite, secure).
 *
 * `maxAge` é alinhado com `SESSION_TTL_MS` (1h) e estendido a cada request:
 * cada validação de sessão que cruza o threshold sliding atualiza
 * `sessoes.expires_at` no banco, e o `handleAuth` reemite este cookie em TODA
 * request autenticada — as duas metades do sliding (LGPD A14).
 *
 * Esta frase já disse que o cookie só era renovado "pós-login, pós-2FA,
 * pós-troca de senha", e era verdade: o `maxAge` era absoluto desde o login,
 * então a sessão morria no navegador enquanto o banco a dava por viva.
 */
export function cookieOptions(url: URL) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'strict' as const,
		secure: url.protocol === 'https:',
		maxAge: Math.floor(SESSION_TTL_MS / 1000)
	};
}

/**
 * Compara a senha digitada com o segredo de bootstrap da env.
 *
 * Aceita DOIS formatos na env (`SUPER_ADMIN_SENHA` / `ADMIN_GERAL_SENHA`):
 *   - hash PBKDF2 (`pbkdf2v2:...` gerado por `hashSenha`) — RECOMENDADO: quem
 *     lê o dashboard/wrangler não vê a senha em claro;
 *   - texto claro (legado) — comparação timing-safe, mantido por compat.
 */
export async function verificarSenhaBootstrap(
	senha: string,
	envValor: string,
	pepper?: string
): Promise<boolean> {
	if (envValor.startsWith('pbkdf2v')) {
		return verificarSenha(senha, envValor, pepper);
	}
	return compararSegredoUtf8TimingSafe(senha, envValor);
}

/** Alerta de uso de credencial root: log + Sentry (não só log, fácil de perder). */
function alertarLoginBootstrap(mensagem: string, ip: string): void {
	logger.warn(mensagem, { ip });
	try {
		captureMessage(mensagem, 'warning');
	} catch {
		/* Sentry indisponível não pode quebrar o login break-glass */
	}
}

/**
 * Rate limit por IP: quantas tentativas FALHADAS restam antes do bloqueio
 * (`LOGIN_MAX_ATTEMPTS` na janela de `LOGIN_WINDOW_MINUTES`).
 *
 * Só conta falhas — login bem-sucedido não consome cota, senão trabalhar no
 * sistema levaria ao próprio bloqueio. `remaining` é devolvido para a resposta
 * poder avisar "restam N tentativas", que é o que evita o usuário legítimo
 * insistir até travar.
 *
 * Nada é gravado aqui; quem registra é `recordAttempt`, e as duas funções TÊM de
 * derivar a chave do IP do mesmo jeito (`chaveRateLimitIp`) — chaves
 * divergentes deixam o limite silenciosamente inoperante.
 */
export async function checkRateLimit(
	db: Database,
	ip: string
): Promise<{ blocked: boolean; remaining: number }> {
	// Deve usar a mesma chave que recordAttempt grava — sem isso a consulta
	// nunca encontra os registros e o rate limit fica inoperante. Com
	// RATE_LIMIT_IP_SALT, a chave é o hash salteado do IP completo (granular);
	// sem o salt, /24 anonimizado (legado).
	const ipNormalized = await chaveRateLimitIp(ip);
	/** Mesmo relógio/formato que `attempted_at` (default `datetime('now')` no SQLite). */
	const desde = sql.raw(`datetime('now', '-${LOGIN_WINDOW_MINUTES} minutes')`);
	const attempts = await db
		.select()
		.from(loginAttempts)
		.where(
			and(
				eq(loginAttempts.ip, ipNormalized),
				gt(loginAttempts.attempted_at, desde),
				eq(loginAttempts.success, 0)
			)
		)
		.all();
	const count = attempts.length;
	return {
		blocked: count >= LOGIN_MAX_ATTEMPTS,
		remaining: Math.max(0, LOGIN_MAX_ATTEMPTS - count)
	};
}

/**
 * Registra a tentativa de login (sucesso ou falha) — a linha que alimenta
 * `checkRateLimit` e o throttle por conta.
 *
 * O IP nunca é gravado em claro: vira a chave derivada de `chaveRateLimitIp`
 * aqui dentro. Já `identifier` deve chegar JÁ HASHEADO pelo chamador
 * (`hashIdentificadorLogin`) — é assim que o throttle por conta funciona sem
 * guardar matrícula em texto numa tabela que, por natureza, acumula tentativas
 * de terceiros. As linhas expiram pela retenção LGPD.
 */
export async function recordAttempt(
	db: Database,
	ip: string,
	success: boolean,
	identifier?: string
): Promise<void> {
	await db.insert(loginAttempts).values({
		ip: await chaveRateLimitIp(ip),
		success: success ? 1 : 0,
		identifier: identifier ?? null
	});
}

/**
 * Hash do identificador da conta (`tipo:matricula`, normalizado) para contar
 * tentativas por conta SEM gravar a matrícula em texto no log de tentativas.
 */
async function hashIdentificadorLogin(tipo: string, matricula: string): Promise<string> {
	return sha256Hex(`${tipo}:${matricula.trim().toLowerCase()}`);
}

/**
 * Conta tentativas FALHAS para a conta (por hash do identificador) na janela.
 * Complementa `checkRateLimit` (por IP): pega brute-force distribuído por
 * múltiplos IPs contra a mesma conta.
 */
async function checkAccountRateLimit(
	db: Database,
	identifierHash: string
): Promise<{ blocked: boolean }> {
	const desde = sql.raw(`datetime('now', '-${ACCOUNT_WINDOW_MINUTES} minutes')`);
	const [row] = await db
		.select({ n: count() })
		.from(loginAttempts)
		.where(
			and(
				eq(loginAttempts.identifier, identifierHash),
				gt(loginAttempts.attempted_at, desde),
				eq(loginAttempts.success, 0)
			)
		);
	return { blocked: (row?.n ?? 0) >= ACCOUNT_MAX_ATTEMPTS };
}

type TentarLoginArgs = {
	db: Database;
	ip: string;
	matricula: string;
	senha: string;
	/** Colaborador entra por E-MAIL (decisão 71 do plano de diárias); `matricula` carrega o e-mail. */
	tipo: 'policial' | 'admin' | 'colaborador';
	platform: App.Platform | undefined;
	/** Preferência de tela já gravada (cookie) ou `'ambas'`. Não vem da UI. */
	formAdminModulo?: AdminModuloPreferencia;
};

type Pendente2FA = {
	desafioId: string;
	nome: string;
	primeiroAcesso: boolean;
	emailMascarado: string;
	tipoUsuario2FA: 'admin' | 'policial' | 'colaborador';
};

type TentarLoginResult =
	| {
			sucesso: true;
			statusCode: 200;
			token: string;
			nome: string;
			primeiroAcesso: boolean;
			role: 'admin' | 'policial' | 'colaborador';
			formRedirect?: string;
			adminModuloCookie?: AdminModuloPreferencia;
	  }
	| {
			sucesso: false;
			statusCode: 200;
			pendente2FA: Pendente2FA;
			setAdminModuloPendingCookie: boolean;
	  }
	| { sucesso: false; statusCode: 429; erro: string }
	| {
			sucesso: false;
			statusCode: 400 | 401 | 403 | 429 | 500;
			erro: string;
			fields?: { matricula?: string; tipo?: string };
	  };

function adminDestino(modulo: AdminModuloPreferencia): string {
	if (modulo === 'gise') return '/operacoes/gise';
	if (modulo === 'escalas') return '/recebidos';
	return '/painel';
}

/**
 * Preferência de tela dentro do que a conta permite. `null` = conta sem
 * módulo nenhum (login deve recusar).
 */
function resolverModuloLogin(
	linha: { modulo_escalas?: number | boolean | null; modulo_gise?: number | boolean | null },
	preferencia: AdminModuloPreferencia | undefined,
	isSuperAdmin = false
): AdminModuloPreferencia | null {
	const permitidos = modulosDaContaAdmin(linha, isSuperAdmin);
	if (!temAlgumModulo(permitidos)) return null;
	return cookieModuloParaGravar(permitidos, preferencia);
}

/**
 * Login com senha. Não define cookies — só devolve token e metadados para os handlers.
 */
export async function tentarLogin({
	db,
	ip,
	matricula,
	senha,
	tipo,
	platform,
	formAdminModulo
}: TentarLoginArgs): Promise<TentarLoginResult> {
	// Pepper (A3): segredo global do ambiente. Quando presente, `verificarSenha`
	// consegue conferir hashes v3 e o login re-hasha v1/v2/legado → v3.
	const pepper = (platform?.env as Env | undefined)?.PASSWORD_PEPPER?.trim() || undefined;

	const rateLimit = await checkRateLimit(db, ip);
	if (rateLimit.blocked) {
		return {
			sucesso: false,
			statusCode: 429,
			erro: `Muitas tentativas de login. Tente novamente em ${LOGIN_WINDOW_MINUTES} minutos.`
		};
	}

	// Throttle por CONTA (account lockout): pega brute-force distribuído por
	// vários IPs contra a mesma matrícula — o limite por IP acima não cobre isso.
	// Mesma mensagem 429 do limite por IP (não revela se o bloqueio é de IP ou de
	// conta) e aplica-se uniformemente, inclusive a matrículas inexistentes (toda
	// falha grava o identifier), então não vira oráculo de enumeração.
	// O e-mail do colaborador entra normalizado ANTES do throttle por conta:
	// "Ana@x" e "ana@x" são a mesma conta e têm de contar no mesmo balde.
	if (tipo === 'colaborador') matricula = normalizarEmailColaborador(matricula);
	const identHash = await hashIdentificadorLogin(tipo, matricula);
	const accountLimit = await checkAccountRateLimit(db, identHash);
	if (accountLimit.blocked) {
		return {
			sucesso: false,
			statusCode: 429,
			erro: `Muitas tentativas de login. Tente novamente em ${ACCOUNT_WINDOW_MINUTES} minutos.`
		};
	}

	const adminModulo: AdminModuloPreferencia = formAdminModulo ?? 'ambas';
	const isForm = formAdminModulo !== undefined;
	const _env = platform?.env as Env | undefined;

	if (tipo === 'admin') {
		const superLogin = _env?.SUPER_ADMIN_LOGIN?.trim() ?? '';
		const superSenha = _env?.SUPER_ADMIN_SENHA ?? '';

		if (superLogin && superSenha && matricula === superLogin) {
			if (!(await verificarSenhaBootstrap(senha, superSenha, pepper))) {
				await recordAttempt(db, ip, false, identHash);
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'falha_login',
					entidade: 'admin',
					detalhes: `Tentativa falha para super admin: ${matricula}`,
					ip
				});
				return {
					sucesso: false,
					statusCode: 401,
					erro: 'Login ou senha inválidos',
					fields: { matricula, tipo }
				};
			}

			// Garantir que existe o registro do super admin no DB para ter id da sessão
			let superAdmin = await db
				.select()
				.from(administradores)
				.where(eq(administradores.login, superLogin))
				.get();

			if (!superAdmin) {
				const senhaHash = await hashSenha(crypto.randomUUID());
				await db.insert(administradores).values({
					login: superLogin,
					nome: 'Super Administrador',
					senha: senhaHash,
					primeiro_acesso: 0
				});
				superAdmin = await db
					.select()
					.from(administradores)
					.where(eq(administradores.login, superLogin))
					.get();
			}

			if (!superAdmin) {
				return {
					sucesso: false,
					statusCode: 500,
					erro: 'Erro ao inicializar super administrador.'
				};
			}

			await recordAttempt(db, ip, true, identHash);

			// O bootstrap por env tem poder de root. Por padrão loga direto (sem
			// 2FA) — break-glass que funciona mesmo com e-mail fora do ar. Se
			// SUPER_ADMIN_EMAIL estiver configurado, exigimos o 2º fator também na
			// conta root, fechando o bypass de 2FA do bootstrap.
			const superEmail = _env?.SUPER_ADMIN_EMAIL?.trim() ?? '';
			if (superEmail) {
				const codigo = gerarCodigo2FA();
				const desafioId = await criarDesafio2FA(db, 'admin', superAdmin.id, codigo);
				const emailJob = enviarCodigo2FA(superEmail, codigo, superAdmin.nome, platform).catch(
					(err) => {
						logger.error('[2FA] Falha ao enviar e-mail (super admin)', {
							error: mensagemDeErro(err)
						});
					}
				);
				platform?.ctx?.waitUntil(emailJob);
				return {
					sucesso: false,
					statusCode: 200,
					pendente2FA: {
						desafioId,
						nome: superAdmin.nome,
						primeiroAcesso: false,
						emailMascarado: mascararEmail(superEmail),
						tipoUsuario2FA: 'admin'
					},
					setAdminModuloPendingCookie: isForm
				};
			}

			alertarLoginBootstrap(
				'[security] Login do Super Admin via bootstrap env SEM 2FA (break-glass). ' +
					'Configure SUPER_ADMIN_EMAIL para exigir segundo fator nesta conta root.',
				ip
			);
			// Rastreabilidade forense (A7): registra no audit log consultável o uso
			// do break-glass root sem 2FA. try/catch — auditoria não pode derrubar o
			// login de emergência.
			try {
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'login_bootstrap',
					entidade: 'admin',
					detalhes: 'Super Admin autenticado via bootstrap env SEM 2FA (break-glass)',
					ip
				});
			} catch {
				/* auditoria indisponível não bloqueia o break-glass */
			}
			const token = await criarSessao(db, 'admin', superAdmin.id);
			const moduloResolvido = resolverModuloLogin(superAdmin, adminModulo, true) ?? 'ambas';
			return {
				sucesso: true,
				statusCode: 200,
				token,
				nome: superAdmin.nome,
				primeiroAcesso: false,
				role: 'admin',
				formRedirect: isForm ? adminDestino(moduloResolvido) : undefined,
				adminModuloCookie: isForm ? moduloResolvido : undefined
			};
		}

		const envLogin = _env?.ADMIN_GERAL_LOGIN?.trim() ?? '';
		const envSenha = _env?.ADMIN_GERAL_SENHA ?? '';

		if (envLogin && envSenha && matricula === envLogin) {
			// Bootstrap por variáveis de ambiente: credenciais do admin geral
			// vivem em `ADMIN_GERAL_LOGIN/SENHA`. Usado tanto para setup inicial
			// (sem registro no DB) quanto como login operacional enquanto o
			// admin não tiver e-mail pessoal verificado configurado.
			//
			// Janela de bloqueio: após o admin completar o fluxo de
			// `/alterar-senha` (que exige e-mail pessoal verificado), o
			// bootstrap fica desabilitado — o admin passa a logar pelo fluxo
			// normal com 2FA. Sinal de "setup concluído" = ter `email` setado.
			//
			// NOTA: uma tentativa de fechar isto mais agressivamente (bloquear
			// sempre que o registro existe) foi revertida em hotfix porque
			// quebra deploys existentes onde admin foi criado com `email=null`
			// e usa o env como login diário. Para reabrir esse fechamento,
			// migre o admin para fluxo de e-mail verificado primeiro.
			const envAdminExistente = await db
				.select()
				.from(administradores)
				.where(eq(administradores.login, envLogin))
				.get();

			if (envAdminExistente?.email) {
				// Setup concluído (admin tem e-mail) — bootstrap desnecessário.
				logger.error(
					'[security] Bootstrap bloqueado: admin já possui e-mail configurado. ' +
						'Remova ADMIN_GERAL_LOGIN e ADMIN_GERAL_SENHA das variáveis de ambiente ' +
						'e use o fluxo de redefinição de senha por e-mail.',
					{ ip }
				);
				await recordAttempt(db, ip, false, identHash);
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'falha_login',
					entidade: 'admin',
					detalhes: 'Tentativa de login via bootstrap bloqueada (setup já concluído)',
					ip
				});
				return {
					sucesso: false,
					statusCode: 401,
					erro: 'Login ou senha inválidos',
					fields: { matricula, tipo }
				};
			}

			if (!(await verificarSenhaBootstrap(senha, envSenha, pepper))) {
				await recordAttempt(db, ip, false, identHash);
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'falha_login',
					entidade: 'admin',
					detalhes: `Tentativa falha para admin geral: ${matricula}`,
					ip
				});
				return {
					sucesso: false,
					statusCode: 401,
					erro: 'Login ou senha inválidos',
					fields: { matricula, tipo }
				};
			}

			// Cria o admin inicial se ainda não existe.
			let envAdmin = envAdminExistente;
			if (!envAdmin) {
				const senhaHash = await hashSenha(crypto.randomUUID());
				await db.insert(administradores).values({
					login: envLogin,
					nome: 'Administrador Geral',
					senha: senhaHash,
					primeiro_acesso: 0
				});
				envAdmin = await db
					.select()
					.from(administradores)
					.where(eq(administradores.login, envLogin))
					.get();
			}
			if (!envAdmin) {
				return { sucesso: false, statusCode: 500, erro: 'Erro ao inicializar administrador.' };
			}

			// 2FA no bootstrap ADMIN_GERAL — espelha o SUPER_ADMIN: quando
			// ADMIN_GERAL_EMAIL está configurado, exigimos o 2º fator também aqui,
			// fechando o login direto (sem 2FA) da conta de bootstrap.
			const adminGeralEmail = _env?.ADMIN_GERAL_EMAIL?.trim() ?? '';
			if (adminGeralEmail) {
				await recordAttempt(db, ip, true, identHash);
				const codigo = gerarCodigo2FA();
				const desafioId = await criarDesafio2FA(db, 'admin', envAdmin.id, codigo);
				const emailJob = enviarCodigo2FA(adminGeralEmail, codigo, envAdmin.nome, platform).catch(
					(err) => {
						logger.error('[2FA] Falha ao enviar e-mail (admin geral)', {
							error: mensagemDeErro(err)
						});
					}
				);
				platform?.ctx?.waitUntil(emailJob);
				return {
					sucesso: false,
					statusCode: 200,
					pendente2FA: {
						desafioId,
						nome: envAdmin.nome,
						primeiroAcesso: false,
						emailMascarado: mascararEmail(adminGeralEmail),
						tipoUsuario2FA: 'admin'
					},
					setAdminModuloPendingCookie: isForm
				};
			}

			// ORDEM OBRIGATÓRIA, igual à do SUPER_ADMIN acima: o alerta sai só DEPOIS
			// da senha conferida e do desvio para 2FA. Antes ele saía logo na entrada
			// do bloco, então bastava acertar o LOGIN — nome previsível — para
			// disparar à vontade um alerta dizendo que a credencial root tinha sido
			// usada. Alerta que grita sem motivo é alerta que o operador desliga.
			alertarLoginBootstrap(
				'[security] Login via credenciais de bootstrap (ADMIN_GERAL). ' +
					'Configure e-mail pessoal verificado e remova ADMIN_GERAL_LOGIN/SENHA do ambiente ' +
					'para encerrar este caminho sem 2FA.',
				ip
			);
			await recordAttempt(db, ip, true, identHash);
			// Rastreabilidade forense (A7): registra o uso do bootstrap ADMIN_GERAL
			// (sem 2FA) no audit log consultável. try/catch — não pode quebrar o login.
			try {
				await registrarAuditComContexto(db, {
					usuario: null,
					acao: 'login_bootstrap',
					entidade: 'admin',
					detalhes: 'Admin Geral autenticado via bootstrap env (sem 2FA)',
					ip
				});
			} catch {
				/* auditoria indisponível não bloqueia o login */
			}
			const token = await criarSessao(db, 'admin', envAdmin.id);
			const moduloResolvido = resolverModuloLogin(envAdmin, adminModulo) ?? 'ambas';
			return {
				sucesso: true,
				statusCode: 200,
				token,
				nome: envAdmin.nome,
				primeiroAcesso: false,
				role: 'admin',
				formRedirect: isForm ? adminDestino(moduloResolvido) : undefined,
				adminModuloCookie: isForm ? moduloResolvido : undefined
			};
		}

		const admin = await db
			.select()
			.from(administradores)
			.where(eq(administradores.login, matricula))
			.get();

		// Admin Geral VINCULADO: a linha admin não tem senha própria — autentica
		// contra as credenciais do policial vinculado (mesma senha/e-mail/2FA).
		// Standalone (bootstrap por env): usa a própria linha.
		const credPol =
			admin?.policial_id != null
				? await db
						.select()
						.from(policiais)
						.where(and(eq(policiais.id, admin.policial_id), eq(policiais.ativo, 1)))
						.get()
				: undefined;
		const vinculado = admin?.policial_id != null;
		const credSenha = credPol ? credPol.senha : admin?.senha;
		const credEmail = credPol ? credPol.email : admin?.email;
		const credPrimeiroAcesso = credPol ? credPol.primeiro_acesso : admin?.primeiro_acesso;

		// Deriva SEMPRE, inclusive quando a conta não existe: sem o `HASH_SENTINELA`
		// o `||` curto-circuita e o login vira oráculo de enumeração — matrícula
		// inexistente responde na hora, existente paga 100 000 iterações de PBKDF2,
		// e a diferença é medível de fora.
		const senhaConfere = await verificarSenha(senha, credSenha ?? HASH_SENTINELA, pepper);

		if (!admin || (vinculado && !credPol) || !senhaConfere) {
			await recordAttempt(db, ip, false, identHash);
			return {
				sucesso: false,
				statusCode: 401,
				erro: 'Login ou senha inválidos',
				fields: { matricula, tipo }
			};
		}

		const moduloResolvido = resolverModuloLogin(admin, adminModulo);
		if (!moduloResolvido) {
			await recordAttempt(db, ip, false, identHash);
			return {
				sucesso: false,
				statusCode: 403,
				erro: 'Esta conta de administrador não tem módulos liberados. Contate quem gerencia o cadastro.',
				fields: { matricula, tipo }
			};
		}

		if (isHashLegado(credSenha ?? '', !!pepper)) {
			const novoHash = await hashSenha(senha, pepper);
			if (credPol) {
				await db.update(policiais).set({ senha: novoHash }).where(eq(policiais.id, credPol.id));
			} else {
				await db
					.update(administradores)
					.set({ senha: novoHash })
					.where(eq(administradores.id, admin.id));
			}
		}

		await recordAttempt(db, ip, true, identHash);

		if (credEmail && credPrimeiroAcesso !== 1) {
			const codigo = gerarCodigo2FA();
			const desafioId = await criarDesafio2FA(db, 'admin', admin.id, codigo);
			const emailJob = enviarCodigo2FA(credEmail, codigo, admin.nome, platform).catch((err) => {
				logger.error('[2FA] Falha ao enviar e-mail (admin)', {
					error: mensagemDeErro(err)
				});
			});
			platform?.ctx?.waitUntil(emailJob);
			return {
				sucesso: false,
				statusCode: 200,
				pendente2FA: {
					desafioId,
					nome: admin.nome,
					primeiroAcesso: credPrimeiroAcesso === 1,
					emailMascarado: mascararEmail(credEmail),
					tipoUsuario2FA: 'admin'
				},
				setAdminModuloPendingCookie: isForm
			};
		}

		// Fail-closed do 2º fator (A1): sem e-mail para enviar o código e fora do
		// onboarding, a senha sozinha não concede sessão. primeiro_acesso continua
		// permitido (sessão confinada a /alterar-senha, onde o e-mail é cadastrado).
		if (!credEmail && credPrimeiroAcesso !== 1) {
			logger.warn('[login] Bloqueado: admin sem e-mail para 2FA', { adminId: admin.id });
			return {
				sucesso: false,
				statusCode: 403,
				erro: SEM_EMAIL_2FA_MSG,
				fields: { matricula, tipo }
			};
		}

		const token = await criarSessao(db, 'admin', admin.id);
		// Login de primeiro acesso (onboarding) entra direto, sem 2FA — registra na
		// trilha como qualquer outro login (o 2FA normal é auditado nos handlers).
		await registrarAuditComContexto(db, {
			usuario: { id: admin.id, nome: admin.nome, tipo: 'admin' },
			acao: 'login',
			entidade: 'admin',
			entidade_id: admin.id,
			detalhes: 'Login (primeiro acesso, sem 2FA)',
			metadados: { via: 'primeiro_acesso' },
			ip,
			env: platform?.env
		});
		const dest = adminDestino(moduloResolvido);
		return {
			sucesso: true,
			statusCode: 200,
			token,
			nome: admin.nome,
			primeiroAcesso: credPrimeiroAcesso === 1,
			role: 'admin',
			formRedirect: isForm ? (credPrimeiroAcesso === 1 ? '/alterar-senha' : dest) : undefined,
			adminModuloCookie: isForm ? moduloResolvido : undefined
		};
	}

	if (tipo === 'colaborador') {
		return tentarLoginColaborador({ db, ip, email: matricula, senha, platform, pepper, identHash });
	}

	const policial = await db
		.select()
		.from(policiais)
		.where(and(eq(policiais.matricula, matricula), eq(policiais.ativo, 1)))
		.get();

	// Mesma derivação incondicional do ramo admin — ver `HASH_SENTINELA`.
	const senhaPolicialConfere = await verificarSenha(
		senha,
		policial?.senha ?? HASH_SENTINELA,
		pepper
	);

	if (!policial || !senhaPolicialConfere) {
		await recordAttempt(db, ip, false, identHash);
		return {
			sucesso: false,
			statusCode: 401,
			erro: 'Matrícula ou senha inválidos',
			fields: { matricula, tipo }
		};
	}

	if (isHashLegado(policial.senha, !!pepper)) {
		const novoHash = await hashSenha(senha, pepper);
		await db.update(policiais).set({ senha: novoHash }).where(eq(policiais.id, policial.id));
	}

	await recordAttempt(db, ip, true, identHash);

	if (policial.email && policial.primeiro_acesso !== 1) {
		const codigo = gerarCodigo2FA();
		const desafioId = await criarDesafio2FA(db, 'policial', policial.id, codigo);
		const emailJob = enviarCodigo2FA(policial.email, codigo, policial.nome, platform).catch(
			(err) => {
				logger.error('[2FA] Falha ao enviar e-mail (policial)', {
					error: mensagemDeErro(err)
				});
			}
		);
		platform?.ctx?.waitUntil(emailJob);
		return {
			sucesso: false,
			statusCode: 200,
			pendente2FA: {
				desafioId,
				nome: policial.nome,
				primeiroAcesso: policial.primeiro_acesso === 1,
				emailMascarado: mascararEmail(policial.email),
				tipoUsuario2FA: 'policial'
			},
			setAdminModuloPendingCookie: false
		};
	}

	// Fail-closed do 2º fator (A1): mesma regra do fluxo admin — sem e-mail e fora
	// do onboarding, não há sessão por senha. Login por Token A3 segue disponível.
	if (!policial.email && policial.primeiro_acesso !== 1) {
		logger.warn('[login] Bloqueado: policial sem e-mail para 2FA', { policialId: policial.id });
		return {
			sucesso: false,
			statusCode: 403,
			erro: SEM_EMAIL_2FA_MSG,
			fields: { matricula, tipo }
		};
	}

	const token = await criarSessao(db, 'policial', policial.id);
	// Login de primeiro acesso (onboarding) entra direto, sem 2FA — registra na trilha.
	await registrarAuditComContexto(db, {
		usuario: { id: policial.id, nome: policial.nome, tipo: 'policial' },
		acao: 'login',
		entidade: 'policial',
		entidade_id: policial.id,
		detalhes: 'Login (primeiro acesso, sem 2FA)',
		metadados: { via: 'primeiro_acesso' },
		ip,
		env: platform?.env
	});
	return {
		sucesso: true,
		statusCode: 200,
		token,
		nome: policial.nome,
		primeiroAcesso: policial.primeiro_acesso === 1,
		role: 'policial',
		formRedirect: isForm
			? policial.primeiro_acesso === 1
				? '/alterar-senha'
				: '/escalas'
			: undefined
	};
}

/**
 * Login do colaborador — a terceira identidade. Por E-MAIL, e SEMPRE com 2FA,
 * inclusive no primeiro acesso: o e-mail é obrigatório na conta por construção,
 * então não existe o caso "sem e-mail" que faz policial e admin entrarem sem
 * segundo fator no onboarding. É também o que prova, no primeiro login, que a
 * pessoa controla o e-mail que o Super Admin cadastrou — o colaborador não
 * tem "e-mail pessoal" a verificar depois.
 *
 * Mesma derivação incondicional de hash dos outros ramos (`HASH_SENTINELA`):
 * conta inexistente e senha errada custam o mesmo tempo e devolvem a mesma
 * mensagem.
 */
async function tentarLoginColaborador({
	db,
	ip,
	email,
	senha,
	platform,
	pepper,
	identHash
}: {
	db: Database;
	ip: string;
	email: string;
	senha: string;
	platform: App.Platform | undefined;
	pepper: string | undefined;
	identHash: string;
}): Promise<TentarLoginResult> {
	const conta = await buscarColaboradorAtivoPorEmail(db, email);
	const senhaConfere = await verificarSenha(senha, conta?.senha ?? HASH_SENTINELA, pepper);

	if (!conta || !senhaConfere) {
		await recordAttempt(db, ip, false, identHash);
		return {
			sucesso: false,
			statusCode: 401,
			erro: 'E-mail ou senha inválidos',
			fields: { matricula: email, tipo: 'colaborador' }
		};
	}

	if (isHashLegado(conta.senha, !!pepper)) {
		const novoHash = await hashSenha(senha, pepper);
		await db.update(colaboradores).set({ senha: novoHash }).where(eq(colaboradores.id, conta.id));
	}

	await recordAttempt(db, ip, true, identHash);

	const codigo = gerarCodigo2FA();
	const desafioId = await criarDesafio2FA(db, 'colaborador', conta.id, codigo);
	const emailJob = enviarCodigo2FA(conta.email, codigo, conta.nome, platform).catch((err) => {
		logger.error('[2FA] Falha ao enviar e-mail (colaborador)', { error: mensagemDeErro(err) });
	});
	platform?.ctx?.waitUntil(emailJob);
	return {
		sucesso: false,
		statusCode: 200,
		pendente2FA: {
			desafioId,
			nome: conta.nome,
			primeiroAcesso: conta.primeiro_acesso === 1,
			emailMascarado: mascararEmail(conta.email),
			tipoUsuario2FA: 'colaborador'
		},
		setAdminModuloPendingCookie: false
	};
}
