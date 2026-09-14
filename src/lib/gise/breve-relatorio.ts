/**
 * Título e textos padrão do bloco "Breve relatório" nos PDFs de serviço extraordinário (GISE).
 *
 * Ordem, do mais específico ao mais geral: colunas `breve_relatorio_*` em
 * `gise_escalas` (por escala) → colunas homônimas em `operacoes` (por operação,
 * migração 0051) → chaves em `configuracoes` (o global, hoje só de leitura) →
 * constantes abaixo. Os dois níveis do meio chegam já resolvidos em
 * `BreveRelatorioEnv`, por `getBreveRelatorioEnvMergido`.
 */

import type { GiseEscala } from '$lib/server/schema';

/**
 * Limites de digitação dos campos `breve_relatorio_*` — UM número por campo,
 * lido pelo `maxlength` das DUAS telas que os editam e pelas DUAS actions que os
 * gravam.
 *
 * Moram aqui, e não em cada tela, porque as colunas têm dois caminhos de escrita
 * (`/operacoes/gise/operacoes`, por operação, e o modal de `/operacoes/gise/[id]`, por escala) e eles
 * discordavam: o primeiro limitava a 200/2000 na tela E no servidor, o segundo
 * não limitava em lugar nenhum. Número solto em cada arquivo é o que permite a
 * tela prometer um limite e o banco guardar outro.
 */
export const MAX_BREVE_TITULO = 200;
export const MAX_BREVE_PARAGRAFO = 2000;

export const DEFAULT_BREVE_RELATORIO_TITULO = 'BREVE RELATÓRIO:';

export const DEFAULT_BREVE_RELATORIO_TEXTO_SECCIONAL =
	'EM RAZÃO DE SERVIÇO EXTRAORDINÁRIO (GISE) OS SERVIDORES ABAIXO RELACIONADOS RECEBERÃO GRATIFICAÇÃO NA FORMA DE DIÁRIAS DE REFORÇO OPERACIONAL.';

export const DEFAULT_BREVE_RELATORIO_TEXTO_SUPERVISAO =
	'EM RAZÃO DE SERVIÇO EXTRAORDINÁRIO (GISE) OS SERVIDORES DO QUADRO DE SUPERVISÃO ABAIXO RELACIONADOS RECEBERÃO GRATIFICAÇÃO NA FORMA DE DIÁRIAS DE REFORÇO OPERACIONAL.';

/** Operação + global já mesclados por `getBreveRelatorioEnvMergido`; o nome remete ao histórico, não a env vars. */
export type BreveRelatorioEnv = {
	GISE_BREVE_RELATORIO_TITULO?: string;
	GISE_BREVE_RELATORIO_TEXTO_SECCIONAL?: string;
	GISE_BREVE_RELATORIO_TEXTO_SUPERVISAO?: string;
};

type GiseBrevePick = Pick<
	GiseEscala,
	'breve_relatorio_titulo' | 'breve_relatorio_texto_seccional' | 'breve_relatorio_texto_supervisao'
>;

function primeiroTextoNaoVazio(...candidatos: (string | null | undefined)[]): string | undefined {
	for (const c of candidatos) {
		const t = c?.trim();
		if (t) return t;
	}
	return undefined;
}

/** Rótulo exibido acima da caixa de texto (ambos os PDFs de extra). */
export function resolveBreveRelatorioTitulo(
	gise: GiseBrevePick,
	global?: BreveRelatorioEnv | null
): string {
	return (
		primeiroTextoNaoVazio(gise.breve_relatorio_titulo, global?.GISE_BREVE_RELATORIO_TITULO) ??
		DEFAULT_BREVE_RELATORIO_TITULO
	);
}

/** Parágrafo padrão no relatório de extra por seccional. */
export function resolveBreveRelatorioConteudoSeccional(
	gise: GiseBrevePick,
	global?: BreveRelatorioEnv | null
): string {
	return (
		primeiroTextoNaoVazio(
			gise.breve_relatorio_texto_seccional,
			global?.GISE_BREVE_RELATORIO_TEXTO_SECCIONAL
		) ?? DEFAULT_BREVE_RELATORIO_TEXTO_SECCIONAL
	);
}

/** Parágrafo padrão no relatório de extra do quadro de supervisão. */
export function resolveBreveRelatorioConteudoSupervisao(
	gise: GiseBrevePick,
	global?: BreveRelatorioEnv | null
): string {
	return (
		primeiroTextoNaoVazio(
			gise.breve_relatorio_texto_supervisao,
			global?.GISE_BREVE_RELATORIO_TEXTO_SUPERVISAO
		) ?? DEFAULT_BREVE_RELATORIO_TEXTO_SUPERVISAO
	);
}
