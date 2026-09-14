/**
 * `/policiais/*` — endereço antigo do módulo de Servidores. Desde a fase 1 do
 * Ecossistema (PR 1.4a) a tela mora em `/servidores/*`; este catch-all só
 * redireciona quem chega por link salvo, preservando o resto do caminho e a
 * query (`/policiais/12` → `/servidores/12`, `/policiais?lotacao=X` →
 * `/servidores?lotacao=X`). 301: o endereço morreu de propósito. As rotas de
 * API (`/api/policiais/*`) NÃO mudaram.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const resto = params.caminho ? `/${params.caminho}` : '';
	redirect(301, `/servidores${resto}${url.search}`);
};
