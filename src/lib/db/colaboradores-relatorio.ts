/**
 * O relatório diário dos colaboradores (E61, parte b): o que cada colaborador
 * de uma unidade fez num dia, lido da auditoria, e o registro de "já mandei".
 *
 * Decisão do responsável em 21/09/2026: a unidade define o que o terceirizado
 * pode e, no fim do dia (19h de Brasília, todo dia), o admin da unidade recebe
 * por e-mail as ações de cada um. A fonte é o `audit_log`, que já grava
 * `actor_tipo = 'colaborador'` em tudo o que ele faz; este módulo só agrupa
 * por unidade (a lotação do colaborador em `colaboradores.unidade_id`) e
 * traduz a ação pelo catálogo. Quem manda o e-mail é
 * `lib/server/colaboradores/relatorio-diario.ts`.
 *
 * O "dia" é de Brasília, mas `audit_log.created_at` é UTC (`datetime('now')`,
 * sem o `-3 hours` das outras tabelas): o intervalo consultado vai das 03:00
 * UTC do dia às 03:00 UTC do dia seguinte.
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import {
	auditLog,
	colaboradores,
	policiais,
	relatoriosColaboradores,
	unidades
} from '../server/schema';
import { metaDaAcao } from './audit/catalogo';
import type { Database } from './core';

/** Uma ação de um colaborador, já traduzida para o e-mail. */
interface AcaoDeColaborador {
	colaborador_id: number;
	colaborador: string;
	/** Hora de Brasília, `HH:MM`. */
	hora: string;
	/** O rótulo do catálogo da auditoria (ou a chave crua, fora dele). */
	acao: string;
	/** Sobre quem/o quê (nome do servidor, da escala…), quando a trilha guarda. */
	alvo: string | null;
	detalhes: string | null;
}

/** As ações de um dia, agrupadas pela unidade em que o colaborador está lotado. */
export interface AcoesDaUnidadeNoDia {
	unidade_id: number;
	unidade: string;
	acoes: AcaoDeColaborador[];
}

/** O intervalo UTC que cobre o dia de Brasília (UTC−3). */
function intervaloUtcDoDia(diaISO: string): { inicio: string; fim: string } {
	const inicio = new Date(`${diaISO}T03:00:00.000Z`);
	const fim = new Date(inicio.getTime() + 24 * 3600 * 1000);
	const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
	return { inicio: fmt(inicio), fim: fmt(fim) };
}

/** `YYYY-MM-DD HH:MM:SS` UTC → `HH:MM` de Brasília. */
function horaBrasilia(createdAtUtc: string): string {
	const d = new Date(createdAtUtc.replace(' ', 'T') + 'Z');
	if (Number.isNaN(d.getTime())) return '--:--';
	return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
}

/**
 * Tudo o que os colaboradores fizeram no dia, por unidade. Só unidades com ao
 * menos uma ação entram (dia sem ação não gera relatório). Colaborador sem
 * lotação no momento da consulta fica fora — não há a quem mandar.
 */
export async function acoesDeColaboradoresNoDia(
	db: Database,
	diaISO: string
): Promise<AcoesDaUnidadeNoDia[]> {
	const { inicio, fim } = intervaloUtcDoDia(diaISO);
	const linhas = await db
		.select({
			colaborador_id: colaboradores.id,
			colaborador: colaboradores.nome,
			unidade_id: colaboradores.unidade_id,
			unidade: unidades.nome,
			acao: auditLog.acao,
			alvo: auditLog.alvo_nome,
			detalhes: auditLog.detalhes,
			created_at: auditLog.created_at
		})
		.from(auditLog)
		.innerJoin(colaboradores, eq(colaboradores.id, auditLog.usuario_id))
		.innerJoin(unidades, eq(unidades.id, colaboradores.unidade_id))
		.where(
			and(
				eq(auditLog.actor_tipo, 'colaborador'),
				gte(auditLog.created_at, inicio),
				lt(auditLog.created_at, fim)
			)
		)
		.orderBy(colaboradores.nome, auditLog.created_at)
		.all();

	const porUnidade = new Map<number, AcoesDaUnidadeNoDia>();
	for (const l of linhas) {
		if (l.unidade_id == null) continue;
		const grupo = porUnidade.get(l.unidade_id) ?? {
			unidade_id: l.unidade_id,
			unidade: l.unidade,
			acoes: []
		};
		grupo.acoes.push({
			colaborador_id: l.colaborador_id,
			colaborador: l.colaborador,
			hora: horaBrasilia(l.created_at),
			acao: metaDaAcao(l.acao).label,
			alvo: l.alvo ?? null,
			detalhes: l.detalhes ?? null
		});
		porUnidade.set(l.unidade_id, grupo);
	}
	return [...porUnidade.values()].sort((a, b) => a.unidade.localeCompare(b.unidade, 'pt-BR'));
}

/** Os admins de unidade ATIVOS de uma unidade, com o e-mail pessoal (o do 2FA) quando têm. */
export async function adminsDaUnidade(
	db: Database,
	unidadeId: number
): Promise<{ id: number; nome: string; email_pessoal: string | null }[]> {
	return db
		.select({ id: policiais.id, nome: policiais.nome, email_pessoal: policiais.email_pessoal })
		.from(policiais)
		.where(
			and(
				eq(policiais.papel, 'admin_unidade'),
				eq(policiais.papel_unidade_id, unidadeId),
				eq(policiais.ativo, 1)
			)
		)
		.orderBy(policiais.nome)
		.all();
}

/** As unidades cujo relatório deste dia já foi mandado. */
export async function relatoriosJaEnviados(db: Database, diaISO: string): Promise<Set<number>> {
	const linhas = await db
		.select({ unidade_id: relatoriosColaboradores.unidade_id })
		.from(relatoriosColaboradores)
		.where(eq(relatoriosColaboradores.dia, diaISO))
		.all();
	return new Set(linhas.map((l) => l.unidade_id));
}

/**
 * Grava o "já mandei" ANTES do envio. Devolve `false` quando outra execução
 * chegou primeiro (a chave primária decide): quem perde não manda.
 */
export async function reservarRelatorio(
	db: Database,
	unidadeId: number,
	diaISO: string,
	destinatarios: readonly string[],
	acoes: number
): Promise<boolean> {
	const r = await db
		.insert(relatoriosColaboradores)
		.values({ unidade_id: unidadeId, dia: diaISO, destinatarios: destinatarios.join('; '), acoes })
		.onConflictDoNothing()
		.returning({ unidade_id: relatoriosColaboradores.unidade_id });
	return r.length > 0;
}

/** Só para conferência e testes: quantos relatórios de um dia já saíram. */
export async function contarRelatoriosDoDia(db: Database, diaISO: string): Promise<number> {
	const r = await db
		.select({ n: sql<number>`count(*)` })
		.from(relatoriosColaboradores)
		.where(eq(relatoriosColaboradores.dia, diaISO))
		.get();
	return r?.n ?? 0;
}
