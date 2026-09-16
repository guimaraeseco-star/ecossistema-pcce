/**
 * Quem responde pela unidade — a DIREÇÃO, com vigência.
 *
 * Duas figuras, e a diferença é de vínculo, não de poder (§7.1 da proposta da
 * fase 2):
 *
 * - **titular**: o delegado designado para AQUELA unidade;
 * - **respondente**: o delegado de OUTRA unidade que responde por esta
 *   subsidiariamente enquanto ela está sem titular. Ele não entra no efetivo
 *   daqui — continua lotado e contado onde está.
 *
 * Só DPC dirige unidade (decisão de 14/09/2026): designação de direção em
 * servidor OIP é erro de cadastro, não titularidade, e esta camada recusa.
 *
 * **Uma linha vigente por unidade** — `data_fim IS NULL` — garantido por índice
 * parcial no banco (0088). Por isso trocar o responsável é sempre um par de
 * operações na MESMA transação: encerra a vigente na véspera do início da nova
 * e insere a nova. Em dois `await` separados, o intervalo entre eles teria duas
 * vigentes (que o índice recusa) ou nenhuma.
 *
 * `origem` diz de onde veio: `'planilha'` é o que a carga de pessoal grava e
 * regrava; `'sistema'` é o cadastro pela tela, que a carga não sobrescreve
 * (ver `regravarTitularDaPlanilha`). Enquanto a migração das planilhas não
 * termina, é essa distinção que protege o que foi registrado à mão — depois
 * dela, tudo é `'sistema'` (decisão E52).
 */
import { and, desc, eq, isNull, inArray, sql } from 'drizzle-orm';
import { policiais, unidadeResponsaveis, unidades, designacoes } from '../server/schema';
import type { Database } from './core';

/** O responsável, já com o nome e a função de quem é. */
export interface ResponsavelDaUnidade {
	id: number;
	unidade_id: number;
	policial_id: number;
	policial_nome: string;
	policial_matricula: string;
	policial_lotacao: string;
	designacao: string | null;
	papel: 'titular' | 'respondente';
	data_inicio: string;
	data_fim: string | null;
	/** O processo que PEDE a designação; a portaria é o ato, e vem depois. */
	nup: string;
	portaria: string;
	observacao: string;
	origem: 'sistema' | 'planilha';
	registrado_por_nome: string;
}

const PROJECAO = {
	id: unidadeResponsaveis.id,
	unidade_id: unidadeResponsaveis.unidade_id,
	policial_id: unidadeResponsaveis.policial_id,
	policial_nome: policiais.nome,
	policial_matricula: policiais.matricula,
	policial_lotacao: policiais.lotacao,
	designacao: designacoes.nome,
	papel: unidadeResponsaveis.papel,
	data_inicio: unidadeResponsaveis.data_inicio,
	data_fim: unidadeResponsaveis.data_fim,
	nup: unidadeResponsaveis.nup,
	portaria: unidadeResponsaveis.portaria,
	observacao: unidadeResponsaveis.observacao,
	origem: unidadeResponsaveis.origem,
	registrado_por_nome: unidadeResponsaveis.registrado_por_nome
};

/** O vigente de UMA unidade, ou `null` quando ela está sem direção. */
export async function responsavelVigente(
	db: Database,
	unidadeId: number
): Promise<ResponsavelDaUnidade | null> {
	const linha = await db
		.select(PROJECAO)
		.from(unidadeResponsaveis)
		.innerJoin(policiais, eq(policiais.id, unidadeResponsaveis.policial_id))
		.leftJoin(designacoes, eq(designacoes.id, policiais.designacao_id))
		.where(and(eq(unidadeResponsaveis.unidade_id, unidadeId), isNull(unidadeResponsaveis.data_fim)))
		.get();
	return (linha as ResponsavelDaUnidade) ?? null;
}

/**
 * O D1 aceita 100 parâmetros vinculados por consulta, e a subárvore do
 * departamento passa disso — a lista da Gestão de unidade pede os vigentes de
 * todas as unidades de uma vez.
 */
const FATIA_D1 = 90;

/** Os vigentes de VÁRIAS unidades, por `unidade_id` — sem uma consulta por linha. */
export async function responsaveisVigentesDe(
	db: Database,
	unidadeIds: number[]
): Promise<Map<number, ResponsavelDaUnidade>> {
	const mapa = new Map<number, ResponsavelDaUnidade>();
	if (unidadeIds.length === 0) return mapa;
	for (let i = 0; i < unidadeIds.length; i += FATIA_D1) {
		const linhas = await db
			.select(PROJECAO)
			.from(unidadeResponsaveis)
			.innerJoin(policiais, eq(policiais.id, unidadeResponsaveis.policial_id))
			.leftJoin(designacoes, eq(designacoes.id, policiais.designacao_id))
			.where(
				and(
					inArray(unidadeResponsaveis.unidade_id, unidadeIds.slice(i, i + FATIA_D1)),
					isNull(unidadeResponsaveis.data_fim)
				)
			);
		for (const l of linhas) mapa.set(l.unidade_id, l as ResponsavelDaUnidade);
	}
	return mapa;
}

/** A sucessão da unidade, mais recente primeiro — quem dirigiu e quando. */
export async function historicoDaDirecao(
	db: Database,
	unidadeId: number,
	limite = 20
): Promise<ResponsavelDaUnidade[]> {
	const linhas = await db
		.select(PROJECAO)
		.from(unidadeResponsaveis)
		.innerJoin(policiais, eq(policiais.id, unidadeResponsaveis.policial_id))
		.leftJoin(designacoes, eq(designacoes.id, policiais.designacao_id))
		.where(eq(unidadeResponsaveis.unidade_id, unidadeId))
		.orderBy(desc(unidadeResponsaveis.data_inicio), desc(unidadeResponsaveis.id))
		.limit(limite);
	return linhas as ResponsavelDaUnidade[];
}

/** Os dados de um registro novo de direção. */
export interface NovoResponsavel {
	unidade_id: number;
	policial_id: number;
	papel: 'titular' | 'respondente';
	data_inicio: string;
	nup?: string;
	portaria?: string;
	observacao?: string;
	registrado_por_id: number;
	registrado_por_nome: string;
}

/** O que impediu o registro, ou `null` quando pode. */
export type RecusaDaDirecao =
	| 'unidade_inexistente'
	| 'policial_inexistente'
	| 'policial_inativo'
	| 'nao_e_delegado'
	| 'ja_e_o_vigente'
	| 'inicio_antes_do_vigente';

/**
 * Registra quem passa a dirigir a unidade, encerrando quem estava.
 *
 * As duas escritas vão num `db.batch` — que no D1 é transação — porque o índice
 * parcial só admite UMA vigente por unidade: encerrar e inserir em chamadas
 * separadas deixaria a unidade sem direção no intervalo, ou faria o INSERT
 * falhar com a anterior ainda aberta.
 *
 * O vigente é encerrado na VÉSPERA do início do novo, não no mesmo dia: duas
 * linhas com o mesmo dia contariam o mesmo dia duas vezes numa consulta "quem
 * dirigia em tal data".
 *
 * Recusa `inicio_antes_do_vigente` porque a sucessão é uma linha do tempo, não
 * um conjunto: aceitar um início anterior ao do vigente produziria um período
 * negativo no encerramento dele.
 */
export async function registrarResponsavel(
	db: Database,
	dados: NovoResponsavel
): Promise<{ ok: true; substituiu: number | null } | { ok: false; motivo: RecusaDaDirecao }> {
	const unidade = await db
		.select({ id: unidades.id })
		.from(unidades)
		.where(eq(unidades.id, dados.unidade_id))
		.get();
	if (!unidade) return { ok: false, motivo: 'unidade_inexistente' };

	const alvo = await db
		.select({ id: policiais.id, cargo: policiais.cargo, ativo: policiais.ativo })
		.from(policiais)
		.where(eq(policiais.id, dados.policial_id))
		.get();
	if (!alvo) return { ok: false, motivo: 'policial_inexistente' };
	if (alvo.ativo !== 1) return { ok: false, motivo: 'policial_inativo' };
	// Só delegado dirige unidade (decisão de 14/09/2026).
	if (alvo.cargo !== 'DPC') return { ok: false, motivo: 'nao_e_delegado' };

	const vigente = await db
		.select({
			id: unidadeResponsaveis.id,
			policial_id: unidadeResponsaveis.policial_id,
			papel: unidadeResponsaveis.papel,
			data_inicio: unidadeResponsaveis.data_inicio
		})
		.from(unidadeResponsaveis)
		.where(
			and(
				eq(unidadeResponsaveis.unidade_id, dados.unidade_id),
				isNull(unidadeResponsaveis.data_fim)
			)
		)
		.get();

	if (vigente) {
		if (vigente.policial_id === dados.policial_id && vigente.papel === dados.papel) {
			return { ok: false, motivo: 'ja_e_o_vigente' };
		}
		if (dados.data_inicio < vigente.data_inicio) {
			return { ok: false, motivo: 'inicio_antes_do_vigente' };
		}
	}

	const inserir = db.insert(unidadeResponsaveis).values({
		unidade_id: dados.unidade_id,
		policial_id: dados.policial_id,
		papel: dados.papel,
		data_inicio: dados.data_inicio,
		nup: dados.nup ?? '',
		portaria: dados.portaria ?? '',
		observacao: dados.observacao ?? '',
		origem: 'sistema',
		registrado_por_id: dados.registrado_por_id,
		registrado_por_nome: dados.registrado_por_nome
	});

	if (!vigente) {
		await inserir;
		return { ok: true, substituiu: null };
	}

	await db.batch([
		db
			.update(unidadeResponsaveis)
			.set({ data_fim: sql`date(${dados.data_inicio}, '-1 day')` })
			.where(eq(unidadeResponsaveis.id, vigente.id)),
		inserir
	]);
	return { ok: true, substituiu: vigente.policial_id };
}

/**
 * Encerra a direção vigente sem pôr ninguém no lugar — a unidade passa a
 * constar como SEM titular, que é um estado legítimo (é o que a tela de
 * respondência procura) e não falta de dado.
 */
export async function encerrarResponsavel(
	db: Database,
	unidadeId: number,
	dataFim: string
): Promise<boolean> {
	const vigente = await db
		.select({ id: unidadeResponsaveis.id, data_inicio: unidadeResponsaveis.data_inicio })
		.from(unidadeResponsaveis)
		.where(and(eq(unidadeResponsaveis.unidade_id, unidadeId), isNull(unidadeResponsaveis.data_fim)))
		.get();
	if (!vigente || dataFim < vigente.data_inicio) return false;
	await db
		.update(unidadeResponsaveis)
		.set({ data_fim: dataFim })
		.where(eq(unidadeResponsaveis.id, vigente.id));
	return true;
}
