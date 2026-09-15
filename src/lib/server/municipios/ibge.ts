/**
 * População pelo IBGE — a API pública de agregados (SIDRA), sem chave:
 *
 * - Censo 2022, população residente: tabela **4714**, variável 93;
 * - estimativa anual: tabela **6579**, variável 9324, período `-1` = o último
 *   ano publicado (em set/2026 devolve 2026).
 *
 * Uma chamada por tabela traz todos os municípios da UF (`N6[N3[23]]` = os
 * 184 do Ceará); só os que estão em `municipios_cobertura` são gravados. A
 * estimativa é a base da proporção habitantes/policial (pedido do responsável
 * em 16/09/2026): o Censo envelhece, a estimativa é anual.
 *
 * O parse é separado do fetch para ter teste sem rede (`__tests__/ibge.test.ts`
 * com a resposta real recortada). A API responde JSON com a forma
 * `[{ resultados: [{ series: [{ localidade: { id }, serie: { ano: valor } }] }] }]`;
 * valor não numérico ("-", "..." — sigilo ou ausência) é ignorado.
 */
import { eq, sql } from 'drizzle-orm';
import { municipiosCobertura } from '../schema';
import type { Database } from '$lib/db/core';

const BASE = 'https://servicodados.ibge.gov.br/api/v3/agregados';

/** As duas URLs, por UF (código IBGE de dois dígitos; Ceará = 23). */
export function urlsPopulacaoIbge(uf = '23') {
	const loc = `localidades=N6[N3[${uf}]]`;
	return {
		censo: `${BASE}/4714/periodos/2022/variaveis/93?${loc}`,
		estimativa: `${BASE}/6579/periodos/-1/variaveis/9324?${loc}`
	};
}

export interface PopulacaoLida {
	valor: number;
	ano: number;
}

interface RespostaAgregado {
	resultados?: Array<{
		series?: Array<{ localidade?: { id?: string }; serie?: Record<string, string> }>;
	}>;
}

/** IBGE → { valor, ano } do ÚLTIMO ano presente na série de cada município. */
export function lerPopulacaoAgregado(resposta: unknown): Map<string, PopulacaoLida> {
	const mapa = new Map<string, PopulacaoLida>();
	if (!Array.isArray(resposta)) return mapa;
	for (const variavel of resposta as RespostaAgregado[]) {
		for (const r of variavel.resultados ?? []) {
			for (const s of r.series ?? []) {
				const ibge = s.localidade?.id;
				if (!ibge || !s.serie) continue;
				const anos = Object.keys(s.serie)
					.map(Number)
					.filter(Number.isFinite)
					.sort((a, b) => b - a);
				for (const ano of anos) {
					const valor = Number(s.serie[String(ano)]);
					if (Number.isFinite(valor) && valor > 0) {
						mapa.set(ibge, { valor, ano });
						break;
					}
				}
			}
		}
	}
	return mapa;
}

/** Só o que precisamos do `fetch` — injetável para o teste e para o Worker. */
type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

async function baixar(fetchFn: Fetch, url: string): Promise<Map<string, PopulacaoLida>> {
	const r = await fetchFn(url);
	if (!r.ok) throw new Error(`IBGE respondeu ${r.status} em ${url}`);
	return lerPopulacaoAgregado(await r.json());
}

export interface ResultadoAtualizacaoPopulacao {
	/** Municípios da cobertura que receberam número novo. */
	atualizados: number;
	/** Da cobertura, quantos o IBGE não devolveu (ficam como estavam). */
	semDado: number;
	/** O ano da estimativa gravada (o último publicado). */
	anoEstimativa: number | null;
}

/**
 * Baixa Censo e estimativa e grava nos municípios da cobertura. Cada município
 * é um UPDATE; são dezenas, dentro do orçamento diário de escrita do D1.
 *
 * @param agoraISO carimbo de `populacao_atualizada_em` (hora da corporação).
 */
export async function atualizarPopulacaoIbge(
	db: Database,
	fetchFn: Fetch,
	agoraISO: string,
	uf = '23'
): Promise<ResultadoAtualizacaoPopulacao> {
	const urls = urlsPopulacaoIbge(uf);
	const [censo, estimativa] = await Promise.all([
		baixar(fetchFn, urls.censo),
		baixar(fetchFn, urls.estimativa)
	]);
	const cobertos = await db.select({ ibge: municipiosCobertura.ibge }).from(municipiosCobertura);

	let atualizados = 0;
	let semDado = 0;
	let anoEstimativa: number | null = null;
	for (const { ibge } of cobertos) {
		const c = censo.get(ibge);
		const e = estimativa.get(ibge);
		if (!c && !e) {
			semDado++;
			continue;
		}
		if (e) anoEstimativa = e.ano;
		await db
			.update(municipiosCobertura)
			.set({
				...(c ? { populacao_2022: c.valor } : {}),
				...(e ? { populacao_estimada: e.valor, populacao_ano: e.ano } : {}),
				populacao_atualizada_em: agoraISO,
				updated_at: sql`(datetime('now', '-3 hours'))`
			})
			.where(eq(municipiosCobertura.ibge, ibge));
		atualizados++;
	}
	return { atualizados, semDado, anoEstimativa };
}
