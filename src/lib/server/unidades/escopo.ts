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
 * Para a sessão de admin a raiz é o NÓ da conta (`administradores.unidade_id`,
 * E65): não se infere mais da lotação do policial vinculado nem cai no
 * "departamento padrão". Conta admin sem nó não administra unidade nenhuma —
 * é o caso do bootstrap por env depois da E65, que passou a ser só a chave do
 * Super Admin.
 *
 * O CHAPÉU (E71) entra aqui: no de **rede** o escopo é a subárvore inteira do
 * nó; no de **unidade**, só o nó e as suas SUBUNIDADES — posto, núcleo, seção,
 * célula. Seccional e delegacia nunca entram pelo chapéu de unidade, mesmo
 * pendendo do nó: é a diferença entre "o departamento que administra as
 * delegacias" e "o departamento que é uma casa com os seus servidores".
 *
 * Nada aqui é a autorização das outras telas: `/servidores` continua com
 * `lotacoesAdministradas`, escalas com `verificarPermissaoEscala`. Este
 * resolvedor responde só "que unidades este usuário ENXERGA na gestão de
 * unidade" — e, por `trilhaDaUnidade`, "de onde ele olha", para a barra do
 * topo.
 */
import { ancestraisDe, arvoreUnidades, subarvoreDe, type Database, type NoUnidade } from '$lib/db';
import { buscarUnidadePorNome } from '$lib/db/unidades';
import { nivelTipoUnidade, TIPOS_DE_SUBUNIDADE } from '$lib/unidades/tipos';
import {
	colaboradorComAcesso,
	isAdminGeral,
	isAdminSeccional,
	isAdminUnidade,
	type UsuarioLogado
} from '$lib/auth';

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
	const raizId = await idDaRaiz(db, u);
	if (raizId == null) return null;
	const raiz = arvore.get(raizId);
	if (!raiz) return null;
	const nos = subarvoreDe(arvore, raizId);
	return { raiz, arvore, nos: noChapeuDeUnidade(u) ? soACasa(nos, raizId) : nos };
}

/** Esta sessão está atuando como UNIDADE e não como rede (E71)? */
function noChapeuDeUnidade(u: UsuarioLogado | null): boolean {
	return u?.tipo === 'admin' && u.atuandoComo === 'unidade';
}

/**
 * O nó e as suas SUBUNIDADES — a casa, no chapéu de unidade.
 *
 * Corta pelo TIPO e não pela profundidade: o núcleo de Juazeiro pende do
 * departamento e entra; a 1ª Seccional também pende dele e não entra. Uma
 * subunidade de subunidade continua dentro, porque continua sendo a casa.
 */
function soACasa(nos: NoUnidade[], raizId: number): NoUnidade[] {
	const dentro = new Set<number>([raizId]);
	// `subarvoreDe` devolve em largura: o pai sempre vem antes do filho, então
	// uma passada basta para decidir cada nó pelo pai já classificado.
	for (const n of nos) {
		if (n.id === raizId) continue;
		if (
			n.seccional_id != null &&
			dentro.has(n.seccional_id) &&
			(TIPOS_DE_SUBUNIDADE as readonly string[]).includes(n.tipo)
		) {
			dentro.add(n.id);
		}
	}
	return nos.filter((n) => dentro.has(n.id));
}

async function idDaRaiz(db: Database, u: UsuarioLogado): Promise<number | null> {
	if (isAdminSeccional(u) || isAdminUnidade(u)) return u.papel_unidade_id ?? null;
	// Colaborador lotado com acesso (E61): vê a ficha da própria unidade.
	if (colaboradorComAcesso(u)) return u.papel_unidade_id ?? null;
	if (!isAdminGeral(u)) return null;
	// E65: o nó é DADO da conta. Sem nó, a conta admin não administra unidade
	// nenhuma — antes caía no departamento padrão, que é adivinhar.
	return u.unidade_id ?? null;
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
	let id = await idDaRaiz(db, u);
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
