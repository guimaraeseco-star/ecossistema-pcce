/**
 * Cadastro de policiais — a raiz de duas coisas críticas do sistema:
 *
 *   1. **RBAC**: o par `papel` + `papel_unidade_id` desta tabela é o que
 *      `lotacoesAdministradas()` lê para decidir escopo de admin. Escrever
 *      `papel` aqui É conceder permissão; por isso o webhook de sync só
 *      repassa o papel atual (M-4) em vez de aceitar o do payload.
 *   2. **Identidade da assinatura**: `cpf`/`cpf_index` casam o policial com o
 *      titular do certificado ICP-Brasil na hora de assinar.
 *
 * O CPF nunca é gravado em claro quando há chave configurada:
 * `prepararCpfParaDB()` devolve o valor cifrado em `cpf` e um índice cego
 * (HMAC) em `cpf_index`, que é a única coluna pesquisável. Sem chave (dev), o
 * CPF fica em claro e `cpf_index` fica nulo — daí todo lookup por CPF ter os
 * dois caminhos.
 *
 * Convenção de horário: `updated_at` usa `datetime('now','-3 hours')` para
 * gravar horário de Brasília, igual ao resto do schema.
 */
import { eq, and, or, isNull, inArray, asc, sql } from 'drizzle-orm';
import { designacoes, policiais, unidades } from '../../server/schema';
import type * as schema from '../../server/schema';
import { limparMatricula } from '../../utils/formato';
import { gerarSenhaAleatoriaHash } from '../../auth';
import { prepararCpfParaDB, type CpfCriptoEnv } from '../../crypto/cpf-cripto';
import { paginarComContagem, likeContains, type Database } from '../core';

/**
 * Uma linha da listagem: o cadastro sem a senha, MAIS o nome e o símbolo da
 * designação já resolvidos pelo join.
 *
 * O nome vem junto porque `designacao_id` sozinho não serve para nada na tela —
 * e deixar cada chamador buscar o catálogo por fora produziria uma consulta por
 * página, ou pior, uma por linha.
 */
export type PolicialListado = Omit<schema.Policial, 'senha'> & {
	designacao: string | null;
	designacao_simbolo: string | null;
};

/**
 * Listagem paginada do cadastro, para a tela de policiais e para o autocomplete.
 *
 * Contrato:
 * - devolve **apenas ativos** (`ativo = 1`); inativos só aparecem via
 *   `buscarPolicial`;
 * - a projeção OMITE `senha` — é a lista que vai para o cliente (minimização
 *   LGPD). O tipo de retorno reflete isso;
 * - `cpf` volta **como está no banco**, ou seja cifrado: quem precisa exibir
 *   chama `decifrarCpfDoDB`;
 * - `lotacao === '__todas__'` é sentinela de "sem filtro" (o `<select>` da UI
 *   manda essa string); `semLotacao` tem precedência sobre `lotacao` e traz os
 *   registros com lotação vazia/nula, que são os que a sincronização não
 *   conseguiu casar com nenhuma unidade;
 * - `seccionalId` casa por NOME de unidade (a própria seccional ou qualquer
 *   unidade que aponte para ela), porque `policiais.lotacao` é texto, não FK;
 * - `escopoLotacoes` é o RECORTE DE PERMISSÃO do administrador que está olhando
 *   (`lotacoesAdministradas`), e não um filtro de tela: ele se soma aos demais e
 *   nenhum deles o afrouxa. Omitido = sem recorte (Admin Geral). **Lista vazia
 *   devolve zero policiais**, e não "todos" — papel sem alcance não enxerga
 *   ninguém, que é a mesma decisão de `lotacoesAdministradas` (FLW-RBAC-003).
 *
 * A contagem vem de `count(*) OVER()` na mesma query: paginar custa uma ida ao
 * banco, não duas.
 */
export async function listarPoliciais(
	db: Database,
	lotacao?: string,
	semLotacao?: boolean,
	opts?: {
		busca?: string;
		cargo?: string;
		seccionalId?: number;
		somentePapel?: boolean;
		escopoLotacoes?: string[];
		/** Situação de HOJE (`hojeISO` obrigatório junto): quem está ativo, de férias ou afastado. */
		situacao?: 'ativos' | 'ferias' | 'afastados';
		hojeISO?: string;
		/** Função exercida (id do catálogo `designacoes`). */
		designacaoId?: number;
		page?: number;
		limit?: number;
	}
): Promise<{
	policiais: PolicialListado[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const baseConditions = [eq(policiais.ativo, 1)];

	if (semLotacao) {
		baseConditions.push(or(eq(policiais.lotacao, ''), isNull(policiais.lotacao))!);
	} else if (lotacao && lotacao !== '__todas__') {
		baseConditions.push(eq(policiais.lotacao, lotacao));
	}

	// Recorte de permissão: entra ANTES dos filtros de tela e independe deles.
	// `inArray` com lista vazia produziria SQL inválido no D1, e o caso não é
	// teórico — é o admin cujo `papel_unidade_id` aponta para unidade removida.
	if (opts?.escopoLotacoes) {
		baseConditions.push(
			opts.escopoLotacoes.length > 0 ? inArray(policiais.lotacao, opts.escopoLotacoes) : sql`0 = 1`
		);
	}

	if (opts?.seccionalId) {
		// Busca policiais em qualquer unidade que pertença à seccional escolhida
		const seccionalUnits = db
			.select({ nome: unidades.nome })
			.from(unidades)
			.where(or(eq(unidades.id, opts.seccionalId), eq(unidades.seccional_id, opts.seccionalId)));

		baseConditions.push(sql`${policiais.lotacao} IN (${seccionalUnits})`);
	}

	// Busca por nome ou matrícula
	if (opts?.busca) {
		const termo = opts.busca.trim();
		baseConditions.push(
			or(likeContains(policiais.nome, termo), likeContains(policiais.matricula, termo))!
		);
	}

	// Filtro por cargo
	if (opts?.cargo) {
		baseConditions.push(eq(policiais.cargo, opts.cargo as 'DPC' | 'OIP'));
	}

	// Filtro por designação (a função exercida): "quem são os 130 de plantão",
	// "quantos chefes de cartório tem a 3ª Seccional".
	if (opts?.designacaoId) {
		baseConditions.push(eq(policiais.designacao_id, opts.designacaoId));
	}

	// Somente policiais com papel administrativo (admin_seccional ou admin_unidade)
	if (opts?.somentePapel) {
		baseConditions.push(sql`${policiais.papel} IS NOT NULL`);
	}

	// Situação de hoje — a MESMA régua de `afastamentoVigente`/`efetivoPorLotacao`
	// (início ≤ hoje ≤ fim, fim vazio = aberto); licença por cima de férias:
	// quem tem férias E outro afastamento no dia é "afastado", não "de férias".
	if (opts?.situacao && opts.hojeISO) {
		const hoje = opts.hojeISO;
		const vigente = (extra: ReturnType<typeof sql>) =>
			sql`EXISTS (SELECT 1 FROM policial_historico h WHERE h.policial_id = ${policiais.id} AND h.tipo = 'afastamento' AND h.data_inicio <= ${hoje} AND (h.data_fim IS NULL OR h.data_fim = '' OR h.data_fim >= ${hoje}) ${extra})`;
		const qualquer = vigente(sql``);
		const outro = vigente(sql`AND h.subtipo <> 'ferias'`);
		const ferias = vigente(sql`AND h.subtipo = 'ferias'`);
		if (opts.situacao === 'ativos') baseConditions.push(sql`NOT ${qualquer}`);
		else if (opts.situacao === 'afastados') baseConditions.push(outro);
		else baseConditions.push(sql`${ferias} AND NOT ${outro}`);
	}

	// Paginação com valores padrão
	const page = opts?.page ?? 1;
	const limit = opts?.limit ?? 20;
	const offset = (page - 1) * limit;

	// Query única com window function: count + data em uma só ida ao banco
	const results = await db
		.select({
			id: policiais.id,
			nome: policiais.nome,
			matricula: policiais.matricula,
			cargo: policiais.cargo,
			cpf: policiais.cpf,
			cpf_index: policiais.cpf_index,
			telefone: policiais.telefone,
			lotacao: policiais.lotacao,
			ativo: policiais.ativo,
			regime: policiais.regime,
			classe: policiais.classe,
			primeiro_acesso: policiais.primeiro_acesso,
			papel: policiais.papel,
			papel_unidade_id: policiais.papel_unidade_id,
			email: policiais.email,
			email_pessoal: policiais.email_pessoal,
			email_pessoal_verificado: policiais.email_pessoal_verificado,
			cargo_anterior: policiais.cargo_anterior,
			data_nascimento: policiais.data_nascimento,
			data_posse: policiais.data_posse,
			designacao_id: policiais.designacao_id,
			designacao_origem: policiais.designacao_origem,
			designacao: designacoes.nome,
			designacao_simbolo: designacoes.simbolo,
			created_at: policiais.created_at,
			updated_at: policiais.updated_at,
			total: sql<number>`count(*) OVER()`
		})
		.from(policiais)
		// LEFT: servidor sem designação (célula vazia na planilha) continua na
		// lista — um INNER JOIN o esconderia sem que ninguém percebesse.
		.leftJoin(designacoes, eq(designacoes.id, policiais.designacao_id))
		.where(and(...baseConditions))
		.orderBy(asc(policiais.cargo), asc(policiais.nome))
		.limit(limit)
		.offset(offset);

	const { itens, ...paginacao } = paginarComContagem(results, page, limit);
	return { policiais: itens, ...paginacao };
}

/**
 * Registro completo por id, incluindo inativos.
 *
 * ATENÇÃO: é `select()` sem projeção — traz `senha` (hash). Serve para o
 * servidor decidir/assinar, nunca para devolver cru ao cliente; quem expõe em
 * `load` monta o objeto campo a campo.
 */
export async function buscarPolicial(
	db: Database,
	id: number
): Promise<schema.Policial | undefined> {
	return db.select().from(policiais).where(eq(policiais.id, id)).get();
}

/**
 * Lookup por matrícula (já normalizada). Usado pelo webhook de sync para
 * detectar se o registro já existe — e, com isso, preservar campos
 * privilegiados que NÃO devem ser tocados pelo payload externo (papel).
 */
export async function buscarPolicialPorMatricula(
	db: Database,
	matricula: string
): Promise<schema.Policial | undefined> {
	return db
		.select()
		.from(policiais)
		.where(eq(policiais.matricula, limparMatricula(matricula)))
		.get();
}

/**
 * Cadastro completo de um policial, como chega da tela de cadastro e do
 * webhook de pessoal. Os dois caminhos recebem exatamente estes campos.
 */
export interface DadosPolicial {
	nome: string;
	matricula: string;
	cargo: string;
	cpf?: string | null;
	telefone?: string;
	lotacao?: string;
	regime?: string;
	classe?: string;
	papel?: string | null;
	papel_unidade_id?: number | null;
	email?: string | null;
	email_pessoal?: string | null;
	ativo?: number;
	// ---- Fase 2-C (0088): a folha é dona; `undefined` = não mexe ----
	cargo_anterior?: string;
	data_nascimento?: string | null;
	data_posse?: string | null;
	designacao_id?: number | null;
}

/**
 * Traduz o payload externo para colunas, UMA vez, e separa em dois grupos.
 *
 * A separação é o contrato entre cadastro e sync, não arrumação: `daFolha` são
 * os campos de que o sistema de pessoal é dono e que uma rodada de sync pode
 * sobrescrever; o resto — matrícula, credencial e contato — só existe no
 * INSERT, porque sobrescrevê-lo derrubaria o acesso de quem já usa o sistema.
 *
 * Devolve os dois porque `prepararCpfParaDB` **não é determinístico**: o
 * envelope AES-GCM leva IV aleatório, então chamá-lo duas vezes para a mesma
 * linha gravaria `cpf` diferente no INSERT e no UPDATE do mesmo `upsert`.
 *
 * As duas cópias existiam lado a lado desde sempre e já haviam divergido:
 * `papel_unidade_id` usava `|| null` no cadastro e `?? null` no sync. Ficou o
 * `??` — `0` é um id que não existe, mas transformá-lo em `null` silenciosamente
 * apaga um escopo de permissão em vez de acusar o valor inválido.
 */
async function colunasDoPolicial(data: DadosPolicial, env?: CpfCriptoEnv) {
	const { cpf, cpf_index } = await prepararCpfParaDB(data.cpf, env);

	const daFolha = {
		nome: data.nome,
		cargo: data.cargo as 'DPC' | 'OIP',
		cpf,
		cpf_index,
		telefone: data.telefone || '',
		lotacao: data.lotacao || '',
		regime: (data.regime as 'plantao' | 'expediente') || 'plantao',
		classe: data.classe || '',
		papel: (data.papel as 'admin_seccional' | 'admin_unidade' | null) || null,
		papel_unidade_id: data.papel_unidade_id ?? null,
		// Só entram no SET quando a folha os mandou: o Apps Script antigo não
		// manda, e não pode zerar o que a carga da planilha gravou.
		...(data.cargo_anterior !== undefined ? { cargo_anterior: data.cargo_anterior } : {}),
		...(data.data_nascimento !== undefined ? { data_nascimento: data.data_nascimento } : {}),
		...(data.data_posse !== undefined ? { data_posse: data.data_posse } : {}),
		...(data.designacao_id !== undefined ? { designacao_id: data.designacao_id } : {})
	};

	// FLW-AUT-005: `ativo` omitido no UPDATE deixa a coluna intocada. `?? 1`
	// aqui reativava todo mundo a cada sync — o webhook omite de propósito
	// para existentes. INSERT (abaixo) continua nascendo ativo.
	const daFolhaUpdate = data.ativo !== undefined ? { ...daFolha, ativo: data.ativo } : daFolha;

	return {
		daFolha: daFolhaUpdate,
		/** Linha completa de INSERT: a folha mais o que só nasce uma vez. */
		nova: {
			...daFolha,
			ativo: data.ativo ?? 1,
			matricula: limparMatricula(data.matricula),
			senha: await gerarSenhaAleatoriaHash(),
			primeiro_acesso: 1,
			email: data.email || null,
			email_pessoal: data.email_pessoal || null,
			email_pessoal_verificado: 0
		}
	};
}

/**
 * Cria um policial pela tela de cadastro.
 *
 * A senha NÃO é escolhida aqui: grava um hash de senha aleatória e
 * `primeiro_acesso = 1`, de modo que o único caminho de entrada seja o link de
 * primeiro acesso enviado por e-mail. Ninguém — nem o admin que cadastrou —
 * conhece uma senha utilizável.
 *
 * `papel`/`papel_unidade_id` vêm do chamador já validados: esta função concede
 * a permissão que receber.
 */
export async function criarPolicial(db: Database, data: DadosPolicial, env?: CpfCriptoEnv) {
	const { nova } = await colunasDoPolicial(data, env);
	return db.insert(policiais).values(nova);
}

/**
 * Insere ou atualiza pela MATRÍCULA — é a porta do webhook de sincronização
 * com o sistema de pessoal, que reenvia a folha inteira a cada rodada.
 *
 * O que o UPDATE deliberadamente NÃO faz:
 * - **não mexe em `senha` nem em `primeiro_acesso`**: eles só existem no ramo
 *   de INSERT. Uma rodada de sync não pode derrubar o acesso de quem já usa o
 *   sistema;
 * - **não reativa `ativo=0`**: `ativo` omitido fica de fora do SET (FLW-AUT-005).
 *   Desativação disciplinar no UI durava só até a próxima folha enquanto o
 *   default `?? 1` ia no ON CONFLICT;
 * - **não apaga contato**: `email`/`email_pessoal` vazios no payload viram
 *   `sql\`email\`` / `sql\`email_pessoal\``, isto é, mantêm o valor atual. A
 *   fonte externa costuma vir sem e-mail, e o e-mail pessoal foi cadastrado
 *   pelo próprio policial — o sync não é dono desse dado.
 *
 * Já `email_pessoal_verificado` é zerado quando um e-mail pessoal novo chega:
 * endereço trocado volta a exigir confirmação por código.
 *
 * - **não desfaz a designação escolhida na TELA** (0089): quando
 *   `designacao_origem = 'sistema'`, o `CASE` no `SET` mantém o valor gravado e
 *   a carga só relata a divergência. É a mesma régua de
 *   `unidade_responsaveis.origem`, e pelo mesmo motivo: a correção que o Admin
 *   Geral fez à mão não pode ser desfeita em silêncio pela próxima folha.
 *
 * `papel`/`papel_unidade_id` são gravados COMO RECEBIDOS. Preservá-los é
 * responsabilidade do chamador — o webhook lê o valor atual com
 * `buscarPolicialPorMatricula` antes de chamar (M-4), senão um SYNC_TOKEN
 * vazado promoveria qualquer matrícula a admin.
 */
export async function upsertPolicial(db: Database, data: DadosPolicial, env?: CpfCriptoEnv) {
	const { daFolha, nova } = await colunasDoPolicial(data, env);

	return db
		.insert(policiais)
		.values(nova)
		.onConflictDoUpdate({
			target: policiais.matricula,
			set: {
				...daFolha,
				// Nome de coluna sem qualificação dentro do DO UPDATE SET = o valor
				// JÁ GRAVADO na linha, como nos `sql\`email\`` abaixo.
				...(data.designacao_id !== undefined
					? {
							designacao_id: sql`CASE WHEN designacao_origem = 'sistema' THEN designacao_id ELSE ${data.designacao_id} END`
						}
					: {}),
				email: data.email ? data.email : sql`email`,
				email_pessoal: data.email_pessoal ? data.email_pessoal : sql`email_pessoal`,
				email_pessoal_verificado: data.email_pessoal ? 0 : sql`email_pessoal_verificado`,
				updated_at: sql`datetime('now', '-3 hours')`
			}
		});
}

/**
 * Atualização parcial: só os campos presentes em `data` entram no SET —
 * `undefined` significa "não mexe", e `null` significa "limpa". Por isso o
 * `if (x !== undefined)` repetido em vez de espalhar o objeto.
 *
 * Trocar `cpf` regrava também o `cpf_index`: os dois têm de andar juntos, ou o
 * lookup pelo índice cego deixa de encontrar o registro.
 *
 * Também é o caminho da INATIVAÇÃO (`{ ativo: 0 }`) e da transferência de
 * lotação — não existe delete nesses fluxos, o histórico de escalas continua
 * apontando para o policial.
 */
export async function atualizarPolicial(
	db: Database,
	id: number,
	data: CamposDoPolicial,
	env?: CpfCriptoEnv
) {
	return db
		.update(policiais)
		.set(await camposDeAtualizacao(data, env))
		.where(eq(policiais.id, id));
}

/** Os campos que uma atualização de policial aceita. */
export type CamposDoPolicial = Partial<{
	nome: string;
	matricula: string;
	cargo: string;
	cpf: string | null;
	telefone: string;
	lotacao: string;
	ativo: number;
	regime: string;
	classe: string;
	papel: 'admin_seccional' | 'admin_unidade' | null;
	papel_unidade_id: number | null;
	email: string | null;
	email_pessoal: string | null;
	email_pessoal_verificado: number;
	/** A função exercida; `null` limpa. Ver `designacao_origem`. */
	designacao_id: number | null;
	/** Quem passou a mandar nela — a tela grava `'sistema'` (0089). */
	designacao_origem: 'planilha' | 'sistema';
}>;

/**
 * Os campos prontos para o `SET`, com a cifragem do CPF já resolvida.
 *
 * Existe separada de `atualizarPolicial` porque a cifragem é ASSÍNCRONA e um
 * `db.batch` precisa de query builders PRONTOS. `await atualizarPolicial(...)`
 * não serve para compor: o builder do drizzle é thenable, então o `await` o
 * EXECUTA — que é justamente o que a mudança cadastral atômica não pode fazer
 * (FLW-RBAC-005). Quem precisa do par cadastro+histórico usa
 * `atualizarPolicialComHistorico`.
 */
export async function camposDeAtualizacao(
	data: CamposDoPolicial,
	env?: CpfCriptoEnv
): Promise<Record<string, unknown>> {
	const updateData: Record<string, unknown> = {};

	if (data.nome !== undefined) updateData.nome = data.nome;
	if (data.matricula !== undefined) updateData.matricula = limparMatricula(data.matricula);
	if (data.cargo !== undefined) updateData.cargo = data.cargo;
	if (data.cpf !== undefined) {
		const prep = await prepararCpfParaDB(data.cpf, env);
		updateData.cpf = prep.cpf;
		updateData.cpf_index = prep.cpf_index;
	}
	if (data.telefone !== undefined) updateData.telefone = data.telefone;
	if (data.lotacao !== undefined) updateData.lotacao = data.lotacao;
	if (data.ativo !== undefined) updateData.ativo = data.ativo;
	if (data.regime !== undefined) updateData.regime = data.regime;
	if (data.classe !== undefined) updateData.classe = data.classe;
	if (data.papel !== undefined) updateData.papel = data.papel;
	if (data.papel_unidade_id !== undefined) updateData.papel_unidade_id = data.papel_unidade_id;
	if (data.email !== undefined) updateData.email = data.email;
	if (data.email_pessoal !== undefined) updateData.email_pessoal = data.email_pessoal;
	if (data.email_pessoal_verificado !== undefined) {
		updateData.email_pessoal_verificado = data.email_pessoal_verificado;
	}
	if (data.designacao_id !== undefined) updateData.designacao_id = data.designacao_id;
	if (data.designacao_origem !== undefined) {
		updateData.designacao_origem = data.designacao_origem;
	}

	updateData.updated_at = sql`datetime('now', '-3 hours')`;

	return updateData;
}

/**
 * DELETE físico. Não faz verificação de escopo nem limpeza de dependentes: o
 * chamador é quem confere a permissão, chama `desvincularAdminGeral` (para não
 * deixar login admin órfão) e grava a auditoria. Para "desligar" um policial
 * preservando o histórico, use `atualizarPolicial(db, id, { ativo: 0 })`.
 */
export async function excluirPolicial(db: Database, id: number) {
	return db.delete(policiais).where(eq(policiais.id, id));
}

/**
 * Nomes de todas as unidades, em ordem alfabética — as opções válidas de
 * lotação. `policiais.lotacao` guarda o NOME, não o id, então esta lista é o
 * domínio do campo: renomear uma unidade sem migrar os policiais os deixa
 * "sem lotação" na prática.
 */
export async function listarLotacoes(db: Database): Promise<string[]> {
	const result = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.orderBy(asc(unidades.nome));
	return result.map((r) => r.nome);
}

/**
 * Concede, troca ou revoga papel administrativo — `papel = null` revoga.
 *
 * É a única escrita cujo efeito é puramente de PERMISSÃO: o par gravado aqui é
 * lido a cada requisição para montar o escopo do admin. `papel_unidade_id`
 * define o alcance (a seccional ou a unidade em que o papel vale) e precisa
 * acompanhar o papel; passar um sem o outro deixa o escopo inconsistente.
 */
export async function promoverPolicial(
	db: Database,
	policialId: number,
	papel: 'admin_seccional' | 'admin_unidade' | null,
	papelUnidadeId: number | null
) {
	return db
		.update(policiais)
		.set({
			papel: papel ?? null,
			papel_unidade_id: papelUnidadeId ?? null,
			updated_at: sql`datetime('now', '-3 hours')`
		})
		.where(eq(policiais.id, policialId));
}
