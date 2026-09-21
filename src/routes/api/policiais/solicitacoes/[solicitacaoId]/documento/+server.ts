/**
 * Baixa a portaria/documento anexado a uma SOLICITAÇÃO de movimentação,
 * afastamento ou desvinculação ainda pendente de decisão.
 *
 * Existe porque a aprovação não pode ser dada às cegas: o Admin Geral precisa
 * LER o documento antes de mover ou inativar um servidor. Enquanto o pedido está
 * na fila, o PDF não pertence a nenhum evento do histórico — a única linha que o
 * referencia é a da solicitação, e é dela que esta rota parte.
 *
 * A permissão é a MESMA da ficha do servidor (`carregarFichaDoPolicial`): Admin
 * Geral, ou o administrador da unidade/seccional do servidor alvo — que é quem
 * enviou o documento e precisa conferir o que enviou. Reusar o portão, em vez de
 * escrever um `requireAdmin` aqui, é o que mantém as duas telas e este download
 * concordando sobre quem alcança o quê.
 */
import type { RequestHandler } from './$types';
import { getDB, getR2, hasR2, buscarSolicitacaoAcao } from '$lib/db';
import { badRequest, notFound, serverError, contentDisposition } from '$lib/server/api';
import { carregarFichaDoPolicial, recusaComoResposta } from '$lib/server/policiais/ficha-permissao';
export const GET: RequestHandler = async ({ platform, params, locals }) => {
	const solicitacaoId = Number(params.solicitacaoId);
	if (isNaN(solicitacaoId)) return badRequest('ID inválido');

	const db = getDB(platform);
	const pedido = await buscarSolicitacaoAcao(db, solicitacaoId);
	if (!pedido || !pedido.documento_r2_key) return notFound('Documento');

	// O escopo é conferido contra o SERVIDOR ALVO do pedido, não contra o
	// solicitante: é o alvo que define de quem é o dado pessoal no PDF.
	const ficha = await carregarFichaDoPolicial(
		db,
		locals.usuario,
		String(pedido.policial_id),
		'servidores.ver'
	);
	if ('erro' in ficha) return recusaComoResposta(ficha.erro);

	if (!hasR2(platform)) {
		return serverError(
			'[policiais/solicitacoes/documento] R2 não configurado',
			new Error('R2_NOT_CONFIGURED')
		);
	}

	const objeto = await getR2(platform).get(pedido.documento_r2_key);
	if (!objeto) return notFound('Arquivo PDF no Storage');

	return new Response(objeto.body as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(
				pedido.documento_nome || `documento_solicitacao_${solicitacaoId}.pdf`
			),
			'Cache-Control': 'private, no-store'
		}
	});
};
