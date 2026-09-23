/**
 * `/administradores` — a tela do SUPER ADMIN (E65): quem administra o quê.
 *
 * Antes, quem promovia alguém a Admin Geral era outro Admin Geral, pela ficha
 * do servidor, e o departamento administrado era INFERIDO da lotação. Isso
 * misturava duas perguntas diferentes: "esta pessoa opera o sistema?" é
 * cadastro de acesso, e não um dado do servidor como a designação ou o local
 * de trabalho.
 *
 * Aqui a resposta é explícita: cada conta administrativa tem um NÓ, e o
 * alcance dela é a subárvore desse nó. Conta sem nó não opera — aparece na
 * lista mesmo assim, de propósito, porque é ela que explica por que alguém não
 * consegue entrar.
 *
 * Só o Super Admin: conceder acesso administrativo não é ato de quem
 * administra um departamento, é de quem cuida do sistema.
 */
import { error, redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getDB, auditar, contextoDeEvento, buscarPolicial, arvoreUnidades } from '$lib/db';
import {
	listarContasAdministrativas,
	definirNoDaConta,
	vincularAdminGeral,
	desvincularAdminGeral
} from '$lib/db/admin-vinculado';
import { inteiroNaFaixa } from '$lib/server/form-data';
import { nivelTipoUnidade, rotuloTipoUnidade } from '$lib/unidades/tipos';

/** Os nós que podem ser dados a uma conta: departamento para cima (E65). */
const NIVEL_MAXIMO_DO_NO = nivelTipoUnidade('departamento');

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (!u.isSuperAdmin) error(403, 'Só o Super Admin administra as contas administrativas.');

	const db = getDB(platform);
	const [contas, arvore] = await Promise.all([listarContasAdministrativas(db), arvoreUnidades(db)]);

	// Hoje isto devolve o DPI SUL e nada mais; devolve a lista, e não a unidade
	// fixa, porque a E65 já prevê o nó acima do departamento.
	const nos = [...arvore.values()]
		.filter((n) => nivelTipoUnidade(n.tipo) <= NIVEL_MAXIMO_DO_NO)
		.map((n) => ({ id: n.id, nome: n.nome, tipoRotulo: rotuloTipoUnidade(n.tipo) }))
		.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

	return { usuario: u, contas, nos };
};

export const actions: Actions = {
	/** Promove um servidor a Admin Geral de um nó — os dois atos num só. */
	promover: async (event) => {
		const { locals, platform, request } = event;
		const u = locals.usuario;
		if (!u?.isSuperAdmin) return fail(403, { error: 'Só o Super Admin promove.' });

		const fd = await request.formData();
		const policialId = inteiroNaFaixa(fd, 'policial_id', 1, 99_999_999);
		const unidadeId = inteiroNaFaixa(fd, 'unidade_id', 1, 99_999_999);
		if (!policialId) return fail(400, { error: 'Escolha o servidor.' });
		// Nó obrigatório: promover sem nó cria exatamente a conta que não opera.
		if (!unidadeId) return fail(400, { error: 'Escolha o nó que ele vai administrar.' });

		const db = getDB(platform);
		const policial = await buscarPolicial(db, policialId);
		if (!policial) return fail(404, { error: 'Servidor não encontrado.' });

		await vincularAdminGeral(db, policial, { escalas: true, gise: true }, unidadeId);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'toggle_admin_geral',
				usuario: u,
				entidade: 'policial',
				entidade_id: policialId,
				alvo_tipo: 'policial',
				alvo_id: policialId,
				alvo_nome: policial.nome,
				detalhes: `Promovido a Admin Geral (mat. ${policial.matricula}), nó ${unidadeId}`,
				metadados: { ativar: true, unidade_id: unidadeId },
				...contexto
			},
			{ env }
		);
		return { success: true };
	},

	/** Tira o acesso administrativo — a conta vinculada some. */
	rebaixar: async (event) => {
		const { locals, platform, request } = event;
		const u = locals.usuario;
		if (!u?.isSuperAdmin) return fail(403, { error: 'Só o Super Admin rebaixa.' });

		const fd = await request.formData();
		const policialId = inteiroNaFaixa(fd, 'policial_id', 1, 99_999_999);
		if (!policialId) return fail(400, { error: 'Conta sem servidor vinculado.' });

		const db = getDB(platform);
		const policial = await buscarPolicial(db, policialId);
		await desvincularAdminGeral(db, policialId);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'toggle_admin_geral',
				usuario: u,
				entidade: 'policial',
				entidade_id: policialId,
				alvo_tipo: 'policial',
				alvo_id: policialId,
				alvo_nome: policial?.nome ?? 'servidor',
				detalhes: `Removido o Admin Geral de ${policial?.nome ?? policialId}`,
				metadados: { ativar: false },
				...contexto
			},
			{ env }
		);
		return { success: true };
	},

	/** Troca o nó de uma conta — inclusive para nenhum, que a faz parar de operar. */
	definirNo: async (event) => {
		const { locals, platform, request } = event;
		const u = locals.usuario;
		if (!u?.isSuperAdmin) return fail(403, { error: 'Só o Super Admin define o nó.' });

		const fd = await request.formData();
		const adminId = inteiroNaFaixa(fd, 'admin_id', 1, 99_999_999);
		const unidadeId = inteiroNaFaixa(fd, 'unidade_id', 1, 99_999_999);
		if (!adminId) return fail(400, { error: 'Conta inválida.' });

		const db = getDB(platform);
		const ok = await definirNoDaConta(db, adminId, unidadeId || null);
		if (!ok) return fail(404, { error: 'Conta não encontrada.' });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'definir_no_do_admin',
				usuario: u,
				entidade: 'admin',
				entidade_id: adminId,
				alvo_tipo: 'admin',
				alvo_id: adminId,
				detalhes: unidadeId
					? `Conta ${adminId} passa a administrar o nó ${unidadeId}`
					: `Conta ${adminId} ficou SEM nó — deixa de operar`,
				metadados: { unidade_id: unidadeId || null },
				...contexto
			},
			{ env }
		);
		return { success: true };
	}
};
