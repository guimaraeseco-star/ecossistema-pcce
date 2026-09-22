/**
 * As PENDÊNCIAS de um usuário (E59): o que depende dele para andar.
 * Calculadas ao vivo das tabelas de origem — nunca gravadas —, porque somem
 * sozinhas quando a pessoa resolve no lugar certo, e é isso que as
 * distingue das notícias (`lib/db/avisos.ts`), que se leem e se marcam.
 *
 * Para o Admin Geral: os pedidos da ponta aguardando a homologação dele
 * (alterações de cadastro e ações de RH, direção incluída). Para o admin de
 * unidade e o de seccional: o que a unidade precisa resolver nas férias —
 * pedidos à COGEP aguardando a homologação da resposta e abonos deferidos
 * sem a ciência dela. Cada item traz o LINK do lugar onde se resolve e o
 * CARTÃO da home que acende.
 */
import { eq, sql } from 'drizzle-orm';
import { cadastroSolicitacoes, policialAcaoSolicitacoes } from '$lib/server/schema';
import { pendenciasDeFeriasPorLotacao } from '$lib/db/policiais/ferias';
import {
	titularesAusentesSemRespondencia,
	type TitularAusente
} from '$lib/db/unidades-responsaveis';
import type { Database } from '$lib/db/core';
import { isAdminGeral, type UsuarioLogado } from '$lib/auth';
import { lotacoesAdministradas } from '$lib/server/policial-permissao';

export interface Pendencia {
	/** O cartão da home que acende. */
	cartao: string;
	tipo: string;
	titulo: string;
	/** Quantos itens a pendência agrupa (a fila tem N pedidos). */
	quantidade: number;
	/** Onde se resolve. */
	link: string;
}

/** As pendências do usuário, na ordem em que a caixa as mostra. */
export async function pendenciasDoUsuario(db: Database, u: UsuarioLogado): Promise<Pendencia[]> {
	if (isAdminGeral(u)) return pendenciasDoAdminGeral(db);
	const escopo = await lotacoesAdministradas(db, u);
	if (!escopo || escopo.size === 0) return [];
	return pendenciasDaUnidade(db, escopo);
}

async function pendenciasDoAdminGeral(db: Database): Promise<Pendencia[]> {
	const [cadastro, acoes, ausentes] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)` })
			.from(cadastroSolicitacoes)
			.where(eq(cadastroSolicitacoes.status, 'pendente'))
			.get(),
		db
			.select({ tipo: policialAcaoSolicitacoes.tipo, n: sql<number>`count(*)` })
			.from(policialAcaoSolicitacoes)
			.where(eq(policialAcaoSolicitacoes.status, 'pendente'))
			.groupBy(policialAcaoSolicitacoes.tipo),
		titularesAusentesSemRespondencia(db)
	]);
	const itens: Pendencia[] = [];
	const nCadastro = Number(cadastro?.n ?? 0);
	if (nCadastro > 0) {
		itens.push({
			cartao: 'servidores',
			tipo: 'cadastro_pendente',
			titulo: `${nCadastro} alteração${nCadastro === 1 ? '' : 'ões'} de cadastro aguardando a sua decisão`,
			quantidade: nCadastro,
			link: '/solicitacoes'
		});
	}
	const rh = acoes.filter((a) => a.tipo !== 'direcao').reduce((s, a) => s + Number(a.n), 0);
	if (rh > 0) {
		itens.push({
			cartao: 'servidores',
			tipo: 'acao_rh_pendente',
			titulo: `${rh} pedido${rh === 1 ? '' : 's'} de afastamento/RH aguardando a sua decisão`,
			quantidade: rh,
			link: '/solicitacoes'
		});
	}
	const direcao = acoes.filter((a) => a.tipo === 'direcao').reduce((s, a) => s + Number(a.n), 0);
	if (direcao > 0) {
		itens.push({
			cartao: 'unidade',
			tipo: 'direcao_pendente',
			titulo: `${direcao} proposta${direcao === 1 ? '' : 's'} de direção de unidade aguardando a sua decisão`,
			quantidade: direcao,
			link: '/solicitacoes'
		});
	}
	const semRespondencia = pendenciaDeRespondencia(ausentes);
	if (semRespondencia) itens.push(semRespondencia);
	return itens;
}

/**
 * "Titular ausente sem respondente" (E68) — a pendência que nasce sozinha das
 * férias e dos afastamentos, e some sozinha quando a cobertura é registrada.
 *
 * Uma linha só, com a contagem: a caixa é para saber QUE há o que resolver,
 * não para listar; a lista está na ficha de cada unidade, que é onde se
 * resolve. O texto diz a unidade quando é uma só, porque nesse caso o nome
 * poupa um clique.
 */
function pendenciaDeRespondencia(ausentes: TitularAusente[]): Pendencia | null {
	if (ausentes.length === 0) return null;
	const uma = ausentes.length === 1 ? ausentes[0] : null;
	return {
		cartao: 'unidade',
		tipo: 'respondencia_pendente',
		titulo: uma
			? `${uma.unidade_nome}: o titular se ausenta em ${uma.data_inicio} e ninguém responde pela unidade`
			: `${ausentes.length} unidades com o titular se ausentando e ninguém respondendo`,
		quantidade: ausentes.length,
		// Com mais de uma, a lista JÁ FILTRADA — mandar para a árvore inteira
		// obrigava a abrir unidade por unidade para descobrir quais eram.
		link: uma ? `/unidade/${uma.unidade_id}` : '/unidade?pendencia=respondencia'
	};
}

async function pendenciasDaUnidade(db: Database, escopo: Set<string>): Promise<Pendencia[]> {
	const [porLotacao, ausentes] = await Promise.all([
		pendenciasDeFeriasPorLotacao(db),
		titularesAusentesSemRespondencia(db)
	]);
	let reprog = 0;
	let abonos = 0;
	for (const [lotacao, p] of porLotacao) {
		if (!escopo.has(lotacao)) continue;
		reprog += p.reprogramacoesPendentes;
		abonos += p.abonosSemCiencia;
	}
	const itens: Pendencia[] = [];
	if (reprog > 0) {
		itens.push({
			cartao: 'servidores',
			tipo: 'ferias_reprogramacao',
			titulo: `${reprog} pedido${reprog === 1 ? '' : 's'} de reprogramação de férias aguardando a resposta da COGEP — homologue quando ela chegar`,
			quantidade: reprog,
			link: '/servidores'
		});
	}
	if (abonos > 0) {
		itens.push({
			cartao: 'servidores',
			tipo: 'abono_sem_ciencia',
			titulo: `${abonos} abono${abonos === 1 ? '' : 's'} de férias deferido${abonos === 1 ? '' : 's'} sem a ciência da unidade — nesses dias o servidor trabalha`,
			quantidade: abonos,
			link: '/servidores'
		});
	}
	// A unidade e a seccional veem a ausência das unidades que administram: é
	// delas a indicação de quem responde (E68).
	const semRespondencia = pendenciaDeRespondencia(
		ausentes.filter((a) => escopo.has(a.unidade_nome))
	);
	if (semRespondencia) itens.push(semRespondencia);
	return itens;
}
