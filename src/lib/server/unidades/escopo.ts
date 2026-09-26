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
 * O **Super Admin** é a exceção: ele não tem nó e enxerga TUDO, como em
 * `lotacoesAdministradas`. Sem isto a E65 o teria trancado para fora da ficha
 * de unidade — quem cuida da estrutura precisa abrir a unidade que está
 * arrumando, e o corporativo (que fica com ele) mora fora de qualquer
 * departamento.
 *
 * O CHAPÉU (E71) entra aqui: no de **rede** o escopo é a subárvore inteira do
 * nó; no de **unidade**, só o nó e as suas SUBUNIDADES — posto, núcleo, seção,
 * célula. Seccional e delegacia nunca entram pelo chapéu de unidade, mesmo
 * pendendo do nó: é a diferença entre "o departamento que administra as
 * delegacias" e "o departamento que é uma casa com os seus servidores".
 *
 * **Desde a E75 esta é a ÚNICA régua de "quem administra o quê".** Até ali
 * havia quatro: esta, as gêmeas `lotacoesAdministradas` e
 * `unidadesAdministradas` (que expandiam a seccional uma volta só e davam ao
 * admin de unidade apenas a própria unidade) e uma cópia nas operações. Quatro
 * respostas para a mesma pergunta é como nasce a divergência entre telas — e
 * ela nasceu: em 25/09 a lista de servidores e a Gestão de unidade discordavam
 * sobre quem a 1ª Seccional alcança. Agora as outras delegam para cá.
 *
 * A regra da E75, decidida por ele em 25/09:
 * - **o posto é administrado pela unidade-mãe SE não tiver direção própria.**
 *   Fortim tem titular registrado: fica pendurada em Aracati, mas Aracati não
 *   a administra. Quixeré e Aiuaba não têm: Russas e Tauá administram. O
 *   critério é a DIREÇÃO REGISTRADA (titular ou respondente vigente), e não
 *   "delegado lotado no posto" — o titular de Fortim está lotado em Aracati;
 * - **quem está acima vê tudo abaixo** ("se enxerga a mãe, enxerga a filha"):
 *   a seccional e o Admin Geral no chapéu de rede ficam com a subárvore
 *   inteira, inclusive o posto que tem chefe próprio;
 * - **o colaborador vê SOMENTE a sua unidade.** A regra dos postos é de
 *   administração, e ele não administra: atua na unidade com as chaves que ela
 *   lhe deu (E61).
 *
 * Por `trilhaDaUnidade`, este módulo responde também "de onde ele olha", para
 * a barra do topo.
 */
import {
	ancestraisDe,
	arvoreUnidades,
	buscarDepartamentoPadrao,
	subarvoreDe,
	type Database,
	type NoUnidade
} from '$lib/db';
import { buscarUnidadePorNome } from '$lib/db/unidades';
import { responsaveisVigentesDe } from '$lib/db/unidades-responsaveis';
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
	if (u.isSuperAdmin) return escopoIrrestrito(db, arvore);
	const raizId = await idDaRaiz(db, u);
	if (raizId == null) return null;
	const raiz = arvore.get(raizId);
	if (!raiz) return null;

	// O colaborador vê SOMENTE a sua unidade (E75) — nem os postos dela.
	if (colaboradorComAcesso(u)) return { raiz, arvore, nos: [raiz] };

	const nos = subarvoreDe(arvore, raizId);
	if (!alcancaSoACasa(u)) return { raiz, arvore, nos };

	// Na casa, o posto com direção própria fica de fora (E75). Só as
	// subunidades são candidatas, e a consulta só acontece quando há alguma —
	// para a maioria das unidades, que não tem posto, ela não roda.
	const candidatas = nos.filter((n) => n.id !== raizId && ehSubunidade(n)).map((n) => n.id);
	const comDirecao =
		candidatas.length > 0
			? new Set((await responsaveisVigentesDe(db, candidatas)).keys())
			: new Set<number>();
	return { raiz, arvore, nos: soACasa(nos, raizId, comDirecao) };
}

const ehSubunidade = (n: NoUnidade) => (TIPOS_DE_SUBUNIDADE as readonly string[]).includes(n.tipo);

/**
 * O escopo do Super Admin: a árvore inteira, inclusive o que está fora de
 * qualquer departamento (o corporativo, as unidades técnicas).
 *
 * A `raiz` continua sendo o departamento padrão porque é dela que a tela tira
 * o título e a trilha; o que vale para "posso abrir esta unidade?" é `nos`.
 */
async function escopoIrrestrito(
	db: Database,
	arvore: Map<number, NoUnidade>
): Promise<EscopoUnidades | null> {
	const padrao = await buscarDepartamentoPadrao(db);
	const raiz = padrao ? arvore.get(padrao.id) : undefined;
	if (!raiz) return null;
	return { raiz, arvore, nos: [...arvore.values()] };
}

/**
 * Esta sessão enxerga só a CASA (o nó e as suas subunidades) ou a subárvore
 * inteira? (E71)
 *
 * Três respostas diferentes, porque são três coisas diferentes:
 *
 * - **admin de seccional** e **sessão admin (Admin Geral)**: depende do
 *   CHAPÉU. Os dois são as duas coisas ao mesmo tempo — uma rede que
 *   administra as unidades abaixo e uma casa com os seus próprios servidores,
 *   que pede diária, lança férias e monta a escala como qualquer outra —, e o
 *   seletor diz qual vale agora;
 * - **admin de unidade**: sempre a casa. Quem administra uma UNIDADE
 *   administra aquela unidade e os postos dela SEM direção própria (E75),
 *   nunca outras unidades penduradas no mesmo nó. Isto passou despercebido
 *   enquanto ninguém era administrador de um departamento; no dia em que ele
 *   se tornou (22/09), o papel de unidade passou a enxergar as 61 unidades do
 *   DPI SUL.
 *
 * O colaborador não passa por aqui: `escopoDeUnidades` o resolve antes, com a
 * unidade dele e nada mais (E75).
 */
function alcancaSoACasa(u: UsuarioLogado | null): boolean {
	if (temChapeu(u)) return u?.atuandoComo === 'unidade';
	return true;
}

/**
 * Esta sessão tem os dois chapéus, e portanto seletor? (E71)
 *
 * Quem administra uma REDE é também uma casa: o Admin Geral do departamento e
 * o admin de seccional. O admin de unidade fica de fora porque não há o que
 * escolher — a casa dele já é todo o alcance que ele tem.
 */
export function temChapeu(u: UsuarioLogado | null): boolean {
	if (isAdminSeccional(u)) return true;
	return isAdminGeral(u) && u?.unidade_id != null;
}

/**
 * O nó e as suas SUBUNIDADES — a casa, no chapéu de unidade.
 *
 * Corta pelo TIPO e não pela profundidade: o núcleo de Juazeiro pende do
 * departamento e entra; a 1ª Seccional também pende dele e não entra. Uma
 * subunidade de subunidade continua dentro, porque continua sendo a casa.
 */
function soACasa(nos: NoUnidade[], raizId: number, comDirecao: ReadonlySet<number>): NoUnidade[] {
	const dentro = new Set<number>([raizId]);
	// `subarvoreDe` devolve em largura: o pai sempre vem antes do filho, então
	// uma passada basta para decidir cada nó pelo pai já classificado.
	for (const n of nos) {
		if (n.id === raizId) continue;
		if (
			n.seccional_id != null &&
			dentro.has(n.seccional_id) &&
			ehSubunidade(n) &&
			// O posto com chefe próprio não é da casa da mãe (E75) — e, como o
			// filho só entra se o pai entrou, o que pende dele também fica fora.
			!comDirecao.has(n.id)
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
