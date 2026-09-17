/**
 * Férias do policial — a camada de dados do que vem ANTES do gozo: as frações
 * programadas, os pedidos de reprogramação à COGEP e o abono.
 *
 * O gozo em si continua sendo o evento de afastamento em `policial_historico`
 * (subtipo `ferias`), e é ESTA camada que o mantém: cada fração programada
 * cria o seu evento, a suspensão o encurta, a sustação o apaga, o abono o
 * reduz aos dias de fato gozados. Tudo o que hoje lê a situação de hoje —
 * `afastamentoVigente`, `efetivoPorLotacao`, os painéis — continua funcionando
 * sem saber que existe programação. Uma fonte só para "está de férias hoje?".
 *
 * As REGRAS (sustação × suspensão, critérios, ofício, abono) não moram aqui:
 * estão em `$lib/servidores/ferias`, puras e testadas sem banco. Aqui só o que
 * precisa de banco: gravar, ler, ligar as três tabelas e manter o evento.
 *
 * Duas escritas que precisam andar juntas vão num `db.batch` — o D1 executa
 * o lote como transação — porque ficar com a fração gravada e o evento não
 * (ou o inverso) é exatamente o estado que faz a situação de hoje mentir.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
	feriasAbonos,
	feriasFracoes,
	feriasReprogramacoes,
	policiais,
	policialHistorico,
	type FeriasAbono,
	type FeriasFracao,
	type FeriasReprogramacao
} from '../../server/schema';
import { batchNonEmpty, type Database } from '../core';
import type { BatchItem } from 'drizzle-orm/batch';
import {
	diasDaFracao,
	periodoGozadoComAbono,
	type PosicaoDoAbono,
	type TipoReprogramacao
} from '$lib/servidores/ferias';
import { adicionarDias } from '$lib/utils/datas';

/** Quem registra — snapshot de id e nome, como no resto do histórico. */
export interface Registrador {
	id: number;
	nome: string;
}

/** Uma fração com o que orbita nela: a reprogramação pendente e o abono. */
export interface FracaoCompleta extends FeriasFracao {
	reprogramacoes: FeriasReprogramacao[];
	abono: FeriasAbono | null;
}

/** As férias de um servidor, por exercício, mais recente primeiro. */
export async function listarFeriasDoPolicial(
	db: Database,
	policialId: number
): Promise<FracaoCompleta[]> {
	const fracoes = await db
		.select()
		.from(feriasFracoes)
		.where(eq(feriasFracoes.policial_id, policialId))
		.orderBy(desc(feriasFracoes.exercicio), feriasFracoes.ordem, feriasFracoes.id);
	if (fracoes.length === 0) return [];
	const ids = fracoes.map((f) => f.id);
	const [reprogs, abonos] = await Promise.all([
		db
			.select()
			.from(feriasReprogramacoes)
			.where(inArray(feriasReprogramacoes.fracao_id, ids))
			.orderBy(desc(feriasReprogramacoes.id)),
		db.select().from(feriasAbonos).where(inArray(feriasAbonos.fracao_id, ids))
	]);
	return fracoes.map((f) => ({
		...f,
		reprogramacoes: reprogs.filter((r) => r.fracao_id === f.id),
		abono: abonos.find((a) => a.fracao_id === f.id) ?? null
	}));
}

/** Uma fração por id — com o dono, para o portão de escopo conferir. */
export async function buscarFracao(db: Database, id: number): Promise<FeriasFracao | undefined> {
	return db.select().from(feriasFracoes).where(eq(feriasFracoes.id, id)).get();
}

/**
 * Os valores do evento de afastamento que uma fração gera. `legado = 0`: é
 * registro do sistema, não de carga — a carga da planilha não o regrava.
 */
function eventoDeFerias(
	policialId: number,
	inicio: string,
	fim: string,
	quem: Registrador,
	descricao: string
) {
	return {
		policial_id: policialId,
		tipo: 'afastamento' as const,
		subtipo: 'ferias',
		descricao,
		data_inicio: inicio,
		data_fim: fim,
		qtd_dias: diasDaFracao({ data_inicio: inicio, data_fim: fim }),
		registrado_por_id: quem.id,
		registrado_por_nome: quem.nome,
		legado: 0
	};
}

/** Os dados de uma fração nova, como a unidade a digita do Guardião. */
export interface NovaFracao {
	policial_id: number;
	exercicio: number;
	ordem: 1 | 2 | 3;
	data_inicio: string;
	data_fim: string;
	observacao?: string;
}

/**
 * Registra uma fração programada no Guardião e o evento de afastamento que
 * ela gera, no mesmo lote. Devolve o id da fração.
 *
 * Recusa a segunda fração de mesma ordem no mesmo exercício que ainda esteja
 * `programada`: a unidade digitando duas vezes é o erro mais provável, e o
 * banco não tem UNIQUE aqui de propósito — a fração sustada/suspensa e a que
 * a substitui têm a MESMA ordem, e as duas ficam.
 */
export async function registrarFracao(
	db: Database,
	dados: NovaFracao,
	quem: Registrador
): Promise<{ ok: true; id: number } | { ok: false; motivo: 'duplicada' }> {
	const existente = await db
		.select({ id: feriasFracoes.id })
		.from(feriasFracoes)
		.where(
			and(
				eq(feriasFracoes.policial_id, dados.policial_id),
				eq(feriasFracoes.exercicio, dados.exercicio),
				eq(feriasFracoes.ordem, dados.ordem),
				eq(feriasFracoes.status, 'programada')
			)
		)
		.get();
	if (existente) return { ok: false, motivo: 'duplicada' };

	const [evento] = await db
		.insert(policialHistorico)
		.values(
			eventoDeFerias(
				dados.policial_id,
				dados.data_inicio,
				dados.data_fim,
				quem,
				`Férias — ${dados.ordem}ª fração do exercício ${dados.exercicio}`
			)
		)
		.returning({ id: policialHistorico.id });
	const [fracao] = await db
		.insert(feriasFracoes)
		.values({
			policial_id: dados.policial_id,
			exercicio: dados.exercicio,
			ordem: dados.ordem,
			data_inicio: dados.data_inicio,
			data_fim: dados.data_fim,
			status: 'programada',
			origem: 'guardiao',
			historico_id: evento.id,
			observacao: dados.observacao ?? '',
			registrado_por_id: quem.id,
			registrado_por_nome: quem.nome
		})
		.returning({ id: feriasFracoes.id });
	return { ok: true, id: fracao.id };
}

/**
 * Apaga uma fração digitada errada — só enquanto `programada` e sem pedido
 * pendente nem abono. Leva o evento junto: o que nunca foi programado não
 * pode constar como férias.
 */
export async function excluirFracao(
	db: Database,
	id: number
): Promise<{ ok: true } | { ok: false; motivo: 'nao_programada' | 'tem_vinculo' }> {
	const f = await buscarFracao(db, id);
	if (!f || f.status !== 'programada') return { ok: false, motivo: 'nao_programada' };
	const vinculo = await db
		.select({ n: sql<number>`count(*)` })
		.from(feriasReprogramacoes)
		.where(eq(feriasReprogramacoes.fracao_id, id))
		.get();
	const abono = await db
		.select({ n: sql<number>`count(*)` })
		.from(feriasAbonos)
		.where(eq(feriasAbonos.fracao_id, id))
		.get();
	if ((vinculo?.n ?? 0) > 0 || (abono?.n ?? 0) > 0) return { ok: false, motivo: 'tem_vinculo' };

	const passos: BatchItem<'sqlite'>[] = [db.delete(feriasFracoes).where(eq(feriasFracoes.id, id))];
	if (f.historico_id) {
		passos.push(db.delete(policialHistorico).where(eq(policialHistorico.id, f.historico_id)));
	}
	await batchNonEmpty(db, passos);
	return { ok: true };
}

/** O pedido de reprogramação, como a unidade o abre. */
export interface NovaReprogramacao {
	fracao_id: number;
	policial_id: number;
	tipo: TipoReprogramacao;
	novo_inicio: string;
	novo_fim: string;
	data_suspensao?: string | null;
	justificativa?: string;
	texto_oficio: string;
	nup?: string;
}

/**
 * Abre o pedido. Fica `pendente` — e pendente é alerta — até a unidade
 * homologar a resposta da COGEP. Recusa segundo pedido pendente para a mesma
 * fração: a COGEP recebe um processo por vez.
 */
export async function abrirReprogramacao(
	db: Database,
	dados: NovaReprogramacao,
	quem: Registrador
): Promise<{ ok: true; id: number } | { ok: false; motivo: 'ja_pendente' | 'fracao_fechada' }> {
	const f = await buscarFracao(db, dados.fracao_id);
	if (!f || f.status !== 'programada') return { ok: false, motivo: 'fracao_fechada' };
	const pendente = await db
		.select({ id: feriasReprogramacoes.id })
		.from(feriasReprogramacoes)
		.where(
			and(
				eq(feriasReprogramacoes.fracao_id, dados.fracao_id),
				eq(feriasReprogramacoes.status, 'pendente')
			)
		)
		.get();
	if (pendente) return { ok: false, motivo: 'ja_pendente' };

	const [linha] = await db
		.insert(feriasReprogramacoes)
		.values({
			fracao_id: dados.fracao_id,
			policial_id: dados.policial_id,
			tipo: dados.tipo,
			novo_inicio: dados.novo_inicio,
			novo_fim: dados.novo_fim,
			data_suspensao: dados.data_suspensao ?? null,
			justificativa: dados.justificativa ?? '',
			texto_oficio: dados.texto_oficio,
			nup: dados.nup ?? '',
			status: 'pendente',
			registrado_por_id: quem.id,
			registrado_por_nome: quem.nome
		})
		.returning({ id: feriasReprogramacoes.id });
	return { ok: true, id: linha.id };
}

/** Anota o NUP depois de protocolado — o pedido nasce antes do número existir. */
export async function anotarNupDaReprogramacao(db: Database, id: number, nup: string) {
	await db.update(feriasReprogramacoes).set({ nup }).where(eq(feriasReprogramacoes.id, id));
}

/**
 * A homologação da resposta da COGEP, pela unidade.
 *
 * DEFERIDA: a fração antiga vira `sustada` ou `suspensa` e passa a apontar
 * para a nova, que nasce `programada` com origem `reprogramacao` e o próprio
 * evento de afastamento. O evento antigo muda conforme o instituto:
 *   - sustação: some — aquelas férias não aconteceram;
 *   - suspensão: encurta até a véspera do retorno — os dias gozados foram
 *     afastamento de verdade e ficam.
 * Tudo num lote só: fração antiga, fração nova, evento novo, evento antigo.
 *
 * INDEFERIDA: só fecha o pedido; a fração original permanece como estava.
 *
 * Devolve `null` quando o pedido já não estava pendente (segundo clique).
 */
export async function decidirReprogramacao(
	db: Database,
	id: number,
	deferida: boolean,
	quem: Registrador,
	hojeISO: string
): Promise<FeriasReprogramacao | null> {
	const pedido = await db
		.select()
		.from(feriasReprogramacoes)
		.where(and(eq(feriasReprogramacoes.id, id), eq(feriasReprogramacoes.status, 'pendente')))
		.get();
	if (!pedido) return null;

	const fechar = db
		.update(feriasReprogramacoes)
		.set({
			status: deferida ? 'deferida' : 'indeferida',
			decidida_em: hojeISO,
			decidida_por_id: quem.id,
			decidida_por_nome: quem.nome
		})
		.where(eq(feriasReprogramacoes.id, id));

	if (!deferida) {
		await fechar;
		return { ...pedido, status: 'indeferida' };
	}

	const antiga = await buscarFracao(db, pedido.fracao_id);
	if (!antiga) return null;

	// A nova fração e o evento dela — inseridos primeiro, porque a antiga
	// precisa do id da nova para apontar a sucessão.
	const [eventoNovo] = await db
		.insert(policialHistorico)
		.values(
			eventoDeFerias(
				antiga.policial_id,
				pedido.novo_inicio,
				pedido.novo_fim,
				quem,
				`Férias — ${antiga.ordem}ª fração do exercício ${antiga.exercicio} (reprogramada por ${pedido.tipo === 'sustacao' ? 'sustação' : 'suspensão'}${pedido.nup ? `, NUP ${pedido.nup}` : ''})`
			)
		)
		.returning({ id: policialHistorico.id });
	const [nova] = await db
		.insert(feriasFracoes)
		.values({
			policial_id: antiga.policial_id,
			exercicio: antiga.exercicio,
			ordem: antiga.ordem as 1 | 2 | 3,
			data_inicio: pedido.novo_inicio,
			data_fim: pedido.novo_fim,
			status: 'programada',
			origem: 'reprogramacao',
			historico_id: eventoNovo.id,
			observacao: pedido.nup ? `NUP ${pedido.nup}` : '',
			registrado_por_id: quem.id,
			registrado_por_nome: quem.nome
		})
		.returning({ id: feriasFracoes.id });

	const passos: BatchItem<'sqlite'>[] = [
		fechar,
		db
			.update(feriasFracoes)
			.set({
				status: pedido.tipo === 'sustacao' ? 'sustada' : 'suspensa',
				substituida_por_id: nova.id
			})
			.where(eq(feriasFracoes.id, antiga.id))
	];
	if (antiga.historico_id) {
		if (pedido.tipo === 'sustacao') {
			passos.push(
				db.delete(policialHistorico).where(eq(policialHistorico.id, antiga.historico_id))
			);
		} else if (pedido.data_suspensao) {
			const fimGozado = adicionarDias(pedido.data_suspensao, -1);
			passos.push(
				db
					.update(policialHistorico)
					.set({
						data_fim: fimGozado,
						qtd_dias: diasDaFracao({ data_inicio: antiga.data_inicio, data_fim: fimGozado }),
						descricao: `Férias — ${antiga.ordem}ª fração do exercício ${antiga.exercicio} (suspensa em ${pedido.data_suspensao})`
					})
					.where(eq(policialHistorico.id, antiga.historico_id))
			);
		}
	}
	await batchNonEmpty(db, passos);
	return { ...pedido, status: 'deferida' };
}

/** O abono, como o Admin Geral o registra depois da decisão do DG. */
export interface NovoAbono {
	fracao_id: number;
	policial_id: number;
	posicao: PosicaoDoAbono;
	nup?: string;
	data_requerimento?: string | null;
	status: 'deferido' | 'indeferido';
	decidido_em?: string | null;
}

/**
 * Registra o abono. DEFERIDO: o evento de férias da fração passa a cobrir só
 * os dias de fato gozados — nos 10 convertidos o servidor trabalha, e é assim
 * que o efetivo o conta como ativo. Fração de 10 dias inteira convertida:
 * o evento some. Recusa segundo abono na mesma fração.
 */
export async function registrarAbono(
	db: Database,
	dados: NovoAbono,
	quem: Registrador
): Promise<{ ok: true; id: number } | { ok: false; motivo: 'ja_tem' | 'fracao_fechada' }> {
	const f = await buscarFracao(db, dados.fracao_id);
	if (!f || f.status !== 'programada') return { ok: false, motivo: 'fracao_fechada' };
	const existente = await db
		.select({ id: feriasAbonos.id })
		.from(feriasAbonos)
		.where(eq(feriasAbonos.fracao_id, dados.fracao_id))
		.get();
	if (existente) return { ok: false, motivo: 'ja_tem' };

	const { abono, gozo } = periodoGozadoComAbono(f, dados.posicao);
	const [linha] = await db
		.insert(feriasAbonos)
		.values({
			fracao_id: dados.fracao_id,
			policial_id: dados.policial_id,
			posicao: dados.posicao,
			abono_inicio: abono.inicio,
			abono_fim: abono.fim,
			nup: dados.nup ?? '',
			data_requerimento: dados.data_requerimento ?? null,
			status: dados.status,
			decidido_em: dados.decidido_em ?? null,
			registrado_por_id: quem.id,
			registrado_por_nome: quem.nome
		})
		.returning({ id: feriasAbonos.id });

	if (dados.status === 'deferido' && f.historico_id) {
		if (gozo) {
			await db
				.update(policialHistorico)
				.set({
					data_inicio: gozo.inicio,
					data_fim: gozo.fim,
					qtd_dias: diasDaFracao({ data_inicio: gozo.inicio, data_fim: gozo.fim }),
					descricao: `Férias — ${f.ordem}ª fração do exercício ${f.exercicio} (10 dias ${dados.posicao} convertidos em abono)`
				})
				.where(eq(policialHistorico.id, f.historico_id));
		} else {
			await db.delete(policialHistorico).where(eq(policialHistorico.id, f.historico_id));
		}
	}
	return { ok: true, id: linha.id };
}

/** A ciência da unidade: a partir daqui o alerta some. */
export async function darCienciaDoAbono(
	db: Database,
	id: number,
	quem: Registrador,
	hojeISO: string
): Promise<boolean> {
	const r = await db
		.update(feriasAbonos)
		.set({
			ciencia_unidade_em: hojeISO,
			ciencia_unidade_por_id: quem.id,
			ciencia_unidade_por_nome: quem.nome
		})
		.where(and(eq(feriasAbonos.id, id), isNull(feriasAbonos.ciencia_unidade_em)));
	return (r as { meta?: { changes?: number } }).meta?.changes !== 0;
}

/** O que está pendente, por servidor — o que vira ALERTA nos cartões. */
export interface PendenciasDeFerias {
	reprogramacoesPendentes: number;
	abonosSemCiencia: number;
}

/**
 * As pendências de vários servidores numa ida só: pedidos aguardando a
 * COGEP e abonos deferidos sem ciência da unidade. Fatiado em 90 ids (limite
 * de parâmetros do D1).
 */
export async function pendenciasDeFerias(
	db: Database,
	policialIds: number[]
): Promise<Map<number, PendenciasDeFerias>> {
	const mapa = new Map<number, PendenciasDeFerias>();
	for (let i = 0; i < policialIds.length; i += 90) {
		const fatia = policialIds.slice(i, i + 90);
		if (fatia.length === 0) continue;
		const [reprogs, abonos] = await Promise.all([
			db
				.select({ policial_id: feriasReprogramacoes.policial_id, n: sql<number>`count(*)` })
				.from(feriasReprogramacoes)
				.where(
					and(
						inArray(feriasReprogramacoes.policial_id, fatia),
						eq(feriasReprogramacoes.status, 'pendente')
					)
				)
				.groupBy(feriasReprogramacoes.policial_id),
			db
				.select({ policial_id: feriasAbonos.policial_id, n: sql<number>`count(*)` })
				.from(feriasAbonos)
				.where(
					and(
						inArray(feriasAbonos.policial_id, fatia),
						eq(feriasAbonos.status, 'deferido'),
						isNull(feriasAbonos.ciencia_unidade_em)
					)
				)
				.groupBy(feriasAbonos.policial_id)
		]);
		for (const r of reprogs) {
			const p = mapa.get(r.policial_id) ?? { reprogramacoesPendentes: 0, abonosSemCiencia: 0 };
			p.reprogramacoesPendentes = r.n;
			mapa.set(r.policial_id, p);
		}
		for (const a of abonos) {
			const p = mapa.get(a.policial_id) ?? { reprogramacoesPendentes: 0, abonosSemCiencia: 0 };
			p.abonosSemCiencia = a.n;
			mapa.set(a.policial_id, p);
		}
	}
	return mapa;
}

/**
 * Os números para o teto de 15 % (art. 6º I) no mês em que a nova fração
 * começa: quantos da lotação já estarão em férias naquele mês e o efetivo
 * ativo da lotação. Quem decide se avisa é `conferirNovoPeriodo`.
 *
 * "Em férias no mês" = tem evento de férias que toca o mês, contado UMA vez
 * por servidor (duas frações no mesmo mês não são duas pessoas).
 */
export async function contagemParaTeto(
	db: Database,
	lotacao: string,
	anoMes: string
): Promise<{ emFerias: number; efetivo: number }> {
	const inicioMes = `${anoMes}-01`;
	const fimMes = `${anoMes}-31`;
	const [emFerias, efetivo] = await Promise.all([
		db
			.select({ n: sql<number>`count(distinct ${policialHistorico.policial_id})` })
			.from(policialHistorico)
			.innerJoin(policiais, eq(policiais.id, policialHistorico.policial_id))
			.where(
				and(
					eq(policiais.lotacao, lotacao),
					eq(policiais.ativo, 1),
					eq(policialHistorico.tipo, 'afastamento'),
					eq(policialHistorico.subtipo, 'ferias'),
					sql`${policialHistorico.data_inicio} <= ${fimMes}`,
					sql`coalesce(nullif(${policialHistorico.data_fim}, ''), '9999-12-31') >= ${inicioMes}`
				)
			)
			.get(),
		db
			.select({ n: sql<number>`count(*)` })
			.from(policiais)
			.where(and(eq(policiais.lotacao, lotacao), eq(policiais.ativo, 1)))
			.get()
	]);
	return { emFerias: emFerias?.n ?? 0, efetivo: efetivo?.n ?? 0 };
}

/**
 * As pendências de férias agrupadas por LOTAÇÃO — o que a Gestão de unidade
 * mostra como alerta no cartão de cada unidade, e que só some quando a
 * unidade resolve (pedido homologado, abono com ciência). Uma consulta para o
 * departamento inteiro; quem soma a subárvore é o chamador, que conhece a
 * árvore.
 */
export async function pendenciasDeFeriasPorLotacao(
	db: Database
): Promise<Map<string, PendenciasDeFerias>> {
	const mapa = new Map<string, PendenciasDeFerias>();
	const pega = (lotacao: string) => {
		const p = mapa.get(lotacao) ?? { reprogramacoesPendentes: 0, abonosSemCiencia: 0 };
		mapa.set(lotacao, p);
		return p;
	};
	const [reprogs, abonos] = await Promise.all([
		db
			.select({ lotacao: policiais.lotacao, n: sql<number>`count(*)` })
			.from(feriasReprogramacoes)
			.innerJoin(policiais, eq(policiais.id, feriasReprogramacoes.policial_id))
			.where(eq(feriasReprogramacoes.status, 'pendente'))
			.groupBy(policiais.lotacao),
		db
			.select({ lotacao: policiais.lotacao, n: sql<number>`count(*)` })
			.from(feriasAbonos)
			.innerJoin(policiais, eq(policiais.id, feriasAbonos.policial_id))
			.where(and(eq(feriasAbonos.status, 'deferido'), isNull(feriasAbonos.ciencia_unidade_em)))
			.groupBy(policiais.lotacao)
	]);
	for (const r of reprogs) pega(r.lotacao).reprogramacoesPendentes = r.n;
	for (const a of abonos) pega(a.lotacao).abonosSemCiencia = a.n;
	return mapa;
}

/**
 * Quem está EM ABONO hoje — os 10 dias convertidos, em que o servidor
 * trabalha. Ele conta como ativo (o evento de férias já não cobre esses dias);
 * o rótulo existe para a unidade saber POR QUE ele está de pé e não de férias.
 */
export async function abonosVigentesDe(
	db: Database,
	policialIds: number[],
	hojeISO: string
): Promise<Map<number, { inicio: string; fim: string }>> {
	const mapa = new Map<number, { inicio: string; fim: string }>();
	for (let i = 0; i < policialIds.length; i += 90) {
		const fatia = policialIds.slice(i, i + 90);
		if (fatia.length === 0) continue;
		const linhas = await db
			.select({
				policial_id: feriasAbonos.policial_id,
				inicio: feriasAbonos.abono_inicio,
				fim: feriasAbonos.abono_fim
			})
			.from(feriasAbonos)
			.where(
				and(
					inArray(feriasAbonos.policial_id, fatia),
					eq(feriasAbonos.status, 'deferido'),
					sql`${feriasAbonos.abono_inicio} <= ${hojeISO}`,
					sql`${feriasAbonos.abono_fim} >= ${hojeISO}`
				)
			);
		for (const l of linhas) mapa.set(l.policial_id, { inicio: l.inicio, fim: l.fim });
	}
	return mapa;
}

/** Um servidor de férias num mês — o que a visão anual da unidade lista. */
export interface FeriasNoMes {
	policial_id: number;
	nome: string;
	cargo: string;
	lotacao: string;
	data_inicio: string;
	data_fim: string;
	/** A fração, quando o evento veio da programação; nula para férias só do histórico. */
	fracao_id: number | null;
	ordem: number | null;
}

/**
 * As férias de várias lotações ao longo de um ANO — o que a Gestão de unidade
 * mostra mês a mês, com o teto de 15 % (art. 6º I). Lê os EVENTOS de férias
 * (a fonte única de "está de férias"), com a fração ao lado quando existe:
 * assim as férias que vieram da carga, sem fração, também aparecem.
 */
export async function feriasDoAno(
	db: Database,
	lotacoes: string[],
	ano: number
): Promise<FeriasNoMes[]> {
	const inicioAno = `${ano}-01-01`;
	const fimAno = `${ano}-12-31`;
	const linhas: FeriasNoMes[] = [];
	for (let i = 0; i < lotacoes.length; i += 90) {
		const fatia = lotacoes.slice(i, i + 90);
		if (fatia.length === 0) continue;
		const r = await db
			.select({
				policial_id: policialHistorico.policial_id,
				nome: policiais.nome,
				cargo: policiais.cargo,
				lotacao: policiais.lotacao,
				data_inicio: policialHistorico.data_inicio,
				data_fim: policialHistorico.data_fim,
				fracao_id: feriasFracoes.id,
				ordem: feriasFracoes.ordem
			})
			.from(policialHistorico)
			.innerJoin(policiais, eq(policiais.id, policialHistorico.policial_id))
			.leftJoin(feriasFracoes, eq(feriasFracoes.historico_id, policialHistorico.id))
			.where(
				and(
					inArray(policiais.lotacao, fatia),
					eq(policiais.ativo, 1),
					eq(policialHistorico.tipo, 'afastamento'),
					eq(policialHistorico.subtipo, 'ferias'),
					sql`${policialHistorico.data_inicio} <= ${fimAno}`,
					sql`coalesce(nullif(${policialHistorico.data_fim}, ''), '9999-12-31') >= ${inicioAno}`
				)
			)
			.orderBy(policialHistorico.data_inicio);
		for (const l of r) {
			if (!l.data_inicio) continue;
			linhas.push({
				policial_id: l.policial_id,
				nome: l.nome,
				cargo: l.cargo,
				lotacao: l.lotacao,
				data_inicio: l.data_inicio,
				data_fim: l.data_fim || l.data_inicio,
				fracao_id: l.fracao_id,
				ordem: l.ordem
			});
		}
	}
	return linhas;
}
