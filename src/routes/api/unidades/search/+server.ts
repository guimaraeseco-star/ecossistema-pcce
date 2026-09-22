/**
 * Busca de unidades para os `SearchableSelect` das telas.
 *
 * O `tipo` da query é conferido contra lista fechada em vez de ir direto ao
 * `WHERE`: são quatro níveis de hierarquia (delegacia, seccional, departamento,
 * sub-departamento) e um valor fora deles não é filtro novo — é consulta que
 * devolve vazio e faz a tela parecer quebrada.
 *
 * Exige sessão, mas não recorta por escopo: a lista de unidades é catálogo
 * institucional, não dado de ninguém. Quem recorta é a ação que usa o valor.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { asc, eq, and, inArray } from 'drizzle-orm';
import { getDB, buscaPorPartes } from '$lib/db';
import { unidades } from '$lib/server/schema';
import { requireAuth } from '$lib/server/api';

const TIPOS_VALIDOS = ['delegacia', 'seccional', 'departamento', 'sub_departamento'] as const;
type TipoUnidade = (typeof TIPOS_VALIDOS)[number];

function ehTipoValido(t: string): t is TipoUnidade {
	return (TIPOS_VALIDOS as readonly string[]).includes(t);
}

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const q = (url.searchParams.get('q') ?? '').trim();
	// `tipo` aceita um único valor ou uma lista separada por vírgula
	// (ex.: `tipo=delegacia,seccional`) para campos que abrangem mais de
	// um tipo de unidade — como a lotação, que inclui delegacias E seccionais.
	const tipos = (url.searchParams.get('tipo') ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter(ehTipoValido);
	const limitRaw = Number(url.searchParams.get('limit') ?? '20');
	const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

	const db = getDB(platform);
	const conditions = [];

	if (q) {
		conditions.push(buscaPorPartes([unidades.nome, unidades.sigla], q)!);
	}
	if (tipos.length === 1) {
		conditions.push(eq(unidades.tipo, tipos[0]));
	} else if (tipos.length > 1) {
		conditions.push(inArray(unidades.tipo, tipos));
	}

	const rows = await db
		.select({ id: unidades.id, nome: unidades.nome, tipo: unidades.tipo })
		.from(unidades)
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(asc(unidades.nome))
		.limit(limit);

	// `private` bloqueia cache em proxies/edge (defesa em profundidade — dados
	// só visíveis a usuários autenticados). Browser cacheia 60s e serve stale
	// por +300s enquanto revalida em background, eliminando o re-fetch a cada
	// keystroke de autocomplete (typeahead). Unidades mudam raramente (sync
	// via webhook), então 60s é seguro.
	return json(
		{ items: rows },
		{
			headers: {
				'Cache-Control': 'private, max-age=60, stale-while-revalidate=300'
			}
		}
	);
};
