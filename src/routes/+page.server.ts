/**
 * `/` — a HOME DE MÓDULOS dos perfis administrativos (sessão de admin e os
 * dois papéis com escopo), decisão E39. Para os demais continua sendo a porta
 * que manda cada um à sua tela de entrada (`obterRotaBemVindo`): policial sem
 * papel para `/bem-vindo`, Super Admin para o console dele, colaborador para a
 * área dele.
 *
 * O que a home mostra vem de `_components/home-modulos.ts`, a partir das MESMAS
 * flags da sidebar — este `load` só entrega o usuário; os sinais que dependem
 * do banco (supervisor, base pendente, presença) já vêm do `+layout.server.ts`.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { obterRotaBemVindo } from '$lib/auth';
import { temHomeDeModulos } from './_components/home-modulos';

export const load: PageServerLoad = async ({ locals, cookies }) => {
	const u = locals.usuario;
	if (!u) redirect(303, '/login');

	if (!temHomeDeModulos(u)) {
		redirect(303, obterRotaBemVindo(u, cookies.get('admin_modulo')));
	}
	return { usuario: u };
};
