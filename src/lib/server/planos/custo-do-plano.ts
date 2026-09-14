/**
 * O custo de um plano, montado do banco: equipes, efetivo, versão de valores.
 *
 * ## Existe porque as DUAS saídas do plano têm de concordar
 *
 * O painel do editor (`/operacoes/planos/[id]`) e o PDF (`/api/planos/[id]/download`)
 * precisam exatamente da mesma coisa — as equipes, os membros agrupados, a
 * tabela de valores aplicada e o `custoDoPlano` sobre tudo isso. Enquanto eram
 * duas cópias, nada impedia uma de mudar: bastava alguém acrescentar um campo à
 * entrada do cálculo e atualizar só o `+page.server.ts` para o documento
 * imprimir um total diferente do que o Admin Geral conferiu na tela antes de
 * emitir.
 *
 * É a duplicação que o `CLAUDE.md` cataloga, e aqui ela tinha consequência
 * financeira. O `guard:duplicacao` pegou as duas cópias.
 *
 * ## O que NÃO mora aqui
 *
 * A autorização. Quem chama já passou por `carregarPlanoParaEdicao` e traz o
 * `plano` na mão — esta função não recebe id nem usuário justamente para não
 * parecer um segundo portão. Ver `permissao.ts`.
 */
import {
	listarEquipes,
	listarMembrosDoPlano,
	agruparPorEquipe,
	buscarCustoParametros,
	buscarCustoParametrosVigente,
	valoresDe,
	type Database,
	type MembroDoPlano
} from '$lib/db';
import type { PlanoOperacional, PlanoEquipe, CustoParametros } from '$lib/server/schema';
import { custoDoPlano, VALORES_ZERADOS, type CustoPlano } from '$lib/planos/custo';

/** Tudo o que as duas saídas do plano consomem, de uma leitura só. */
export interface CustoMontado {
	equipes: PlanoEquipe[];
	/** Membros por `equipe_id` — a mesma agregação que a tela e o Anexo I usam. */
	porEquipe: Map<number, MembroDoPlano[]>;
	/** A versão de valores aplicada, ou `null` quando ainda não há tabela nenhuma. */
	parametros: CustoParametros | null;
	custo: CustoPlano;
}

/**
 * Lê equipes e efetivo do plano e calcula o custo com a versão de valores dele.
 *
 * **Qual versão de valores:** a congelada no plano, sempre que existir. A
 * vigente só entra quando o plano nasceu sem tabela nenhuma — nesse caso ele
 * adota a primeira que aparecer, o que é melhor do que ficar preso em zero para
 * sempre. Um plano que já tem versão NUNCA migra para a vigente: é isso que faz
 * o PDF sair com os mesmos números depois de um reajuste.
 *
 * Sem tabela alguma, o cálculo roda com `VALORES_ZERADOS` — o total sai zero e
 * quem chama avisa. Recusar aqui deixaria o editor inacessível justamente para
 * quem precisa montar o plano antes de o Super Admin preencher os valores.
 */
export async function montarCustoDoPlano(
	db: Database,
	plano: PlanoOperacional
): Promise<CustoMontado> {
	const [equipes, membros] = await Promise.all([
		listarEquipes(db, plano.id),
		listarMembrosDoPlano(db, plano.id)
	]);
	const porEquipe = agruparPorEquipe(membros);

	const parametros = plano.custo_parametro_id
		? await buscarCustoParametros(db, plano.custo_parametro_id)
		: await buscarCustoParametrosVigente(db);

	const custo = custoDoPlano(
		equipes.map((e) => ({
			equipe: {
				id: e.id,
				nome: e.nome,
				tipo_custo: e.tipo_custo,
				horas_normais: e.horas_normais,
				horas_plus: e.horas_plus,
				diaria_tipo: e.diaria_tipo,
				diarias_meias: e.diarias_meias
			},
			membros: (porEquipe.get(e.id) ?? []).map((m) => ({
				id: m.id,
				policial_id: m.policial_id,
				nome: m.nome,
				cargo_snapshot: m.cargo_snapshot,
				classe_snapshot: m.classe_snapshot
			}))
		})),
		parametros ? valoresDe(parametros) : VALORES_ZERADOS
	);

	return { equipes, porEquipe, parametros: parametros ?? null, custo };
}

/**
 * A linha de procedência do Anexo II: qual tabela de valores gerou os números.
 *
 * Devolvida pelas duas saídas na mesma forma — sem ela, um total reemitido
 * depois de um reajuste seria indistinguível de um erro de cálculo.
 */
export function versaoDeValores(
	parametros: CustoParametros | null
): { id: number; vigente_desde: string } | null {
	return parametros ? { id: parametros.id, vigente_desde: parametros.vigente_desde } : null;
}
