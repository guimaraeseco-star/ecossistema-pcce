/**
 * Carimbos de revalidação das telas de ESCALAS — o que `GET /api/sync/estado`
 * devolve para o poll do cliente decidir se precisa refazer o `load`.
 *
 * Um carimbo é uma string que MUDA quando o conjunto de dados daquela tela
 * muda, e só então. Montá-lo tem de ser mais barato que montar o payload
 * completo, senão o endpoint leve não economiza nada — daí serem agregados
 * (`count`, `max`) em vez de listagens.
 *
 * Estava tudo na raiz de `server/`, misturado com os carimbos de GISE, num
 * arquivo criado um dia depois da limpeza que separou os domínios. Nenhuma
 * função cruzava os dois lados: a divisão só tornou visível o que já era
 * verdade.
 */
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '$lib/db';
import {
	escalas,
	escalaDocumentos,
	escalaSolicitacoesAssinatura,
	escalaPoliciais
} from '$lib/server/schema';

/** Contagem + stamp das escalas assinadas na caixa de entrada do Admin Geral. */
export async function resumoRecebidosAdmin(db: Database): Promise<{
	naoVistos: number;
	stamp: string;
}> {
	const [row] = await db
		.select({
			naoVistos: sql<number>`coalesce(sum(case when ${escalas.visto_por_admin} = 0 then 1 else 0 end), 0)`,
			total: sql<number>`count(*)`,
			maxId: sql<number>`coalesce(max(${escalas.id}), 0)`
		})
		.from(escalas)
		.innerJoin(escalaDocumentos, eq(escalaDocumentos.escala_id, escalas.id));

	const naoVistos = Number(row?.naoVistos ?? 0);
	const total = Number(row?.total ?? 0);
	const maxId = Number(row?.maxId ?? 0);
	return { naoVistos, stamp: `${naoVistos}:${total}:${maxId}` };
}

/**
 * Contagem + stamp das solicitações de assinatura visíveis ao DPC admin.
 *
 * `unidadesPermitidas` é o escopo do PAPEL em IDS (`unidadesAdministradas`) —
 * não a lotação atual. Sem lista, admin_unidade não vê nada (SEC-06).
 *
 * Recebe ids desde a E51 parte 2b: o recorte compara `escalas.unidade_id`, que
 * sobrevive a uma renomeação de unidade. Pelo nome, renomear a unidade zerava a
 * contagem de pendências desta caixa até alguém recarregar a tela — e um
 * carimbo que para de mudar não avisa que parou.
 */
export async function resumoEscalasPendentes(
	db: Database,
	usuario: {
		id: number;
		papel?: string | null;
		lotacao?: string | null;
	},
	unidadesPermitidas?: number[]
): Promise<{ pendentes: number; stamp: string }> {
	const baseWhere = sql`${escalaDocumentos.escala_id} IS NULL`;

	let scopeCondition: SQL | undefined;
	if (usuario.papel === 'admin_unidade') {
		if (!unidadesPermitidas?.length) return { pendentes: 0, stamp: '0:0' };
		scopeCondition = and(
			eq(escalaSolicitacoesAssinatura.tipo, 'unidade'),
			inArray(escalas.unidade_id, unidadesPermitidas)
		);
	} else if (usuario.papel === 'admin_seccional' && unidadesPermitidas?.length) {
		scopeCondition = or(
			and(
				eq(escalaSolicitacoesAssinatura.tipo, 'unidade'),
				inArray(escalas.unidade_id, unidadesPermitidas)
			),
			and(
				eq(escalaSolicitacoesAssinatura.tipo, 'respondencia'),
				eq(escalaSolicitacoesAssinatura.destinatario_id, usuario.id)
			)
		);
	} else {
		return { pendentes: 0, stamp: '0:0' };
	}

	const [row] = await db
		.select({
			pendentes: sql<number>`count(*)`,
			maxId: sql<number>`coalesce(max(${escalas.id}), 0)`
		})
		.from(escalas)
		.innerJoin(escalaSolicitacoesAssinatura, eq(escalaSolicitacoesAssinatura.escala_id, escalas.id))
		.leftJoin(escalaDocumentos, eq(escalaDocumentos.escala_id, escalas.id))
		.where(and(baseWhere, scopeCondition));

	const pendentes = Number(row?.pendentes ?? 0);
	const maxId = Number(row?.maxId ?? 0);
	return { pendentes, stamp: `${pendentes}:${maxId}` };
}

/** Mudanças em escalas (criar/assinar/excluir/ver) — suficiente para o compliance. */
export async function carimboPainel(db: Database): Promise<string> {
	const [[esc], [docs]] = await db.batch([
		db
			.select({
				n: sql<number>`count(*)`,
				maxId: sql<number>`coalesce(max(${escalas.id}), 0)`,
				maxCreated: sql<string>`coalesce(max(${escalas.created_at}), '')`,
				vistos: sql<number>`coalesce(sum(${escalas.visto_por_admin}), 0)`,
				finalizadas: sql<number>`coalesce(sum(case when ${escalas.finalizada_em} is not null then 1 else 0 end), 0)`
			})
			.from(escalas),
		db.select({ n: sql<number>`count(*)` }).from(escalaDocumentos)
	]);
	return [
		Number(esc?.n ?? 0),
		Number(esc?.maxId ?? 0),
		esc?.maxCreated ?? '',
		Number(esc?.vistos ?? 0),
		Number(esc?.finalizadas ?? 0),
		Number(docs?.n ?? 0)
	].join(':');
}

/** Detalhe `/escalas/[id]` — servidores, documento e solicitação. */
export async function carimboEscala(db: Database, escalaId: number): Promise<string | null> {
	// Um lote, quatro consultas, UMA ida — ver o comentário de `carimboGise`.
	const [[esc], [pols], [doc], [sol]] = await db.batch([
		db
			.select({
				id: escalas.id,
				finalizada_em: escalas.finalizada_em,
				visto: escalas.visto_por_admin,
				data_inicio: escalas.data_inicio,
				data_fim: escalas.data_fim
			})
			.from(escalas)
			.where(eq(escalas.id, escalaId))
			.limit(1),
		db
			.select({
				n: sql<number>`count(*)`,
				finger: sql<string>`coalesce(group_concat(${escalaPoliciais.policial_id} || ':' || ${escalaPoliciais.data_plantao} || ':' || ${escalaPoliciais.hora_entrada} || '-' || ${escalaPoliciais.hora_saida}), '')`
			})
			.from(escalaPoliciais)
			.where(eq(escalaPoliciais.escala_id, escalaId)),
		db
			.select({ n: sql<number>`count(*)` })
			.from(escalaDocumentos)
			.where(eq(escalaDocumentos.escala_id, escalaId)),
		db
			.select({
				n: sql<number>`count(*)`,
				tipos: sql<string>`coalesce(group_concat(${escalaSolicitacoesAssinatura.tipo}), '')`
			})
			.from(escalaSolicitacoesAssinatura)
			.where(eq(escalaSolicitacoesAssinatura.escala_id, escalaId))
	]);
	if (!esc) return null;

	return [
		esc.finalizada_em ?? '',
		esc.visto,
		esc.data_inicio,
		esc.data_fim,
		Number(pols?.n ?? 0),
		pols?.finger ?? '',
		Number(doc?.n ?? 0),
		Number(sol?.n ?? 0),
		sol?.tipos ?? ''
	].join('|');
}
