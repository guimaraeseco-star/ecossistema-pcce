/**
 * "Designar como titular" no mesmo ato (E66, 22/09/2026).
 *
 * Lotar um delegado numa delegacia sem titular eram dois atos: a movimentação
 * (ou o cadastro), na ficha do servidor, e o registro da direção, na ficha da
 * unidade. Ninguém lembrava do segundo — em 22/09 havia 15 unidades ativas sem
 * direção vigente. Este helper faz o segundo passo junto do primeiro, com as
 * MESMAS regras da tela da direção (só DPC, uma vigente por unidade, NUP), e
 * recusa em vez de adivinhar: unidade que já tem titular não é substituída por
 * um atalho — trocar titular é ato da ficha da unidade, com sucessão.
 */
import { buscarUnidadePorNome } from '$lib/db/unidades';
import { registrarResponsavel, responsavelVigente } from '$lib/db/unidades-responsaveis';
import type { Database } from '$lib/db';

export type RecusaDoAtalho =
	'unidade_desconhecida' | 'ja_tem_titular' | 'nao_e_delegado' | 'sem_nup' | 'falhou';

const MOTIVO: Record<RecusaDoAtalho, string> = {
	unidade_desconhecida: 'A unidade escolhida não está cadastrada.',
	ja_tem_titular:
		'Esta unidade já tem direção vigente — troque pela ficha da unidade, para a sucessão ficar registrada.',
	nao_e_delegado: 'Só delegado (DPC) dirige unidade.',
	sem_nup: 'Informe o NUP do processo que pede a designação.',
	falhou: 'Não foi possível registrar a direção.'
};

/** A mensagem que a tela mostra quando o atalho recusa. */
export function mensagemDoAtalho(motivo: RecusaDoAtalho): string {
	return MOTIVO[motivo];
}

export async function designarTitularNoAto(
	db: Database,
	dados: {
		/** A unidade pelo NOME, que é como lotação e movimentação a nomeiam hoje (E51 migra para id). */
		unidadeNome: string;
		policialId: number;
		cargo: string;
		dataInicio: string;
		nup: string;
		quem: { id: number; nome: string };
	}
): Promise<{ ok: true; unidadeId: number } | { ok: false; motivo: RecusaDoAtalho }> {
	if (dados.cargo !== 'DPC') return { ok: false, motivo: 'nao_e_delegado' };
	if (!dados.nup.trim()) return { ok: false, motivo: 'sem_nup' };

	const unidade = await buscarUnidadePorNome(db, dados.unidadeNome);
	if (!unidade) return { ok: false, motivo: 'unidade_desconhecida' };
	if (await responsavelVigente(db, unidade.id)) return { ok: false, motivo: 'ja_tem_titular' };

	const r = await registrarResponsavel(db, {
		unidade_id: unidade.id,
		policial_id: dados.policialId,
		papel: 'titular',
		data_inicio: dados.dataInicio,
		nup: dados.nup.trim(),
		registrado_por_id: dados.quem.id,
		registrado_por_nome: dados.quem.nome
	});
	if (!r.ok) {
		return { ok: false, motivo: r.motivo === 'nao_e_delegado' ? 'nao_e_delegado' : 'falhou' };
	}
	return { ok: true, unidadeId: unidade.id };
}
