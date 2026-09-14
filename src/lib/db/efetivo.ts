/**
 * Efetivo por unidade — as contagens que a Gestão de unidade (`/unidade`)
 * mostra: quantos servidores ATIVOS cada lotação tem, por cargo, e quantos
 * deles estão AFASTADOS hoje (decisão E39, itens 3.1–3.3).
 *
 * A ligação servidor → unidade é pelo NOME (`policiais.lotacao` =
 * `unidades.nome`), herança da planilha que originou o sistema — ver o
 * cabeçalho de `$lib/db/unidades`. Por isso o mapa devolvido é indexado por
 * nome de lotação, e quem consome casa com `unidade.nome`.
 *
 * "Afastado" segue a MESMA regra de `afastamentoVigente` (histórico):
 * evento `afastamento` com `data_inicio <= hoje` e `data_fim` vazia ou
 * `>= hoje`. Está em SQL aqui, e não em memória, porque a pergunta é para
 * todas as unidades de uma vez e o histórico inteiro não cabe numa ida ao D1
 * por unidade. Se a regra mudar lá, tem de mudar aqui — o teste em
 * `__tests__/efetivo.test.ts` fixa os dois lados.
 *
 * Duas consultas, não uma: cargo e afastamento são eixos independentes e um
 * `GROUP BY` só com os dois multiplicaria linhas sem ganho.
 */
import { and, eq, sql } from 'drizzle-orm';
import { policiais, policialHistorico } from '../server/schema';
import type { Database } from './core';

/** As contagens de UMA lotação. `total` = ativos (afastado continua ativo). */
export interface EfetivoLotacao {
	dpc: number;
	oip: number;
	total: number;
	afastados: number;
}

/** Um efetivo zerado — para unidade sem servidor cadastrado. */
export function efetivoVazio(): EfetivoLotacao {
	return { dpc: 0, oip: 0, total: 0, afastados: 0 };
}

/**
 * Efetivo de TODAS as lotações que têm servidor ativo, indexado por nome de
 * lotação. Unidade sem servidor não aparece no mapa — quem consome usa
 * `efetivoVazio()` como padrão.
 *
 * @param hojeISO `YYYY-MM-DD` no fuso da corporação (`hojeBrasilISO()`).
 */
export async function efetivoPorLotacao(
	db: Database,
	hojeISO: string
): Promise<Map<string, EfetivoLotacao>> {
	const porCargo = await db
		.select({
			lotacao: policiais.lotacao,
			cargo: policiais.cargo,
			n: sql<number>`count(*)`
		})
		.from(policiais)
		.where(eq(policiais.ativo, 1))
		.groupBy(policiais.lotacao, policiais.cargo);

	const afastados = await db
		.select({
			lotacao: policiais.lotacao,
			n: sql<number>`count(distinct ${policialHistorico.policial_id})`
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
		.groupBy(policiais.lotacao);

	const mapa = new Map<string, EfetivoLotacao>();
	const de = (lotacao: string) => {
		let e = mapa.get(lotacao);
		if (!e) {
			e = efetivoVazio();
			mapa.set(lotacao, e);
		}
		return e;
	};
	for (const l of porCargo) {
		const e = de(l.lotacao);
		if (l.cargo === 'DPC') e.dpc += Number(l.n);
		else e.oip += Number(l.n);
		e.total += Number(l.n);
	}
	for (const l of afastados) de(l.lotacao).afastados = Number(l.n);
	return mapa;
}

/** Soma de vários efetivos — o total de uma seccional com as delegacias dela. */
export function somarEfetivos(lista: EfetivoLotacao[]): EfetivoLotacao {
	const s = efetivoVazio();
	for (const e of lista) {
		s.dpc += e.dpc;
		s.oip += e.oip;
		s.total += e.total;
		s.afastados += e.afastados;
	}
	return s;
}
