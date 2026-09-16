/**
 * O nome CURTO de uma unidade, para tabela — "Delegacia de Polícia Civil de
 * Milagres" vira "DP de Milagres" (fase 2-C, pedido do responsável em
 * 16/09/2026 sobre a experiência nas telas).
 *
 * O nome oficial é longo e repete o mesmo prefixo em 51 das 61 unidades: numa
 * coluna secundária ("Atendido por", "Plantão na semana") ele quebra em duas
 * linhas e empurra a tabela inteira para baixo, sem acrescentar nada — o que
 * distingue as linhas é o município, não o "de Polícia Civil".
 *
 * Só encurta o PREFIXO conhecido, nunca o nome do lugar, e o call site mantém
 * o nome completo no `title`. Onde a unidade é o assunto da linha (a coluna
 * "Unidade" da Gestão de unidade, o `<h1>` da ficha) o nome vai por extenso.
 */

const PREFIXOS: Array<[RegExp, string]> = [
	[/^Delegacia de Pol[ií]cia Civil de\s+/i, 'DP de '],
	[/^Delegacia de Pol[ií]cia Civil\s+/i, 'DP '],
	[/^Delegacia Municipal de Pol[ií]cia Civil de\s+/i, 'DMPC de '],
	[/^Delegacia Regional de Pol[ií]cia Civil de\s+/i, 'DRPC de '],
	[/^Unidade de Atendimento de\s+/i, 'UA de '],
	[/^Departamento de Pol[ií]cia do\s+/i, 'Depto. do ']
];

/**
 * @param nome  nome completo da unidade
 * @param sigla sigla cadastrada (departamentos têm; delegacias não) — vence o encurtamento
 */
export function nomeCurtoDeUnidade(nome: string, sigla = ''): string {
	if (sigla.trim()) return sigla.trim();
	const limpo = nome.trim();
	// "1ª Delegacia de Polícia Civil de Juazeiro do Norte" → "1ª DP de Juazeiro do Norte"
	const ordinal = /^(\d+[ªº]?)\s+(.*)$/.exec(limpo);
	const resto = ordinal ? ordinal[2] : limpo;
	for (const [re, curto] of PREFIXOS) {
		if (re.test(resto)) {
			const encurtado = resto.replace(re, curto);
			return ordinal ? `${ordinal[1]} ${encurtado}` : encurtado;
		}
	}
	return limpo;
}
