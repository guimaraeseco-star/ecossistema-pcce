/**
 * A HOME DE MÓDULOS — o que cada perfil administrativo vê ao entrar,
 * organizada nos quatro grupos que o responsável definiu em 13/09/2026
 * ("Telas e subtelas", decisão E39): Gestão de pessoal · Gestão operacional ·
 * Gestão de unidade · Gestão administrativa. Em DOIS níveis, como no desenho
 * dele: o Início (`/`) mostra os quatro cartões grandes, cada um com o resumo
 * do que contém; clicar num deles abre a tela do grupo (`/grupo/[id]`), com
 * os cartões detalhados. Um grupo sem cartão para o perfil não aparece.
 *
 * Mesma família de `menu-visibilidade.ts` e `bem-vindo-cards.ts`, e pelo mesmo
 * motivo: a home responde à MESMA pergunta da sidebar — "o que este usuário
 * alcança daqui?" — e por isso sai das MESMAS flags (`visibilidadeDoMenu`).
 * `__tests__/home-modulos.test.ts` reprova destino de menu sem cartão, como o
 * teste de paridade das boas-vindas já fazia; item novo na navegação entra nos
 * TRÊS arquivos.
 *
 * Dois eixos que o arquivo trata de propósito:
 *
 * - **Grupo é organização de tela, não de URL.** Os cartões apontam para as
 *   rotas planas dos módulos (`/servidores`, `/operacoes/gise`, `/unidade`…); quando um
 *   endereço muda (1.4), muda-se o `href` aqui e em lugar nenhum mais.
 * - **Cartão PLANEJADO aparece desligado**, com o rótulo "Em breve", como no
 *   protótipo que originou o Ecossistema: a home mostra a plataforma inteira,
 *   e o que ainda não existe fica visível sem ser clicável. Só entram os que
 *   o perfil alcançará quando existirem (Municípios e Atualização de valores
 *   são de departamento para cima — E32, E39). Protocolo e Ofício NÃO entram:
 *   são futuros sem definição (E41), e cartão sem tela nem plano só polui.
 *
 * A home ignora a preferência `adminModulo` (GISE ↔ Escalas): ela é filtro da
 * SIDEBAR. O que a home respeita é `modulosAdmin` — o que a conta admin tem
 * LIGADO —, via `moduloParaHome`; sem isso um admin só de escalas veria
 * cartões que `adminPodeAcessarRota` recusa com 403.
 */
import { ICONE } from '$lib/constants/icones';
import { visibilidadeDoMenu, type FlagsMenu } from './menu-visibilidade';

/** Só o recorte de `UsuarioLogado` que a home consulta. */
export interface UsuarioDaHome {
	tipo?: 'policial' | 'admin' | 'colaborador';
	papel?: 'admin_seccional' | 'admin_unidade' | null;
	cargo?: string | null;
	isSuperAdmin?: boolean;
	modulosAdmin?: { escalas: boolean; gise: boolean } | null;
}

/** Link secundário dentro de um cartão (ex.: "Solicitações" dentro de Servidores). */
interface AtalhoHome {
	rotulo: string;
	href: string;
}

export interface CartaoHome {
	/** Estável: chave do `{#each}` e âncora dos testes. */
	id: string;
	titulo: string;
	descricao: string;
	icone: string[];
	/** `null` = planejado (cartão desligado, "Em breve"). */
	href: string | null;
	cta: string;
	atalhos: AtalhoHome[];
	/** Fase em que o planejado chega — só para o rótulo do cartão desligado. */
	fase?: number;
}

/** Os quatro grupos — também o segmento da URL da tela de cada um (`/grupo/[id]`). */
const GRUPOS_HOME_IDS = ['pessoal', 'operacional', 'unidade', 'administrativa'] as const;
export type GrupoHomeId = (typeof GRUPOS_HOME_IDS)[number];

export function ehGrupoHomeId(v: string): v is GrupoHomeId {
	return (GRUPOS_HOME_IDS as readonly string[]).includes(v);
}

export interface GrupoHome {
	id: GrupoHomeId;
	titulo: string;
	/** O que o grupo contém, na voz do responsável: "Servidores, Escalas ordinárias, Diárias e etc". */
	descricao: string;
	/** Rota da tela do grupo (os cartões detalhados). */
	href: string;
	cartoes: CartaoHome[];
}

/**
 * O subtítulo do cartão grande do Início: o nome de TODOS os cartões que este
 * usuário tem no grupo — o texto segue o que o perfil alcança, em vez de
 * prometer a um admin de delegacia o que só o departamento vê.
 */
function resumoDe(cartoes: CartaoHome[]): string {
	return cartoes.map((c) => c.titulo).join(', ');
}

export interface EntradaHome {
	usuario: UsuarioDaHome | null | undefined;
	flags: FlagsMenu;
}

/** Quem tem home de módulos: sessão de admin (não Super Admin) e os dois papéis com escopo. */
export function temHomeDeModulos(u: UsuarioDaHome | null | undefined): boolean {
	if (!u || u.isSuperAdmin) return false;
	if (u.tipo === 'admin') return true;
	return u.tipo === 'policial' && (u.papel === 'admin_seccional' || u.papel === 'admin_unidade');
}

/**
 * O "módulo" com que a home monta as flags: para admin, o que a conta tem
 * ligado (os dois → `ambas`); para os demais o valor não importa, porque o
 * filtro de módulo só existe para admin.
 */
export function moduloParaHome(u: UsuarioDaHome | null | undefined): 'ambas' | 'gise' | 'escalas' {
	if (u?.tipo !== 'admin' || !u.modulosAdmin) return 'ambas';
	const { escalas, gise } = u.modulosAdmin;
	if (escalas && gise) return 'ambas';
	if (gise) return 'gise';
	return 'escalas';
}

function planejado(
	id: string,
	titulo: string,
	descricao: string,
	icone: string[],
	fase: number
): CartaoHome {
	return { id, titulo, descricao, icone, href: null, cta: 'Em breve', atalhos: [], fase };
}

/* ── Gestão de pessoal ──────────────────────────────────────────────────── */

/**
 * Servidores — a MESMA tela com poderes diferentes: o Admin Geral gerencia e
 * decide; seccional e unidade veem o escopo deles e PEDEM a correção (a fila
 * de decisão, `/solicitacoes`, entra como atalho só para quem decide).
 */
function cardServidores(flags: FlagsMenu): CartaoHome {
	const atalhos: AtalhoHome[] = flags.showSolicitacoes
		? [{ rotulo: 'Solicitações', href: '/solicitacoes' }]
		: [];
	return {
		id: 'servidores',
		titulo: 'Servidores',
		descricao: flags.isAdmGeral
			? 'Cadastro dos servidores do departamento: ficha, lotação, afastamentos e as solicitações de alteração enviadas pelas unidades.'
			: 'Cadastro dos servidores da sua unidade: consulte a ficha e solicite correção de dados, movimentação, afastamento ou desvinculação.',
		icone: ICONE.pessoas,
		href: '/servidores',
		cta: flags.isAdmGeral ? 'Gerenciar servidores' : 'Ver servidores',
		atalhos
	};
}

/**
 * Escala ordinária e de plantão. Para o Admin Geral a porta é o painel de
 * conformidade (ele não monta escala — acompanha e recebe); para os papéis
 * com escopo é a lista de escalas, com o verbo do cargo (DPC assina, OIP
 * monta e solicita — `server/escalas/permissao.ts`).
 */
function cardEscalas(u: UsuarioDaHome, flags: FlagsMenu): CartaoHome | null {
	if (flags.isAdmGeral) {
		return {
			id: 'escalas',
			titulo: 'Escalas ordinárias',
			descricao:
				'Acompanhe, por delegacia, quais escalas de plantão e expediente já foram enviadas e assinadas, e receba as que chegam.',
			icone: ICONE.calendario,
			href: '/painel',
			cta: 'Abrir painel de conformidade',
			atalhos: [{ rotulo: 'Caixa de entrada', href: '/recebidos' }]
		};
	}
	if (!flags.showEscalasPoliciais) return null;
	const onde = u.papel === 'admin_seccional' ? 'da sua seccional' : 'da sua unidade';
	return {
		id: 'escalas',
		titulo: 'Escalas ordinárias',
		descricao:
			u.cargo === 'DPC'
				? `Confira e assine as escalas de plantão e expediente ${onde}, e acompanhe o que ainda espera assinatura.`
				: `Monte as escalas de plantão e expediente ${onde} e peça ao delegado a assinatura de cada uma.`,
		icone: ICONE.calendario,
		href: '/escalas',
		cta: u.cargo === 'DPC' ? 'Conferir e assinar' : 'Acessar escalas',
		atalhos: []
	};
}

const MEU_PERFIL: CartaoHome = {
	id: 'perfil',
	titulo: 'Meu perfil',
	descricao:
		'Seus dados cadastrais, o seu e-mail pessoal e a chave de assinatura do celular (caso solicitada).',
	icone: ICONE.perfil,
	href: '/perfil',
	cta: 'Abrir meu perfil',
	atalhos: []
};

/* ── Gestão operacional ─────────────────────────────────────────────────── */

/**
 * Escala extra (GISE) e a escala de fim de semana, juntas como o documento
 * pede: a de FDS é um `tipo` da tela de escalas (`/escalas?tipo=fds`) e entra
 * como atalho para quem monta escala.
 */
function cardEscalaExtra(u: UsuarioDaHome, flags: FlagsMenu): CartaoHome | null {
	if (!flags.showGise) return null;
	const atalhos: AtalhoHome[] = [];
	if (flags.isAdmGeral)
		atalhos.push({ rotulo: 'Finalizadas', href: '/operacoes/gise/finalizadas' });
	if (flags.showEscalasPoliciais) {
		atalhos.push({ rotulo: 'Fim de semana', href: '/escalas?tipo=fds' });
	}
	const descricao = flags.isAdmGeral
		? 'Planeje e valide a escalação das equipes em serviço extraordinário e consulte as escalas já encerradas.'
		: u.papel === 'admin_seccional'
			? 'Escale os policiais convocados da sua seccional para as operações extraordinárias e acompanhe as escalas em andamento.'
			: 'Acompanhe a escalação e a execução das escalas extras sob sua supervisão, e assine o que for da sua responsabilidade.';
	return {
		id: 'escala-extra',
		titulo: 'Escala extra',
		descricao,
		icone: ICONE.pranchetaLista,
		href: '/operacoes/gise',
		cta: 'Acessar escalas extras',
		atalhos
	};
}

/** Plano operacional é de departamento para cima; o cadastro de operações vai junto. */
function cardPlanoOperacional(flags: FlagsMenu): CartaoHome | null {
	if (!flags.isAdmGeral || !flags.showGise) return null;
	return {
		id: 'plano-operacional',
		titulo: 'Plano operacional',
		descricao:
			'Crie o plano operacional com equipes, deslocamento e custos, e cadastre as operações extraordinárias.',
		icone: ICONE.documento,
		href: '/operacoes/planos',
		cta: 'Ver planos operacionais',
		atalhos: [{ rotulo: 'Operações', href: '/operacoes/gise/operacoes' }]
	};
}

const PRODUTIVIDADE: CartaoHome = {
	id: 'produtividade',
	titulo: 'Produtividade',
	descricao: 'Indicadores e metas de cada operação, em gráficos que você pode exportar.',
	icone: ICONE.barras,
	href: '/operacoes/produtividade',
	cta: 'Ver produtividade',
	atalhos: []
};

/** Só para quem TEM base a informar — é o cartão mais próximo de uma tarefa. */
const DADOS_BASE: CartaoHome = {
	id: 'dados-base',
	titulo: 'Dados base',
	descricao:
		'Informe os números iniciais da sua unidade: são a base das metas percentuais das operações.',
	icone: ICONE.checkLista,
	href: '/operacoes/dados-base',
	cta: 'Informar dados base',
	atalhos: []
};

const MINHA_PRESENCA: CartaoHome = {
	id: 'minha-presenca',
	titulo: 'Minha presença',
	descricao: 'Confirme sua entrada e saída nas escalas extras em que você foi escalado.',
	icone: ICONE.documento,
	href: '/operacoes/presenca',
	cta: 'Registrar presença',
	atalhos: []
};

const MEU_HISTORICO: CartaoHome = {
	id: 'meu-historico',
	titulo: 'Meu histórico',
	descricao: 'Suas escalas extras já encerradas: comprovantes de presença e relatórios.',
	icone: ICONE.historico,
	href: '/operacoes/presenca?status=finalizadas',
	cta: 'Ver histórico',
	atalhos: []
};

/* ── Gestão de unidade ──────────────────────────────────────────────────── */

/**
 * `/unidade` — a mesma rota com três leituras (decisão E39, itens 3.1–3.3):
 * a delegacia vê a própria ficha; a seccional, a tabela das delegacias dela;
 * o departamento, as seccionais abrindo as delegacias. Quem decide o que abre
 * é o servidor, pelo escopo.
 */
function cardUnidade(u: UsuarioDaHome, flags: FlagsMenu): CartaoHome {
	if (flags.isAdmGeral) {
		return {
			id: 'unidade',
			titulo: 'Departamento',
			descricao:
				'As seccionais e delegacias do departamento, com efetivo por cargo e situação. Clique numa unidade para abrir a ficha dela.',
			icone: ICONE.predio,
			href: '/unidade',
			cta: 'Ver unidades',
			atalhos: []
		};
	}
	if (u.papel === 'admin_seccional') {
		return {
			id: 'unidade',
			titulo: 'Minha seccional',
			descricao:
				'A seccional e as delegacias vinculadas a ela, com efetivo por cargo e situação. Clique numa delegacia para abrir a ficha.',
			icone: ICONE.predio,
			href: '/unidade',
			cta: 'Ver seccional',
			atalhos: []
		};
	}
	return {
		id: 'unidade',
		titulo: 'Minha delegacia',
		descricao: 'Os dados da sua unidade e o efetivo por cargo e situação.',
		icone: ICONE.predio,
		href: '/unidade',
		cta: 'Ver minha delegacia',
		atalhos: []
	};
}

/* ── Gestão administrativa ──────────────────────────────────────────────── */

const COLABORADORES: CartaoHome = {
	id: 'colaboradores',
	titulo: 'Colaboradores',
	descricao:
		'Servidores administrativos e terceirizados — a identidade que entra por e-mail e só alcança as funções designadas.',
	icone: ICONE.pessoas,
	href: '/colaboradores',
	cta: 'Gerenciar colaboradores',
	atalhos: []
};

/**
 * Os grupos e cartões deste usuário, na ordem em que a home os mostra. Grupo
 * sem cartão não aparece (a lista só traz os que têm algo).
 *
 * Espelha `visibilidadeDoMenu` + `itensExtraDoMenu`: mesma entrada, mesmas
 * condições. Um destino novo no menu tem de entrar aqui também — o teste de
 * paridade reprova o esquecimento.
 */
export function gruposHome({ usuario, flags }: EntradaHome): GrupoHome[] {
	if (!temHomeDeModulos(usuario)) return [];
	const u = usuario as UsuarioDaHome;
	const ehAdmin = u.tipo === 'admin';

	// `showGrupo1`/`showGrupo2` aqui vêm de `moduloParaHome`: para admin dizem
	// o que a conta tem LIGADO, não a preferência de tela — ver o cabeçalho.
	const pessoal: CartaoHome[] = [];
	if (flags.showPoliciais) pessoal.push(cardServidores(flags));
	const escalas = flags.showGrupo1 ? cardEscalas(u, flags) : null;
	if (escalas) pessoal.push(escalas);
	pessoal.push(
		planejado(
			'diarias',
			'Diárias',
			'Requerimento, despacho e pagamento das diárias de deslocamento, no rito geral e no de operação.',
			ICONE.documento,
			5
		),
		planejado(
			'extras',
			'Extras',
			'Horas extras (Cota): apuração, autorização e pagamento.',
			ICONE.historico,
			6
		)
	);
	// De departamento para cima (E39); a restrição a Gabinete e CEFIN entra
	// com as designações (fase 2).
	if (flags.showValores) {
		pessoal.push({
			id: 'valores',
			titulo: 'Atualização de valores',
			descricao:
				'Tabela de hora extra por cargo e classe e de diárias, versionada — a base de Extras e Diárias. Cada versão fica gravada com autor.',
			icone: ICONE.barras,
			href: '/valores',
			cta: 'Atualizar valores',
			atalhos: []
		});
	}
	if (u.tipo === 'policial') pessoal.push(MEU_PERFIL);

	const operacional: CartaoHome[] = [
		planejado(
			'armamento',
			'Armamento',
			'Armas e algemas da unidade: carga, cautela e movimentações.',
			ICONE.checkLista,
			4
		),
		planejado(
			'veiculos',
			'Veículos',
			'Frota da unidade: caracterizados e descaracterizados, situação e movimentações.',
			ICONE.pranchetaLista,
			4
		)
	];
	if (flags.showGrupo2) {
		const extra = cardEscalaExtra(u, flags);
		if (extra) operacional.push(extra);
		const plano = cardPlanoOperacional(flags);
		if (plano) operacional.push(plano);
		if (flags.showIndicadores) operacional.push(PRODUTIVIDADE);
		if (flags.showDadosBase) operacional.push(DADOS_BASE);
		// O Admin Geral não presta serviço: presença e histórico são de quem é
		// escalado. Mesma condição do menu.
		if (!ehAdmin && flags.temPresencaGiseAtiva) operacional.push(MINHA_PRESENCA);
		if (!ehAdmin && flags.temGiseHistorico) operacional.push(MEU_HISTORICO);
	}

	const unidade: CartaoHome[] = [cardUnidade(u, flags)];

	const administrativo: CartaoHome[] = [];
	if (flags.showColaboradores) administrativo.push(COLABORADORES);
	administrativo.push(
		planejado(
			'patrimonio-movel',
			'Patrimônio móvel',
			'Computadores, móveis e demais bens da unidade: carga e movimentações.',
			ICONE.predio,
			4
		)
	);
	// Municípios: só de departamento para cima, sem proposta (E32).
	if (flags.showMunicipios) {
		administrativo.push({
			id: 'municipios',
			titulo: 'Municípios',
			descricao:
				'Os municípios atendidos pelo departamento e a cobertura de cada um: delegacia, AIS, plantão, custódia, PM e PEFOCE.',
			icone: ICONE.mapa,
			href: '/municipios',
			cta: 'Ver municípios',
			atalhos: []
		});
	}

	const grupos: GrupoHome[] = [
		{
			id: 'pessoal',
			titulo: 'Gestão de pessoal',
			descricao: resumoDe(pessoal),
			href: '/grupo/pessoal',
			cartoes: pessoal
		},
		{
			id: 'operacional',
			titulo: 'Gestão operacional',
			descricao: resumoDe(operacional),
			href: '/grupo/operacional',
			cartoes: operacional
		},
		{
			id: 'unidade',
			titulo: 'Gestão de unidade',
			descricao: 'Vê os dados da unidade e vinculadas',
			href: '/grupo/unidade',
			cartoes: unidade
		},
		{
			id: 'administrativa',
			titulo: 'Gestão administrativa',
			descricao: resumoDe(administrativo),
			href: '/grupo/administrativa',
			cartoes: administrativo
		}
	];
	return grupos.filter((g) => g.cartoes.length > 0);
}

/** Todos os destinos clicáveis da home (telas de grupo, cartões ligados e atalhos) — para o teste de paridade. */
export function destinosDaHome(grupos: GrupoHome[]): string[] {
	const saida: string[] = [];
	for (const g of grupos) {
		saida.push(g.href);
		for (const c of g.cartoes) {
			if (c.href) saida.push(c.href);
			for (const a of c.atalhos) saida.push(a.href);
		}
	}
	return [...new Set(saida)];
}

/**
 * Atalho para a página `.svelte`: monta as flags a partir do que o
 * `+layout.server.ts` publica em `page.data` e devolve os grupos prontos.
 */
export function gruposHomeDaPagina(
	usuario: UsuarioDaHome | null | undefined,
	dados: {
		isSupervisorGise?: boolean;
		temLinhaBasePendente?: boolean;
		temPresencaGisePendente?: boolean;
		temGiseHistorico?: boolean;
	}
): GrupoHome[] {
	if (!usuario) return [];
	const flags = visibilidadeDoMenu({
		usuario,
		adminModulo: moduloParaHome(usuario),
		isSupervisorGise: !!dados.isSupervisorGise,
		temLinhaBasePendente: !!dados.temLinhaBasePendente,
		temPresencaGisePendente: !!dados.temPresencaGisePendente,
		temGiseHistorico: !!dados.temGiseHistorico
	});
	return gruposHome({ usuario, flags });
}
