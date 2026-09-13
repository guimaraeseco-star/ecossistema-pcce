/**
 * O departamento que o plano operacional representa, resolvido do banco — a
 * sigla que vai no cabeçalho e no item 5, e os cargos que o signatário pode
 * ter.
 *
 * Até set/2026 isso eram literais em `$lib/planos/padroes` ("DPI SUL" e três
 * cargos). Passou a vir de `unidades` porque o departamento é dado, não
 * constante (plano do módulo de diárias, decisão 17): é o que deixa o mesmo
 * código emitir documento em nome de outro departamento sem edição.
 *
 * Um lugar só, consumido pela criação (`novo`) e pelo editor (`[id]`) — as duas
 * rotas e as suas actions precisam da MESMA lista, senão o `<select>` de uma
 * aceita o que a régua da outra recusa.
 */
import {
	arvoreUnidades,
	buscarDepartamentoPadrao,
	departamentoDe,
	type Departamento
} from '$lib/db';
import type { Database } from '$lib/db';
import { cargosSignatario } from '$lib/planos/padroes';

export type DepartamentoDoPlano = {
	departamento: Departamento | null;
	/** Forma curta para o cabeçalho e o item 5; vazia se não há departamento. */
	sigla: string;
	/** Os cargos aceitos para o signatário, com o órgão por extenso. */
	cargos: readonly string[];
};

/**
 * Resolve o departamento e deriva sigla e cargos.
 *
 * Com a unidade DEMANDANTE do plano, o departamento é o dela na árvore
 * (`departamentoDe`, decisão E24) — é o que faz um plano de outro departamento
 * sair com a sigla e os cargos certos quando a árvore tiver mais de um. Sem
 * unidade (plano ainda sem demandante, ou demandante fora de qualquer
 * departamento), cai no departamento padrão — o único ativo hoje.
 */
export async function departamentoDoPlano(
	db: Database,
	demandanteUnidadeId?: number | null
): Promise<DepartamentoDoPlano> {
	const daArvore =
		demandanteUnidadeId != null
			? departamentoDe(await arvoreUnidades(db), demandanteUnidadeId)
			: null;
	const departamento = daArvore ?? (await buscarDepartamentoPadrao(db));
	return {
		departamento,
		sigla: departamento?.sigla ?? '',
		cargos: cargosSignatario(departamento?.nome ?? '')
	};
}
