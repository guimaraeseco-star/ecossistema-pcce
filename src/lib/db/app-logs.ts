/**
 * Logs técnicos da aplicação (`app_log`).
 *
 * Persiste os `logger.warn`/`logger.error` capturados por request (buffer no
 * AsyncLocalStorage — ver request-context.ts; flush pós-resposta em
 * hooks.server.ts). Diferente da trilha forense `audit_log` (eventos de negócio,
 * cadeia de hash), esta tabela é operacional: diagnóstico de erros e warnings
 * sem depender do dashboard da Cloudflare/Sentry. Correlaciona com a auditoria
 * e com o `errorId` mostrado ao usuário via `request_id`.
 */

import { desc, eq, and, gte, lte, sql } from 'drizzle-orm';
import { appLog } from '../server/schema';
import type { AppLog } from '../server/schema';
import { timestampSqliteUtc, paginarComContagem, buscaPorPartes, type Database } from './core';

type AppLogLevel = 'warn' | 'error';

export interface NovoAppLog {
	level: AppLogLevel;
	message: string;
	contexto: string | null;
	request_id: string | null;
	usuario_id: string | null;
	rota: string | null;
	created_at: string;
}

// D1 limita ~100 parâmetros por statement; 7 colunas por linha ⇒ lotes de 12
// (84 parâmetros) ficam com folga.
const LOTE_INSERT = 12;

/** Insere um lote de logs técnicos. Lança em falha — o chamador decide engolir. */
export async function registrarAppLogs(db: Database, entradas: NovoAppLog[]): Promise<void> {
	for (let i = 0; i < entradas.length; i += LOTE_INSERT) {
		await db.insert(appLog).values(entradas.slice(i, i + LOTE_INSERT));
	}
}

export interface ListarAppLogsOpts {
	level?: string;
	/** Busca livre em mensagem, contexto e rota. */
	busca?: string;
	request_id?: string;
	/** ISO/`YYYY-MM-DD` inclusivo. */
	de?: string;
	/** ISO/`YYYY-MM-DD` inclusivo. */
	ate?: string;
	page?: number;
	limit?: number;
}

/** Lista logs técnicos com filtros e paginação (mesmo padrão de `listarAuditLog`). */
export async function listarAppLogs(
	db: Database,
	opts?: ListarAppLogsOpts
): Promise<{
	logs: AppLog[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const conditions = [];

	// Filtro vindo de query string: valor fora do domínio não casa nenhuma linha.
	if (opts?.level) conditions.push(eq(appLog.level, opts.level as AppLogLevel));
	if (opts?.request_id) conditions.push(eq(appLog.request_id, opts.request_id));
	if (opts?.de) conditions.push(gte(appLog.created_at, opts.de));
	if (opts?.ate) conditions.push(lte(appLog.created_at, opts.ate));
	if (opts?.busca) {
		const termo = opts.busca;
		conditions.push(buscaPorPartes([appLog.message, appLog.contexto, appLog.rota], termo)!);
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	const page = Math.max(1, opts?.page ?? 1);
	const limit = Math.min(100, Math.max(1, opts?.limit ?? 25));
	const offset = (page - 1) * limit;

	// Query única com window function: evita um segundo count(*).
	const rows = await db
		.select({
			id: appLog.id,
			level: appLog.level,
			message: appLog.message,
			contexto: appLog.contexto,
			request_id: appLog.request_id,
			usuario_id: appLog.usuario_id,
			rota: appLog.rota,
			created_at: appLog.created_at,
			total: sql<number>`count(*) OVER()`
		})
		.from(appLog)
		.where(whereClause)
		.orderBy(desc(appLog.created_at), desc(appLog.id))
		.limit(limit)
		.offset(offset);

	const { itens, ...paginacao } = paginarComContagem(rows, page, limit);
	return { logs: itens, ...paginacao };
}

export interface ResumoAppLogs {
	total: number;
	erros24h: number;
	avisos24h: number;
	ultimoRegistro: string | null;
}

/** KPIs do cabeçalho do console de logs técnicos. */
export async function resumoAppLogs(db: Database): Promise<ResumoAppLogs> {
	const h24 = timestampSqliteUtc(Date.now() - 24 * 3_600_000);

	const [tot, err, avi, ult] = await Promise.all([
		db.select({ n: sql<number>`count(*)` }).from(appLog),
		db
			.select({ n: sql<number>`count(*)` })
			.from(appLog)
			.where(and(eq(appLog.level, 'error'), gte(appLog.created_at, h24))),
		db
			.select({ n: sql<number>`count(*)` })
			.from(appLog)
			.where(and(eq(appLog.level, 'warn'), gte(appLog.created_at, h24))),
		db
			.select({ c: appLog.created_at })
			.from(appLog)
			.orderBy(desc(appLog.created_at), desc(appLog.id))
			.limit(1)
	]);

	return {
		total: tot[0]?.n ?? 0,
		erros24h: err[0]?.n ?? 0,
		avisos24h: avi[0]?.n ?? 0,
		ultimoRegistro: ult[0]?.c ?? null
	};
}
