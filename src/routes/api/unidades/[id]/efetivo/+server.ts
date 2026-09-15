/**
 * `GET /api/unidades/[id]/efetivo?situacao=ativos|ferias|afastados&cargo=DPC|OIP&subarvore=1`
 * — quem são os servidores atrás de um número da Gestão de unidade (fase 2-C,
 * pedido do responsável em 15/09/2026): nome, matrícula, cargo, designação e,
 * para férias/afastados, o tipo e o período em curso.
 *
 * Autorização = a da Gestão de unidade: o `id` precisa estar no escopo de quem
 * chama (`escopoDeUnidades` + `unidadeNoEscopo`); fora dele é 403, e um id
 * chutado não lista o efetivo de outra seccional. Com `subarvore=1` entram as
 * unidades abaixo — o painel do departamento e da seccional.
 *
 * A situação vem de `servidoresPorSituacao` (mesma régua de `efetivoPorLotacao`
 * e de `afastamentoVigente`): os números da tela e a lista aqui batem sempre.
 */
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { servidoresPorSituacao } from '$lib/db/efetivo';
import { badRequest, forbidden, requireAuth } from '$lib/server/api';
import { escopoDeUnidades, unidadeNoEscopo } from '$lib/server/unidades/escopo';
import { subarvoreDe } from '$lib/db';
import { hojeBrasilISO } from '$lib/utils/datas';

export const GET: RequestHandler = async ({ locals, platform, params, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) return badRequest('ID inválido');
	const situacao = url.searchParams.get('situacao') ?? '';
	if (situacao && !['ativos', 'ferias', 'afastados'].includes(situacao))
		return badRequest('Situação inválida');
	const cargo = url.searchParams.get('cargo') ?? '';
	if (cargo && !['DPC', 'OIP'].includes(cargo)) return badRequest('Cargo inválido');
	const subarvore = url.searchParams.get('subarvore') === '1';

	const db = getDB(platform);
	const escopo = await escopoDeUnidades(db, u);
	if (!escopo || !unidadeNoEscopo(escopo, id)) return forbidden('Unidade fora do seu escopo');

	const unidade = escopo.arvore.get(id);
	if (!unidade) return forbidden('Unidade fora do seu escopo');
	const lotacoes = subarvore ? subarvoreDe(escopo.arvore, id).map((n) => n.nome) : [unidade.nome];

	const servidores = await servidoresPorSituacao(db, lotacoes, hojeBrasilISO(), {
		situacao: (situacao || undefined) as 'ativos' | 'ferias' | 'afastados' | undefined,
		cargo: (cargo || undefined) as 'DPC' | 'OIP' | undefined
	});
	return json({
		unidade: { id: unidade.id, nome: unidade.nome },
		hoje: hojeBrasilISO(),
		servidores
	});
};
