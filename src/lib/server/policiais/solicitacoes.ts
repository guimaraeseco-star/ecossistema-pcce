/**
 * A decisão do Admin Geral sobre um pedido de AÇÃO DE RH — aprovar aqui não
 * fecha uma linha: movimenta, afasta ou inativa um servidor.
 *
 * Existe para que a rota `/solicitacoes` não precise saber como um ato de RH é
 * executado. Ela não sabe, e é esse o ponto: o efeito vem de `executarAcaoRH`, o
 * MESMO executor que a ficha usa no modo direto. Não há um segundo lugar onde o
 * efeito da movimentação seja montado, e portanto não há um segundo lugar de
 * onde ele possa divergir.
 *
 * O irmão deste fluxo — a decisão sobre um pedido de CAMPO — não precisou de
 * módulo: `decidirSolicitacaoCadastro` já fecha e aplica, gravando por
 * `atualizarPolicial` (que resolve cifra do CPF e normalização da matrícula).
 *
 * A ordem é: FECHAR o pedido primeiro, executar depois. Quem perde a corrida da
 * decisão recebe `null` e não executa nada; o inverso — executar e falhar ao
 * fechar — deixaria o servidor movimentado com o pedido ainda pendente, pronto
 * para ser movimentado de novo.
 */

import { eq } from 'drizzle-orm';
import { fecharSolicitacaoAcao, type Database } from '$lib/db';
import { registrarResponsavel } from '$lib/db/unidades-responsaveis';
import { unidades, type PolicialAcaoSolicitacao } from '$lib/server/schema';
import { executarAcaoRH, type AtorDaAcao } from './acoes-rh';

/**
 * Decide um pedido de ação de RH. Aprovar EXECUTA o ato (movimentar, afastar,
 * desvincular) creditando a linha do tempo a quem pediu — ver `AtorDaAcao`.
 * Devolve a linha decidida, ou `null` quando ela já não estava pendente.
 */
export async function decidirSolicitacaoAcao(
	db: Database,
	solicitacaoId: number,
	aprovar: boolean,
	adminId: number
): Promise<PolicialAcaoSolicitacao | null> {
	const pedido = await fecharSolicitacaoAcao(db, solicitacaoId, aprovar, adminId);
	if (!pedido || !aprovar) return pedido;

	// `solicitante_*` é nulo apenas em linha adulterada à mão; cair no aprovador
	// mantém a linha do tempo com um responsável em vez de um vazio.
	const ator: AtorDaAcao = {
		id: pedido.solicitante_id ?? adminId,
		nome: pedido.solicitante_nome ?? 'Solicitante'
	};

	// `direcao` não é ato sobre o SERVIDOR e sim sobre a UNIDADE: não entra na
	// linha do tempo funcional dele, entra na sucessão da unidade. Por isso não
	// passa por `executarAcaoRH` — o executor dos três atos que mexem no
	// cadastro — e sim por `registrarResponsavel`, que sabe encerrar o vigente
	// e abrir o novo na mesma transação.
	// `tipo` sai do objeto para uma variável porque é ela que o `if` ESTREITA:
	// `AcaoRH` admite só os três atos que aquele executor aplica, e sem isso o
	// compilador continuaria vendo o quarto do outro lado do early return.
	const { tipo } = pedido;
	if (tipo === 'direcao') {
		await registrarDirecaoDoPedido(db, pedido, adminId);
		return pedido;
	}

	await executarAcaoRH(db, pedido.policial_id, { ...pedido, tipo }, ator);
	return pedido;
}

/**
 * Aplica um pedido de direção aprovado.
 *
 * A unidade vem pelo NOME (`unidade_destino`), como todo o resto do sistema
 * ainda faz — é a dívida que a decisão E51 vai pagar. Unidade que sumiu entre o
 * pedido e a decisão faz a aprovação NÃO gravar nada: o pedido já está fechado,
 * e é melhor um pedido aprovado sem efeito, visível na fila, do que uma direção
 * registrada em unidade errada.
 */
async function registrarDirecaoDoPedido(
	db: Database,
	pedido: PolicialAcaoSolicitacao,
	adminId: number
): Promise<void> {
	const nome = (pedido.unidade_destino ?? '').trim();
	if (!nome || !pedido.data_inicio) return;
	const unidade = await db
		.select({ id: unidades.id })
		.from(unidades)
		.where(eq(unidades.nome, nome))
		.get();
	if (!unidade) return;
	await registrarResponsavel(db, {
		unidade_id: unidade.id,
		policial_id: pedido.policial_id,
		papel: pedido.subtipo === 'respondente' ? 'respondente' : 'titular',
		data_inicio: pedido.data_inicio,
		nup: pedido.nup ?? '',
		observacao: pedido.justificativa,
		registrado_por_id: adminId,
		registrado_por_nome: pedido.solicitante_nome ?? 'Solicitante'
	});
}
