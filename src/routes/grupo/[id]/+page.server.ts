/**
 * `/grupo/[id]` — a TELA DE UM GRUPO da home (decisão E39): os cartões
 * detalhados de Gestão de pessoal, operacional, de unidade ou administrativa.
 * O Início (`/`) mostra os quatro cartões grandes; aqui abre-se um deles.
 *
 * O id vem da URL e é conferido contra a lista fechada dos quatro; o grupo em
 * si é montado no cliente, a partir das MESMAS flags da sidebar
 * (`home-modulos.ts`), então este `load` só garante sessão, perfil com home e
 * id conhecido — o que o usuário NÃO alcança já não entra no grupo.
 */
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { obterRotaBemVindo } from '$lib/auth';
import { ehGrupoHomeId, temHomeDeModulos } from '../../_components/home-modulos';

export const load: PageServerLoad = async ({ locals, cookies, params }) => {
	const u = locals.usuario;
	if (!u) redirect(303, '/login');
	if (!temHomeDeModulos(u)) redirect(303, obterRotaBemVindo(u, cookies.get('admin_modulo')));
	if (!ehGrupoHomeId(params.id)) error(404, 'Área de gestão não encontrada');
	return { usuario: u, grupoId: params.id };
};
