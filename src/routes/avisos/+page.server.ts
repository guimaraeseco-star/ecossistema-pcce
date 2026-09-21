/**
 * `/avisos` — a CAIXA DE ENTRADA dos perfis administrativos (E59): primeiro
 * as PENDÊNCIAS (o que depende de quem está logado, calculadas ao vivo e com
 * o link do lugar onde se resolvem), depois as NOTÍCIAS (o que o outro lado
 * fez, não lidas primeiro). É a mesma fonte dos badges do Início, dos
 * cartões dos módulos e da barra lateral: o número que chama e a lista que
 * explica.
 *
 * Quem tem caixa: o Admin Geral (a caixa `admin_geral`) e os admins de
 * seccional e de unidade (as lotações do escopo). Policial sem papel e
 * colaborador não têm — nada lhes é endereçado.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDB } from '$lib/db';
import { listarAvisos, marcarLidos } from '$lib/db/avisos';
import { obterRotaBemVindo } from '$lib/auth';
import { caixaDoUsuario, temCaixaDeAvisos } from '$lib/server/avisos/resumo';
import { pendenciasDoUsuario } from '$lib/server/avisos/pendencias';

export const load: PageServerLoad = async ({ locals, platform, cookies, depends }) => {
	const u = locals.usuario;
	if (!u) redirect(303, '/login');
	if (!temCaixaDeAvisos(u)) redirect(303, obterRotaBemVindo(u, cookies.get('admin_modulo')));
	depends('app:avisos');
	const db = getDB(platform);
	const [caixa, pendencias] = await Promise.all([
		caixaDoUsuario(db, u),
		pendenciasDoUsuario(db, u)
	]);
	const avisos = await listarAvisos(db, caixa);
	return { pendencias, avisos };
};

export const actions: Actions = {
	/** Marca como lidas: todas as não lidas da caixa, ou só os ids enviados. */
	marcarLidos: async ({ locals, platform, request }) => {
		const u = locals.usuario;
		if (!u || !temCaixaDeAvisos(u)) return fail(403, { error: 'Sem caixa de avisos.' });
		const db = getDB(platform);
		const fd = await request.formData();
		const ids = fd
			.getAll('id')
			.slice(0, 90)
			.map((v) => Number(v))
			.filter((n) => Number.isInteger(n) && n > 0);
		const todos = fd.get('todos') === '1';
		const caixa = await caixaDoUsuario(db, u);
		const n = await marcarLidos(
			db,
			caixa,
			{ id: u.id, nome: u.nome },
			new Date().toISOString(),
			todos ? undefined : ids
		);
		return { success: true, marcados: n };
	}
};
