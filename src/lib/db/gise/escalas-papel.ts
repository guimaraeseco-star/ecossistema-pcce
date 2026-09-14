/**
 * Predicados de "este policial tem papel em GISE ATIVA?" — usados para liberar
 * menus e rotas da GISE a quem não é admin.
 *
 * O papel aqui é TEMPORÁRIO por natureza: vale enquanto a GISE não é finalizada,
 * e é isso que `ne(status, 'finalizada')` implementa em todos eles. Terminado o
 * plantão, o acesso se fecha sozinho — não há revogação a fazer, e é por isso que
 * essas permissões não moram em `policiais.papel`.
 */
import { eq, and, ne, or, isNotNull, isNull } from 'drizzle-orm';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	gisePresencas
} from '../../server/schema';
import type { Database } from '../core';

/** Supervisor (DPC) de alguma GISE não finalizada. */
export async function isSupervisorGiseAtiva(db: Database, policialId: number): Promise<boolean> {
	const result = await db
		.select({ id: giseEscalas.id })
		.from(giseEscalas)
		.where(and(ne(giseEscalas.status, 'finalizada'), eq(giseEscalas.supervisor_id, policialId)))
		.limit(1)
		.get();
	return !!result;
}

/**
 * Escalado como membro de equipe em alguma GISE não finalizada — atravessa
 * membro → equipe → seccional → escala, porque a linha de membro não guarda a
 * qual GISE pertence.
 */
export async function isMembroGiseAtiva(db: Database, policialId: number): Promise<boolean> {
	const result = await db
		.select({ id: giseMembros.id })
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(and(eq(giseMembros.policial_id, policialId), ne(giseEscalas.status, 'finalizada')))
		.get();
	return !!result;
}

/** Assessor ou SEINT do quadro de supervisão em GISE não finalizada (acesso a Res. GISE, etc.). */
export async function isSupervisaoGiseAtiva(db: Database, policialId: number): Promise<boolean> {
	const result = await db
		.select({ id: giseEscalas.id })
		.from(giseEscalas)
		.where(
			and(
				ne(giseEscalas.status, 'finalizada'),
				or(
					eq(giseEscalas.assessor_id, policialId),
					eq(giseEscalas.seint1_id, policialId),
					eq(giseEscalas.seint2_id, policialId)
				)
			)
		)
		.limit(1)
		.get();
	return !!result;
}

/**
 * O policial tem presença PENDENTE em GISE ativa: está escalado (membro,
 * supervisor ou quadro) em alguma GISE não finalizada e ainda não registrou a
 * SAÍDA. É a mesma régua de "ativas" em `/operacoes/presenca` (`isFinished` = saída ou
 * GISE finalizada) — libera a aba "Presença GISE" só enquanto há entrada ou
 * saída a confirmar.
 */
export async function temPresencaGisePendente(db: Database, policialId: number): Promise<boolean> {
	const membroPendente = await db
		.select({ id: giseMembros.id })
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.leftJoin(
			gisePresencas,
			and(eq(gisePresencas.gise_id, giseEscalas.id), eq(gisePresencas.policial_id, policialId))
		)
		.where(
			and(
				eq(giseMembros.policial_id, policialId),
				ne(giseEscalas.status, 'finalizada'),
				isNull(gisePresencas.saida_timestamp)
			)
		)
		.limit(1)
		.get();
	if (membroPendente) return true;

	const quadroPendente = await db
		.select({ id: giseEscalas.id })
		.from(giseEscalas)
		.leftJoin(
			gisePresencas,
			and(eq(gisePresencas.gise_id, giseEscalas.id), eq(gisePresencas.policial_id, policialId))
		)
		.where(
			and(
				ne(giseEscalas.status, 'finalizada'),
				or(
					eq(giseEscalas.supervisor_id, policialId),
					eq(giseEscalas.assessor_id, policialId),
					eq(giseEscalas.seint1_id, policialId),
					eq(giseEscalas.seint2_id, policialId)
				),
				isNull(gisePresencas.saida_timestamp)
			)
		)
		.limit(1)
		.get();
	return !!quadroPendente;
}

/**
 * O policial tem HISTÓRICO GISE — ao menos uma participação já ENCERRADA para
 * ele. É o complemento dos predicados "ativa" acima: enquanto
 * `temPresencaGisePendente` libera a aba "Presença GISE" (serviço em curso),
 * este libera a aba "Histórico GISE".
 *
 * "Encerrada para ele" é a mesma condição que a lista de `/operacoes/presenca` usa para
 * separar ativas de finalizadas (`isFinished`): ou o policial já bateu a SAÍDA
 * (mesmo que a GISE siga aberta para os demais), ou a GISE inteira foi
 * `finalizada`. As três consultas cobrem, nesta ordem: saída registrada
 * (qualquer papel), membro de equipe em GISE finalizada e quadro de supervisão
 * (supervisor/assessor/SEINT) em GISE finalizada. Sai no primeiro `true`.
 */
export async function temGiseHistorico(db: Database, policialId: number): Promise<boolean> {
	const comSaida = await db
		.select({ id: gisePresencas.id })
		.from(gisePresencas)
		.where(and(eq(gisePresencas.policial_id, policialId), isNotNull(gisePresencas.saida_timestamp)))
		.limit(1)
		.get();
	if (comSaida) return true;

	const membroFinalizada = await db
		.select({ id: giseMembros.id })
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(and(eq(giseMembros.policial_id, policialId), eq(giseEscalas.status, 'finalizada')))
		.limit(1)
		.get();
	if (membroFinalizada) return true;

	const quadroFinalizada = await db
		.select({ id: giseEscalas.id })
		.from(giseEscalas)
		.where(
			and(
				eq(giseEscalas.status, 'finalizada'),
				or(
					eq(giseEscalas.supervisor_id, policialId),
					eq(giseEscalas.assessor_id, policialId),
					eq(giseEscalas.seint1_id, policialId),
					eq(giseEscalas.seint2_id, policialId)
				)
			)
		)
		.limit(1)
		.get();
	return !!quadroFinalizada;
}
