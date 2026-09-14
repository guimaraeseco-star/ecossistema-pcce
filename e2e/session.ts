import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Page } from '@playwright/test';
import { execD1Local } from './d1-local';
import { FIXTURE } from './global-setup';

export { execD1Local, queryD1Local } from './d1-local';

/**
 * Sessões SEMEADAS para os testes E2E.
 *
 * O login por senha das contas fixture é bloqueado por design: o 2FA é
 * fail-closed (auth-flow devolve 403 para conta sem e-mail cadastrado) e o
 * runner não tem caixa de entrada para receber código. Em vez de furar o
 * fail-closed, inserimos a linha de sessão diretamente no D1 LOCAL — mesma
 * técnica do seed do global-setup, restrita ao banco de teste.
 *
 * Detalhes que importam:
 *  - `expires_at` PRECISA estar em ISO com `T` (`buscarSessaoValida` compara
 *    strings com `new Date().toISOString()`; o `datetime('now')` do SQLite usa
 *    espaço e NUNCA valida).
 *  - O token vai em claro; o app aceita via fallback de migração e re-grava
 *    hasheado no primeiro uso.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_URL = 'http://localhost:4173';

/**
 * SYNC_TOKEN de teste dos webhooks. O bootstrap do servidor E2E
 * (e2e/servidor-e2e.ts) grava este valor em `.dev.vars` (não-destrutivo) para
 * que o `getPlatformProxy` do adapter o exponha em `platform.env`, e o publica
 * em `e2e/.webhook-token`. A spec lê daqui; quando o arquivo não existe (D1/env
 * indisponível), pula os testes.
 */
export function tokenWebhookE2E(): string | null {
	try {
		const p = join(ROOT, 'e2e', '.webhook-token');
		return existsSync(p) ? readFileSync(p, 'utf8').trim() : null;
	} catch {
		return null;
	}
}

/**
 * Headers que o Apps Script manda em `sendToAPI` (Bearer + replay).
 * Com `WEBHOOK_REPLAY_ENFORCE=1` (e2e e produção), Bearer sozinho → 401.
 */
export function headersWebhookE2E(
	token: string,
	extra: Record<string, string> = {}
): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		'content-type': 'application/json',
		'X-Webhook-Timestamp': String(Math.floor(Date.now() / 1000)),
		'X-Webhook-Nonce': `${randomBytes(16).toString('hex')}-${Date.now()}`,
		...extra
	};
}

/**
 * Insere uma sessão de 8h para o usuário no D1 local e devolve o token.
 * `null` quando o wrangler/D1 local não está disponível (caller deve pular).
 */
export function seedSession(usuarioId: number, tipo: 'policial' | 'admin' = 'policial') {
	const token = `e2e-${randomBytes(24).toString('hex')}`;
	const sql =
		`INSERT INTO sessoes (token, tipo, usuario_id, expires_at) ` +
		`VALUES ('${token}', '${tipo}', ${usuarioId}, strftime('%Y-%m-%dT%H:%M:%S', 'now', '+8 hours') || '.000Z');`;
	return execD1Local(sql) ? token : null;
}

/**
 * Promove o Policial Fixture A a DPC + admin_unidade (FLW-AUT-001).
 *
 * O e-CPF de teste (TITULAR_TESTE) é emitido no CPF/nome do policial A — quem
 * assina por Token A3 precisa ser ele. Outros specs (escala-papel, 403 de
 * assinar-simples) dependem de A sem papel; por isso a promoção é temporária
 * e deve ser desfeita com `restaurarPolicialASemPapel` no afterAll.
 */
export function promoverPolicialAAssinante(): boolean {
	return execD1Local(
		`UPDATE policiais SET cargo='DPC', papel='admin_unidade', papel_unidade_id=${FIXTURE.unidadeA.id} ` +
			`WHERE id=${FIXTURE.policialA.id};`
	);
}

/** Devolve policial A ao estado default do fixture (OIP, sem papel). */
export function restaurarPolicialASemPapel(): boolean {
	return execD1Local(
		`UPDATE policiais SET cargo='OIP', papel=NULL, papel_unidade_id=NULL WHERE id=${FIXTURE.policialA.id};`
	);
}

/** Header `cookie` para chamadas via APIRequestContext (`request.get(...)`). */
export function cookieDeSessao(token: string): { cookie: string } {
	return { cookie: `session_token=${token}` };
}

/**
 * Headers de sessão + CSRF para POST/PUT/DELETE em /api/* via
 * APIRequestContext. O guard é double-submit puro (hooks.server compara o
 * header `x-csrf-token` com o cookie `__csrf`), então um token inventado
 * aqui é válido desde que apareça nos dois lados.
 */
export function headersDeSessaoMutacao(token: string): Record<string, string> {
	const csrf = randomBytes(32).toString('hex');
	return {
		cookie: `session_token=${token}; __csrf=${csrf}`,
		'x-csrf-token': csrf
	};
}

/**
 * Headers para POST em FORM ACTION do SvelteKit (rotas fora de `/api/*`, ex.:
 * `/escalas?/criar`). Aqui não vale o double-submit do app (que só cobre
 * `/api/*`) — vale a proteção CSRF NATIVA do kit, que compara o header
 * `origin` com a origem do servidor. `x-sveltekit-action` faz a resposta vir
 * como JSON (ActionResult) em vez de redirect.
 */
export function headersFormAction(token: string): Record<string, string> {
	return {
		...cookieDeSessao(token),
		origin: BASE_URL,
		'x-sveltekit-action': 'true'
	};
}

/**
 * Semeia um desafio 2FA de ASSINATURA com código conhecido no D1 local e
 * devolve o desafioId (hex puro — o schema Zod rejeita outros formatos).
 *
 * O app guarda `sha256(bindExtra + código)` (ver `hashCodigo2FA` em
 * src/lib/auth.ts); o fluxo de assinatura usa `bindExtra = ''`, então o hash
 * é reprodutível aqui sem depender de caixa de e-mail no runner.
 * `null` quando o wrangler/D1 local não está disponível (caller deve pular).
 */
export function seedDesafioAssinatura(usuarioId: number, codigo: string): string | null {
	const desafioId = randomBytes(20).toString('hex');
	const codigoHash = createHash('sha256').update(codigo).digest('hex');
	const sql =
		`INSERT INTO dois_fatores_tokens (desafio_id, tipo, usuario_id, codigo, expires_at) ` +
		`VALUES ('${desafioId}', 'assinatura', ${usuarioId}, '${codigoHash}', ` +
		`strftime('%Y-%m-%dT%H:%M:%S', 'now', '+10 minutes') || '.000Z');`;
	return execD1Local(sql) ? desafioId : null;
}

/**
 * Semeia a janela de reautenticação por senha (migração 0059) amarrada à
 * sessão já semeada. O POST de avançada recusa sem isto — a senha é piso,
 * não teatro. Token 64 hex; o banco guarda `sha256:` + hash, como as intenções.
 */
export function seedReauthAssinatura(
	usuarioId: number,
	sessionToken: string,
	tipo: 'policial' | 'admin' = 'policial'
): string | null {
	const token = randomBytes(32).toString('hex');
	const tokenHash = 'sha256:' + createHash('sha256').update(token).digest('hex');
	const sessaoHash = createHash('sha256').update(sessionToken).digest('hex');
	const sql =
		`INSERT INTO assinatura_reauth (token_hash, usuario_tipo, usuario_id, sessao_hash, expires_at) ` +
		`VALUES ('${tokenHash}', '${tipo}', ${usuarioId}, '${sessaoHash}', ` +
		`strftime('%Y-%m-%dT%H:%M:%S', 'now', '+10 minutes') || '.000Z');`;
	return execD1Local(sql) ? token : null;
}

/**
 * Semeia a sessão e injeta o cookie no contexto da página.
 * Devolve `false` quando o D1 local está indisponível (caller deve pular).
 */
export async function autenticarPagina(
	page: Page,
	usuarioId: number,
	tipo: 'policial' | 'admin' = 'policial'
): Promise<boolean> {
	const token = seedSession(usuarioId, tipo);
	if (!token) return false;
	await page.context().addCookies([{ name: 'session_token', value: token, url: BASE_URL }]);
	return true;
}

/**
 * A linha de quantidade/ordem/período de `/operacoes/produtividade` começa recolhida
 * atrás de "Mais filtros". Specs que mexem em `#f-ano` / `#f-qtd` / `#f-ordem`
 * precisam abrir antes.
 */
export async function expandirMaisFiltros(page: Page): Promise<void> {
	const btn = page.getByRole('button', { name: 'Mais filtros', exact: true });
	if (await btn.isVisible()) await btn.click();
}
