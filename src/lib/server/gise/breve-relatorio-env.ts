/**
 * Chaves em `configuracoes` — o nível GLOBAL da cadeia, hoje só de leitura.
 *
 * Eram escritas pela antiga `/operacoes/gise/config`, que saiu do ar quando a configuração
 * virou por operação. Continuam sendo lidas: são o valor que uma operação herda
 * enquanto não define o seu. Manter o que já estava gravado é o que faz a
 * mudança não alterar nenhum PDF existente.
 *
 * Não exportadas: nada fora deste módulo escreve nelas desde então.
 */
import { eq } from 'drizzle-orm';
import { buscarConfiguracao } from '$lib/db/configuracoes';
import { operacoes } from '$lib/server/schema';
import type { Database } from '$lib/db/core';
import type { BreveRelatorioEnv } from '$lib/gise/breve-relatorio';
const GISE_BREVE_RELATORIO_CONFIG_KEYS = {
	titulo: 'gise_breve_relatorio_titulo',
	textoSeccional: 'gise_breve_relatorio_texto_seccional',
	textoSupervisao: 'gise_breve_relatorio_texto_supervisao'
} as const;

const K = GISE_BREVE_RELATORIO_CONFIG_KEYS;

function cfg(v: string | null | undefined): string | undefined {
	const t = v?.trim();
	return t ? t : undefined;
}

/**
 * Textos do breve relatório aplicáveis a uma escala, já com a OPERAÇÃO resolvida.
 *
 * `resolveBreveRelatorio*` combina: colunas da GISE → este objeto → constantes no
 * código. Este objeto, por sua vez, é a operação sobre o global — o texto da
 * CRAJUBAR fala do serviço dela, e só cai no texto do sistema no que ela não
 * tiver definido.
 *
 * `operacaoId` é **obrigatório e sem valor padrão**, inclusive para passar
 * `null`. Um default aqui faria um PDF sair com o texto global por esquecimento
 * de um call site — e o sintoma seria um documento assinado com o parágrafo
 * errado, sem erro nenhum. `null` é a resposta legítima de quem não tem
 * operação em mãos (escala anterior à migração 0048).
 */
export async function getBreveRelatorioEnvMergido(
	db: Database,
	operacaoId: number | null
): Promise<BreveRelatorioEnv> {
	const [t, s, u, op] = await Promise.all([
		buscarConfiguracao(db, K.titulo),
		buscarConfiguracao(db, K.textoSeccional),
		buscarConfiguracao(db, K.textoSupervisao),
		operacaoId != null
			? db
					.select({
						titulo: operacoes.breve_relatorio_titulo,
						seccional: operacoes.breve_relatorio_texto_seccional,
						supervisao: operacoes.breve_relatorio_texto_supervisao
					})
					.from(operacoes)
					.where(eq(operacoes.id, operacaoId))
					.get()
			: Promise.resolve(undefined)
	]);

	return {
		GISE_BREVE_RELATORIO_TITULO: cfg(op?.titulo) ?? cfg(t),
		GISE_BREVE_RELATORIO_TEXTO_SECCIONAL: cfg(op?.seccional) ?? cfg(s),
		GISE_BREVE_RELATORIO_TEXTO_SUPERVISAO: cfg(op?.supervisao) ?? cfg(u)
	};
}
