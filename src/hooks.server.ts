/**
 * Middleware de TODA requisição — a cadeia por onde passa qualquer rota antes
 * de chegar a um `load` ou endpoint.
 *
 * A ORDEM do `sequence()` no fim do arquivo é a parte que importa:
 *
 *   1. `handleRequestContext` — cria o `requestId` e o contexto de log. Vem
 *      primeiro para que TUDO adiante, inclusive uma falha nos hooks seguintes,
 *      seja correlacionável;
 *   2. `handleSentry` — embrulha a requisição para capturar exceção;
 *   3. `handleCsrf` — double-submit cookie nas rotas `/api/` que mudam estado.
 *      Antes da autenticação de propósito: requisição forjada é recusada sem
 *      nem custar uma consulta de sessão;
 *   4. `handleAuth` — resolve a sessão (com cache de edge à frente do D1),
 *      impõe o aceite do Termo de Uso e redireciona quem não tem acesso;
 *   5. `handleSecurity` — cabeçalhos de resposta, incluindo a CSP.
 *
 * Inverter 3 e 4 abriria caminho para gastar D1 em requisição forjada; tirar 1
 * do topo deixaria erros sem `requestId` para o usuário reportar.
 *
 * `ROTAS_PUBLICAS` é a lista fechada do que dispensa sessão — login, validação
 * pública de documento, webhooks e health. O match respeita delimitador
 * (`pathnameNoEscopo` em `onboarding-gates.ts`), senão `/termo` liberaria
 * `/termos-secretos`.
 */
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { redirect } from '@sveltejs/kit';
import { comparacaoTimingSafe } from '$lib/crypto/timing-safe';
import { captureException, setUser } from '@sentry/cloudflare';
import { validarSessaoComAceite, obterRotaBemVindo } from '$lib/auth';
import { getDB } from '$lib/db';
import {
	lerSessaoCache,
	gravarSessaoCache,
	ttlCacheSessaoParaMetodo
} from '$lib/server/auth/session-cache';
import { adminPodeAcessarRota, resolverPreferenciaModulo } from '$lib/server/auth/admin-modulos';
import { colaboradorPodeAcessarRota } from '$lib/server/auth/colaborador-rotas';
import { VERSAO as TERMO_VERSAO, calcularHashTermo } from '$lib/server/termo/termo-vigente';
import { logger } from '$lib/server/logger';
import { requestStore, getRequestCtx, type RequestCtx } from '$lib/server/request-context';
import { registrarAppLogs } from '$lib/db/app-logs';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, generateCsrfToken } from '$lib/server/auth/csrf';
import { buildCSP } from '$lib/server/csp';
import { withSentryRequest } from '$lib/server/sentry';
import { apiError, ErrorCode } from '$lib/server/api';
import { mensagemDeErro } from '$lib/utils/erro';
import {
	pathnameNoEscopo,
	pathnameLivreEmPrimeiroAcesso,
	impoeAceiteDoTermo
} from '$lib/server/auth/onboarding-gates';
import { deveRecusarPorOrigem } from '$lib/server/auth/csrf-origin';
import { renovaSessao } from '$lib/server/auth/sessao-renovacao';
import { cookieOptions } from '$lib/server/auth/auth-flow';

const ROTAS_PUBLICAS = new Set([
	'/login',
	'/api/auth/login',
	'/api/auth/verificar-2fa',
	'/api/auth/reenviar-codigo',
	'/api/auth/solicitar-redefinicao',
	'/api/auth/confirmar-redefinicao',
	'/api/auth/certificado',
	'/redefinir-senha',
	'/validar',
	'/api/validar',
	'/api/health',
	'/api/webhook',
	'/termo'
]);

function isRotaPublica(pathname: string): boolean {
	for (const rota of ROTAS_PUBLICAS) {
		if (pathnameNoEscopo(pathname, rota)) return true;
	}
	return false;
}

/** Routes exempt from CSRF token verification (no session or read-only). */
const CSRF_EXEMPT_ROUTES = new Set(['/api/auth/login', '/api/health', '/api/webhook']);
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isCsrfExempt(pathname: string): boolean {
	for (const rota of CSRF_EXEMPT_ROUTES) {
		if (pathnameNoEscopo(pathname, rota)) return true;
	}
	return false;
}

// Security headers aplicados em todas as respostas.
//
// Os três `Cross-Origin-*` formam uma proteção em camadas contra ataques de
// vazamento por canal lateral (XS-Leaks, Spectre, COOP-bypass):
//  - CORP `same-origin`: bloqueia outros sites de carregar nossos recursos
//    em <img>/<script>/<link>. Impede que um atacante use timing/error
//    feedback para inferir conteúdo autenticado.
//  - COOP `same-origin`: isola este browsing context. Janelas/popups de
//    origem cruzada não conseguem inspecionar `window` deste documento
//    (defesa contra COOP-bypass que precede ataques tipo Spectre).
//  - COEP `credentialless`: permite carregar recursos cross-origin sem
//    cookies (em vez de `require-corp`, que quebraria fontes e scripts
//    externos sem CORP próprio). Trade-off: garante isolamento sem
//    obrigar todos os fornecedores externos a setarem CORP.
const SECURITY_HEADERS: Record<string, string> = {
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self)',
	// Auditor XSS legado: removido dos navegadores modernos e, onde existiu,
	// `mode=block` abria side-channels. `0` desliga explicitamente; a CSP cobre.
	'X-XSS-Protection': '0',
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'credentialless'
};

/** 1. CSRF Layer: Double-submit cookie pattern verification */
const handleCsrf: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	let csrfToken = event.cookies.get(CSRF_COOKIE_NAME);
	if (!csrfToken) {
		csrfToken = generateCsrfToken();
		event.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
			path: '/',
			httpOnly: false, // deve ser false para o padrão double-submit (JS precisa ler o token)
			secure: event.url.protocol === 'https:',
			// `lax` em vez de `strict`: garante que o cookie viaje em navegações
			// top-level cross-site (ex.: clique em link de redefinição de senha
			// vindo de e-mail). Como este cookie é apenas o "lado JS" do padrão
			// double-submit (o servidor compara com o header `x-csrf-token`
			// enviado por XHR mesma-origem), `lax` mantém a proteção CSRF: um
			// formulário cross-site não consegue ler o cookie nem montar o header.
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 // 24 hours
		});
	}

	if (
		pathname.startsWith('/api/') &&
		STATE_CHANGING_METHODS.has(event.request.method) &&
		!isCsrfExempt(pathname)
	) {
		const headerToken = event.request.headers.get(CSRF_HEADER_NAME);
		// Mesma primitiva das credenciais (`crypto/timing-safe`): pad + timingSafeEqual
		// + conferência de comprimento, sem truncar nem colidir no byte 0x00.
		if (!headerToken || !comparacaoTimingSafe(headerToken, csrfToken)) {
			return apiError('Token CSRF inválido ou ausente', 403, ErrorCode.CSRF);
		}
	}

	// Defesa em profundidade contra forced-login / session-fixation nas rotas de
	// auth: `/api/auth/login` é isento do token CSRF (não há sessão/token ainda),
	// então um POST cross-site de uma página atacante poderia logar a vítima na
	// conta do atacante. Um POST de outra origem carrega o `Origin` dela.
	//
	// Origem DIVERGENTE sempre morre. Origem AUSENTE morre só onde o `Origin` é a
	// única camada — hoje, o login (SEC-14); webhook e health autenticam por
	// segredo e não falam com browser. A regra e o porquê estão em
	// `auth/csrf-origin.ts`, testáveis sem montar o middleware.
	if (pathname.startsWith('/api/auth/') && STATE_CHANGING_METHODS.has(event.request.method)) {
		const origin = event.request.headers.get('origin');
		if (deveRecusarPorOrigem(pathname, origin, event.url.origin)) {
			return apiError('Origem não permitida', 403, ErrorCode.CSRF);
		}
	}

	return resolve(event);
};

/** 2. Auth Layer: Session validation and user propagation */
const handleAuth: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (isRotaPublica(pathname)) {
		event.locals.usuario = null;
		return resolve(event);
	}

	const token = event.cookies.get('session_token');

	let usuario = null;
	let aceiteVigente = true;

	if (token) {
		try {
			// Cache edge (TTL configurável via SESSION_CACHE_TTL_SECONDS, default
			// 60s; 0 desliga) na frente do D1: dentro da janela, o request não paga
			// query de autenticação. Trade-offs documentados em session-cache.ts.
			// A checagem de aceite roda SEMPRE no mesmo batch (custo zero de
			// round-trip) — em rotasLivresTermo ela simplesmente não é imposta abaixo.
			//
			// **Quem MUTA não usa o cache** (FLW-AUTH-001) — a regra e o porquê estão
			// em `ttlCacheSessaoParaMetodo`.
			const cacheTtl = ttlCacheSessaoParaMetodo(event.platform, event.request.method);
			const cacheado = await lerSessaoCache(token, cacheTtl);
			if (cacheado) {
				usuario = cacheado.usuario;
				aceiteVigente = cacheado.aceiteVigente;
			} else {
				const db = getDB(event.platform);
				const hash = await calcularHashTermo();
				({ usuario, aceiteVigente } = await validarSessaoComAceite(db, token, event.platform, {
					versao: TERMO_VERSAO,
					hash
				}));
				if (usuario) {
					await gravarSessaoCache(token, { usuario, aceiteVigente }, cacheTtl);
				}
			}
		} catch (err) {
			logger.warn('[hooks] validarSessao falhou', { err: String(err) });
		}
	}

	if (!usuario) {
		if (pathname.startsWith('/api/')) {
			return apiError('Não autorizado', 401, ErrorCode.AUTH_REQUIRED);
		}
		redirect(302, '/login');
	}

	// Sliding do COOKIE — a outra metade do sliding (LGPD A14).
	//
	// `buscarSessaoValida` estende `sessoes.expires_at` no banco, mas o `maxAge`
	// do cookie só era escrito no login/2FA/troca de senha. As duas metades
	// discordavam: o banco dizia "1h a partir de agora", o navegador dizia "1h a
	// partir do login". Quem trabalhasse além do TTL era deslogado pelo cookie,
	// com a sessão viva no banco — e com TTL de 1h isso seria um logout duro no
	// meio de uma cerimônia de assinatura.
	//
	// Reemitir aqui, e não só quando o banco desliza, é de propósito: a maioria
	// das requests é servida pelo cache de edge e nem chega ao D1 (por isso o
	// `session-cache.ts` avisa que request cacheada não estende a sessão). Um
	// `Set-Cookie` não custa round-trip, então o cookie acompanha a atividade
	// REAL. A resposta autenticada já sai com `private, no-store` (abaixo), que
	// é o que impede o edge de servir este cabeçalho para outro usuário.
	//
	// "Atividade REAL" exclui o POLL de fundo: sem `renovaSessao`, a aba deixada
	// aberta renovava o próprio cookie a cada 120 s e a sessão nunca expirava —
	// o TTL de 1 h só mordia navegador fechado. A lista de rotas de poll e o
	// porquê do default ser RENOVAR estão em `auth/sessao-renovacao.ts`.
	if (token && renovaSessao(pathname)) {
		event.cookies.set('session_token', token, cookieOptions(event.url));
	}

	// Propagar userId para contexto de logs e Sentry
	const reqCtx = getRequestCtx();
	if (reqCtx) reqCtx.userId = String(usuario.id);
	setUser({ id: String(usuario.id), username: usuario.nome });

	// Fluxo de Primeiro Acesso — senha, verificação de e-mail pessoal e logout.
	// Isentar todo `/api/auth/*` liberava solicitar-codigo-assinatura e
	// alternar-acesso antes da troca de senha (FLW-AUT-019). Recusar também as
	// duas rotas de verificação de e-mail travava o onboarding (SEC-01): a
	// tela pede o OTP e a API respondia 403.
	if (usuario.primeiro_acesso && !pathnameLivreEmPrimeiroAcesso(pathname)) {
		if (pathname.startsWith('/api/')) {
			return apiError('Altere sua senha antes de continuar', 403, ErrorCode.FORBIDDEN);
		}
		redirect(302, '/alterar-senha');
	}

	// Fluxo de aceite do Termo de Uso vigente.
	// Roda APÓS primeiro_acesso resolvido (senha definida + e-mail confirmado) —
	// é `impoeAceiteDoTermo` quem impõe essa ordem, com allowlist FECHADA (não o
	// prefixo `/api/auth/` inteiro, SEC-05). A lista e o porquê de cada rota
	// estão em `onboarding-gates.ts`.
	// O aceite em si já foi verificado dentro do batch de validarSessaoComAceite;
	// aqui só decidimos o destino com base no resultado.
	if (impoeAceiteDoTermo(pathname, usuario.primeiro_acesso) && !aceiteVigente) {
		if (pathname.startsWith('/api/')) {
			return apiError('Aceite o Termo de Uso vigente antes de continuar', 403, ErrorCode.FORBIDDEN);
		}
		redirect(302, '/aceitar-termo');
	}

	// Colaborador (terceira identidade): lista FECHADA de rotas, conferida
	// antes de qualquer rota rodar — o que não está em
	// `colaboradorPodeAcessarRota` responde 403 ou volta para a área dele. Fica
	// DEPOIS dos portões de primeiro acesso e termo, que ele também atravessa.
	if (usuario.tipo === 'colaborador' && !colaboradorPodeAcessarRota(pathname, usuario)) {
		if (pathname.startsWith('/api/')) {
			return apiError('Acesso não liberado para colaborador', 403, ErrorCode.FORBIDDEN);
		}
		redirect(302, '/colaborador');
	}

	// Consoles Escalas / GISE liberados por conta (migração 0065). O cookie
	// `admin_modulo` é preferência; estas flags são a permissão. Super Admin
	// e rotas compartilhadas (policiais, auth…) passam em `adminPodeAcessarRota`.
	if (!adminPodeAcessarRota(usuario, pathname)) {
		if (pathname.startsWith('/api/')) {
			return apiError('Módulo não liberado para esta conta', 403, ErrorCode.FORBIDDEN);
		}
		const preferencia = resolverPreferenciaModulo(
			usuario.modulosAdmin ?? { escalas: true, gise: true },
			event.cookies.get('admin_modulo')
		);
		redirect(302, obterRotaBemVindo(usuario, preferencia));
	}

	// O CHAPÉU (E71): cookie, como o `admin_modulo` — preferência de navegação,
	// não permissão. Só vale na sessão admin que tem nó; qualquer outro valor
	// (ou a falta dele) é `rede`, que é o comportamento de sempre. Guardar no
	// cookie e não na linha da sessão é o que deixa duas abas em chapéus
	// diferentes sem uma derrubar a outra.
	if (usuario.tipo === 'admin' && usuario.unidade_id != null) {
		usuario.atuandoComo = event.cookies.get('atuando_como') === 'unidade' ? 'unidade' : 'rede';
	}

	event.locals.usuario = usuario;
	return resolve(event);
};

/** 3. Security Layer: Headers and CSP application */
const handleSecurity: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Apply basic security headers
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(key, value);
	}

	// CSP por tipo de conteúdo:
	//  - HTML: gerenciada pelo SvelteKit via `kit.csp` em svelte.config.js.
	//    Não setamos manualmente para não sobrescrever os nonces injetados.
	//  - Não-HTML (JSON, downloads, etc.): default-src 'none' via `buildCSP`.
	const contentType = response.headers.get('content-type') || '';
	const isHTML = contentType.includes('text/html');
	const csp = buildCSP(isHTML, { isProduction: import.meta.env.PROD });
	if (csp !== null) {
		response.headers.set('Content-Security-Policy', csp);
	}

	// HSTS
	if (event.url.protocol === 'https:') {
		response.headers.set(
			'Strict-Transport-Security',
			'max-age=31536000; includeSubDomains; preload'
		);
	}

	// Default: respostas autenticadas NUNCA podem ser cacheadas pelo edge ou por
	// proxies intermediários. Sem isto, o Cloudflare poderia servir uma resposta
	// com `set-cookie: session_token` ou dados pessoais a outro usuário.
	// Rotas que querem cache (ex.: /validar/[hash]) já setam Cache-Control e
	// continuam funcionando — só preenchemos o default quando nada foi setado.
	if (event.locals.usuario && !response.headers.has('Cache-Control')) {
		response.headers.set('Cache-Control', 'private, no-store');
	}

	return response;
};

/**
 * 0. Sentry: precisa ser o PRIMEIRO middleware para que `captureException`
 *    funcione (init é feito por `wrapRequestHandler` por request, via
 *    AsyncLocalStorage). Sem isto, todas as chamadas a `captureException` no
 *    `handleError` são no-op silenciosos.
 */
const handleSentry: Handle = async ({ event, resolve }) => {
	return withSentryRequest(event.platform, event.request, () => resolve(event));
};

/**
 * Persiste em `app_log` os warn/error acumulados no buffer da request (ver
 * request-context.ts). Roda DEPOIS da resposta, via `waitUntil` — custo zero no
 * caminho crítico — e nunca lança: perder um log técnico não pode derrubar nada.
 */
function flushAppLogs(event: Parameters<Handle>[0]['event'], ctx: RequestCtx): void {
	if (ctx.logsPendentes.length === 0) return;
	// Sem D1 (ex.: vite dev sem wrangler) os logs seguem existindo só no console.
	if (!event.platform?.env?.escalas_db) return;

	const gravar = async () => {
		try {
			await registrarAppLogs(
				getDB(event.platform),
				ctx.logsPendentes.map((l) => ({
					...l,
					request_id: ctx.requestId,
					usuario_id: ctx.userId === 'anon' ? null : ctx.userId,
					rota: ctx.path
				}))
			);
		} catch (err) {
			// console direto (não `logger`): o buffer desta request já foi drenado e
			// um erro aqui realimentaria a própria persistência que falhou.
			console.error('[app-log] falha ao persistir logs técnicos', err);
		}
	};

	const execCtx = event.platform.ctx;
	if (execCtx?.waitUntil) execCtx.waitUntil(gravar());
	else void gravar();
}

/** 0. Request Context: injeta requestId no AsyncLocalStorage para correlação de logs */
const handleRequestContext: Handle = async ({ event, resolve }) => {
	const requestId = crypto.randomUUID().slice(0, 8);
	event.locals.requestId = requestId;
	const ctx: RequestCtx = {
		requestId,
		path: event.url.pathname,
		userId: 'anon',
		logsPendentes: []
	};
	try {
		return await requestStore.run(ctx, () => resolve(event));
	} finally {
		// `finally`: redirects/erros dos handles internos viajam como exceção por
		// este `await` — o flush precisa acontecer mesmo nesses caminhos.
		flushAppLogs(event, ctx);
	}
};

/** Main Export with sequence middleware */
export const handle = sequence(
	handleRequestContext,
	handleSentry,
	handleCsrf,
	handleAuth,
	handleSecurity
);

/** Tratamento centralizado de erros inesperados */
export const handleError: HandleServerError = ({ error, event }) => {
	// Reutiliza o requestId já criado em handleRequestContext para correlacionar
	// logs emitidos antes do erro com o errorId devolvido ao usuário.
	const errorId = event.locals.requestId ?? crypto.randomUUID().slice(0, 8);

	// Stack trace fica apenas no Sentry (com sanitização do `sentryBeforeSend`).
	// Antes, `import.meta.env.DEV && error.stack` colocava o stack inteiro no
	// `logger.error` — se um deploy de produção fosse acidentalmente buildado
	// com `MODE=development`, stacks vazariam para Cloudflare Logs (e Logpush
	// downstream). Confirmamos ambas as flags (`DEV` + `!PROD` + MODE) para
	// que SÓ um build local-dev autêntico inclua stack no logger; produção
	// jamais, mesmo se uma das flags for tampered.
	const isDevBuild =
		import.meta.env.DEV && !import.meta.env.PROD && import.meta.env.MODE !== 'production';

	logger.error('Erro não tratado', {
		errorId,
		path: event.url.pathname,
		method: event.request.method,
		message: mensagemDeErro(error),
		...(isDevBuild && error instanceof Error && error.stack ? { stack: error.stack } : {})
	});

	// `path` é sanitizado por `sentryBeforeSend` (mascarando IDs numéricos).
	captureException(error, {
		tags: { errorId, path: event.url.pathname },
		extra: { method: event.request.method }
	});

	return {
		message: 'Ocorreu um erro interno. Tente novamente.',
		errorId
	};
};
