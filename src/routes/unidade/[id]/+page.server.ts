/**
 * `/unidade/[id]` — a FICHA da unidade (decisão E39, item 3.1): o que a
 * delegacia vê de si mesma, e o que seccional e departamento veem ao clicar
 * numa unidade da lista.
 *
 * O id vem da URL, e por isso a pergunta do guard: a unidade está no escopo
 * de quem chamou? Fora dele é 403 — a hierarquia decide o que se abre, e um id
 * chutado não abre a ficha de outra seccional.
 *
 * A ficha tem: identificação e contato (endereço, telefone, e-mail, foto —
 * migração 0085), posição na árvore, AIS, tira-gravame, xadrezes, regimes de
 * escala, efetivo por cargo e situação (com link para a lista de servidores),
 * os municípios atendidos com o plantão de cada um (0086) e as unidades
 * vinculadas. Veículos e armas (fase 4) seguem como campos previstos.
 */
import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { getDB, ancestraisDe, type NoUnidade } from '$lib/db';
import { unidades } from '$lib/server/schema';
import { efetivoPorLotacao, efetivoVazio, somarEfetivos } from '$lib/db/efetivo';
import { municipiosDaUnidade } from '$lib/db/cobertura';
import { escopoDeUnidades, unidadeNoEscopo } from '$lib/server/unidades/escopo';
import { nivelTipoUnidade, rotuloTipoUnidade } from '$lib/unidades/tipos';
import { hojeBrasilISO } from '$lib/utils/datas';

export const load: PageServerLoad = async ({ locals, platform, params }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'ID inválido');

	const db = getDB(platform);
	const escopo = await escopoDeUnidades(db, u);
	if (!escopo) error(403, 'Você não administra nenhuma unidade.');
	if (!unidadeNoEscopo(escopo, id)) error(403, 'Esta unidade está fora do seu escopo.');

	const unidade = await db.select().from(unidades).where(eq(unidades.id, id)).get();
	if (!unidade) error(404, 'Unidade não encontrada');

	const [efetivos, municipiosAtendidos] = await Promise.all([
		efetivoPorLotacao(db, hojeBrasilISO()),
		municipiosDaUnidade(db, id)
	]);
	const porNome = (n: NoUnidade) => efetivos.get(n.nome) ?? efetivoVazio();
	const efetivo = porNome({ ...unidade });
	const populacaoAtendida = municipiosAtendidos.reduce((n, m) => n + (m.populacao ?? 0), 0);

	const filhas = escopo.nos
		.filter((n) => n.seccional_id === id)
		.sort(
			(a, b) =>
				nivelTipoUnidade(a.tipo) - nivelTipoUnidade(b.tipo) || a.nome.localeCompare(b.nome, 'pt-BR')
		);
	// Tudo abaixo desta unidade, dentro do escopo (a subárvore dela é subconjunto).
	const descendentes: NoUnidade[] = [];
	const fila = [...filhas];
	while (fila.length) {
		const n = fila.shift() as NoUnidade;
		descendentes.push(n);
		fila.push(...escopo.nos.filter((f) => f.seccional_id === n.id));
	}

	// O pai pode estar FORA do escopo (a seccional vê o departamento acima
	// dela): vai como texto, e só vira link quando está dentro.
	const pai = ancestraisDe(escopo.arvore, id)[0] ?? null;

	return {
		usuario: u,
		unidade: {
			id: unidade.id,
			nome: unidade.nome,
			sigla: unidade.sigla,
			tipo: unidade.tipo,
			tipoRotulo: rotuloTipoUnidade(unidade.tipo),
			cidade: unidade.cidade,
			abrangencia: unidade.abrangencia,
			tem_plantao: unidade.tem_plantao,
			tem_expediente: unidade.tem_expediente,
			tem_fds: unidade.tem_fds,
			endereco: unidade.endereco,
			telefone: unidade.telefone,
			email: unidade.email,
			/** A foto sai por `/api/unidades/[id]/foto` (R2, ou o link de origem). */
			temFoto: !!(unidade.foto_key || unidade.foto_url),
			ais: unidade.ais,
			tira_gravame: unidade.tira_gravame,
			xadrezes: unidade.xadrezes
		},
		municipios: municipiosAtendidos,
		populacaoAtendida,
		habPorPolicial:
			populacaoAtendida > 0 && efetivo.total > 0
				? Math.round(populacaoAtendida / efetivo.total)
				: null,
		pai: pai
			? {
					id: pai.id,
					nome: pai.nome,
					tipoRotulo: rotuloTipoUnidade(pai.tipo),
					noEscopo: unidadeNoEscopo(escopo, pai.id)
				}
			: null,
		ehRaizDoEscopo: escopo.raiz.id === id,
		efetivo,
		subtotal: somarEfetivos([porNome({ ...unidade }), ...descendentes.map(porNome)]),
		filhas: filhas.map((f) => ({
			id: f.id,
			nome: f.nome,
			sigla: f.sigla,
			tipoRotulo: rotuloTipoUnidade(f.tipo),
			efetivo: porNome(f)
		})),
		totalVinculadas: descendentes.length
	};
};
