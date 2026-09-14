/**
 * GET /api/gise/[id]/impacto-exclusao
 *
 * Quanto documento assinado e quanto arquivo a exclusão desta GISE vai
 * destruir. Só CONTA — não apaga nada.
 *
 * Existe para o modal de exclusão poder mostrar o número antes da confirmação.
 * A contagem não entra no `load` da página porque varre o R2 (`r2.list`), e
 * pagar essa ida de rede em toda visita a `/operacoes/gise/[id]` seria desperdício: o dado
 * só interessa a quem abriu o diálogo de excluir.
 *
 * Mesma permissão da exclusão em si (Admin Geral): saber quantos documentos
 * assinados uma GISE tem já é informação sobre a operação.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, getR2, buscarGiseEscala } from '$lib/db';
import { contarImpactoExclusaoGise } from '$lib/server/r2-cleanup';
import { giseIdParamSchema } from '$lib/schemas';
import { requireAdmin, badRequest, notFound } from '$lib/server/api';

export const GET: RequestHandler = async (event) => {
	const { locals, params, platform } = event;
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const parsed = giseIdParamSchema.safeParse(params);
	if (!parsed.success) return badRequest('ID de GISE inválido');
	const giseId = parsed.data.id;

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return notFound('GISE');

	const impacto = await contarImpactoExclusaoGise(db, getR2(platform), gise);
	return json(impacto);
};
