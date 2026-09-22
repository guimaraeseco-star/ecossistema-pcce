/**
 * Leitura da trilha de auditoria: listagem paginada, resumo, e a verificação de
 * integridade da cadeia de hash.
 *
 * `verificarIntegridadeAudit` é leitura, mas depende da cadeia: ela RECALCULA os
 * hashes das linhas gravadas e compara com o que está no banco. Por isso importa
 * de `cadeia.ts` em vez de reimplementar a forma canônica — uma segunda
 * implementação divergiria no primeiro campo novo e acusaria adulteração onde
 * não houve.
 */
import { desc, asc, eq, and, gte, lte, isNotNull, sql } from 'drizzle-orm';
import { auditCheckpoints, auditLog } from '../../server/schema';
import { paginarComContagem, timestampSqliteUtc, buscaPorPartes, type Database } from '../core';
import type { AuditLog } from '../../server/schema';
import { type AuditResultado, type AuditSeveridade, type AuditActorTipo } from './catalogo';
import {
	canonicalAudit,
	calcularHashRegistro,
	lerChave,
	GENESIS,
	type AuditCriptoEnv
} from './cadeia';

// ---- Consulta ---------------------------------------------------------------

export interface ListarAuditOpts {
	usuario_id?: number;
	entidade?: string;
	acao?: string;
	categoria?: string;
	severidade?: string;
	resultado?: string;
	actor_tipo?: string;
	/** ISO/`YYYY-MM-DD` inclusivo. */
	de?: string;
	/** ISO/`YYYY-MM-DD` inclusivo. */
	ate?: string;
	busca?: string;
	page?: number;
	limit?: number;
}

/** Lista entradas do log de auditoria com filtros e paginação. */
export async function listarAuditLog(
	db: Database,
	opts?: ListarAuditOpts
): Promise<{
	logs: AuditLog[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const conditions = [];

	if (opts?.usuario_id) conditions.push(eq(auditLog.usuario_id, opts.usuario_id));
	if (opts?.entidade) conditions.push(eq(auditLog.entidade, opts.entidade));
	if (opts?.acao) conditions.push(eq(auditLog.acao, opts.acao));
	if (opts?.categoria) conditions.push(eq(auditLog.categoria, opts.categoria));
	// Filtros vindos de query string: cast para o tipo do enum da coluna. Valor
	// fora do domínio simplesmente não casa nenhuma linha (filtro vazio).
	if (opts?.severidade)
		conditions.push(eq(auditLog.severidade, opts.severidade as AuditSeveridade));
	if (opts?.resultado) conditions.push(eq(auditLog.resultado, opts.resultado as AuditResultado));
	if (opts?.actor_tipo) conditions.push(eq(auditLog.actor_tipo, opts.actor_tipo as AuditActorTipo));
	if (opts?.de) conditions.push(gte(auditLog.created_at, opts.de));
	if (opts?.ate) conditions.push(lte(auditLog.created_at, opts.ate));
	if (opts?.busca) {
		const termo = opts.busca;
		conditions.push(
			buscaPorPartes([auditLog.usuario_nome, auditLog.detalhes, auditLog.alvo_nome], termo)!
		);
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	const page = Math.max(1, opts?.page ?? 1);
	const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
	const offset = (page - 1) * limit;

	// Query única com window function: evita um segundo count(*).
	const rows = await db
		.select({
			id: auditLog.id,
			usuario_id: auditLog.usuario_id,
			usuario_nome: auditLog.usuario_nome,
			usuario_papel: auditLog.usuario_papel,
			actor_tipo: auditLog.actor_tipo,
			acao: auditLog.acao,
			categoria: auditLog.categoria,
			severidade: auditLog.severidade,
			resultado: auditLog.resultado,
			entidade: auditLog.entidade,
			entidade_id: auditLog.entidade_id,
			alvo_tipo: auditLog.alvo_tipo,
			alvo_id: auditLog.alvo_id,
			alvo_nome: auditLog.alvo_nome,
			detalhes: auditLog.detalhes,
			metadados: auditLog.metadados,
			dados_antes: auditLog.dados_antes,
			dados_depois: auditLog.dados_depois,
			ip: auditLog.ip,
			ip_cifrado: auditLog.ip_cifrado,
			user_agent: auditLog.user_agent,
			request_id: auditLog.request_id,
			rota: auditLog.rota,
			metodo: auditLog.metodo,
			seq: auditLog.seq,
			hash_anterior: auditLog.hash_anterior,
			hash_registro: auditLog.hash_registro,
			created_at: auditLog.created_at,
			total: sql<number>`count(*) OVER()`
		})
		.from(auditLog)
		.where(whereClause)
		.orderBy(desc(auditLog.created_at), desc(auditLog.id))
		.limit(limit)
		.offset(offset);

	const { itens, ...paginacao } = paginarComContagem(rows, page, limit);
	return { logs: itens, ...paginacao };
}

export interface ResumoAuditoria {
	total: number;
	falhasLogin24h: number;
	criticos7d: number;
	ultimoEvento: string | null;
}

/** Indicadores para o cabeçalho do console de auditoria (KPIs). */
export async function resumoAuditoria(db: Database): Promise<ResumoAuditoria> {
	const agora = Date.now();
	const h24 = timestampSqliteUtc(agora - 24 * 3_600_000);
	const d7 = timestampSqliteUtc(agora - 7 * 86_400_000);

	const [tot, fl, cr, ult] = await Promise.all([
		db.select({ n: sql<number>`count(*)` }).from(auditLog),
		db
			.select({ n: sql<number>`count(*)` })
			.from(auditLog)
			.where(and(eq(auditLog.acao, 'falha_login'), gte(auditLog.created_at, h24))),
		db
			.select({ n: sql<number>`count(*)` })
			.from(auditLog)
			.where(and(eq(auditLog.severidade, 'critico'), gte(auditLog.created_at, d7))),
		db
			.select({ c: auditLog.created_at })
			.from(auditLog)
			.orderBy(desc(auditLog.created_at), desc(auditLog.id))
			.limit(1)
	]);

	return {
		total: tot[0]?.n ?? 0,
		falhasLogin24h: fl[0]?.n ?? 0,
		criticos7d: cr[0]?.n ?? 0,
		ultimoEvento: ult[0]?.c ?? null
	};
}

/** Busca um único evento de auditoria pelo id (para exportar/inspecionar). */
export async function buscarAuditLog(db: Database, id: number): Promise<AuditLog | undefined> {
	return db.select().from(auditLog).where(eq(auditLog.id, id)).get();
}

/** Cabeça atual da cadeia de hash (âncora) — usada nos rodapés de exportação. */
export async function cabecaCadeiaAudit(
	db: Database
): Promise<{ seq: number; hash: string } | null> {
	const [t] = await db
		.select({ seq: auditLog.seq, hash: auditLog.hash_registro })
		.from(auditLog)
		.where(isNotNull(auditLog.seq))
		.orderBy(desc(auditLog.seq))
		.limit(1);
	return t?.seq != null && t.hash ? { seq: t.seq, hash: t.hash } : null;
}

// ---- Verificação de integridade (tamper-evidence) --------------------------

export interface ResultadoIntegridade {
	ok: boolean;
	/** Total de linhas encadeadas (com `seq`) examinadas. */
	verificados: number;
	/** `seq` da primeira inconsistência, se houver. */
	primeiroProblemaSeq?: number;
	/** Descrição da inconsistência. */
	problema?: string;
	/** Âncora atual: `seq` da última linha encadeada (cabeça da cadeia). */
	ultimoSeq?: number;
	/**
	 * Hash da cabeça da cadeia. O operador pode registrá-lo externamente
	 * (anchoring): se o log for adulterado depois, este valor não bate mais.
	 */
	ultimoHash?: string;
	/**
	 * COM QUE FORÇA a cadeia está encadeada — o que `ok: true` vale.
	 *
	 * `hmac`: com `AUDIT_CHAIN_KEY`, quem tem escrita no banco NÃO forja a
	 * continuação. `sha256`: sem a chave, quem reescreve a cauda inteira produz
	 * uma cadeia que fecha — a trilha detecta adulteração ACIDENTAL e nada mais.
	 * `misto`: a chave foi adotada (ou perdida) no meio da vida do log; a tag por
	 * linha é o que permite verificar as duas metades.
	 *
	 * Existia só implícito, no prefixo `h:`/`s:` do `ultimoHash` — legível por
	 * quem soubesse procurar. O `.env.example` e o `DEPLOY.md` explicam a
	 * consequência de não definir a chave, mas NADA em runtime dizia em que modo
	 * a trilha de fato está: um deploy sem a chave (ou uma rotação de segredo que
	 * a perdeu) roda forjável, e o console reporta "íntegra" — verdade sobre o
	 * elo, silêncio sobre o valor da garantia. É o que alguém descobriria no pior
	 * momento possível, que é durante uma perícia.
	 */
	modoCadeia?: 'hmac' | 'sha256' | 'misto' | 'vazia';
	/** Quantas linhas em cada modo — o numerador de `modoCadeia`. */
	encadeamento?: { hmac: number; sha256: number };
}

/**
 * Reexecuta a cadeia de hash e confirma que nenhuma linha encadeada foi alterada
 * ou removida. Detecta: (a) elo quebrado (`hash_anterior` ≠ hash do antecessor),
 * (b) hash recalculado divergente (linha adulterada), (c) buraco na sequência
 * (linha removida). Buracos podem também indicar purga de retenção — o operador
 * cruza com os eventos `limpeza_retencao` para distinguir.
 */
export async function verificarIntegridadeAudit(
	db: Database,
	env?: AuditCriptoEnv
): Promise<ResultadoIntegridade> {
	const chainKey = lerChave(env?.AUDIT_CHAIN_KEY);

	const rows = await db
		.select({
			seq: auditLog.seq,
			created_at: auditLog.created_at,
			actor_tipo: auditLog.actor_tipo,
			usuario_id: auditLog.usuario_id,
			usuario_nome: auditLog.usuario_nome,
			usuario_papel: auditLog.usuario_papel,
			acao: auditLog.acao,
			categoria: auditLog.categoria,
			severidade: auditLog.severidade,
			resultado: auditLog.resultado,
			entidade: auditLog.entidade,
			entidade_id: auditLog.entidade_id,
			alvo_tipo: auditLog.alvo_tipo,
			alvo_id: auditLog.alvo_id,
			alvo_nome: auditLog.alvo_nome,
			detalhes: auditLog.detalhes,
			metadados: auditLog.metadados,
			dados_antes: auditLog.dados_antes,
			dados_depois: auditLog.dados_depois,
			ip: auditLog.ip,
			ip_cifrado: auditLog.ip_cifrado,
			user_agent: auditLog.user_agent,
			request_id: auditLog.request_id,
			rota: auditLog.rota,
			metodo: auditLog.metodo,
			hash_anterior: auditLog.hash_anterior,
			hash_registro: auditLog.hash_registro
		})
		.from(auditLog)
		.where(isNotNull(auditLog.seq))
		.orderBy(asc(auditLog.seq));

	// Âncoras dos cortes de retenção. Sem elas, a primeira linha sobrevivente
	// seria aceita como início válido venha de onde vier (FLW-AUDIT-005).
	const checkpoints = await db
		.select({ seq_ate: auditCheckpoints.seq_ate, hash_ate: auditCheckpoints.hash_ate })
		.from(auditCheckpoints);
	const ancoraPorSeq = new Map(checkpoints.map((c) => [c.seq_ate, c.hash_ate]));

	let anterior: { seq: number; hash_registro: string } | null = null;
	// Tag por linha (`h:` HMAC / `s:` SHA-256): é o que permite dizer o modo
	// mesmo quando a chave foi adotada no meio da vida do log.
	let nHmac = 0;
	let nSha = 0;
	/**
	 * O modo vai em TODO retorno, inclusive nos de falha: saber que a cadeia
	 * quebrou é uma informação, e saber se ela era forjável desde o início é
	 * outra — quem investiga precisa das duas juntas.
	 */
	const forca = (): Pick<ResultadoIntegridade, 'modoCadeia' | 'encadeamento'> => ({
		modoCadeia:
			nHmac > 0 && nSha > 0 ? 'misto' : nHmac > 0 ? 'hmac' : nSha > 0 ? 'sha256' : 'vazia',
		encadeamento: { hmac: nHmac, sha256: nSha }
	});

	for (const r of rows) {
		const seq = r.seq as number;
		const hashAnterior = r.hash_anterior ?? GENESIS;
		const hashRegistro = r.hash_registro ?? '';
		if (hashRegistro.startsWith('h:')) nHmac++;
		else if (hashRegistro.startsWith('s:')) nSha++;

		// (a) Elo: o hash_anterior deve casar com o hash_registro do antecessor.
		if (!anterior) {
			// PRIMEIRA linha sobrevivente. Duas origens são legítimas, e distinguir
			// uma da outra é exatamente o que faltava (FLW-AUDIT-005):
			//
			//  - o começo da cadeia (`seq 1`, apontando para GENESIS);
			//  - um corte de retenção — e aí tem de existir CHECKPOINT dizendo até
			//    onde o corte foi e qual era o hash da última linha removida.
			//
			// Sem isso, apagar as primeiras N linhas para sumir com um evento
			// deixava o resto da cadeia íntegro e a verificação devolvia `ok`.
			const ehGenesis = seq === 1 && hashAnterior === GENESIS;
			if (!ehGenesis) {
				const ancora = ancoraPorSeq.get(seq - 1);
				if (!ancora) {
					return {
						ok: false,
						verificados: rows.length,
						primeiroProblemaSeq: seq,
						problema:
							`A cadeia começa em seq ${seq} sem checkpoint de retenção para o corte ` +
							`até seq ${seq - 1}. Prefixo removido fora da política de retenção.`,
						...forca()
					};
				}
				if (ancora !== hashAnterior) {
					return {
						ok: false,
						verificados: rows.length,
						primeiroProblemaSeq: seq,
						problema:
							`Checkpoint de retenção em seq ${seq - 1} não casa com o hash_anterior ` +
							`de seq ${seq}: o corte registrado não é o que aconteceu.`,
						...forca()
					};
				}
			}
		}

		if (anterior) {
			if (seq !== anterior.seq + 1) {
				return {
					ok: false,
					verificados: rows.length,
					primeiroProblemaSeq: seq,
					problema: `Buraco na sequência: esperado seq ${anterior.seq + 1}, achei ${seq} (linha removida ou retenção).`,
					...forca()
				};
			}
			if (hashAnterior !== anterior.hash_registro) {
				return {
					ok: false,
					verificados: rows.length,
					primeiroProblemaSeq: seq,
					problema: `Elo quebrado em seq ${seq}: hash_anterior não corresponde ao antecessor.`,
					...forca()
				};
			}
		}

		// (b) Conteúdo: recalcular o hash e comparar (escolhe o algoritmo pela tag).
		const usaHmac = hashRegistro.startsWith('h:');
		if (usaHmac && !chainKey) {
			return {
				ok: false,
				verificados: rows.length,
				primeiroProblemaSeq: seq,
				problema: `Não foi possível verificar seq ${seq}: linha usa HMAC e AUDIT_CHAIN_KEY não está configurada.`,
				...forca()
			};
		}
		const canonical = canonicalAudit({
			seq,
			created_at: r.created_at,
			actor_tipo: r.actor_tipo,
			usuario_id: r.usuario_id,
			usuario_nome: r.usuario_nome,
			usuario_papel: r.usuario_papel,
			acao: r.acao,
			categoria: r.categoria,
			severidade: r.severidade,
			resultado: r.resultado,
			entidade: r.entidade,
			entidade_id: r.entidade_id,
			alvo_tipo: r.alvo_tipo,
			alvo_id: r.alvo_id,
			alvo_nome: r.alvo_nome,
			detalhes: r.detalhes,
			metadados: r.metadados,
			dados_antes: r.dados_antes,
			dados_depois: r.dados_depois,
			ip: r.ip,
			ip_cifrado: r.ip_cifrado,
			user_agent: r.user_agent,
			request_id: r.request_id,
			rota: r.rota,
			metodo: r.metodo,
			hash_anterior: hashAnterior
		});
		const esperado = await calcularHashRegistro(
			hashAnterior,
			canonical,
			usaHmac ? chainKey : undefined
		);
		if (esperado !== hashRegistro) {
			return {
				ok: false,
				verificados: rows.length,
				primeiroProblemaSeq: seq,
				problema: `Conteúdo adulterado em seq ${seq}: hash recalculado diverge do gravado.`,
				...forca()
			};
		}

		anterior = { seq, hash_registro: hashRegistro };
	}

	return {
		ok: true,
		verificados: rows.length,
		ultimoSeq: anterior?.seq,
		ultimoHash: anterior?.hash_registro,
		...forca()
	};
}

/**
 * Eventos críticos recentes (para o painel de destaque do console). Não pagina —
 * é um resumo curto dos sinais de segurança mais relevantes.
 */
export async function eventosCriticosRecentes(
	db: Database,
	limite = 5
): Promise<Pick<AuditLog, 'id' | 'acao' | 'usuario_nome' | 'detalhes' | 'created_at'>[]> {
	return db
		.select({
			id: auditLog.id,
			acao: auditLog.acao,
			usuario_nome: auditLog.usuario_nome,
			detalhes: auditLog.detalhes,
			created_at: auditLog.created_at
		})
		.from(auditLog)
		.where(eq(auditLog.severidade, 'critico'))
		.orderBy(desc(auditLog.created_at), desc(auditLog.id))
		.limit(Math.min(20, Math.max(1, limite)));
}
