/**
 * As opções de uma lista de escolha de UNIDADES (E76) — no formato que o
 * `SearchableSelect` recebe.
 *
 * Uma função só para as listas de unidade do sistema inteiro, por duas
 * razões que antes cada tela resolvia (ou esquecia) sozinha:
 * - **O nome da mãe vai como `detalhe`.** Aparece embaixo do nome e entra na
 *   busca: "fortim aracati" acha o posto de Fortim, e duas unidades de nome
 *   parecido se distinguem pela mãe. A mãe é procurada em `maes` (por padrão,
 *   a própria lista): numa lista de seccionais a mãe é o departamento, que não
 *   está na lista — e aí não há detalhe, que seria o mesmo em todas as linhas.
 * - **Unidade técnica não aparece.** `__GISE_SUPERVISAO_EXTRA__` existe no
 *   banco (ativa, como "delegacia", sem mãe) só para reconhecer ids antigos
 *   da GISE; não é lugar onde alguém trabalhe, e estava em toda lista.
 */

/** O mínimo de uma unidade para virar opção. */
interface UnidadeDaLista {
	id: number;
	nome: string;
	seccional_id?: number | null;
}

interface OpcaoDeUnidade {
	value: number | string;
	label: string;
	detalhe?: string;
}

/**
 * Nome de unidade técnica — começa e termina com dois sublinhados, como
 * `__GISE_SUPERVISAO_EXTRA__`. Nenhuma unidade de verdade tem nome assim.
 */
export function ehUnidadeTecnica(nome: string): boolean {
	return /^__.+__$/.test(nome);
}

/**
 * @param valor o que a escolha devolve: o id (o normal) ou o NOME, onde a
 *              tela ainda grava a lotação por texto.
 * @param maes  onde procurar o nome da mãe de cada uma; por padrão, a lista.
 */
export function opcoesDeUnidades(
	unidades: readonly UnidadeDaLista[],
	{
		valor = 'id',
		maes = unidades
	}: { valor?: 'id' | 'nome'; maes?: readonly UnidadeDaLista[] } = {}
): OpcaoDeUnidade[] {
	const nomeDaMae = new Map(maes.map((m) => [m.id, m.nome]));
	return unidades
		.filter((u) => !ehUnidadeTecnica(u.nome))
		.map((u) => {
			const mae = u.seccional_id == null ? undefined : nomeDaMae.get(u.seccional_id);
			return {
				value: valor === 'id' ? u.id : u.nome,
				label: u.nome,
				...(mae ? { detalhe: mae } : {})
			};
		});
}

/** Para as telas que só têm os NOMES das unidades (a lotação por texto). */
export function opcoesDeNomesDeUnidades(nomes: readonly string[]): OpcaoDeUnidade[] {
	return nomes.filter((n) => !ehUnidadeTecnica(n)).map((n) => ({ value: n, label: n }));
}
