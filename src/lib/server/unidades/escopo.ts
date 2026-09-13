/**
 * O ESCOPO de unidades de quem administra — a raiz e a subárvore que a Gestão
 * de unidade (`/unidade`) mostra e que o `load` dela usa para recusar o que
 * está fora (decisão E39, itens 3.1–3.3; E25: um papel "administrador da
 * unidade X" em qualquer nível, escopo = subárvore).
 *
 * A raiz sai do PAPEL, não da lotação — a mesma lição de
 * `lotacoesAdministradas` (FLW-RBAC-003): admin de seccional e de unidade
 * administram `papel_unidade_id`, e papel sem unidade é papel sem alcance.
 *
 * Para a sessão de admin (Admin Geral) a raiz é o DEPARTAMENTO: derivado da
 * lotação do policial VINCULADO à conta quando há um (`adminPolicialId` →
 * `departamentoDe`, E24), senão o departamento padrão — o bootstrap por env
 * não tem policial. Quando o sistema servir mais de um departamento com um
 * Admin Geral por departamento, é aqui que a derivação troca de fonte.
 *
 * Nada aqui é a autorização das outras telas: `/policiais` continua com
 * `lotacoesAdministradas`, escalas com `verificarPermissaoEscala`. Este
 * resolvedor responde só "que unidades este usuário ENXERGA na gestão de
 * unidade".
 */
import {
	arvoreUnidades,
	buscarDepartamentoPadrao,
	buscarPolicial,
	departamentoDe,
	subarvoreDe,
	type Database,
	type NoUnidade
} from '$lib/db';
import { buscarUnidadePorNome } from '$lib/db/unidades';
import { isAdminGeral, isAdminSeccional, isAdminUnidade, type UsuarioLogado } from '$lib/auth';

export interface EscopoUnidades {
	raiz: NoUnidade;
	/** A árvore inteira (ativas), para caminhar — pais fora do escopo inclusive. */
	arvore: Map<number, NoUnidade>;
	/** A raiz e tudo abaixo dela, na ordem de `subarvoreDe` (largura). */
	nos: NoUnidade[];
}

/**
 * O escopo do usuário, ou `null` quando ele não administra unidade nenhuma
 * (policial sem papel, colaborador, papel sem `papel_unidade_id`, admin sem
 * departamento cadastrado).
 */
export async function escopoDeUnidades(
	db: Database,
	u: UsuarioLogado
): Promise<EscopoUnidades | null> {
	const arvore = await arvoreUnidades(db);
	const raizId = await idDaRaiz(db, u, arvore);
	if (raizId == null) return null;
	const raiz = arvore.get(raizId);
	if (!raiz) return null;
	return { raiz, arvore, nos: subarvoreDe(arvore, raizId) };
}

async function idDaRaiz(
	db: Database,
	u: UsuarioLogado,
	arvore: Map<number, NoUnidade>
): Promise<number | null> {
	if (isAdminSeccional(u) || isAdminUnidade(u)) return u.papel_unidade_id ?? null;
	if (!isAdminGeral(u)) return null;

	if (u.adminPolicialId != null) {
		const vinculado = await buscarPolicial(db, u.adminPolicialId);
		const propria = vinculado ? await buscarUnidadePorNome(db, vinculado.lotacao) : null;
		const dep = propria ? departamentoDe(arvore, propria.id) : null;
		if (dep) return dep.id;
	}
	const padrao = await buscarDepartamentoPadrao(db);
	return padrao?.id ?? null;
}

/** A unidade `id` está no escopo? (`nos` é pequena: dezenas de linhas.) */
export function unidadeNoEscopo(escopo: EscopoUnidades, id: number): boolean {
	return escopo.nos.some((n) => n.id === id);
}
