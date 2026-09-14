/**
 * Rodagem do quadro de supervisão — presença (entrada/saída) e estado do
 * marcador por papel (inclui `falta_relatorio` só para SEINT).
 *
 * Extraído de GiseSupervisao para a designação renderizar `<MarcadorPresenca>`
 * e para o bloco de documentos montar nomes ao listar faltantes de presença.
 */

import { SvelteMap } from 'svelte/reactivity';
import { estadoMarcadorRodagemSupervisao } from '$lib/gise/supervisao-extra';
import type {
	GiseSupervisaoGise,
	PolicialOpcao,
	PresencaGiseLinha
} from './quadro-supervisao-estado.svelte';

/** Estado de entrada/saída do integrante para o `<MarcadorPresenca>`. */
export function presencaDe(
	presencasGise: PresencaGiseLinha[] | null | undefined,
	policialId: number | null | undefined
) {
	const p = (presencasGise ?? []).find((x) => x.policial_id === policialId);
	return {
		entrada: !!p?.entrada_timestamp,
		saida: !!p?.saida_timestamp
	};
}

/** Estado do marcador de rodagem (usa a mesma regra de `estadoMarcadorRodagemSupervisao`). */
export function marcadorRodagem(
	papel: 'supervisor' | 'assessor' | 'seint',
	policialId: number | null | undefined,
	presencasGise: PresencaGiseLinha[] | null | undefined,
	seintRelatorioSet: Set<number>
) {
	return estadoMarcadorRodagemSupervisao(papel, policialId, presencasGise ?? [], seintRelatorioSet);
}

/** Mapa id→nome do quadro (+ fallback da lista de policiais) para faltantes de presença. */
export function montarNomesSupervisao(
	gise: GiseSupervisaoGise,
	policiais: PolicialOpcao[]
): SvelteMap<number, string> {
	const m = new SvelteMap<number, string>();
	if (gise.supervisor_id && gise.supervisor_nome) m.set(gise.supervisor_id, gise.supervisor_nome);
	if (gise.assessor_id && gise.assessor_nome) m.set(gise.assessor_id, gise.assessor_nome);
	if (gise.seint1_id && gise.seint1_nome) m.set(gise.seint1_id, gise.seint1_nome);
	if (gise.seint2_id && gise.seint2_nome) m.set(gise.seint2_id, gise.seint2_nome);
	for (const p of policiais) {
		if (!m.has(p.id)) m.set(p.id, p.nome);
	}
	return m;
}
