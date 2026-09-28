/**
 * As opções de uma caixa de escolha de DESIGNAÇÃO (a função exercida:
 * "Delegado Titular", "Plantão"…), no formato do `SearchableSelect` (E76).
 *
 * O símbolo ("DAS-1") vai como `detalhe` — embaixo do nome, como na tabela de
 * servidores, e pesquisável: "das-1" acha quem tem esse símbolo. O valor é o
 * id em TEXTO, que é o que as telas e o `FormData` trafegam.
 */
export function opcoesDesignacao(
	designacoes: readonly { id: number; nome: string; simbolo?: string | null }[]
): { value: string; label: string; detalhe?: string }[] {
	return designacoes.map((d) => ({
		value: String(d.id),
		label: d.nome,
		...(d.simbolo ? { detalhe: d.simbolo } : {})
	}));
}
