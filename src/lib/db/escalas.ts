/**
 * Acesso a dados da escala MENSAL (`escalas` + `escala_policiais` +
 * `escala_solicitacoes_assinatura`) — a escala comum das unidades, que não tem
 * relação com a GISE (essa vive em `db/gise/`).
 *
 * Junto do CRUD mora a regra de acesso CROSS-UNIDADE, e ela é o ponto sensível
 * do arquivo: normalmente um admin DPC só vê escala da própria lotação, mas uma
 * solicitação de assinatura abre exceção. `solicitacaoConcedeAcessoDpc` é a
 * regra, deliberadamente PURA (sem banco) para que a matriz de casos seja
 * testável — foi o IDOR A1, em que o ramo `unidade` devolvia `true` para
 * qualquer admin DPC, sem conferir a lotação. `temSolicitacaoParaDpcAdmin` é só
 * o invólucro que lê a linha e chama a regra: quem for validar permissão nova
 * chama uma das duas, não reimplementa a condição.
 *
 * Há no máximo UMA solicitação por escala — `criarSolicitacaoAssinatura` apaga a
 * anterior antes de inserir, então pedir de novo substitui o destinatário, e
 * `excluirSolicitacaoAssinatura` revoga junto o acesso que ela concedia.
 *
 * Nas leituras em lote (`listarSolicitacoesEscalas`, `adicionarTodosPoliciais`)
 * o `inArray` com lista vazia gera SQL inválido no D1; use `batchNonEmpty` ou
 * devolva cedo, como já fazem os call sites daqui.
 */
import { eq, and, or, sql, desc, asc, inArray, type SQL } from 'drizzle-orm';
import {
	escalas,
	escalaPoliciais,
	escalaDocumentos,
	policiais,
	escalaSolicitacoesAssinatura
} from '../server/schema';
import type * as schema from '../server/schema';
import type { EscalaPolicialComDados, EscalaListagem } from '../types';
import {
	batchNonEmpty,
	likeContains,
	paginarComContagem,
	timestampSqliteBrasilia,
	type Database
} from './core';

/** `YYYY-MM-01` — o piso do intervalo de um mês. */
function primeiroDiaDoMes(ano: number, mes: number): string {
	return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

/**
 * `YYYY-MM-01` do mês SEGUINTE — o teto exclusivo do intervalo.
 *
 * Exclusivo, e não o último dia do mês, para não precisar saber se fevereiro
 * tem 28 ou 29. Dezembro vira janeiro do ano seguinte.
 */
function primeiroDiaDoMesSeguinte(ano: number, mes: number): string {
	return mes === 12 ? `${ano + 1}-01-01` : primeiroDiaDoMes(ano, mes + 1);
}

/**
 * Listagem paginada de escalas, com todos os filtros da UI (lotação, status,
 * mês/ano, tipo, "visto", busca livre). Os parâmetros posicionais são herança
 * dos primeiros call sites; filtros novos entram em `opts`.
 */
export async function listarEscalas(
	db: Database,
	lotacao?: string,
	/**
	 * - `pendente` / `assinada`: presença de documento assinado (caixa de entrada).
	 * - `aguardando` / `arquivada`: arquivo operacional — FDS enviada
	 *   (`finalizada_em`) conta como arquivada, mesmo sem PDF assinado.
	 */
	status?: 'pendente' | 'assinada' | 'aguardando' | 'arquivada',
	mes?: number,
	ano?: number,
	tipo?: string,
	visto?: boolean,
	criadaEmDepoisDe?: string,
	opts?: {
		busca?: string;
		page?: number;
		limit?: number;
		lotacoes?: string[];
		/** Substring da lotação (filtro "Unidade" da cx. de entrada). */
		lotacaoBusca?: string;
		/** Substring de data_inicio, ex.: '2026-06' ou '2026-06-10'. */
		dataBusca?: string;
	}
): Promise<{
	escalas: EscalaListagem[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const conditions: SQL[] = [];

	if (lotacao) {
		conditions.push(eq(escalas.lotacao, lotacao));
	} else if (opts?.lotacoes) {
		// Array vazio = papel sem unidade (SEC-06): zero linhas, nunca "todas".
		conditions.push(
			opts.lotacoes.length > 0 ? inArray(escalas.lotacao, opts.lotacoes) : sql`1 = 0`
		);
	}
	// Mês e ano viram INTERVALO sobre `data_inicio`, não `strftime`.
	//
	// `strftime('%Y', data_inicio) = '2026'` é função sobre a coluna, e função
	// sobre coluna anula o índice — a mesma lição que `listarTodasRespostasGise`
	// já carrega escrita (B-1), do outro lado do sistema. Aqui o índice em jogo é
	// `idx_escalas_lotacao_tipo_data (lotacao, tipo, data_inicio)`, que existia e
	// não era usado.
	//
	// `data_inicio` é TEXT em `YYYY-MM-DD`, então a comparação lexicográfica é a
	// cronológica — o mesmo contrato que o resto do projeto usa em coluna de
	// data. O teto é EXCLUSIVO (`<` no primeiro dia do período seguinte) para
	// não depender de quantos dias o mês tem.
	if (ano && mes) {
		conditions.push(sql`${escalas.data_inicio} >= ${primeiroDiaDoMes(ano, mes)}`);
		conditions.push(sql`${escalas.data_inicio} < ${primeiroDiaDoMesSeguinte(ano, mes)}`);
	} else if (ano) {
		conditions.push(sql`${escalas.data_inicio} >= ${`${ano}-01-01`}`);
		conditions.push(sql`${escalas.data_inicio} < ${`${ano + 1}-01-01`}`);
	} else if (mes) {
		// "Todo mês de junho, de QUALQUER ano" não é um intervalo, então este ramo
		// continua pagando a varredura. É o único que sobra: a tela manda os dois
		// campos juntos, e mês solto só chega por URL montada à mão.
		const monthStr = mes.toString().padStart(2, '0');
		conditions.push(sql`strftime('%m', ${escalas.data_inicio}) = ${monthStr}`);
	}
	if (tipo && tipo !== 'todos')
		conditions.push(eq(escalas.tipo, tipo as 'plantao' | 'expediente' | 'fds'));
	if (visto !== undefined) conditions.push(eq(escalas.visto_por_admin, visto ? 1 : 0));
	if (criadaEmDepoisDe) conditions.push(sql`${escalas.created_at} >= ${criadaEmDepoisDe}`);

	// Busca por título ou cidade
	if (opts?.busca) {
		const termo = opts.busca.trim();
		conditions.push(or(likeContains(escalas.titulo, termo), likeContains(escalas.cidade, termo))!);
	}

	if (opts?.lotacaoBusca) {
		conditions.push(likeContains(escalas.lotacao, opts.lotacaoBusca.trim()));
	}

	if (opts?.dataBusca) {
		conditions.push(likeContains(escalas.data_inicio, opts.dataBusca.trim()));
	}

	// Filtro de status via IS NULL / IS NOT NULL sobre o LEFT JOIN abaixo.
	// `arquivada`/`aguardando` espelham o badge da listagem: plantão/expediente
	// pelo PDF; FDS pela finalização do envio.
	const fdsArquivada = sql`(${escalas.tipo} = 'fds' AND ${escalas.finalizada_em} IS NOT NULL)`;
	if (status === 'pendente') {
		conditions.push(sql`${escalaDocumentos.escala_id} IS NULL`);
	} else if (status === 'assinada') {
		conditions.push(sql`${escalaDocumentos.escala_id} IS NOT NULL`);
	} else if (status === 'aguardando') {
		conditions.push(sql`${escalaDocumentos.escala_id} IS NULL AND NOT ${fdsArquivada}` as SQL);
	} else if (status === 'arquivada') {
		conditions.push(sql`(${escalaDocumentos.escala_id} IS NOT NULL OR ${fdsArquivada})` as SQL);
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	const page = Math.max(1, opts?.page ?? 1);
	const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
	const offset = (page - 1) * limit;

	// LEFT JOIN com escalaDocumentos (1:1, UNIQUE constraint) para obter is_assinada
	// e window COUNT em um único round-trip ao D1.
	const results = await db
		.select({
			id: escalas.id,
			titulo: escalas.titulo,
			cidade: escalas.cidade,
			data_inicio: escalas.data_inicio,
			data_fim: escalas.data_fim,
			horario: escalas.horario,
			hora_entrada: escalas.hora_entrada,
			hora_saida: escalas.hora_saida,
			lotacao: escalas.lotacao,
			tipo: escalas.tipo,
			visto_por_admin: escalas.visto_por_admin,
			finalizada_em: escalas.finalizada_em,
			email_envio: escalas.email_envio,
			created_at: escalas.created_at,
			is_assinada: sql<boolean>`CASE WHEN ${escalaDocumentos.escala_id} IS NOT NULL THEN 1 ELSE 0 END`,
			total: sql<number>`count(*) OVER()`
		})
		.from(escalas)
		.leftJoin(escalaDocumentos, eq(escalaDocumentos.escala_id, escalas.id))
		.where(whereClause)
		.orderBy(desc(escalas.created_at))
		.limit(limit)
		.offset(offset);

	const { itens, ...paginacao } = paginarComContagem(results, page, limit);
	return { escalas: itens, ...paginacao };
}

/**
 * A escala em si (cabeçalho: título, lotação, tipo, intervalo e horário), sem os
 * escalados — quem precisa deles chama `listarPoliciaisEscala`.
 */
export async function buscarEscala(db: Database, id: number): Promise<schema.Escala | undefined> {
	return db.select().from(escalas).where(eq(escalas.id, id)).get();
}

/**
 * Cria a escala VAZIA e devolve `[{ id }]` — os policiais entram depois, por
 * `adicionarTodosPoliciais` ou pela adição manual.
 *
 * Chame `verificarEscalaExistente` antes: é ele que produz a mensagem de erro
 * com o período por extenso, que é o que o usuário precisa ler.
 *
 * **A tranca, porém, é o banco.** `uq_escalas_mensal` (migração 0063) recusa a
 * segunda escala mensal do mesmo `(lotacao, tipo, mês)` mesmo quando duas
 * requisições passam pelo check ao mesmo tempo — duplo clique, retry (SEC-34).
 * Este comentário dizia "Não checa duplicidade: … ou a mesma lotação ganha duas
 * escalas para o mesmo período", o que descrevia o defeito em vez de impedi-lo.
 *
 * O chamador deve capturar `ehViolacaoUnique` e devolver 409 — sem isso a
 * corrida perdida vira 500 com SQL cru na tela.
 *
 * **FDS não tem tranca**: colide por sobreposição de INTERVALO, que unique não
 * expressa em SQLite. Ali `verificarEscalaExistente` segue sendo a única
 * proteção, e a corrida continua possível.
 */
export async function criarEscala(
	db: Database,
	data: Omit<schema.NovaEscala, 'id' | 'created_at'>
) {
	return db.insert(escalas).values(data).returning({ id: escalas.id });
}

/**
 * Apaga a escala. Escalados, documento assinado e solicitação de assinatura
 * descem por `ON DELETE CASCADE`.
 *
 * É justamente esse cascade que torna a chamada DIRETA perigosa: a linha de
 * `escala_documentos` desaparece levando consigo o `r2_key`, e o PDF assinado, a
 * cópia de conferência e a selfie ficam no R2 sem ninguém que saiba que existem
 * (R2-1). Use `excluirEscalaCompleta` (`$lib/server/escalas/exclusao`), que limpa
 * o R2 antes — esta função é a peça interna dele.
 */
export async function excluirEscala(db: Database, id: number) {
	return db.delete(escalas).where(eq(escalas.id, id));
}

/**
 * Já existe escala equivalente para esta lotação? A regra de "equivalente"
 * muda por tipo:
 *
 * - **fds**: qualquer SOBREPOSIÇÃO de datas com o intervalo pedido (dois fins
 *   de semana não podem cobrir o mesmo dia);
 * - **mensal**: qualquer escala do mesmo tipo naquele MÊS.
 *
 * A comparação mensal é feita por intervalo (`>= dia 1` e `< dia 1 do mês
 * seguinte`) em vez de `substr(data_inicio, 1, 7)` para que o índice de
 * `data_inicio` seja usado.
 */
export async function verificarEscalaExistente(
	db: Database,
	lotacao: string,
	tipo: 'plantao' | 'expediente' | 'fds',
	dataInicio: string,
	dataFim?: string
): Promise<schema.Escala | undefined> {
	if (tipo === 'fds') {
		const fim = dataFim ?? dataInicio;
		// Overlap: existente.inicio <= novoFim AND existente.fim >= novoInicio
		return db
			.select()
			.from(escalas)
			.where(
				and(
					eq(escalas.lotacao, lotacao),
					eq(escalas.tipo, tipo),
					sql`${escalas.data_inicio} <= ${fim}`,
					sql`${escalas.data_fim} >= ${dataInicio}`
				)
			)
			.get();
	}
	// Range query em vez de substr() para aproveitar índices em data_inicio
	const mesAno = dataInicio.substring(0, 7);
	const [ano, mes] = mesAno.split('-').map(Number);
	const proximoMes =
		mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;

	return db
		.select()
		.from(escalas)
		.where(
			and(
				eq(escalas.lotacao, lotacao),
				eq(escalas.tipo, tipo),
				sql`${escalas.data_inicio} >= ${mesAno + '-01'}`,
				sql`${escalas.data_inicio} < ${proximoMes}`
			)
		)
		.get();
}

/** Marca/desmarca a escala como lida na caixa de entrada do Admin Geral. */
export async function marcarVisto(db: Database, id: number, visto: boolean) {
	return db
		.update(escalas)
		.set({ visto_por_admin: visto ? 1 : 0 })
		.where(eq(escalas.id, id));
}

/**
 * Conclui a escala de FDS: grava o instante do envio e o e-mail de destino.
 *
 * `finalizada_em` é gravado no horário de Brasília (UTC-3) em texto, no mesmo
 * formato dos outros carimbos legados desta tabela — não é ISO com `Z`.
 */
export async function finalizarEscalaFDS(
	db: Database,
	id: number,
	emailEnvio: string
): Promise<void> {
	await db
		.update(escalas)
		.set({ finalizada_em: timestampSqliteBrasilia(), email_envio: emailEnvio })
		.where(eq(escalas.id, id));
}

/** Reabre a escala de FDS. Preserva `email_envio` como histórico do último envio. */
export async function desfinalizarEscalaFDS(db: Database, id: number): Promise<void> {
	await db.update(escalas).set({ finalizada_em: null }).where(eq(escalas.id, id));
}

// ---- Escala Policiais ----

/** Insere um policial em várias datas de uma vez (um INSERT por lote, não por dia). */
export async function adicionarMultiplasDatasPlantao(
	db: Database,
	escalaId: number,
	policialId: number,
	datas: Array<{ data_plantao: string; data_saida: string }>,
	horaEntrada: string,
	horaSaida: string,
	equipe: string = '',
	observacoes: string = ''
): Promise<void> {
	if (datas.length === 0) return;

	// Batch insert em vez de loop individual
	await db.insert(escalaPoliciais).values(
		datas.map((d) => ({
			escala_id: escalaId,
			policial_id: policialId,
			data_plantao: d.data_plantao,
			data_saida: d.data_saida,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida,
			equipe,
			observacoes
		}))
	);
}

/** Preenche a escala com todos os policiais da lotação, no horário padrão dela. */
export async function adicionarTodosPoliciais(
	db: Database,
	escalaId: number,
	lotacao: string,
	regime: 'plantao' | 'expediente',
	dataPlantao: string,
	dataSaida: string,
	horaEntrada: string,
	horaSaida: string,
	/** Quem NÃO entra (afastados no período — E60); a action lista quem ficou de fora. */
	excluirIds: ReadonlySet<number> = new Set()
): Promise<number> {
	const candidatos = (
		await db
			.select({ id: policiais.id })
			.from(policiais)
			.where(
				and(eq(policiais.ativo, 1), eq(policiais.lotacao, lotacao), eq(policiais.regime, regime))
			)
	).filter((p) => !excluirIds.has(p.id));

	if (candidatos.length === 0) return 0;

	const jaNaEscala = await db
		.select({ policial_id: escalaPoliciais.policial_id })
		.from(escalaPoliciais)
		.where(eq(escalaPoliciais.escala_id, escalaId));

	const idsJaAdicionados = new Set(jaNaEscala.map((e) => e.policial_id));
	const novos = candidatos.filter((p) => !idsJaAdicionados.has(p.id));

	if (novos.length === 0) return 0;

	// D1 limita ~100 parâmetros por statement; cada linha tem 9 campos,
	// então um INSERT multi-linha com >11 policiais estouraria o limite.
	// db.batch() executa N statements em um único round-trip de forma atômica.
	const insertsLote = novos.map((p) =>
		db.insert(escalaPoliciais).values({
			escala_id: escalaId,
			policial_id: p.id,
			data_plantao: dataPlantao,
			data_saida: dataSaida,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida
		})
	);
	await batchNonEmpty(db, insertsLote);

	return novos.length;
}

const LOTE_INSERT_ESCALA = 50;

/**
 * Insere linhas em `escala_policiais` em lotes. O D1 limita ~100 statements
 * por batch e ~999 params por statement; cada linha usa ~8 campos, então 50
 * fica folgado. `criarComBase` já fatiava; `gerarProximoMes` mandava um
 * `values(array)` só e estourava em escala grande.
 */
export async function inserirPoliciaisEscalaEmLotes(
	db: Database,
	linhas: (typeof escalaPoliciais.$inferInsert)[]
): Promise<void> {
	if (linhas.length === 0) return;
	for (let i = 0; i < linhas.length; i += LOTE_INSERT_ESCALA) {
		const chunk = linhas.slice(i, i + LOTE_INSERT_ESCALA);
		await batchNonEmpty(
			db,
			chunk.map((row) => db.insert(escalaPoliciais).values(row))
		);
	}
}

/**
 * Query (NÃO executada) da listagem de escalados, para compor
 * `db.batch([mutação, listarPoliciaisEscalaQuery(...)])` e resolver escrita +
 * releitura em um só round-trip ao D1.
 *
 * A ordenação é a da tabela na tela: por data de plantão, DPC antes de OIP
 * (`desc` no cargo, porque 'D' < 'O') e nome em ordem alfabética.
 */
export function listarPoliciaisEscalaQuery(db: Database, escalaId: number) {
	return db
		.select({
			id: escalaPoliciais.id,
			escala_id: escalaPoliciais.escala_id,
			policial_id: escalaPoliciais.policial_id,
			data_plantao: escalaPoliciais.data_plantao,
			data_saida: escalaPoliciais.data_saida,
			horario: escalaPoliciais.horario,
			hora_entrada: escalaPoliciais.hora_entrada,
			hora_saida: escalaPoliciais.hora_saida,
			observacoes: escalaPoliciais.observacoes,
			nome: policiais.nome,
			matricula: policiais.matricula,
			cargo: policiais.cargo,
			telefone: policiais.telefone,
			lotacao: policiais.lotacao,
			regime: policiais.regime,
			classe: policiais.classe,
			equipe: escalaPoliciais.equipe
		})
		.from(escalaPoliciais)
		.innerJoin(policiais, eq(escalaPoliciais.policial_id, policiais.id))
		.where(eq(escalaPoliciais.escala_id, escalaId))
		.orderBy(asc(escalaPoliciais.data_plantao), desc(policiais.cargo), asc(policiais.nome));
}

/**
 * Escalados da escala, com os dados do policial já juntados — a mesma query de
 * `listarPoliciaisEscalaQuery`, executada. Use esta salvo quando precisar
 * compor um `db.batch`.
 *
 * Devolve UMA LINHA POR DIA de plantão do policial, não uma por policial: a
 * granularidade da tabela é (escala, policial, data).
 */
export async function listarPoliciaisEscala(
	db: Database,
	escalaId: number
): Promise<EscalaPolicialComDados[]> {
	const result = await listarPoliciaisEscalaQuery(db, escalaId);
	return result as EscalaPolicialComDados[];
}

// ---- Solicitações de Assinatura ----

/**
 * Registra o pedido de assinatura de uma escala mensal. O destinatário pode ser
 * um DPC específico (`destinatario_id`) ou o papel genérico — é o que decide
 * quem enxerga a escala fora da própria lotação.
 */
export async function criarSolicitacaoAssinatura(
	db: Database,
	escalaId: number,
	solicitanteId: number,
	tipo: 'unidade' | 'respondencia',
	destinatarioId?: number
) {
	await db
		.delete(escalaSolicitacoesAssinatura)
		.where(eq(escalaSolicitacoesAssinatura.escala_id, escalaId));
	await db.insert(escalaSolicitacoesAssinatura).values({
		escala_id: escalaId,
		solicitante_id: solicitanteId,
		tipo,
		destinatario_id: destinatarioId ?? null
	});
}

/**
 * A solicitação de assinatura dá a este admin DPC acesso à escala de outra
 * unidade? Decisão PURA (sem banco), reaproveitada pelo guard de permissão e
 * pelos testes de RBAC, que cobrem a matriz de casos sem tocar o D1.
 *
 * Concede quando:
 * - `respondencia` direcionada diretamente a este usuário — nomeação explícita
 *   vale mesmo fora do escopo administrativo, que é justamente o sentido de
 *   nomear alguém; OU
 * - `unidade` **E** a lotação da escala está dentro do escopo do admin
 *   (`lotacoesPermitidas`). Sem a segunda condição o ramo devolvia `true` para
 *   QUALQUER admin DPC, o que abria acesso cross-unidade/seccional — é o IDOR
 *   A1, e é por isso que a regra virou função testável.
 */
export function solicitacaoConcedeAcessoDpc(
	sol: { tipo: string; destinatario_id: number | null } | undefined,
	usuarioId: number,
	escalaLotacao: string | undefined,
	lotacoesPermitidas: string[] | undefined
): boolean {
	if (!sol) return false;
	if (sol.tipo === 'respondencia' && sol.destinatario_id === usuarioId) return true;
	if (sol.tipo === 'unidade') {
		return !!(escalaLotacao && lotacoesPermitidas?.includes(escalaLotacao));
	}
	return false;
}

/**
 * Versão com banco de `solicitacaoConcedeAcessoDpc`: lê a solicitação da escala
 * (há no máximo uma) e aplica a mesma regra. É o atalho usado pelo guard de
 * permissão; a regra em si mora na função pura acima.
 */
export async function temSolicitacaoParaDpcAdmin(
	db: Database,
	escalaId: number,
	usuarioId: number,
	lotacoesPermitidas?: string[],
	escalaLotacao?: string
): Promise<boolean> {
	const sol = await db
		.select({
			tipo: escalaSolicitacoesAssinatura.tipo,
			destinatario_id: escalaSolicitacoesAssinatura.destinatario_id
		})
		.from(escalaSolicitacoesAssinatura)
		.where(eq(escalaSolicitacoesAssinatura.escala_id, escalaId))
		.get();

	return solicitacaoConcedeAcessoDpc(sol, usuarioId, escalaLotacao, lotacoesPermitidas);
}

/**
 * A solicitação de assinatura da escala, completa, ou `undefined` se não houver
 * pedido pendente. Há no máximo uma: `criarSolicitacaoAssinatura` apaga a
 * anterior antes de inserir, então pedir de novo SUBSTITUI o destinatário.
 */
export async function buscarSolicitacaoAssinatura(db: Database, escalaId: number) {
	return db
		.select()
		.from(escalaSolicitacoesAssinatura)
		.where(eq(escalaSolicitacoesAssinatura.escala_id, escalaId))
		.get();
}

/** Revoga o pedido de assinatura — e, com ele, o acesso cross-unidade que ele concedia. */
export async function excluirSolicitacaoAssinatura(db: Database, escalaId: number) {
	await db
		.delete(escalaSolicitacoesAssinatura)
		.where(eq(escalaSolicitacoesAssinatura.escala_id, escalaId));
}

/**
 * Solicitações de várias escalas de uma vez, indexadas por `escala_id` — evita o
 * N+1 na lista de escalas, que mostra o selo "aguardando assinatura" em cada
 * linha.
 *
 * `Map` em vez de array porque o consumidor faz lookup por id, e escala sem
 * solicitação simplesmente não tem chave (nada de entrada nula para filtrar).
 * `escalaIds` vazio devolve `Map` vazio sem consultar o banco: `inArray` com
 * lista vazia gera SQL inválido no D1.
 *
 * `destinatario_nome` vem de `leftJoin` e fica `undefined` na solicitação por
 * papel genérico, que não nomeia ninguém.
 */
export async function listarSolicitacoesEscalas(
	db: Database,
	escalaIds: number[]
): Promise<
	Map<
		number,
		{ tipo: 'unidade' | 'respondencia'; destinatario_nome?: string; destinatario_id?: number }
	>
> {
	if (escalaIds.length === 0) return new Map();

	const rows = await db
		.select({
			escala_id: escalaSolicitacoesAssinatura.escala_id,
			tipo: escalaSolicitacoesAssinatura.tipo,
			destinatario_id: escalaSolicitacoesAssinatura.destinatario_id,
			destinatario_nome: policiais.nome
		})
		.from(escalaSolicitacoesAssinatura)
		.leftJoin(policiais, eq(policiais.id, escalaSolicitacoesAssinatura.destinatario_id))
		.where(inArray(escalaSolicitacoesAssinatura.escala_id, escalaIds));

	const map = new Map<
		number,
		{ tipo: 'unidade' | 'respondencia'; destinatario_nome?: string; destinatario_id?: number }
	>();
	for (const row of rows) {
		map.set(row.escala_id, {
			tipo: row.tipo as 'unidade' | 'respondencia',
			destinatario_id: row.destinatario_id ?? undefined,
			destinatario_nome: row.destinatario_nome ?? undefined
		});
	}
	return map;
}
