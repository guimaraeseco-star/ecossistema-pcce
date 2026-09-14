/**
 * Form actions dos MEMBROS — o efetivo que o Anexo I lista e que o Anexo II
 * conta.
 *
 * A gravação decide, as consultas explicam: `adicionarMembro` não pergunta
 * antes se o servidor já está no plano — tenta gravar e traduz a violação do
 * índice único no motivo. Ver o cabeçalho de `$lib/db/planos/membros.ts`.
 */
import { fail } from '@sveltejs/kit';
import { adicionarMembro, removerMembro, definirChefe, auditar, contextoDeEvento } from '$lib/db';
import { equipeDaRota, membroDaRota, getInt, type EventoPlano } from './shared';

/** A frase que o usuário lê para cada recusa da alocação. */
const MOTIVO: Record<string, string> = {
	equipe_inexistente: 'Equipe não encontrada.',
	policial_inexistente: 'Servidor não encontrado no cadastro.',
	ja_no_plano: 'Este servidor já está em uma equipe deste plano.'
};

export const actionsMembros = {
	/** Aloca um servidor na equipe. */
	adicionarMembro: async (event: EventoPlano) => {
		const fd = await event.request.formData();
		const ctx = await equipeDaRota(event, getInt(fd, 'equipe_id'));
		if ('erro' in ctx) return ctx.erro;
		const { db, plano, equipe } = ctx;

		const policialId = getInt(fd, 'policial_id');
		if (!Number.isInteger(policialId) || policialId <= 0) {
			return fail(400, { error: 'Escolha o servidor na busca.' });
		}

		const r = await adicionarMembro(db, equipe.id, policialId);
		if (!r.ok) {
			return fail(409, { error: MOTIVO[r.motivo] ?? 'Não foi possível alocar o servidor.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Servidor #${policialId} alocado em "${equipe.nome}"`,
				dados_depois: { policial_id: policialId, equipe: equipe.nome },
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/** Remove o servidor da equipe. A chefia, se era dele, some junto (CASCADE). */
	removerMembro: async (event: EventoPlano) => {
		const fd = await event.request.formData();
		const ctx = await membroDaRota(event, getInt(fd, 'membro_id'));
		if ('erro' in ctx) return ctx.erro;
		const { db, plano, membro } = ctx;

		const removeu = await removerMembro(db, membro.id);
		if (!removeu) return fail(404, { error: 'Membro não encontrado.' });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Membro #${membro.id} removido do plano ${plano.numero}/${plano.ano}`,
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/**
	 * Designa o chefe da equipe, tirando a chefia de quem a tinha.
	 *
	 * `definirChefe` recusa membro de outra equipe: o id vem do formulário, e o
	 * índice parcial só conta chefes por equipe — ele não impediria marcar como
	 * chefe alguém que a equipe nem tem.
	 */
	definirChefe: async (event: EventoPlano) => {
		const fd = await event.request.formData();
		const ctx = await membroDaRota(event, getInt(fd, 'membro_id'));
		if ('erro' in ctx) return ctx.erro;
		const { db, plano, membro } = ctx;

		const ok = await definirChefe(db, membro.equipe_id, membro.id);
		if (!ok) return fail(409, { error: 'Este membro não pertence à equipe.' });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Membro #${membro.id} designado chefe de equipe`,
				...contexto
			},
			{ env }
		);

		return { success: true };
	}
};
