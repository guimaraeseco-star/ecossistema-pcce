/**
 * Quanto de largura a página recebe — a regra do container do layout, fora do
 * `.svelte` (mesma razão de `menu-visibilidade.ts`: regra testável).
 *
 * O padrão do sistema é `max-w-6xl` (1152 px), que é largura de LEITURA: texto,
 * formulário e cartão ficam confortáveis e a linha não fica longa demais.
 *
 * Algumas telas, porém, são TABELAS LARGAS — a Gestão de unidade tem 12
 * colunas, Municípios tem 9, Servidores 7 — e em 1152 px cada nome de
 * delegacia quebra em três linhas, o que empurra a tabela para baixo e força o
 * olho a reconstruir a linha (pedido do responsável em 16/09/2026: "pense
 * sempre na experiência do usuário nas telas"). Essas usam 1408 px, que é o
 * ponto em que os nomes de unidade do DPI Sul cabem em uma ou duas linhas sem
 * que a tela vire uma planilha infinita.
 *
 * A lista é de PREFIXOS de rota: `/unidade` vale para `/unidade/[id]`, e assim
 * por diante. Tela nova com tabela de muitas colunas entra aqui — não com um
 * `max-w` solto no markup, que desalinharia o cabeçalho da página (ver
 * README §10, "Largura de conteúdo").
 */

/** Prefixos cujas telas são tabelas largas. */
const ROTAS_LARGAS = ['/unidade', '/municipios', '/servidores'] as const;

export const LARGURA_PADRAO = 'max-w-6xl';
export const LARGURA_AMPLA = 'max-w-[88rem]';

/** A rota é uma das telas de tabela larga? */
export function ehPaginaLarga(pathname: string): boolean {
	return ROTAS_LARGAS.some((r) => pathname === r || pathname.startsWith(r + '/'));
}

/** A classe de largura do container do layout para esta rota. */
export function larguraDaPagina(pathname: string): string {
	return ehPaginaLarga(pathname) ? LARGURA_AMPLA : LARGURA_PADRAO;
}
