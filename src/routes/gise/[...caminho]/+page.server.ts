/**
 * `/gise/*` — endereço antigo do módulo de Operações. Desde a fase 1 do
 * Ecossistema (PR 1.4b) as telas moram em `/operacoes/*`:
 *
 *   /gise, /gise/[id], /gise/operacoes, /gise/finalizadas, /gise/config
 *     → /operacoes/gise/…  (a escala extra e o cadastro de operações)
 *   /gise/planos/*         → /operacoes/planos/*  (o plano operacional)
 *   /gise/bem-vindo        → /  (a home de módulos)
 *
 * Este catch-all só redireciona quem chega por link salvo, preservando o resto
 * do caminho e a query. 301: o endereço morreu de propósito. As rotas de API
 * (`/api/gise/*`, `/api/planos/*`) NÃO mudaram.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const caminho = params.caminho ?? '';
	if (caminho === 'bem-vindo') redirect(301, '/');
	if (caminho === 'planos' || caminho.startsWith('planos/')) {
		redirect(301, `/operacoes/${caminho}${url.search}`);
	}
	redirect(301, `/operacoes/gise${caminho ? `/${caminho}` : ''}${url.search}`);
};
