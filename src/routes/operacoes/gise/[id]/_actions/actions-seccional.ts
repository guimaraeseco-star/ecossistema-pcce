/**
 * Form actions das SECCIONAIS de uma GISE em `/operacoes/gise/[id]`.
 *
 * Montagem (adicionar/remover) é do Admin Geral; o preenchimento
 * (`finalizarSeccional`, horários) é do Admin Geral OU do admin da própria
 * seccional — regra em `podePreencherSeccional` (shared.ts), não escrita à mão
 * aqui: quando era, faltava a metade que barra quem não tem papel nenhum.
 */

import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	tryGetR2,
	atualizarGiseEscala,
	atualizarGiseSeccional,
	excluirGiseSeccional,
	verificarGiseCompleta,
	adicionarGiseSeccionalUnidade
} from '$lib/db';
import { logger } from '$lib/server/logger';
import { enviarNotificacaoAssessorGisePreenchimentoSeccional } from '$lib/server/email';
import { montarTextoNotificacaoAssessorGise } from '$lib/server/gise/assessor-notificacao-text';
import {
	policiais,
	giseEscalas,
	giseSeccionais,
	giseSeccionalUnidades,
	giseEquipes,
	giseMembros,
	unidades,
	giseDocumentos
} from '$lib/server/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';
import {
	getInt,
	saiuDaFaseDeEdicao,
	podePreencherSeccional,
	carregarGiseEditavel,
	exigirAdminGeral
} from './shared';
import { concluirMudancaGise, invalidarAssinaturasDaSeccional } from './desfecho';
import { coletarChavesR2DaRevogacaoSeccional, deletarChavesR2 } from '$lib/server/r2-cleanup';
import { mensagemDeErro } from '$lib/utils/erro';
import { horaHhMm, informado } from '$lib/server/form-data';

type Event = RequestEvent<{ id: string }>;

export const actionsSeccional = {
	/** Inclui uma seccional na GISE, já com um slot de unidade em branco. */
	adicionarSeccional: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const seccionalId = parseInt(formData.get('seccionalId') as string);
		if (isNaN(seccionalId)) return fail(400, { error: 'seccionalId inválido' });

		const db = getDB(platform);
		const carga = await carregarGiseEditavel(db, giseId);
		if ('erro' in carga) return carga.erro;
		const { gise } = carga;

		const [novaSec] = await db
			.insert(giseSeccionais)
			.values({
				gise_id: giseId,
				seccional_id: seccionalId,
				status: 'pendente'
			})
			.returning({ id: giseSeccionais.id });

		// Slot vazio inicial: a tela sempre mostra ao menos uma linha de unidade
		// para preencher, em vez de uma seccional sem nada abaixo.
		if (novaSec) {
			await adicionarGiseSeccionalUnidade(db, novaSec.id, null);
		}

		const nome = await db
			.select({ nome: unidades.nome })
			.from(unidades)
			.where(eq(unidades.id, seccionalId))
			.get();

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_seccional_adicionada',
			alvo: { tipo: 'unidade', id: seccionalId, nome: nome?.nome ?? null },
			detalhes: `Seccional ${nome?.nome ?? seccionalId} incluída na escala`,
			// Seccional nova entra vazia: não há assinatura dela para derrubar, e o
			// documento da escala é regerado quando ela for preenchida.
			invalidacao: 'nada',
			metadados: { gise_seccional_id: novaSec?.id ?? null, status_da_gise: gise.status }
		});

		return { success: true };
	},

	/**
	 * Remove a seccional da GISE e recalcula o status da escala: some uma parte
	 * do documento, então o PDF gerado é descartado; se as seccionais restantes
	 * já estiverem todas preenchidas, a escala volta direto para assinatura.
	 */
	removerSeccional: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const r2 = tryGetR2(platform) ?? null;
		const carga = await carregarGiseEditavel(db, giseId);
		if ('erro' in carga) return carga.erro;
		const { gise } = carga;

		// Nome e efetivo ANTES do delete em cascata: depois não há mais linha de
		// onde tirar quem foi retirado da escala.
		const sec = await db
			.select({ id: giseSeccionais.id, nome: unidades.nome })
			.from(giseSeccionais)
			.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
			.get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		const membrosQueSaem = await db
			.select({ policial_id: giseMembros.policial_id })
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.where(eq(giseEquipes.gise_seccional_id, secId))
			.all();

		// R2 antes do D1: o `excluirGiseSeccional` leva equipes, membros e — em
		// cascata — presenças e relatórios da seccional. Depois disso não há linha
		// que diga quais objetos existiam (FLW-DOC-003).
		if (r2) {
			await deletarChavesR2(
				db,
				r2,
				await coletarChavesR2DaRevogacaoSeccional(db, giseId, secId),
				'remocao-seccional'
			);
		}

		await excluirGiseSeccional(db, secId);
		await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));

		const seccionaisRestantes = await db
			.select({ id: giseSeccionais.id })
			.from(giseSeccionais)
			.where(eq(giseSeccionais.gise_id, giseId))
			.all();

		let novoStatus: 'em_preenchimento' | 'aguardando_assinatura' = 'em_preenchimento';
		if (seccionaisRestantes.length > 0) {
			const todasPreenchidas = await verificarGiseCompleta(db, giseId);
			if (todasPreenchidas) novoStatus = 'aguardando_assinatura';
		}

		await atualizarGiseEscala(db, giseId, { status: novoStatus });

		// Invalidação própria, e por isso não usa `invalidarDocumentoDaEscala`:
		// esta action recalcula o status em vez de forçar `em_preenchimento` — com
		// as seccionais restantes já preenchidas, a escala volta direto para
		// assinatura. O que se declara à trilha é o efeito real: o documento só
		// tinha o que descartar se a escala já havia saído do rascunho.
		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_seccional_removida',
			alvo: { tipo: 'unidade', id: secId, nome: sec.nome },
			detalhes: `Seccional ${sec.nome} removida, com ${membrosQueSaem.length} policial(is) escalado(s)`,
			invalidacao: saiuDaFaseDeEdicao(gise.status) ? 'documento_da_escala' : 'nada',
			metadados: {
				gise_seccional_id: secId,
				policiais_desalocados: membrosQueSaem.map((m) => m.policial_id),
				status_anterior: gise.status,
				status_novo: novoStatus
			}
		});

		return { success: true, gise_status: novoStatus };
	},

	/**
	 * A seccional declara seu preenchimento concluído.
	 *
	 * Só passa com a escala completa: toda unidade escolhida e cada uma com pelo
	 * menos um policial — checagens feitas aqui (e não no clique) porque o admin
	 * seccional pode ter várias abas abertas. Quando a última seccional finaliza,
	 * a GISE inteira vai para `aguardando_assinatura`.
	 */
	finalizarSeccional: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const carga = await carregarGiseEditavel(db, giseId);
		if ('erro' in carga) return carga.erro;

		const sec = await db
			.select()
			.from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
			.get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		if (!podePreencherSeccional(u, sec.seccional_id)) {
			return fail(403, { error: 'Sem permissão para preencher esta seccional' });
		}

		const slots = await db
			.select({ id: giseSeccionalUnidades.id, unidade_id: giseSeccionalUnidades.unidade_id })
			.from(giseSeccionalUnidades)
			.where(eq(giseSeccionalUnidades.gise_seccional_id, secId))
			.all();

		if (slots.length === 0)
			return fail(400, { error: 'Adicione ao menos uma unidade antes de finalizar' });

		const slotSemUnidade = slots.find((s) => s.unidade_id === null);
		if (slotSemUnidade)
			return fail(400, { error: 'Todos os slots devem ter uma unidade selecionada' });

		const slotIds = slots.map((s) => s.id);
		const membrosPorSlot = await db
			.select({ gise_unidade_id: giseEquipes.gise_unidade_id })
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.where(inArray(giseEquipes.gise_unidade_id, slotIds))
			.all();

		const slotsComMembros = new Set(membrosPorSlot.map((m) => m.gise_unidade_id));
		const slotSemMembro = slots.find((s) => !slotsComMembros.has(s.id));
		if (slotSemMembro)
			return fail(400, { error: 'Cada unidade deve ter pelo menos 1 policial alocado' });

		// Preserva a marca de retificação: uma seccional que foi reaberta e
		// preenchida de novo continua distinguível da que acertou de primeira.
		const novoStatus = sec.status === 'retificada' ? 'preenchida_retificada' : 'preenchida';
		await atualizarGiseSeccional(db, secId, { status: novoStatus });

		const todasPreenchidas = await verificarGiseCompleta(db, giseId);
		let giseStatus = 'em_preenchimento';
		if (todasPreenchidas) {
			giseStatus = 'aguardando_assinatura';
			await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura' });
		}

		const secComNome = await db
			.select({ nome: unidades.nome })
			.from(giseSeccionais)
			.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
			.where(eq(giseSeccionais.id, secId))
			.get();

		// Declaração de preenchimento: não muda composição, então não derruba
		// documento nem assinatura. Vai para a trilha porque é o carimbo de que a
		// seccional assumiu o que montou — e é o gatilho da notificação abaixo.
		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_seccional_preenchida',
			alvo: { tipo: 'unidade', id: sec.seccional_id, nome: secComNome?.nome ?? null },
			detalhes: `Seccional ${secComNome?.nome ?? sec.seccional_id} declarou preenchimento concluído`,
			invalidacao: 'nada',
			metadados: { gise_seccional_id: secId, gise_status: giseStatus },
			dados_antes: { status: sec.status },
			dados_depois: { status: novoStatus }
		});

		const giseRow = await db
			.select({
				data_inicio: giseEscalas.data_inicio,
				assessor_id: giseEscalas.assessor_id,
				assessor_email_notificacao: giseEscalas.assessor_email_notificacao
			})
			.from(giseEscalas)
			.where(eq(giseEscalas.id, giseId))
			.get();

		const todasSecs = await db
			.select({
				nome: unidades.nome,
				status: giseSeccionais.status
			})
			.from(giseSeccionais)
			.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
			.where(eq(giseSeccionais.gise_id, giseId))
			.orderBy(asc(unidades.nome));

		// Notificação ao assessor: e-mail configurado na GISE tem prioridade sobre
		// o cadastro do policial. Falha de envio é logada e ignorada — o
		// preenchimento já foi gravado e não pode ser desfeito por causa de e-mail.
		if (giseRow?.assessor_id && secComNome?.nome) {
			let destino =
				(giseRow.assessor_email_notificacao && giseRow.assessor_email_notificacao.trim()) || '';
			let nomeAssessor = 'Assessor';
			const polAss = await db
				.select({
					email_pessoal: policiais.email_pessoal,
					email: policiais.email,
					nome: policiais.nome
				})
				.from(policiais)
				.where(eq(policiais.id, giseRow.assessor_id))
				.get();
			nomeAssessor = polAss?.nome ?? nomeAssessor;
			if (!destino) {
				destino = (polAss?.email_pessoal?.trim() || polAss?.email?.trim() || '') ?? '';
			}
			if (destino) {
				try {
					const texto = montarTextoNotificacaoAssessorGise({
						dataInicioIso: giseRow.data_inicio,
						giseId,
						nomeSeccionalQueAcabouDeEnviar: secComNome.nome,
						seccionais: todasSecs.map((r) => ({ nome: r.nome, status: r.status }))
					});
					await enviarNotificacaoAssessorGisePreenchimentoSeccional(
						destino,
						nomeAssessor,
						texto,
						platform
					);
				} catch (e) {
					logger.warn('[gise/finalizarSeccional] Falha ao notificar assessor (operação segue OK)', {
						giseId,
						secId,
						error: mensagemDeErro(e)
					});
				}
			} else {
				logger.warn(
					'[gise/finalizarSeccional] Assessor sem e-mail para notificação; e-mail não enviado.',
					{
						giseId,
						assessor_id: giseRow.assessor_id
					}
				);
			}
		}

		return { success: true, gise_status: giseStatus };
	},

	/** Horário padrão da seccional (as equipes podem sobrepor o seu). */
	salvarHorariosSec: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const giseId = parseInt(params.id);
		const formData = await request.formData();
		const secId = getInt(formData, 'secId');
		if (isNaN(giseId) || isNaN(secId)) return fail(400, { error: 'IDs inválidos' });

		const db = getDB(platform);
		const r2 = tryGetR2(platform) ?? null;
		const carga = await carregarGiseEditavel(db, giseId);
		if ('erro' in carga) return carga.erro;
		const { gise } = carga;

		const sec = await db
			.select()
			.from(giseSeccionais)
			.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
			.get();
		if (!sec) return fail(404, { error: 'Seccional não encontrada' });

		if (!podePreencherSeccional(u, sec.seccional_id)) {
			return fail(403, { error: 'Sem permissão para preencher esta seccional' });
		}

		// Formato DEPOIS da permissão: quem não pode preencher esta seccional
		// merece 403, não uma aula de formato de hora. Também mantém o teste de
		// autorização negativa robusto — se o payload dele passar a mandar uma
		// hora inválida, ele continua exercendo a PERMISSÃO em vez de parar num
		// 400 e passar por engano.
		//
		// Vazio é resposta legítima (herda o horário da escala), então só o
		// PREENCHIDO-e-inválido recusa. O valor alimenta o portão da janela de
		// presença, que falha aberto com hora que não parseia — ver `dataIso`.
		const horaEntrada = horaHhMm(formData, 'hora_entrada');
		const horaSaida = horaHhMm(formData, 'hora_saida');
		if (
			(informado(formData, 'hora_entrada') && horaEntrada === null) ||
			(informado(formData, 'hora_saida') && horaSaida === null)
		) {
			return fail(400, { error: 'Horário inválido — use HH:MM.' });
		}

		await atualizarGiseSeccional(db, secId, {
			hora_entrada: horaEntrada,
			hora_saida: horaSaida
		});

		// Horário sai impresso no relatório de extra: mudou, as assinaturas desta
		// seccional caem.
		const invalidacao = await invalidarAssinaturasDaSeccional(db, r2, giseId, secId, gise.status);

		await concluirMudancaGise(event, {
			db,
			giseId,
			usuario: u,
			acao: 'gise_seccional_alterada',
			alvo: { tipo: 'unidade', id: sec.seccional_id, nome: null },
			detalhes: `Horário da seccional ${secId}: ${horaEntrada || '—'} às ${horaSaida || '—'}`,
			invalidacao,
			metadados: { gise_seccional_id: secId },
			dados_antes: { hora_entrada: sec.hora_entrada, hora_saida: sec.hora_saida },
			dados_depois: { hora_entrada: horaEntrada || null, hora_saida: horaSaida || null }
		});

		return { success: true };
	}
};
