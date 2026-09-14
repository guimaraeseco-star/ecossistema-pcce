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
 * Veículos, armas e municípios atendidos ainda não têm tabela (fases 2 e 4);
 * a tela mostra as colunas com "—" para a organização já ser a definitiva.
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
	/** Quantas unidades respondem a ela (subárvore sem ela mesma). */
	vinculadas: number;
}

export interface BlocoUnidade {
	unidade: LinhaUnidade;
	filhas: LinhaUnidade[];
}

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const db = getDB(platform);
	const escopo = await escopoDeUnidades(db, u);
	if (!escopo) error(403, 'Você não administra nenhuma unidade.');

	// Uma unidade só no escopo: a "lista" seria a própria ficha.
	if (escopo.nos.length === 1) redirect(302, `/unidade/${escopo.raiz.id}`);

	const efetivos = await efetivoPorLotacao(db, hojeBrasilISO());
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
		return {
			id: n.id,
			nome: n.nome,
			sigla: n.sigla,
			tipo: n.tipo,
			tipoRotulo: rotuloTipoUnidade(n.tipo),
			efetivo: proprio,
			subtotal: somarEfetivos([
				proprio,
				...desc.map((d) => efetivos.get(d.nome) ?? efetivoVazio())
			]),
			vinculadas: desc.length
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
