/**
 * `/unidade` — GESTÃO DE UNIDADE, a lista (decisão E39, itens 3.2 e 3.3): a
 * raiz do escopo no topo e, abaixo, cada unidade filha com as suas, todas com
 * o efetivo por cargo e situação. Quem administra UMA unidade só (a delegacia)
 * não tem lista: vai direto à ficha dela (`/unidade/[id]`, item 3.1).
 *
 * O recorte é do servidor: `escopoDeUnidades` dá a raiz pelo papel (ou o
 * departamento, para o Admin Geral) e só a subárvore dela sai daqui. Quem não
 * administra unidade nenhuma recebe 403 — esconder o cartão na home não é
 * autorização.
 *
 * Municípios atendidos vêm de `unidade_municipios` (fase 2); veículos e armas
 * ainda não têm tabela (fase 4) — a tela mostra essas colunas com "—".
 */
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDB, type NoUnidade } from '$lib/db';
import {
	efetivoPorLotacao,
	efetivoVazio,
	somarEfetivos,
	type EfetivoLotacao
} from '$lib/db/efetivo';
import { municipiosPorUnidade, populacaoPorIbge } from '$lib/db/cobertura';
import { responsaveisVigentesDe, type ResponsavelDaUnidade } from '$lib/db/unidades-responsaveis';
import { pendenciasDeFeriasPorLotacao } from '$lib/db';
import { escopoDeUnidades } from '$lib/server/unidades/escopo';
import { nivelTipoUnidade, rotuloTipoUnidade } from '$lib/unidades/tipos';
import { hojeBrasilISO } from '$lib/utils/datas';

export interface LinhaUnidade {
	id: number;
	nome: string;
	sigla: string;
	tipo: string;
	tipoRotulo: string;
	/** A própria lotação. */
	efetivo: EfetivoLotacao;
	/** A unidade com tudo abaixo dela — igual a `efetivo` quando é folha. */
	subtotal: EfetivoLotacao;
	/** Quantas unidades respondem a ela (subárvore sem ela mesma e sem subdepartamento). */
	vinculadas: number;
	/** Municípios que a própria unidade atende. */
	municipios: number;
	/** Municípios DISTINTOS atendidos pela unidade e por tudo abaixo dela. */
	municipiosSubtotal: number;
	/** População (estimativa do IBGE ou Censo) dos municípios distintos da subárvore. */
	populacao: number;
	/** Habitantes por policial LOTADO na subárvore; `null` sem efetivo ou sem população. */
	habPorPolicial: number | null;
	/**
	 * Quem dirige a unidade hoje, ou `null` — que é RESPOSTA, não dado faltando:
	 * unidade de atendimento em regra não tem titular, e delegacia sem titular é
	 * o que a consulta de respondência procura (E54).
	 */
	direcao: { nome: string; papel: 'titular' | 'respondente'; policialId: number } | null;
	/**
	 * Pendências de férias da unidade COM a subárvore: pedidos aguardando a
	 * COGEP e abonos deferidos sem ciência. É ALERTA no cartão até a unidade
	 * resolver (decisão dele, 17/09).
	 */
	pendenciasFerias: { reprogramacoesPendentes: number; abonosSemCiencia: number };
}

export interface BlocoUnidade {
	unidade: LinhaUnidade;
	filhas: LinhaUnidade[];
}

/** O que a LISTA mostra da direção — nome e papel, sem o resto da linha. */
function resumoDaDirecao(
	r: ResponsavelDaUnidade | undefined
): { nome: string; papel: 'titular' | 'respondente'; policialId: number } | null {
	return r ? { nome: r.policial_nome, papel: r.papel, policialId: r.policial_id } : null;
}

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const db = getDB(platform);
	const escopo = await escopoDeUnidades(db, u);
	if (!escopo) error(403, 'Você não administra nenhuma unidade.');

	// Uma unidade só no escopo: a "lista" seria a própria ficha.
	if (escopo.nos.length === 1) redirect(302, `/unidade/${escopo.raiz.id}`);

	const [efetivos, ibgesPorUnidade, populacaoDe, direcoes, pendenciasPorLotacao] =
		await Promise.all([
			efetivoPorLotacao(db, hojeBrasilISO()),
			municipiosPorUnidade(db),
			populacaoPorIbge(db),
			// Quem dirige cada unidade, numa consulta só — é o que responde "quais
			// delegacias estão sem titular" sem abrir ficha por ficha (E54).
			responsaveisVigentesDe(
				db,
				escopo.nos.map((n) => n.id)
			),
			pendenciasDeFeriasPorLotacao(db)
		]);
	const filhosDe = (id: number) =>
		escopo.nos
			.filter((n) => n.seccional_id === id)
			.sort(
				(a, b) =>
					nivelTipoUnidade(a.tipo) - nivelTipoUnidade(b.tipo) ||
					a.nome.localeCompare(b.nome, 'pt-BR')
			);
	const descendentesDe = (id: number): NoUnidade[] =>
		filhosDe(id).flatMap((f) => [f, ...descendentesDe(f.id)]);

	const linha = (n: NoUnidade): LinhaUnidade => {
		const desc = descendentesDe(n.id);
		const proprio = efetivos.get(n.nome) ?? efetivoVazio();
		const subtotal = somarEfetivos([
			proprio,
			...desc.map((d) => efetivos.get(d.nome) ?? efetivoVazio())
		]);
		// Distintos: Juazeiro do Norte, atendido por duas DPs, conta uma vez —
		// nos municípios e na população.
		const ibgesDistintos = new Set([n, ...desc].flatMap((d) => ibgesPorUnidade.get(d.id) ?? []));
		let populacao = 0;
		for (const ibge of ibgesDistintos) populacao += populacaoDe.get(ibge) ?? 0;
		return {
			id: n.id,
			nome: n.nome,
			sigla: n.sigla,
			tipo: n.tipo,
			tipoRotulo: rotuloTipoUnidade(n.tipo),
			efetivo: proprio,
			subtotal,
			// Subdepartamento (o "DPI Sul - Juazeiro") é sede administrativa, não
			// unidade que responde ao departamento — o responsável pediu em
			// 15/09/2026 que ele não entre na contagem.
			vinculadas: desc.filter((d) => d.tipo !== 'sub_departamento').length,
			municipios: ibgesPorUnidade.get(n.id)?.length ?? 0,
			municipiosSubtotal: ibgesDistintos.size,
			populacao,
			habPorPolicial:
				subtotal.total > 0 && populacao > 0 ? Math.round(populacao / subtotal.total) : null,
			/**
			 * A direção de hoje, resumida para a lista: quem e em que papel.
			 *
			 * `null` é resposta, não ausência de dado — unidade de atendimento em
			 * regra não tem titular, e delegacia sem titular é justamente o que a
			 * consulta de respondência procura.
			 */
			direcao: resumoDaDirecao(direcoes.get(n.id)),
			pendenciasFerias: [n, ...desc].reduce(
				(acc, d) => {
					const p = pendenciasPorLotacao.get(d.nome);
					if (p) {
						acc.reprogramacoesPendentes += p.reprogramacoesPendentes;
						acc.abonosSemCiencia += p.abonosSemCiencia;
					}
					return acc;
				},
				{ reprogramacoesPendentes: 0, abonosSemCiencia: 0 }
			)
		};
	};

	const blocos: BlocoUnidade[] = filhosDe(escopo.raiz.id).map((f) => ({
		unidade: linha(f),
		filhas: descendentesDe(f.id).map(linha)
	}));

	return {
		usuario: u,
		raiz: linha(escopo.raiz),
		blocos
	};
};
