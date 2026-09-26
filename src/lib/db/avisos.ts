/**
 * Avisos — as NOTÍCIAS do sistema (E59): o que mudou e quem precisa saber.
 *
 * A delegacia precisa saber o que o DPI SUL fez com os servidores dela; o DPI
 * SUL precisa saber o que a ponta fez por conta própria. Uma notícia se LÊ e
 * se marca como lida — é diferente da PENDÊNCIA (o que a pessoa precisa
 * resolver), que continua calculada ao vivo das tabelas de origem, em
 * `lib/server/avisos/pendencias.ts`, e nunca se grava aqui.
 *
 * O destinatário é um só por linha: o Admin Geral, ou uma LOTAÇÃO. Desde a
 * E51 a lotação é gravada em par — o NOME, para exibir, e o ID da unidade, que é
 * por onde a caixa filtra. Pelo nome, renomear a unidade fazia todo aviso que
 * ela recebeu antes sumir da própria caixa: nada dava erro, a caixa só
 * aparecia vazia.
 * A lotação é lida por quem a administra — o admin da unidade e o da
 * seccional acima —, e "lido" é da linha, não da pessoa: a caixa da unidade
 * é uma só. Quem emite (`lib/server/avisos/emitir.ts`) decide o outro lado;
 * aqui só se grava, lê, conta e marca.
 */
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { avisos, unidades, type Aviso } from '../server/schema';
import { batchNonEmpty, type Database } from './core';

/**
 * Quem pode ler: o Admin Geral lê a caixa `admin_geral`; os demais, as
 * lotações do escopo.
 *
 * Desde a E65 a caixa `admin_geral` também tem recorte: o aviso guarda a
 * lotação A QUE SE REFERE, e o administrador vê só o que está dentro do nó
 * dele. Aviso antigo, gravado sem lotação, continua visível para todos —
 * esconder o passado seria pior do que mostrá-lo a mais gente.
 */
export interface CaixaDeAvisos {
	adminGeral: boolean;
	/**
	 * Os IDS das unidades administradas (E51); vazio para quem não administra
	 * nenhuma. Vem de `unidadesAdministradas`, gêmea exata da régua de nomes —
	 * trocar uma pela outra aqui não muda quem lê o quê.
	 */
	unidades: number[];
}

/** Uma notícia a gravar. */
export interface NovoAviso {
	destinatario:
		| { tipo: 'admin_geral'; /** A lotação a que o aviso se refere (E65). */ lotacao?: string }
		| { tipo: 'lotacao'; lotacao: string };
	/** O cartão da home que acende: `servidores`, `unidade`… */
	cartao: string;
	tipo: string;
	titulo: string;
	texto?: string;
	/** O lugar exato da alteração. */
	link?: string;
	autor: { id: number; nome: string } | null;
}

/**
 * O id de cada nome de unidade, numa consulta só. Nome que não casa fica fora
 * do mapa, e o aviso nasce com o id nulo — que é resposta, não falha: há
 * destinos que nunca foram unidade.
 *
 * Em fatias de 90 por causa do limite de 100 parâmetros por consulta do D1; na
 * prática um lote de avisos tem poucos destinos, mas o limite não avisa antes.
 */
async function idsPorNome(db: Database, nomes: readonly string[]): Promise<Map<string, number>> {
	const unicos = [...new Set(nomes.filter((n) => n.trim() !== ''))];
	const mapa = new Map<string, number>();
	for (let i = 0; i < unicos.length; i += 90) {
		const linhas = await db
			.select({ id: unidades.id, nome: unidades.nome })
			.from(unidades)
			.where(inArray(unidades.nome, unicos.slice(i, i + 90)));
		for (const l of linhas) mapa.set(l.nome, l.id);
	}
	return mapa;
}

/** Grava várias notícias num lote só (uma por destinatário). */
export async function criarAvisos(db: Database, novos: readonly NovoAviso[]): Promise<void> {
	// O par nome + id, como toda escrita desde a E51. A migração `0103` tem um
	// gatilho que faz o mesmo no banco — é a rede para quem esquecer; aqui é o
	// caminho explícito, que não depende dela.
	const idDe = await idsPorNome(
		db,
		novos.map((n) => n.destinatario.lotacao ?? '')
	);
	await batchNonEmpty(
		db,
		novos.map((n) =>
			db.insert(avisos).values({
				destinatario_tipo: n.destinatario.tipo,
				// Na caixa do Admin Geral a lotação não é o destinatário e sim o
				// ASSUNTO: é por ela que o recorte por nó filtra (E65).
				destinatario_lotacao: n.destinatario.lotacao ?? null,
				destinatario_unidade_id: idDe.get(n.destinatario.lotacao ?? '') ?? null,
				cartao: n.cartao,
				tipo: n.tipo,
				titulo: n.titulo,
				texto: n.texto ?? '',
				link: n.link ?? '',
				autor_id: n.autor?.id ?? null,
				autor_nome: n.autor?.nome ?? ''
			})
		)
	);
}

/** A cláusula "é da minha caixa" — `null` quando a caixa não alcança nada. */
function daCaixa(caixa: CaixaDeAvisos) {
	const partes = [];
	if (caixa.adminGeral) {
		partes.push(
			caixa.unidades.length > 0
				? and(
						eq(avisos.destinatario_tipo, 'admin_geral'),
						or(
							// O "sem assunto" continua decidido pelo TEXTO, de propósito.
							// Pelo id, um aviso cujo texto nunca foi unidade (id nulo)
							// passaria a aparecer para TODO Admin Geral, como se fosse
							// aviso sem assunto — alargar a caixa de carona.
							isNull(avisos.destinatario_lotacao),
							inArray(avisos.destinatario_unidade_id, caixa.unidades.slice(0, 90))
						)
					)
				: eq(avisos.destinatario_tipo, 'admin_geral')
		);
	}
	// A caixa da ponta: as lotações são o DESTINATÁRIO. No Admin Geral as
	// mesmas lotações já entraram acima como assunto, e não se repetem aqui.
	if (!caixa.adminGeral && caixa.unidades.length > 0) {
		partes.push(
			and(
				eq(avisos.destinatario_tipo, 'lotacao'),
				inArray(avisos.destinatario_unidade_id, caixa.unidades.slice(0, 90))
			)
		);
	}
	if (partes.length === 0) return null;
	return partes.length === 1 ? partes[0] : or(...partes);
}

/** As notícias da caixa, mais recentes primeiro — não lidas e lidas. */
export async function listarAvisos(
	db: Database,
	caixa: CaixaDeAvisos,
	limite = 100
): Promise<Aviso[]> {
	const filtro = daCaixa(caixa);
	if (!filtro) return [];
	return db.select().from(avisos).where(filtro).orderBy(desc(avisos.id)).limit(limite);
}

/** Quantas não lidas há na caixa, por cartão da home. */
export async function contarNaoLidos(
	db: Database,
	caixa: CaixaDeAvisos
): Promise<Map<string, number>> {
	const mapa = new Map<string, number>();
	const filtro = daCaixa(caixa);
	if (!filtro) return mapa;
	const linhas = await db
		.select({ cartao: avisos.cartao, n: sql<number>`count(*)` })
		.from(avisos)
		.where(and(filtro, isNull(avisos.lido_em)))
		.groupBy(avisos.cartao);
	for (const l of linhas) mapa.set(l.cartao, Number(l.n));
	return mapa;
}

/**
 * Marca como lidas — todas as não lidas da caixa, ou só os ids dados (que
 * precisam ser da caixa: id de fora não muda nada). Devolve quantas mudaram.
 */
export async function marcarLidos(
	db: Database,
	caixa: CaixaDeAvisos,
	quem: { id: number; nome: string },
	hojeISO: string,
	ids?: number[]
): Promise<number> {
	const filtro = daCaixa(caixa);
	if (!filtro) return 0;
	const condicoes = [filtro, isNull(avisos.lido_em)];
	if (ids) {
		if (ids.length === 0) return 0;
		condicoes.push(inArray(avisos.id, ids.slice(0, 90)));
	}
	const r = await db
		.update(avisos)
		.set({ lido_em: hojeISO, lido_por_id: quem.id, lido_por_nome: quem.nome })
		.where(and(...condicoes));
	return Number((r as { meta?: { changes?: number } }).meta?.changes ?? 0);
}
