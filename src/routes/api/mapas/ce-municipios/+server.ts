/**
 * `GET /api/mapas/ce-municipios` — a malha dos municípios do Ceará para o mapa
 * de Municípios (`/municipios/mapa`). Do R2, ou do IBGE na primeira vez
 * (`$lib/server/municipios/malha`). Só autenticado: a malha é pública no IBGE,
 * mas este endpoint gasta R2 e a consulta externa é nossa.
 *
 * Um dia de cache privado: a malha muda quando o IBGE redesenha limites —
 * praticamente nunca —, e um mapa aberto várias vezes ao dia não precisa baixar
 * 100 KB a cada abertura.
 */
import type { RequestHandler } from './$types';
import { tryGetR2 } from '$lib/db';
import { apiError, ErrorCode, requireAuth } from '$lib/server/api';
import { malhaDoCeara } from '$lib/server/municipios/malha';
import { logger } from '$lib/server/logger';

export const GET: RequestHandler = async ({ locals, platform, fetch }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const r2 = tryGetR2(platform);
	if (!r2) return apiError('Armazenamento indisponível', 503, ErrorCode.INTERNAL);
	try {
		const texto = await malhaDoCeara(r2, fetch);
		return new Response(texto, {
			headers: {
				'Content-Type': 'application/geo+json',
				'Cache-Control': 'private, max-age=86400'
			}
		});
	} catch (e) {
		logger.error('[api/mapas/ce-municipios]', { error: String(e) });
		return apiError('Não foi possível obter a malha dos municípios', 502, ErrorCode.UPSTREAM);
	}
};
