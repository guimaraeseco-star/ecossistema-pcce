/**
 * O relatório diário dos colaboradores (E61-b) — a orquestração que o cron
 * dispara: para cada unidade com ação de colaborador no dia, reserva o "já
 * mandei", manda o e-mail a cada admin da unidade com e-mail pessoal e audita.
 *
 * Idempotente por construção: a reserva (`relatorios_colaboradores`, chave
 * unidade + dia) vem ANTES do envio, então uma reexecução — retentativa do
 * workflow, disparo manual — pula o que já saiu. O preço é o caso raro de a
 * reserva gravar e o e-mail falhar: fica na trilha (`erros`) e no log, e o
 * admin recebe a linha no dia seguinte só se alguém disparar com `dia=`.
 *
 * Unidade cujo admin não tem e-mail pessoal: nada a fazer, e o resumo diz
 * qual — é o Admin Geral quem corrige o cadastro.
 */
import type { Database } from '$lib/db';
import {
	acoesDeColaboradoresNoDia,
	adminsDaUnidade,
	relatoriosJaEnviados,
	reservarRelatorio
} from '$lib/db/colaboradores-relatorio';
import { registrarAuditComContexto } from '$lib/db';
import { enviarRelatorioColaboradores } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { mensagemDeErro } from '$lib/utils/erro';

export interface ResumoDoRelatorio {
	dia: string;
	/** Unidades com ação no dia. */
	unidadesComAcao: number;
	/** Relatórios mandados nesta execução. */
	enviados: { unidade: string; destinatarios: number; acoes: number }[];
	/** Já tinham saído (reexecução). */
	jaEnviados: string[];
	/** Sem admin de unidade com e-mail pessoal — ninguém para receber. */
	semDestinatario: string[];
	/** Falha no envio (a reserva ficou; ver o log). */
	erros: { unidade: string; erro: string }[];
}

export async function enviarRelatoriosDoDia(
	db: Database,
	platform: App.Platform | undefined,
	diaISO: string
): Promise<ResumoDoRelatorio> {
	const resumo: ResumoDoRelatorio = {
		dia: diaISO,
		unidadesComAcao: 0,
		enviados: [],
		jaEnviados: [],
		semDestinatario: [],
		erros: []
	};
	const [porUnidade, jaEnviados] = await Promise.all([
		acoesDeColaboradoresNoDia(db, diaISO),
		relatoriosJaEnviados(db, diaISO)
	]);
	resumo.unidadesComAcao = porUnidade.length;

	for (const grupo of porUnidade) {
		if (jaEnviados.has(grupo.unidade_id)) {
			resumo.jaEnviados.push(grupo.unidade);
			continue;
		}
		const admins = (await adminsDaUnidade(db, grupo.unidade_id)).filter(
			(a): a is typeof a & { email_pessoal: string } => !!a.email_pessoal
		);
		if (admins.length === 0) {
			resumo.semDestinatario.push(grupo.unidade);
			continue;
		}
		const reservou = await reservarRelatorio(
			db,
			grupo.unidade_id,
			diaISO,
			admins.map((a) => a.nome),
			grupo.acoes.length
		);
		if (!reservou) {
			resumo.jaEnviados.push(grupo.unidade);
			continue;
		}
		try {
			for (const admin of admins) {
				await enviarRelatorioColaboradores(
					admin.email_pessoal,
					admin.nome,
					grupo.unidade,
					diaISO,
					grupo.acoes,
					platform
				);
			}
			await registrarAuditComContexto(db, {
				usuario: null,
				acao: 'relatorio_colaboradores',
				entidade: 'unidade',
				entidade_id: grupo.unidade_id,
				detalhes: `Relatório de ${diaISO} da ${grupo.unidade}: ${grupo.acoes.length} ação(ões) de colaborador, ${admins.length} destinatário(s)`,
				env: platform?.env
			});
			resumo.enviados.push({
				unidade: grupo.unidade,
				destinatarios: admins.length,
				acoes: grupo.acoes.length
			});
		} catch (err) {
			const erro = mensagemDeErro(err);
			logger.error('[relatorio-colaboradores] falha ao enviar', { unidade: grupo.unidade, erro });
			resumo.erros.push({ unidade: grupo.unidade, erro });
		}
	}
	return resumo;
}
