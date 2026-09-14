/**
 * Recorte da busca detalhada do histórico em `/operacoes/presenca`.
 *
 * A query string é a fonte: o `load` aplica o mesmo recorte no SQL, e a tela
 * só espelha o que já está na URL. Mês civil, ciclo (21→20) e data exata são
 * mutuamente exclusivos — o seletor de período esconde os campos dos outros.
 *
 * `hojeISO` (YYYY-MM-DD) preenche o recorte vazio: o ciclo corrente (21→20),
 * o mês civil ou o próprio dia. O `load` passa `hojeBrasilISO()`; o cliente,
 * `hojeLocalISO()`. Sem essa data, o parse não inventa padrão — serve aos
 * testes do formato cru. O padrão da busca detalhada é o ciclo corrente.
 */
import { dataISOValida } from '$lib/utils/datas';
import { cicloQueContem, getCicloRange } from '$lib/gise/ciclos';
import type { TipoEquipe } from '$lib/gise/tipos-equipe';

export type ModoPeriodoResGise = 'mes' | 'ciclo' | 'data';

export type FiltrosHistoricoResGise = {
	mes: string;
	data: string;
	tipo: TipoEquipe | '';
	periodo: ModoPeriodoResGise;
	ano: number | null;
	ciclo: number | null;
};

/** Prefixo `YYYY-MM` de uma data ISO. */
function mesCivilDe(isoDia: string): string {
	return isoDia.slice(0, 7);
}

function parseAno(raw: string | null): number | null {
	if (!raw || !/^\d{4}$/.test(raw)) return null;
	const n = Number(raw);
	return n >= 2000 && n <= 2100 ? n : null;
}

function parseCiclo(raw: string | null): number | null {
	if (!raw || !/^\d{1,2}$/.test(raw)) return null;
	const n = Number(raw);
	return n >= 1 && n <= 12 ? n : null;
}

function modoPeriodo(periodoRaw: string, data: string, mes: string): ModoPeriodoResGise {
	if (data || periodoRaw === 'data') return 'data';
	if (periodoRaw === 'mes') return 'mes';
	if (periodoRaw === 'ciclo') return 'ciclo';
	if (mes) return 'mes';
	return 'ciclo';
}

/** Interpreta `?mes=&data=&tipo=&periodo=&ano=&ciclo=` da busca detalhada. */
export function parseFiltrosHistoricoResGise(
	params: URLSearchParams,
	hojeISO?: string
): FiltrosHistoricoResGise {
	const mesRaw = params.get('mes') || '';
	const dataRaw = params.get('data') || '';
	const tipoRaw = params.get('tipo') || '';
	const periodoRaw = params.get('periodo') || '';
	let mes = /^\d{4}-\d{2}$/.test(mesRaw) ? mesRaw : '';
	let data = dataISOValida(dataRaw) ?? '';
	let ano = parseAno(params.get('ano'));
	let ciclo = parseCiclo(params.get('ciclo'));
	const tipo: TipoEquipe | '' = tipoRaw === 'operacional' || tipoRaw === 'seint' ? tipoRaw : '';
	const periodo = modoPeriodo(periodoRaw, data, mes);
	if (hojeISO) {
		if (periodo === 'mes' && !mes) mes = mesCivilDe(hojeISO);
		if (periodo === 'data' && !data) data = hojeISO;
		if (periodo === 'ciclo' && (ano == null || ciclo == null)) {
			const corrente = cicloQueContem(hojeISO);
			ano = ano ?? corrente.ano;
			ciclo = ciclo ?? corrente.ciclo;
		}
	}
	if (periodo === 'mes') {
		data = '';
		ano = null;
		ciclo = null;
	} else if (periodo === 'data') {
		mes = '';
		ano = null;
		ciclo = null;
	} else {
		mes = '';
		data = '';
	}
	return { mes, data, tipo, periodo, ano, ciclo };
}

/** Recorte de `data_inicio` que o `load` traduz para SQL. Um modo só. */
export type RecorteIsoDataInicio =
	| { tipo: 'eq'; valor: string }
	| { tipo: 'prefix'; valor: string }
	| { tipo: 'intervalo'; inicio: string; fim: string }
	| { tipo: 'nenhum' };

export function recorteIsoDataInicio(f: FiltrosHistoricoResGise): RecorteIsoDataInicio {
	if (f.periodo === 'data') {
		return f.data ? { tipo: 'eq', valor: f.data } : { tipo: 'nenhum' };
	}
	if (f.periodo === 'ciclo') {
		if (f.ano == null || f.ciclo == null) return { tipo: 'nenhum' };
		const { inicio, fim } = getCicloRange(f.ano, f.ciclo);
		return { tipo: 'intervalo', inicio, fim };
	}
	if (f.mes) return { tipo: 'prefix', valor: f.mes };
	return { tipo: 'nenhum' };
}

/**
 * A linha do policial entra no recorte de tipo? Supervisor e assessor só
 * aparecem em "Todos" — não são equipe operacional nem SEINT.
 */
export function linhaResGisePassaTipo(equipeTipo: string, tipo: TipoEquipe | ''): boolean {
	if (!tipo) return true;
	return equipeTipo === tipo;
}

/** Há recorte além do padrão (ciclo corrente, todos os tipos)? */
export function historicoTemFiltroAlemDoPadrao(
	f: FiltrosHistoricoResGise,
	hojeISO: string
): boolean {
	if (f.tipo || f.periodo === 'data' || f.periodo === 'mes') return true;
	if (f.ano == null || f.ciclo == null) return false;
	const corrente = cicloQueContem(hojeISO);
	return f.ano !== corrente.ano || f.ciclo !== corrente.ciclo;
}
