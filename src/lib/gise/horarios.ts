/**
 * Helpers puros para validação e normalização de horários HH:MM.
 * Extraídos de `src/routes/operacoes/gise/[id]/+page.svelte`.
 */

export function normalizarHora(v: string): string | null {
	if (!v) return null;
	return v.replace(/[.,]/g, ':');
}

export function validarHora(v: string): boolean {
	if (!v) return true;
	return /^\d{1,2}:\d{2}$/.test(normalizarHora(v) ?? '');
}

function horaToMin(h: string): number {
	const [hh, mm] = h.split(':').map(Number);
	return hh * 60 + (mm || 0);
}

/**
 * Verifica se dois intervalos de horário se sobrepõem.
 * Lida com turnos que cruzam a meia-noite (ex: 22:00–06:00).
 */
export function seOverlapam(e1: string, s1: string, e2: string, s2: string): boolean {
	const a = horaToMin(e1);
	let b = horaToMin(s1);
	const c = horaToMin(e2);
	let d = horaToMin(s2);
	if (b <= a) b += 1440;
	if (d <= c) d += 1440;
	return (a < d && c < b) || (a < d + 1440 && c + 1440 < b);
}

/**
 * Um nível da CASCATA de horário: escala → seccional → equipe.
 *
 * As três tabelas guardam o par entrada/saída, mas só `gise_escalas` é
 * `NOT NULL`: em `gise_seccionais` e `gise_equipes` a coluna nula já quer dizer
 * "o mesmo de quem está acima". É por isso que a cascata é do banco, e não uma
 * conveniência de tela.
 */
export type NivelHorario = { hora_entrada?: string | null; hora_saida?: string | null };

export interface Horario {
	entrada: string;
	saida: string;
}

/** Vazio conta como AUSENTE: `''` no lugar de `null` não é "horário próprio". */
function preenchido(v: string | null | undefined): v is string {
	return typeof v === 'string' && v.trim() !== '';
}

/**
 * O horário EM VIGOR, resolvendo a cascata do nível mais específico para o mais
 * geral — `horarioEfetivo(equipe, seccional, escala)`.
 *
 * Entrada e saída resolvem SEPARADAMENTE, como sempre foi na tela: equipe que
 * só personalizou a saída continua herdando a entrada de cima.
 *
 * Existe porque essa mesma cascata estava copiada em quatro pontos entre
 * `GiseEquipeCard` e `GiseSeccional` — dois para exibir e dois para preencher o
 * formulário de edição.
 */
export function horarioEfetivo(...niveis: (NivelHorario | null | undefined)[]): Horario {
	const entrada = niveis.find((n) => preenchido(n?.hora_entrada))?.hora_entrada;
	const saida = niveis.find((n) => preenchido(n?.hora_saida))?.hora_saida;
	return { entrada: entrada ?? '', saida: saida ?? '' };
}

/**
 * As duas horas são a MESMA, ainda que escritas diferente.
 *
 * A normalização não é preciosismo: `gise_escalas` nasce com `'08:00'` e a
 * coluna de plantão nasce com `'08'` — a mesma hora em duas grafias, e essa
 * exata diferença já produziu bug neste projeto (ver o catálogo de duplicação
 * no CLAUDE.md). Hora que não casa com `H:MM` cai na comparação textual, que é
 * o mais honesto a fazer com um valor que ninguém sabe interpretar.
 */
export function mesmaHora(a: string, b: string): boolean {
	const ma = emMinutos(a);
	const mb = emMinutos(b);
	if (ma === null || mb === null) return a.trim() === b.trim();
	return ma === mb;
}

/**
 * Minutos desde a meia-noite, ou `null` se o valor não for hora.
 *
 * Aceita a HORA SECA (`'08'`) de propósito — é o default da coluna de plantão, e
 * o ponto todo desta função é fazer `'08'` e `'08:00'` casarem. `validarHora`
 * continua recusando a hora seca, porque lá o assunto é outro: o que a pessoa
 * pode digitar no campo.
 */
function emMinutos(v: string): number | null {
	const n = normalizarHora(v.trim());
	if (n === null) return null;
	if (/^\d{1,2}$/.test(n)) return Number(n) * 60;
	if (!/^\d{1,2}:\d{2}$/.test(n)) return null;
	return horaToMin(n);
}

/**
 * Este nível tem horário PRÓPRIO — ou seja, diferente do que herdaria?
 *
 * Compara VALOR, não preenchimento. Quem salvou 08:00 numa equipe cuja
 * seccional já é 08:00 não personalizou nada, e a tela não deve anunciar que
 * sim — era o que o selo "H. Personalizado" fazia, olhando só se a coluna
 * tinha algo.
 */
export function temHorarioProprio(
	nivel: NivelHorario | null | undefined,
	...acima: (NivelHorario | null | undefined)[]
): boolean {
	const proprio = horarioEfetivo(nivel, ...acima);
	const herdado = horarioEfetivo(...acima);
	return !mesmaHora(proprio.entrada, herdado.entrada) || !mesmaHora(proprio.saida, herdado.saida);
}
