/**
 * Boas-vindas do COLABORADOR — a terceira identidade. Desde a E61 a tela diz
 * em que unidade ele está lotado e o que a unidade liberou (as chaves do
 * catálogo, com atalhos); sem lotação ou sem chave, continua a tela vazia
 * que o plano do módulo de diárias descreve como critério da fase 2.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { obterRotaBemVindo } from '$lib/auth';
import { ACESSOS_DO_COLABORADOR } from '$lib/colaboradores/acessos';

export const load: PageServerLoad = async ({ locals }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	// Policial e admin têm as próprias boas-vindas; esta é só do colaborador.
	if (u.tipo !== 'colaborador') redirect(302, obterRotaBemVindo(u));
	const liberadas = new Set(u.acessos ?? []);
	return {
		usuario: u,
		unidade:
			u.papel_unidade_id != null && u.lotacao ? { id: u.papel_unidade_id, nome: u.lotacao } : null,
		acessos: ACESSOS_DO_COLABORADOR.map((a) => ({ ...a, liberado: liberadas.has(a.chave) }))
	};
};
