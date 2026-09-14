/**
 * Carimbos de revalidação das telas de GISE — o que `GET /api/sync/estado`
 * devolve para o poll do cliente decidir se precisa refazer o `load`.
 *
 * Um carimbo é uma string que MUDA quando o conjunto de dados daquela tela
 * muda, e só então. Montá-lo tem de ser mais barato que montar o payload
 * completo, senão o endpoint leve não economiza nada — daí serem agregados
 * (`count`, `max`) em vez de listagens.
 *
 * Estava tudo na raiz de `server/`, misturado com os carimbos de escalas, num
 * arquivo criado um dia depois da limpeza que separou os domínios. Nenhuma
 * função cruzava os dois lados: a divisão só tornou visível o que já era
 * verdade.
 */
import { eq, or, sql } from 'drizzle-orm';
import type { Database } from '$lib/db';
import {
	giseEscalas,
	gisePresencas,
	giseAssinaturasRelatorios,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	giseDocumentos,
	giseSeccionalUnidades,
	giseRespostasFormulario,
	giseModeloFormulario
} from '$lib/server/schema';

/**
 * Carimbo da tela GISE detalhe. Inclui quadro de supervisão, horários, breve
 * relatório (tamanho), slots e unidades — não só contagens grossas.
 */
export async function carimboGise(db: Database, giseId: number): Promise<string | null> {
	// UMA ida ao banco para as nove consultas. `Promise.all` dispara as nove ao
	// mesmo tempo, mas são nove idas à rede; no D1 o que custa é o número de
	// idas. A linha da escala entra no mesmo lote — checar antes custaria de
	// volta a ida economizada, e as outras oito devolvem vazio para id
	// inexistente. Bônus: `batch` é transação, então o carimbo descreve UM
	// instante do banco, não oito.
	const [[gise], [pres], [rels], [secs], [equipes], [membros], [unidadesSlot], [docs], [resps]] =
		await db.batch([
			db
				.select({
					status: giseEscalas.status,
					data_inicio: giseEscalas.data_inicio,
					hora_entrada: giseEscalas.hora_entrada,
					hora_saida: giseEscalas.hora_saida,
					supervisor_id: giseEscalas.supervisor_id,
					assessor_id: giseEscalas.assessor_id,
					seint1_id: giseEscalas.seint1_id,
					seint2_id: giseEscalas.seint2_id,
					brTitulo: sql<number>`length(coalesce(${giseEscalas.breve_relatorio_titulo}, ''))`,
					brSec: sql<number>`length(coalesce(${giseEscalas.breve_relatorio_texto_seccional}, ''))`,
					brSup: sql<number>`length(coalesce(${giseEscalas.breve_relatorio_texto_supervisao}, ''))`
				})
				.from(giseEscalas)
				.where(eq(giseEscalas.id, giseId))
				.limit(1),
			db
				.select({
					n: sql<number>`count(*)`,
					maxUp: sql<string>`coalesce(max(${gisePresencas.updated_at}), '')`
				})
				.from(gisePresencas)
				.where(eq(gisePresencas.gise_id, giseId)),
			db
				.select({ n: sql<number>`count(*)` })
				.from(giseAssinaturasRelatorios)
				.where(eq(giseAssinaturasRelatorios.gise_id, giseId)),
			db
				.select({
					n: sql<number>`count(*)`,
					finger: sql<string>`coalesce(group_concat(${giseSeccionais.status} || ':' || coalesce(${giseSeccionais.hora_entrada}, '') || '-' || coalesce(${giseSeccionais.hora_saida}, '')), '')`
				})
				.from(giseSeccionais)
				.where(eq(giseSeccionais.gise_id, giseId)),
			db
				.select({
					n: sql<number>`count(*)`,
					slots: sql<number>`coalesce(sum(${giseEquipes.slots_dpc} + ${giseEquipes.slots_oip}), 0)`,
					finger: sql<string>`coalesce(group_concat(coalesce(${giseEquipes.hora_entrada}, '') || '-' || coalesce(${giseEquipes.hora_saida}, '') || ':' || coalesce(${giseEquipes.gise_unidade_id}, 0)), '')`
				})
				.from(giseEquipes)
				.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
				.where(eq(giseSeccionais.gise_id, giseId)),
			db
				.select({ n: sql<number>`count(*)` })
				.from(giseMembros)
				.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
				.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
				.where(eq(giseSeccionais.gise_id, giseId)),
			db
				.select({ n: sql<number>`count(*)` })
				.from(giseSeccionalUnidades)
				.innerJoin(giseSeccionais, eq(giseSeccionalUnidades.gise_seccional_id, giseSeccionais.id))
				.where(eq(giseSeccionais.gise_id, giseId)),
			db
				.select({ n: sql<number>`count(*)` })
				.from(giseDocumentos)
				.where(eq(giseDocumentos.gise_id, giseId)),
			db
				.select({
					n: sql<number>`count(*)`,
					maxUp: sql<string>`coalesce(max(${giseRespostasFormulario.updated_at}), '')`
				})
				.from(giseRespostasFormulario)
				.where(eq(giseRespostasFormulario.gise_id, giseId))
		]);
	if (!gise) return null;

	return [
		gise.status,
		gise.data_inicio,
		gise.hora_entrada,
		gise.hora_saida,
		gise.supervisor_id ?? 0,
		gise.assessor_id ?? 0,
		gise.seint1_id ?? 0,
		gise.seint2_id ?? 0,
		Number(gise.brTitulo ?? 0),
		Number(gise.brSec ?? 0),
		Number(gise.brSup ?? 0),
		Number(pres?.n ?? 0),
		pres?.maxUp ?? '',
		Number(rels?.n ?? 0),
		Number(secs?.n ?? 0),
		secs?.finger ?? '',
		Number(equipes?.n ?? 0),
		Number(equipes?.slots ?? 0),
		equipes?.finger ?? '',
		Number(membros?.n ?? 0),
		Number(unidadesSlot?.n ?? 0),
		Number(docs?.n ?? 0),
		Number(resps?.n ?? 0),
		resps?.maxUp ?? ''
	].join('|');
}

/** Lista `/operacoes/gise` — ativas + histórico resumido. */
export async function carimboGiseList(db: Database): Promise<string> {
	const [[tot], [ativas]] = await db.batch([
		db
			.select({
				n: sql<number>`count(*)`,
				maxId: sql<number>`coalesce(max(${giseEscalas.id}), 0)`
			})
			.from(giseEscalas),
		db
			.select({
				n: sql<number>`count(*)`,
				finger: sql<string>`coalesce(group_concat(${giseEscalas.id} || ':' || ${giseEscalas.status}), '')`
			})
			.from(giseEscalas)
			.where(sql`${giseEscalas.status} != 'finalizada'`)
	]);
	return `${Number(tot?.n ?? 0)}:${Number(tot?.maxId ?? 0)}:${Number(ativas?.n ?? 0)}:${ativas?.finger ?? ''}`;
}

/**
 * Carimbo de `/operacoes/presenca`: presença/relatório do policial, ou modelo (admin).
 */
export async function carimboResGise(db: Database, policialId: number | null): Promise<string> {
	if (policialId == null) {
		const [row] = await db
			.select({
				n: sql<number>`count(*)`,
				maxUp: sql<string>`coalesce(max(${giseModeloFormulario.updated_at}), '')`
			})
			.from(giseModeloFormulario);
		return `admin:${Number(row?.n ?? 0)}:${row?.maxUp ?? ''}`;
	}

	const [[pres], [resp], [membro], [sup]] = await db.batch([
		db
			.select({
				n: sql<number>`count(*)`,
				maxUp: sql<string>`coalesce(max(${gisePresencas.updated_at}), '')`
			})
			.from(gisePresencas)
			.where(eq(gisePresencas.policial_id, policialId)),
		db
			.select({
				n: sql<number>`count(*)`,
				maxUp: sql<string>`coalesce(max(${giseRespostasFormulario.updated_at}), '')`
			})
			.from(giseRespostasFormulario)
			.where(eq(giseRespostasFormulario.policial_id, policialId)),
		db
			.select({
				n: sql<number>`count(*)`,
				statuses: sql<string>`coalesce(group_concat(${giseEscalas.status}), '')`,
				maxId: sql<number>`coalesce(max(${giseEscalas.id}), 0)`
			})
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
			.where(eq(giseMembros.policial_id, policialId)),
		db
			.select({
				n: sql<number>`count(*)`,
				statuses: sql<string>`coalesce(group_concat(${giseEscalas.status}), '')`,
				maxId: sql<number>`coalesce(max(${giseEscalas.id}), 0)`
			})
			.from(giseEscalas)
			.where(
				or(
					eq(giseEscalas.supervisor_id, policialId),
					eq(giseEscalas.assessor_id, policialId),
					eq(giseEscalas.seint1_id, policialId),
					eq(giseEscalas.seint2_id, policialId)
				)
			)
	]);

	return [
		Number(pres?.n ?? 0),
		pres?.maxUp ?? '',
		Number(resp?.n ?? 0),
		resp?.maxUp ?? '',
		Number(membro?.n ?? 0),
		membro?.statuses ?? '',
		Number(membro?.maxId ?? 0),
		Number(sup?.n ?? 0),
		sup?.statuses ?? '',
		Number(sup?.maxId ?? 0)
	].join('|');
}
