/**
 * Os três atos de RH sobre um servidor — movimentar, afastar, desvincular —,
 * escritos UMA vez para os dois caminhos que os produzem:
 *
 *   - o Admin Geral, que executa direto na ficha (`/servidores/[id]`);
 *   - o administrador de seccional/unidade, que PEDE, e cuja aprovação em
 *     `/solicitacoes` executa exatamente o mesmo ato.
 *
 * Enquanto o efeito morava dentro das form actions da ficha, o caminho da
 * aprovação teria de reescrevê-lo — e é a forma exata dos bugs catalogados no
 * `CLAUDE.md`: duas cópias, uma consertada, a outra não. Aqui a pergunta "o que
 * acontece quando uma movimentação é aprovada?" tem um lugar só para ser
 * respondida.
 *
 * O que cada ato decide:
 *
 * - **movimentação** troca a lotação E grava o evento, na MESMA transação
 *   (`atualizarPolicialComHistorico`) — lotação trocada sem portaria na linha do
 *   tempo é estado que a ficha não sabe explicar (FLW-RBAC-005);
 * - **afastamento** NÃO altera o cadastro: afastado continua ativo e escalável,
 *   e é `afastamentoVigente` que diz à tela quem está fora hoje;
 * - **desvinculação** inativa (`ativo: 0`), nunca apaga — o histórico de escalas
 *   continua apontando para o servidor —, e derruba as sessões abertas: desativar
 *   tem de tirar a pessoa de DENTRO, não só impedir o próximo login
 *   (FLW-RBAC-001). Cobre as duas identidades, porque quem tem Admin Geral
 *   vinculado tem dois cookies possíveis e o de administrador é o mais poderoso.
 *
 * A AUDITORIA fica com o chamador de propósito: a frase que descreve o ato muda
 * conforme ele tenha sido executado ou aprovado, e é justamente essa diferença
 * que a trilha precisa registrar.
 */

import {
	atualizarPolicialComHistorico,
	registrarHistorico,
	type CamposDoEventoFuncional,
	type Database,
	type NovoEventoHistorico
} from '$lib/db';
import { resolverCredencial, revogarSessoesDaCredencial } from '$lib/server/auth/credencial';

/**
 * O ato pedido/executado, na forma em que a linha do tempo o guarda: os MESMOS
 * campos do evento funcional, restritos aos três tipos que este executor aplica.
 *
 * Herdar `CamposDoEventoFuncional` é o que faz a linha de
 * `policial_acao_solicitacoes` caber aqui sem conversão nenhuma — a aprovação
 * passa o pedido do banco direto para `executarAcaoRH`, sem remontar nada.
 */
export interface AcaoRH extends CamposDoEventoFuncional {
	tipo: 'movimentacao' | 'afastamento' | 'desvinculacao';
}

/**
 * Quem responde pelo ato na linha do tempo.
 *
 * Na execução direta é o próprio Admin Geral. Na aprovação é quem PEDIU — foi
 * ele quem apurou o fato e anexou a portaria; o Admin Geral autorizou, e essa
 * autorização é o que a trilha de auditoria registra. Trocar os dois faria a
 * ficha atribuir ao aprovador um ato que ele não levantou.
 */
export interface AtorDaAcao {
	id: number;
	nome: string;
}

/** Monta o evento da linha do tempo a partir do ato + ator. */
function eventoDaAcao(policialId: number, acao: AcaoRH, ator: AtorDaAcao): NovoEventoHistorico {
	return {
		policial_id: policialId,
		tipo: acao.tipo,
		subtipo: acao.subtipo ?? null,
		descricao: acao.descricao ?? null,
		unidade_origem: acao.unidade_origem ?? null,
		unidade_destino: acao.unidade_destino ?? null,
		data_evento: acao.data_evento ?? null,
		data_inicio: acao.data_inicio ?? null,
		data_fim: acao.data_fim ?? null,
		qtd_dias: acao.qtd_dias ?? null,
		nup: acao.nup ?? null,
		tipo_cid: acao.tipo_cid ?? null,
		documento_r2_key: acao.documento_r2_key ?? null,
		documento_nome: acao.documento_nome ?? null,
		registrado_por_id: ator.id,
		registrado_por_nome: ator.nome
	};
}

/**
 * APLICA o ato: muda o cadastro quando é o caso e grava o evento imutável.
 *
 * Lança em caso de falha de persistência — o chamador é quem sabe se há um
 * anexo recém-subido a limpar do R2 (execução direta) ou se o anexo já pertence
 * a um pedido gravado (aprovação).
 */
export async function executarAcaoRH(
	db: Database,
	policialId: number,
	acao: AcaoRH,
	ator: AtorDaAcao
): Promise<void> {
	const evento = eventoDaAcao(policialId, acao, ator);

	if (acao.tipo === 'movimentacao') {
		// O "trabalha em" (E66) é um LOCAL da lotação antiga: mudar de unidade o
		// invalida, e deixá-lo apontando para o posto da unidade de origem faria o
		// servidor aparecer trabalhando onde não está mais lotado. Volta para a
		// sede do destino (nulo); quem quiser pôr num posto de lá faz na ficha.
		await atualizarPolicialComHistorico(
			db,
			policialId,
			{ lotacao: acao.unidade_destino ?? '', local_id: null },
			evento
		);
		return;
	}

	if (acao.tipo === 'desvinculacao') {
		await atualizarPolicialComHistorico(db, policialId, { ativo: 0 }, evento);
		// DEPOIS da baixa persistida, e fora da transação de propósito: revogar a
		// sessão de um cadastro que voltou a ser ativo é inofensivo; o contrário,
		// não.
		await revogarSessoesDaCredencial(db, await resolverCredencial(db, 'policial', policialId));
		return;
	}

	// Afastamento: só a linha do tempo.
	await registrarHistorico(db, evento);
}
