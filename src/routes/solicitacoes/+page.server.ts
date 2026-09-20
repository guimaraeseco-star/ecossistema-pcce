/**
 * Aba "Solicitações" do Admin Geral — a fila onde os pedidos dos administradores
 * de seccional e de unidade viram (ou não) fato.
 *
 * Duas filas, porque são dois formatos e duas consequências:
 *
 *  - **dados cadastrais** — uma linha por campo, aprovadas ou recusadas
 *    individualmente: dá para aceitar a correção do telefone e recusar a da
 *    matrícula do mesmo pedido;
 *  - **ações de RH** — movimentar, afastar, desvincular. Aprovar aqui EXECUTA o
 *    ato (troca a lotação, inativa o servidor) pelo mesmo executor que a ficha
 *    usa no modo direto, e por isso a tela mostra o conteúdo INTEIRO do pedido,
 *    com o PDF anexo para baixar, antes de qualquer clique.
 *
 * Recusar um pedido com anexo apaga o PDF do bucket: nenhuma linha voltaria a
 * apontar para ele, e um objeto sem referência é dado pessoal guardado sem base
 * e sem rastro (a mesma regra do FLW-RBAC-005). Aprovar não apaga nada — a chave
 * passa a pertencer ao evento em `policial_historico`.
 */
import { redirect, fail } from '@sveltejs/kit';
import { avisarOutroLado, servidorParaAviso } from '$lib/server/avisos/emitir';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	getR2,
	hasR2,
	decidirSolicitacaoCadastro,
	listarSolicitacoesCadastroPendentes,
	listarSolicitacoesAcaoPendentes,
	listarDesignacoes,
	registrarAuditComContexto,
	contextoDeEvento
} from '$lib/db';
import { ehViolacaoUnique } from '$lib/server/db-errors';
import { deletarChavesR2 } from '$lib/server/r2-cleanup';
import { logger } from '$lib/server/logger';
import { mensagemDeErro } from '$lib/utils/erro';
import { ROTULO_CAMPO } from '$lib/cadastro-campos';

/** O nome do ato no título do aviso (E59). */
const ROTULO_TIPO_AVISO: Record<string, string> = {
	movimentacao: 'Movimentação',
	afastamento: 'Afastamento',
	desvinculacao: 'Desvinculação',
	direcao: 'Direção de unidade',
	retorno_antecipado: 'Retorno antecipado'
};
import { decidirSolicitacaoAcao } from '$lib/server/policiais/solicitacoes';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (u.tipo !== 'admin') redirect(302, '/bem-vindo');

	const db = getDB(platform);
	const [pendentes, acoesPendentes, designacoes] = await Promise.all([
		listarSolicitacoesCadastroPendentes(db),
		listarSolicitacoesAcaoPendentes(db),
		// O catálogo vai junto porque `designacao_id` guarda o id: sem ele a fila
		// pediria ao Admin Geral que decidisse entre "9" e "11" (E50).
		listarDesignacoes(db)
	]);
	return { pendentes, acoesPendentes, designacoes };
};

/** `id` + `decisao` do formulário, ou a mensagem de recusa. */
function lerDecisao(data: FormData): { id: number; aprovar: boolean } | { erro: string } {
	const id = Number(data.get('id'));
	const decisao = data.get('decisao')?.toString();
	if (isNaN(id) || (decisao !== 'aprovar' && decisao !== 'rejeitar')) {
		return { erro: 'Dados inválidos' };
	}
	return { id, aprovar: decisao === 'aprovar' };
}

export const actions: Actions = {
	decidir: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || u.tipo !== 'admin') return fail(403, { error: 'Apenas o Admin Geral decide' });

		const lida = lerDecisao(await request.formData());
		if ('erro' in lida) return fail(400, { error: lida.erro });
		const { id, aprovar } = lida;

		const db = getDB(platform);
		let sol;
		try {
			sol = await decidirSolicitacaoCadastro(db, id, aprovar, u.id, platform?.env);
		} catch (e) {
			// Matrícula pedida que já pertence a outro servidor: o índice único
			// recusa. O pedido já ficou FECHADO e o cadastro não mudou — a mensagem
			// precisa dizer isso, e não "tente de novo", que convidaria a reaprovar
			// uma linha que não está mais pendente.
			if (ehViolacaoUnique(e)) {
				return fail(409, {
					error:
						'Matrícula já cadastrada para outro servidor — a solicitação foi encerrada sem aplicar.'
				});
			}
			logger.error('[solicitacoes/decidir] Falha ao aplicar a decisão', {
				solicitacao_id: id,
				error: mensagemDeErro(e)
			});
			return fail(500, { error: 'Erro ao aplicar a decisão. Tente novamente.' });
		}
		if (!sol) {
			return fail(409, { error: 'Solicitação já decidida por outro administrador.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await registrarAuditComContexto(db, {
			usuario: u,
			acao: aprovar ? 'aprovar_alteracao_cadastro' : 'rejeitar_alteracao_cadastro',
			entidade: 'policial',
			entidade_id: sol.policial_id,
			alvo_tipo: 'policial',
			alvo_id: sol.policial_id,
			detalhes:
				`${aprovar ? 'Aprovada' : 'Rejeitada'} alteração de ${ROTULO_CAMPO[sol.campo]}` +
				// O CPF pedido não vai para a trilha (é lida por operador, e o número
				// já está protegido no cadastro por cifra + índice cego).
				(sol.campo === 'cpf' ? '' : `: "${sol.valor_atual ?? '—'}" → "${sol.valor_novo}"`),
			metadados: {
				solicitacao_id: sol.id,
				campo: sol.campo,
				solicitante_id: sol.solicitante_id,
				justificativa: sol.justificativa
			},
			dados_antes: sol.campo === 'cpf' ? null : { [sol.campo]: sol.valor_atual },
			dados_depois: aprovar && sol.campo !== 'cpf' ? { [sol.campo]: sol.valor_novo } : null,
			...contexto,
			env
		});

		// A delegacia que pediu fica sabendo da decisão (E59).
		const servidor = await servidorParaAviso(db, sol.policial_id);
		await avisarOutroLado(db, u, {
			cartao: 'servidores',
			tipo: aprovar ? 'cadastro_aprovado' : 'cadastro_rejeitado',
			titulo: `Alteração de ${ROTULO_CAMPO[sol.campo]} de ${servidor?.nome ?? 'servidor'} ${aprovar ? 'APROVADA' : 'REJEITADA'} pelo DPI SUL`,
			texto: sol.campo === 'cpf' ? '' : `"${sol.valor_atual ?? '—'}" → "${sol.valor_novo}"`,
			link: `/servidores/${sol.policial_id}`,
			lotacoes: [servidor?.lotacao]
		});

		const pendentes = await listarSolicitacoesCadastroPendentes(db);
		return { success: true, pendentes };
	},

	decidirAcao: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || u.tipo !== 'admin') return fail(403, { error: 'Apenas o Admin Geral decide' });

		const lida = lerDecisao(await request.formData());
		if ('erro' in lida) return fail(400, { error: lida.erro });
		const { id, aprovar } = lida;

		const db = getDB(platform);
		let pedido;
		try {
			pedido = await decidirSolicitacaoAcao(db, id, aprovar, u.id);
		} catch (e) {
			logger.error('[solicitacoes/decidirAcao] Falha ao executar o ato aprovado', {
				solicitacao_id: id,
				error: mensagemDeErro(e)
			});
			return fail(500, { error: 'Erro ao aplicar a decisão. Tente novamente.' });
		}
		if (!pedido) {
			return fail(409, { error: 'Solicitação já decidida por outro administrador.' });
		}

		// Recusado com anexo: o PDF perde a única linha que o referenciava.
		if (!aprovar && pedido.documento_r2_key && hasR2(platform)) {
			await deletarChavesR2(
				db,
				getR2(platform),
				[pedido.documento_r2_key],
				'solicitacao-acao-recusada'
			);
		}

		const { contexto, env } = contextoDeEvento(event);
		await registrarAuditComContexto(db, {
			usuario: u,
			acao: aprovar ? 'aprovar_acao_policial' : 'rejeitar_acao_policial',
			entidade: 'policial',
			entidade_id: pedido.policial_id,
			alvo_tipo: 'policial',
			alvo_id: pedido.policial_id,
			detalhes:
				`${aprovar ? 'Aprovada' : 'Rejeitada'} solicitação de ${pedido.tipo} ` +
				`pedida por ${pedido.solicitante_nome ?? '—'}`,
			metadados: {
				solicitacao_id: pedido.id,
				tipo: pedido.tipo,
				solicitante_id: pedido.solicitante_id,
				justificativa: pedido.justificativa,
				unidade_destino: pedido.unidade_destino,
				nup: pedido.nup
			},
			...contexto,
			env
		});

		// A delegacia que pediu fica sabendo da decisão (E59). Na direção, o
		// "servidor" é o delegado e a unidade dirigida é o destino.
		const servidor = await servidorParaAviso(db, pedido.policial_id);
		const ehDirecao = pedido.tipo === 'direcao';
		await avisarOutroLado(db, u, {
			cartao: ehDirecao ? 'unidade' : 'servidores',
			tipo: aprovar ? `${pedido.tipo}_aprovada` : `${pedido.tipo}_rejeitada`,
			titulo: `${ROTULO_TIPO_AVISO[pedido.tipo] ?? pedido.tipo} de ${servidor?.nome ?? 'servidor'} ${aprovar ? 'APROVADA' : 'REJEITADA'} pelo DPI SUL`,
			texto: ehDirecao ? (pedido.unidade_destino ?? '') : '',
			link: ehDirecao ? '/unidade' : `/servidores/${pedido.policial_id}`,
			lotacoes: [servidor?.lotacao, pedido.unidade_origem, pedido.unidade_destino]
		});

		const acoesPendentes = await listarSolicitacoesAcaoPendentes(db);
		return { success: true, acoesPendentes };
	}
};
