/**
 * `load` do painel de PRODUTIVIDADE.
 *
 * Entrega a lista COMPLETA de respostas do período, não uma página: a tela
 * recombina os mesmos dados a cada filtro, e agregar no cliente evita uma ida
 * ao servidor por clique. O custo é o payload crescer com o histórico — é
 * dívida conhecida, com a solução (agregar no servidor) registrada abaixo.
 *
 * ## Quem entra
 *
 * Era exclusivo do Admin Geral. Passou a aceitar admin de unidade/seccional
 * porque são eles que informam a LINHA DE BASE dos indicadores em
 * `/operacoes/dados-base` — quem alimenta o denominador precisa poder ver o resultado.
 * O acesso deles é ESCOPADO: `unidadeIdsPermitidas` recorta as respostas às
 * unidades que administram, e o recorte é do servidor, não um filtro de tela.
 *
 * ## Operação
 *
 * Os indicadores e as metas são POR OPERAÇÃO — o formulário da CRAJUBAR não é o
 * do GISE. Por isso o `load` resolve uma operação (`?operacaoId=`) e carrega os
 * modelos dela, e não "o modelo global" que existia antes da migração 0048.
 */
import { dataISOValida, hojeBrasilISO } from '$lib/utils/datas';
import { error } from '@sveltejs/kit';
import type { PageServerLoadEvent } from './$types';
import {
	getDB,
	buscarGiseModeloFormulario,
	listarTodasRespostasGise,
	buscarSeccionaisUnidades,
	listarOperacoes,
	listarLinhaBase,
	unidadesParticipantesDaOperacao,
	NOME_OPERACAO_PADRAO
} from '$lib/db';
import { isAdminGeral, isAnyAdmin } from '$lib/auth';
import { lerOrdemPainel } from '$lib/produtividade';
import { unidadesLinhaBaseAdministradas } from '$lib/server/operacoes/permissao';

export async function load({ locals, platform, url }: PageServerLoadEvent) {
	const u = locals.usuario;
	// Admin Geral, admin seccional e admin de unidade. Policial sem papel não
	// entra — a tela agrega a produtividade de terceiros.
	if (!u || !isAnyAdmin(u)) {
		error(403, 'Acesso restrito a administradores');
	}

	const db = getDB(platform);

	// JANELA do painel. Sem parâmetro, o ano CORRENTE — e não "tudo" (B-1).
	//
	// A tela já mostrava o ano corrente por padrão (`filterAno` nasce em
	// `currentYear`), mas o servidor carregava o histórico inteiro da operação
	// para o cliente recortar. Carregava 4+ anos para exibir 1, e o payload
	// crescia para sempre. O default do servidor agora é o mesmo default da
	// tela; trocar de ano ou usar o modo personalizado põe a janela na URL.
	//
	// `hojeBrasilISO` e não `new Date().getFullYear()`: o Worker roda em UTC, e
	// no dia 1º de janeiro às 21h de Brasília o relógio do isolate já virou o
	// ano — o painel abriria vazio.
	const anoCorrente = hojeBrasilISO().slice(0, 4);
	const inicio = dataISOValida(url.searchParams.get('inicio')) ?? `${anoCorrente}-01-01`;
	const fim = dataISOValida(url.searchParams.get('fim')) ?? `${anoCorrente}-12-31`;

	// A operação em foco. Sem `?operacaoId=` válido, a primeira ativa (com o GISE
	// preferido, que é a operação histórica) — a tela nunca abre sem uma escolhida,
	// porque sem operação não há indicador nem meta a mostrar.
	const operacoesLista = await listarOperacoes(db, { somenteAtivas: true });
	const operacaoIdParam = Number(url.searchParams.get('operacaoId'));
	const operacao =
		operacoesLista.find((o) => o.id === operacaoIdParam) ??
		operacoesLista.find((o) => o.nome === NOME_OPERACAO_PADRAO) ??
		operacoesLista[0] ??
		null;

	// Escopo de unidades: `null` = irrestrito (Admin Geral). Para os demais é o
	// conjunto que eles administram DENTRO desta operação — vazio significa
	// "nenhuma", e a tela mostra o aviso em vez de todos os dados.
	const unidadeIdsPermitidas =
		isAdminGeral(u) || !operacao
			? null
			: [...(await unidadesLinhaBaseAdministradas(db, u, operacao.id))];

	const [primeira, modeloOpRow, modeloSeintRow, seccionais, linhaBase, unidadesDaOperacao] =
		await Promise.all([
			listarTodasRespostasGise(db, {
				page: 1,
				limit: 500,
				inicio,
				fim,
				operacaoId: operacao?.id,
				unidadeIds: unidadeIdsPermitidas ?? undefined
			}),
			operacao ? buscarGiseModeloFormulario(db, operacao.id, 'operacional') : Promise.resolve(null),
			operacao ? buscarGiseModeloFormulario(db, operacao.id, 'seint') : Promise.resolve(null),
			buscarSeccionaisUnidades(db),
			operacao
				? listarLinhaBase(db, operacao.id, unidadeIdsPermitidas ?? undefined)
				: Promise.resolve([]),
			operacao ? unidadesParticipantesDaOperacao(db, operacao.id) : Promise.resolve([])
		]);

	// O dashboard agrega o conjunto COMPLETO de respostas (stats/rankings/charts
	// e filtros de ano/seccional são computados no cliente): busca a 1ª página
	// no batch principal e as demais em paralelo. Antes, só a 1ª página
	// (`?page=` que a UI nunca enviava, 200 linhas) era retornada — com mais de
	// 200 respostas os números erravam silenciosamente (auditoria 2026-07-16,
	// achado B-1). Médio prazo: agregar no servidor para o payload parar de
	// crescer com o histórico.
	//
	// `totalConhecido` repassa o total que a 1ª página já pagou: sem ele, cada
	// página seguinte refazia o mesmo `count(*)` sobre a junção de cinco tabelas
	// para chegar ao número que já está aqui na mão (auditoria de set/2026).
	const paginasRestantes =
		primeira.totalPages > 1
			? await Promise.all(
					Array.from({ length: primeira.totalPages - 1 }, (_, i) =>
						listarTodasRespostasGise(db, {
							page: i + 2,
							limit: 500,
							inicio,
							fim,
							operacaoId: operacao?.id,
							unidadeIds: unidadeIdsPermitidas ?? undefined,
							totalConhecido: primeira.total
						})
					)
				)
			: [];

	return {
		lista: [...primeira.respostas, ...paginasRestantes.flatMap((p) => p.respostas)],
		modeloOperacional: JSON.parse(modeloOpRow?.config || '[]'),
		modeloSeint: JSON.parse(modeloSeintRow?.config || '[]'),
		/**
		 * A ordem em que os cards do painel aparecem, por tipo de equipe (migração
		 * 0064). Lista vazia = ordem do formulário, que é o que toda operação é até
		 * alguém organizar o painel.
		 *
		 * Os DOIS tipos vão juntos porque o seletor "Operacional / Inteligência" é
		 * de tela e não recarrega o `load` — do mesmo jeito que os dois modelos já
		 * viajam juntos.
		 */
		painelOrdem: {
			operacional: lerOrdemPainel(modeloOpRow?.painel_ordem),
			seint: lerOrdemPainel(modeloSeintRow?.painel_ordem)
		},
		/**
		 * Quem pode ARRASTAR os cards. A ordem é única e vale para todos que abrem
		 * a operação, então organizá-la é configuração — do mesmo tipo que o editor
		 * do formulário, que já é exclusivo do Admin Geral. Admin de unidade e de
		 * seccional entram nesta tela para LER o resultado do que informam em
		 * `/operacoes/dados-base`, com os dados recortados; o painel deles não é uma cópia
		 * particular que cada um pudesse arrumar para si.
		 *
		 * Esconder o botão não é a autorização: quem recusa o PUT direto é
		 * `requireAdmin` em `/api/produtividade/ordem`.
		 */
		podeOrganizar: isAdminGeral(u),
		seccionais,
		operacoes: operacoesLista,
		operacaoSelecionadaId: operacao?.id ?? null,
		/** Unidades da operação, para rotular as barras dos gráficos de indicador. */
		unidadesDaOperacao,
		/** Linhas de base já informadas — o denominador das metas percentuais. */
		linhaBase,
		/** `true` quando a tela está recortada à unidade do usuário (não é Admin Geral). */
		escopoRestrito: unidadeIdsPermitidas !== null,
		/**
		 * A janela que ESTES dados cobrem. Vai para a tela porque o filtro
		 * precisa nascer igual ao recorte que o servidor aplicou — se o seletor
		 * mostrasse o ano corrente enquanto `lista` traz outro, o usuário leria
		 * números de um período com o rótulo de outro (B-1).
		 */
		janela: { inicio, fim }
	};
}
