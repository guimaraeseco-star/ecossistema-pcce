/**
 * Os quadros de "Acesso rápido" das telas de boas-vindas que RESTAM —
 * `/bem-vindo` (policial sem papel administrativo) e `/super-admin` — a regra
 * fora do `.svelte`, ao lado de `menu-visibilidade.ts` e pelo mesmo motivo.
 *
 * **Card e item de menu são a MESMA pergunta feita duas vezes**: "o que este
 * usuário alcança daqui?". Até ago/2026 eram duas respostas independentes e
 * elas divergiram em silêncio (admin de unidade com Produtividade na barra e
 * sem card; Dados base sem card nenhum; Admin Geral com 7 destinos para 4
 * cards). Por isso a lista sai das MESMAS flags que a barra consome
 * (`visibilidadeDoMenu`), e `__tests__/bem-vindo-cards.test.ts` reprova
 * qualquer destino de menu que fique sem card.
 *
 * Desde set/2026 (fase 1 do Ecossistema, decisão E39) os perfis
 * ADMINISTRATIVOS — sessão de admin e os dois papéis com escopo — não passam
 * mais por aqui: a entrada deles é a home de módulos (`/`), cuja regra vive em
 * `home-modulos.ts` com o seu próprio teste de paridade. `cardsBemVindo`
 * devolve lista vazia para eles de propósito, e é `obterRotaBemVindo` que os
 * manda para `/`. Item novo na navegação entra nos TRÊS arquivos.
 *
 * O que continua em cada página `.svelte`: só a apresentação (cabeçalho,
 * `accent`, grade). Quem decide O QUE aparece é este arquivo.
 */
import { visibilidadeDoMenu, type FlagsMenu } from './menu-visibilidade';
import { temHomeDeModulos } from './home-modulos';

/** Um quadro de acesso rápido. Mesma forma que `BemVindoCardAcao` consome. */
export interface CardBemVindo {
	titulo: string;
	descricao: string;
	href: string;
	cta: string;
}

/** Só o recorte de `UsuarioLogado` que a escolha dos cards consulta. */
export interface UsuarioDosCards {
	tipo?: 'policial' | 'admin' | 'colaborador';
	papel?: 'admin_seccional' | 'admin_unidade' | null;
	cargo?: string | null;
	isSuperAdmin?: boolean;
}

export interface EntradaCards {
	usuario: UsuarioDosCards | null | undefined;
	flags: FlagsMenu;
}

/* ── Policial sem papel ─────────────────────────────────────────────────── */

/**
 * `/perfil` — o texto promete só o que a tela entrega, e ela entrega menos desde
 * ago/2026: o servidor deixou de SOLICITAR a correção do próprio cadastro (quem
 * pede é o administrador da unidade ou da seccional dele). O que sobrou é
 * leitura mais as duas coisas que pertencem ao titular — o e-mail pessoal e a
 * chave de assinatura —, e é isso que o texto diz. Manter "solicite a correção"
 * aqui mandaria o servidor procurar um botão que não existe mais.
 */
const MEU_PERFIL: CardBemVindo = {
	titulo: 'Meu perfil',
	descricao:
		'Você pode conferir seus dados cadastrais, trocar o seu e-mail pessoal e registrar a chave de assinatura do celular (caso solicitado).',
	href: '/perfil',
	cta: 'Abrir meu perfil'
};

const MINHA_PRESENCA: CardBemVindo = {
	titulo: 'Minha presença',
	descricao:
		'Confirme sua entrada e saída nas escalas extras em que você foi escalado e assine a folha de presença.',
	href: '/res-gise',
	cta: 'Registrar presença'
};

const MEU_HISTORICO: CardBemVindo = {
	titulo: 'Meu histórico',
	descricao:
		'Consulte suas escalas extras já encerradas: comprovantes de presença e relatórios das operações anteriores.',
	href: '/res-gise?status=finalizadas',
	cta: 'Ver histórico'
};

/**
 * `/dados-base` — só aparece para quem TEM base pendente (`showDadosBase`), o
 * que faz dele o card mais próximo de uma tarefa a fazer. O texto diz para que
 * serve o número, porque quem preenche precisa saber que ele é o denominador da
 * meta.
 */
const DADOS_BASE: CardBemVindo = {
	titulo: 'Dados base',
	descricao:
		'Informe os números iniciais da sua unidade: são eles que servem de base para as metas percentuais das operações.',
	href: '/dados-base',
	cta: 'Informar dados base'
};

/** `/gise` para o supervisor de GISE ativa — o único policial sem papel que a alcança. */
const SUPERVISAO_ESCALA_EXTRA: CardBemVindo = {
	titulo: 'Supervisão da escala extra',
	descricao:
		'Acompanhe a escalação e a execução das escalas extras sob sua supervisão, e assine o que for da sua responsabilidade.',
	href: '/gise',
	cta: 'Acessar supervisão'
};

/* ── Super Admin ────────────────────────────────────────────────────────── */

const UNIDADES: CardBemVindo = {
	titulo: 'Unidades',
	descricao:
		'Cadastre e organize a estrutura da corporação: departamentos, seccionais e delegacias.',
	href: '/unidades',
	cta: 'Gerenciar unidades'
};

const POLICIAIS_SUPER: CardBemVindo = {
	titulo: 'Policiais',
	descricao:
		'Gerencie o cadastro dos policiais, os papéis administrativos (RBAC) e a concessão de Admin Geral.',
	href: '/policiais',
	cta: 'Gerenciar policiais'
};

const COLABORADORES: CardBemVindo = {
	titulo: 'Colaboradores',
	descricao:
		'Cadastre servidores administrativos e terceirizados — a identidade que entra por e-mail e só alcança as funções designadas.',
	href: '/colaboradores',
	cta: 'Gerenciar colaboradores'
};

/**
 * `/conf-ass` — o texto acompanha as CINCO chaves da tela. Ficou por um tempo
 * em "foto, GPS e código por e-mail", de quando eram três: as duas que faltavam
 * (restrição a smartphone e exigência da chave de assinatura) são justamente as
 * de maior efeito sobre quem consegue assinar.
 */
const CONF_ASS: CardBemVindo = {
	titulo: 'Configurações de assinatura',
	descricao:
		'Defina o que a assinatura em tela exige: foto, localização, código por e-mail, restrição a smartphone e a chave de assinatura do celular.',
	href: '/conf-ass',
	cta: 'Abrir configurações'
};

const CONFIG_GERAL: CardBemVindo = {
	titulo: 'Configurações gerais',
	descricao:
		'Ajustes globais do sistema, como o provedor de e-mail padrão (Cloudflare ou Resend) e o seu substituto em caso de falha.',
	href: '/config-geral',
	cta: 'Abrir configurações'
};

/**
 * `/config-custos` — do Super Admin, e não do Admin Geral que monta os planos:
 * é a tabela de hora extra e diária da corporação. Quem planeja a operação
 * escolhe QUANTAS horas; quanto vale a hora é decisão de outro nível.
 */
const CONFIG_CUSTOS: CardBemVindo = {
	titulo: 'Valores de custo',
	descricao:
		'Defina os valores de hora extra por cargo e classe e os das diárias. É a tabela que os planos operacionais aplicam — cada versão fica gravada, e um plano antigo continua com a que usou.',
	href: '/config-custos',
	cta: 'Abrir valores de custo'
};

const AUDITORIA: CardBemVindo = {
	titulo: 'Auditoria',
	descricao:
		'Trilha forense das ações do sistema, com filtros, verificação de integridade e exportação (CSV ou PDF).',
	href: '/auditoria',
	cta: 'Abrir auditoria'
};

/**
 * Os cards deste usuário, na ordem em que a tela os mostra.
 *
 * Espelha `visibilidadeDoMenu` + `itensExtraDoMenu`: mesma entrada, mesmas
 * condições. Um destino novo no menu tem de entrar aqui também — o teste de
 * paridade reprova o esquecimento.
 */
export function cardsBemVindo({ usuario, flags }: EntradaCards): CardBemVindo[] {
	if (!usuario) return [];

	// Super Admin: console próprio, sem as abas operacionais.
	if (usuario.isSuperAdmin) {
		return [
			UNIDADES,
			POLICIAIS_SUPER,
			COLABORADORES,
			CONF_ASS,
			CONFIG_GERAL,
			CONFIG_CUSTOS,
			AUDITORIA
		];
	}

	// Colaborador: nenhum card — a área dele diz que nada foi designado ainda.
	// Perfis administrativos: a entrada é a home de módulos (`home-modulos.ts`).
	if (usuario.tipo === 'colaborador' || temHomeDeModulos(usuario)) return [];

	const cards: CardBemVindo[] = [];

	// Tudo o que é de escala extra (o submenu "Escala extra").
	if (flags.showGise) cards.push(SUPERVISAO_ESCALA_EXTRA);
	if (flags.showDadosBase) cards.push(DADOS_BASE);
	if (flags.temPresencaGiseAtiva) cards.push(MINHA_PRESENCA);
	if (flags.temGiseHistorico) cards.push(MEU_HISTORICO);

	// Todo policial tem perfil.
	cards.push(MEU_PERFIL);

	return cards;
}

/**
 * Atalho para as páginas `.svelte`: monta as flags a partir do que o
 * `+layout.server.ts` já publica em `page.data` e devolve os cards prontos.
 *
 * Existe para que as telas de boas-vindas não repitam a montagem de
 * `visibilidadeDoMenu` — repetir seria reabrir, em outra forma, a mesma porta
 * pela qual card e menu se afastaram.
 */
export function cardsBemVindoDaPagina(
	usuario: UsuarioDosCards | null | undefined,
	dados: {
		adminModulo?: 'ambas' | 'gise' | 'escalas';
		isSupervisorGise?: boolean;
		temLinhaBasePendente?: boolean;
		temPresencaGisePendente?: boolean;
		temGiseHistorico?: boolean;
	}
): CardBemVindo[] {
	if (!usuario) return [];
	const flags = visibilidadeDoMenu({
		usuario,
		adminModulo: dados.adminModulo ?? 'ambas',
		isSupervisorGise: !!dados.isSupervisorGise,
		temLinhaBasePendente: !!dados.temLinhaBasePendente,
		temPresencaGisePendente: !!dados.temPresencaGisePendente,
		temGiseHistorico: !!dados.temGiseHistorico
	});
	return cardsBemVindo({ usuario, flags });
}
