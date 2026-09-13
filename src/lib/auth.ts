/**
 * Sessões, 2FA e redefinição de senha — quem o usuário é e por quanto tempo.
 * As três coisas moram juntas porque compartilham o mesmo token opaco
 * (`gerarToken`) e a mesma regra de armazenamento.
 *
 * TOKEN NUNCA VAI EM CLARO PARA O BANCO. `criarSessao` devolve o valor em claro
 * uma única vez, para ir direto ao cookie; a linha guarda só o `sha256:`. Por
 * isso não existe "listar minhas sessões e mostrar o token", e por isso um dump
 * do D1 não dá acesso a ninguém. Há um fallback para linhas anteriores à
 * migração (token em claro), que migra a linha ao ser usada.
 *
 * A sessão é SLIDING: 1h que se renova com o uso, mas o UPDATE só sai quando já
 * se passaram mais de 30min (`SESSION_SLIDING_THRESHOLD_MS`) desde a última
 * renovação — senão todo request autenticado escreveria no D1.
 *
 * Papel administrativo tem DOIS eixos independentes, e confundi-los é o erro
 * clássico aqui:
 *   - `tipo` ('admin' | 'policial') é a SESSÃO. `isAdminGeral` só olha isto.
 *   - `papel` ('admin_seccional' | 'admin_unidade') é RBAC operacional, vive na
 *     linha do policial e é CUMULATIVO com Admin Geral.
 * Um Admin Geral vinculado tem linha em `administradores` e em `policiais`, e
 * loga escolhendo qual identidade quer. Nada disso concede `isSuperAdmin`.
 *
 * `validarSessaoComAceite` é a que o `hooks.server.ts` usa: agrupa usuário +
 * aceite do Termo (+ sliding) num `db.batch` para não fazer 3 idas ao D1 em
 * série a cada request. `validarSessao` é a versão simples, para quem já está
 * fora do hook.
 *
 * Mora em `lib/` e não em `lib/server/` por um motivo só: componentes importam
 * o TIPO `UsuarioLogado` (import type, apagado no build). Qualquer import de
 * VALOR daqui no cliente arrasta `node:crypto` e o schema para o bundle.
 */
import { eq, and, gt, inArray, desc, sql } from 'drizzle-orm';
import {
	sessoes,
	administradores,
	policiais,
	colaboradores,
	doisFatoresTokens,
	resetSenhaTokens,
	aceitesTermos
} from './server/schema';
import type { Database } from './db';
import { aceiteEhVigente } from './db/termos';
import { sha256Hex, hashTokenArmazenado, PREFIXO_TOKEN_HASH } from './crypto/digest';
import { comparacaoTimingSafe } from './crypto/timing-safe';
import { gerarTokenOpaco } from './crypto/token';
import { decifrarCpfDoDB } from './crypto/cpf-cripto';

// Hashing de senha (PBKDF2 + pepper) vive em ./crypto/password-hash — módulo
// PURO compartilhado com os scripts/e2e (item C6 da auditoria). Re-exportado
// aqui para manter a API pública `$lib/auth` estável.
export {
	hashSenha,
	verificarSenha,
	isHashLegado,
	gerarSenhaAleatoriaHash
} from './crypto/password-hash';

export interface UsuarioLogado {
	id: number;
	/**
	 * `colaborador` é a terceira identidade (migração 0082): servidora ou
	 * terceirizada. Não é admin nem policial — toda verificação que pergunta por
	 * um dos dois responde "não" para ela, e é assim que ela falha fechado. O
	 * que alcança está em `colaboradorPodeAcessarRota` e nas designações.
	 */
	tipo: 'policial' | 'admin' | 'colaborador';
	nome: string;
	matricula?: string;
	lotacao?: string;
	primeiro_acesso: boolean;
	isSuperAdmin?: boolean;
	/**
	 * Sessão de admin VINCULADO a um policial (Admin Geral vinculado): id do
	 * policial cuja credencial autentica esta conta admin. Operações de
	 * credencial (troca de senha) miram este policial. Nulo/ausente = admin
	 * standalone (bootstrap por env).
	 */
	adminPolicialId?: number | null;
	/**
	 * Consoles liberados nesta conta admin (`administradores.modulo_*`).
	 * Ausente em sessão policial. Super Admin vem com os dois ligados.
	 */
	modulosAdmin?: { escalas: boolean; gise: boolean };
	// RBAC operacional (papel scoped do servidor; cumulativo com Admin Geral)
	papel?: 'admin_seccional' | 'admin_unidade' | null;
	papel_unidade_id?: number | null;
	cargo?: 'DPC' | 'OIP';
	cpf?: string | null;
	email?: string | null;
	/** Colaborador: empresa ou contrato a que a conta pertence. */
	vinculo?: string;
}

export type TipoDesafio2FA =
	| 'policial'
	| 'admin'
	| 'colaborador'
	| 'assinatura'
	| 'reset_policial'
	| 'reset_admin'
	// Verificação de e-mail pessoal (I-2 da auditoria): canal próprio, separado
	// de `assinatura`. Antes os dois compartilhavam o mesmo tipo, abrindo
	// confused-deputy se um caminho futuro aceitasse um sem o outro.
	| 'verificacao_email'
	// Desafio gerado para autenticação via Token A3 ICP-Brasil.
	// usuario_id = 0 até o CPF ser resolvido; codigo = hash do nonce.
	| 'login_certificado';

/**
 * Retorna true se o usuário possui poder de Admin Geral — i.e., está numa
 * SESSÃO de admin (`tipo === 'admin'`). Pode ser o admin de bootstrap (env) ou
 * um policial promovido a Admin Geral via linha vinculada em `administradores`
 * (que loga escolhendo "Administrador"). NÃO concede os poderes EXCLUSIVOS do
 * Super Admin (`isSuperAdmin`).
 */
export function isAdminGeral(u: UsuarioLogado | null): boolean {
	return u?.tipo === 'admin';
}

/**
 * Policial ou admin — as duas identidades com CADASTRO na corporação, que
 * assinam documentos, têm passkey, e-mail pessoal e credencial vinculável. O
 * colaborador fica de fora de tudo isso por construção.
 */
export type UsuarioComCadastro = UsuarioLogado & { tipo: 'policial' | 'admin' };

/** Narrowing para os caminhos de assinatura e credencial — colaborador não entra. */
export function temCadastro(u: UsuarioLogado): u is UsuarioComCadastro {
	return u.tipo === 'policial' || u.tipo === 'admin';
}

/** Retorna true se o usuário é Admin Seccional */
export function isAdminSeccional(u: UsuarioLogado | null): boolean {
	return u?.tipo === 'policial' && u.papel === 'admin_seccional';
}

/** Retorna true se o usuário é Admin de Unidade */
export function isAdminUnidade(u: UsuarioLogado | null): boolean {
	return u?.tipo === 'policial' && u.papel === 'admin_unidade';
}

/** Retorna true se o usuário possui qualquer papel administrativo */
export function isAnyAdmin(u: UsuarioLogado | null): boolean {
	return isAdminGeral(u) || isAdminSeccional(u) || isAdminUnidade(u);
}

/**
 * Token opaco de 32 bytes (64 hex chars) para sessão e para link de redefinição.
 *
 * CSPRNG, não `Math.random`: o token É a credencial — quem o adivinha entra sem
 * senha e sem 2FA. 256 bits de entropia tornam a busca inviável, e o formato
 * hex fixo é o que permite a `hashTokenArmazenado` distinguir hash de token
 * legado em claro.
 */
export const gerarToken = gerarTokenOpaco;

// ---- Hash de tokens persistidos (sessão / redefinição) ----
//
// Tokens de sessão e de reset são armazenados como `sha256:<hex>` — o valor
// em claro só vive no cookie/link do usuário. Um dump/backup do D1 (ou acesso
// de operador) não permite sequestrar sessões ativas nem resets pendentes.
// O prefixo distingue hash de token legado em claro (ambos têm 64 hex chars);
// linhas legadas são aceitas em fallback e migradas para hash no primeiro uso.

/**
 * Compara dois segredos em texto (ex.: `ADMIN_GERAL_SENHA`) de forma timing-safe.
 * Nome mantido por ser a API que sete módulos já importam daqui; a implementação
 * é a única do projeto, em `$lib/crypto/timing-safe`.
 */
export const compararSegredoUtf8TimingSafe = comparacaoTimingSafe;

/**
 * Tempo de vida da sessão: **1h de INATIVIDADE**, não 1h de sessão. Toda
 * atividade reseta o relógio, nos dois lados — a linha do banco (aqui) e o
 * `maxAge` do cookie (reemitido pelo `handleAuth` a cada request autenticada).
 *
 * O plano de remediação LGPD (achado A14, art. 46) pediu 1h e o código ficou em
 * 8h sem que a divergência fosse registrada. Baixar para 1h exigiu antes
 * consertar o sliding, que era **meio sliding**: o banco deslizava, o cookie
 * não. O `maxAge` era fixado no login e nunca renovado em atividade comum, então
 * quem trabalhasse 8h seguidas era deslogado às 8h do LOGIN, com o banco achando
 * que a sessão valia por mais 8h. Com 1h, esse mesmo defeito viraria um logout
 * duro no meio da cerimônia de assinatura.
 */
export const SESSION_TTL_MS = 1 * 60 * 60 * 1000;
/**
 * Threshold para evitar UPDATE em todo request: só estende `expires_at`
 * quando já se passaram mais de `SESSION_SLIDING_THRESHOLD_MS` desde a última
 * renovação (equivalente a faltar menos que `SESSION_TTL_MS - threshold`,
 * 45 min, para o vencimento). Mantém o throughput sem perder a propriedade
 * sliding.
 *
 * Precisa ser uma FRAÇÃO do TTL, não um valor solto: era 30 min quando o TTL
 * era de 8h, e mantê-lo em 30 min com TTL de 1h deixaria a sessão a meia hora
 * do vencimento antes da primeira renovação — sem margem para o atraso do cache
 * de edge (até 60 s) nem para a aba que fica parada.
 */
const SESSION_SLIDING_THRESHOLD_MS = 15 * 60 * 1000; // 15 min

/**
 * Abre sessão e devolve o token EM CLARO — a única vez que ele existe fora do
 * cookie do usuário. O banco recebe apenas o `sha256:` (ver bloco acima), então
 * este valor de retorno precisa ir direto para o cookie e não ser registrado em
 * log nem em auditoria.
 *
 * Não valida credencial nenhuma: quem chama já autenticou. Chamar isto é, por
 * definição, conceder acesso.
 */
export async function criarSessao(
	db: Database,
	tipo: UsuarioLogado['tipo'],
	usuarioId: number
): Promise<string> {
	const token = gerarToken();
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
	await db.insert(sessoes).values({
		token: await hashTokenArmazenado(token),
		tipo,
		usuario_id: usuarioId,
		expires_at: expiresAt
	});
	return token;
}

/**
 * Busca a linha de sessão válida para o token (cobrindo o fallback legado de
 * token em claro) e devolve também o UPDATE de sliding-expiration JÁ MONTADO
 * (mas não executado) quando aplicável — o chamador decide se o executa
 * isolado (`validarSessao`) ou dentro de um `db.batch` (`validarSessaoComAceite`).
 */
async function buscarSessaoValida(db: Database, token: string | undefined) {
	if (!token) return null;

	const now = Date.now();
	const nowISO = new Date(now).toISOString();
	const tokenHash = await hashTokenArmazenado(token);
	let sessao = await db
		.select()
		.from(sessoes)
		.where(and(eq(sessoes.token, tokenHash), gt(sessoes.expires_at, nowISO)))
		.get();

	if (!sessao) {
		// Fallback: sessão criada antes da migração para token hasheado (em
		// claro no banco). Aceita e migra a linha para o formato hasheado.
		sessao = await db
			.select()
			.from(sessoes)
			.where(and(eq(sessoes.token, token), gt(sessoes.expires_at, nowISO)))
			.get();
		if (sessao) {
			await db.update(sessoes).set({ token: tokenHash }).where(eq(sessoes.id, sessao.id));
		}
	}

	if (!sessao) return null;

	// Sliding: se já passou o threshold desde a última renovação, estende para
	// now + SESSION_TTL_MS. Cap por threshold evita UPDATE em todo request.
	const expiresAtMs = new Date(sessao.expires_at).getTime();
	const slidingUpdate =
		expiresAtMs - now < SESSION_TTL_MS - SESSION_SLIDING_THRESHOLD_MS
			? db
					.update(sessoes)
					.set({ expires_at: new Date(now + SESSION_TTL_MS).toISOString() })
					.where(eq(sessoes.id, sessao.id))
			: null;

	return { sessao, slidingUpdate };
}

function mapearAdmin(
	admin: typeof administradores.$inferSelect,
	platform?: App.Platform
): UsuarioLogado {
	const _env = platform?.env as Env | undefined;
	const superAdminLogin = _env?.SUPER_ADMIN_LOGIN?.trim();
	const isSuperAdmin = !!superAdminLogin && admin.login === superAdminLogin;

	return {
		id: admin.id,
		tipo: 'admin' as const,
		nome: admin.nome,
		primeiro_acesso: admin.primeiro_acesso === 1,
		isSuperAdmin,
		adminPolicialId: admin.policial_id ?? null,
		// Super Admin: console próprio, flags sempre ligadas para não barrar
		// rotas compartilhadas se ele cair nelas. Demais: colunas da linha.
		modulosAdmin: isSuperAdmin
			? { escalas: true, gise: true }
			: {
					escalas: Number(admin.modulo_escalas ?? 1) === 1,
					gise: Number(admin.modulo_gise ?? 1) === 1
				}
	};
}

async function mapearPolicial(
	policial: typeof policiais.$inferSelect,
	platform?: App.Platform
): Promise<UsuarioLogado> {
	// CPF é cifrado em repouso (LGPD). Decifra aqui, no ponto único de montagem
	// da sessão, para que todo o restante (assinatura, exibição) receba o CPF em
	// claro em memória. Sem chave configurada, devolve o valor como está.
	const cpf = await decifrarCpfDoDB(policial.cpf, platform?.env as Env | undefined);
	return {
		id: policial.id,
		tipo: 'policial' as const,
		nome: policial.nome,
		matricula: policial.matricula,
		lotacao: policial.lotacao,
		primeiro_acesso: policial.primeiro_acesso === 1,
		papel: policial.papel ?? null,
		papel_unidade_id: policial.papel_unidade_id ?? null,
		cargo: policial.cargo as 'DPC' | 'OIP',
		cpf: cpf || null,
		email: policial.email ?? null
	};
}

/**
 * Sessão de colaborador. Sem CPF na sessão de propósito: nenhuma tela do
 * colaborador precisa dele, e a tela do Protocolo não exibe CPF (plano, 4.3).
 */
function mapearColaborador(c: typeof colaboradores.$inferSelect): UsuarioLogado {
	return {
		id: c.id,
		tipo: 'colaborador' as const,
		nome: c.nome,
		primeiro_acesso: c.primeiro_acesso === 1,
		email: c.email,
		vinculo: c.vinculo
	};
}

/** A linha do colaborador que ainda autentica: `ativo = 1`, como o policial. */
function queryColaboradorDaSessao(db: Database, id: number) {
	return db
		.select()
		.from(colaboradores)
		.where(and(eq(colaboradores.id, id), eq(colaboradores.ativo, 1)))
		.limit(1);
}

/**
 * Consulta a linha admin de uma sessão JUNTO com o `ativo` do policial
 * vinculado — as duas informações de que a validação precisa, numa query só
 * (a versão em batch não pode pagar um round-trip a mais).
 */
function queryAdminDaSessao(db: Database, adminId: number) {
	return db
		.select({
			admin: administradores,
			policial_ativo: policiais.ativo,
			policial_primeiro_acesso: policiais.primeiro_acesso
		})
		.from(administradores)
		.leftJoin(policiais, eq(administradores.policial_id, policiais.id))
		.where(eq(administradores.id, adminId))
		.limit(1);
}

/**
 * A conta admin ainda autentica? `null` quando não.
 *
 * O Admin Geral VINCULADO é o próprio policial: desativá-lo tem de derrubar os
 * DOIS modos. Até ago/2026 a sessão admin era validada só contra
 * `administradores`, sem olhar o vínculo — desativar o policial tirava o modo
 * usuário e deixava o modo administrador de pé, que é o mais poderoso dos dois
 * (FLW-RBAC-001). O ramo de policial sempre exigiu `ativo = 1`; faltava aqui.
 *
 * Admin STANDALONE (bootstrap por env, `policial_id` nulo) não tem vínculo a
 * conferir e segue valendo.
 */
function adminDaSessao(
	linha:
		| {
				admin: typeof administradores.$inferSelect;
				policial_ativo: number | null;
				policial_primeiro_acesso: number | null;
		  }
		| undefined
): typeof administradores.$inferSelect | null {
	if (!linha) return null;
	if (linha.admin.policial_id != null && linha.policial_ativo !== 1) return null;
	if (linha.admin.policial_id == null) return linha.admin;

	// VINCULADO: quem manda é a linha do policial, também no primeiro acesso.
	// `vincularAdminGeral` grava `primeiro_acesso = 0` na linha admin — um
	// placeholder, como a senha. O LOGIN já lia o valor certo (via `credPol` em
	// `auth-flow`), mas a SESSÃO carregava o zero, e é a sessão que o
	// `hooks.server.ts` consulta a cada request. Resultado: o policial novo era
	// mandado para `/alterar-senha` no login e podia navegar para qualquer outra
	// rota administrativa sem nunca concluir a troca (FLW-AUTH-003).
	return { ...linha.admin, primeiro_acesso: linha.policial_primeiro_acesso ?? 0 };
}

/**
 * A linha admin, se a conta ainda pode autenticar. `null` quando o policial
 * vinculado foi desativado.
 *
 * Ponto único da regra: a validação de sessão e a conclusão do 2FA precisam da
 * MESMA resposta. Quando cada uma respondia por conta própria, a do 2FA
 * esquecia o vínculo e emitia sessão de administrador para um policial
 * desativado (FLW-RBAC-001).
 */
export async function buscarAdminAtivo(
	db: Database,
	adminId: number
): Promise<typeof administradores.$inferSelect | null> {
	return adminDaSessao((await queryAdminDaSessao(db, adminId))[0]);
}

/**
 * Token → usuário logado, ou `null` para sessão inexistente, expirada ou de
 * conta que não serve mais.
 *
 * Todo `null` é tratado igual pelo chamador (redirect ao login), e é por isso
 * que a função não distingue os motivos. Em particular, o policial é relido com
 * `ativo = 1`: **desativar o cadastro derruba a sessão no próximo request**, sem
 * precisar apagar linha de sessão nenhuma. Já o admin não tem esse filtro — a
 * conta administrativa é removida, não desativada.
 *
 * Efeito colateral: renova `expires_at` quando a sessão está perto de vencer
 * (sliding). Use `validarSessaoComAceite` no `hooks.server.ts`, que faz o mesmo
 * já checando o Termo de Uso no mesmo batch.
 */
export async function validarSessao(
	db: Database,
	token: string | undefined,
	platform?: App.Platform
): Promise<UsuarioLogado | null> {
	const resultado = await buscarSessaoValida(db, token);
	if (!resultado) return null;
	const { sessao, slidingUpdate } = resultado;

	if (slidingUpdate) await slidingUpdate;

	if (sessao.tipo === 'admin') {
		const admin = await buscarAdminAtivo(db, sessao.usuario_id);
		return admin ? mapearAdmin(admin, platform) : null;
	}

	if (sessao.tipo === 'colaborador') {
		const c = (await queryColaboradorDaSessao(db, sessao.usuario_id))[0];
		return c ? mapearColaborador(c) : null;
	}

	// Decide POR TIPO, nunca "o que não é admin é policial": `usuario_id` de
	// tabelas diferentes colidem, e uma sessão de outro tipo carregaria o
	// policial de mesmo id. Tipo que este código não conhece é sessão inválida.
	if (sessao.tipo !== 'policial') return null;

	const policial = await db
		.select()
		.from(policiais)
		.where(and(eq(policiais.id, sessao.usuario_id), eq(policiais.ativo, 1)))
		.get();
	return policial ? await mapearPolicial(policial, platform) : null;
}

/**
 * Variante de `validarSessao` usada pelo hooks.server.ts: além do usuário,
 * verifica o aceite do Termo de Uso vigente NO MESMO round-trip ao D1.
 *
 * Motivação (auditoria de performance, B-1): a sequência sessão → usuário →
 * aceite eram 3 queries D1 em série em todo request autenticado (~5-30ms
 * cada no Worker). Aqui, depois da busca da sessão, usuário + aceite
 * (+ sliding update, quando devido) vão juntos num `db.batch` — 2 round-trips
 * no total em vez de 3-4.
 *
 * Nota de semântica: como usuário e aceite compartilham o batch, uma falha de
 * D1 derruba os dois e o request cai no fluxo "sessão inválida" (redirect ao
 * /login, cookie preservado — basta recarregar). Antes, uma falha isolada da
 * query de aceite deixava o request passar com warning; esse cenário só
 * ocorria de fato com o banco já indisponível, onde a página quebraria adiante
 * de qualquer forma.
 */
export async function validarSessaoComAceite(
	db: Database,
	token: string | undefined,
	platform: App.Platform | undefined,
	termo: { versao: string; hash: string }
): Promise<{ usuario: UsuarioLogado | null; aceiteVigente: boolean }> {
	const resultado = await buscarSessaoValida(db, token);
	if (!resultado) return { usuario: null, aceiteVigente: false };
	const { sessao, slidingUpdate } = resultado;

	const aceiteQuery = db
		.select({ versao_termo: aceitesTermos.versao_termo, hash_termo: aceitesTermos.hash_termo })
		.from(aceitesTermos)
		.where(
			and(
				eq(aceitesTermos.usuario_tipo, sessao.tipo),
				eq(aceitesTermos.usuario_id, sessao.usuario_id)
			)
		)
		.orderBy(desc(aceitesTermos.aceitou_em))
		.limit(1);

	let usuario: UsuarioLogado | null;
	let ultimoAceite: { versao_termo: string; hash_termo: string } | undefined;

	if (sessao.tipo === 'admin') {
		const userQuery = queryAdminDaSessao(db, sessao.usuario_id);
		const [linhas, aceites] = slidingUpdate
			? await db.batch([userQuery, aceiteQuery, slidingUpdate])
			: await db.batch([userQuery, aceiteQuery]);
		const admin = adminDaSessao(linhas[0]);
		usuario = admin ? mapearAdmin(admin, platform) : null;
		ultimoAceite = aceites[0];
	} else if (sessao.tipo === 'colaborador') {
		const userQuery = queryColaboradorDaSessao(db, sessao.usuario_id);
		const [cols, aceites] = slidingUpdate
			? await db.batch([userQuery, aceiteQuery, slidingUpdate])
			: await db.batch([userQuery, aceiteQuery]);
		usuario = cols[0] ? mapearColaborador(cols[0]) : null;
		ultimoAceite = aceites[0];
	} else if (sessao.tipo !== 'policial') {
		// Mesma regra de `validarSessao`: tipo desconhecido é sessão inválida,
		// não "policial por exclusão" — os ids das tabelas colidem.
		usuario = null;
	} else {
		const userQuery = db
			.select()
			.from(policiais)
			.where(and(eq(policiais.id, sessao.usuario_id), eq(policiais.ativo, 1)))
			.limit(1);
		const [pols, aceites] = slidingUpdate
			? await db.batch([userQuery, aceiteQuery, slidingUpdate])
			: await db.batch([userQuery, aceiteQuery]);
		usuario = pols[0] ? await mapearPolicial(pols[0], platform) : null;
		ultimoAceite = aceites[0];
	}

	return { usuario, aceiteVigente: aceiteEhVigente(ultimoAceite, termo.versao, termo.hash) };
}

/**
 * Logout: apaga a linha da sessão. Idempotente — token desconhecido não é erro.
 *
 * NÃO invalida o cache de sessão do edge: apagar a linha não basta, porque
 * `hooks.server.ts` responde do cache antes de consultar o D1 e o token seguiria
 * aceito por até um TTL (60s por padrão). Quem faz logout tem de chamar
 * `invalidarSessaoCache(token)` também — é o que a rota `/api/auth/logout` faz.
 */
export async function excluirSessao(db: Database, token: string): Promise<void> {
	// Cobre tanto a forma hasheada (atual) quanto linhas legadas em claro.
	await db.delete(sessoes).where(inArray(sessoes.token, [await hashTokenArmazenado(token), token]));
}

// ---- Autenticação de Dois Fatores ----

/** Gera um código numérico de 6 dígitos para 2FA. */
export function gerarCodigo2FA(): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
	return String(num % 1_000_000).padStart(6, '0');
}

/**
 * SHA-256 do código 2FA. O código em texto nunca é persisted diretamente.
 *
 * `extra` (I-1 da auditoria): quando presente, é misturado ao código antes
 * do hash. Usado pelo fluxo de verificação de e-mail pessoal para AMARRAR
 * o código ao endereço para o qual ele foi enviado. Sem isso, o usuário
 * podia receber o OTP em email_A, mas chamar `confirmar-verificacao`
 * passando email_B no body e persistir email_B sem verificação. O caller
 * `verificarDesafio2FA` precisa passar o mesmo `extra` da criação ou o
 * hash não confere.
 *
 * Separador `\x1f` (Unit Separator ASCII) impede colisão entre, por exemplo,
 * `extra="ab" + codigo="c"` e `extra="a" + codigo="bc"`.
 */
async function hashCodigo2FA(codigo: string, extra: string = ''): Promise<string> {
	return sha256Hex(extra ? `${extra}\x1f${codigo}` : codigo);
}

/**
 * Persiste um desafio 2FA no banco e retorna o desafioId (UUID aleatório).
 *
 * `bindExtra` AMARRA o desafio a um dado externo (ex.: e-mail destino para
 * verificação de e-mail pessoal). Quem chamar `verificarDesafio2FA` precisa
 * passar o mesmo `bindExtra` ou a verificação falha — fecha I-1.
 */
export async function criarDesafio2FA(
	db: Database,
	tipo: TipoDesafio2FA,
	usuarioId: number,
	codigo: string,
	bindExtra: string = ''
): Promise<string> {
	const desafioId = gerarToken();
	const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
	await db.insert(doisFatoresTokens).values({
		desafio_id: desafioId,
		tipo,
		usuario_id: usuarioId,
		codigo: await hashCodigo2FA(codigo, bindExtra),
		expires_at: expiresAt
	});
	return desafioId;
}

// ---- Redefinição de Senha ----

/**
 * Cria um token de redefinição de senha (256 bits, expira em 1 hora) e o persiste.
 * Retorna o token gerado para ser incluído no link de redefinição.
 */
export async function criarTokenRedefinicao(
	db: Database,
	tipoUsuario: 'policial' | 'admin',
	usuarioId: number
): Promise<string> {
	const token = gerarToken();
	const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
	await db.insert(resetSenhaTokens).values({
		token: await hashTokenArmazenado(token),
		tipo_usuario: tipoUsuario,
		usuario_id: usuarioId,
		expires_at: expiresAt
	});
	return token;
}

/**
 * Verifica um token de redefinição de senha. O lookup é pelo HASH do token
 * (com fallback para linhas legadas em claro); a comparação final do hash é
 * timing-safe. Retorna os dados do usuário se válido, 'expirado' ou 'invalido'.
 */
export async function verificarTokenRedefinicao(
	db: Database,
	tokenInput: string
): Promise<{ tipo: 'policial' | 'admin'; usuarioId: number } | 'expirado' | 'invalido'> {
	const tokenHash = await hashTokenArmazenado(tokenInput);
	const row = await db
		.select()
		.from(resetSenhaTokens)
		.where(inArray(resetSenhaTokens.token, [tokenHash, tokenInput]))
		.get();

	// Compara SEMPRE, mesmo sem linha encontrada, para o tempo de resposta não
	// revelar se o token existe (timing oracle).
	const SENTINEL = '0'.repeat(tokenHash.length);
	const storedToken = row?.token ?? SENTINEL;
	const esperado = storedToken.startsWith(PREFIXO_TOKEN_HASH) ? tokenHash : tokenInput;
	const tokensConferem = comparacaoTimingSafe(storedToken, esperado);

	if (!row || row.usado === 1 || !tokensConferem) {
		return 'invalido';
	}
	if (new Date() > new Date(row.expires_at)) {
		return 'expirado';
	}

	return { tipo: row.tipo_usuario as 'policial' | 'admin', usuarioId: row.usuario_id };
}

/**
 * CONSOME o token de redefinição: marca como usado e devolve o dono, numa
 * operação só. É esta — e não `verificarTokenRedefinicao` — que autoriza a
 * troca de senha.
 *
 * A leitura separada da marcação era o achado FLW-AUTH-004: entre o SELECT que
 * validava e o UPDATE que marcava cabia outra requisição, que lia a mesma linha
 * ainda com `usado = 0`. Um único link redefinia a senha duas vezes, e quem
 * interceptou o e-mail podia redefini-la DEPOIS do dono sem que o link "já
 * usado" o denunciasse. Marcar antes de trocar a senha encurtava a janela; não
 * a fechava.
 *
 * O `WHERE usado = 0 AND expires_at > agora` é o que fecha: o próprio SQLite
 * serializa os UPDATEs, então exatamente um altera a linha. Quem alterou ganha
 * — os demais recebem `'invalido'`.
 *
 * Expirado NÃO é consumido (fica fora do `WHERE`), para que a segunda tentativa
 * ainda diga "expirou, solicite outro link" em vez de "inválido". A distinção
 * entre os motivos da recusa é feita por uma leitura extra, e serve só à
 * MENSAGEM: a autorização já foi decidida pelo UPDATE.
 */
export async function consumirTokenRedefinicao(
	db: Database,
	tokenInput: string
): Promise<{ tipo: 'policial' | 'admin'; usuarioId: number } | 'expirado' | 'invalido'> {
	const tokenHash = await hashTokenArmazenado(tokenInput);
	const linhas = await db
		.update(resetSenhaTokens)
		.set({ usado: 1 })
		.where(
			and(
				// Linhas legadas guardam o token em claro; as atuais, o `sha256:`.
				inArray(resetSenhaTokens.token, [tokenHash, tokenInput]),
				eq(resetSenhaTokens.usado, 0),
				gt(resetSenhaTokens.expires_at, new Date().toISOString())
			)
		)
		.returning({
			tipo: resetSenhaTokens.tipo_usuario,
			usuarioId: resetSenhaTokens.usuario_id
		});

	const linha = linhas[0];
	if (linha) {
		return { tipo: linha.tipo as 'policial' | 'admin', usuarioId: linha.usuarioId };
	}

	// Perdeu a corrida, já estava usado, expirou ou nunca existiu — só a
	// primeira letra da mensagem muda, e nada aqui concede acesso.
	return (await verificarTokenRedefinicao(db, tokenInput)) === 'expirado' ? 'expirado' : 'invalido';
}

/**
 * CONSOME um desafio de dois fatores: marca `usado = 1` e diz se ESTA chamada
 * foi a que conseguiu.
 *
 * `false` significa que outra requisição chegou primeiro — o desafio é de uso
 * único e já foi gasto. Quem recebe `false` tem de recusar o acesso, não
 * seguir em frente.
 *
 * Sem o `WHERE usado = 0` (como era nos três call sites até ago/2026) o UPDATE
 * é incondicional e duas submissões paralelas do MESMO código válido criam duas
 * sessões: o código de 6 dígitos que o usuário recebeu por e-mail vira
 * reutilizável dentro da janela entre a leitura e a marcação. É a mesma
 * causa-raiz do FLW-AUTH-004 no token de redefinição.
 */
export async function consumirDesafio2FA(db: Database, desafioId: number): Promise<boolean> {
	const linhas = await db
		.update(doisFatoresTokens)
		.set({ usado: 1 })
		.where(and(eq(doisFatoresTokens.id, desafioId), eq(doisFatoresTokens.usado, 0)))
		.returning({ id: doisFatoresTokens.id });
	return linhas.length === 1;
}

/**
 * Verifica um desafio 2FA.
 *
 * `expectedTipos` é OBRIGATÓRIO e funciona como defense-in-depth: o canal
 * (login, reset, assinatura) precisa declarar quais tipos de desafio aceita.
 * Sem isso, um `desafioId` emitido para um canal (ex.: `'assinatura'`) poderia
 * ser submetido em outro (ex.: `/api/auth/verificar-2fa`) e gerar sessão
 * indevida. Mismatch retorna `null` indistinguível de código inválido.
 *
 * Retorna os dados do usuário se válido, ou uma string descrevendo o erro.
 *
 * `options.markUsed` (default `true`): quando `false`, o desafio NÃO é marcado
 * como usado em caso de sucesso — fica reutilizável até expirar (10 min). Use
 * para ASSINATURA EM LOTE: o usuário solicita um código e assina vários
 * documentos na mesma sessão, dentro da janela de validade. Login/reset/2FA de
 * sessão mantêm o default (uso único) para preservar a proteção anti-replay.
 */
export async function verificarDesafio2FA(
	db: Database,
	desafioId: string,
	codigoInput: string,
	expectedTipos: readonly TipoDesafio2FA[],
	bindExtra: string = '',
	options: { markUsed?: boolean } = {}
): Promise<{ tipo: TipoDesafio2FA; usuarioId: number } | 'expirado' | 'esgotado' | null> {
	const markUsed = options.markUsed ?? true;
	const desafio = await db
		.select()
		.from(doisFatoresTokens)
		.where(eq(doisFatoresTokens.desafio_id, desafioId))
		.get();

	if (!desafio || desafio.usado === 1) return null;
	if (!expectedTipos.includes(desafio.tipo as TipoDesafio2FA)) return null;
	if (new Date() > new Date(desafio.expires_at)) return 'expirado';
	if (desafio.tentativas >= 5) return 'esgotado';

	// `bindExtra` precisa coincidir com o passado em `criarDesafio2FA` — sem
	// isso o hash não confere (I-1 da auditoria). Caller passa `''` para
	// fluxos legados que não usam binding.
	const hashedInput = await hashCodigo2FA(String(codigoInput), bindExtra);
	if (!comparacaoTimingSafe(desafio.codigo, hashedInput)) {
		// Incremento no SQL, e não `desafio.tentativas + 1`: cinco palpites
		// paralelos com o valor lido antes de qualquer um gravar registrariam
		// UMA tentativa, e o teto de 5 nunca seria alcançado.
		await db
			.update(doisFatoresTokens)
			.set({ tentativas: sql`${doisFatoresTokens.tentativas} + 1` })
			.where(eq(doisFatoresTokens.id, desafio.id));
		return null;
	}

	// Em lote (`markUsed: false`) o desafio permanece válido até expirar, para
	// autorizar várias assinaturas na mesma sessão sem novo código a cada uma.
	// Fora do lote, perder a corrida do consumo é recusa: o código já foi gasto.
	if (markUsed && !(await consumirDesafio2FA(db, desafio.id))) return null;

	return { tipo: desafio.tipo as TipoDesafio2FA, usuarioId: desafio.usuario_id };
}

/**
 * A tela de entrada de cada perfil.
 *
 * Desde a fase 1 do Ecossistema (decisão E39) os perfis ADMINISTRATIVOS —
 * sessão de admin e os dois papéis com escopo — entram pela home de módulos
 * (`/`), organizada nos quatro grupos de gestão; `/escalas/bem-vindo` e
 * `/gise/bem-vindo` viraram redirecionamentos para ela. O parâmetro
 * `adminModulo` continua aceito porque os call sites o passam e a home ignora
 * a preferência de tela de propósito (o que ela respeita é `modulosAdmin`,
 * em `home-modulos.ts`).
 */
export function obterRotaBemVindo(u: UsuarioLogado, _adminModulo?: string | null): string {
	// Super Admin tem console próprio (administração do sistema + auditoria).
	if (u.isSuperAdmin) {
		return '/super-admin';
	}
	if (u.tipo === 'admin') {
		return '/';
	}
	if (u.tipo === 'colaborador') {
		return '/colaborador';
	}
	if (u.papel === 'admin_seccional' || u.papel === 'admin_unidade') {
		return '/';
	}
	return '/bem-vindo';
}
