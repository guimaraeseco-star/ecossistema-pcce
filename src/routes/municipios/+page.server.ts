/**
 * `/municipios` — os MUNICÍPIOS cobertos pelo departamento (fase 2-B, decisão
 * E32): a lista inversa da Gestão de unidade. Cada linha diz quem atende o
 * município, a AIS, a macrorregião, quem faz o plantão na semana e no fim de
 * semana, a população e a proporção habitantes/policial; o nome abre a ficha
 * (`/municipios/[ibge]`). O que se carrega é o mesmo do mapa
 * (`_components/carregar.ts`).
 *
 * De departamento para cima: o escopo precisa ter um departamento na raiz —
 * admin de seccional e de unidade recebem 403, e o recorte de dados é
 * `municipios_cobertura.departamento_id = raiz`, para um Admin Geral não ver
 * o mapa de outro departamento quando houver mais de um.
 *
 * A única escrita é `atualizarPopulacao`: baixa Censo e estimativa do IBGE
 * (`$lib/server/municipios/ibge`) para a cobertura inteira. Admin Geral, e não
 * qualquer sessão: são dezenas de UPDATEs no D1 e uma chamada externa.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDB } from '$lib/db';
import { atualizarPopulacaoIbge } from '$lib/server/municipios/ibge';
import { logger } from '$lib/server/logger';
import { agoraBrasilISO } from '$lib/utils/datas';
import { carregarMunicipios, escopoDeDepartamento } from './_components/carregar';

export const load: PageServerLoad = async ({ locals, platform, depends }) => {
	depends('app:municipios');
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const escopo = await escopoDeDepartamento(getDB(platform), u);
	if (!escopo) error(403, 'Municípios é visto de departamento para cima.');

	return carregarMunicipios(platform, escopo);
};

export const actions: Actions = {
	/** Baixa a população do IBGE (Censo 2022 + última estimativa) para a cobertura. */
	atualizarPopulacao: async ({ locals, platform, fetch }) => {
		const u = locals.usuario;
		if (!u || u.tipo !== 'admin') {
			return fail(403, { error: 'Só o Admin Geral atualiza a população' });
		}
		const db = getDB(platform);
		if (!(await escopoDeDepartamento(db, u))) {
			return fail(403, { error: 'Municípios é visto de departamento para cima.' });
		}
		try {
			const r = await atualizarPopulacaoIbge(db, fetch, agoraBrasilISO());
			return { success: true, ...r };
		} catch (e) {
			logger.error('[municipios/atualizarPopulacao]', { error: String(e) });
			return fail(502, { error: 'O IBGE não respondeu. Tente de novo mais tarde.' });
		}
	}
};
