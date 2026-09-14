/**
 * Resolve a participação de um policial em uma escala GISE e o horário previsto,
 * replicando a mesma lógica de papéis do `load` de `/operacoes/presenca` (membro de equipe,
 * assessor, SEINT, supervisor DPC). Usado para validar, no SERVIDOR, o vínculo e
 * o horário antes de registrar presença via Token A3 no desktop — o fluxo de tela
 * só checa isso na UI.
 */

import { and, eq, or } from 'drizzle-orm';
import type { Database } from '../core';
import {
	giseEscalas,
	giseMembros,
	giseEquipes,
	giseSeccionais,
	unidades
} from '../../server/schema';

export interface ParticipacaoGise {
	participa: boolean;
	/** Data da escala (YYYY-MM-DD) ou null se não participa. */
	dataInicio: string | null;
	/** Horário previsto (HH:MM) de entrada/saída, com fallback equipe > seccional > escala. */
	horarioPrevisto: { inicio: string; fim: string } | null;
	unidadeNome: string | null;
}

/**
 * Devolve SE o policial participa desta GISE e, se sim, o horário previsto para
 * ele — a autorização de registrar presença.
 *
 * Duas origens de participação, checadas nesta ordem: membro de equipe e, se não
 * for, quadro de supervisão (assessor, SEINT 1/2 ou supervisor DPC, cujo
 * "unidade" é a Supervisão Geral). Um policial não pode ser as duas coisas, mas
 * a ordem importa para o HORÁRIO: o de equipe pode ser mais específico.
 *
 * O horário sai da cadeia de fallback equipe > seccional > escala > `'08:00'`:
 * cada nível pode sobrescrever o de cima, e o literal final cobre a escala
 * gravada sem horário. Fim de linha `'16:00'`.
 *
 * `participa: false` é a resposta para "não escalado" e para "GISE inexistente"
 * indistintamente — os dois negam presença.
 */
export async function resolverParticipacaoGisePolicial(
	db: Database,
	giseId: number,
	policialId: number
): Promise<ParticipacaoGise> {
	// 1. Membro de equipe (prioridade de horário: equipe > seccional > escala).
	const eqRow = await db
		.select({
			data_inicio: giseEscalas.data_inicio,
			esc_he: giseEscalas.hora_entrada,
			esc_hs: giseEscalas.hora_saida,
			sec_he: giseSeccionais.hora_entrada,
			sec_hs: giseSeccionais.hora_saida,
			eq_he: giseEquipes.hora_entrada,
			eq_hs: giseEquipes.hora_saida,
			unidade: unidades.nome
		})
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
		.where(and(eq(giseMembros.policial_id, policialId), eq(giseEscalas.id, giseId)))
		.get();

	if (eqRow) {
		return {
			participa: true,
			dataInicio: eqRow.data_inicio,
			horarioPrevisto: {
				// Mesma precedência equipe → seccional → escala de
				// `horaEfetivaGiseMembro` (`server/escalas/conflict.ts`), que documenta
				// os quatro sítios da família e por que o alias diferente em cada
				// consulta esconde uns dos outros.
				//
				// O `?? '08:00'` / `?? '16:00'` final é INALCANÇÁVEL:
				// `gise_escalas.hora_entrada` e `hora_saida` são `NOT NULL DEFAULT`,
				// então `esc_he`/`esc_hs` nunca chegam nulos aqui. Fica como cinto de
				// segurança do tipo — se aquelas colunas virarem nullable um dia, este
				// módulo continua devolvendo horário e os outros três passam a
				// devolver `null`, que é a divergência a procurar.
				inicio: eqRow.eq_he ?? eqRow.sec_he ?? eqRow.esc_he ?? '08:00',
				fim: eqRow.eq_hs ?? eqRow.sec_hs ?? eqRow.esc_hs ?? '16:00'
			},
			unidadeNome: eqRow.unidade
		};
	}

	// 2. Assessor / SEINT / Supervisor DPC (horário direto da escala).
	const escRow = await db
		.select({
			data_inicio: giseEscalas.data_inicio,
			he: giseEscalas.hora_entrada,
			hs: giseEscalas.hora_saida
		})
		.from(giseEscalas)
		.where(
			and(
				eq(giseEscalas.id, giseId),
				or(
					eq(giseEscalas.assessor_id, policialId),
					eq(giseEscalas.seint1_id, policialId),
					eq(giseEscalas.seint2_id, policialId),
					eq(giseEscalas.supervisor_id, policialId)
				)
			)
		)
		.get();

	if (escRow) {
		return {
			participa: true,
			dataInicio: escRow.data_inicio,
			horarioPrevisto: { inicio: escRow.he ?? '08:00', fim: escRow.hs ?? '16:00' },
			unidadeNome: 'Supervisão Geral'
		};
	}

	return { participa: false, dataInicio: null, horarioPrevisto: null, unidadeNome: null };
}

/**
 * `true` se o instante atual já atingiu `hora` (HH:MM) do dia `dataInicio`
 * (fuso de Brasília, -03:00). Comparação absoluta — independe do fuso do servidor.
 */
export function horarioGiseLiberado(dataInicio: string, hora: string): boolean {
	const [h, m] = hora.split(':');
	const alvo = new Date(`${dataInicio}T${(h ?? '08').padStart(2, '0')}:${m ?? '00'}:00-03:00`);
	if (isNaN(alvo.getTime())) return true; // dado inválido → não bloqueia (paridade com a UI)
	return Date.now() >= alvo.getTime();
}
