/**
 * Efetivo por unidade — as contagens que a Gestão de unidade (`/unidade`)
 * mostra: por CARGO (DPC, OIP), quantos servidores estão ATIVOS hoje, quantos
 * de FÉRIAS e quantos AFASTADOS por outro motivo (decisão E39, itens
 * 3.1–3.3; pedido do responsável em 15/09/2026).
 *
 * A ligação servidor → unidade é pelo NOME (`policiais.lotacao` =
 * `unidades.nome`), herança da planilha que originou o sistema — ver o
 * cabeçalho de `$lib/db/unidades`. Por isso o mapa devolvido é indexado por
 * nome de lotação, e quem consome casa com `unidade.nome`.
 *
 * "Fora de serviço hoje" segue a MESMA regra de `afastamentoVigente`
 * (histórico): evento `afastamento` com `data_inicio <= hoje` e `data_fim`
 * vazia ou `>= hoje`. Férias é o subtipo `ferias` desse evento; qualquer outro
 * subtipo (licença médica, judicial, outros) conta como afastado. Está em SQL
 * aqui, e não em memória, porque a pergunta é para todas as unidades de uma
 * vez e o histórico inteiro não cabe numa ida ao D1 por unidade. Se a regra
 * mudar lá, tem de mudar aqui — o teste em `__tests__/efetivo.test.ts` fixa os
 * dois lados.
 *
 * Um servidor com férias E licença no mesmo dia conta uma vez, como afastado
 * (o motivo que o tira do serviço por mais tempo prevalece). `ativos` é o que
 * sobra: lotados menos férias menos afastados.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { designacoes, policiais, policialHistorico } from '../server/schema';
import type { Database } from './core';
import type { SituacaoServidor } from '$lib/servidores/afastamentos';

/** As contagens de UM cargo numa lotação. `total` = lotados (ativos + férias + afastados). */
interface EfetivoCargo {
	ativos: number;
	ferias: number;
	afastados: number;
	total: number;
}

/** As contagens de UMA lotação, por cargo, mais o total geral. */
export interface EfetivoLotacao {
	dpc: EfetivoCargo;
	oip: EfetivoCargo;
	/** Lotados no total (DPC + OIP). */
	total: number;
}

const cargoVazio = (): EfetivoCargo => ({ ativos: 0, ferias: 0, afastados: 0, total: 0 });

/** Um efetivo zerado — para unidade sem servidor cadastrado. */
export function efetivoVazio(): EfetivoLotacao {
	return { dpc: cargoVazio(), oip: cargoVazio(), total: 0 };
}

/**
 * Efetivo de TODAS as lotações que têm servidor ativo (`policiais.ativo = 1`),
 * indexado por nome de lotação. Unidade sem servidor não aparece no mapa —
 * quem consome usa `efetivoVazio()` como padrão.
 *
 * @param hojeISO `YYYY-MM-DD` no fuso da corporação (`hojeBrasilISO()`).
 */
export async function efetivoPorLotacao(
	db: Database,
	hojeISO: string
): Promise<Map<string, EfetivoLotacao>> {
	const lotados = await db
		.select({
			lotacao: policiais.lotacao,
			cargo: policiais.cargo,
			n: sql<number>`count(*)`
		})
		.from(policiais)
		.where(eq(policiais.ativo, 1))
		.groupBy(policiais.lotacao, policiais.cargo);

	// Um servidor pode ter mais de um afastamento vigente; o `max` faz licença
	// prevalecer sobre férias, e o `GROUP BY policial_id` conta cada um uma vez.
	const foraDeServico = await db
		.select({
			lotacao: policiais.lotacao,
			cargo: policiais.cargo,
			ferias: sql<number>`max(case when ${policialHistorico.subtipo} = 'ferias' then 1 else 0 end)`,
			outro: sql<number>`max(case when ${policialHistorico.subtipo} = 'ferias' then 0 else 1 end)`
		})
		.from(policialHistorico)
		.innerJoin(policiais, eq(policiais.id, policialHistorico.policial_id))
		.where(
			and(
				eq(policiais.ativo, 1),
				eq(policialHistorico.tipo, 'afastamento'),
				sql`${policialHistorico.data_inicio} <= ${hojeISO}`,
				sql`(${policialHistorico.data_fim} IS NULL OR ${policialHistorico.data_fim} = '' OR ${policialHistorico.data_fim} >= ${hojeISO})`
			)
		)
		.groupBy(policialHistorico.policial_id, policiais.lotacao, policiais.cargo);

	const mapa = new Map<string, EfetivoLotacao>();
	const de = (lotacao: string) => {
		let e = mapa.get(lotacao);
		if (!e) {
			e = efetivoVazio();
			mapa.set(lotacao, e);
		}
		return e;
	};
	const cargoDe = (e: EfetivoLotacao, cargo: string) => (cargo === 'DPC' ? e.dpc : e.oip);

	for (const l of lotados) {
		const e = de(l.lotacao);
		const c = cargoDe(e, l.cargo);
		c.total += Number(l.n);
		c.ativos += Number(l.n);
		e.total += Number(l.n);
	}
	for (const l of foraDeServico) {
		const c = cargoDe(de(l.lotacao), l.cargo);
		if (Number(l.outro) === 1) c.afastados += 1;
		else c.ferias += 1;
		c.ativos -= 1;
	}
	return mapa;
}

/** Soma de vários efetivos — o total de uma seccional com as delegacias dela. */
export function somarEfetivos(lista: EfetivoLotacao[]): EfetivoLotacao {
	const s = efetivoVazio();
	for (const e of lista) {
		for (const cargo of ['dpc', 'oip'] as const) {
			s[cargo].ativos += e[cargo].ativos;
			s[cargo].ferias += e[cargo].ferias;
			s[cargo].afastados += e[cargo].afastados;
			s[cargo].total += e[cargo].total;
		}
		s.total += e.total;
	}
	return s;
}

/** Teto de parâmetros por consulta no D1 (100), com folga para os demais. */
const FATIA_D1 = 90;

/** O afastamento em curso de um servidor — o que faz dele "férias" ou "afastado" hoje. */
export interface AfastamentoEmCurso {
	id: number;
	subtipo: string;
	data_inicio: string;
	data_fim: string | null;
}

/**
 * O afastamento vigente de cada servidor da lista, por id. Quando há mais de
 * um no mesmo dia, o que NÃO é férias prevalece — a mesma regra de
 * `efetivoPorLotacao` (licença por cima de férias).
 */
export async function afastamentosVigentesDe(
	db: Database,
	policialIds: number[],
	hojeISO: string
): Promise<Map<number, AfastamentoEmCurso>> {
	const mapa = new Map<number, AfastamentoEmCurso>();
	if (policialIds.length === 0) return mapa;
	// O D1 aceita no máximo 100 parâmetros por consulta: o departamento inteiro
	// (700 ids) vai em fatias.
	const linhas = [];
	for (let i = 0; i < policialIds.length; i += FATIA_D1) {
		linhas.push(
			...(await db
				.select({
					id: policialHistorico.id,
					policialId: policialHistorico.policial_id,
					subtipo: policialHistorico.subtipo,
					data_inicio: policialHistorico.data_inicio,
					data_fim: policialHistorico.data_fim
				})
				.from(policialHistorico)
				.where(
					and(
						inArray(policialHistorico.policial_id, policialIds.slice(i, i + FATIA_D1)),
						eq(policialHistorico.tipo, 'afastamento'),
						sql`${policialHistorico.data_inicio} <= ${hojeISO}`,
						sql`(${policialHistorico.data_fim} IS NULL OR ${policialHistorico.data_fim} = '' OR ${policialHistorico.data_fim} >= ${hojeISO})`
					)
				))
		);
	}
	for (const l of linhas) {
		const atual = mapa.get(l.policialId);
		const ehFerias = l.subtipo === 'ferias';
		if (!atual || (atual.subtipo === 'ferias' && !ehFerias)) {
			mapa.set(l.policialId, {
				id: l.id,
				subtipo: l.subtipo ?? 'outros',
				data_inicio: l.data_inicio ?? '',
				data_fim: l.data_fim || null
			});
		}
	}
	return mapa;
}

/** Situação de hoje a partir do afastamento em curso (ou da falta dele). */
export function situacaoDe(afastamento: AfastamentoEmCurso | null | undefined): SituacaoServidor {
	if (!afastamento) return 'ativo';
	return afastamento.subtipo === 'ferias' ? 'ferias' : 'afastado';
}

/** Um servidor com a situação de hoje — o que o painel dos números mostra. */
export interface ServidorSituado {
	id: number;
	nome: string;
	matricula: string;
	cargo: string;
	lotacao: string;
	designacao: string;
	situacao: SituacaoServidor;
	afastamento: AfastamentoEmCurso | null;
}

/**
 * Os servidores ativos das lotações dadas, com a situação de hoje, filtrados
 * por situação e/ou cargo — é o que abre ao clicar num número da Gestão de
 * unidade. Ordem: lotação, cargo (DPC antes), nome.
 */
export async function servidoresPorSituacao(
	db: Database,
	lotacoes: string[],
	hojeISO: string,
	filtro: { situacao?: 'ativos' | 'ferias' | 'afastados'; cargo?: 'DPC' | 'OIP' } = {}
): Promise<ServidorSituado[]> {
	if (lotacoes.length === 0) return [];
	const linhas = [];
	for (let i = 0; i < lotacoes.length; i += FATIA_D1) {
		linhas.push(
			...(await db
				.select({
					id: policiais.id,
					nome: policiais.nome,
					matricula: policiais.matricula,
					cargo: policiais.cargo,
					lotacao: policiais.lotacao,
					designacao: designacoes.nome
				})
				.from(policiais)
				.leftJoin(designacoes, eq(designacoes.id, policiais.designacao_id))
				.where(
					and(
						eq(policiais.ativo, 1),
						inArray(policiais.lotacao, lotacoes.slice(i, i + FATIA_D1)),
						...(filtro.cargo ? [eq(policiais.cargo, filtro.cargo)] : [])
					)
				))
		);
	}
	linhas.sort(
		(a, b) =>
			a.lotacao.localeCompare(b.lotacao, 'pt-BR') ||
			a.cargo.localeCompare(b.cargo) ||
			a.nome.localeCompare(b.nome, 'pt-BR')
	);
	const vigentes = await afastamentosVigentesDe(
		db,
		linhas.map((l) => l.id),
		hojeISO
	);
	const todos: ServidorSituado[] = linhas.map((l) => {
		const afastamento = vigentes.get(l.id) ?? null;
		return {
			...l,
			designacao: l.designacao ?? '',
			situacao: situacaoDe(afastamento),
			afastamento
		};
	});
	if (!filtro.situacao) return todos;
	const alvo: SituacaoServidor =
		filtro.situacao === 'ativos' ? 'ativo' : filtro.situacao === 'ferias' ? 'ferias' : 'afastado';
	return todos.filter((s) => s.situacao === alvo);
}
