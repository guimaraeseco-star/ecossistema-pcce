/**
 * Linha do tempo funcional do policial (movimentação, afastamento, papel).
 * APPEND-ONLY: a ficha explica o cadastro; a trilha forense de `/auditoria`
 * é outro registro. Mutação de cadastro + evento entram no mesmo `db.batch`
 * (`atualizarPolicialComHistorico`) para não deixar lotação trocada sem
 * portaria (FLW-RBAC-005).
 */
import { eq, desc } from 'drizzle-orm';
import { policiais, policialHistorico } from '../../server/schema';
import type { PolicialHistorico } from '../../server/schema';
import type { Database } from '../core';
import { camposDeAtualizacao, type CamposDoPolicial } from './cadastro';
import type { CpfCriptoEnv } from '../../crypto/cpf-cripto';

type TipoHistorico =
	'movimentacao' | 'afastamento' | 'desvinculacao' | 'edicao' | 'papel' | 'observacao';

/**
 * O que um evento funcional DESCREVE: unidades, datas, protocolo e o PDF anexo.
 *
 * Está separado do resto de `NovoEventoHistorico` porque estes campos aparecem
 * três vezes no mesmo fluxo — no evento gravado aqui, no ato que
 * `$lib/server/policiais/acoes-rh` executa, e no PEDIDO que espera aprovação em
 * `./acao-solicitacoes`. As três formas são a mesma coisa em momentos
 * diferentes da vida de um ato de RH, e mantê-las como três listas de campos
 * copiadas deixaria que uma ganhasse (ou perdesse) um campo sozinha: um pedido
 * capaz de carregar um dado que a aprovação não sabe gravar.
 */
export interface CamposDoEventoFuncional {
	/** Subtipo do afastamento: ferias | licenca_medica | judicial | licenca_outros | outros. */
	subtipo?: string | null;
	/** Motivo/descrição livre (afastamento) ou destino do policial (desvinculação). */
	descricao?: string | null;
	unidade_origem?: string | null;
	unidade_destino?: string | null;
	/** Data principal do evento (movimentação/desvinculação). */
	data_evento?: string | null;
	data_inicio?: string | null;
	data_fim?: string | null;
	qtd_dias?: number | null;
	/** Número Único de Protocolo do processo que fundamenta o ato. */
	nup?: string | null;
	documento_r2_key?: string | null;
	documento_nome?: string | null;
}

/** Dados para registrar um evento no histórico funcional do policial. */
export interface NovoEventoHistorico extends CamposDoEventoFuncional {
	policial_id: number;
	tipo: TipoHistorico;
	/** JSON do snapshot ANTES — só nos tipos `edicao` e `papel`. */
	dados_antes?: Record<string, unknown> | null;
	/** JSON do snapshot DEPOIS — só nos tipos `edicao` e `papel`. */
	dados_depois?: Record<string, unknown> | null;
	registrado_por_id?: number | null;
	registrado_por_nome?: string | null;
}

function comoJson(v: Record<string, unknown> | null | undefined): string | null {
	if (v == null) return null;
	try {
		return JSON.stringify(v);
	} catch {
		return null;
	}
}

/** O INSERT do evento, ainda NÃO executado — para compor num `db.batch`. */
function inserirHistoricoQuery(db: Database, evento: NovoEventoHistorico) {
	return db.insert(policialHistorico).values({
		policial_id: evento.policial_id,
		tipo: evento.tipo,
		subtipo: evento.subtipo ?? null,
		descricao: evento.descricao ?? null,
		unidade_origem: evento.unidade_origem ?? null,
		unidade_destino: evento.unidade_destino ?? null,
		data_evento: evento.data_evento ?? null,
		data_inicio: evento.data_inicio ?? null,
		data_fim: evento.data_fim ?? null,
		qtd_dias: evento.qtd_dias ?? null,
		nup: evento.nup ?? null,
		documento_r2_key: evento.documento_r2_key ?? null,
		documento_nome: evento.documento_nome ?? null,
		dados_antes: comoJson(evento.dados_antes),
		dados_depois: comoJson(evento.dados_depois),
		registrado_por_id: evento.registrado_por_id ?? null,
		registrado_por_nome: evento.registrado_por_nome ?? null
	});
}

/** Insere um evento imutável na linha do tempo do policial e devolve o id gerado. */
export async function registrarHistorico(
	db: Database,
	evento: NovoEventoHistorico
): Promise<number> {
	const row = await inserirHistoricoQuery(db, evento).returning({ id: policialHistorico.id });
	return row[0]?.id;
}

/**
 * Muda o cadastro E grava o evento na linha do tempo, NA MESMA TRANSAÇÃO.
 *
 * Movimentação, mudança de papel e desvinculação faziam as duas escritas em
 * chamadas independentes (FLW-RBAC-005). Uma falha entre elas deixava o estado
 * que a ficha do policial não sabe explicar: a lotação trocada sem a portaria
 * na linha do tempo, ou — na desvinculação — o cadastro inativado sem registro
 * de quem o inativou, de quando e com base em qual NUP.
 *
 * `db.batch` é transação no D1: as duas entram ou nenhuma entra. É por isso que
 * o UPDATE precisa vir como query builder e não como `await` — ver
 * `camposDeAtualizacao`.
 *
 * A AUDITORIA fica de fora do batch de propósito, e isso não é esquecimento:
 * `auditar()` nunca lança e resolve a própria falha por pendência durável
 * (FLW-AUDIT-001). Metê-la aqui trocaria uma garantia que já existe pela
 * possibilidade de a mutação do usuário ser desfeita por causa da trilha —
 * exatamente a política que o operador recusou.
 */
export async function atualizarPolicialComHistorico(
	db: Database,
	policialId: number,
	mudanca: CamposDoPolicial,
	evento: NovoEventoHistorico,
	env?: CpfCriptoEnv
): Promise<void> {
	await db.batch([
		db
			.update(policiais)
			.set(await camposDeAtualizacao(mudanca, env))
			.where(eq(policiais.id, policialId)),
		inserirHistoricoQuery(db, evento)
	]);
}

/** Lista o histórico de um policial, do mais recente para o mais antigo. */
export async function listarHistoricoPolicial(
	db: Database,
	policialId: number
): Promise<PolicialHistorico[]> {
	return db
		.select()
		.from(policialHistorico)
		.where(eq(policialHistorico.policial_id, policialId))
		.orderBy(desc(policialHistorico.created_at), desc(policialHistorico.id));
}

/** Busca um evento específico (para download do documento / verificação de permissão). */
export async function buscarEventoHistorico(
	db: Database,
	eventoId: number
): Promise<PolicialHistorico | undefined> {
	return db.select().from(policialHistorico).where(eq(policialHistorico.id, eventoId)).get();
}

/**
 * Deriva se o policial está em afastamento HOJE a partir do histórico já
 * carregado (evita nova ida ao banco). Considera o afastamento vigente quando
 * `data_inicio <= hoje <= data_fim` (ou sem `data_fim`, aberto). Devolve o
 * evento vigente ou `null`.
 */
export function afastamentoVigente(
	historico: PolicialHistorico[],
	hojeISO: string
): PolicialHistorico | null {
	for (const ev of historico) {
		if (ev.tipo !== 'afastamento' || !ev.data_inicio) continue;
		const inicio = ev.data_inicio;
		const fim = ev.data_fim || null;
		if (inicio <= hojeISO && (!fim || hojeISO <= fim)) return ev;
	}
	return null;
}
