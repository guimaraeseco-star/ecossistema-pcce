/**
 * A **busca por partes** do lado do navegador (E70, E76) — a MESMA regra que
 * o servidor aplica em `buscaPorPartes` (`$lib/db/core`).
 *
 * Quem digita "jua nor 2" acha "2ª Delegacia de Polícia Civil de Juazeiro do
 * Norte": o texto é partido em pedaços, e CADA pedaço tem de aparecer em algum
 * dos textos da opção, em qualquer ordem, ignorando acento e maiúscula.
 *
 * Existe aqui, e não só no SQL, porque as listas de escolha (E76) filtram no
 * navegador enquanto a pessoa digita. Duas regras — uma no servidor, outra na
 * caixa de escolha — seriam duas respostas diferentes para a mesma busca, e o
 * que se acha na lista de servidores não se acharia na lista de unidades.
 * Por isso o servidor usa esta mesma `semAcentos` para o texto digitado.
 */

/** Quantos pedaços de busca valem — o mesmo teto do servidor. */
const MAX_PARTES_DA_BUSCA = 6;

/** Sem acento e em minúscula: "José" → "jose", "Tauá" → "taua". */
export function semAcentos(texto: string): string {
	return texto
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

/** Os pedaços do que foi digitado, já normalizados. Vazio quando não há o que buscar. */
export function partesDaBusca(termo: string): string[] {
	return termo.trim().split(/\s+/).filter(Boolean).slice(0, MAX_PARTES_DA_BUSCA).map(semAcentos);
}

/**
 * Os `textos` casam com o `termo`? Termo vazio casa com tudo — a lista inteira
 * aparece antes de a pessoa digitar.
 */
export function casaPorPartes(textos: string | readonly string[], termo: string): boolean {
	const partes = partesDaBusca(termo);
	if (partes.length === 0) return true;
	const alvos = (typeof textos === 'string' ? [textos] : textos).map(semAcentos);
	return partes.every((parte) => alvos.some((alvo) => alvo.includes(parte)));
}
