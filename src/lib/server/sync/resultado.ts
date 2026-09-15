/**
 * O contrato de resposta dos webhooks de sincronização — FLW-WEBHOOK-002.
 *
 * Os dois endpoints (`sync-policiais`, `sync-unidades`) importam linhas de uma
 * planilha e descartavam em silêncio o que não sabiam classificar: linha sem
 * matrícula, sem nome, sem unidade-pai, nível desconhecido. O descarte não
 * entrava na contagem de erros, e `sync-unidades` respondia `success: true`
 * mesmo com falhas. Do lado de quem operava a planilha, o efeito era o pior
 * possível: a sincronização "deu certo" e o policial simplesmente não estava lá.
 *
 * Duas decisões, e as duas importam:
 *
 * 1. **Linha vazia é ignorável; linha incompleta é ERRO.** Planilha do Google
 *    manda linhas em branco no fim da faixa o tempo todo — recusar o lote
 *    inteiro por causa delas seria inútil. Mas linha que tem ALGUM dado e não
 *    tem o obrigatório é registro que alguém digitou esperando ver importado.
 *
 * 2. **Sucesso parcial responde 422, não 200.** O achado observa que o Apps
 *    Script remoto lê `error`/`details` e ignora `errors`. Não dá para corrigir
 *    o script daqui, mas dá para parar de dizer "200 OK" quando metade do lote
 *    não entrou: um cliente que ignore o corpo ainda enxerga o status.
 *    Reenviar é seguro — as duas rotas fazem upsert.
 */
import { json } from '@sveltejs/kit';

/** Uma linha da planilha, como o Apps Script a envia. */
export type LinhaPlanilha = Record<string, unknown>;

/**
 * A linha está COMPLETAMENTE vazia?
 *
 * Só isso é descarte legítimo. Qualquer célula preenchida — ainda que na coluna
 * errada — significa que alguém digitou ali esperando ver o registro importado.
 */
export function linhaVazia(item: LinhaPlanilha): boolean {
	return Object.values(item).every((v) => v === null || v === undefined || String(v).trim() === '');
}

/** O que a sincronização fez, e o que deixou de fazer. */
export interface ResultadoSync {
	/** Linhas recebidas, incluindo as vazias. */
	processadas: number;
	/** Linhas gravadas. */
	importadas: number;
	/** Linhas em branco, ignoradas de propósito. */
	vazias: number;
	/** Falhas e descartes, com a linha identificada. Contrato ÚNICO. */
	erros: string[];
	/** O que entrou mas pede atenção (ex.: titular já cadastrado pela tela). Não muda o status. */
	avisos?: string[];
	/** Contadores extras da rodada (ex.: histórico gravado/repetido). */
	extras?: Record<string, number>;
}

/**
 * A resposta HTTP do webhook. **422 quando algo não entrou**, 200 só quando o
 * lote inteiro (fora as linhas vazias) foi importado.
 *
 * O corpo é o mesmo nos dois casos, para o cliente não precisar de dois
 * caminhos de parse.
 */
export function respostaDeSync(r: ResultadoSync): Response {
	const corpo = {
		success: r.erros.length === 0,
		processed: r.processadas,
		imported: r.importadas,
		skippedEmpty: r.vazias,
		failed: r.erros.length,
		errors: r.erros.length > 0 ? r.erros : undefined,
		warnings: r.avisos && r.avisos.length > 0 ? r.avisos : undefined,
		...(r.extras ?? {})
	};
	return json(corpo, { status: r.erros.length === 0 ? 200 : 422 });
}
