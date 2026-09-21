/**
 * Baixa o documento PDF (Portaria/afastamento/desvinculação) anexado a um
 * evento do histórico funcional do policial.
 *
 * A permissão é a MESMA da ficha (`carregarFichaDoPolicial`): Admin Geral, ou o
 * administrador da unidade/seccional do servidor — que desde ago/2026 também vê
 * a timeline e precisa abrir a portaria que consta dela. Reusar o portão, em vez
 * de repetir um `requireAdmin` aqui, é o que impede a tela e o download de
 * discordarem sobre quem alcança o quê.
 */
import type { RequestHandler } from './$types';
import { getDB, getR2, hasR2, buscarEventoHistorico } from '$lib/db';
import { badRequest, notFound, serverError, contentDisposition } from '$lib/server/api';
import { carregarFichaDoPolicial, recusaComoResposta } from '$lib/server/policiais/ficha-permissao';
export const GET: RequestHandler = async ({ platform, params, locals }) => {
	const eventoId = Number(params.eventoId);
	if (isNaN(eventoId)) return badRequest('ID inválido');

	const db = getDB(platform);
	const evento = await buscarEventoHistorico(db, eventoId);
	if (!evento || !evento.documento_r2_key) return notFound('Documento');

	// O escopo é conferido contra o SERVIDOR do evento: é dele o dado pessoal
	// que o PDF carrega.
	const ficha = await carregarFichaDoPolicial(
		db,
		locals.usuario,
		String(evento.policial_id),
		'servidores.ver'
	);
	if ('erro' in ficha) return recusaComoResposta(ficha.erro);

	if (!hasR2(platform)) {
		return serverError(
			'[policiais/historico/documento] R2 não configurado',
			new Error('R2_NOT_CONFIGURED')
		);
	}

	const objeto = await getR2(platform).get(evento.documento_r2_key);
	if (!objeto) return notFound('Arquivo PDF no Storage');

	return new Response(objeto.body as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(
				evento.documento_nome || `documento_${eventoId}.pdf`
			),
			'Cache-Control': 'private, no-store'
		}
	});
};
