/**
 * Form actions das EQUIPES da GISE (bloco de cada seccional em `/operacoes/gise/[id]`).
 *
 * Todas exigem Admin Geral: a composição de equipes define quantas vagas cada
 * unidade tem na escala, e o admin seccional só preenche as vagas
 * (ver `actions-membros.ts`).
 *
 * Depois que a GISE sai do rascunho, cada action invalida o que a mudança
 * atinge — documento inteiro ou assinaturas da seccional (ver
 * `saiuDaFaseDeEdicao`). Antes disso, o preâmbulo (`carregar*DaGise`) recusa
 * escala finalizada e amarra o id filho à GISE da URL; escrito à mão, faltava
 * numa das quatro (FLW-GISE-006) e nas quatro (FLW-GISE-007).
 */
import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	tryGetR2,
	atualizarGiseEquipe,
	excluirGiseEquipe,
	criarGiseEquipe,
	buscarOperacaoDaEscala,
	operacaoAceitaTipoEquipe
} from '$lib/db';
import { giseMembros } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { getInt, carregarEquipeDaGise, carregarSeccionalDaGise, exigirAdminGeral } from './shared';
import { inteiroNaFaixa, horaHhMm, informado } from '$lib/server/form-data';
import { MAX_VAGAS_EQUIPE } from '$lib/gise/tipos-equipe';
import {
	concluirMudancaGise,
	invalidarAssinaturasDaSeccional,
	invalidarDocumentoDaEscala
} from './desfecho';

type Event = RequestEvent<{ id: string }>;

export const actionsEquipe = {
	/** Muda o número de vagas (DPC/OIP) de uma equipe já existente. */
	salvarSlotsEquipe: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const equipeId = getInt(formData, 'equipeId');
		if (isNaN(giseId) || isNaN(equipeId)) return fail(400, { error: 'IDs inválidos' });

		// FAIXA, não só "é número". As vagas entram na comparação
		// `COUNT(*) < e.slots_dpc` que decide a alocação atomicamente: `999999` por
		// POST direto apagava o controle de lotação, `-1` fazia a equipe recusar
		// todo mundo dizendo "vagas esgotadas" para uma equipe vazia. O `max` das
		// telas é o MESMO `MAX_VAGAS_EQUIPE`.
		const slotsDpc = inteiroNaFaixa(formData, 'slots_dpc', 0, MAX_VAGAS_EQUIPE);
		const slotsOip = inteiroNaFaixa(formData, 'slots_oip', 0, MAX_VAGAS_EQUIPE);
		if (slotsDpc === null || slotsOip === null) {
			return fail(400, { error: `Vagas inválidas — informe de 0 a ${MAX_VAGAS_EQUIPE}.` });
		}

		const db = getDB(platform);
		const r2 = tryGetR2(platform) ?? null;
		// ANTES de mutar. A versão anterior gravava as vagas e só então olhava o
		// status — numa escala finalizada, a alteração já tinha acontecido quando
		// alguém fosse decidir se podia.
		const carga = await carregarEquipeDaGise(db, giseId, equipeId);
		if ('erro' in carga) return carga.erro;

		await atualizarGiseEquipe(db, equipeId, slotsDpc, slotsOip);

		// Mudar vagas altera o corpo da escala inteira: o PDF gerado deixa de valer
		// e a GISE volta para preenchimento.
		const invalidacao = await invalidarDocumentoDaEscala(db, r2, giseId, carga.gise.status);

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_equipe_alterada',
			alvo: { tipo: 'gise_equipe', id: equipeId },
			detalhes: `Vagas da equipe ${equipeId}: ${carga.equipe.slots_dpc}/${carga.equipe.slots_oip} → ${slotsDpc}/${slotsOip} (DPC/OIP)`,
			invalidacao,
			metadados: { gise_seccional_id: carga.equipe.gise_seccional_id },
			dados_antes: { slots_dpc: carga.equipe.slots_dpc, slots_oip: carga.equipe.slots_oip },
			dados_depois: { slots_dpc: slotsDpc, slots_oip: slotsOip }
		});

		return { success: true };
	},

	/** Horário próprio da equipe (sobrepõe o da seccional e o da escala). */
	salvarHorariosEquipe: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const eqId = getInt(formData, 'eqId');
		if (isNaN(giseId) || isNaN(eqId)) return fail(400, { error: 'IDs inválidos' });

		// Vazio herda o horário da seccional; preenchido tem de ser HH:MM. Mesmo
		// motivo do `salvarHorariosSec`: é o horário que o portão de presença
		// compara, e ele libera quando a hora não parseia.
		const horaEntrada = horaHhMm(formData, 'hora_entrada');
		const horaSaida = horaHhMm(formData, 'hora_saida');
		if (
			(informado(formData, 'hora_entrada') && horaEntrada === null) ||
			(informado(formData, 'hora_saida') && horaSaida === null)
		) {
			return fail(400, { error: 'Horário inválido — use HH:MM.' });
		}

		const db = getDB(platform);
		const r2 = tryGetR2(platform) ?? null;
		const carga = await carregarEquipeDaGise(db, giseId, eqId);
		if ('erro' in carga) return carga.erro;

		await atualizarGiseEquipe(db, eqId, undefined, undefined, {
			hora_entrada: horaEntrada,
			hora_saida: horaSaida
		});

		// Horário entra no relatório de extra da seccional — caem as assinaturas
		// dela e as presenças dos seus membros, além do documento consolidado.
		const invalidacao = await invalidarAssinaturasDaSeccional(
			db,
			r2,
			giseId,
			carga.equipe.gise_seccional_id,
			carga.gise.status
		);

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_equipe_alterada',
			alvo: { tipo: 'gise_equipe', id: eqId },
			detalhes: `Horário da equipe ${eqId}: ${horaEntrada ?? '—'} às ${horaSaida ?? '—'}`,
			invalidacao,
			metadados: { gise_seccional_id: carga.equipe.gise_seccional_id },
			dados_antes: {
				hora_entrada: carga.equipe.hora_entrada,
				hora_saida: carga.equipe.hora_saida
			},
			dados_depois: { hora_entrada: horaEntrada, hora_saida: horaSaida }
		});

		return { success: true };
	},

	/** Cria uma equipe (operacional ou SEINT) dentro de uma seccional. */
	adicionarEquipe: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const tipo = formData.get('tipo') as 'operacional' | 'seint';
		// Mesma faixa de `salvarSlotsEquipe` — aqui o valor ausente cai em 0
		// (equipe nasce sem vaga daquele cargo), mas valor FORA da faixa é recusa,
		// não silenciosamente convertido.
		const slotsDpc = inteiroNaFaixa(formData, 'slots_dpc', 0, MAX_VAGAS_EQUIPE);
		const slotsOip = inteiroNaFaixa(formData, 'slots_oip', 0, MAX_VAGAS_EQUIPE);

		if (!tipo || (tipo !== 'operacional' && tipo !== 'seint'))
			return fail(400, { error: 'Tipo inválido' });

		// Campo PRESENTE e fora da faixa é recusa; AUSENTE cai em 0 mais abaixo
		// (equipe nasce sem vaga daquele cargo). `inteiroNaFaixa` devolve `null` para
		// os dois casos, então quem os separa é ter vindo texto ou não.
		if (
			(informado(formData, 'slots_dpc') && slotsDpc === null) ||
			(informado(formData, 'slots_oip') && slotsOip === null)
		) {
			return fail(400, { error: `Vagas inválidas — informe de 0 a ${MAX_VAGAS_EQUIPE}.` });
		}

		// `null` = equipe ainda sem unidade escolhida (slot em aberto na seccional).
		const unidadeIdRaw = formData.get('unidadeId') as string;
		const unidadeId = unidadeIdRaw ? parseInt(unidadeIdRaw) : null;

		const db = getDB(platform);
		const r2 = tryGetR2(platform) ?? null;
		const carga = await carregarSeccionalDaGise(db, giseId, secId);
		if ('erro' in carga) return carga.erro;

		// A operação decide quais tipos de equipe existem: a EDGE pode ser só de
		// inteligência. A tela já esconde o tipo desabilitado, mas esconder não é
		// autorização — o POST direto morre aqui. Operação nula (escala anterior à
		// migração 0048) aceita os dois, que é como era antes de haver operações.
		const operacao = await buscarOperacaoDaEscala(db, giseId);
		if (operacao && !operacaoAceitaTipoEquipe(operacao, tipo)) {
			return fail(400, {
				error: `A operação ${operacao.nome} não usa equipe do tipo ${
					tipo === 'seint' ? 'inteligência (SEINT)' : 'operacional'
				}.`
			});
		}

		const dpc = slotsDpc ?? 0;
		const oip = slotsOip ?? 0;
		const novaEquipeId = await criarGiseEquipe(db, secId, tipo, dpc, oip, unidadeId);

		// Equipe nova = escala diferente da que foi para assinatura.
		const invalidacao = await invalidarDocumentoDaEscala(db, r2, giseId, carga.gise.status);

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_equipe_criada',
			alvo: { tipo: 'gise_equipe', id: novaEquipeId },
			detalhes: `Equipe ${tipo} criada na seccional ${secId} com ${dpc} DPC e ${oip} OIP`,
			invalidacao,
			metadados: { gise_seccional_id: secId, gise_unidade_id: unidadeId },
			dados_depois: { tipo, slots_dpc: dpc, slots_oip: oip, gise_unidade_id: unidadeId }
		});

		return { success: true };
	},

	/** Remove a equipe (e, em cascata, seus membros). */
	removerEquipe: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const equipeId = getInt(formData, 'equipeId');
		if (isNaN(giseId) || isNaN(equipeId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const r2 = tryGetR2(platform) ?? null;
		// O preâmbulo já traz a seccional — antes ela era lida numa query própria,
		// ANTES do delete, porque depois a linha não existiria mais.
		const carga = await carregarEquipeDaGise(db, giseId, equipeId);
		if ('erro' in carga) return carga.erro;

		// Quem sai junto: a exclusão leva os membros em cascata, e depois do DELETE
		// não há como saber quantas pessoas deixaram a escala nesta ação.
		const membrosQueSaem = await db
			.select({ policial_id: giseMembros.policial_id })
			.from(giseMembros)
			.where(eq(giseMembros.equipe_id, equipeId))
			.all();

		await excluirGiseEquipe(db, equipeId);

		const invalidacao = await invalidarAssinaturasDaSeccional(
			db,
			r2,
			giseId,
			carga.equipe.gise_seccional_id,
			carga.gise.status
		);

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_equipe_removida',
			alvo: { tipo: 'gise_equipe', id: equipeId },
			detalhes: `Equipe ${equipeId} removida, com ${membrosQueSaem.length} policial(is) alocado(s)`,
			invalidacao,
			metadados: {
				gise_seccional_id: carga.equipe.gise_seccional_id,
				policiais_desalocados: membrosQueSaem.map((m) => m.policial_id)
			},
			dados_antes: {
				tipo: carga.equipe.tipo,
				slots_dpc: carga.equipe.slots_dpc,
				slots_oip: carga.equipe.slots_oip
			}
		});

		return { success: true };
	}
};
