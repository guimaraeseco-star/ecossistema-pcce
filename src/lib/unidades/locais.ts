/**
 * "Trabalha em" — o local de trabalho, separado da LOTAÇÃO (E66, 22/09/2026).
 *
 * A lotação é o vínculo formal: a delegacia ou o departamento a que o servidor
 * pertence, e é ela que conta no efetivo, na escala e no teto de férias. O
 * LOCAL é onde ele fica: a sede da lotação (o normal) ou uma subunidade dela —
 * um posto de atendimento, um núcleo em outra cidade. Foi o que resolveu o caso
 * dos postos de Fortim, Quixeré e Aiuaba e do núcleo de Juazeiro: eles existem
 * fisicamente e estão na árvore, mas ninguém é lotado ali.
 *
 * Regra única, e é toda a segurança deste módulo: **o local tem de ser a
 * própria unidade de lotação ou um descendente dela**. Sem isso, "trabalha em"
 * viraria uma segunda lotação, com o efetivo contado em dois lugares.
 *
 * Módulo puro (só a árvore em memória), para a tela e o servidor lerem a mesma
 * régua.
 */
import { subarvoreDe, type NoUnidade } from '$lib/db/unidades';

/** Um local possível: a sede (a própria unidade) ou uma subunidade. */
export interface LocalDeTrabalho {
	id: number;
	nome: string;
	/** `true` na própria unidade de lotação — o padrão de quem não tem local. */
	sede: boolean;
}

/**
 * Os locais que uma lotação oferece: ela própria (sede) e tudo abaixo, na
 * ordem em que a tela mostra. Unidade fora da árvore devolve lista vazia — a
 * lotação em texto pode não casar com unidade nenhuma enquanto a E51 não
 * migrar para id.
 */
export function locaisDaUnidade(
	arvore: Map<number, NoUnidade>,
	unidadeId: number | null | undefined
): LocalDeTrabalho[] {
	if (unidadeId == null || !arvore.has(unidadeId)) return [];
	const [sede, ...abaixo] = subarvoreDe(arvore, unidadeId);
	return [
		{ id: sede.id, nome: sede.nome, sede: true },
		...abaixo
			.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
			.map((u) => ({ id: u.id, nome: u.nome, sede: false }))
	];
}

/**
 * O local escolhido vale para esta lotação? `null` (trabalha na sede) sempre
 * vale; o resto tem de estar na subárvore.
 */
export function localValido(
	arvore: Map<number, NoUnidade>,
	unidadeId: number | null | undefined,
	localId: number | null | undefined
): boolean {
	if (localId == null) return true;
	if (unidadeId == null) return false;
	if (localId === unidadeId) return true;
	return subarvoreDe(arvore, unidadeId).some((u) => u.id === localId);
}

/**
 * Como a ficha diz onde a pessoa trabalha. Na sede (ou sem local) não há o que
 * dizer — a lotação já respondeu.
 */
export function rotuloDoLocal(
	lotacao: string,
	local: { id: number; nome: string } | null | undefined
): string | null {
	if (!local || local.nome === lotacao) return null;
	return local.nome;
}
