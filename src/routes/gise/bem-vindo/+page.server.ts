/**
 * `/gise/bem-vindo` — endereço antigo da tela de entrada do console GISE do
 * Admin Geral. Desde a fase 1 do Ecossistema (decisão E39) a entrada é a home
 * de módulos; este arquivo só redireciona quem chega por link salvo (301: o
 * endereço morreu de propósito).
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	redirect(301, '/');
};
