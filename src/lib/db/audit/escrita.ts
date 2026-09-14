/**
 * Gravação da trilha de auditoria, e a anonimização de IP que ela exige.
 *
 * A gravação NUNCA lança: falhas são logadas e jamais bloqueiam o fluxo
 * principal. O que não conseguiu entrar vai para `audit_pendencias` e é
 * reprocessado — é essa a razão de `reprocessarPendenciasAudit` existir.
 *
 * `anonimizarIp` mora aqui, e não num utilitário solto, porque é o par LGPD do
 * `ip_cifrado`: o registro guarda o IP anonimizado para leitura corriqueira e o
 * cifrado para perícia. Outros módulos (`gise/presencas`, `gise/documentos`,
 * `gise/assinaturas`, `documentos`, `auth/recovery-rate-limit`) a importam pelo
 * índice do domínio.
 */
import { eq, sql, desc, asc } from 'drizzle-orm';
import { ehViolacaoUnique, mensagemComCausas } from '$lib/server/db-errors';
import { auditLog, auditPendencias } from '../../server/schema';
import { timestampSqliteUtc, type Database } from '../core';
import { logger } from '../../server/logger';
import { getRequestCtx } from '../../server/request-context';
import { cifrarTexto } from '../../crypto/field-cripto';
import {
	metaDaAcao,
	type AcaoAudit,
	type AuditCategoria,
	type AuditSeveridade,
	type AuditResultado,
	type AuditActorTipo
} from './catalogo';
import {
	canonicalAudit,
	calcularHashRegistro,
	lerChave,
	GENESIS,
	type AuditCriptoEnv
} from './cadeia';
import { mensagemDeErro } from '$lib/utils/erro';

// ---- Anonimização de IP (LGPD) ---------------------------------------------

/**
 * Anonimiza IPs para conformidade LGPD.
 *  - IPv4: zera o último octeto (`/24`): 192.168.1.42 → 192.168.1.0
 *  - IPv6: zera os 64 bits finais (`/64`): 2001:db8::1 → 2001:db8:0:0::
 *
 * O `/64` (4 grupos) é o equivalente em granularidade do `/24` IPv4: identifica
 * a rede do ISP, não o assinante. Notação `::` é expandida antes do corte.
 */
export function anonimizarIp(ip: string | null | undefined): string | null {
	if (!ip) return null;
	if (ip.includes(':')) {
		try {
			let parts: string[];
			if (ip.includes('::')) {
				const [head, tail] = ip.split('::');
				const headParts = head ? head.split(':') : [];
				const tailParts = tail ? tail.split(':') : [];
				const zerosFaltando = 8 - headParts.length - tailParts.length;
				if (zerosFaltando < 0) return null;
				parts = [...headParts, ...Array<string>(zerosFaltando).fill('0'), ...tailParts];
			} else {
				parts = ip.split(':');
			}
			if (parts.length === 8) {
				return parts.slice(0, 4).join(':') + '::';
			}
		} catch {
			// fallback
		}
		return null;
	}
	const octets = ip.split('.');
	if (octets.length === 4) {
		return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
	}
	return null;
}

// ---- Gravação ---------------------------------------------------------------

/** Timestamp UTC no mesmo formato do default `datetime('now')` do SQLite. */
const agoraUtc = () => timestampSqliteUtc();

function comoJson(v: Record<string, unknown> | null | undefined): string | null {
	if (v == null) return null;
	try {
		return JSON.stringify(v);
	} catch {
		return null;
	}
}

/** Evento de auditoria (modelo rico). */
export interface AuditEvento {
	acao: AcaoAudit | (string & {});
	/** Ator que executou. `null` = ação do sistema/automação. */
	usuario?: { id: number; nome: string; papel?: string | null; tipo?: AuditActorTipo } | null;
	actor_tipo?: AuditActorTipo;
	/** Tipo da entidade afetada (compat com o log original). */
	entidade: string;
	entidade_id?: number | null;
	/** Alvo explícito (quando difere do ator — ex.: admin reseta senha de OUTRO). */
	alvo_tipo?: string | null;
	alvo_id?: number | null;
	alvo_nome?: string | null;
	/** Override da classificação derivada do catálogo. */
	categoria?: AuditCategoria;
	severidade?: AuditSeveridade;
	resultado?: AuditResultado;
	/** Texto humano (equivale ao antigo `detalhes`). */
	detalhes?: string | null;
	metadados?: Record<string, unknown> | null;
	dados_antes?: Record<string, unknown> | null;
	dados_depois?: Record<string, unknown> | null;
	/** Contexto de request. */
	ip?: string | null;
	user_agent?: string | null;
	request_id?: string | null;
	rota?: string | null;
	metodo?: string | null;
}

/** Forma mínima de um RequestEvent do SvelteKit consumida pela auditoria. */
export interface EventoRequestLike {
	request: { method: string; headers: { get(name: string): string | null } };
	url: { pathname: string };
	getClientAddress?: () => string;
	locals?: { requestId?: string };
	// `env` fica `unknown` para aceitar o `App.Platform` real (cujo `env` é o tipo
	// `Env` completo do Cloudflare) sem acoplar a auditoria a ele — o cast para
	// `AuditCriptoEnv` acontece dentro de `contextoDeEvento`.
	platform?: { env?: unknown } | null;
}

/**
 * Extrai de um RequestEvent o contexto comum de auditoria (IP, user-agent,
 * request_id, rota, método) e a `env` de criptografia. Reduz a instrumentação
 * de cada handler a:
 *
 *   const { contexto, env } = contextoDeEvento(event);
 *   await auditar(db, { acao, usuario, entidade, ...contexto }, { env });
 */
export function contextoDeEvento(event: EventoRequestLike): {
	contexto: Pick<AuditEvento, 'ip' | 'user_agent' | 'request_id' | 'rota' | 'metodo'>;
	env?: AuditCriptoEnv;
} {
	let ip: string | null = null;
	try {
		ip = event.getClientAddress?.() ?? null;
	} catch {
		// getClientAddress pode lançar fora do contexto de uma request; mantém null.
	}
	return {
		contexto: {
			ip,
			user_agent: event.request.headers.get('user-agent'),
			request_id: event.locals?.requestId ?? null,
			rota: event.url.pathname,
			metodo: event.request.method
		},
		env: (event.platform?.env ?? undefined) as AuditCriptoEnv | undefined
	};
}

const MAX_TENTATIVAS_CHAIN = 5;

/**
 * Colisão do índice `uq_audit_seq` (dois appends simultâneos pegaram o mesmo
 * `seq`) — condição de retry do encadeamento.
 *
 * Precisa olhar a cadeia de `cause`: o Drizzle põe só "Failed query: insert
 * into audit_log ..." na mensagem de topo, e o "UNIQUE constraint failed" fica
 * na causa. Testando apenas `err.message`, o retry nunca acontecia e o evento
 * era descartado (a falha só aparecia no log).
 */
function ehViolacaoSeq(err: unknown): boolean {
	if (!ehViolacaoUnique(err)) return false;
	const msg = mensagemComCausas(err).toUpperCase();
	return msg.includes('SEQ') || msg.includes('UQ_AUDIT_SEQ');
}

/**
 * Registra um evento na trilha de auditoria. NUNCA lança.
 *
 * Falha na cadeia vira PENDÊNCIA DURÁVEL (`audit_pendencias`) e o fluxo segue:
 * a mutação do usuário já aconteceu e não é desfeita aqui, mas o evento também
 * não some — `reprocessarPendenciasAudit` o reinsere depois (FLW-AUDIT-001).
 */
export async function auditar(
	db: Database,
	evento: AuditEvento,
	ctx?: { env?: unknown }
): Promise<void> {
	return anexar(db, evento, ctx, 'pendencia');
}

/**
 * O append encadeado.
 *
 * Faz, por gravação: cifra o IP completo (se houver chave), lê o topo da cadeia,
 * calcula o `hash_registro` encadeado e insere com `seq` único. Em corrida de
 * `seq` (dois appends simultâneos), relê o topo e refaz — até algumas tentativas.
 *
 * `naFalha` existe porque os dois chamadores precisam de respostas DIFERENTES
 * para a mesma falha: o fluxo normal engole e vira pendência — auditoria não
 * derruba a operação do usuário —, enquanto o reprocessamento precisa saber se
 * deu certo, para escolher entre apagar a pendência e incrementar as tentativas.
 */
async function anexar(
	db: Database,
	evento: AuditEvento,
	// `env` é `unknown` para aceitar o `App.Platform['env']` real (tipo `Env`
	// completo do Cloudflare) sem cast nos call sites; convertido internamente.
	ctx: { env?: unknown } | undefined,
	naFalha: 'pendencia' | 'lancar'
): Promise<void> {
	try {
		const meta = metaDaAcao(evento.acao);
		const cryptoEnv = ctx?.env as AuditCriptoEnv | undefined;
		const ipKey = lerChave(cryptoEnv?.AUDIT_IP_ENCRYPTION_KEY);
		const chainKey = lerChave(cryptoEnv?.AUDIT_CHAIN_KEY);

		const ipCompleto = evento.ip ?? null;
		let ip_cifrado: string | null = null;
		if (ipCompleto && ipKey) {
			try {
				ip_cifrado = await cifrarTexto(ipCompleto, ipKey);
			} catch (err) {
				logger.warn('[audit] Falha ao cifrar IP', {
					error: mensagemDeErro(err)
				});
			}
		}

		// Fallback de contexto: mesmo chamadas que não passam request_id/rota
		// (as ~25 legadas) herdam esses campos do AsyncLocalStorage da request,
		// populado em hooks.server.ts. Mantém a trilha consistente sem tocar todos
		// os call sites. IP/user-agent não vivem no store — ficam por conta de quem
		// passa o contexto (contextoDeEvento).
		const reqCtx = getRequestCtx();

		const base = {
			actor_tipo: evento.actor_tipo ?? evento.usuario?.tipo ?? (evento.usuario ? null : 'sistema'),
			usuario_id: evento.usuario?.id ?? null,
			usuario_nome: evento.usuario?.nome ?? 'Sistema',
			usuario_papel: evento.usuario?.papel ?? null,
			acao: evento.acao,
			categoria: evento.categoria ?? meta.categoria,
			severidade: evento.severidade ?? meta.severidade,
			resultado: evento.resultado ?? 'sucesso',
			entidade: evento.entidade,
			entidade_id: evento.entidade_id ?? null,
			alvo_tipo: evento.alvo_tipo ?? null,
			alvo_id: evento.alvo_id ?? null,
			alvo_nome: evento.alvo_nome ?? null,
			detalhes: evento.detalhes ?? null,
			metadados: comoJson(evento.metadados),
			dados_antes: comoJson(evento.dados_antes),
			dados_depois: comoJson(evento.dados_depois),
			ip: anonimizarIp(ipCompleto),
			ip_cifrado,
			user_agent: evento.user_agent ?? null,
			request_id: evento.request_id ?? reqCtx?.requestId ?? null,
			rota: evento.rota ?? reqCtx?.path ?? null,
			metodo: evento.metodo ?? null,
			created_at: agoraUtc()
		} as const;

		for (let tentativa = 0; tentativa < MAX_TENTATIVAS_CHAIN; tentativa++) {
			const [topo] = await db
				.select({ seq: auditLog.seq, hash_registro: auditLog.hash_registro })
				.from(auditLog)
				.orderBy(desc(auditLog.seq))
				.limit(1);

			const seq = (topo?.seq ?? 0) + 1;
			const hash_anterior = topo?.hash_registro ?? GENESIS;
			const canonical = canonicalAudit({ ...base, seq, hash_anterior });
			const hash_registro = await calcularHashRegistro(hash_anterior, canonical, chainKey);

			try {
				await db.insert(auditLog).values({ ...base, seq, hash_anterior, hash_registro });
				return;
			} catch (err) {
				if (ehViolacaoSeq(err) && tentativa < MAX_TENTATIVAS_CHAIN - 1) continue;
				throw err;
			}
		}
	} catch (err) {
		if (naFalha === 'lancar') throw err;
		const motivo = mensagemDeErro(err);
		logger.error('[audit] Falha ao registrar evento', {
			acao: evento.acao,
			entidade: evento.entidade,
			error: motivo
		});
		await registrarPendenciaAudit(db, evento, motivo);
	}
}

/** Teto do texto de motivo: mensagem de driver pode vir com o SQL inteiro. */
const LIMITE_MOTIVO = 500;

/** Quantas pendências uma passada do reprocessamento tenta drenar. */
const LOTE_REPROCESSAMENTO = 100;

/**
 * Guarda o evento que a cadeia recusou, para reprocessamento posterior.
 *
 * Também não lança: é o ÚLTIMO recurso, e uma exceção aqui derrubaria
 * exatamente a operação que `auditar` existe para não derrubar. Quando nem isto
 * grava — D1 fora do ar —, o log é tudo o que resta, e o `logger.error` acima
 * já saiu. É um limite honesto: a tabela de pendência é deliberadamente burra
 * (sem `seq`, sem hash, sem índice único) porque a maioria das falhas é
 * específica da CADEIA, e é aí que ela tem chance de gravar.
 */
async function registrarPendenciaAudit(
	db: Database,
	evento: AuditEvento,
	motivo: string
): Promise<void> {
	try {
		await db.insert(auditPendencias).values({
			evento: JSON.stringify(evento),
			acao: String(evento.acao),
			entidade: evento.entidade ?? null,
			motivo: motivo.slice(0, LIMITE_MOTIVO)
		});
	} catch (err) {
		logger.error('[audit] Falha ao registrar PENDÊNCIA — evento perdido', {
			acao: evento.acao,
			error: mensagemDeErro(err)
		});
	}
}

/**
 * Reinsere na cadeia os eventos que ficaram pendentes.
 *
 * Roda junto da limpeza de retenção (cron diário). A ORDEM de chegada é
 * preservada — `created_at` crescente — porque a trilha é lida como linha do
 * tempo, e reprocessar fora de ordem produziria um `seq` que não corresponde à
 * sequência dos fatos.
 *
 * Falhou de novo? A pendência FICA, com `tentativas` incrementado. Uma
 * pendência cujo contador só cresce é o sinal de defeito PERMANENTE — payload
 * inválido, coluna recusando o valor — em oposição à corrida de `seq`, que some
 * na primeira retentativa.
 */
export async function reprocessarPendenciasAudit(
	db: Database,
	ctx?: { env?: unknown }
): Promise<{ reprocessadas: number; persistentes: number }> {
	const pendentes = await db
		.select()
		.from(auditPendencias)
		.orderBy(asc(auditPendencias.created_at), asc(auditPendencias.id))
		.limit(LOTE_REPROCESSAMENTO);

	let reprocessadas = 0;
	let persistentes = 0;

	for (const linha of pendentes) {
		let evento: AuditEvento;
		try {
			evento = JSON.parse(linha.evento) as AuditEvento;
		} catch {
			// JSON corrompido nunca vai voltar. Sai da fila para não mascarar as
			// pendências reais com um item que falha para sempre.
			logger.error('[audit] Pendência com JSON inválido — descartada', { id: linha.id });
			await db.delete(auditPendencias).where(eq(auditPendencias.id, linha.id));
			continue;
		}

		try {
			await anexar(db, evento, ctx, 'lancar');
			await db.delete(auditPendencias).where(eq(auditPendencias.id, linha.id));
			reprocessadas++;
		} catch (err) {
			persistentes++;
			await db
				.update(auditPendencias)
				.set({
					tentativas: linha.tentativas + 1,
					ultima_tentativa_em: timestampSqliteUtc(),
					motivo: mensagemDeErro(err).slice(0, LIMITE_MOTIVO)
				})
				.where(eq(auditPendencias.id, linha.id));
		}
	}

	if (persistentes > 0) {
		logger.error('[audit] Pendências que falharam de novo', { persistentes });
	}
	return { reprocessadas, persistentes };
}

/** Quantos eventos estão à espera de entrar na cadeia. */
export async function contarPendenciasAudit(db: Database): Promise<number> {
	const [r] = await db.select({ n: sql<number>`count(*)` }).from(auditPendencias);
	return Number(r?.n ?? 0);
}

/** Um evento sem o contexto de request — o handler não precisa preenchê-lo. */
export type EventoSemContexto = Omit<
	AuditEvento,
	'ip' | 'user_agent' | 'request_id' | 'rota' | 'metodo'
>;

/**
 * `auditar` com IP, user-agent, request_id, rota, método e `env` já extraídos
 * do RequestEvent.
 *
 * Encurta a instrumentação de um handler de três linhas para uma, e é o que as
 * form actions de `/operacoes/gise/[id]` e `/escalas/[id]` usam. O ganho não é o
 * tamanho: é que esquecer o `...contexto` deixava o evento sem IP e sem rota
 * — silenciosamente, porque todos os cinco campos são opcionais.
 */
export async function auditarDoEvento(
	event: EventoRequestLike,
	db: Database,
	evento: EventoSemContexto
): Promise<void> {
	const { contexto, env } = contextoDeEvento(event);
	return auditar(db, { ...evento, ...contexto }, { env });
}

/**
 * Compat: mantém a assinatura usada pelas chamadas existentes. Delegada para
 * `auditar`, mapeando `detalhes` e aceitando opcionalmente `env` (cifragem do
 * IP + chave da cadeia) e os campos ricos.
 */
export async function registrarAuditComContexto(
	db: Database,
	opts: {
		usuario: { id: number; nome: string; papel?: string | null; tipo?: AuditActorTipo } | null;
		acao: AcaoAudit | (string & {});
		entidade: string;
		entidade_id?: number | null;
		detalhes?: string | null;
		ip?: string | null;
		user_agent?: string | null;
		// Extensões opcionais (não usadas pelas chamadas legadas).
		actor_tipo?: AuditActorTipo;
		alvo_tipo?: string | null;
		alvo_id?: number | null;
		alvo_nome?: string | null;
		resultado?: AuditResultado;
		metadados?: Record<string, unknown> | null;
		dados_antes?: Record<string, unknown> | null;
		dados_depois?: Record<string, unknown> | null;
		request_id?: string | null;
		rota?: string | null;
		metodo?: string | null;
		env?: unknown;
	}
): Promise<void> {
	return auditar(
		db,
		{
			acao: opts.acao,
			usuario: opts.usuario,
			actor_tipo: opts.actor_tipo,
			entidade: opts.entidade,
			entidade_id: opts.entidade_id,
			alvo_tipo: opts.alvo_tipo,
			alvo_id: opts.alvo_id,
			alvo_nome: opts.alvo_nome,
			resultado: opts.resultado,
			detalhes: opts.detalhes,
			metadados: opts.metadados,
			dados_antes: opts.dados_antes,
			dados_depois: opts.dados_depois,
			ip: opts.ip,
			user_agent: opts.user_agent,
			request_id: opts.request_id,
			rota: opts.rota,
			metodo: opts.metodo
		},
		{ env: opts.env }
	);
}
