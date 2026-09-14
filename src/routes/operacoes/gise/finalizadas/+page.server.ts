/**
 * `/operacoes/gise/finalizadas` — arquivo das escalas extras já encerradas (Admin Geral).
 *
 * Era o bloco Histórico no rodapé de `/operacoes/gise`. Quem não é Admin Geral não via
 * aquele bloco, e não vê esta rota: o `load` manda de volta para a lista de
 * ativas. Esconder a aba no menu não é autorização.
 */
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getDB, listarGiseEscalas, listarOperacoes } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { eq, asc } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';

export const load: PageServerLoad = async ({ locals, platform, depends }) => {
	depends('app:gise-list');

	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (!isAdminGeral(u)) redirect(302, '/operacoes/gise');

	const db = getDB(platform);
	const [escalas, seccionaisList, operacoes] = await Promise.all([
		listarGiseEscalas(db),
		db
			.select({ id: unidades.id, nome: unidades.nome })
			.from(unidades)
			.where(eq(unidades.tipo, 'seccional'))
			.orderBy(asc(unidades.nome))
			.all(),
		listarOperacoes(db)
	]);

	return {
		escalas: escalas.filter((e) => e.status === 'finalizada'),
		operacoes,
		seccionaisList,
		isGeral: true
	};
};
