/**
 * Recorte do histórico GISE — o mesmo predicado da lista `/operacoes/gise/finalizadas` e do GET de
 * export. Duplicar o filtro foi o que faria o arquivo baixado trazer escalas
 * que a tela tinha escondido.
 *
 * Precedência de tempo: data exata > mês civil > ciclo. Quem chama deve
 * preencher SÓ o recorte ativo (a UI esconde os outros); a ordem aqui é a
 * rede de segurança se mais de um vier preenchido.
 */
import { getCicloRange } from './ciclos';
import type { TipoEquipe } from './tipos-equipe';

export type { TipoEquipe };

export type EscalaHistoricoRecorte = {
	data_inicio: string;
	seccionais?: { id: number; tipos?: string[] }[];
};

export type RecorteHistoricoGise = {
	seccionalId?: number | null;
	tipoEquipe?: TipoEquipe | null;
	mesAno?: string | null;
	data?: string | null;
	anoCiclo?: number | null;
	numeroCiclo?: number | null;
};

function temTipo(sec: { tipos?: string[] }, tipo: TipoEquipe): boolean {
	return (sec.tipos ?? []).includes(tipo);
}

/** A escala entra no recorte? Seccional, tipo de equipe e um período. */
export function escalaPassaRecorteHistorico(
	e: EscalaHistoricoRecorte,
	r: RecorteHistoricoGise
): boolean {
	const secs = e.seccionais ?? [];
	const seccionalId = r.seccionalId ?? null;
	const tipo = r.tipoEquipe ?? null;

	if (seccionalId != null) {
		const sec = secs.find((s) => s.id === seccionalId);
		if (!sec) return false;
		if (tipo && !temTipo(sec, tipo)) return false;
	} else if (tipo && !secs.some((s) => temTipo(s, tipo))) {
		return false;
	}

	const data = String(e.data_inicio);
	if (r.data) {
		return data === r.data;
	}
	if (r.mesAno) {
		return data.startsWith(r.mesAno);
	}
	if (r.anoCiclo != null && r.numeroCiclo != null) {
		const { inicio, fim } = getCicloRange(r.anoCiclo, r.numeroCiclo);
		return data >= inicio && data <= fim;
	}
	return true;
}
