/**
 * `/municipios/mapa` — o MAPA dos municípios do departamento (fase 2-B, E32):
 * os mesmos dados da lista, desenhados sobre a malha do IBGE. Mesma régua de
 * acesso da lista (departamento para cima) — ver `_components/carregar.ts`,
 * onde está anotado o pedido de rever isso depois.
 */
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDB } from '$lib/db';
import { carregarMunicipios, escopoDeDepartamento } from '../_components/carregar';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const escopo = await escopoDeDepartamento(getDB(platform), u);
	if (!escopo) error(403, 'Municípios é visto de departamento para cima.');

	return carregarMunicipios(platform, escopo);
};
