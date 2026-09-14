/**
 * `/produtividade/*` — endereço antigo dos indicadores de produtividade. Desde a fase 1 do
 * Ecossistema (PR 1.4b) a tela mora em `/operacoes/produtividade/*`; este catch-all
 * só redireciona quem chega por link salvo, preservando caminho e query
 * (301: o endereço morreu de propósito). As rotas de API não mudaram.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const resto = params.caminho ? `/${params.caminho}` : '';
	redirect(301, `/operacoes/produtividade${resto}${url.search}`);
};
