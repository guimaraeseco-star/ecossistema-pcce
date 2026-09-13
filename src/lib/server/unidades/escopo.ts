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
 * unidade" — e, por `trilhaDaUnidade`, "de onde ele olha", para a barra do
 * topo.
 */
import {
	ancestraisDe,
	arvoreUnidades,
	buscarDepartamentoPadrao,
	buscarPolicial,
	departamentoDe,
	subarvoreDe,
	type Database,
	type NoUnidade
} from '$lib/db';
import { buscarUnidadePorNome } from '$lib/db/unidades';
import { nivelTipoUnidade } from '$lib/unidades/tipos';
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

/**
 * A TRILHA da unidade do usuário para a barra do topo — do departamento até
 * a unidade dele, na ordem: `['DPI SUL', '1ª Seccional do Interior Sul',
 * 'Delegacia de Polícia Civil de Aracati']`. O departamento vai pela sigla
 * (é como se fala) e as demais pelo nome; o que está ACIMA do departamento
 * (Delegacia-Geral, órgãos corporativos) fica de fora porque a barra já diz
 * "Polícia Civil do Ceará" antes da trilha.
 *
 * A raiz é a MESMA do escopo (papel, ou departamento para o Admin Geral);
 * para o policial sem papel é a lotação dele. Lista vazia para quem não tem
 * unidade (Super Admin, colaborador, lotação sem cadastro).
 */
export async function trilhaDaUnidade(db: Database, u: UsuarioLogado): Promise<string[]> {
	const arvore = await arvoreUnidades(db);
	let id = await idDaRaiz(db, u, arvore);
	if (id == null && u.tipo === 'policial' && u.lotacao) {
		id = (await buscarUnidadePorNome(db, u.lotacao))?.id ?? null;
	}
	if (id == null || !arvore.get(id)) return [];
	const propria = arvore.get(id) as NoUnidade;
	const cadeia = [...ancestraisDe(arvore, id).reverse(), propria];
	return cadeia
		.filter((n) => nivelTipoUnidade(n.tipo) >= nivelTipoUnidade('departamento'))
		.map((n) => (n.tipo === 'departamento' && n.sigla ? n.sigla : n.nome));
}
