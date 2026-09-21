/**
 * As escalas ordinárias da unidade do colaborador — SÓ LEITURA (E61: a
 * decisão dele foi "só ver"). Lista própria, e não a `/escalas` dos admins,
 * porque aquela é toda feita de ações (criar, excluir, solicitar) que ele
 * não tem; o detalhe abre em `/escalas/[id]`, que já sabe ficar em leitura
 * (`podeMexerNaEscala` é falso para ele).
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { colaboradorTemAcesso } from '$lib/auth';
import { getDB, listarEscalas } from '$lib/db';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (!colaboradorTemAcesso(u, 'escalas.ver') || !u.lotacao) redirect(302, '/colaborador');

	const hoje = new Date();
	const mes = Number(url.searchParams.get('mes')) || hoje.getMonth() + 1;
	const ano = Number(url.searchParams.get('ano')) || hoje.getFullYear();
	const db = getDB(platform);
	const { escalas } = await listarEscalas(
		db,
		u.lotacao,
		undefined,
		mes,
		ano,
		undefined,
		undefined,
		undefined,
		{
			limit: 100
		}
	);
	return {
		unidade: u.lotacao,
		mes,
		ano,
		escalas: escalas.map((e) => ({
			id: e.id,
			titulo: e.titulo,
			tipo: e.tipo,
			data_inicio: e.data_inicio,
			data_fim: e.data_fim,
			assinada: e.is_assinada,
			finalizada: !!e.finalizada_em
		}))
	};
};
