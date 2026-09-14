/**
 * Form actions dos SLOTS DE UNIDADE de cada seccional em `/operacoes/gise/[id]`.
 *
 * Um "slot" (`gise_seccional_unidades`) é a linha que reserva espaço para uma
 * unidade dentro da seccional; ele nasce vazio e depois recebe a unidade.
 * Criar/remover slot é do Admin Geral; escolher qual unidade ocupa o slot
 * também cabe ao admin da seccional.
 *
 * As três passaram a usar o preâmbulo comum (`carregarSeccionalDaGise`), que é
 * o que recusa GISE `finalizada` e amarra o `secId` do formulário à GISE da
 * URL. Este arquivo era o que restava de FLW-GISE-007 depois que as actions de
 * equipe foram fechadas — aqui a seccional era conferida contra a GISE, mas o
 * SLOT não era conferido contra a seccional, e nenhuma das três olhava o
 * status: dava para trocar a unidade de uma escala já finalizada.
 */
import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	tryGetR2,
	atualizarGiseSeccionalUnidade,
	adicionarGiseSeccionalUnidade,
	removerGiseSeccionalUnidade
} from '$lib/db';
import { giseSeccionalUnidades, giseEquipes, unidades } from '$lib/server/schema';
import { eq, and, isNull } from 'drizzle-orm';
import {
	getInt,
	carregarSeccionalDaGise,
	exigirAdminGeral,
	podePreencherSeccional
} from './shared';
import { concluirMudancaGise, invalidarAssinaturasDaSeccional } from './desfecho';

type Event = RequestEvent<{ id: string }>;

/** Nome da unidade para a trilha; `null` quando o slot está sendo esvaziado. */
async function nomeDaUnidade(db: ReturnType<typeof getDB>, unidadeId: number | null) {
	if (unidadeId == null) return null;
	const u = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.where(eq(unidades.id, unidadeId))
		.get();
	return u?.nome ?? null;
}

export const actionsUnidade = {
	/** Preenche (ou troca) a unidade de um slot já existente. */
	selecionarUnidade: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const slotId = getInt(formData, 'slotId');
		const unidadeId = getInt(formData, 'unidadeId');
		if (isNaN(giseId) || isNaN(slotId) || isNaN(unidadeId))
			return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const r2 = tryGetR2(platform) ?? null;

		const slotInfo = await db
			.select({
				gise_seccional_id: giseSeccionalUnidades.gise_seccional_id,
				unidade_id: giseSeccionalUnidades.unidade_id
			})
			.from(giseSeccionalUnidades)
			.where(eq(giseSeccionalUnidades.id, slotId))
			.get();
		if (!slotInfo) return fail(404, { error: 'Slot não encontrado' });

		const carga = await carregarSeccionalDaGise(db, giseId, slotInfo.gise_seccional_id);
		if ('erro' in carga) return carga.erro;

		if (!podePreencherSeccional(u, carga.sec.seccional_id)) {
			return fail(403, { error: 'Sem permissão' });
		}

		await atualizarGiseSeccionalUnidade(db, slotId, unidadeId);

		// A unidade escolhida sai impressa no relatório de extra da seccional:
		// trocá-la depois da assinatura derruba as assinaturas dela.
		const invalidacao = await invalidarAssinaturasDaSeccional(
			db,
			r2,
			giseId,
			slotInfo.gise_seccional_id,
			carga.gise.status
		);

		const [antes, depois] = await Promise.all([
			nomeDaUnidade(db, slotInfo.unidade_id),
			nomeDaUnidade(db, unidadeId)
		]);

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_unidade_selecionada',
			alvo: { tipo: 'unidade', id: unidadeId, nome: depois },
			detalhes: `Slot ${slotId} da seccional: ${antes ?? 'vazio'} → ${depois ?? 'vazio'}`,
			invalidacao,
			metadados: { slot_id: slotId, gise_seccional_id: slotInfo.gise_seccional_id },
			dados_antes: { unidade_id: slotInfo.unidade_id },
			dados_depois: { unidade_id: unidadeId }
		});

		return { success: true };
	},

	/** Cria mais um slot vazio na seccional. */
	adicionarUnidade: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const unidadeIdRaw = formData.get('unidadeId') as string;
		const unidadeId = unidadeIdRaw ? parseInt(unidadeIdRaw) : null;

		const db = getDB(platform);
		const r2 = tryGetR2(platform) ?? null;
		const carga = await carregarSeccionalDaGise(db, giseId, secId);
		if ('erro' in carga) return carga.erro;

		await adicionarGiseSeccionalUnidade(db, secId, unidadeId);

		// Slot novo só muda a escala quando já vem com unidade — vazio, ele apenas
		// abre uma linha em branco na tela.
		const invalidacao =
			unidadeId == null
				? 'nada'
				: await invalidarAssinaturasDaSeccional(db, r2, giseId, secId, carga.gise.status);

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_unidade_slot_criado',
			alvo: { tipo: 'unidade', id: unidadeId, nome: await nomeDaUnidade(db, unidadeId) },
			detalhes: `Slot de unidade criado na seccional ${secId}`,
			invalidacao,
			metadados: { gise_seccional_id: secId },
			dados_depois: { unidade_id: unidadeId }
		});

		return { success: true };
	},

	/** Remove um slot — e, com ele, as equipes penduradas nesse slot. */
	removerUnidade: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		const linkId = getInt(formData, 'linkId');
		if (isNaN(giseId) || isNaN(secId) || isNaN(linkId))
			return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const r2 = tryGetR2(platform) ?? null;
		const carga = await carregarSeccionalDaGise(db, giseId, secId);
		if ('erro' in carga) return carga.erro;

		// `linkId === 0` é o pseudo-slot legado das equipes criadas antes dos slots
		// existirem (`gise_unidade_id` nulo): não há linha para apagar, então a
		// remoção recai sobre as próprias equipes órfãs da seccional.
		let unidadeRemovida: number | null = null;
		if (linkId === 0) {
			await db
				.delete(giseEquipes)
				.where(and(eq(giseEquipes.gise_seccional_id, secId), isNull(giseEquipes.gise_unidade_id)));
		} else {
			// Amarra o slot à seccional já provada: sem isso, um `linkId` de outra
			// seccional (ou de outra GISE) era apagado enquanto a invalidação caía
			// na seccional da URL — FLW-GISE-007 nesta action.
			const slot = await db
				.select({ unidade_id: giseSeccionalUnidades.unidade_id })
				.from(giseSeccionalUnidades)
				.where(
					and(
						eq(giseSeccionalUnidades.id, linkId),
						eq(giseSeccionalUnidades.gise_seccional_id, secId)
					)
				)
				.get();
			if (!slot) return fail(404, { error: 'Slot não encontrado nesta seccional' });

			unidadeRemovida = slot.unidade_id;
			await removerGiseSeccionalUnidade(db, linkId);
		}

		const invalidacao = await invalidarAssinaturasDaSeccional(
			db,
			r2,
			giseId,
			secId,
			carga.gise.status
		);

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_unidade_slot_removido',
			alvo: {
				tipo: 'unidade',
				id: unidadeRemovida,
				nome: await nomeDaUnidade(db, unidadeRemovida)
			},
			detalhes:
				linkId === 0
					? `Equipes legadas sem slot removidas da seccional ${secId}`
					: `Slot ${linkId} removido da seccional ${secId}`,
			invalidacao,
			metadados: { gise_seccional_id: secId, link_id: linkId, legado: linkId === 0 },
			dados_antes: { unidade_id: unidadeRemovida }
		});

		return { success: true };
	}
};
