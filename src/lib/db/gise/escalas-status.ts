/**
 * A MÁQUINA DE ESTADOS da GISE: quem decide quando ela avança de status.
 * `escalas-crud` grava o campo; aqui mora a condição que autoriza a gravação.
 *
 * O ciclo tem oito estados, e é a metade final que se decide aqui:
 *
 *   em_definicao_supervisor → em_preenchimento → aguardando_assinatura
 *     → em_andamento → aguardando_relatorios → aguardando_assinatura_relat
 *     → pronta_para_finalizar → finalizada
 *
 * As transições são derivadas de FATOS, nunca de um clique: todas as seccionais
 * enviaram (`verificarGiseCompleta`), todos confirmaram entrada, todos
 * confirmaram saída (`sincronizarStatusGiseAposPresencaRelatorios`), documento e
 * relatórios assinados (`tentarPromoverGiseProntaParaFinalizar`). Por isso as
 * funções recalculam do banco em vez de receber o próximo estado — e por isso
 * são idempotentes: chamar duas vezes não pula etapa, e cada uma sai cedo se o
 * status atual não for um dos que ela sabe mover.
 *
 * Duas armadilhas conhecidas nas condições:
 *   - `retificada` conta como PENDENTE. É a seccional que a supervisão devolveu
 *     para correção; tratá-la como enviada libera a GISE com um formulário que
 *     a própria supervisão recusou.
 *   - GISE SEM seccional nenhuma satisfaz "todas enviaram" por vacuidade.
 *     `verificarGiseCompleta` devolve `true` nesse caso; quem usa isso como
 *     portão precisa checar `totalSeccionais > 0` antes.
 */
import { eq, and, or, sql, inArray } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	gisePresencas,
	giseDocumentos,
	giseAssinaturasRelatorios
} from '../../server/schema';
import type { Database } from '../core';
import { buscarGiseEscala, atualizarGiseEscala } from './escalas-crud';
import { buscarUnidadeIdSupervisaoExtra } from '../../server/gise/supervisao-extra';
import { quadroSupervisaoExtraExigeRelatorio } from '../../gise/supervisao-extra';

/**
 * Todas as seccionais já enviaram sua composição? É a condição para a GISE sair
 * do preenchimento e ir para assinatura.
 *
 * "Não preenchida" são os status `pendente` e `retificada` — o segundo é a
 * seccional que a supervisão DEVOLVEU para correção, e por isso volta a contar
 * como pendência mesmo já tendo sido enviada uma vez.
 *
 * GISE sem nenhuma seccional devolve `true` (nada pendente). Quem depende disso
 * como gate deve checar `totalSeccionais > 0` antes, ou uma escala vazia passa
 * por completa.
 */
export async function verificarGiseCompleta(db: Database, giseId: number): Promise<boolean> {
	const naoPreenchidas = await db
		.select({ id: giseSeccionais.id })
		.from(giseSeccionais)
		.where(
			and(
				eq(giseSeccionais.gise_id, giseId),
				or(eq(giseSeccionais.status, 'pendente'), eq(giseSeccionais.status, 'retificada'))
			)
		);
	return naoPreenchidas.length === 0;
}

/**
 * A coluna de presença que a contagem observa: entrada ou saída.
 *
 * As três condições abaixo perguntam a MESMA coisa — "todo mundo já marcou?" —
 * variando só qual das duas marcas conta e se o recorte é a GISE inteira ou uma
 * seccional. É a máquina de estados: se uma das cópias divergir, a GISE avança
 * (ou trava) com meia escala presente.
 */
type MarcaPresenca = AnySQLiteColumn;

/** IDs distintos do quadro de supervisão (supervisor, assessor, SEINT 1 e 2). */
async function idsSupervisao(db: Database, giseId: number): Promise<number[]> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (!gise) return [];
	return [
		...new Set(
			[gise.supervisor_id, gise.assessor_id, gise.seint1_id, gise.seint2_id].filter(
				(id): id is number => id != null
			)
		)
	];
}

/**
 * Quantos membros de equipe existem e quantos já marcaram — opcionalmente
 * restrito a uma seccional.
 *
 * `leftJoin` com a presença é o que permite contar numa query só: `count(*)`
 * conta os membros e `count(coluna)` ignora os NULL, isto é, quem não marcou.
 */
async function contarMembros(
	db: Database,
	giseId: number,
	marca: MarcaPresenca,
	seccionalId?: number
): Promise<{ total: number; comMarca: number }> {
	const escopo = seccionalId
		? and(eq(giseSeccionais.gise_id, giseId), eq(giseSeccionais.seccional_id, seccionalId))
		: eq(giseSeccionais.gise_id, giseId);

	const r = await db
		.select({ total: sql<number>`count(*)`, comMarca: sql<number>`count(${marca})` })
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.leftJoin(
			gisePresencas,
			and(eq(gisePresencas.gise_id, giseId), eq(gisePresencas.policial_id, giseMembros.policial_id))
		)
		.where(escopo)
		.get();

	return { total: r?.total ?? 0, comMarca: r?.comMarca ?? 0 };
}

/**
 * Idem para o quadro de supervisão, que não pertence a equipe nenhuma.
 *
 * `total` é a quantidade de supervisores, não a de linhas de presença: quem
 * nunca marcou não tem linha, e contar linhas daria "todos presentes" para uma
 * supervisão que não apareceu.
 */
async function contarSupervisao(
	db: Database,
	giseId: number,
	marca: MarcaPresenca
): Promise<{ total: number; comMarca: number }> {
	const supIds = await idsSupervisao(db, giseId);
	if (supIds.length === 0) return { total: 0, comMarca: 0 };

	const r = await db
		.select({ comMarca: sql<number>`count(${marca})` })
		.from(gisePresencas)
		.where(and(eq(gisePresencas.gise_id, giseId), inArray(gisePresencas.policial_id, supIds)))
		.get();

	return { total: supIds.length, comMarca: r?.comMarca ?? 0 };
}

/** Todos — membros de equipe E quadro de supervisão — já marcaram `marca`? */
async function todosMarcaram(db: Database, giseId: number, marca: MarcaPresenca): Promise<boolean> {
	const membros = await contarMembros(db, giseId, marca);
	const supervisao = await contarSupervisao(db, giseId, marca);
	const total = membros.total + supervisao.total;
	// GISE sem ninguém escalado não conta como "todos presentes".
	if (total === 0) return false;
	return membros.comMarca + supervisao.comMarca >= total;
}

/** Todos os escalados + supervisão confirmaram ENTRADA? */
async function verificarTodosEntraram(db: Database, giseId: number): Promise<boolean> {
	return todosMarcaram(db, giseId, gisePresencas.entrada_timestamp);
}

/** Todos os escalados + supervisão confirmaram SAÍDA? */
async function verificarTodosSairam(db: Database, giseId: number): Promise<boolean> {
	return todosMarcaram(db, giseId, gisePresencas.saida_timestamp);
}

/**
 * Verifica se TODOS os participantes de uma seccional (ou do quadro de supervisão,
 * quando `isSupervisaoExtra`) confirmaram a SAÍDA. O relatório de serviço
 * extraordinário só pode ser assinado quando há saída confirmada de todos os
 * participantes daquele relatório.
 *
 * `isSupervisaoExtra` é passado pelo chamador (que já resolve via
 * `secIdEhSupervisaoExtra`) para evitar dependência circular.
 */
export async function verificarSaidaCompletaSeccional(
	db: Database,
	giseId: number,
	seccionalId: number,
	isSupervisaoExtra: boolean
): Promise<boolean> {
	const { total, comMarca } = isSupervisaoExtra
		? await contarSupervisao(db, giseId, gisePresencas.saida_timestamp)
		: await contarMembros(db, giseId, gisePresencas.saida_timestamp, seccionalId);

	return total > 0 && comMarca >= total;
}

/**
 * Transições após presença (entrada/saída) em `/operacoes/presenca`:
 *   • `em_andamento` → `aguardando_relatorios` quando **todos confirmaram entrada**;
 *   • `aguardando_relatorios` → `aguardando_assinatura_relat` quando **todos confirmaram saída**;
 *   • `em_andamento` → `aguardando_assinatura_relat` se entrada e saída já estão completas de uma vez.
 *
 * `pronta_para_finalizar` não depende mais de relatórios de produtividade; é tratada em
 * {@link tentarPromoverGiseProntaParaFinalizar} (documento GISE assinado + relatórios de extra assinados).
 */
export async function sincronizarStatusGiseAposPresencaRelatorios(
	db: Database,
	giseId: number
): Promise<void> {
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return;
	if (
		!['em_andamento', 'aguardando_relatorios', 'aguardando_assinatura_relat'].includes(gise.status)
	)
		return;

	const [todosEntraram, todosSairam] = await Promise.all([
		verificarTodosEntraram(db, giseId),
		verificarTodosSairam(db, giseId)
	]);

	let next = gise.status;

	if (gise.status === 'em_andamento') {
		if (todosEntraram && todosSairam) next = 'aguardando_assinatura_relat';
		else if (todosEntraram) next = 'aguardando_relatorios';
	} else if (gise.status === 'aguardando_relatorios') {
		if (todosSairam) next = 'aguardando_assinatura_relat';
	}

	if (next !== gise.status) {
		await atualizarGiseEscala(db, giseId, { status: next });
	}

	await tentarPromoverGiseProntaParaFinalizar(db, giseId);
}

/**
 * Promove para `pronta_para_finalizar` quando a escala GISE já tem documento assinado
 * e todos os relatórios de extra estão assinados (enquanto em `aguardando_assinatura_relat`).
 */
export async function tentarPromoverGiseProntaParaFinalizar(
	db: Database,
	giseId: number
): Promise<void> {
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise || gise.status !== 'aguardando_assinatura_relat') return;

	const doc = await db
		.select({ id: giseDocumentos.id })
		.from(giseDocumentos)
		.where(eq(giseDocumentos.gise_id, giseId))
		.get();
	if (!doc) return;

	const extrasOk = await verificarTodosRelatoriosExtraAssinados(db, giseId);
	if (!extrasOk) return;

	await atualizarGiseEscala(db, giseId, { status: 'pronta_para_finalizar' });
}

/**
 * Verifica se todos os relatórios de extra estão assinados (uma por seccional
 * da GISE +, quando houver quadro de supervisão, um relatório adicional do quadro).
 */
async function verificarTodosRelatoriosExtraAssinados(
	db: Database,
	giseId: number
): Promise<boolean> {
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return false;

	const secResult = await db
		.select({
			total: sql<number>`count(*)`,
			assinadas: sql<number>`count(${giseAssinaturasRelatorios.id})`
		})
		.from(giseSeccionais)
		.leftJoin(
			giseAssinaturasRelatorios,
			and(
				eq(giseAssinaturasRelatorios.gise_id, giseId),
				eq(giseAssinaturasRelatorios.seccional_id, giseSeccionais.seccional_id),
				eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
			)
		)
		.where(eq(giseSeccionais.gise_id, giseId))
		.get();

	const secTotal = secResult?.total ?? 0;
	const secAss = secResult?.assinadas ?? 0;

	const supUid = await buscarUnidadeIdSupervisaoExtra(db);
	const precisaSup = quadroSupervisaoExtraExigeRelatorio(gise);

	let supNeed = 0;
	let supOk = 0;
	if (precisaSup && supUid != null) {
		supNeed = 1;
		const row = await db
			.select({ id: giseAssinaturasRelatorios.id })
			.from(giseAssinaturasRelatorios)
			.where(
				and(
					eq(giseAssinaturasRelatorios.gise_id, giseId),
					eq(giseAssinaturasRelatorios.seccional_id, supUid),
					eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
				)
			)
			.get();
		supOk = row ? 1 : 0;
	}

	const total = secTotal + supNeed;
	const ok = secAss + supOk;
	if (total === 0) return false;
	return ok >= total;
}
