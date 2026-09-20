/**
 * Form actions dos MEMBROS (policiais alocados às vagas das equipes) em
 * `/operacoes/gise/[id]`.
 *
 * Diferente das equipes, aqui o admin seccional também escreve — desde que a
 * seccional seja a dele (`u.papel_unidade_id === sec.seccional_id`). É o passo
 * que cada seccional executa antes de "finalizar" seu preenchimento.
 */
import { fail } from '@sveltejs/kit';
import { afastamentosNasDatas, descreverAfastamento } from '$lib/db/policiais/afastamento-escalas';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	tryGetR2,
	adicionarGiseMembro,
	removerGiseMembro,
	verificarSlotEquipe,
	verificarConflitoMembroGise,
	verificarConflitoHorarioPolicial
} from '$lib/db';
import { invalidarPapelGise } from '$lib/server/gise/papel-cache';
import { giseEquipes, policiais } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import {
	getInt,
	podePreencherSeccional,
	carregarMembroDaGise,
	carregarSeccionalDaGise
} from './shared';
import { concluirMudancaGise, invalidarAssinaturasDaSeccional } from './desfecho';

/**
 * Traduz a recusa da gravação atômica na frase que o usuário lê.
 *
 * A escrita devolve só o MOTIVO estrutural; as consultas de diagnóstico é que
 * sabem dizer "vagas de DPC esgotadas (limite: 2)" ou "já escalado na seccional
 * Centro". Elas rodam APÓS a recusa, e só nela: no caminho feliz não custam
 * nada, e no caminho infeliz não decidem nada.
 */
async function explicarRecusaDeVaga(
	db: ReturnType<typeof getDB>,
	giseId: number,
	equipeId: number,
	policialId: number,
	motivo: 'equipe_inexistente' | 'sem_vaga' | 'ja_escalado'
): Promise<string> {
	if (motivo === 'equipe_inexistente') return 'Equipe não encontrada';

	if (motivo === 'ja_escalado') {
		const conflito = await verificarConflitoMembroGise(db, giseId, policialId);
		return conflito.motivo ?? 'Policial já escalado nesta GISE';
	}

	const slot = await verificarSlotEquipe(db, equipeId, policialId);
	return slot.motivo ?? 'Vagas esgotadas nesta equipe';
}

type Event = RequestEvent<{ id: string }>;

export const actionsMembros = {
	/**
	 * Aloca um policial numa equipe. Três validações antes de gravar, todas na
	 * camada de dados: vaga livre no tipo certo (DPC/OIP), policial ainda não
	 * escalado nesta GISE e sem conflito de horário com outra escala.
	 */
	adicionarMembro: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const equipeId = getInt(formData, 'equipe_id');
		const policialId = getInt(formData, 'policial_id');

		if (isNaN(equipeId) || isNaN(policialId)) return fail(400, { error: 'Dados inválidos' });

		const db = getDB(platform);
		const r2 = tryGetR2(platform) ?? null;
		const carga = await carregarSeccionalDaGise(db, giseId, secId);
		if ('erro' in carga) return carga.erro;
		const { gise, sec } = carga;

		if (!podePreencherSeccional(u, sec.seccional_id)) {
			return fail(403, { error: 'Sem permissão para montar equipes desta seccional' });
		}

		const equipe = await db.select().from(giseEquipes).where(eq(giseEquipes.id, equipeId)).get();
		if (!equipe || equipe.gise_seccional_id !== secId)
			return fail(404, { error: 'Equipe não encontrada' });

		// Afastado não se escala (decisão dele, 20/09 — E60): férias em gozo ou
		// qualquer afastamento no dia da GISE recusam.
		const afastado = (await afastamentosNasDatas(db, policialId, [gise.data_inicio])).get(
			gise.data_inicio
		);
		if (afastado) {
			return fail(409, { error: `Servidor afastado — ${descreverAfastamento(afastado)}.` });
		}

		// Choque com OUTRA escala (GISE ou comum) continua sendo pré-checagem: é
		// conflito entre escalas, não disputa pela mesma vaga, e não cabe na mesma
		// escrita.
		const horarioCheck = await verificarConflitoHorarioPolicial(db, equipeId, policialId);
		if (!horarioCheck.ok) return fail(400, { error: horarioCheck.motivo });

		// A gravação é quem decide vaga e exclusividade — atomicamente
		// (FLW-GISE-009). As checagens abaixo só EXPLICAM a recusa: até ago/2026
		// elas decidiam, e entre a decisão e o INSERT cabia outra requisição.
		const alocado = await adicionarGiseMembro(db, equipeId, policialId);
		if (!alocado.ok) {
			return fail(409, {
				error: await explicarRecusaDeVaga(db, giseId, equipeId, policialId, alocado.motivo)
			});
		}

		// O papel GISE do policial é cacheado (usado no guard de `/operacoes/presenca`);
		// sem invalidar, ele só enxergaria a escala nova quando o cache expirasse.
		await invalidarPapelGise(policialId);

		const invalidacao = await invalidarAssinaturasDaSeccional(db, r2, giseId, secId, gise.status);
		const pol = await db
			.select({ nome: policiais.nome })
			.from(policiais)
			.where(eq(policiais.id, policialId))
			.get();

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_membro_adicionado',
			alvo: { tipo: 'policial', id: policialId, nome: pol?.nome ?? null },
			detalhes: `${pol?.nome ?? `Policial ${policialId}`} alocado na equipe ${equipeId}`,
			invalidacao,
			metadados: { equipe_id: equipeId, gise_seccional_id: secId }
		});

		return { success: true };
	},

	/** Desaloca um policial. Bloqueado quando a GISE já entrou em operação. */
	removerMembro: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const memId = getInt(formData, 'memId');
		if (isNaN(giseId) || isNaN(memId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const r2 = tryGetR2(platform) ?? null;

		// O preâmbulo amarra o `memId` à GISE da URL (FLW-GISE-007) e traz de uma
		// vez o que a action precisa DEPOIS do delete: nome do policial, equipe e
		// seccional — que a linha apagada não responderia mais.
		const carga = await carregarMembroDaGise(db, giseId, memId);
		if ('erro' in carga) return carga.erro;
		const { gise, membro: membroInfo } = carga;

		if (!podePreencherSeccional(u, membroInfo.seccional_id)) {
			return fail(403, { error: 'Sem permissão para montar equipes desta seccional' });
		}

		// Janela maior que a de edição livre: dá para corrigir a composição
		// enquanto a escala aguarda a assinatura do supervisor, mas não depois que
		// ela entra em operação (haveria presença/relatório do policial removido).
		if (
			!['em_definicao_supervisor', 'em_preenchimento', 'aguardando_assinatura'].includes(
				gise.status
			)
		) {
			return fail(400, { error: 'Escala fechada para edição' });
		}

		await removerGiseMembro(db, memId);

		await invalidarPapelGise(membroInfo.policial_id);

		const invalidacao = await invalidarAssinaturasDaSeccional(
			db,
			r2,
			giseId,
			membroInfo.gise_seccional_id,
			gise.status
		);

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_membro_removido',
			alvo: { tipo: 'policial', id: membroInfo.policial_id, nome: membroInfo.policial_nome },
			detalhes: `${membroInfo.policial_nome} desalocado da equipe ${membroInfo.equipe_id}`,
			invalidacao,
			metadados: {
				equipe_id: membroInfo.equipe_id,
				gise_seccional_id: membroInfo.gise_seccional_id,
				status_da_gise: gise.status
			}
		});

		return { success: true };
	}
};
