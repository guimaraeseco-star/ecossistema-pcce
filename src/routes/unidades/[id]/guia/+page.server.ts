/**
 * `/unidades/[id]/guia` — o GUIA passo a passo dos atos de estrutura (E73,
 * parte 2): desativar uma unidade e transferi-la para outra unidade-mãe.
 *
 * A trava (parte 1) recusa e diz os passos num texto. O guia é o mesmo
 * conteúdo transformado em caminho: cada passo com o seu estado (feito ou por
 * fazer), cada pessoa com o link para a ficha dela, e o ato final executado
 * aqui mesmo quando nada mais impede. A decisão dele: "barre até ele fazer o
 * passo correto pelo guia indicativo".
 *
 * Três regras que seguram o guia:
 *
 * - **Os passos saem das MESMAS pendências da trava** (`pendenciasDa…`, em
 *   `$lib/server/unidades/travas`). O guia não calcula nada por conta própria:
 *   se calculasse, um dia a recusa diria "não pode" e o guia diria "pode".
 * - **O guia recalcula a cada visita.** A pessoa sai para a ficha de um
 *   servidor, resolve, volta — e o passo aparece feito. Não há estado guardado
 *   do guia: a verdade é o banco.
 * - **O ato final passa pelas mesmas travas** (`$lib/server/unidades/atos`).
 *   O botão só aparece quando nada impede, mas o servidor confere de novo na
 *   hora — entre abrir o guia e clicar, alguém pode ter lotado um servidor ali.
 *
 * Os atos de RH (lotar, mudar o "trabalha em") o guia CONDUZ, com link para a
 * ficha; os de estrutura (desativar, trocar a mãe) ele EXECUTA, avisando antes.
 * Mesma porta da tela `/unidades`: só o Super Admin.
 *
 * Os textos dos passos moram aqui por ora; com a E74 (o manual, que fica por
 * último, decisão de 26/09) eles passam para o manual e viram uma fonte só.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import {
	ancestraisDe,
	arvoreUnidades,
	getDB,
	motivoParaRecusarSuperior,
	subarvoreDe
} from '$lib/db';
import { unidades } from '$lib/server/schema';
import { nivelTipoUnidade } from '$lib/unidades/tipos';
import { pendenciasDaDesativacao, pendenciasDaTrocaDeMae } from '$lib/server/unidades/travas';
import { alternarAtivoDaUnidade, trocarMaeDaUnidade } from '$lib/server/unidades/atos';

type Ato = 'desativar' | 'transferir';

function lerAto(valor: unknown): Ato | null {
	return valor === 'desativar' || valor === 'transferir' ? valor : null;
}

function lerId(valor: unknown): number | null {
	const n = Number(valor);
	return Number.isInteger(n) && n > 0 ? n : null;
}

export const load: PageServerLoad = async ({ locals, platform, params, url }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (!u.isSuperAdmin) redirect(302, '/');

	const id = lerId(params.id);
	if (id == null) error(400, 'ID inválido');

	const db = getDB(platform);
	const unidade = await db
		.select({
			id: unidades.id,
			nome: unidades.nome,
			tipo: unidades.tipo,
			ativo: unidades.ativo,
			seccional_id: unidades.seccional_id
		})
		.from(unidades)
		.where(eq(unidades.id, id))
		.get();
	if (!unidade) error(404, 'Unidade não encontrada');

	const arvore = await arvoreUnidades(db);
	/** De cima para baixo: ["DPI SUL", "1ª Seccional", "Aracati"]. */
	const trilha = (noId: number) => [...ancestraisDe(arvore, noId)].reverse().map((n) => n.nome);
	const trilhaAtual = [...trilha(id), unidade.nome];

	const ato = lerAto(url.searchParams.get('ato'));

	if (ato === 'desativar') {
		return {
			unidade,
			trilhaAtual,
			ato,
			desativar: await pendenciasDaDesativacao(db, id),
			transferir: null,
			opcoesDeMae: []
		};
	}

	if (ato === 'transferir') {
		// As mães possíveis: ativas, fora da própria unidade e do que está abaixo
		// dela (pendurar numa filha fecharia um ciclo). Mesma lista da janela de
		// editar, na mesma ordem: por nível na árvore, depois por nome.
		const abaixo = new Set(subarvoreDe(arvore, id).map((n) => n.id));
		const opcoesDeMae = [...arvore.values()]
			.filter((n) => !abaixo.has(n.id))
			.sort(
				(a, b) =>
					nivelTipoUnidade(a.tipo) - nivelTipoUnidade(b.tipo) ||
					a.nome.localeCompare(b.nome, 'pt-BR')
			)
			.map(({ id: oid, nome, tipo }) => ({ id: oid, nome, tipo }));

		const para = lerId(url.searchParams.get('para'));
		let transferir = null;
		if (para != null && para !== unidade.seccional_id) {
			const recusa = await motivoParaRecusarSuperior(db, id, para);
			transferir = {
				para,
				recusa,
				pendencias: recusa ? null : await pendenciasDaTrocaDeMae(db, id, para),
				novaTrilha: recusa ? [] : [...trilha(para), arvore.get(para)?.nome ?? '', unidade.nome]
			};
		}
		return { unidade, trilhaAtual, ato, desativar: null, transferir, opcoesDeMae };
	}

	return { unidade, trilhaAtual, ato: null, desativar: null, transferir: null, opcoesDeMae: [] };
};

export const actions: Actions = {
	/**
	 * O último passo: executa o ato. Confere tudo de novo no servidor — o botão
	 * só aparece quando nada impede, mas o banco pode ter mudado desde então.
	 */
	concluir: async (event) => {
		const u = event.locals.usuario;
		if (!u || !u.isSuperAdmin) {
			return fail(403, { error: 'Apenas o Super Administrador pode mexer na estrutura' });
		}
		const id = lerId(event.params.id);
		if (id == null) return fail(400, { error: 'ID inválido' });

		const data = await event.request.formData();
		const ato = lerAto(data.get('ato'));
		const db = getDB(event.platform);

		if (ato === 'desativar') {
			const desfecho = await alternarAtivoDaUnidade(event, db, u, id, false);
			if (!desfecho.ok) return fail(desfecho.status, { error: desfecho.erro });
			return { concluido: 'desativar' as const };
		}
		if (ato === 'transferir') {
			const para = lerId(data.get('para'));
			if (para == null) return fail(400, { error: 'Escolha a nova unidade-mãe.' });
			const desfecho = await trocarMaeDaUnidade(event, db, u, id, para);
			if (!desfecho.ok) return fail(desfecho.status, { error: desfecho.erro });
			return { concluido: 'transferir' as const };
		}
		return fail(400, { error: 'Ato inválido' });
	}
};
