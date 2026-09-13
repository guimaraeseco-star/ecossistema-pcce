/**
 * Quem vê cada item da navegação lateral — a regra do menu, fora do `.svelte`.
 *
 * **Nada aqui é gate de segurança.** A sidebar apenas ESCONDE o que o usuário
 * não usa; quem barra é o `load` de cada rota. Somar um item ao menu não dá
 * acesso a nada, e removê-lo não protege nada. O recorte de dados é sempre do
 * servidor.
 *
 * A visibilidade cruza DOIS EIXOS que não se implicam:
 *   - QUEM é (`tipo`/`papel` + os flags de participação na GISE, que vêm do
 *     `+layout.server.ts` porque dependem do banco);
 *   - QUAL MÓDULO o admin está vendo (`adminModulo`: ambas/gise/escalas), que é
 *     preferência de tela DENTRO do que `modulosAdmin` na sessão permite. Quem
 *     tem um módulo só chega aqui já com o cookie/preferência desse módulo
 *     (ver `admin-modulos.ts`); o botão de alternar some nesse caso.
 * Daí `showGrupo1`/`showGrupo2` responderem `true` para não-admin: o filtro de
 * módulo só existe para admin.
 *
 * Vive num `.ts` puro — recebe dados, devolve dados — porque essa regra estava
 * dentro de `+layout.svelte` (1146 ln, o arquivo de maior churn do repositório)
 * e não havia como testá-la. Cada caso descrito acima virou teste em
 * `__tests__/menu-visibilidade.test.ts`; antes eram só comentários, e comentário
 * não reprova mudança errada.
 */
import { ICONE } from '$lib/constants/icones';

/** Só o recorte de `UsuarioLogado` que a navegação consulta. */
interface UsuarioDoMenu {
	tipo?: 'policial' | 'admin' | 'colaborador';
	papel?: 'admin_seccional' | 'admin_unidade' | null;
}

type AdminModulo = 'ambas' | 'gise' | 'escalas';

export interface EntradaVisibilidade {
	usuario: UsuarioDoMenu | null | undefined;
	/** Preferência de tela do admin — não é permissão. */
	adminModulo: AdminModulo;
	/** Supervisor de GISE ativa; vem do banco pelo `+layout.server.ts`. */
	isSupervisorGise: boolean;
	/** Há linha de base a informar? Quem responde é o servidor. */
	temLinhaBasePendente: boolean;
	/** Escala GISE ativa com entrada/saída ainda pendente. */
	temPresencaGisePendente: boolean;
	/** Ao menos uma participação em GISE já encerrada. */
	temGiseHistorico: boolean;
}

export interface FlagsMenu {
	isAdmGeral: boolean;
	showEscalasPoliciais: boolean;
	showGise: boolean;
	showIndicadores: boolean;
	showDadosBase: boolean;
	/** Cadastro dos servidores — Admin Geral e os dois papéis com escopo. */
	showPoliciais: boolean;
	/** Fila de decisão dos pedidos — só quem decide. */
	showSolicitacoes: boolean;
	/**
	 * Cadastro de colaboradores — **só o Admin Geral**, não os papéis com
	 * escopo. Criar identidade de acesso é outra coisa que administrar pessoas
	 * já cadastradas, e por isso esta flag não acompanha `showPoliciais`.
	 */
	showColaboradores: boolean;
	/**
	 * Gestão de unidade (`/unidade`) — Admin Geral e os dois papéis com escopo,
	 * cada um vendo a própria subárvore (decisão E39, itens 3.1–3.3). Quem
	 * recorta é o servidor.
	 */
	showUnidade: boolean;
	temPresencaGiseAtiva: boolean;
	temGiseHistorico: boolean;
	showGrupo1: boolean;
	showGrupo2: boolean;
}

/**
 * Traduz sessão + preferência de módulo nas flags que a sidebar consome.
 *
 * Os pontos que já custaram bug e por isso têm teste:
 *
 * - **`showIndicadores` inclui `admin_unidade`, que `showGise` não cobre.** É
 *   deliberado: são os admins de unidade que informam a linha de base dos
 *   indicadores, e quem alimenta o denominador de uma meta precisa poder ver o
 *   resultado dela. O recorte POR unidade é feito no servidor.
 * - **`showDadosBase` NÃO segue `showIndicadores`.** Só aparece para quem tem
 *   efetivamente base a informar — a pergunta depende de escala e de modelo, e
 *   quem responde é o servidor (`temLinhaBaseAPreencher`). Antes aparecia para
 *   todo admin de unidade, inclusive os de delegacias fora de qualquer operação,
 *   que abriam uma tela vazia sem entender por quê. O Admin Geral não entra:
 *   para ele a conferência é por operação, dentro de `/gise/operacoes`.
 * - **Admin Geral não vê a aba Arquivo** (`showEscalasPoliciais`): ela é dos
 *   dois papéis de unidade.
 * - **`showPoliciais` e `showSolicitacoes` deixaram de andar juntos** (ago/2026).
 *   O cadastro passou a ser visto pelos três papéis administrativos, porque é da
 *   ficha do servidor que o admin de seccional/unidade PEDE a correção de um
 *   dado; a fila de decisão continua só de quem decide — o Admin Geral. Eram uma
 *   condição só (`isAdmGeral`) enquanto pedir e decidir eram o mesmo ato.
 */
export function visibilidadeDoMenu(entrada: EntradaVisibilidade): FlagsMenu {
	const {
		usuario,
		adminModulo,
		isSupervisorGise,
		temLinhaBasePendente,
		temPresencaGisePendente,
		temGiseHistorico
	} = entrada;

	// Admin Geral = sessão de admin (tipo 'admin'): bootstrap por env OU policial
	// promovido (linha vinculada em `administradores`, logado como Administrador).
	const isAdmGeral = usuario?.tipo === 'admin';
	const ehAdmin = usuario?.tipo === 'admin';

	const showGrupo1 = !ehAdmin || adminModulo === 'ambas' || adminModulo === 'escalas';
	const showGrupo2 = !ehAdmin || adminModulo === 'ambas' || adminModulo === 'gise';

	const temPapelComEscopo =
		usuario?.papel === 'admin_seccional' || usuario?.papel === 'admin_unidade';

	return {
		isAdmGeral,
		showEscalasPoliciais: temPapelComEscopo,
		showGise: ehAdmin || usuario?.papel === 'admin_seccional' || isSupervisorGise,
		showIndicadores: ehAdmin || temPapelComEscopo,
		showDadosBase: temLinhaBasePendente,
		showPoliciais: ehAdmin || temPapelComEscopo,
		showSolicitacoes: ehAdmin,
		showColaboradores: ehAdmin,
		showUnidade: ehAdmin || temPapelComEscopo,
		temPresencaGiseAtiva: temPresencaGisePendente,
		temGiseHistorico,
		showGrupo1,
		showGrupo2
	};
}

export interface ItemMenu {
	href: string;
	rotulo: string;
	icone: string[];
	ativo: boolean;
}

/** `pathname === path` ou um filho dele (`path/...`). */
export function rotaAtiva(pathname: string, path: string): boolean {
	return pathname === path || pathname.startsWith(path + '/');
}

/**
 * Os filhos do menu "Escala extra", já filtrados pelo que este usuário vê.
 *
 * Uma fonte só para as três perguntas que a barra faz: o pai aparece (a lista
 * não está vazia), o que o submenu desenha, e se a rota atual pertence a ele.
 *
 * `showGrupo2` entra aqui, e não só no markup, porque a lista também decide o
 * NÍVEL em que a gaveta abre: sem ele, o Admin Geral em módulo "escalas" que
 * caísse em `/produtividade` pela URL abriria o menu já dentro do submenu que a
 * escolha de módulo esconde dele.
 *
 * Recebe a `URL` por parâmetro em vez de ler `$app/state`: é o que mantém a
 * função pura e testável sem subir uma página.
 */
export function itensExtraDoMenu(flags: FlagsMenu, url: URL): ItemMenu[] {
	if (!flags.showGrupo2) return [];

	const rotaPath = url.pathname;

	// Rota da escala extra: lista/escala, excluindo o cadastro de operações, os
	// planos operacionais, as boas-vindas e o arquivo de finalizadas — cada um
	// tem entrada própria, e sem excluir aqui o realce de "Ativas" acenderia
	// junto com o do item certo.
	const giseListaOuEscalaPath =
		rotaPath === '/gise' ||
		(rotaPath.startsWith('/gise/') &&
			!rotaPath.startsWith('/gise/operacoes') &&
			!rotaPath.startsWith('/gise/planos') &&
			!rotaPath.startsWith('/gise/bem-vindo') &&
			!rotaPath.startsWith('/gise/finalizadas'));

	// As duas abas de /res-gise dividem a MESMA rota por query string: sem
	// `?status=finalizadas` é a "Presença GISE" (ativas), com ele é o "Histórico
	// GISE". O realce do menu segue essa distinção — por isso o `ativo` vai
	// explícito aos dois itens (o `rotaAtiva` padrão, só por pathname, acenderia
	// os dois ao mesmo tempo). Inclui `/res-gise/relatorio/[giseId]`, cujo link
	// carrega o mesmo `status` de ida e volta.
	const naRotaResGise = rotaPath === '/res-gise' || rotaPath.startsWith('/res-gise/');
	const resGiseHistoricoSelecionado = url.searchParams.get('status') === 'finalizadas';

	const naoEhAdmin = !flags.isAdmGeral;

	const itens: Array<ItemMenu | false> = [
		// "Ativas" é a lista do que está em andamento. O arquivo das encerradas
		// mora na aba Finalizadas — juntar os dois no mesmo rótulo mentia depois
		// que o histórico saiu de `/gise`.
		flags.showGise && {
			href: '/gise',
			rotulo: 'Ativas',
			icone: ICONE.pranchetaLista,
			ativo: giseListaOuEscalaPath
		},
		// Só o Admin Geral via o bloco Histórico em `/gise`; a aba herda esse
		// recorte. Supervisor e seccional continuam sem o arquivo.
		flags.isAdmGeral &&
			flags.showGise && {
				href: '/gise/finalizadas',
				rotulo: 'Finalizadas',
				icone: ICONE.historico,
				ativo: rotaAtiva(rotaPath, '/gise/finalizadas')
			},
		flags.showIndicadores && {
			href: '/produtividade',
			rotulo: 'Produtividade',
			icone: ICONE.barras,
			ativo: rotaAtiva(rotaPath, '/produtividade')
		},
		flags.showDadosBase && {
			href: '/dados-base',
			rotulo: 'Dados base',
			icone: ICONE.checkLista,
			ativo: rotaAtiva(rotaPath, '/dados-base')
		},
		// O Admin Geral não presta serviço: para ele o item /res-gise é o editor
		// "Conf. Form.", tratado à parte no bloco do menu.
		naoEhAdmin &&
			flags.temPresencaGiseAtiva && {
				href: '/res-gise',
				rotulo: 'Minha presença',
				icone: ICONE.documento,
				ativo: naRotaResGise && !resGiseHistoricoSelecionado
			},
		naoEhAdmin &&
			flags.temGiseHistorico && {
				href: '/res-gise?status=finalizadas',
				rotulo: 'Meu histórico',
				icone: ICONE.historico,
				ativo: naRotaResGise && resGiseHistoricoSelecionado
			}
	];

	return itens.filter((x): x is ItemMenu => x !== false);
}
