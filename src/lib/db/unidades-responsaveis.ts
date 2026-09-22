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
 * Essas duas são de caráter **permanente**. A terceira é a respondência
 * **temporária** (E68): o titular sai de férias ou se afasta, alguém responde
 * ENQUANTO ele está fora, e ele NÃO é encerrado — continua titular e volta
 * sozinho no fim do período. Por isso a unidade pode ter duas linhas abertas
 * ao mesmo tempo (uma de cada caráter, garantido pelo índice de 0099) e
 * "quem dirige hoje" passa a ser a temporária quando hoje cai dentro dela.
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
import {
	policiais,
	unidadeResponsaveis,
	unidades,
	designacoes,
	policialHistorico
} from '../server/schema';
import { hojeBrasilISO } from '$lib/utils/datas';
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
	/** Permanente (titular/vacância) ou temporária (férias/afastamento do titular). */
	carater: 'permanente' | 'temporaria';
	/** Na temporária, o titular que ela cobre. */
	substitui_policial_id: number | null;
	/** Na temporária, o afastamento que a originou. */
	evento_id: number | null;
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
	carater: unidadeResponsaveis.carater,
	substitui_policial_id: unidadeResponsaveis.substitui_policial_id,
	evento_id: unidadeResponsaveis.evento_id,
	data_inicio: unidadeResponsaveis.data_inicio,
	data_fim: unidadeResponsaveis.data_fim,
	nup: unidadeResponsaveis.nup,
	portaria: unidadeResponsaveis.portaria,
	observacao: unidadeResponsaveis.observacao,
	origem: unidadeResponsaveis.origem,
	registrado_por_nome: unidadeResponsaveis.registrado_por_nome
};

/**
 * Quem dirige HOJE, e por que a consulta não é mais "a linha sem data_fim".
 *
 * Com a temporária (E68) a unidade pode ter duas linhas valendo no mesmo dia:
 * o titular, que continua aberto, e quem responde por ele enquanto está fora.
 * Quem manda no dia é a TEMPORÁRIA — é ela que diz quem assina hoje. Fora do
 * período dela, o titular volta a aparecer sozinho, sem nenhuma escrita: o
 * fim da respondência é uma data, não um ato.
 *
 * A temporária pode estar aberta (afastamento sem fim previsto) ou fechada com
 * o último dia do afastamento; por isso o filtro é por INTERVALO, e não por
 * `data_fim IS NULL`.
 */
export async function responsavelVigente(
	db: Database,
	unidadeId: number,
	hoje: string = hojeBrasilISO()
): Promise<ResponsavelDaUnidade | null> {
	const linhas = (await db
		.select(PROJECAO)
		.from(unidadeResponsaveis)
		.innerJoin(policiais, eq(policiais.id, unidadeResponsaveis.policial_id))
		.leftJoin(designacoes, eq(designacoes.id, policiais.designacao_id))
		.where(and(eq(unidadeResponsaveis.unidade_id, unidadeId), vigenteEm(hoje)))
		.orderBy(
			desc(unidadeResponsaveis.carater),
			desc(unidadeResponsaveis.data_inicio)
		)) as ResponsavelDaUnidade[];
	// `desc` no caráter põe 'temporaria' antes de 'permanente' (ordem alfabética
	// invertida) — o desempate é de texto, então está travado no teste.
	return linhas[0] ?? null;
}

/**
 * A linha vale no dia `hoje`?
 *
 * As duas metades não são simétricas, de propósito. A **permanente** vale
 * enquanto não for encerrada, mesmo registrada com início futuro: é assim
 * desde a E54 (a consulta era só `data_fim IS NULL`), e é o que mantém
 * verdadeiro o "esta unidade já tem titular" para quem registrou a posse de
 * amanhã — o atalho de designação depende disso para não criar um segundo
 * titular. A **temporária** só vale DENTRO do período: antes dela quem dirige
 * é o titular, e depois dela o titular volta sozinho, sem nenhuma escrita.
 */
function vigenteEm(hoje: string) {
	return sql`((${unidadeResponsaveis.carater} = 'permanente' AND (${unidadeResponsaveis.data_fim} IS NULL OR ${unidadeResponsaveis.data_fim} >= ${hoje})) OR (${unidadeResponsaveis.carater} = 'temporaria' AND ${unidadeResponsaveis.data_inicio} <= ${hoje} AND (${unidadeResponsaveis.data_fim} IS NULL OR ${unidadeResponsaveis.data_fim} >= ${hoje})))`;
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
	unidadeIds: number[],
	hoje: string = hojeBrasilISO()
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
					vigenteEm(hoje)
				)
			)
			.orderBy(unidadeResponsaveis.carater);
		// A ordem ASC põe 'permanente' antes de 'temporaria', e o `set` seguinte
		// sobrescreve: a unidade em respondência temporária termina com ELA no
		// mapa, que é quem dirige hoje.
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

/**
 * O titular ABERTO da unidade — a direção permanente que ainda não foi
 * encerrada, valha ela hoje ou a partir de amanhã.
 *
 * Diferente de `responsavelVigente`, que responde "quem dirige hoje" e por
 * isso pode devolver o substituto temporário. Aqui a pergunta é outra: de quem
 * é a cadeira? É quem a respondência temporária cobre.
 */
export async function titularAberto(
	db: Database,
	unidadeId: number
): Promise<{ id: number; policial_id: number } | null> {
	const linha = await db
		.select({ id: unidadeResponsaveis.id, policial_id: unidadeResponsaveis.policial_id })
		.from(unidadeResponsaveis)
		.where(
			and(
				eq(unidadeResponsaveis.unidade_id, unidadeId),
				eq(unidadeResponsaveis.carater, 'permanente'),
				isNull(unidadeResponsaveis.data_fim)
			)
		)
		.get();
	return linha ?? null;
}

/** Os dados de uma respondência temporária (E68). */
export interface NovaRespondenciaTemporaria {
	unidade_id: number;
	/** Quem responde enquanto o titular está fora. */
	policial_id: number;
	/** O titular afastado — a temporária existe por causa dele. */
	substitui_policial_id: number;
	/** O afastamento que a originou, quando veio de um (`policial_historico`). */
	evento_id: number | null;
	data_inicio: string;
	/** O último dia previsto; nulo no afastamento sem fim definido. */
	data_fim: string | null;
	nup: string;
	observacao?: string;
	registrado_por_id: number;
	registrado_por_nome: string;
}

/** O que impediu a respondência temporária, ou `null` quando pode. */
export type RecusaDaTemporaria =
	| 'unidade_inexistente'
	| 'policial_inexistente'
	| 'policial_inativo'
	| 'nao_e_delegado'
	| 'sem_nup'
	| 'periodo_invertido'
	| 'responde_a_si_mesmo'
	| 'nao_substitui_o_titular'
	| 'ja_ha_temporaria';

/**
 * Registra quem responde pela unidade ENQUANTO o titular está fora (E68).
 *
 * A diferença para `registrarResponsavel` é o que NÃO acontece aqui: o titular
 * não é encerrado. Ele continua titular, a temporária vale pelo período do
 * afastamento e ele volta a dirigir sozinho no dia seguinte ao fim — sem
 * nenhuma escrita, porque `responsavelVigente` decide por data.
 *
 * Recusa `nao_substitui_o_titular` em vez de aceitar qualquer nome: a
 * temporária é sempre a cobertura de UMA ausência determinada, e é o
 * `substitui_policial_id` que amarra a linha à pessoa que se afastou. Sem essa
 * conferência, dois pedidos seguidos poderiam registrar coberturas de titulares
 * diferentes na mesma unidade sem que nada acusasse a contradição.
 */
export async function registrarRespondenciaTemporaria(
	db: Database,
	dados: NovaRespondenciaTemporaria
): Promise<{ ok: true; id: number } | { ok: false; motivo: RecusaDaTemporaria }> {
	if (!dados.nup.trim()) return { ok: false, motivo: 'sem_nup' };
	if (dados.data_fim && dados.data_fim < dados.data_inicio) {
		return { ok: false, motivo: 'periodo_invertido' };
	}
	if (dados.policial_id === dados.substitui_policial_id) {
		return { ok: false, motivo: 'responde_a_si_mesmo' };
	}

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
	// Só DPC dirige unidade — na temporária também (E66/E69).
	if (alvo.cargo !== 'DPC') return { ok: false, motivo: 'nao_e_delegado' };

	const titular = await db
		.select({ policial_id: unidadeResponsaveis.policial_id })
		.from(unidadeResponsaveis)
		.where(
			and(
				eq(unidadeResponsaveis.unidade_id, dados.unidade_id),
				eq(unidadeResponsaveis.carater, 'permanente'),
				isNull(unidadeResponsaveis.data_fim)
			)
		)
		.get();
	if (!titular || titular.policial_id !== dados.substitui_policial_id) {
		return { ok: false, motivo: 'nao_substitui_o_titular' };
	}

	// Sobreposição: duas coberturas do mesmo período na mesma unidade não se
	// resolvem por ordem de chegada — a segunda é erro. O índice parcial de 0099
	// só pega o caso em que as duas estão abertas.
	const fim = dados.data_fim ?? '9999-12-31';
	const conflito = await db
		.select({ id: unidadeResponsaveis.id })
		.from(unidadeResponsaveis)
		.where(
			and(
				eq(unidadeResponsaveis.unidade_id, dados.unidade_id),
				eq(unidadeResponsaveis.carater, 'temporaria'),
				sql`${unidadeResponsaveis.data_inicio} <= ${fim}`,
				sql`coalesce(${unidadeResponsaveis.data_fim}, '9999-12-31') >= ${dados.data_inicio}`
			)
		)
		.get();
	if (conflito) return { ok: false, motivo: 'ja_ha_temporaria' };

	await db.insert(unidadeResponsaveis).values({
		unidade_id: dados.unidade_id,
		policial_id: dados.policial_id,
		papel: 'respondente',
		carater: 'temporaria',
		substitui_policial_id: dados.substitui_policial_id,
		evento_id: dados.evento_id,
		data_inicio: dados.data_inicio,
		data_fim: dados.data_fim,
		nup: dados.nup,
		observacao: dados.observacao ?? '',
		origem: 'sistema',
		registrado_por_id: dados.registrado_por_id,
		registrado_por_nome: dados.registrado_por_nome
	});
	const criada = await db
		.select({ id: unidadeResponsaveis.id })
		.from(unidadeResponsaveis)
		.where(
			and(
				eq(unidadeResponsaveis.unidade_id, dados.unidade_id),
				eq(unidadeResponsaveis.carater, 'temporaria'),
				eq(unidadeResponsaveis.data_inicio, dados.data_inicio)
			)
		)
		.orderBy(desc(unidadeResponsaveis.id))
		.get();
	return { ok: true, id: criada?.id ?? 0 };
}

/**
 * O titular voltou antes (retorno antecipado, E58): a respondência encurta
 * junto, para não sobrar um substituto vigente com o titular de volta.
 *
 * Encurta pelo EVENTO, não pela unidade: é o afastamento que mudou de fim, e
 * pode haver outra temporária mais antiga na mesma unidade. Devolve quantas
 * linhas mudaram — zero é normal, porque nem todo afastamento gerou cobertura.
 */
export async function encerrarTemporariaDoEvento(
	db: Database,
	eventoId: number,
	novoFim: string
): Promise<number> {
	const abertas = await db
		.select({ id: unidadeResponsaveis.id, data_inicio: unidadeResponsaveis.data_inicio })
		.from(unidadeResponsaveis)
		.where(
			and(
				eq(unidadeResponsaveis.evento_id, eventoId),
				eq(unidadeResponsaveis.carater, 'temporaria'),
				sql`coalesce(${unidadeResponsaveis.data_fim}, '9999-12-31') > ${novoFim}`
			)
		);
	let n = 0;
	for (const linha of abertas) {
		// Retorno no mesmo dia em que a cobertura começou: ela não chegou a valer,
		// e encerrar na véspera do início produziria período negativo. Fica com o
		// próprio dia de início.
		const fim = novoFim < linha.data_inicio ? linha.data_inicio : novoFim;
		await db
			.update(unidadeResponsaveis)
			.set({ data_fim: fim })
			.where(eq(unidadeResponsaveis.id, linha.id));
		n += 1;
	}
	return n;
}

/**
 * O evento que originou a cobertura vai SUMIR (férias excluídas): a
 * respondência fecha no próprio dia em que começou — nunca chegou a valer — e
 * larga o vínculo, porque a chave estrangeira não pode apontar para o vazio.
 *
 * Fechar em vez de apagar: quem respondeu de fato por um dia continua na
 * sucessão da unidade, e apagar linha de direção é reescrever história.
 */
export async function desvincularTemporariasDoEvento(
	db: Database,
	eventoId: number
): Promise<number> {
	const linhas = await db
		.select({ id: unidadeResponsaveis.id, data_inicio: unidadeResponsaveis.data_inicio })
		.from(unidadeResponsaveis)
		.where(
			and(
				eq(unidadeResponsaveis.evento_id, eventoId),
				eq(unidadeResponsaveis.carater, 'temporaria')
			)
		);
	for (const l of linhas) {
		await db
			.update(unidadeResponsaveis)
			.set({ data_fim: l.data_inicio, evento_id: null })
			.where(eq(unidadeResponsaveis.id, l.id));
	}
	return linhas.length;
}

/** Uma unidade cujo titular está (ou estará) fora sem ninguém respondendo. */
export interface TitularAusente {
	unidade_id: number;
	unidade_nome: string;
	titular_id: number;
	titular_nome: string;
	/** O afastamento que o tira da unidade — a cobertura se amarra nele. */
	evento_id: number;
	/** `ferias` ou o subtipo do afastamento — muda o texto e a antecedência. */
	subtipo: string;
	data_inicio: string;
	data_fim: string | null;
}

/**
 * As unidades cujo titular se ausenta e ninguém responde por elas (E68).
 *
 * Duas antecedências, porque os dois fatos são diferentes: **férias são
 * previsíveis**, então a pendência nasce `diasAntes` (cinco, por decisão dele)
 * antes do primeiro dia; **afastamento não é**, então nasce no momento em que
 * o registro existe. É pendência ao vivo (E59): some sozinha quando a
 * respondência é registrada, sem ninguém marcar nada como lido.
 */
export async function titularesAusentesSemRespondencia(
	db: Database,
	hoje: string = hojeBrasilISO(),
	diasAntes = 5
): Promise<TitularAusente[]> {
	const linhas = await db
		.select({
			unidade_id: unidadeResponsaveis.unidade_id,
			unidade_nome: unidades.nome,
			titular_id: policiais.id,
			titular_nome: policiais.nome,
			evento_id: policialHistorico.id,
			subtipo: policialHistorico.subtipo,
			data_inicio: policialHistorico.data_inicio,
			data_fim: policialHistorico.data_fim
		})
		.from(unidadeResponsaveis)
		.innerJoin(unidades, eq(unidades.id, unidadeResponsaveis.unidade_id))
		.innerJoin(policiais, eq(policiais.id, unidadeResponsaveis.policial_id))
		.innerJoin(
			policialHistorico,
			and(
				eq(policialHistorico.policial_id, unidadeResponsaveis.policial_id),
				eq(policialHistorico.tipo, 'afastamento')
			)
		)
		.where(
			and(
				eq(unidadeResponsaveis.carater, 'permanente'),
				eq(unidadeResponsaveis.papel, 'titular'),
				isNull(unidadeResponsaveis.data_fim),
				eq(unidades.ativo, true),
				// O afastamento ainda não terminou...
				sql`(${policialHistorico.data_fim} IS NULL OR ${policialHistorico.data_fim} = '' OR ${policialHistorico.data_fim} >= ${hoje})`,
				// ...e já começou, ou começa dentro da antecedência (só as férias).
				sql`${policialHistorico.data_inicio} <= (CASE WHEN ${policialHistorico.subtipo} = 'ferias' THEN date(${hoje}, ${`+${diasAntes} days`}) ELSE ${hoje} END)`,
				// Ninguém cobrindo esse período.
				sql`NOT EXISTS (SELECT 1 FROM unidade_responsaveis t WHERE t.unidade_id = ${unidadeResponsaveis.unidade_id} AND t.carater = 'temporaria' AND t.data_inicio <= coalesce(nullif(${policialHistorico.data_fim}, ''), '9999-12-31') AND coalesce(t.data_fim, '9999-12-31') >= ${policialHistorico.data_inicio})`
			)
		)
		.orderBy(policialHistorico.data_inicio, unidades.nome);
	// Evento sem primeiro dia é linha quebrada da carga antiga: não dá para dizer
	// quando a ausência começa, então ela não vira pendência.
	return linhas
		.filter((l) => !!l.data_inicio)
		.map((l) => ({
			...l,
			data_inicio: l.data_inicio as string,
			subtipo: l.subtipo ?? '',
			data_fim: l.data_fim && l.data_fim !== '' ? l.data_fim : null
		}));
}
