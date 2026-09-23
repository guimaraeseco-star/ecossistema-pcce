/**
 * Troca o CHAPÉU da sessão (E71): "Departamento (rede)" ou "Unidade".
 *
 * O DPI SUL é duas coisas ao mesmo tempo — a rede que administra as delegacias
 * e uma casa com os seus próprios servidores —, e quem opera pelo departamento
 * precisa dizer em qual das duas está agindo. O chapéu é preferência de
 * navegação, como o `admin_modulo`: mora num COOKIE, não na linha da sessão,
 * para que duas abas possam ficar em chapéus diferentes sem uma derrubar a
 * outra.
 *
 * Não concede nada. O chapéu só ENCOLHE o alcance (de toda a subárvore do nó
 * para o nó e as suas subunidades); quem não tem nó não tem chapéu para
 * trocar, e por isso a recusa aqui é 403 e não um cookie gravado à toa.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cookieOptions } from '$lib/server/auth/auth-flow';
import { requireAuth, forbidden, badRequest } from '$lib/server/api';
import { temChapeu } from '$lib/server/unidades/escopo';

export const POST: RequestHandler = async ({ cookies, locals, request, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (!temChapeu(u)) {
		return forbidden('Este perfil não tem os dois chapéus.');
	}

	const corpo = (await request.json().catch(() => null)) as { chapeu?: unknown } | null;
	const chapeu = corpo?.chapeu;
	if (chapeu !== 'rede' && chapeu !== 'unidade') {
		return badRequest('Chapéu inválido.');
	}

	cookies.set('atuando_como', chapeu, cookieOptions(url));
	return json({ success: true, chapeu });
};
