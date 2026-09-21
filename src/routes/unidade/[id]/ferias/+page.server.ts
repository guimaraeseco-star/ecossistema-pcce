/**
 * `/unidade/[id]/ferias` — as férias da unidade ao longo do ANO, mês a mês,
 * com o teto de 15 % (Dec. 32.907, art. 6º I) e as pendências.
 *
 * É a visão do gestor local: quem está programado em cada mês, quantos por
 * cento da unidade isso representa (só AVISA — o decreto tem exceções e a
 * decisão é do gestor, decisão dele de 17/09), os pedidos aguardando a COGEP
 * e os abonos sem ciência.
 *
 * Mesmo portão da ficha: a unidade tem de estar no escopo de quem chamou. A
 * seccional e o departamento veem a subárvore inteira, agrupada por unidade.
 */
import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { getDB, feriasDoAno, pendenciasDeFeriasPorLotacao, type NoUnidade } from '$lib/db';
import { unidades, policiais } from '$lib/server/schema';
import { escopoDeUnidades, unidadeNoEscopo } from '$lib/server/unidades/escopo';
import { hojeBrasilISO } from '$lib/utils/datas';
import { sql, and, inArray } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, platform, params, url }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'ID inválido');

	const db = getDB(platform);
	const escopo = await escopoDeUnidades(db, u);
	if (!escopo) error(403, 'Você não administra nenhuma unidade.');
	if (!unidadeNoEscopo(escopo, id)) error(403, 'Esta unidade está fora do seu escopo.');

	const unidade = await db
		.select({ id: unidades.id, nome: unidades.nome, sigla: unidades.sigla, tipo: unidades.tipo })
		.from(unidades)
		.where(eq(unidades.id, id))
		.get();
	if (!unidade) error(404, 'Unidade não encontrada');

	const anoBruto = Number(url.searchParams.get('ano'));
	const ano =
		Number.isInteger(anoBruto) && anoBruto >= 2000 && anoBruto <= 2100
			? anoBruto
			: Number(hojeBrasilISO().slice(0, 4));

	// A unidade e tudo abaixo dela, dentro do escopo.
	const descendentes: NoUnidade[] = [];
	const fila = escopo.nos.filter((n) => n.seccional_id === id);
	while (fila.length) {
		const n = fila.shift() as NoUnidade;
		descendentes.push(n);
		fila.push(...escopo.nos.filter((f) => f.seccional_id === n.id));
	}
	const lotacoes = [unidade.nome, ...descendentes.map((d) => d.nome)];

	const [ferias, pendencias, efetivos] = await Promise.all([
		feriasDoAno(db, lotacoes, ano),
		pendenciasDeFeriasPorLotacao(db),
		efetivoPorLotacoes(db, lotacoes)
	]);

	return {
		unidade,
		ano,
		ferias,
		/** Efetivo ativo por lotação — o denominador do teto de 15 %. */
		efetivos: Object.fromEntries(efetivos),
		pendencias: Object.fromEntries(
			lotacoes.map((l) => [
				l,
				pendencias.get(l) ?? { reprogramacoesPendentes: 0, abonosSemCiencia: 0 }
			])
		),
		lotacoes
	};
};

/** Servidores ativos por lotação, numa consulta — o denominador do teto. */
async function efetivoPorLotacoes(
	db: ReturnType<typeof getDB>,
	lotacoes: string[]
): Promise<Map<string, number>> {
	const mapa = new Map<string, number>();
	for (let i = 0; i < lotacoes.length; i += 90) {
		const fatia = lotacoes.slice(i, i + 90);
		if (fatia.length === 0) continue;
		const linhas = await db
			.select({ lotacao: policiais.lotacao, n: sql<number>`count(*)` })
			.from(policiais)
			.where(and(inArray(policiais.lotacao, fatia), eq(policiais.ativo, 1)))
			.groupBy(policiais.lotacao);
		for (const l of linhas) mapa.set(l.lotacao, l.n);
	}
	return mapa;
}
