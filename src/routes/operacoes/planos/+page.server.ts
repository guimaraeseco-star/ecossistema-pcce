/**
 * `/operacoes/planos` — a lista dos planos operacionais (Admin Geral).
 *
 * Tela de leitura e de exclusão. Criar acontece em `/operacoes/planos/novo`, que é
 * rota própria porque o formulário de parâmetros gerais é longo demais para
 * modal (README §10, "formulário longo vira rota").
 *
 * Toda operação material entra pelo portão de `$lib/server/planos/permissao` —
 * inclusive a exclusão, que confere o plano antes de apagar em vez de confiar
 * no id do formulário.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDB, listarPlanos, excluirPlano, auditar, contextoDeEvento } from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { carregarPlanoParaEdicao } from '$lib/server/planos/permissao';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals, platform, depends }) => {
	depends('app:planos');
	if (!isAdminGeral(locals.usuario)) redirect(302, '/operacoes/gise');

	const db = getDB(platform);
	return { planos: await listarPlanos(db) };
};

export const actions: Actions = {
	/**
	 * Exclui o plano — equipes e membros vão junto pelo CASCADE.
	 *
	 * Diferente de `operacoes`, aqui a exclusão é de verdade e não há "desativar":
	 * o plano não é referenciado por escala nem por PDF assinado de terceiros — o
	 * documento que ele gera é dele mesmo. O que a exclusão NÃO alcança é a versão
	 * de valores aplicada (`custo_parametro_id` é RESTRICT).
	 */
	excluir: async (event) => {
		const { request, locals, platform } = event;
		const fd = await request.formData();
		const id = Number(fd.get('id'));

		const db = getDB(platform);
		const acesso = await carregarPlanoParaEdicao(db, id, locals.usuario);
		if (acesso instanceof Response) {
			return fail(acesso.status, { error: 'Sem permissão para excluir este plano.' });
		}
		const { plano } = acesso;

		let apagou: boolean;
		try {
			apagou = await excluirPlano(db, id);
		} catch (e) {
			logger.error('[gise/planos] excluir', { error: String(e), id });
			return fail(500, { error: 'Erro ao excluir o plano operacional.' });
		}
		if (!apagou) return fail(404, { error: 'Plano não encontrado.' });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'excluir_plano_operacional',
				usuario: locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: id,
				detalhes: `Plano ${plano.numero}/${plano.ano} "${plano.nome}" excluído`,
				dados_antes: {
					numero: plano.numero,
					ano: plano.ano,
					nome: plano.nome,
					data_inicio: plano.data_inicio
				},
				...contexto
			},
			{ env }
		);

		return { success: true, excluido: `${plano.numero}/${plano.ano}` };
	}
};
