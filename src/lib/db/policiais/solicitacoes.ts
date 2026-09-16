/**
 * Solicitações de alteração CADASTRAL do policial (nome, matrícula, cargo, CPF,
 * telefone, classe, regime, e-mail funcional).
 *
 * Fluxo: o administrador de seccional ou de unidade abre a ficha de um servidor
 * do escopo dele e pede a correção, com justificativa; o Admin Geral aprova
 * (aplica no cadastro) ou rejeita na aba "Solicitações". Uma nova solicitação
 * pendente do MESMO campo do mesmo servidor substitui a anterior.
 *
 * Duas coisas NÃO passam por aqui, e as duas por motivo próprio (ver
 * `$lib/cadastro-campos`): e-mail pessoal, que só o titular troca, e lotação,
 * que virou pedido de movimentação com portaria anexa
 * (`./acao-solicitacoes.ts`).
 */

import { and, eq, desc, inArray } from 'drizzle-orm';
import type { Database } from '../core';
import { linhasAfetadas } from '../core';
import { cadastroSolicitacoes, policiais } from '$lib/server/schema';
import type { CadastroSolicitacao } from '$lib/server/schema';
import type { CampoSolicitacao } from '$lib/cadastro-campos';
import type { CpfCriptoEnv } from '../../crypto/cpf-cripto';
import { atualizarPolicial } from './cadastro';

export type { CampoSolicitacao };

/** Uma mudança pedida: o campo, o que está gravado hoje e o que se quer no lugar. */
export interface MudancaSolicitada {
	campo: CampoSolicitacao;
	valorAtual: string | null;
	valorNovo: string;
}

/** Quem pediu — o administrador com escopo sobre o servidor alvo. */
export interface Solicitante {
	id: number;
	nome: string;
}

/**
 * Registra as mudanças pedidas (1 linha por campo), substituindo qualquer
 * pendente anterior do mesmo campo do mesmo policial.
 *
 * A justificativa se repete em todas as linhas do mesmo pedido: elas são
 * decididas UMA A UMA (o Admin Geral pode aprovar o telefone e recusar a
 * classe), e uma linha sem o motivo ao lado obrigaria quem decide a procurar o
 * motivo em outra linha da fila.
 */
export async function criarSolicitacoesCadastro(
	db: Database,
	policialId: number,
	mudancas: MudancaSolicitada[],
	justificativa: string,
	solicitante: Solicitante
): Promise<void> {
	if (mudancas.length === 0) return;
	const campos = mudancas.map((m) => m.campo);
	await db
		.delete(cadastroSolicitacoes)
		.where(
			and(
				eq(cadastroSolicitacoes.policial_id, policialId),
				eq(cadastroSolicitacoes.status, 'pendente'),
				inArray(cadastroSolicitacoes.campo, campos)
			)
		);
	await db.insert(cadastroSolicitacoes).values(
		mudancas.map((m) => ({
			policial_id: policialId,
			campo: m.campo,
			valor_atual: m.valorAtual,
			valor_novo: m.valorNovo,
			justificativa,
			solicitante_id: solicitante.id,
			solicitante_nome: solicitante.nome
		}))
	);
}

/**
 * Solicitações de UM policial, mais recentes primeiro (histórico curto).
 * Alimenta o quadro da ficha, que mostra ao administrador o que ele já pediu e
 * o que o Admin Geral decidiu.
 */
export async function listarSolicitacoesDoPolicial(
	db: Database,
	policialId: number,
	limit = 20
): Promise<CadastroSolicitacao[]> {
	return db
		.select()
		.from(cadastroSolicitacoes)
		.where(eq(cadastroSolicitacoes.policial_id, policialId))
		.orderBy(desc(cadastroSolicitacoes.id))
		.limit(limit)
		.all();
}

export interface SolicitacaoPendenteComPolicial extends CadastroSolicitacao {
	policial_nome: string;
	policial_matricula: string;
	policial_cargo: string;
	policial_lotacao: string;
}

/** Pendentes para a aba "Solicitações" do Admin Geral, com dados do policial. */
export async function listarSolicitacoesCadastroPendentes(
	db: Database
): Promise<SolicitacaoPendenteComPolicial[]> {
	const rows = await db
		.select({
			id: cadastroSolicitacoes.id,
			policial_id: cadastroSolicitacoes.policial_id,
			campo: cadastroSolicitacoes.campo,
			valor_atual: cadastroSolicitacoes.valor_atual,
			valor_novo: cadastroSolicitacoes.valor_novo,
			justificativa: cadastroSolicitacoes.justificativa,
			solicitante_id: cadastroSolicitacoes.solicitante_id,
			solicitante_nome: cadastroSolicitacoes.solicitante_nome,
			status: cadastroSolicitacoes.status,
			decidido_por: cadastroSolicitacoes.decidido_por,
			decidido_em: cadastroSolicitacoes.decidido_em,
			created_at: cadastroSolicitacoes.created_at,
			policial_nome: policiais.nome,
			policial_matricula: policiais.matricula,
			policial_cargo: policiais.cargo,
			policial_lotacao: policiais.lotacao
		})
		.from(cadastroSolicitacoes)
		.innerJoin(policiais, eq(policiais.id, cadastroSolicitacoes.policial_id))
		.where(eq(cadastroSolicitacoes.status, 'pendente'))
		.orderBy(desc(cadastroSolicitacoes.id))
		.all();
	return rows as SolicitacaoPendenteComPolicial[];
}

/**
 * Decide uma solicitação pendente. Aprovação APLICA o valor no cadastro do
 * policial depois de virar o status — o `WHERE status='pendente'` é a tranca
 * (SEC-36): dois cliques simultâneos não reescrevem uma decisão já tomada.
 * Devolve a solicitação decidida ou `null` se não estava mais pendente.
 *
 * **A gravação vai por `atualizarPolicial`, e não por um `UPDATE` daqui.** Havia
 * um, e ele produzia um cadastro diferente do que a edição direta produz para o
 * mesmo valor:
 *
 *  - **matrícula** é normalizada (`limparMatricula` tira pontos e hífens);
 *    aprovar `301.095-1` gravaria a forma pontuada, e o login por matrícula
 *    deixaria de casar com o que o Admin Geral teria gravado à mão;
 *  - **CPF** é cifrado em repouso e tem índice cego (`cpf_index`); gravar
 *    `valor_novo` na coluna deixaria o número em claro e o índice apontando para
 *    o anterior — o lookup por CPF (que a assinatura com certificado usa para
 *    casar titular e servidor) pararia de encontrar a pessoa.
 *
 * `env` carrega a chave de cifra do CPF; sem ela o CPF fica em claro, como no
 * resto do sistema em desenvolvimento.
 *
 * Pode LANÇAR: aprovar uma matrícula que já pertence a outro servidor viola o
 * índice único. O chamador distingue com `ehViolacaoUnique` e responde 409 — a
 * solicitação já ficou fechada, o cadastro não mudou.
 */
export async function decidirSolicitacaoCadastro(
	db: Database,
	solicitacaoId: number,
	aprovar: boolean,
	adminId: number,
	env?: CpfCriptoEnv
): Promise<CadastroSolicitacao | null> {
	const sol = await db
		.select()
		.from(cadastroSolicitacoes)
		.where(
			and(eq(cadastroSolicitacoes.id, solicitacaoId), eq(cadastroSolicitacoes.status, 'pendente'))
		)
		.get();
	if (!sol) return null;

	const r = await db
		.update(cadastroSolicitacoes)
		.set({
			status: aprovar ? 'aprovada' : 'rejeitada',
			decidido_por: adminId,
			decidido_em: new Date().toISOString()
		})
		.where(
			and(eq(cadastroSolicitacoes.id, solicitacaoId), eq(cadastroSolicitacoes.status, 'pendente'))
		);
	if (linhasAfetadas(r) === 0) return null;

	if (!aprovar) {
		return { ...sol, status: 'rejeitada' };
	}

	// `designacao_id` é o único campo que guarda uma REFERÊNCIA, não texto: vai
	// para a coluna como número, e a aprovação marca `designacao_origem` como
	// `'sistema'` — quem homologou foi o Admin Geral, e a próxima carga da
	// planilha tem de respeitar isso como respeita a edição direta (0089/E50).
	const mudanca =
		sol.campo === 'designacao_id'
			? {
					designacao_id: sol.valor_novo ? Number(sol.valor_novo) : null,
					designacao_origem: 'sistema' as const
				}
			: { [sol.campo]: sol.valor_novo };
	await atualizarPolicial(db, sol.policial_id, mudanca, env);
	return { ...sol, status: 'aprovada' };
}
