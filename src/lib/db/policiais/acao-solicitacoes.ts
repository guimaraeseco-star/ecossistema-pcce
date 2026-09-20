/**
 * Solicitações de AÇÃO DE RH sobre o servidor: movimentar, afastar, desvincular.
 *
 * O Admin Geral executa esses atos direto na ficha; o administrador de seccional
 * ou de unidade PEDE, e o ato só acontece quando o Admin Geral aprova em
 * `/solicitacoes`. As duas pontas usam o mesmo executor
 * (`$lib/server/policiais/acoes-rh`) — aqui mora apenas a fila.
 *
 * A linha guarda o pedido no MESMO formato do evento que a aprovação vai gravar
 * em `policial_historico`, anexo incluído. Aprovar é, por isso, copiar e
 * executar: não há um segundo lugar onde o efeito da movimentação seja montado,
 * e portanto não há um segundo lugar de onde ele possa divergir.
 */

import { and, eq, desc } from 'drizzle-orm';
import type { Database } from '../core';
import { linhasAfetadas } from '../core';
import { policialAcaoSolicitacoes, policiais } from '$lib/server/schema';
import type { PolicialAcaoSolicitacao } from '$lib/server/schema';
import type { CamposDoEventoFuncional } from './historico';

/**
 * Os atos que podem ser pedidos.
 *
 * Os três primeiros espelham `policial_historico.tipo` — são atos sobre o
 * SERVIDOR, e a aprovação os executa na linha do tempo dele.
 *
 * **`direcao` é de outra natureza, e por isso vale a ressalva** (16/09/2026):
 * é ato sobre a UNIDADE — quem passa a dirigi-la, como titular ou respondente.
 * Ele mora nesta fila porque os campos de que precisa já estavam aqui (unidade
 * de destino, início da vigência, NUP, justificativa) e porque o rito de
 * decisão e a trilha de auditoria são os mesmos; mas a aprovação NÃO o manda
 * para `executarAcaoRH`, e sim para `registrarResponsavel`. Quem faz esse
 * desvio é `decidirSolicitacaoAcao`.
 */
type TipoAcaoSolicitada = 'movimentacao' | 'afastamento' | 'desvinculacao' | 'direcao';

/**
 * O pedido, na forma em que a aprovação vai executá-lo: os MESMOS campos do
 * evento funcional (`CamposDoEventoFuncional`), mais quem pediu e por quê.
 *
 * Herdar em vez de repetir a lista é o que garante que um campo novo no evento
 * chegue ao pedido — e vice-versa. As duas listas separadas divergiriam no campo
 * que só uma delas ganhasse.
 */
export interface NovaAcaoSolicitada extends CamposDoEventoFuncional {
	policial_id: number;
	tipo: TipoAcaoSolicitada;
	justificativa: string;
	solicitante_id: number;
	solicitante_nome: string;
}

/** Registra o pedido e devolve o id gerado. */
export async function criarSolicitacaoAcao(
	db: Database,
	pedido: NovaAcaoSolicitada
): Promise<number> {
	const row = await db
		.insert(policialAcaoSolicitacoes)
		.values({
			policial_id: pedido.policial_id,
			tipo: pedido.tipo,
			subtipo: pedido.subtipo ?? null,
			descricao: pedido.descricao ?? null,
			unidade_origem: pedido.unidade_origem ?? null,
			unidade_destino: pedido.unidade_destino ?? null,
			data_evento: pedido.data_evento ?? null,
			data_inicio: pedido.data_inicio ?? null,
			data_fim: pedido.data_fim ?? null,
			qtd_dias: pedido.qtd_dias ?? null,
			nup: pedido.nup ?? null,
			tipo_cid: pedido.tipo_cid ?? null,
			documento_r2_key: pedido.documento_r2_key ?? null,
			documento_nome: pedido.documento_nome ?? null,
			justificativa: pedido.justificativa,
			solicitante_id: pedido.solicitante_id,
			solicitante_nome: pedido.solicitante_nome
		})
		.returning({ id: policialAcaoSolicitacoes.id });
	return row[0]?.id;
}

/** Pedidos de um servidor, mais recentes primeiro — o quadro da ficha. */
export async function listarSolicitacoesAcaoDoPolicial(
	db: Database,
	policialId: number,
	limit = 20
): Promise<PolicialAcaoSolicitacao[]> {
	return db
		.select()
		.from(policialAcaoSolicitacoes)
		.where(eq(policialAcaoSolicitacoes.policial_id, policialId))
		.orderBy(desc(policialAcaoSolicitacoes.id))
		.limit(limit)
		.all();
}

export interface AcaoPendenteComPolicial extends PolicialAcaoSolicitacao {
	policial_nome: string;
	policial_matricula: string;
	policial_cargo: string;
	policial_lotacao: string;
}

/** Pendentes para a fila do Admin Geral, com a identificação do servidor alvo. */
export async function listarSolicitacoesAcaoPendentes(
	db: Database
): Promise<AcaoPendenteComPolicial[]> {
	const rows = await db
		.select({
			id: policialAcaoSolicitacoes.id,
			policial_id: policialAcaoSolicitacoes.policial_id,
			tipo: policialAcaoSolicitacoes.tipo,
			subtipo: policialAcaoSolicitacoes.subtipo,
			descricao: policialAcaoSolicitacoes.descricao,
			unidade_origem: policialAcaoSolicitacoes.unidade_origem,
			unidade_destino: policialAcaoSolicitacoes.unidade_destino,
			data_evento: policialAcaoSolicitacoes.data_evento,
			data_inicio: policialAcaoSolicitacoes.data_inicio,
			data_fim: policialAcaoSolicitacoes.data_fim,
			qtd_dias: policialAcaoSolicitacoes.qtd_dias,
			nup: policialAcaoSolicitacoes.nup,
			tipo_cid: policialAcaoSolicitacoes.tipo_cid,
			documento_r2_key: policialAcaoSolicitacoes.documento_r2_key,
			documento_nome: policialAcaoSolicitacoes.documento_nome,
			justificativa: policialAcaoSolicitacoes.justificativa,
			solicitante_id: policialAcaoSolicitacoes.solicitante_id,
			solicitante_nome: policialAcaoSolicitacoes.solicitante_nome,
			status: policialAcaoSolicitacoes.status,
			decidido_por: policialAcaoSolicitacoes.decidido_por,
			decidido_em: policialAcaoSolicitacoes.decidido_em,
			created_at: policialAcaoSolicitacoes.created_at,
			policial_nome: policiais.nome,
			policial_matricula: policiais.matricula,
			policial_cargo: policiais.cargo,
			policial_lotacao: policiais.lotacao
		})
		.from(policialAcaoSolicitacoes)
		.innerJoin(policiais, eq(policiais.id, policialAcaoSolicitacoes.policial_id))
		.where(eq(policialAcaoSolicitacoes.status, 'pendente'))
		.orderBy(desc(policialAcaoSolicitacoes.id))
		.all();
	return rows as AcaoPendenteComPolicial[];
}

/** Um pedido por id — para o download do anexo e para a execução da aprovação. */
export async function buscarSolicitacaoAcao(
	db: Database,
	id: number
): Promise<PolicialAcaoSolicitacao | undefined> {
	return db
		.select()
		.from(policialAcaoSolicitacoes)
		.where(eq(policialAcaoSolicitacoes.id, id))
		.get();
}

/**
 * FECHA o pedido, e devolve a linha fechada — ou `null` se ela já não estava
 * pendente.
 *
 * O `WHERE status='pendente'` é a mesma tranca de `decidirSolicitacaoCadastro`
 * (SEC-36), e aqui ela pesa mais: o efeito da aprovação é uma MOVIMENTAÇÃO, que
 * escreve na linha do tempo funcional. Dois cliques simultâneos gravariam duas
 * transferências para a mesma unidade, com duas portarias iguais.
 *
 * Fechar ANTES de executar é deliberado: quem perdeu a corrida recebe `null` e
 * não executa nada. O caso ruim é o inverso — executar e não conseguir fechar
 * deixaria o pedido pendente com o efeito já aplicado, e a segunda aprovação o
 * aplicaria de novo.
 */
export async function fecharSolicitacaoAcao(
	db: Database,
	id: number,
	aprovar: boolean,
	adminId: number
): Promise<PolicialAcaoSolicitacao | null> {
	const pedido = await db
		.select()
		.from(policialAcaoSolicitacoes)
		.where(
			and(eq(policialAcaoSolicitacoes.id, id), eq(policialAcaoSolicitacoes.status, 'pendente'))
		)
		.get();
	if (!pedido) return null;

	const r = await db
		.update(policialAcaoSolicitacoes)
		.set({
			status: aprovar ? 'aprovada' : 'rejeitada',
			decidido_por: adminId,
			decidido_em: new Date().toISOString()
		})
		.where(
			and(eq(policialAcaoSolicitacoes.id, id), eq(policialAcaoSolicitacoes.status, 'pendente'))
		);
	if (linhasAfetadas(r) === 0) return null;

	return { ...pedido, status: aprovar ? 'aprovada' : 'rejeitada' };
}
