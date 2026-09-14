/**
 * Schema Drizzle de TODAS as tabelas do D1 — fonte única de tipos do servidor.
 * Os `$inferSelect`/`$inferInsert` do fim do arquivo são o que o resto do
 * código importa; `lib/db/` nunca redeclara a forma de uma linha.
 *
 * ESTE ARQUIVO NÃO CRIA TABELA. Editar aqui só muda o TIPO — o banco continua
 * como estava até alguém escrever o `.sql` correspondente em `migrations/` e
 * rodar `npm run db:migrate` (o runner é `scripts/migrate.ts`, com controle em
 * `_migrations_aplicadas`). Uma coluna que existe aqui e não na migração
 * compila, passa no `check` e só falha em runtime, no primeiro SELECT.
 *
 * As migrações hoje são ESCRITAS À MÃO. O `drizzle.config.ts` ainda aponta para
 * cá e as 12 primeiras saíram do `drizzle-kit`, mas não há script de `generate`
 * e o journal dele foi removido em jul/2026 — quem decide o que já rodou é
 * `_migrations_aplicadas`. O motivo é o SQLite do D1: quase todo ALTER de
 * verdade é um rebuild de tabela (criar nova, copiar, dropar, renomear), que o
 * gerador não produz. Numerar em sequência (`00NN_descrição.sql`) é obrigatório
 * — o runner ordena por nome de arquivo.
 *
 * A maior parte das colunas `*_id` NÃO tem FK declarada, e isso é deliberado em
 * dois casos: referência polimórfica (o mesmo `*_id` aponta para tabelas
 * diferentes conforme o tipo) e preservação de prova — assinatura, presença e
 * auditoria copiam nome/CPF/matrícula para a própria linha justamente para
 * continuarem válidas depois que o cadastro do policial some. Um CASCADE ali
 * apagaria a evidência.
 */
import {
	sqliteTable,
	text,
	integer,
	real,
	index,
	uniqueIndex,
	unique,
	primaryKey
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { TIPO_UNIDADE_VALORES } from '$lib/unidades/tipos';
import { TIPOS_PLANTAO } from '$lib/unidades/plantao';

// ---- Policiais ----

export const policiais = sqliteTable(
	'policiais',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		nome: text('nome').notNull(),
		matricula: text('matricula').notNull().unique(),
		cargo: text('cargo', { enum: ['DPC', 'OIP'] }).notNull(),
		cpf: text('cpf'),
		telefone: text('telefone'),
		lotacao: text('lotacao').notNull(),
		ativo: integer('ativo').notNull().default(1),
		regime: text('regime', { enum: ['plantao', 'expediente'] })
			.notNull()
			.default('plantao'),
		classe: text('classe').notNull().default(''),
		senha: text('senha').notNull(),
		email: text('email'),
		email_pessoal: text('email_pessoal'),
		email_pessoal_verificado: integer('email_pessoal_verificado').notNull().default(0),
		primeiro_acesso: integer('primeiro_acesso').notNull().default(1),
		// RBAC operacional (cumulativo com Admin Geral, que é a linha vinculada em
		// `administradores`): papel scoped do servidor.
		papel: text('papel', { enum: ['admin_seccional', 'admin_unidade'] }),
		// Unidade/Seccional sob responsabilidade do papel (FK a unidades.id)
		papel_unidade_id: integer('papel_unidade_id'),
		// Achado LGPD: `cpf` guarda o CPF cifrado (AES-GCM, `enc:v1:...`); este é
		// o índice cego HMAC para lookup (login por certificado) sem decifrar.
		cpf_index: text('cpf_index'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_policiais_lotacao').on(table.lotacao),
		index('idx_policiais_cargo').on(table.cargo),
		index('idx_policiais_ativo').on(table.ativo),
		index('idx_policiais_cpf_index').on(table.cpf_index)
	]
);

// ---- Escalas ----

export const escalas = sqliteTable(
	'escalas',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		titulo: text('titulo').notNull(),
		cidade: text('cidade').notNull(),
		data_inicio: text('data_inicio').notNull(),
		data_fim: text('data_fim').notNull(),
		horario: text('horario').notNull().default('08H A 08H'),
		hora_entrada: text('hora_entrada').notNull().default('08'),
		hora_saida: text('hora_saida').notNull().default('08'),
		lotacao: text('lotacao').notNull().default(''),
		tipo: text('tipo', { enum: ['plantao', 'expediente', 'fds'] }),
		visto_por_admin: integer('visto_por_admin').notNull().default(0),
		finalizada_em: text('finalizada_em'),
		email_envio: text('email_envio'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_escalas_lotacao').on(table.lotacao),
		index('idx_escalas_created_at').on(table.created_at),
		index('idx_escalas_data_inicio').on(table.data_inicio),
		index('idx_escalas_tipo').on(table.tipo),
		index('idx_escalas_lotacao_tipo_data').on(table.lotacao, table.tipo, table.data_inicio),
		// A tranca da duplicata MENSAL é o UNIQUE — a consulta prévia
		// (`verificarEscalaExistente`) não fecha a corrida (0063 / SEC-34).
		// Índice de EXPRESSÃO porque a regra colide por MÊS, não por data exata;
		// PARCIAL porque FDS colide por sobreposição de intervalo, que unique não
		// expressa em SQLite. Sem esta linha, a violação chega às actions como
		// 500 com SQL cru em vez de 409 — foi o que o SEC-37 corrigiu no plantão.
		uniqueIndex('uq_escalas_mensal')
			.on(table.lotacao, table.tipo, sql`substr(${table.data_inicio}, 1, 7)`)
			.where(sql`${table.tipo} IN ('plantao', 'expediente')`)
	]
);

// ---- Escala Policiais ----

export const escalaPoliciais = sqliteTable(
	'escala_policiais',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		escala_id: integer('escala_id')
			.notNull()
			.references(() => escalas.id, { onDelete: 'cascade' }),
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		data_plantao: text('data_plantao').notNull(),
		data_saida: text('data_saida').notNull().default(''),
		horario: text('horario').notNull().default(''),
		hora_entrada: text('hora_entrada').notNull().default(''),
		hora_saida: text('hora_saida').notNull().default(''),
		observacoes: text('observacoes').notNull().default(''),
		equipe: text('equipe').notNull().default('')
	},
	(table) => [
		index('idx_escala_policiais_escala').on(table.escala_id),
		index('idx_escala_policiais_policial').on(table.policial_id),
		index('idx_escala_policiais_escala_policial').on(table.escala_id, table.policial_id),
		// Conflito de plantão filtra por (policial, data) — ver migration 0030
		index('idx_escala_policiais_policial_data').on(table.policial_id, table.data_plantao),
		// A tranca é o UNIQUE — a consulta prévia não fecha a corrida (0047 / FLW-ESC-005).
		uniqueIndex('uq_escala_policiais_dia').on(
			table.escala_id,
			table.policial_id,
			table.data_plantao
		)
	]
);

// ---- Administradores ----

export const administradores = sqliteTable('administradores', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	login: text('login').notNull().unique(),
	senha: text('senha').notNull(),
	nome: text('nome').notNull(),
	email: text('email'),
	email_pessoal: text('email_pessoal'),
	email_pessoal_verificado: integer('email_pessoal_verificado').notNull().default(0),
	primeiro_acesso: integer('primeiro_acesso').notNull().default(1),
	// Admin Geral VINCULADO: quando preenchido, esta conta admin não tem senha
	// própria — o login autentica contra as credenciais do policial vinculado
	// (mesma senha/e-mail/2FA). Nulo = admin standalone (bootstrap por env).
	policial_id: integer('policial_id'),
	/**
	 * Consoles liberados nesta conta. Independentes: dá para liberar só Escalas,
	 * só GISE, ou os dois. O cookie `admin_modulo` é preferência DENTRO do que
	 * estas flags permitem (migração 0065). Default 1 = comportamento legado.
	 */
	modulo_escalas: integer('modulo_escalas').notNull().default(1),
	modulo_gise: integer('modulo_gise').notNull().default(1),
	created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
});

/**
 * A terceira identidade (migração 0082): servidora administrativa ou
 * colaboradora terceirizada. Não é policial (não entra em escala nem em
 * efetivo) nem admin (não ganha Admin Geral): tipo de sessão próprio, que
 * FALHA FECHADO nos ~160 pontos que perguntam `tipo === 'admin'`. O acesso é só
 * o que a designação (módulo de diárias) conceder.
 *
 * `email` é o identificador de login e o canal do 2FA — por isso único. CPF
 * cifrado em repouso e índice cego, como em `policiais`.
 */
export const colaboradores = sqliteTable(
	'colaboradores',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		nome: text('nome').notNull(),
		email: text('email').notNull().unique(),
		senha: text('senha').notNull(),
		cpf: text('cpf'),
		cpf_index: text('cpf_index'),
		/** Empresa ou contrato — a quem a conta pertence, para saber quando revogar. */
		vinculo: text('vinculo').notNull().default(''),
		primeiro_acesso: integer('primeiro_acesso').notNull().default(1),
		ativo: integer('ativo').notNull().default(1),
		/** Quem criou (Super Admin, decisão 23), em snapshot. */
		criado_por_id: integer('criado_por_id'),
		criado_por_nome: text('criado_por_nome').notNull().default(''),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [index('idx_colaboradores_cpf_index').on(table.cpf_index)]
);

// ---- Sessoes ----

export const sessoes = sqliteTable(
	'sessoes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		token: text('token').notNull().unique(),
		/**
		 * `colaborador` é a terceira identidade (migração 0082). A coluna não tem
		 * CHECK — o vocabulário é só TypeScript. Quem valida sessão decide POR
		 * TIPO e recusa o que não conhece (`$lib/auth`); nunca "o que não é admin
		 * é policial", porque `usuario_id` de tabelas diferentes colidem.
		 */
		tipo: text('tipo', { enum: ['policial', 'admin', 'colaborador'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`),
		expires_at: text('expires_at').notNull()
	},
	(table) => [
		index('idx_sessoes_token').on(table.token),
		index('idx_sessoes_expires').on(table.expires_at)
	]
);

// ---- Unidades ----

export const unidades = sqliteTable(
	'unidades',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		nome: text('nome').notNull().unique(),
		/**
		 * Tipo no organograma — os valores vêm do catálogo `$lib/unidades/tipos`
		 * (fase 1 do Ecossistema, decisão E23). Sem CHECK no banco desde a 0004;
		 * a régua é o Zod de `/unidades` e o catálogo.
		 */
		tipo: text('tipo', { enum: TIPO_UNIDADE_VALORES }).notNull().default('delegacia'),
		/**
		 * ID da unidade PAI na árvore — o nome é histórico (nasceu apontando a
		 * seccional da delegacia) e ficou porque renomear exigiria reconstruir a
		 * tabela e reescrever toda referência sem ganho de comportamento. Vale
		 * para qualquer nível: departamento → seccional, departamento →
		 * delegacia (especializados), coordenadoria → célula, etc. Quem precisa de
		 * "está abaixo de" usa `ancestraisDe`/`departamentoDe` em `$lib/db/unidades`.
		 */
		seccional_id: integer('seccional_id'),
		/**
		 * Alcance de quem administra a unidade (migração 0084, decisão E26):
		 * `departamental` = a própria subárvore; `corporativa` = a corporação
		 * inteira, para os órgãos de direção e instrumentais (Gabinete, DPGI,
		 * COGEP, Logística, DTO, Corregedoria, CTIC), que são irmãos dos
		 * departamentos e não ancestrais deles. O que cada órgão pode FAZER além
		 * de ver é regra do módulo, não desta coluna.
		 */
		abrangencia: text('abrangencia', { enum: ['departamental', 'corporativa'] })
			.notNull()
			.default('departamental'),
		cidade: text('cidade').notNull().default(''),
		/**
		 * Forma curta ("DPI SUL"), atributo de departamento e subdepartamento;
		 * seccional e delegacia ficam com '' (migração 0076). Documento assinado
		 * usa o `nome` por extenso; a sigla é para indexador e interface.
		 */
		sigla: text('sigla').notNull().default(''),
		tem_plantao: integer('tem_plantao', { mode: 'boolean' }).default(false).notNull(),
		tem_expediente: integer('tem_expediente', { mode: 'boolean' }).default(false).notNull(),
		tem_fds: integer('tem_fds', { mode: 'boolean' }).default(false).notNull(),
		// ---- A ficha (fase 2, migração 0085; decisão E39 item 3.1) ----
		endereco: text('endereco').notNull().default(''),
		telefone: text('telefone').notNull().default(''),
		email: text('email').notNull().default(''),
		/** Link de origem da foto (Google Drive, da planilha). A ficha prefere `foto_key`. */
		foto_url: text('foto_url'),
		/** Cópia da foto no R2 (`unidades/{id}/foto.jpg`), feita pela importação quando o link abre. */
		foto_key: text('foto_key'),
		/** A AIS da UNIDADE (uma só). A de cada município atendido está em `municipios_cobertura`. */
		ais: text('ais').notNull().default(''),
		tira_gravame: integer('tira_gravame', { mode: 'boolean' }).default(false).notNull(),
		xadrezes: integer('xadrezes').notNull().default(0),
		/**
		 * Unidade DESATIVADA (`ativo = 0`) sai das listas de escolha, mas continua
		 * existindo: escala, lotação e assinatura de relatório antigas seguem
		 * resolvendo o nome e o id.
		 *
		 * Não existe exclusão de unidade — de propósito. `gise_assinaturas_relatorios`
		 * referencia `unidades(id)` e apagar a linha destruiria prova de documento
		 * assinado. Desativar é a operação segura equivalente.
		 */
		ativo: integer('ativo', { mode: 'boolean' }).default(true).notNull(),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_unidades_nome').on(table.nome),
		index('idx_unidades_ativo').on(table.ativo)
	]
);

// ---- Documentos de Escalas (R2) ----

/**
 * As mesmas 19 colunas de minimização LGPD + dossiê CAdES-LT/WebAuthn nas
 * quatro tabelas de documento assinado (escala, GISE, relatório de
 * seccional, termo de presença) — equivalente de schema do que
 * `montarCamposMinimizados` (lib/db/documentos.ts) já unificou do lado JS.
 *
 * FÁBRICA, não objeto: reusar a MESMA instância de column builder em duas
 * `sqliteTable()` é o erro clássico do Drizzle — o builder é finalizado na
 * primeira tabela que o consome, e a segunda tabela herda metadado da
 * primeira. Cada chamada aqui devolve builders novos.
 *
 * CAdES-LT (migração 0012): nullable para compatibilidade com registros
 * antigos — assinatura simples não preenche.
 *
 * WebAuthn (migração 0058 na escala, 0060 nas três de GISE): guardado para
 * RECONFERÊNCIA — o manifesto afirma que a chave verificada por biometria
 * assinou, e a afirmação precisa de contraparte reverificável.
 * `webauthn_backup_ativo` é o estado do flag BS NAQUELE momento; a
 * credencial pode passar a ser sincronizada depois.
 */
function camposMinimizadosDocumento() {
	return {
		ip_address: text('ip_address'),
		user_agent: text('user_agent'),
		/** User-Agent BRUTO (não-parseado) — preservado para perícia forense. */
		user_agent_raw: text('user_agent_raw'),
		latitude: real('latitude'),
		longitude: real('longitude'),
		tipo_carimbo_tempo: text('tipo_carimbo_tempo').default('servidor'),
		cert_issuer: text('cert_issuer'),
		cert_serial: text('cert_serial'),
		cert_valido_de: text('cert_valido_de'),
		cert_valido_ate: text('cert_valido_ate'),
		cms_sha256: text('cms_sha256'),
		ocsp_response_b64: text('ocsp_response_b64'),
		ocsp_consultado_em: text('ocsp_consultado_em'),
		tst_token_b64: text('tst_token_b64'),
		webauthn_credential_id: text('webauthn_credential_id'),
		webauthn_client_data: text('webauthn_client_data'),
		webauthn_authenticator_data: text('webauthn_authenticator_data'),
		webauthn_assinatura: text('webauthn_assinatura'),
		webauthn_backup_ativo: integer('webauthn_backup_ativo')
	};
}

export const escalaDocumentos = sqliteTable('escala_documentos', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	escala_id: integer('escala_id')
		.notNull()
		.unique()
		.references(() => escalas.id, { onDelete: 'cascade' }),
	r2_key: text('r2_key').notNull(),
	assinante_nome: text('assinante_nome').notNull(),
	assinante_cpf: text('assinante_cpf'),
	assinante_email: text('assinante_email'),
	verificacao_hash: text('verificacao_hash').unique(),
	selfie_key: text('selfie_key'),
	arquivo_hash: text('arquivo_hash'),
	...camposMinimizadosDocumento(),
	created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
});

// ---- Solicitações de Assinatura de Escalas ----

export const escalaSolicitacoesAssinatura = sqliteTable(
	'escala_solicitacoes_assinatura',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		escala_id: integer('escala_id')
			.notNull()
			.unique()
			.references(() => escalas.id, { onDelete: 'cascade' }),
		// onDelete: cascade — solicitação não faz sentido sem solicitante.
		solicitante_id: integer('solicitante_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		tipo: text('tipo', { enum: ['unidade', 'respondencia'] }).notNull(),
		// onDelete: set null — solicitação sobrevive mesmo se destinatário sumir;
		// a coluna é nullable, então preserva o histórico do solicitante.
		destinatario_id: integer('destinatario_id').references(() => policiais.id, {
			onDelete: 'set null'
		}),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_esa_escala_id').on(table.escala_id),
		index('idx_esa_destinatario_id').on(table.destinatario_id)
	]
);

// ---- Operações extraordinárias ----

/**
 * As operações que existem: GISE, OPERAÇÃO CRAJUBAR, EDGE… Cada escala extra
 * pertence a uma, e cada operação tem os SEUS formulários de produtividade.
 *
 * Não há exclusão — só `ativo = 0`, pela mesma razão de `unidades.ativo`:
 * escala histórica e PDF assinado continuam apontando para a operação que os
 * originou.
 */
export const operacoes = sqliteTable(
	'operacoes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		nome: text('nome').notNull().unique(),
		/** Rótulo curto para chip de filtro e selo de card ('CRAJUBAR'). */
		sigla: text('sigla').notNull().default(''),
		descricao: text('descricao').notNull().default(''),
		/**
		 * Quais tipos de equipe a operação usa. A EDGE pode ser só operacional ou
		 * só de inteligência; a combinação (false, false) não é impedida pelo banco
		 * mas é recusada na aplicação — operação sem tipo de equipe não escala
		 * ninguém e não teria formulário nenhum.
		 */
		usa_equipe_operacional: integer('usa_equipe_operacional', { mode: 'boolean' })
			.notNull()
			.default(true),
		usa_equipe_seint: integer('usa_equipe_seint', { mode: 'boolean' }).notNull().default(true),
		/** Ciclo operacional (a CRAJUBAR prevê 90 dias). Nulos na GISE, permanente. */
		data_inicio: text('data_inicio'),
		data_fim: text('data_fim'),
		/**
		 * Configuração de escala DESTA operação (migração 0051): vagas padrão das
		 * equipes, horários e os textos do breve relatório dos PDFs de extra.
		 *
		 * **NULL = herda o padrão do sistema** (`configuracoes` → constante do
		 * código). Não é o mesmo que zero nem que string vazia: 0 vaga de DPC é uma
		 * escolha legítima, e "" é um texto deliberadamente em branco. Só o NULL
		 * significa "não decidi, use o de cima".
		 *
		 * Eram globais até aqui, o que fazia sentido com uma operação só. Uma
		 * força-tarefa monta equipe de outro tamanho e o texto que vai no PDF fala
		 * do serviço dela.
		 */
		vagas_operacional_dpc: integer('vagas_operacional_dpc'),
		vagas_operacional_oip: integer('vagas_operacional_oip'),
		vagas_seint_dpc: integer('vagas_seint_dpc'),
		vagas_seint_oip: integer('vagas_seint_oip'),
		hora_entrada_padrao: text('hora_entrada_padrao'),
		hora_saida_padrao: text('hora_saida_padrao'),
		breve_relatorio_titulo: text('breve_relatorio_titulo'),
		breve_relatorio_texto_seccional: text('breve_relatorio_texto_seccional'),
		breve_relatorio_texto_supervisao: text('breve_relatorio_texto_supervisao'),
		ativo: integer('ativo', { mode: 'boolean' }).notNull().default(true),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [index('idx_operacoes_ativo').on(table.ativo)]
);

/**
 * Linha de base de um indicador: o valor inicial contra o qual a meta é medida.
 *
 * "Redução mínima de 20% do acervo de inquéritos pendentes" precisa de um
 * denominador que só a delegacia tem. O próprio Plano Operacional da CRAJUBAR
 * lista a falta dele como risco ("ausência de linha de base consolidada").
 *
 * Um valor por (operação, unidade, indicador) — parâmetro FIXO do ciclo, não
 * série temporal. O realizado vem das respostas de produtividade, que já são
 * datadas.
 */
export const operacaoLinhaBase = sqliteTable(
	'operacao_linha_base',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		operacao_id: integer('operacao_id')
			.notNull()
			.references(() => operacoes.id, { onDelete: 'cascade' }),
		// onDelete: restrict — mesma razão de `gise_assinaturas_relatorios`: o valor
		// é parâmetro de um resultado divulgado, e a aplicação nem exclui unidade.
		unidade_id: integer('unidade_id')
			.notNull()
			.references(() => unidades.id, { onDelete: 'restrict' }),
		/**
		 * `pergunta.key` do modelo — gerada na criação e não editável na UI, que é o
		 * que torna a referência estável. É a chave da PERGUNTA, não a da resposta:
		 * nos tipos de lista a resposta mora em `${key}__qtd`, e a tradução é de
		 * `chavesLista()` em `$lib/gise/tipos-pergunta`.
		 */
		indicador_key: text('indicador_key').notNull(),
		/** real, não integer: "tempo médio de conclusão" é medido em dias com decimal. */
		valor: real('valor').notNull(),
		observacao: text('observacao').notNull().default(''),
		informado_por_id: integer('informado_por_id'),
		/** Copiado para a linha: precisa continuar dizendo quem informou depois que
		 *  o cadastro do policial mudar ou sair. */
		informado_por_nome: text('informado_por_nome').notNull().default(''),
		/** 'aba' = /operacoes/dados-base; 'formulario' = capturado no relatório de produtividade. */
		origem: text('origem', { enum: ['aba', 'formulario'] })
			.notNull()
			.default('aba'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		uniqueIndex('uq_operacao_linha_base').on(
			table.operacao_id,
			table.unidade_id,
			table.indicador_key
		),
		index('idx_operacao_linha_base_operacao').on(table.operacao_id)
	]
);

// ---- GISE ----

export const giseEscalas = sqliteTable(
	'gise_escalas',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/**
		 * A operação desta escala (migração 0048).
		 *
		 * Nullable pelo mesmo motivo de `gise_membros.gise_id`: a coluna nasceu
		 * depois das linhas. Não é segunda fonte de verdade — a aplicação a
		 * preenche no INSERT e escala não muda de operação. Linha sem valor é
		 * tratada como GISE, a operação que existia antes de haver operações.
		 */
		operacao_id: integer('operacao_id'),
		data_inicio: text('data_inicio').notNull(),
		feriado: integer('feriado').notNull().default(0),
		hora_entrada: text('hora_entrada').notNull().default('08:00'),
		hora_saida: text('hora_saida').notNull().default('16:00'),
		status: text('status', {
			enum: [
				'em_definicao_supervisor',
				'em_preenchimento',
				'aguardando_assinatura',
				'em_andamento',
				'aguardando_relatorios',
				'aguardando_assinatura_relat',
				'pronta_para_finalizar',
				'finalizada'
			]
		})
			.notNull()
			.default('em_definicao_supervisor'),
		supervisor_id: integer('supervisor_id'),
		assessor_id: integer('assessor_id'),
		seint1_id: integer('seint1_id'),
		seint2_id: integer('seint2_id'),
		/** E-mail pessoal (ou sobrescrito) do assessor para avisos de envio das seccionais na GISE. */
		assessor_email_notificacao: text('assessor_email_notificacao'),
		/** Rótulo do bloco "Breve relatório" nos PDFs de extra; null = padrão global. */
		breve_relatorio_titulo: text('breve_relatorio_titulo'),
		/** Texto do quadro no relatório de extra por seccional; null = padrão global. */
		breve_relatorio_texto_seccional: text('breve_relatorio_texto_seccional'),
		/** Texto do quadro no relatório de extra do quadro de supervisão; null = padrão global. */
		breve_relatorio_texto_supervisao: text('breve_relatorio_texto_supervisao'),
		/** ISO 8601: último envio com sucesso dos dados desta GISE para a planilha Base_Equipe. */
		planilha_base_equipe_alimentada_em: text('planilha_base_equipe_alimentada_em'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_gise_escalas_status').on(table.status),
		index('idx_gise_escalas_supervisor').on(table.supervisor_id),
		index('idx_gise_escalas_assessor').on(table.assessor_id),
		index('idx_gise_escalas_seint1').on(table.seint1_id),
		index('idx_gise_escalas_seint2').on(table.seint2_id),
		index('idx_gise_escalas_operacao').on(table.operacao_id)
	]
);

export const giseSeccionais = sqliteTable(
	'gise_seccionais',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		// onDelete: restrict — bloqueia remoção de unidades que têm GISE histórico
		// vinculado. Garante integridade de auditoria; admin deve apagar GISE antes.
		seccional_id: integer('seccional_id')
			.notNull()
			.references(() => unidades.id, { onDelete: 'restrict' }),
		unidade_operacional_id: integer('unidade_operacional_id'),
		status: text('status', {
			enum: ['pendente', 'preenchida', 'retificada', 'preenchida_retificada']
		})
			.notNull()
			.default('pendente'),
		hora_entrada: text('hora_entrada'),
		hora_saida: text('hora_saida')
	},
	(table) => [
		index('idx_gise_seccionais_gise').on(table.gise_id),
		index('idx_gise_seccionais_seccional').on(table.seccional_id),
		index('idx_gise_seccionais_gise_status').on(table.gise_id, table.status),
		unique('uq_gise_seccional').on(table.gise_id, table.seccional_id)
	]
);

export const giseEquipes = sqliteTable(
	'gise_equipes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_seccional_id: integer('gise_seccional_id')
			.notNull()
			.references(() => giseSeccionais.id, { onDelete: 'cascade' }),
		// Slot de unidade ao qual esta equipe pertence (null = legado, de antes deste campo existir)
		gise_unidade_id: integer('gise_unidade_id'),
		tipo: text('tipo', { enum: ['operacional', 'seint'] }).notNull(),
		slots_dpc: integer('slots_dpc').notNull().default(0),
		slots_oip: integer('slots_oip').notNull().default(0),
		hora_entrada: text('hora_entrada'),
		hora_saida: text('hora_saida')
	},
	(table) => [
		index('idx_gise_equipes_sec').on(table.gise_seccional_id),
		index('idx_gise_equipes_unidade').on(table.gise_unidade_id)
	]
);

export const giseMembros = sqliteTable(
	'gise_membros',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		equipe_id: integer('equipe_id')
			.notNull()
			.references(() => giseEquipes.id, { onDelete: 'cascade' }),
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		/**
		 * Denormalizado para o índice único de exclusividade (FLW-GISE-009) — o
		 * SQLite não indexa através de join, e a regra é "um policial por GISE".
		 *
		 * Não é segunda fonte de verdade: sai derivado da própria equipe no INSERT
		 * (`adicionarGiseMembro`), e equipe não muda de GISE. Nullable só por causa
		 * das linhas anteriores à migração 0044.
		 */
		gise_id: integer('gise_id')
	},
	(table) => [
		index('idx_gise_membros_equipe').on(table.equipe_id),
		index('idx_gise_membros_policial').on(table.policial_id),
		uniqueIndex('uq_gise_membros_gise_policial').on(table.gise_id, table.policial_id)
	]
);

export const giseSeccionalUnidades = sqliteTable(
	'gise_seccional_unidades',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_seccional_id: integer('gise_seccional_id')
			.notNull()
			.references(() => giseSeccionais.id, { onDelete: 'cascade' }),
		// Nullable: slot criado pelo Adm Geral sem unidade pré-definida (Adm Seccional preenche depois)
		unidade_id: integer('unidade_id').references(() => unidades.id, { onDelete: 'set null' })
	},
	(table) => [index('idx_gise_sec_unidades').on(table.gise_seccional_id)]
);

export const giseDocumentos = sqliteTable(
	'gise_documentos',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		r2_key: text('r2_key').notNull(),
		assinante_id: integer('assinante_id'),
		assinante_nome: text('assinante_nome').notNull().default(''),
		assinante_cpf: text('assinante_cpf').notNull().default(''),
		assinante_email: text('assinante_email'),
		verificacao_hash: text('verificacao_hash').unique(),
		selfie_key: text('selfie_key'),
		arquivo_hash: text('arquivo_hash'),
		...camposMinimizadosDocumento(),
		created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [unique('uq_gise_documento').on(table.gise_id)]
);

// ---- Resultados GISE ----

export const giseModeloFormulario = sqliteTable(
	'gise_modelo_formulario',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/**
		 * A operação dona deste modelo (migração 0048). Sem ela, editar o
		 * formulário da CRAJUBAR reescreveria o do GISE.
		 *
		 * Nullable pelo mesmo motivo de `gise_escalas.operacao_id` — a coluna nasceu
		 * depois das linhas, e o backfill da 0048 as atribuiu ao GISE.
		 */
		operacao_id: integer('operacao_id'),
		tipo: text('tipo').notNull().default('operacional'),
		config: text('config').notNull().default('[]'),
		/** Versão anterior do `config` — um nível de desfazer para o editor do
		 *  Admin Geral ("Restaurar anterior"). `null` enquanto só houve a
		 *  primeira gravação. Ver migração 0039. */
		config_anterior: text('config_anterior'),
		/**
		 * A ordem dos cards no painel de `/operacoes/produtividade`, como o Admin Geral os
		 * arrastou — array JSON de ids de card (migração 0064).
		 *
		 * **NULL = ordem do formulário**, que é o que toda linha anterior à 0064 é.
		 * Não é a mesma coisa que `'[]'`: a lista vazia é uma escolha gravada que
		 * não nomeia card nenhum, e como TODO id ausente da lista cai no fim da
		 * seção dele, as duas dão o mesmo resultado hoje. Guardar a diferença é o
		 * que permite a tela distinguir "nunca organizado" de "organizado e depois
		 * esvaziado" sem adivinhar.
		 *
		 * Não decide quem APARECE — isso continua sendo a marca `grafico` da
		 * pergunta (0053/0054). Id de card que saiu do painel fica órfão aqui e é
		 * ignorado na leitura; ver `ordenarCardsDoPainel` em
		 * `$lib/produtividade/ordem`.
		 */
		painel_ordem: text('painel_ordem'),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	// Um modelo por (operação, tipo). Antes da 0048 não havia unicidade alguma e
	// `buscarGiseModeloFormulario` lia a PRIMEIRA linha do tipo — uma segunda
	// linha ficava invisível em vez de dar erro.
	(table) => [uniqueIndex('uq_gise_modelo_operacao_tipo').on(table.operacao_id, table.tipo)]
);

export const giseRespostasFormulario = sqliteTable(
	'gise_respostas_formulario',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		equipe_id: integer('equipe_id').references(() => giseEquipes.id, { onDelete: 'cascade' }),
		/** JSON objeto (chaves string); validar no servidor com Zod ao ler/escrever */
		respostas: text('respostas').notNull().default('{}'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		unique('uq_gise_resposta_policial').on(table.gise_id, table.policial_id),
		index('idx_gise_respostas_equipe').on(table.gise_id, table.equipe_id),
		// Busca por policial SEM fixar a GISE — o carimbo de `/api/sync/estado`.
		// O UNIQUE acima não cobre: `policial_id` não é a coluna líder dele.
		index('idx_gise_respostas_policial').on(table.policial_id)
	]
);

export const gisePresencas = sqliteTable(
	'gise_presencas',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		entrada_timestamp: text('entrada_timestamp'),
		entrada_selfie_key: text('entrada_selfie_key'),
		saida_timestamp: text('saida_timestamp'),
		saida_selfie_key: text('saida_selfie_key'),
		ip_address: text('ip_address'),
		user_agent: text('user_agent'),
		/** Graus decimais (WGS-84); usar real, não integer */
		latitude: real('latitude'),
		longitude: real('longitude'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		unique('uq_gise_presenca_policial').on(table.gise_id, table.policial_id),
		index('idx_gise_presencas_gise').on(table.gise_id),
		// Busca por policial SEM fixar a GISE — o carimbo de `/api/sync/estado`.
		// O UNIQUE acima não cobre: `policial_id` não é a coluna líder dele.
		index('idx_gise_presencas_policial').on(table.policial_id)
	]
);

export const giseAssinaturasRelatorios = sqliteTable(
	'gise_assinaturas_relatorios',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		// onDelete: restrict — o banco RECUSA apagar uma unidade que tenha
		// assinatura de relatório. Era `cascade` até a migração 0038, e apagar a
		// unidade levava junto o registro do ato de assinar (assinante, CPF,
		// selfie, IP, GPS, hash, chave do PDF no R2), fazendo o `/validar`
		// negar um documento já entregue. A aplicação nem exclui unidade mais (só
		// desativa); isto fecha o DELETE manual.
		seccional_id: integer('seccional_id')
			.notNull()
			.references(() => unidades.id, { onDelete: 'restrict' }),
		tipo: text('tipo', { enum: ['extraordinario', 'produtividade'] }).notNull(),
		assinante_id: integer('assinante_id'),
		assinante_nome: text('assinante_nome').notNull(),
		assinante_cpf: text('assinante_cpf'),
		assinante_email: text('assinante_email'),
		tipo_assinatura: text('tipo_assinatura', { enum: ['simples', 'webpki', 'serpro'] }).notNull(),
		selfie_key: text('selfie_key'),
		arquivo_hash: text('arquivo_hash'),
		verification_hash: text('verification_hash').unique(),
		r2_key: text('r2_key'),
		...camposMinimizadosDocumento(),
		created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		unique('uq_gise_ass_rel').on(table.gise_id, table.seccional_id, table.tipo),
		index('idx_gise_ass_rel_gise').on(table.gise_id)
	]
);

// ---- Termos de presença assinados por Token A3 (desktop) ----
// Presença confirmada no computador gera um PDF qualificado (CAdES-LT). Tabela
// dedicada para que /validar reconheça o termo sem afetar a detecção de
// relatório/escala assinados.
export const gisePresencaTermos = sqliteTable(
	'gise_presenca_termos',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		policial_id: integer('policial_id').notNull(),
		tipo: text('tipo', { enum: ['entrada', 'saida'] }).notNull(),
		assinante_nome: text('assinante_nome').notNull(),
		assinante_cpf: text('assinante_cpf'),
		assinante_email: text('assinante_email'),
		verification_hash: text('verification_hash').unique(),
		r2_key: text('r2_key'),
		arquivo_hash: text('arquivo_hash'),
		...camposMinimizadosDocumento(),
		created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_gise_presenca_termos_gise').on(table.gise_id),
		// Um termo por ato (FLW-GISE-008): repetir a finalização gravava outro
		// termo, com outro `verification_hash`, para a MESMA entrada — e os dois
		// resolvem em `/validar`. Dois documentos assinados atestando o mesmo ato
		// é prova que se contradiz sozinha.
		uniqueIndex('uq_gise_presenca_termos_ato').on(table.gise_id, table.policial_id, table.tipo)
	]
);

// ---- Aceites do Termo de Uso e Política de Privacidade ----

export const aceitesTermos = sqliteTable(
	'aceites_termos',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** `colaborador` desde a migração 0081, que refez o CHECK do banco. */
		usuario_tipo: text('usuario_tipo', { enum: ['policial', 'admin', 'colaborador'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		versao_termo: text('versao_termo').notNull(),
		hash_termo: text('hash_termo').notNull(),
		aceitou_lgpd: integer('aceitou_lgpd').notNull().default(0),
		aceitou_uso_email: integer('aceitou_uso_email').notNull().default(0),
		aceitou_uso_localizacao: integer('aceitou_uso_localizacao').notNull().default(0),
		aceitou_assinatura_avancada: integer('aceitou_assinatura_avancada').notNull().default(0),
		ip: text('ip'),
		user_agent: text('user_agent'),
		/**
		 * Snapshot do HTML do termo no momento do aceite — preserva o texto
		 * exato para reprodução em juízo sem depender do git history.
		 * Nullable para compat com registros pré-migração 0026.
		 */
		conteudo_html_snapshot: text('conteudo_html_snapshot'),
		aceitou_em: text('aceitou_em')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_aceites_termos_usuario').on(table.usuario_tipo, table.usuario_id, table.aceitou_em)
	]
);

// ---- Credenciais WebAuthn (passkey de assinatura) ----

/**
 * Chave pública da passkey usada na assinatura avançada.
 *
 * O dono é a PESSOA, não o par `(tipo, id)`: quem é Admin Geral vinculado tem
 * duas linhas (`policiais` + `administradores`) e precisa assinar com a mesma
 * credencial nos dois modos. `resolverCredencial` (`server/auth/credencial.ts`)
 * é quem resolve isso — gravar o par cru aqui repetiria o FLW-AUTH-002, em que
 * a senha ia para a linha que o login não lê.
 *
 * `revogado_em` em vez de DELETE: a credencial que assinou um documento precisa
 * continuar consultável para conferir aquela assinatura depois de a pessoa
 * trocar de aparelho. É registro probatório, não cadastro.
 *
 * `backup_elegivel` / `backup_ativo` vêm dos flags BE/BS do `authenticatorData`
 * e são a diferença entre "chave deste aparelho" e "chave sincronizada no
 * keychain do titular" — iOS e Android sincronizam por padrão. O manifesto
 * imprime qual dos dois foi; sem estas colunas o documento afirmaria aparelho
 * sem ter como saber.
 */
export const credenciaisWebauthn = sqliteTable(
	'credenciais_webauthn',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		usuario_tipo: text('usuario_tipo', { enum: ['policial', 'admin'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		/** `credentialId` em base64url — identificador, não segredo. */
		credential_id: text('credential_id').notNull().unique(),
		/** Chave pública em SPKI, base64. */
		public_key_spki: text('public_key_spki').notNull(),
		/** Contador de assinaturas do autenticador; 0 quando não implementado. */
		contador: integer('contador').notNull().default(0),
		/** Modelo do autenticador, em hex. NULL quando a cerimônia não trouxe. */
		aaguid: text('aaguid'),
		backup_elegivel: integer('backup_elegivel').notNull().default(0),
		backup_ativo: integer('backup_ativo').notNull().default(0),
		apelido: text('apelido'),
		criado_em: text('criado_em')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		ultimo_uso: text('ultimo_uso'),
		revogado_em: text('revogado_em')
	},
	(table) => [
		index('idx_webauthn_credential').on(table.credential_id),
		index('idx_webauthn_dono').on(table.usuario_tipo, table.usuario_id, table.revogado_em)
	]
);

/**
 * Desafio da cerimônia de REGISTRO de passkey (uso único, minutos de vida).
 *
 * Tabela própria em vez de mais um `tipo` em `dois_fatores_tokens`: aquela
 * carrega um `CHECK(tipo IN (...))` no banco (migração 0010), então aceitar um
 * tipo novo exige recriar a tabela — rebuild no caminho de autenticação para
 * hospedar um nonce de cadastro. O desafio da ASSINATURA não passa por aqui: é
 * o hash do PDF, e vive em `assinatura_intencoes`.
 */
export const webauthnDesafios = sqliteTable(
	'webauthn_desafios',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		desafio_id: text('desafio_id').notNull().unique(),
		usuario_tipo: text('usuario_tipo', { enum: ['policial', 'admin'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		/** Bytes do desafio, em base64url — o mesmo valor que o cliente devolve. */
		desafio: text('desafio').notNull(),
		usado: integer('usado').notNull().default(0),
		expires_at: text('expires_at').notNull(),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [index('idx_webauthn_desafio').on(table.desafio_id)]
);

/**
 * 2FA da reposição da chave de assinatura (migração 0061).
 *
 * Dois canais — institucional e pessoal — só quando já há chave ativa.
 * Tabela própria porque `dois_fatores_tokens` tem CHECK de `tipo` e rebuild
 * seria caro. Expurga por `expires_at` (ISO), como a intenção.
 */
export const passkeyReposicao = sqliteTable(
	'passkey_reposicao',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		desafio_id: text('desafio_id').notNull().unique(),
		usuario_tipo: text('usuario_tipo', { enum: ['policial', 'admin'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		canal: text('canal', { enum: ['institucional', 'pessoal'] }).notNull(),
		codigo_hash: text('codigo_hash').notNull(),
		expires_at: text('expires_at').notNull(),
		usado: integer('usado').notNull().default(0),
		tentativas: integer('tentativas').notNull().default(0),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_passkey_reposicao_usuario').on(table.usuario_tipo, table.usuario_id),
		index('idx_passkey_reposicao_expires').on(table.expires_at)
	]
);

// ---- Autenticação de Dois Fatores ----

export const doisFatoresTokens = sqliteTable(
	'dois_fatores_tokens',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		desafio_id: text('desafio_id').notNull().unique(),
		/** O CHECK do banco acompanha (migração 0083 acrescentou `colaborador`). */
		tipo: text('tipo', {
			enum: [
				'policial',
				'admin',
				'colaborador',
				'assinatura',
				'reset_policial',
				'reset_admin',
				'verificacao_email',
				'login_certificado'
			]
		}).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		codigo: text('codigo').notNull(),
		tentativas: integer('tentativas').notNull().default(0),
		expires_at: text('expires_at').notNull(),
		usado: integer('usado').notNull().default(0),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [index('idx_2fa_desafio').on(table.desafio_id)]
);

// ---- Tokens de Redefinição de Senha ----

export const resetSenhaTokens = sqliteTable(
	'reset_senha_tokens',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		token: text('token').notNull().unique(),
		tipo_usuario: text('tipo_usuario', { enum: ['policial', 'admin'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		expires_at: text('expires_at').notNull(),
		usado: integer('usado').notNull().default(0),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_reset_senha_token').on(table.token),
		index('idx_reset_senha_usuario').on(table.tipo_usuario, table.usuario_id, table.created_at)
	]
);

/**
 * Intenção de assinatura — amarra o PDF preparado ao RECURSO, ao ATOR e a um
 * único uso (FLW-DOC-001).
 *
 * `preparar-assinatura` devolvia o PDF ao cliente e `finalizar-assinatura`
 * aceitava de volta qualquer `preparedPdf`, gravando-o no recurso da URL. A
 * assinatura era criptograficamente válida e o CPF conferia — só o DOCUMENTO
 * podia ser outro. Preparar na escala A e finalizar na B guardava o PDF de A
 * como documento assinado de B.
 *
 * `token` guarda o `sha256:` do valor entregue ao cliente, como `sessoes` e
 * `reset_senha_tokens`.
 */
export const assinaturaIntencoes = sqliteTable(
	'assinatura_intencoes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		token: text('token').notNull().unique(),
		recurso: text('recurso', {
			enum: ['escala', 'gise', 'gise_presenca', 'gise_relatorio']
		}).notNull(),
		recurso_id: integer('recurso_id').notNull(),
		/** Segundo eixo do alvo (a seccional do relatório); NULL nos de eixo único. */
		escopo_id: integer('escopo_id'),
		usuario_id: integer('usuario_id').notNull(),
		usuario_tipo: text('usuario_tipo', { enum: ['policial', 'admin'] }).notNull(),
		/** SHA-256 do `preparedPdf` gerado pelo servidor. */
		documento_hash: text('documento_hash').notNull(),
		/** Código público de validação — decidido pelo servidor, não pelo cliente. */
		verificacao_hash: text('verificacao_hash').notNull(),
		/**
		 * Estado que o `preparar` produziu e o `finalizar` precisa, carregado
		 * por aqui e NUNCA pelo corpo da requisição.
		 *
		 * `selfie_key` aponta para um objeto do bucket: deixá-la voltar do
		 * cliente permitiria apontar o documento para a foto de outra pessoa
		 * (mesma classe do FLW-DOC-001). `latitude`/`longitude` já estão
		 * desenhadas no PDF que a passkey assinou — recebê-las de novo deixaria
		 * o banco dizer um lugar e o documento assinado dizer outro.
		 *
		 * NULL no fluxo por token e quando foto/GPS não são exigidos.
		 */
		selfie_key: text('selfie_key'),
		latitude: real('latitude'),
		longitude: real('longitude'),
		usado: integer('usado').notNull().default(0),
		expires_at: text('expires_at').notNull(),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [index('idx_assinatura_intencoes_expires').on(table.expires_at)]
);

/**
 * Janela de reautenticação por senha da assinatura avançada (migração 0059).
 *
 * Irmã da intenção e do desafio 2FA de assinatura: token opaco de 64 hex,
 * banco guarda `sha256:`, validade ~10 min, amarrada ao usuário E à sessão.
 * Não se consome no POST de assinar — o lote reutiliza a janela.
 */
export const assinaturaReauth = sqliteTable(
	'assinatura_reauth',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		token_hash: text('token_hash').notNull().unique(),
		usuario_tipo: text('usuario_tipo', { enum: ['policial', 'admin'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		/** SHA-256 do cookie `session_token` — a janela morre se a sessão mudar. */
		sessao_hash: text('sessao_hash').notNull(),
		expires_at: text('expires_at').notNull(),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_assinatura_reauth_expires').on(table.expires_at),
		index('idx_assinatura_reauth_usuario').on(table.usuario_tipo, table.usuario_id)
	]
);

// ---- Configurações do Sistema ----

export const configuracoes = sqliteTable('configuracoes', {
	chave: text('chave').primaryKey(),
	valor: text('valor').notNull(),
	updated_at: text('updated_at')
		.notNull()
		.default(sql`(datetime('now', '-3 hours'))`)
});

// ---- Rate Limiting ----

export const loginAttempts = sqliteTable(
	'login_attempts',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		ip: text('ip').notNull(),
		attempted_at: text('attempted_at')
			.notNull()
			.default(sql`(datetime('now'))`),
		success: integer('success').notNull().default(0),
		// Hash do identificador da conta (tipo:matricula) — throttle por conta
		// (account lockout) sem gravar a matrícula em texto. Nullable: fluxos que
		// não identificam a conta (ex.: login por certificado) gravam NULL.
		identifier: text('identifier')
	},
	(table) => [
		index('idx_login_attempts_ip_time').on(table.ip, table.attempted_at),
		index('idx_login_attempts_identifier_time').on(table.identifier, table.attempted_at)
	]
);

/**
 * Rate-limit dedicado aos fluxos de recuperação de senha e verificação de
 * e-mail pessoal. Separado de `login_attempts` para não inflar a contagem
 * usada pelo rate-limit de LOGIN (atacante poderia bloquear logins legítimos
 * disparando requests de reset).
 */
export const recoveryAttempts = sqliteTable(
	'recovery_attempts',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		ip: text('ip').notNull(),
		// `recovery_attempts` é, no nível do banco, um log genérico (ip, purpose,
		// attempted_at) — a coluna purpose NÃO tem CHECK (ver migration 0022), o
		// `enum` abaixo é só tipagem. Além dos fluxos de recuperação, reusamos a
		// mesma tabela para throttle por IP de endpoints sensíveis sem sessão
		// (download público de validação, verificação/reenvio de 2FA), cada um
		// isolado pelo seu purpose — um flood de um não infla o contador do outro
		// nem o de login/reset. Não requer migration (coluna purpose é TEXT livre).
		purpose: text('purpose', {
			enum: [
				'solicitar_redefinicao',
				'confirmar_redefinicao',
				'primeiro_acesso',
				'validar_download',
				'validar_consulta',
				'verificar_2fa',
				'reenviar_codigo',
				'solicitar_codigo_assinatura',
				'alterar_senha',
				'reauth_assinatura',
				'passkey_reposicao',
				'geracao_pesada'
			]
		}).notNull(),
		attempted_at: text('attempted_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [
		index('idx_recovery_attempts_ip_purpose_time').on(table.ip, table.purpose, table.attempted_at)
	]
);

/**
 * Nonces já consumidos por webhooks de sync (P1.3 da auditoria — replay
 * protection). Cada chamada de `/api/webhook/*` que envia X-Webhook-Nonce
 * resulta em uma linha aqui; o PRIMARY KEY garante que uma segunda tentativa
 * com o mesmo nonce falha por UNIQUE constraint. Limpeza periódica usa o
 * índice em `received_at` para purgar nonces fora da janela.
 */
export const webhookNonces = sqliteTable(
	'webhook_nonces',
	{
		nonce: text('nonce').primaryKey().notNull(),
		received_at: text('received_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [index('idx_webhook_nonces_received_at').on(table.received_at)]
);

// ---- Log de Auditoria (trilha forense) ----
//
// Evento estruturado e à prova de adulteração. Os campos `seq`/`hash_anterior`/
// `hash_registro` formam uma cadeia de hash encadeada (tamper-evidence); ver
// `auditar` e `verificarIntegridadeAudit` em `src/lib/db/audit.ts`. Colunas além
// das do log original (migração 0000) entraram nullable na migração 0033 — as
// linhas antigas e as ~25 chamadas legadas continuam válidas.

/**
 * Evento de auditoria que NÃO conseguiu entrar na cadeia (FLW-AUDIT-001).
 *
 * `auditar()` nunca lança — falha de trilha não pode derrubar a operação do
 * usuário. O preço era o evento sumir: a mutação persistia, a resposta era
 * sucesso, e sobrava só uma linha de log fora do banco. A política é registrar
 * pendência durável e seguir; `reprocessarPendenciasAudit` reinsere na cadeia.
 *
 * Deliberadamente BURRA — sem `seq`, sem hash encadeado, sem índice único. É o
 * que lhe dá chance de gravar quando o append encadeado não conseguiu.
 */
export const auditPendencias = sqliteTable(
	'audit_pendencias',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Evento serializado como chegou a `auditar()`, pronto para retentativa. */
		evento: text('evento').notNull(),
		/** Fora do JSON: dão triagem sem desserializar. */
		acao: text('acao').notNull(),
		entidade: text('entidade'),
		/** Por que a cadeia recusou — separa corrida de defeito. */
		motivo: text('motivo').notNull(),
		tentativas: integer('tentativas').notNull().default(0),
		ultima_tentativa_em: text('ultima_tentativa_em'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [index('idx_audit_pendencias_created').on(table.created_at)]
);

/**
 * Objeto do R2 que NÃO conseguiu ser apagado (FLW-R2-004).
 *
 * `deletarChavesR2` é best-effort de propósito — a linha no D1 é a fonte da
 * verdade de `/validar` e não pode ficar refém do storage. O preço era o
 * objeto sumir do radar: a função devolvia quantas chaves foram TENTADAS, e o
 * chamador em seguida apagava a linha que guardava o `r2_key`. Depois disso o
 * objeto existe no bucket e nada no sistema sabe que ele existe.
 *
 * E o que sobra não é lixo neutro: PDF com manifesto forense (CPF, IP, GPS) e
 * selfie biométrica (LGPD art. 11). A chave é capturada AQUI antes de a linha
 * sumir; `reprocessarPendenciasR2` tenta de novo no cron de retenção.
 */
export const r2Pendencias = sqliteTable(
	'r2_pendencias',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Única: a mesma chave falhando duas vezes é a mesma pendência. */
		chave: text('chave').notNull().unique(),
		/** De onde veio, para triagem sem consultar outra tabela. */
		origem: text('origem').notNull(),
		/** Por que o delete falhou — separa transitório de permanente. */
		motivo: text('motivo').notNull(),
		tentativas: integer('tentativas').notNull().default(0),
		ultima_tentativa_em: text('ultima_tentativa_em'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [index('idx_r2_pendencias_created').on(table.created_at)]
);

/**
 * Envio da Base_Equipe que não chegou ao destino (FLW-WEBHOOK-003).
 *
 * A GISE é finalizada e só então o envio é agendado, fora da resposta ao
 * cliente. Falhando, sobrava um `logger.error` — a escala fechada no sistema e
 * ausente da planilha que a corporação usa para pagar o extraordinário, sem
 * ninguém ser avisado.
 *
 * Mesma forma de `audit_pendencias` e `r2_pendencias`; o que muda é a AÇÃO de
 * reprocessamento. `chave_idempotencia` viaja no payload para o destino poder
 * deduplicar o reenvio.
 */
export const baseEquipePendencias = sqliteTable(
	'base_equipe_pendencias',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Único: a mesma escala falhando de novo é a mesma pendência. */
		gise_id: integer('gise_id')
			.notNull()
			.unique()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		/** Estável por GISE — reenviar manda a mesma chave. */
		chave_idempotencia: text('chave_idempotencia').notNull(),
		motivo: text('motivo').notNull(),
		tentativas: integer('tentativas').notNull().default(0),
		ultima_tentativa_em: text('ultima_tentativa_em'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [index('idx_base_equipe_pendencias_created').on(table.created_at)]
);

/**
 * Âncora de um corte de retenção na trilha (FLW-AUDIT-005).
 *
 * A retenção apaga o PREFIXO de `audit_log` além do prazo, e isso é legítimo.
 * O verificador, porém, aceitava a primeira linha sobrevivente como início
 * válido sem perguntar de onde ela veio — então apagar as primeiras N linhas
 * para sumir com um evento produzia uma cadeia que continuava verificando `ok`.
 *
 * O checkpoint guarda ONDE o corte parou e QUAL era o `hash_registro` da última
 * linha removida, que é o `hash_anterior` da primeira sobrevivente. Sem
 * checkpoint casando nos dois campos, o buraco volta a ser o que sempre foi:
 * uma remoção não explicada.
 */
export const auditCheckpoints = sqliteTable('audit_checkpoints', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	/** Último `seq` removido. A primeira sobrevivente tem de ser `seq_ate + 1`. */
	seq_ate: integer('seq_ate').notNull().unique(),
	/** `hash_registro` daquela linha — o elo que a sobrevivente aponta. */
	hash_ate: text('hash_ate').notNull(),
	removidos: integer('removidos').notNull(),
	/** Política aplicada, em texto (ex.: `retencao:5anos`). */
	politica: text('politica').notNull(),
	created_at: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`)
});

export const auditLog = sqliteTable(
	'audit_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		// ---- Ator (quem executou) ----
		usuario_id: integer('usuario_id'),
		usuario_nome: text('usuario_nome').notNull().default(''),
		usuario_papel: text('usuario_papel'),
		actor_tipo: text('actor_tipo', {
			enum: ['policial', 'admin', 'colaborador', 'sistema', 'webhook']
		}),
		// ---- Ação e classificação ----
		acao: text('acao').notNull(),
		categoria: text('categoria'),
		severidade: text('severidade', { enum: ['info', 'aviso', 'critico'] }),
		resultado: text('resultado', { enum: ['sucesso', 'falha', 'negado'] }),
		// ---- Entidade afetada (compat) + Alvo explícito (quem/o que sofreu a ação) ----
		entidade: text('entidade').notNull(),
		entidade_id: integer('entidade_id'),
		alvo_tipo: text('alvo_tipo'),
		alvo_id: integer('alvo_id'),
		alvo_nome: text('alvo_nome'),
		// ---- Conteúdo ----
		detalhes: text('detalhes'),
		/** JSON livre com contexto adicional do evento. */
		metadados: text('metadados'),
		/** JSON: snapshot do estado ANTES de uma edição (diff). */
		dados_antes: text('dados_antes'),
		/** JSON: snapshot do estado DEPOIS de uma edição (diff). */
		dados_depois: text('dados_depois'),
		// ---- Contexto de request / correlação ----
		ip: text('ip'),
		/** IP completo cifrado (AES-GCM); `ip` acima fica anonimizado p/ exibição. */
		ip_cifrado: text('ip_cifrado'),
		user_agent: text('user_agent'),
		request_id: text('request_id'),
		rota: text('rota'),
		metodo: text('metodo'),
		// ---- Tamper-evidence (cadeia de hash) ----
		seq: integer('seq'),
		hash_anterior: text('hash_anterior'),
		hash_registro: text('hash_registro'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [
		index('idx_audit_usuario').on(table.usuario_id, table.created_at),
		index('idx_audit_entidade').on(table.entidade, table.entidade_id),
		index('idx_audit_acao').on(table.acao),
		index('idx_audit_created_at').on(table.created_at),
		unique('uq_audit_seq').on(table.seq),
		index('idx_audit_categoria').on(table.categoria, table.created_at),
		index('idx_audit_severidade').on(table.severidade, table.created_at),
		index('idx_audit_resultado').on(table.resultado, table.created_at),
		index('idx_audit_alvo').on(table.alvo_tipo, table.alvo_id)
	]
);

// ---- Logs técnicos da aplicação (warn/error do logger estruturado) ----
//
// Complementa a trilha forense `audit_log` (eventos de negócio) com os sinais
// operacionais que antes só existiam em Cloudflare Logs/Sentry: cada `logger.warn`
// / `logger.error` emitido durante uma request é persistido aqui pelo flush em
// hooks.server.ts, correlacionável com a auditoria via `request_id`.
export const appLog = sqliteTable(
	'app_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		level: text('level', { enum: ['warn', 'error'] }).notNull(),
		message: text('message').notNull(),
		/** JSON com o contexto passado ao logger (truncado — ver request-context.ts). */
		contexto: text('contexto'),
		request_id: text('request_id'),
		/** Id do usuário autenticado na request (texto; null = anônimo/sistema). */
		usuario_id: text('usuario_id'),
		rota: text('rota'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [
		index('idx_applog_created').on(table.created_at),
		index('idx_applog_level').on(table.level, table.created_at),
		index('idx_applog_request').on(table.request_id)
	]
);

// ---- LGPD: Registro de Incidentes (art. 48) ----

export const lgpdIncidentes = sqliteTable(
	'lgpd_incidentes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		titulo: text('titulo').notNull(),
		descricao: text('descricao').notNull(),
		tipo_incidente: text('tipo_incidente', {
			enum: ['acesso_nao_autorizado', 'vazamento', 'uso_indevido', 'perda', 'alteracao', 'outro']
		})
			.notNull()
			.default('acesso_nao_autorizado'),
		data_ocorrencia: text('data_ocorrencia'),
		data_descoberta: text('data_descoberta').notNull(),
		dados_afetados: text('dados_afetados').notNull(),
		usuarios_afetados_estimativa: integer('usuarios_afetados_estimativa'),
		gravidade: text('gravidade', { enum: ['baixa', 'media', 'alta', 'critica'] })
			.notNull()
			.default('media'),
		status: text('status', { enum: ['aberto', 'investigando', 'notificado_anpd', 'encerrado'] })
			.notNull()
			.default('aberto'),
		responsavel_nome: text('responsavel_nome').notNull(),
		responsavel_email: text('responsavel_email').notNull(),
		notificado_anpd_em: text('notificado_anpd_em'),
		prazo_notificacao_anpd: text('prazo_notificacao_anpd'),
		medidas_tomadas: text('medidas_tomadas'),
		created_by_id: integer('created_by_id').notNull(),
		created_by_nome: text('created_by_nome').notNull(),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_lgpd_incidentes_status').on(table.status, table.created_at),
		index('idx_lgpd_incidentes_gravidade').on(table.gravidade)
	]
);

// ---- LGPD: Solicitações de Direitos dos Titulares (art. 18) ----

export const lgpdSolicitacoes = sqliteTable(
	'lgpd_solicitacoes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		solicitante_tipo: text('solicitante_tipo', { enum: ['policial', 'admin'] }).notNull(),
		solicitante_id: integer('solicitante_id').notNull(),
		solicitante_nome: text('solicitante_nome').notNull(),
		tipo_direito: text('tipo_direito', {
			enum: [
				'acesso',
				'correcao',
				'anonimizacao',
				'portabilidade',
				'eliminacao',
				'informacao_compartilhamento',
				'revogacao_consentimento',
				'oposicao'
			]
		}).notNull(),
		descricao: text('descricao'),
		status: text('status', { enum: ['pendente', 'em_analise', 'concluida', 'indeferida'] })
			.notNull()
			.default('pendente'),
		resposta: text('resposta'),
		respondido_por_nome: text('respondido_por_nome'),
		respondido_em: text('respondido_em'),
		prazo_resposta: text('prazo_resposta').notNull(),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_lgpd_sol_solicitante').on(
			table.solicitante_tipo,
			table.solicitante_id,
			table.created_at
		),
		index('idx_lgpd_sol_status').on(table.status, table.prazo_resposta)
	]
);

// ---- Solicitações de alteração cadastral (ficha do policial) ----

// Uma linha por campo alterado; aprovação do Admin Geral aplica o valor no
// cadastro. Quem PEDE é o administrador seccional ou de unidade, dentro do
// escopo dele (`solicitante_id`); o servidor não pede alteração do próprio
// cadastro. E-mail pessoal tem fluxo próprio (OTP) e não passa por esta tabela.
//
// `lotacao` continua no enum por causa das linhas antigas: transferir servidor
// virou pedido de MOVIMENTAÇÃO (`policialAcaoSolicitacoes`), com portaria anexa,
// e nenhuma solicitação NOVA usa este campo.
export const cadastroSolicitacoes = sqliteTable(
	'cadastro_solicitacoes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		policial_id: integer('policial_id').notNull(),
		campo: text('campo', {
			enum: [
				'nome',
				'matricula',
				'cargo',
				'cpf',
				'telefone',
				'classe',
				'regime',
				'email',
				'lotacao'
			]
		}).notNull(),
		valor_atual: text('valor_atual'),
		valor_novo: text('valor_novo').notNull(),
		/** Motivo do pedido (até 300 caracteres). Nulo só nas linhas anteriores à migração 0067. */
		justificativa: text('justificativa'),
		/** Policial que PEDIU. Nulo nas linhas antigas — ali o solicitante é o próprio `policial_id`. */
		solicitante_id: integer('solicitante_id'),
		solicitante_nome: text('solicitante_nome'),
		status: text('status', { enum: ['pendente', 'aprovada', 'rejeitada'] })
			.notNull()
			.default('pendente'),
		decidido_por: integer('decidido_por'),
		decidido_em: text('decidido_em'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_cadsol_status').on(table.status),
		index('idx_cadsol_policial').on(table.policial_id, table.status)
	]
);

// ---- Solicitações de ação de RH (movimentar / afastar / desvincular) ----
//
// O mesmo ato que o Admin Geral executa direto na ficha, quando pedido por um
// administrador de seccional ou de unidade, para aqui até a decisão.
//
// As colunas espelham `policialHistorico` DE PROPÓSITO: aprovar é copiar esta
// linha para lá e aplicar o efeito no cadastro. Guardar o pedido em outro
// formato (um JSON, por exemplo) obrigaria o aprovador a remontar o evento, que
// é justamente onde os dois caminhos passariam a divergir.
//
// O PDF anexo sobe no momento do PEDIDO (`documento_r2_key`) — é o que permite
// ao Admin Geral BAIXAR a portaria antes de decidir. Aprovar TRANSFERE a chave
// para `policialHistorico`, que passa a ser a dona dela; recusar a apaga do
// bucket na hora (`deletarChavesR2`), porque nenhuma outra linha voltaria a
// referenciá-la e o objeto ficaria irrastreável (a mesma regra do FLW-RBAC-005).
export const policialAcaoSolicitacoes = sqliteTable(
	'policial_acao_solicitacoes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		tipo: text('tipo', { enum: ['movimentacao', 'afastamento', 'desvinculacao'] }).notNull(),
		subtipo: text('subtipo'),
		descricao: text('descricao'),
		unidade_origem: text('unidade_origem'),
		unidade_destino: text('unidade_destino'),
		data_evento: text('data_evento'),
		data_inicio: text('data_inicio'),
		data_fim: text('data_fim'),
		qtd_dias: integer('qtd_dias'),
		nup: text('nup'),
		documento_r2_key: text('documento_r2_key'),
		documento_nome: text('documento_nome'),
		/** Motivo do pedido (até 300 caracteres). Obrigatório. */
		justificativa: text('justificativa').notNull(),
		solicitante_id: integer('solicitante_id'),
		solicitante_nome: text('solicitante_nome'),
		status: text('status', { enum: ['pendente', 'aprovada', 'rejeitada'] })
			.notNull()
			.default('pendente'),
		decidido_por: integer('decidido_por'),
		decidido_em: text('decidido_em'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_acaosol_status').on(table.status),
		index('idx_acaosol_policial').on(table.policial_id, table.status)
	]
);

// ---- Histórico funcional do policial ----
//
// Linha do tempo por servidor: movimentações (transferências de lotação),
// afastamentos (férias/licenças), desvinculações (baixa) e o diff das edições
// cadastrais. Cada evento é imutável (append-only) e pode ter um documento PDF
// anexo no R2 (`documento_r2_key`). O objetivo é responder "o que já aconteceu
// com este policial?" — separado da trilha forense `audit_log` (Super Admin,
// tamper-evident), que continua registrando os mesmos fatos para segurança.

export const policialHistorico = sqliteTable(
	'policial_historico',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		tipo: text('tipo', {
			enum: ['movimentacao', 'afastamento', 'desvinculacao', 'edicao', 'papel']
		}).notNull(),
		/** Subtipo do afastamento: ferias | licenca_medica | judicial | licenca_outros | outros. */
		subtipo: text('subtipo'),
		/** Motivo/descrição livre (afastamento) ou destino do policial (desvinculação). */
		descricao: text('descricao'),
		// ---- Movimentação ----
		unidade_origem: text('unidade_origem'),
		unidade_destino: text('unidade_destino'),
		// ---- Datas ----
		/** Data principal do evento (movimentação/desvinculação). */
		data_evento: text('data_evento'),
		data_inicio: text('data_inicio'),
		data_fim: text('data_fim'),
		qtd_dias: integer('qtd_dias'),
		// ---- Protocolo (NUP) ----
		nup: text('nup'),
		// ---- Documento anexo (PDF no R2) ----
		documento_r2_key: text('documento_r2_key'),
		documento_nome: text('documento_nome'),
		// ---- Diff (edição de cadastro / mudança de papel) ----
		/** JSON: snapshot ANTES da edição. */
		dados_antes: text('dados_antes'),
		/** JSON: snapshot DEPOIS da edição. */
		dados_depois: text('dados_depois'),
		// ---- Ator (quem registrou) ----
		registrado_por_id: integer('registrado_por_id'),
		registrado_por_nome: text('registrado_por_nome'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_pol_hist_policial').on(table.policial_id, table.created_at),
		index('idx_pol_hist_tipo').on(table.tipo)
	]
);

// ---- Plano Operacional (operação COM deslocamento) ----
//
// Família própria, separada de `operacoes`/`gise_*` de propósito: `operacoes` é
// o CATÁLOGO do qual as escalas GISE pendem, e um plano operacional é um evento
// único que nunca recebe escala. O raciocínio inteiro está no cabeçalho de
// `migrations/0068_plano_operacional.sql`.
//
// **Todo valor monetário aqui é inteiro em CENTAVOS.** Não há `real` de dinheiro
// nesta família e não deve passar a haver.

/**
 * Os valores de hora extra e diária, versionados. **Append-only.**
 *
 * Cada gravação do Super Admin insere uma linha NOVA; o plano guarda em
 * `planos_operacionais.custo_parametro_id` qual usou. É o que faz o PDF de um
 * plano de março, reemitido em junho, sair com os mesmos totais depois de um
 * reajuste.
 *
 * Os quatro `_plus` não são derivados de `normal * 1.3`: a tela sugere o
 * acréscimo, mas o valor aplicado fica gravado. Derivar na leitura faria uma
 * mudança futura de alíquota reescrever documento já entregue.
 */
export const custoParametros = sqliteTable(
	'custo_parametros',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Hora extra normal, OIP classes D e C (centavos). */
		oip_cd_normal: integer('oip_cd_normal').notNull().default(0),
		/** Hora extra normal, OIP classes B e A (centavos). */
		oip_ab_normal: integer('oip_ab_normal').notNull().default(0),
		/** Hora extra normal, DPC 1ª e 2ª classe (centavos). */
		dpc_12_normal: integer('dpc_12_normal').notNull().default(0),
		/** Hora extra normal, DPC 3ª classe e especial (centavos). */
		dpc_3e_normal: integer('dpc_3e_normal').notNull().default(0),
		oip_cd_plus: integer('oip_cd_plus').notNull().default(0),
		oip_ab_plus: integer('oip_ab_plus').notNull().default(0),
		dpc_12_plus: integer('dpc_12_plus').notNull().default(0),
		dpc_3e_plus: integer('dpc_3e_plus').notNull().default(0),
		/** Diária estadual — valor único, sem faixa de classe (centavos). */
		diaria_estadual: integer('diaria_estadual').notNull().default(0),
		/** Diária interestadual (centavos). */
		diaria_interestadual: integer('diaria_interestadual').notNull().default(0),
		/**
		 * A partir de quantos km o deslocamento é pago em diária.
		 *
		 * Mora aqui, e não numa constante, porque é decisão do Super Admin — a mesma
		 * autoridade que fixa quanto vale a diária. E mora nesta tabela, que é
		 * append-only, porque **congela junto com os valores**: o plano guarda
		 * `custo_parametro_id`, então subir o limite para 120 amanhã não muda a
		 * rubrica de um plano de março que já foi impresso e assinado.
		 *
		 * Não é dinheiro, então fica FORA de `valoresDe()` — ver `regrasDe()` ao
		 * lado dele.
		 */
		distancia_minima_diaria_km: integer('distancia_minima_diaria_km').notNull().default(100),
		vigente_desde: text('vigente_desde').notNull(),
		criado_por_id: integer('criado_por_id'),
		/** Copiado para a linha: precisa dizer quem gravou depois que o cadastro mudar. */
		criado_por_nome: text('criado_por_nome').notNull().default(''),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [index('idx_custo_parametros_vigencia').on(table.vigente_desde, table.id)]
);

/**
 * O plano operacional: os parâmetros gerais da operação com deslocamento.
 *
 * `numero` é sequencial POR ANO ("PLANO OPERACIONAL 123/2026"), e quem fecha a
 * corrida é o UNIQUE `(ano, numero)` — a consulta do MAX antes de inserir não
 * fecha (mesma lição de `uq_escalas_mensal`).
 */
export const planosOperacionais = sqliteTable(
	'planos_operacionais',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		numero: integer('numero').notNull(),
		ano: integer('ano').notNull(),
		nome: text('nome').notNull(),
		finalidade: text('finalidade').notNull().default(''),
		/** Item 2b do documento ("Ações a serem realizadas"), uma por linha. */
		acoes: text('acoes').notNull().default(''),
		/** Nº do NUP — opcional: o plano é montado antes de o procedimento existir. */
		nup: text('nup'),
		data_inicio: text('data_inicio').notNull(),
		hora_inicio: text('hora_inicio').notNull().default('08:00'),
		/**
		 * Previsão de término. Nulo desliga a SUGESTÃO automática de horas — sem
		 * janela fechada não há o que classificar, e chutar um fim produziria um
		 * palpite com cara de cálculo.
		 */
		data_fim: text('data_fim'),
		hora_fim: text('hora_fim'),
		/** Feriado no dia de início: joga a hora extra do dia inteiro para "plus". */
		feriado: integer('feriado', { mode: 'boolean' }).notNull().default(false),
		coordenador_id: integer('coordenador_id').references(() => policiais.id, {
			onDelete: 'restrict'
		}),
		demandante_unidade_id: integer('demandante_unidade_id').references(() => unidades.id, {
			onDelete: 'restrict'
		}),
		departamento: text('departamento').notNull().default('DPI SUL'),
		oip_por_equipe_padrao: integer('oip_por_equipe_padrao').notNull().default(4),
		/**
		 * Signatário do documento — escolhido POR PLANO (o Titular assina umas
		 * operações, o Adjunto outras), com o padrão global de `configuracoes`
		 * apenas pré-preenchendo o formulário.
		 *
		 * `diretor_id` é quem foi escolhido na busca; `diretor_nome` é o nome
		 * CONGELADO que o PDF imprime. Os dois, pela mesma razão de
		 * `cargo_snapshot` no efetivo: o id reabre a tela mostrando a seleção, e o
		 * nome congelado impede que renomear o cadastro altere documento emitido.
		 */
		diretor_id: integer('diretor_id').references(() => policiais.id, {
			onDelete: 'restrict'
		}),
		diretor_nome: text('diretor_nome').notNull().default(''),
		diretor_cargo: text('diretor_cargo').notNull().default(''),
		custo_parametro_id: integer('custo_parametro_id').references(() => custoParametros.id, {
			onDelete: 'restrict'
		}),
		status: text('status', { enum: ['rascunho', 'concluido'] })
			.notNull()
			.default('rascunho'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		uniqueIndex('uq_planos_ano_numero').on(table.ano, table.numero),
		index('idx_planos_data_inicio').on(table.data_inicio),
		index('idx_planos_status').on(table.status)
	]
);

/**
 * Uma equipe do plano.
 *
 * **NULL nos horários e em `local_briefing` = HERDA DO PLANO**, não "vazio" —
 * mesma convenção das colunas de configuração de `operacoes`. A equipe que sai
 * no horário padrão não congela cópia dele, senão mudar o horário do plano
 * deixaria de alcançá-la.
 *
 * `horas_normais` e `horas_plus` convivem porque a jornada pode ser MISTA: sair
 * às 05:00 de um dia útil dá uma hora plus e o resto normal.
 */
export const planoEquipes = sqliteTable(
	'plano_equipes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		plano_id: integer('plano_id')
			.notNull()
			.references(() => planosOperacionais.id, { onDelete: 'cascade' }),
		/** Posição na sequência. O `nome` é editável e pode deixar de refletir a ordem. */
		ordem: integer('ordem').notNull().default(0),
		nome: text('nome').notNull(),
		tipo: text('tipo', { enum: ['operacional', 'seint'] })
			.notNull()
			.default('operacional'),
		viatura_modelo: text('viatura_modelo').notNull().default(''),
		viatura_placa: text('viatura_placa').notNull().default(''),
		data_inicio: text('data_inicio'),
		hora_inicio: text('hora_inicio'),
		hora_fim: text('hora_fim'),
		cidade_origem: text('cidade_origem').notNull().default(''),
		cidade_destino: text('cidade_destino').notNull().default(''),
		/**
		 * Quilômetros entre a origem e o destino, medidos por quem monta o plano.
		 *
		 * `NULL` é "ainda não informada", e não zero: zero é uma distância — diria
		 * que origem e destino são a mesma cidade. A diferença decide o que a tela
		 * mostra, porque 0 km sugeriria hora extra como se a medida tivesse sido
		 * feita e dado abaixo do limite de diária.
		 */
		distancia_km: integer('distancia_km'),
		local_briefing: text('local_briefing'),
		tipo_custo: text('tipo_custo', { enum: ['sem_custo', 'hora_extra', 'diaria'] })
			.notNull()
			.default('sem_custo'),
		horas_normais: integer('horas_normais').notNull().default(0),
		horas_plus: integer('horas_plus').notNull().default(0),
		diaria_tipo: text('diaria_tipo', { enum: ['estadual', 'interestadual'] }),
		/** Meias diárias: 1 a 30 (= 0,5 a 15). Inteiro — não há float no caminho do dinheiro. */
		diarias_meias: integer('diarias_meias').notNull().default(0)
	},
	(table) => [index('idx_plano_equipes_plano').on(table.plano_id, table.ordem)]
);

/**
 * Um servidor alocado a uma equipe do plano.
 *
 * `cargo_snapshot`/`classe_snapshot` são a BASE DE CÁLCULO e ficam congelados;
 * nome, matrícula, lotação e telefone continuam vindo vivos de `policiais` pelo
 * join. Promoção muda o que a pessoa ganha daqui para a frente — não o que foi
 * orçado num plano já emitido.
 *
 * O CHEFE é flag desta linha, e não `chefe_policial_id` na equipe: assim o
 * CASCADE leva a chefia junto quando o membro sai. Com o ponteiro na equipe,
 * alguém teria de lembrar de limpá-lo, e o dia em que esquecesse o PDF
 * imprimiria como chefe quem não está na equipe.
 */
export const planoEquipeMembros = sqliteTable(
	'plano_equipe_membros',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		equipe_id: integer('equipe_id')
			.notNull()
			.references(() => planoEquipes.id, { onDelete: 'cascade' }),
		/**
		 * Denormalizado para o índice de exclusividade — o SQLite não indexa
		 * através de join. Sai derivado da própria equipe no INSERT, e equipe não
		 * muda de plano (mesmo desenho de `gise_membros.gise_id`).
		 */
		plano_id: integer('plano_id')
			.notNull()
			.references(() => planosOperacionais.id, { onDelete: 'cascade' }),
		/**
		 * RESTRICT, não CASCADE: o membro é linha de um documento orçado. Excluir o
		 * cadastro não pode esvaziar em silêncio o efetivo de um plano emitido.
		 */
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'restrict' }),
		cargo_snapshot: text('cargo_snapshot').notNull().default(''),
		classe_snapshot: text('classe_snapshot').notNull().default(''),
		chefe: integer('chefe', { mode: 'boolean' }).notNull().default(false)
	},
	(table) => [
		// Um servidor por PLANO: ninguém desloca em duas equipes da mesma operação,
		// e a dupla contagem inflaria o custo sem aparecer em lugar nenhum.
		uniqueIndex('uq_plano_membros_plano_policial').on(table.plano_id, table.policial_id),
		// Um chefe por equipe. PARCIAL: só as linhas com `chefe = 1` colidem.
		uniqueIndex('uq_plano_membros_chefe')
			.on(table.equipe_id)
			.where(sql`${table.chefe} = 1`),
		index('idx_plano_membros_equipe').on(table.equipe_id),
		index('idx_plano_membros_policial').on(table.policial_id)
	]
);

/**
 * As opções de LOCAL DE BRIEFING e CIDADE DE DESTINO que o plano oferece às
 * suas equipes, com uma PADRÃO de cada tipo.
 *
 * Existe contra a redigitação: numa operação com oito equipes saindo para três
 * cidades, o nome do destino era escrito oito vezes, e bastava um acento
 * diferente para o Anexo I listar dois destinos onde só há um. O plano declara
 * a lista uma vez; a equipe escolhe num seletor.
 *
 * **Uma tabela para os dois tipos** porque são a mesma forma — lista de texto
 * com uma padrão. Separá-las duplicaria índice, action e componente de tela
 * para nada.
 *
 * A padrão é decidida por ÍNDICE PARCIAL, como o chefe de equipe: só as linhas
 * com `padrao = 1` colidem, então quem arbitra a troca é o banco, e não uma
 * consulta prévia que duas abas abertas conseguem furar.
 */
export const planoOpcoes = sqliteTable(
	'plano_opcoes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		plano_id: integer('plano_id')
			.notNull()
			.references(() => planosOperacionais.id, { onDelete: 'cascade' }),
		tipo: text('tipo', { enum: ['briefing', 'origem', 'destino'] }).notNull(),
		valor: text('valor').notNull(),
		/**
		 * O município a que esta opção corresponde — o que permite MEDIR o trajeto.
		 *
		 * Para `origem` e `destino`, é a própria cidade do rótulo. Para `briefing`,
		 * é onde o PRÉDIO fica: "Sede da 4ª Seccional do Interior Sul" é um
		 * endereço, e o trajeto da equipe passa pela cidade dele.
		 *
		 * Anulável porque nem toda opção resolve — as anteriores a esta coluna, e
		 * qualquer local fora do Ceará. `NULL` é "não dá para medir por aqui", que a
		 * tela explica e o preenchimento manual cobre.
		 */
		municipio_ibge: text('municipio_ibge').references(() => municipios.ibge),
		padrao: integer('padrao', { mode: 'boolean' }).notNull().default(false),
		ordem: integer('ordem').notNull().default(0),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		uniqueIndex('uq_plano_opcoes_padrao')
			.on(table.plano_id, table.tipo)
			.where(sql`${table.padrao} = 1`),
		uniqueIndex('uq_plano_opcoes_valor').on(table.plano_id, table.tipo, table.valor),
		index('idx_plano_opcoes_plano').on(table.plano_id, table.tipo, table.ordem)
	]
);

/**
 * Os municípios do Ceará, com a coordenada da SEDE.
 *
 * Semeados por `scripts/gerar-distancias.mjs` a partir do Wikidata (CC0). O
 * código IBGE é a chave: nome de município muda de grafia, código não.
 *
 * A coordenada é da sede, e não o centroide do polígono — a viatura sai da
 * sede, e em município alongado o centro geométrico fica dezenas de km fora.
 * Fica gravada porque é dela que o script parte para regerar a matriz.
 */
export const municipios = sqliteTable(
	'municipios',
	{
		ibge: text('ibge').primaryKey(),
		nome: text('nome').notNull(),
		uf: text('uf').notNull(),
		lat: real('lat').notNull(),
		lon: real('lon').notNull(),
		/**
		 * `'RMF'`, `'RMC'`, `'RMS'` — ou `NULL`, que é o caso de 138 dos 184.
		 *
		 * Semeada do IBGE por `scripts/gerar-regioes-metropolitanas.mjs`. Serve à
		 * vedação do Decreto nº 35.922/2024, art. 4º, §1º, II: deslocamento dentro
		 * da MESMA região, até 120 km e sem extrapolação de jornada, não gera
		 * diária. As três condições valem juntas, e a terceira é de relógio — por
		 * isso o código alerta em vez de bloquear (ver `$lib/diarias/vedacoes`).
		 */
		regiao_metropolitana: text('regiao_metropolitana', { enum: ['RMF', 'RMC', 'RMS'] })
	},
	(table) => [
		index('idx_municipios_nome').on(table.uf, table.nome),
		index('idx_municipios_rm').on(table.regiao_metropolitana)
	]
);

/**
 * Os municípios ATENDIDOS pelo departamento e a cobertura de cada um (fase 2,
 * migração 0086; decisões E32 e E39). `municipios` é a lista-mãe do IBGE; esta
 * é o recorte com o que a corporação precisa saber do município: AIS, núcleo
 * de custódia, RISP, macrorregião e as forças coirmãs (PM, BM, PEFOCE).
 *
 * Quem RESPONDE pelo município está em `unidadeMunicipios` (N:N — Juazeiro do
 * Norte tem duas delegacias) e quem faz o PLANTÃO em `plantaoCobertura`.
 * Sem proposta de alteração (E6): só Admin Geral e Super Admin editam.
 */
export const municipiosCobertura = sqliteTable(
	'municipios_cobertura',
	{
		ibge: text('ibge')
			.primaryKey()
			.references(() => municipios.ibge),
		departamento_id: integer('departamento_id')
			.notNull()
			.references(() => unidades.id),
		area_km2: real('area_km2'),
		populacao_2022: integer('populacao_2022'),
		ais: text('ais').notNull().default(''),
		nucleo_custodia: text('nucleo_custodia').notNull().default(''),
		risp: text('risp').notNull().default(''),
		comando_pm: text('comando_pm').notNull().default(''),
		batalhao_pm: text('batalhao_pm').notNull().default(''),
		batalhao_bm: text('batalhao_bm').notNull().default(''),
		companhia_bm: text('companhia_bm').notNull().default(''),
		pefoce: text('pefoce').notNull().default(''),
		macrorregiao: text('macrorregiao').notNull().default(''),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [index('idx_municipios_cobertura_departamento').on(table.departamento_id)]
);

/** Quem responde por cada município atendido — N:N (ver `municipiosCobertura`). */
export const unidadeMunicipios = sqliteTable(
	'unidade_municipios',
	{
		unidade_id: integer('unidade_id')
			.notNull()
			.references(() => unidades.id, { onDelete: 'cascade' }),
		ibge: text('ibge')
			.notNull()
			.references(() => municipios.ibge),
		principal: integer('principal', { mode: 'boolean' }).default(true).notNull()
	},
	(table) => [
		primaryKey({ columns: [table.unidade_id, table.ibge] }),
		index('idx_unidade_municipios_ibge').on(table.ibge)
	]
);

/**
 * Quem faz o plantão de cada município, por período: em quatro casos o
 * plantonista do fim de semana não é o da semana (planilha "RESUMO DOS
 * PLANTÕES"). Não confundir com a escala de plantão (`escalas`), que é a
 * escala das pessoas; isto é a cobertura territorial.
 */
export const plantaoCobertura = sqliteTable(
	'plantao_cobertura',
	{
		ibge: text('ibge')
			.notNull()
			.references(() => municipios.ibge),
		periodo: text('periodo', { enum: ['semana', 'fds'] }).notNull(),
		plantonista_unidade_id: integer('plantonista_unidade_id').references(() => unidades.id),
		tipo: text('tipo', { enum: TIPOS_PLANTAO }).notNull()
	},
	(table) => [
		primaryKey({ columns: [table.ibge, table.periodo] }),
		index('idx_plantao_cobertura_plantonista').on(table.plantonista_unidade_id)
	]
);

/**
 * A distância RODOVIÁRIA entre duas sedes municipais, em quilômetros.
 *
 * Uma linha por par NÃO ordenado, sempre com o menor código primeiro: ida e
 * volta diferem menos de 1,5% e o valor gravado é a média arredondada. Duas
 * linhas obrigariam a explicar por que ir e voltar dão números diferentes num
 * documento.
 *
 * É medida, não estimativa: linha reta erra por um fator que vai de 1,10 a 1,62
 * e trocaria a rubrica em cima do limite de 100 km. Ver o cabeçalho de
 * `scripts/gerar-distancias.mjs`.
 *
 * Só PRÉ-PREENCHE. O número que vale para um plano fica em
 * `plano_equipes.distancia_km`, então atualizar esta tabela nunca reescreve
 * documento já emitido — a mesma decisão de `custo_parametros`.
 */
export const distanciasMunicipios = sqliteTable(
	'distancias_municipios',
	{
		origem_ibge: text('origem_ibge')
			.notNull()
			.references(() => municipios.ibge, { onDelete: 'cascade' }),
		destino_ibge: text('destino_ibge')
			.notNull()
			.references(() => municipios.ibge, { onDelete: 'cascade' }),
		km: integer('km').notNull()
	},
	(table) => [primaryKey({ columns: [table.origem_ibge, table.destino_ibge] })]
);

/**
 * Procedência da matriz: de onde veio e quando foi medida.
 *
 * Uma linha para a tabela inteira, porque a matriz é gerada de uma vez — datar
 * par a par repetiria o mesmo valor 16.836 vezes. A tela mostra esta data ao
 * lado da distância preenchida, para quem confere saber a idade da medida.
 */
export const distanciasMedicao = sqliteTable('distancias_medicao', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	fonte: text('fonte').notNull(),
	medido_em: text('medido_em').notNull(),
	pares: integer('pares').notNull()
});

/**
 * Calendário de feriados (módulo de diárias). Semeada por
 * `scripts/gerar-feriados.mjs` — hoje só o calendário NACIONAL; o cabeçalho do
 * script diz o que entra e o que fica de fora.
 *
 * `uf` é `''` quando nacional, e não NULL: a chave primária é composta e NULL
 * não casa consigo mesmo num UNIQUE. `abrangencia` é vocabulário aberto
 * (`nacional` hoje; `estadual` quando entrar), sem CHECK — a mesma decisão dos
 * estados do módulo.
 *
 * Só SUGERE: o pedido guarda a própria declaração de feriado, com a origem
 * (`calendario` ou `manual`), então mudar esta tabela nunca reescreve pedido já
 * feito.
 */
export const feriados = sqliteTable(
	'feriados',
	{
		data: text('data').notNull(),
		abrangencia: text('abrangencia').notNull().default('nacional'),
		uf: text('uf').notNull().default(''),
		descricao: text('descricao').notNull(),
		fonte: text('fonte').notNull()
	},
	(table) => [primaryKey({ columns: [table.data, table.abrangencia, table.uf] })]
);

/**
 * Matriz de TEMPO de trajeto entre os municípios do Ceará, em minutos — para
 * o módulo de diárias estimar a jornada da viagem (`$lib/diarias/jornada`,
 * entrada `minutosIda`).
 *
 * Separada de `distanciasMunicipios` por decisão: aquela decide a rubrica do
 * plano operacional (100 km) e não muda por causa do módulo novo. Mesma chave
 * (par não ordenado, menor código primeiro, `chaveDoPar`), mesmas sedes —
 * `scripts/gerar-tempos.mjs` mede entre as coordenadas da 0072 e confere a
 * distância contra ela. Só PRÉ-PREENCHE: o que vale para um pedido fica nele.
 */
export const temposMunicipios = sqliteTable(
	'tempos_municipios',
	{
		origem_ibge: text('origem_ibge')
			.notNull()
			.references(() => municipios.ibge, { onDelete: 'cascade' }),
		destino_ibge: text('destino_ibge')
			.notNull()
			.references(() => municipios.ibge, { onDelete: 'cascade' }),
		minutos: integer('minutos').notNull()
	},
	(table) => [primaryKey({ columns: [table.origem_ibge, table.destino_ibge] })]
);

/** Procedência da matriz de tempos — uma linha, como `distanciasMedicao`. */
export const temposMedicao = sqliteTable('tempos_medicao', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	fonte: text('fonte').notNull(),
	medido_em: text('medido_em').notNull(),
	pares: integer('pares').notNull()
});

// ---- Tipos inferidos ----

export type Policial = typeof policiais.$inferSelect;
export type PolicialHistorico = typeof policialHistorico.$inferSelect;
export type CadastroSolicitacao = typeof cadastroSolicitacoes.$inferSelect;
export type PolicialAcaoSolicitacao = typeof policialAcaoSolicitacoes.$inferSelect;
export type Escala = typeof escalas.$inferSelect;
export type NovaEscala = typeof escalas.$inferInsert;
export type EscalaPolicial = typeof escalaPoliciais.$inferSelect;
export type Unidade = typeof unidades.$inferSelect;
export type EscalaDocumento = typeof escalaDocumentos.$inferSelect;
export type Operacao = typeof operacoes.$inferSelect;
export type OperacaoLinhaBase = typeof operacaoLinhaBase.$inferSelect;
export type CustoParametros = typeof custoParametros.$inferSelect;
export type NovoCustoParametros = typeof custoParametros.$inferInsert;
export type PlanoOperacional = typeof planosOperacionais.$inferSelect;
export type PlanoEquipe = typeof planoEquipes.$inferSelect;
export type PlanoEquipeMembro = typeof planoEquipeMembros.$inferSelect;
export type PlanoOpcao = typeof planoOpcoes.$inferSelect;
export type Municipio = typeof municipios.$inferSelect;
export type MunicipioCobertura = typeof municipiosCobertura.$inferSelect;
export type PlantaoCobertura = typeof plantaoCobertura.$inferSelect;
export type DistanciaMunicipios = typeof distanciasMunicipios.$inferSelect;
export type Feriado = typeof feriados.$inferSelect;
export type Colaborador = typeof colaboradores.$inferSelect;
export type TempoMunicipios = typeof temposMunicipios.$inferSelect;
export type GiseEscala = typeof giseEscalas.$inferSelect;
export type GiseSeccional = typeof giseSeccionais.$inferSelect;
export type GiseEquipe = typeof giseEquipes.$inferSelect;
export type GiseMembro = typeof giseMembros.$inferSelect;
export type GiseDocumento = typeof giseDocumentos.$inferSelect;
export type GisePresenca = typeof gisePresencas.$inferSelect;
export type GiseAssinaturaRelatorio = typeof giseAssinaturasRelatorios.$inferSelect;
export type AceiteTermo = typeof aceitesTermos.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type AppLog = typeof appLog.$inferSelect;
export type LgpdIncidente = typeof lgpdIncidentes.$inferSelect;
export type LgpdSolicitacao = typeof lgpdSolicitacoes.$inferSelect;
