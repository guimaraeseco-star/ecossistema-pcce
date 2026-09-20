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
	fracoesDoPedido,
	periodoGozadoComAbono,
	periodosDoPedido,
	type PeriodoMontado,
	type PosicaoDoAbono,
	type TipoReprogramacao
} from '$lib/servidores/ferias';
import { adicionarDias } from '$lib/utils/datas';

/** Quem registra — snapshot de id e nome, como no resto do histórico. */
export interface Registrador {
	id: number;
	nome: string;
}

/** Uma fração com o abono que orbita nela. */
export interface FracaoCompleta extends FeriasFracao {
	abono: FeriasAbono | null;
}

/**
 * As férias de um servidor: as frações (por exercício, mais recente primeiro)
 * e os pedidos à COGEP, que são do EXERCÍCIO — uma sustação alcança várias
 * frações de uma vez, então o pedido não pendura numa só.
 */
export interface FeriasDoPolicial {
	fracoes: FracaoCompleta[];
	pedidos: FeriasReprogramacao[];
}

export async function listarFeriasDoPolicial(
	db: Database,
	policialId: number
): Promise<FeriasDoPolicial> {
	const [fracoes, pedidos] = await Promise.all([
		db
			.select()
			.from(feriasFracoes)
			.where(eq(feriasFracoes.policial_id, policialId))
			.orderBy(desc(feriasFracoes.exercicio), feriasFracoes.ordem, feriasFracoes.id),
		db
			.select()
			.from(feriasReprogramacoes)
			.where(eq(feriasReprogramacoes.policial_id, policialId))
			.orderBy(desc(feriasReprogramacoes.id))
	]);
	if (fracoes.length === 0) return { fracoes: [], pedidos };
	const abonos = await db
		.select()
		.from(feriasAbonos)
		.where(
			inArray(
				feriasAbonos.fracao_id,
				fracoes.map((f) => f.id)
			)
		);
	return {
		fracoes: fracoes.map((f) => ({
			...f,
			abono: abonos.find((a) => a.fracao_id === f.id) ?? null
		})),
		pedidos
	};
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

/**
 * Grava frações `programada` a partir de períodos já montados, cada uma com
 * o seu evento, e devolve os ids das frações na ordem dos períodos. Os
 * eventos entram num lote e as frações noutro — a fração precisa do id do
 * evento, e o D1 não devolve ids de dentro de um lote.
 */
async function inserirFracoes(
	db: Database,
	base: {
		policial_id: number;
		exercicio: number;
		ordemInicial: number;
		origem: 'guardiao' | 'reprogramacao';
		observacao: string;
		rotulo: string;
	},
	periodos: readonly PeriodoMontado[],
	quem: Registrador
): Promise<number[]> {
	if (periodos.length === 0) return [];
	const [e1, ...eN] = periodos.map((p, k) =>
		db
			.insert(policialHistorico)
			.values(
				eventoDeFerias(
					base.policial_id,
					p.inicio,
					p.fim,
					quem,
					`Férias — ${base.ordemInicial + k}ª fração do exercício ${base.exercicio}${base.rotulo}`
				)
			)
			.returning({ id: policialHistorico.id })
	);
	const eventos = await db.batch([e1, ...eN]);
	const [f1, ...fN] = periodos.map((p, k) =>
		db
			.insert(feriasFracoes)
			.values({
				policial_id: base.policial_id,
				exercicio: base.exercicio,
				ordem: (base.ordemInicial + k) as 1 | 2 | 3,
				data_inicio: p.inicio,
				data_fim: p.fim,
				status: 'programada',
				origem: base.origem,
				historico_id: eventos[k][0].id,
				observacao: base.observacao,
				registrado_por_id: quem.id,
				registrado_por_nome: quem.nome
			})
			.returning({ id: feriasFracoes.id })
	);
	const fracoes = await db.batch([f1, ...fN]);
	return fracoes.map((r) => r[0].id);
}

/** A programação de um exercício, como a unidade a digita do Guardião. */
export interface NovaProgramacao {
	policial_id: number;
	exercicio: number;
	/** Os períodos já montados pela regra (`montarPeriodos`): 1, 2 ou 3. */
	periodos: readonly PeriodoMontado[];
	observacao?: string;
}

/**
 * Registra a programação de um exercício — TODAS as frações de uma vez, cada
 * uma com o evento de afastamento que ela gera. As férias são um período só,
 * e é assim que entram.
 *
 * Recusa quando o exercício já tem fração: a unidade digitando duas vezes é o
 * erro mais provável, e o caminho para mudar o que está lançado é excluir a
 * programação (se ninguém mexeu nela) ou reprogramar.
 */
export async function registrarProgramacao(
	db: Database,
	dados: NovaProgramacao,
	quem: Registrador
): Promise<{ ok: true; ids: number[] } | { ok: false; motivo: 'ja_programado' }> {
	const existente = await db
		.select({ id: feriasFracoes.id })
		.from(feriasFracoes)
		.where(
			and(
				eq(feriasFracoes.policial_id, dados.policial_id),
				eq(feriasFracoes.exercicio, dados.exercicio)
			)
		)
		.get();
	if (existente) return { ok: false, motivo: 'ja_programado' };

	const ids = await inserirFracoes(
		db,
		{
			policial_id: dados.policial_id,
			exercicio: dados.exercicio,
			ordemInicial: 1,
			origem: 'guardiao',
			observacao: dados.observacao ?? '',
			rotulo: ''
		},
		dados.periodos,
		quem
	);
	return { ok: true, ids };
}

/**
 * Apaga a programação de um exercício digitada errada — só enquanto TODAS as
 * frações estão `programada` e nenhuma tem abono nem pedido. Leva os eventos
 * junto: o que nunca foi programado não pode constar como férias. Exercício
 * que já passou por sustação/suspensão não se apaga: a sucessão é registro.
 */
export async function excluirProgramacao(
	db: Database,
	policialId: number,
	exercicio: number
): Promise<{ ok: true } | { ok: false; motivo: 'nao_programada' | 'tem_vinculo' }> {
	const fracoes = await db
		.select()
		.from(feriasFracoes)
		.where(and(eq(feriasFracoes.policial_id, policialId), eq(feriasFracoes.exercicio, exercicio)));
	if (fracoes.length === 0 || fracoes.some((f) => f.status !== 'programada')) {
		return { ok: false, motivo: 'nao_programada' };
	}
	const ids = fracoes.map((f) => f.id);
	const [pedidos, abonos] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)` })
			.from(feriasReprogramacoes)
			.where(
				and(
					eq(feriasReprogramacoes.policial_id, policialId),
					eq(feriasReprogramacoes.exercicio, exercicio)
				)
			)
			.get(),
		db
			.select({ n: sql<number>`count(*)` })
			.from(feriasAbonos)
			.where(inArray(feriasAbonos.fracao_id, ids))
			.get()
	]);
	if ((pedidos?.n ?? 0) > 0 || (abonos?.n ?? 0) > 0) return { ok: false, motivo: 'tem_vinculo' };

	const eventos = fracoes.map((f) => f.historico_id).filter((h): h is number => h != null);
	const passos: BatchItem<'sqlite'>[] = [
		db.delete(feriasFracoes).where(inArray(feriasFracoes.id, ids))
	];
	if (eventos.length > 0) {
		passos.push(db.delete(policialHistorico).where(inArray(policialHistorico.id, eventos)));
	}
	await batchNonEmpty(db, passos);
	return { ok: true };
}

/** O pedido de reprogramação, como a unidade o abre. */
export interface NovaReprogramacao {
	policial_id: number;
	exercicio: number;
	tipo: TipoReprogramacao;
	/** Sustação: as frações alcançadas (todas as não iniciadas). */
	fracoes_ids?: number[];
	/** Suspensão: a fração em gozo. */
	fracao_id?: number;
	novos_periodos: readonly PeriodoMontado[];
	data_suspensao?: string | null;
	justificativa?: string;
	texto_oficio: string;
	nup?: string;
}

/**
 * Abre o pedido. Fica `pendente` — e pendente é alerta — até a unidade
 * homologar a resposta da COGEP. Recusa segundo pedido pendente no mesmo
 * exercício: a COGEP recebe um processo por vez. Recusa também quando alguma
 * fração alcançada não é deste servidor/exercício, não está `programada` ou
 * tem abono — nesse caso o abono precisa ser resolvido antes.
 */
export async function abrirReprogramacao(
	db: Database,
	dados: NovaReprogramacao,
	quem: Registrador
): Promise<
	| { ok: true; id: number }
	| { ok: false; motivo: 'ja_pendente' | 'fracao_fechada' | 'toda_vendida' }
> {
	const alvo = dados.tipo === 'sustacao' ? (dados.fracoes_ids ?? []) : [dados.fracao_id ?? 0];
	if (alvo.length === 0) return { ok: false, motivo: 'fracao_fechada' };
	const fracoes = await db.select().from(feriasFracoes).where(inArray(feriasFracoes.id, alvo));
	const todasValidas =
		fracoes.length === alvo.length &&
		fracoes.every(
			(f) =>
				f.policial_id === dados.policial_id &&
				f.exercicio === dados.exercicio &&
				f.status === 'programada'
		);
	if (!todasValidas) return { ok: false, motivo: 'fracao_fechada' };
	// Fração inteira vendida não se susta (está resolvida em pecúnia); a venda
	// parcial não impede — a sustação alcança só o que resta a gozar, e os dias
	// vendidos ficam vendidos (decisão dele, 20/09).
	const abonos = await db
		.select({
			fracao_id: feriasAbonos.fracao_id,
			inicio: feriasAbonos.abono_inicio,
			fim: feriasAbonos.abono_fim
		})
		.from(feriasAbonos)
		.where(and(inArray(feriasAbonos.fracao_id, alvo), eq(feriasAbonos.status, 'deferido')));
	for (const a of abonos) {
		const f = fracoes.find((x) => x.id === a.fracao_id);
		if (f && diasDaFracao({ data_inicio: a.inicio, data_fim: a.fim }) >= diasDaFracao(f)) {
			return { ok: false, motivo: 'toda_vendida' };
		}
	}

	const pendente = await db
		.select({ id: feriasReprogramacoes.id })
		.from(feriasReprogramacoes)
		.where(
			and(
				eq(feriasReprogramacoes.policial_id, dados.policial_id),
				eq(feriasReprogramacoes.exercicio, dados.exercicio),
				eq(feriasReprogramacoes.status, 'pendente')
			)
		)
		.get();
	if (pendente) return { ok: false, motivo: 'ja_pendente' };

	const [linha] = await db
		.insert(feriasReprogramacoes)
		.values({
			policial_id: dados.policial_id,
			exercicio: dados.exercicio,
			tipo: dados.tipo,
			fracao_id: dados.tipo === 'suspensao' ? (dados.fracao_id ?? null) : null,
			fracoes_ids: JSON.stringify(dados.tipo === 'sustacao' ? alvo : []),
			novos_periodos: JSON.stringify(dados.novos_periodos),
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
 * DEFERIDA: as frações alcançadas viram `sustada` ou `suspensa` e passam a
 * apontar para a primeira das novas, que nascem `programada` com origem
 * `reprogramacao` e o próprio evento de afastamento. A ordem das novas
 * continua de onde as sustadas começavam (a 1ª gozada fica 1ª; 2ª+3ª
 * sustadas que voltam como uma só viram a 2ª). O evento antigo muda conforme
 * o instituto:
 *   - sustação: some — aquelas férias não aconteceram;
 *   - suspensão: encurta até a véspera do retorno — os dias gozados foram
 *     afastamento de verdade e ficam.
 *
 * INDEFERIDA: só fecha o pedido; as frações permanecem como estavam.
 *
 * Fração sustada com abono parcial: o abono continua ligado a ela (os dias
 * vendidos ficam vendidos); o evento de gozo dela some, e a nova fração já
 * nasce só com os dias que restavam a gozar.
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

	const alvoIds = fracoesDoPedido(pedido);
	const antigas =
		alvoIds.length > 0
			? await db.select().from(feriasFracoes).where(inArray(feriasFracoes.id, alvoIds))
			: [];
	if (antigas.length === 0) return null;
	antigas.sort((a, b) => a.ordem - b.ordem);

	// As novas frações e os eventos delas — inseridas primeiro, porque as
	// antigas precisam do id da primeira nova para apontar a sucessão.
	const novosIds = await inserirFracoes(
		db,
		{
			policial_id: pedido.policial_id,
			exercicio: pedido.exercicio,
			ordemInicial: antigas[0].ordem,
			origem: 'reprogramacao',
			observacao: pedido.nup ? `NUP ${pedido.nup}` : '',
			rotulo: ` (reprogramada por ${pedido.tipo === 'sustacao' ? 'sustação' : 'suspensão'}${pedido.nup ? `, NUP ${pedido.nup}` : ''})`
		},
		periodosDoPedido(pedido),
		quem
	);

	const passos: BatchItem<'sqlite'>[] = [
		fechar,
		db
			.update(feriasFracoes)
			.set({
				status: pedido.tipo === 'sustacao' ? 'sustada' : 'suspensa',
				substituida_por_id: novosIds[0] ?? null
			})
			.where(inArray(feriasFracoes.id, alvoIds))
	];
	for (const antiga of antigas) {
		if (!antiga.historico_id) continue;
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
	status: 'deferido' | 'indeferido';
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
			status: dados.status,
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
