/**
 * `GET /api/unidades/[id]/foto` — a foto da unidade para a ficha de Gestão de
 * unidade (fase 2, migração 0085).
 *
 * Prefere a cópia no R2 (`foto_key`, feita pelo script de importação depois
 * de conferir que o link abre); sem ela, redireciona para o link de origem
 * (`foto_url`, Google Drive). Assim a ficha tem UMA URL estável e a origem da
 * imagem pode mudar sem mexer na tela.
 *
 * Exige sessão, mas não recorta por escopo: a foto da fachada de uma delegacia
 * é dado institucional, não de pessoa (a mesma régua de `/api/unidades/search`).
 * Só leitura — não há operação material aqui.
 */
import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { getDB, tryGetR2 } from '$lib/db';
import { unidades } from '$lib/server/schema';
import { requireAuth, notFound } from '$lib/server/api';

const TIPO_POR_EXTENSAO: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
};

export const GET: RequestHandler = async ({ locals, platform, params }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) return notFound('Unidade');

	const db = getDB(platform);
	const unidade = await db
		.select({ foto_key: unidades.foto_key, foto_url: unidades.foto_url })
		.from(unidades)
		.where(eq(unidades.id, id))
		.get();
	if (!unidade) return notFound('Unidade');

	if (unidade.foto_key) {
		const r2 = tryGetR2(platform);
		const objeto = r2 ? await r2.get(unidade.foto_key) : null;
		if (objeto) {
			const ext = unidade.foto_key.split('.').pop()?.toLowerCase() ?? 'jpg';
			return new Response(await objeto.arrayBuffer(), {
				headers: {
					'Content-Type':
						objeto.httpMetadata?.contentType ?? TIPO_POR_EXTENSAO[ext] ?? 'image/jpeg',
					// Fachada muda raramente; um dia de cache privado poupa o R2 sem
					// prender uma foto trocada por mais que isso.
					'Cache-Control': 'private, max-age=86400'
				}
			});
		}
	}
	if (unidade.foto_url) redirect(302, unidade.foto_url);
	return notFound('Foto');
};
