/**
 * `/ferias` — a porta do cartão "Férias" do Início: leva ao panorama de
 * férias da unidade RAIZ do escopo de quem entrou (a unidade do admin de
 * unidade, a seccional do admin de seccional, o departamento do Admin Geral,
 * a unidade do colaborador lotado). É só um redirecionamento: o panorama
 * mora em `/unidade/[id]/ferias`, que já agrega a subárvore.
 */
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDB } from '$lib/db';
import { escopoDeUnidades } from '$lib/server/unidades/escopo';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	const escopo = await escopoDeUnidades(getDB(platform), u);
	if (!escopo) error(403, 'Você não administra nenhuma unidade.');
	redirect(302, `/unidade/${escopo.raiz.id}/ferias${url.search}`);
};
