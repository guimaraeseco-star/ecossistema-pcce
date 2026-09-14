/**
 * `/config-custos` — endereço antigo da tela de valores de hora extra e
 * diária. Desde a fase 1 do Ecossistema (PR 1.4a, decisão E39) ela mora em
 * `/valores`, aberta ao Admin Geral; este arquivo só redireciona quem chega
 * por link salvo (301: o endereço morreu de propósito).
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	redirect(301, '/valores');
};
