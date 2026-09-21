/**
 * O que uma sessão de COLABORADOR alcança — lista FECHADA, conferida no
 * `hooks.server.ts` antes de qualquer rota rodar.
 *
 * A terceira identidade falha fechado por construção nos ~160 pontos que
 * perguntam `tipo === 'admin'` ou `tipo === 'policial'`. Mas há rotas que só
 * exigem SESSÃO (`requireAuth`, `if (!locals.usuario)`) e mostrariam a um
 * colaborador a tela de um policial sem papel — a lista de escalas, o perfil,
 * o painel de presença. Em vez de revisar cada uma, o portão inverte a regra:
 * colaborador entra SÓ no que está aqui; todo o resto responde 403 (API) ou
 * volta para a área dele.
 *
 * Desde a E61 (21/09/2026) a lista tem duas partes: a base (a área dele e o
 * onboarding) e o que a UNIDADE liberou, chave a chave, do catálogo de
 * `lib/colaboradores/acessos.ts`. Cada chave abre um punhado de rotas — e as
 * rotas continuam a conferir, por dentro, o escopo (a unidade dele) e o que
 * cada action exige. Acrescentar rota aqui é decisão de acesso, não
 * conveniência: é o único lugar em que o alcance do colaborador cresce.
 */
import type { UsuarioLogado } from '$lib/auth';
import { colaboradorTemAcesso } from '$lib/auth';
import type { AcessoDoColaborador } from '$lib/colaboradores/acessos';
import { pathnameNoEscopo } from './onboarding-gates';

const ROTAS_DO_COLABORADOR = [
	// A área dele: boas-vindas e, com `escalas.ver`, a lista das escalas.
	'/colaborador',
	// Onboarding e higiene de conta — os mesmos portões dos demais.
	'/alterar-senha',
	'/aceitar-termo',
	'/termo',
	'/api/termos',
	'/api/auth/logout'
] as const;

/**
 * As rotas que cada chave abre. Prefixos (`pathnameNoEscopo`), exceto onde
 * o padrão precisa do id — `/escalas/[id]` abre a escala, não `/escalas/nova`.
 */
const ROTAS_POR_ACESSO: Record<AcessoDoColaborador, readonly (string | RegExp)[]> = {
	'servidores.ver': [
		'/servidores',
		// Os anexos (PDF) que a ficha e o quadro de pedidos oferecem — a rota
		// confere o escopo pelo mesmo portão da ficha.
		/^\/api\/policiais\/(historico|solicitacoes)\/\d+\/documento$/,
		// A ficha da unidade dele (o load recorta ao escopo).
		/^\/unidade\/\d+$/,
		/^\/api\/unidades\/\d+\/foto$/
	],
	'servidores.cadastro': [],
	'servidores.afastamento': [],
	'servidores.ferias': ['/ferias', /^\/unidade\/\d+\/ferias$/],
	'escalas.ver': [/^\/escalas\/\d+$/],
	'avisos.ler': ['/avisos']
};

/** `/servidores/upload` é do Admin Geral: fica fora mesmo com `servidores.ver`. */
const NUNCA = ['/servidores/upload'] as const;

function casa(pathname: string, padrao: string | RegExp): boolean {
	return typeof padrao === 'string' ? pathnameNoEscopo(pathname, padrao) : padrao.test(pathname);
}

/** `true` quando a rota está na lista fechada do colaborador — a base, ou o que a unidade liberou. */
export function colaboradorPodeAcessarRota(pathname: string, u?: UsuarioLogado | null): boolean {
	if (ROTAS_DO_COLABORADOR.some((rota) => pathnameNoEscopo(pathname, rota))) return true;
	if (NUNCA.some((rota) => pathnameNoEscopo(pathname, rota))) return false;
	if (!u) return false;
	return (Object.keys(ROTAS_POR_ACESSO) as AcessoDoColaborador[]).some(
		(chave) =>
			colaboradorTemAcesso(u, chave) && ROTAS_POR_ACESSO[chave].some((p) => casa(pathname, p))
	);
}
