/**
 * O que a LISTA (`/municipios`) e o MAPA (`/municipios/mapa`) carregam em
 * comum — a família de rotas de Municípios, decisão E32. Uma fonte só para as
 * duas telas: os municípios do departamento com quem atende (e a seccional de
 * quem atende), o efetivo lotado e a proporção habitantes por policial.
 *
 * A régua de acesso também mora aqui: escopo com departamento na raiz, senão
 * `null` — cada `load` transforma isso no 403. Pedido registrado do
 * responsável (16/09/2026): perguntar depois se o MAPA abre para todos os
 * níveis como consulta ("qual delegacia responde por esta região?").
 */
import { getDB } from '$lib/db';
import type { Database } from '$lib/db';
import { ancestraisDe } from '$lib/db';
import { municipiosDoDepartamento } from '$lib/db/cobertura';
import { efetivoPorLotacao } from '$lib/db/efetivo';
import { escopoDeUnidades, type EscopoUnidades } from '$lib/server/unidades/escopo';
import { nivelTipoUnidade } from '$lib/unidades/tipos';
import { hojeBrasilISO } from '$lib/utils/datas';
import type { UsuarioLogado } from '$lib/auth';

/** O escopo com departamento na raiz, ou `null` — a régua das telas de Municípios. */
export async function escopoDeDepartamento(
	db: Database,
	u: UsuarioLogado
): Promise<EscopoUnidades | null> {
	const escopo = await escopoDeUnidades(db, u);
	if (!escopo || nivelTipoUnidade(escopo.raiz.tipo) > nivelTipoUnidade('departamento')) return null;
	return escopo;
}

/** Os municípios com efetivo e proporção, mais o resumo do departamento. */
export async function carregarMunicipios(
	platform: App.Platform | undefined,
	escopo: EscopoUnidades
) {
	const db = getDB(platform);
	const [lista, efetivos] = await Promise.all([
		municipiosDoDepartamento(db, escopo.raiz.id),
		efetivoPorLotacao(db, hojeBrasilISO())
	]);
	const seccionalDe = (unidadeId: number) =>
		ancestraisDe(escopo.arvore, unidadeId).find((a) => a.tipo === 'seccional')?.nome ?? '';
	const municipios = lista.map((m) => {
		const efetivo = m.unidades.reduce((n, un) => n + (efetivos.get(un.nome)?.total ?? 0), 0);
		return {
			...m,
			unidades: m.unidades.map((un) => ({ ...un, seccional: seccionalDe(un.id) })),
			efetivo,
			/** Habitantes por policial lotado; `null` sem efetivo ou sem população. */
			habPorPolicial: efetivo > 0 && m.populacao != null ? Math.round(m.populacao / efetivo) : null
		};
	});
	// O efetivo do DEPARTAMENTO é o das unidades da subárvore, cada uma uma vez
	// — somar por município repetiria Iguatu em cada município que ela atende.
	const efetivoDepartamento = escopo.nos.reduce(
		(n, un) => n + (efetivos.get(un.nome)?.total ?? 0),
		0
	);
	return {
		departamento: {
			id: escopo.raiz.id,
			nome: escopo.raiz.nome,
			sigla: escopo.raiz.sigla,
			efetivo: efetivoDepartamento
		},
		municipios
	};
}

export type MunicipioDaTela = Awaited<ReturnType<typeof carregarMunicipios>>['municipios'][number];
