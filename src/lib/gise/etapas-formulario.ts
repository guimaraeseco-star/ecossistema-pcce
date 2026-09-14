/**
 * Fatiamento do formulário de produtividade em ETAPAS — a regra única que o
 * editor do Admin Geral (`ConfigurarFormulario`) e o wizard do policial
 * (`/operacoes/presenca/relatorio/[giseId]`) precisam concordar.
 *
 * Mora aqui, e não dentro de um dos dois, porque o editor mostra ao admin
 * exatamente o agrupamento que o policial vai ver. Duas implementações da mesma
 * regra divergiriam em silêncio — e a divergência só apareceria com o modelo já
 * salvo em produção.
 *
 * A regra, em três linhas:
 *
 * - agrupa por `etapa` (aparada); pergunta sem etapa cai no grupo `''`;
 * - a ORDEM das etapas é a da PRIMEIRA pergunta de cada uma — não é alfabética
 *   nem vem de uma lista à parte. Assim o admin ordena as etapas movendo as
 *   perguntas, e a ordem das perguntas dentro do grupo fica preservada;
 * - só perguntas de NÍVEL 0 têm etapa. Filhos vão junto do pai porque só
 *   aparecem sob o "Sim" dele.
 */
import type { GiseModeloPerguntaConfig } from '$lib/types';

/** Rótulo do grupo das perguntas sem etapa definida. */
export const ETAPA_SEM_NOME = 'Relatório';

/** Um passo do wizard: o nome exibido e as perguntas de nível 0 que ele contém. */
export interface EtapaFormulario {
	/** Valor gravado em `pergunta.etapa` (`''` para o grupo sem etapa). É a chave. */
	chave: string;
	/** O que aparece no cabeçalho do passo — `chave` ou `ETAPA_SEM_NOME`. */
	titulo: string;
	perguntas: GiseModeloPerguntaConfig[];
}

/**
 * Agrupa as perguntas nas etapas do wizard.
 *
 * Devolve sempre pelo menos um item quando há perguntas, e um array VAZIO quando
 * não há nenhuma — o chamador não precisa testar `perguntas.length` antes.
 *
 * Modelo antigo (nenhuma pergunta com `etapa`) resulta em uma etapa só, que é o
 * que mantém a mudança retrocompatível: o formulário volta a ser página única
 * sem nenhum tratamento especial no wizard.
 */
export function agruparPorEtapa(perguntas: GiseModeloPerguntaConfig[]): EtapaFormulario[] {
	const porChave = new Map<string, EtapaFormulario>();
	for (const p of perguntas) {
		const chave = p.etapa?.trim() ?? '';
		let etapa = porChave.get(chave);
		if (!etapa) {
			etapa = { chave, titulo: chave || ETAPA_SEM_NOME, perguntas: [] };
			porChave.set(chave, etapa);
		}
		etapa.perguntas.push(p);
	}
	return [...porChave.values()];
}
