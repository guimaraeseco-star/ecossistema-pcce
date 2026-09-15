/**
 * `/municipios/[ibge]` — a FICHA do município (fase 2-B, decisão E32): a
 * cobertura inteira de `municipios_cobertura` (AIS, núcleo de custódia, RISP,
 * PM, BM, PEFOCE, macrorregião, área, população), quem atende e o plantão.
 *
 * O IBGE vem da URL, e por isso a pergunta do guard: o município é do
 * departamento de quem chamou? Fora dele é 403 — mesma régua da lista.
 */
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDB, ancestraisDe } from '$lib/db';
import { fichaDoMunicipio } from '$lib/db/cobertura';
import { efetivoPorLotacao } from '$lib/db/efetivo';
import { hojeBrasilISO } from '$lib/utils/datas';
import { escopoDeUnidades } from '$lib/server/unidades/escopo';
import { nivelTipoUnidade } from '$lib/unidades/tipos';

export const load: PageServerLoad = async ({ locals, platform, params }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (!/^\d{7}$/.test(params.ibge)) error(400, 'Código IBGE inválido');

	const db = getDB(platform);
	const escopo = await escopoDeUnidades(db, u);
	if (!escopo || nivelTipoUnidade(escopo.raiz.tipo) > nivelTipoUnidade('departamento')) {
		error(403, 'Municípios é visto de departamento para cima.');
	}

	const municipio = await fichaDoMunicipio(db, params.ibge);
	if (!municipio) error(404, 'Município não encontrado');
	if (municipio.departamentoId !== escopo.raiz.id) {
		error(403, 'Este município está fora do seu departamento.');
	}

	// A seccional de cada unidade que atende — o primeiro ancestral do tipo —
	// e o efetivo lotado dela, que é a base da proporção habitantes/policial.
	const efetivos = await efetivoPorLotacao(db, hojeBrasilISO());
	const unidades = municipio.unidades.map((un) => ({
		...un,
		seccional: ancestraisDe(escopo.arvore, un.id).find((a) => a.tipo === 'seccional')?.nome ?? '',
		efetivo: efetivos.get(un.nome)?.total ?? 0
	}));
	const efetivo = unidades.reduce((n, un) => n + un.efetivo, 0);

	return {
		departamento: { id: escopo.raiz.id, nome: escopo.raiz.nome, sigla: escopo.raiz.sigla },
		municipio: {
			...municipio,
			unidades,
			efetivo,
			habPorPolicial:
				efetivo > 0 && municipio.populacao != null
					? Math.round(municipio.populacao / efetivo)
					: null
		}
	};
};
