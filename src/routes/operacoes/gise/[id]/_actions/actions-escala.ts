/**
 * Form actions da ESCALA GISE em si (quadro de supervisão, datas, ciclo de
 * status e exclusão). Todas restritas ao Admin Geral.
 */

import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	getR2,
	buscarGiseEscala,
	atualizarGiseEscala,
	finalizarGiseEscala,
	reabrirGiseEscala,
	verificarConflitoHorarioPorGise,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { modoDeFinalizacao, PENDENCIAS_DA_ANTECIPADA } from '$lib/gise/finalizacao';
import { escalaGiseJaAssinada } from '$lib/gise/status-escala';
import { invalidarPapelGiseMultiplos, coletarAfetadosGise } from '$lib/server/gise/papel-cache';
import {
	agendarSyncBaseEquipeAposFinalizar,
	executarSyncBaseEquipeGiseComResultado,
	type BaseEquipeEnv
} from '$lib/server/gise/base-equipe-sync';
import { policiais, giseDocumentos, giseEscalas } from '$lib/server/schema';
import {
	coletarChavesR2DoDocumentoGise,
	deletarChavesR2,
	limparR2DaGise,
	LIMPEZA_R2_VAZIA
} from '$lib/server/r2-cleanup';
import { eq } from 'drizzle-orm';
import { saiuDaFaseDeEdicao, carregarGiseEditavel, exigirAdminGeral } from './shared';
import { textoLimitado, dataIso, horaHhMm, MAX_EMAIL } from '$lib/server/form-data';
import { MAX_BREVE_TITULO, MAX_BREVE_PARAGRAFO } from '$lib/gise/breve-relatorio';

type Event = RequestEvent<{ id: string }>;

export const actionsEscala = {
	/**
	 * Define supervisor, assessor e os dois SEINT.
	 *
	 * As regras de cargo vêm da estrutura da corporação: supervisão é de delegado
	 * (DPC) e as demais funções são de OIP. É também aqui que a GISE sai de
	 * `em_definicao_supervisor` — ter supervisor é o que a torna preenchível
	 * pelas seccionais.
	 */
	salvarSupervisores: async (event: Event) => {
		const { request, locals, platform, params } = event;
		if (!locals.usuario) return fail(401, { error: 'Não autorizado' });
		const u = exigirAdminGeral(locals.usuario, 'Apenas Admin Geral pode editar');
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		const supervisorIdStr = formData.get('supervisor_id') as string;
		const supervisorId = supervisorIdStr ? parseInt(supervisorIdStr) : null;
		const assessorIdStr = formData.get('assessor_id') as string;
		const assessorId = assessorIdStr ? parseInt(assessorIdStr) : null;
		const seint1IdStr = formData.get('seint1_id') as string;
		const seint1Id = seint1IdStr ? parseInt(seint1IdStr) : null;
		const seint2IdStr = formData.get('seint2_id') as string;
		const seint2Id = seint2IdStr ? parseInt(seint2IdStr) : null;

		const db = getDB(platform);
		const carga = await carregarGiseEditavel(db, giseId);
		if ('erro' in carga) return carga.erro;
		const { gise } = carga;

		if (supervisorId !== null) {
			const p = await db
				.select({ cargo: policiais.cargo })
				.from(policiais)
				.where(eq(policiais.id, supervisorId))
				.get();
			if (!p) return fail(404, { error: 'Supervisor não encontrado' });
			if (p.cargo !== 'DPC') return fail(400, { error: 'Apenas DPC pode ser Supervisor' });
		}

		// Devolve o próprio `fail(...)` para o chamador repassar — evita repetir o
		// bloco de consulta + validação nos três papéis de OIP.
		const checkOip = async (id: number | null, label: string) => {
			if (id !== null) {
				const p = await db
					.select({ cargo: policiais.cargo })
					.from(policiais)
					.where(eq(policiais.id, id))
					.get();
				if (!p) return fail(404, { error: `${label} não encontrado` });
				if (p.cargo !== 'OIP') return fail(400, { error: `${label} deve ser OIP` });
			}
			return null;
		};

		const errAssessor = await checkOip(assessorId, 'Assessor');
		if (errAssessor) return errAssessor;
		const errSeint1 = await checkOip(seint1Id, 'SEINT 1');
		if (errSeint1) return errSeint1;
		const errSeint2 = await checkOip(seint2Id, 'SEINT 2');
		if (errSeint2) return errSeint2;

		// O assessor recebe aviso por e-mail a cada seccional que finaliza o
		// preenchimento; sem endereço confirmado a função não faz sentido, por isso
		// a confirmação é obrigatória quando há assessor.
		// O cap é o do endereço (RFC 5321): o regex abaixo prova o FORMATO e casa
		// com string de qualquer tamanho, então sem ele um `a@b.` seguido de 1 MB
		// de texto era gravado e mandado para o provedor de e-mail.
		const assessorEmailRaw = textoLimitado(formData, 'assessor_email_notificacao', MAX_EMAIL);
		const confirmarRaw = formData.get('confirmar_email_assessor');
		const confirmarEmailAssessor = confirmarRaw === '1' || confirmarRaw === 'on';
		const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(assessorEmailRaw);

		if (assessorId !== null) {
			if (!confirmarEmailAssessor) {
				return fail(400, {
					error:
						'Marque a confirmação do e-mail do assessor (avisos de preenchimento das seccionais) ou remova o assessor.'
				});
			}
			if (!assessorEmailRaw) {
				return fail(400, {
					error:
						'Informe o e-mail do assessor para receber avisos quando as seccionais enviarem a GISE.'
				});
			}
			if (!emailOk) {
				return fail(400, { error: 'E-mail do assessor inválido.' });
			}
		}

		// Ninguém pode estar em duas escalas no mesmo horário — inclusive no quadro
		// de supervisão, que não passa pelas validações de equipe.
		const rolesParaVerificar: Array<[number | null, string]> = [
			[supervisorId, 'Supervisor'],
			[assessorId, 'Assessor'],
			[seint1Id, 'SEINT 1'],
			[seint2Id, 'SEINT 2']
		];
		for (const [pid, label] of rolesParaVerificar) {
			if (pid === null) continue;
			const horarioCheck = await verificarConflitoHorarioPorGise(db, giseId, pid);
			if (!horarioCheck.ok) return fail(400, { error: `${label}: ${horarioCheck.motivo}` });
		}

		const updateData = {
			supervisor_id: supervisorId,
			assessor_id: assessorId,
			seint1_id: seint1Id,
			seint2_id: seint2Id,
			assessor_email_notificacao: assessorId !== null ? assessorEmailRaw : null,
			...(gise.status === 'em_definicao_supervisor' ? { status: 'em_preenchimento' as const } : {})
		};

		await atualizarGiseEscala(db, giseId, updateData);

		// Invalida o cache de papel de quem SAIU e de quem ENTROU: os dois lados
		// mudam de acesso ao `/operacoes/presenca`.
		await invalidarPapelGiseMultiplos([
			gise.supervisor_id,
			supervisorId,
			gise.assessor_id,
			assessorId,
			gise.seint1_id,
			seint1Id,
			gise.seint2_id,
			seint2Id
		]);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_gise',
				usuario: u,
				entidade: 'gise',
				entidade_id: giseId,
				alvo_tipo: 'gise',
				alvo_id: giseId,
				detalhes: `Quadro de supervisão da GISE ${giseId} definido`,
				dados_antes: {
					supervisor_id: gise.supervisor_id,
					assessor_id: gise.assessor_id,
					seint1_id: gise.seint1_id,
					seint2_id: gise.seint2_id
				},
				dados_depois: {
					supervisor_id: supervisorId,
					assessor_id: assessorId,
					seint1_id: seint1Id,
					seint2_id: seint2Id
				},
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/**
	 * Textos do breve relatório desta GISE. String vazia grava `null`, que faz o
	 * documento cair no texto padrão de `/operacoes/gise/config`.
	 */
	salvarBreveRelatorio: async ({ request, locals, platform, params }: Event) => {
		if (!locals.usuario) return fail(401, { error: 'Não autorizado' });
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		// Os MESMOS limites que `/operacoes/gise/operacoes` aplica a estas TRÊS colunas
		// (200/2000, via `textoOuHerda`). Aqui não havia limite nenhum — nem na
		// tela, nem no servidor —, e o texto entra em PDF assinado.
		const titulo = textoLimitado(formData, 'breve_relatorio_titulo', MAX_BREVE_TITULO);
		const textoSec = textoLimitado(
			formData,
			'breve_relatorio_texto_seccional',
			MAX_BREVE_PARAGRAFO
		);
		const textoSup = textoLimitado(
			formData,
			'breve_relatorio_texto_supervisao',
			MAX_BREVE_PARAGRAFO
		);

		const db = getDB(platform);
		const carga = await carregarGiseEditavel(db, giseId);
		if ('erro' in carga) return carga.erro;

		await atualizarGiseEscala(db, giseId, {
			breve_relatorio_titulo: titulo ? titulo : null,
			breve_relatorio_texto_seccional: textoSec ? textoSec : null,
			breve_relatorio_texto_supervisao: textoSup ? textoSup : null
		});

		return { success: true };
	},

	/**
	 * Data e horário-base da escala. Mudou depois que o PDF foi gerado? O
	 * documento é descartado e a GISE volta a `em_preenchimento` — a resposta
	 * avisa a tela (`assinatura_revogada`) para o usuário entender o retrocesso.
	 */
	salvarDatasHorarios: async ({ request, locals, platform, params }: Event) => {
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		// FORMATO conferido, não só "veio algo". Estes três alimentam
		// `horarioGiseLiberado`, que falha ABERTO quando a data/hora não parseia
		// (`isNaN(alvo.getTime()) → return true`, para não trancar a GISE inteira
		// por um dado ruim). O fail-open é a escolha certa lá; o preço é que um
		// `data_inicio` inválido gravado AQUI libera a confirmação de presença
		// fora do horário para todos os membros desta escala, sem erro nenhum.
		// Validar na escrita é o que dá piso ao portão sem mexer no fail-open.
		const dataInicio = dataIso(formData, 'data_inicio');
		const horaEntrada = horaHhMm(formData, 'hora_entrada');
		const horaSaida = horaHhMm(formData, 'hora_saida');
		const feriado = formData.get('feriado') === 'true';

		if (!dataInicio || !horaEntrada || !horaSaida) {
			return fail(400, {
				error: 'Preencha todos os campos com data (AAAA-MM-DD) e horários (HH:MM) válidos'
			});
		}

		const db = getDB(platform);
		const carga = await carregarGiseEditavel(db, giseId);
		if ('erro' in carga) return carga.erro;
		const { gise } = carga;
		const updateData: {
			data_inicio: string;
			hora_entrada: string;
			hora_saida: string;
			feriado: boolean;
			status?: 'em_preenchimento';
		} = {
			data_inicio: dataInicio,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida,
			feriado: feriado
		};

		let deveResetarStatus = false;
		if (saiuDaFaseDeEdicao(gise.status)) {
			// R2 antes do D1 — mudar data/horário da escala invalida o PDF assinado,
			// e a linha é a única coisa que sabe onde ele está (FLW-DOC-003).
			const r2Doc = getR2(platform);
			if (r2Doc) {
				await deletarChavesR2(
					db,
					r2Doc,
					await coletarChavesR2DoDocumentoGise(db, giseId),
					'edicao-escala-gise'
				);
			}
			await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
			updateData.status = 'em_preenchimento';
			deveResetarStatus = true;
		}

		await atualizarGiseEscala(db, giseId, updateData);
		return { success: true, assinatura_revogada: deveResetarStatus };
	},

	/** Envia a escala para a assinatura do supervisor. */
	solicitarAssinatura: async ({ locals, platform, params }: Event) => {
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const carga = await carregarGiseEditavel(db, giseId);
		if ('erro' in carga) return carga.erro;
		await atualizarGiseEscala(db, giseId, { status: 'aguardando_assinatura' });
		return { success: true };
	},

	/** Desfaz o pedido enquanto ninguém assinou (só vale em `aguardando_assinatura`). */
	revogarPedidoAssinatura: async ({ locals, platform, params }: Event) => {
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const carga = await carregarGiseEditavel(db, giseId);
		if ('erro' in carga) return carga.erro;
		const { gise } = carga;
		if (gise.status !== 'aguardando_assinatura')
			return fail(400, { error: 'Escala não está aguardando assinatura' });

		await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
		return { success: true };
	},

	/**
	 * Encerra a GISE. Dispara, sem bloquear a resposta, o envio da base de equipe
	 * para a planilha institucional (`agendarSyncBaseEquipeAposFinalizar`).
	 */
	finalizarGise: async (event: Event) => {
		const { locals, platform, params } = event;
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const carga = await carregarGiseEditavel(db, giseId);
		if ('erro' in carga) return carga.erro;
		const { gise } = carga;

		const modo = modoDeFinalizacao(gise.status);
		if (modo === 'bloqueado') {
			return fail(409, { error: 'Status não permite finalizar' });
		}

		// Coleta os policiais ANTES de mexer no status: é a lista de caches de papel
		// a invalidar depois.
		const afetados = await coletarAfetadosGise(db, giseId);

		// Mesmo CAS da rota de API: o `modoDeFinalizacao` acima escolhe a mensagem,
		// o UPDATE condicional é que decide. Dois cliques paralelos auditavam duas
		// vezes e mandavam a base de equipe duas vezes (SEC-35).
		const { finalizada } = await finalizarGiseEscala(db, giseId);
		if (!finalizada) return fail(409, { error: 'Escala já finalizada' });

		await invalidarPapelGiseMultiplos(afetados);

		agendarSyncBaseEquipeAposFinalizar(platform, db, giseId);

		// Esta action não auditava NADA — a rota de API equivalente auditava, e as
		// duas fazem a mesma coisa. Além de fechar essa lacuna, o evento distingue
		// a finalização ANTECIPADA da normal: as duas encerram a escala, mas só
		// uma delas deixa relatórios e confirmações de saída para trás
		// (FLW-GISE-005).
		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'finalizar_gise',
				usuario: u,
				entidade: 'gise',
				entidade_id: giseId,
				alvo_tipo: 'gise',
				alvo_id: giseId,
				severidade: modo === 'antecipada' ? 'aviso' : 'info',
				detalhes:
					modo === 'antecipada'
						? `GISE ${giseId} finalizada ANTECIPADAMENTE, sem ${PENDENCIAS_DA_ANTECIPADA.join(', ')}`
						: `GISE ${giseId} finalizada`,
				metadados: { modo, status_anterior: gise.status },
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/** Reenvio manual da base de equipe, para quando o envio automático falhou. */
	reenviarBaseEquipePlanilha: async ({ locals, platform, params }: Event) => {
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });
		if (gise.status !== 'finalizada') {
			return fail(400, { error: 'Só é possível enviar à planilha com a escala finalizada.' });
		}

		const r = await executarSyncBaseEquipeGiseComResultado(
			platform?.env as BaseEquipeEnv | undefined,
			db,
			giseId
		);
		if (!r.ok) {
			return fail(502, { error: r.error });
		}
		await atualizarGiseEscala(db, giseId, {
			planilha_base_equipe_alimentada_em: new Date().toISOString()
		});
		return { success: true, linhas: r.linhas };
	},

	/**
	 * Devolve uma escala já em operação para edição. Não vale para
	 * `aguardando_assinatura` — nesse ponto o caminho é `revogarPedidoAssinatura`.
	 */
	reabrirEscala: async ({ locals, platform, params }: Event) => {
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		// Só se reabre o que já passou da assinatura do supervisor. Mesmo
		// predicado que a tela usa para dizer "Escala assinada".
		if (!escalaGiseJaAssinada(gise.status)) {
			return fail(400, { error: 'Status não permite reabrir' });
		}

		const afetados = await coletarAfetadosGise(db, giseId);
		await reabrirGiseEscala(db, giseId);
		await invalidarPapelGiseMultiplos(afetados);

		return { success: true };
	},

	/** Exclui a GISE e tudo que ela gerou (linhas em cascata + arquivos no R2). */
	excluirGise: async ({ locals, platform, params }: Event) => {
		const u = exigirAdminGeral(locals.usuario);
		if (!('id' in u)) return u;

		const giseId = parseInt(params.id);
		if (isNaN(giseId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const gise = await buscarGiseEscala(db, giseId);
		if (!gise) return fail(404, { error: 'GISE não encontrada' });

		const afetados = await coletarAfetadosGise(db, giseId);

		// Limpeza unificada do R2 (blobs + conferências + selfies) — mesmo helper
		// usado por reabrir/revogar. Além de remover a duplicação, corrige o furo
		// em que as cópias de conferência (`conferencia/<hash>.pdf`, prefixo PLANO)
		// escapavam da varredura por prefixo `gise/...` e ficavam órfãs.
		const r2 = getR2(platform);
		const limpeza = r2
			? await limparR2DaGise(db, r2, gise, 'exclusao-gise')
			: { ...LIMPEZA_R2_VAZIA };

		await db.delete(giseEscalas).where(eq(giseEscalas.id, giseId));
		await invalidarPapelGiseMultiplos(afetados);
		// `pendentes` sai na resposta: o operador que acabou de apagar uma GISE
		// precisa saber se algum PDF assinado resistiu e ficou no bucket.
		return { success: true, files_deleted: limpeza.removidas, r2_pendentes: limpeza.pendentes };
	}
};
