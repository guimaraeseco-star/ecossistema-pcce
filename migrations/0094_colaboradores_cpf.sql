-- `colaboradores` reconstruída: o colaborador entra IGUAL ao servidor (E55).
--
-- Decisão do responsável em 17/09/2026. Até aqui o colaborador entrava por
-- e-mail (decisão 71 do plano antigo), sem recuperação de senha, e o primeiro
-- acesso travava na exigência de e-mail pessoal verificado — que ele não tem
-- como cumprir, porque o e-mail cadastrado já É o pessoal. O que muda:
--
--   1. o IDENTIFICADOR de login vira o CPF — numérico como a matrícula, único.
--      `cpf` passa a NOT NULL; a unicidade fica no índice cego `cpf_index`
--      (o `cpf` cifrado não é comparável: GCM com IV aleatório), que só é
--      nulo em ambiente sem chave (dev), onde o cadastro confere a duplicata
--      pela própria coluna `cpf`, em texto;
--   2. `email` vira `email_pessoal` — o mesmo nome que `policiais` usa para a
--      mesma coisa: o canal do 2FA e da recuperação;
--   3. `email_recuperacao`, opcional, perguntado no primeiro acesso: se ele
--      quiser outro endereço para receber o código de recuperação. Vazio, vale
--      o pessoal.
--
-- Há 0 colaboradores em produção, então a reconstrução não migra dado — mas
-- copia mesmo assim, como toda reconstrução deste repositório (0081, 0083):
-- uma linha criada entre o teste e o deploy não some. Índice único parcial em
-- `cpf_index` (WHERE NOT NULL) porque o SQLite já trata NULLs como distintos,
-- mas a intenção fica escrita.
DROP TABLE IF EXISTS colaboradores_backup_0094;--> statement-breakpoint
ALTER TABLE colaboradores RENAME TO colaboradores_backup_0094;--> statement-breakpoint

CREATE TABLE colaboradores (
	id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
	nome TEXT NOT NULL,
	-- CPF cifrado em repouso (`enc:v1:…`) ou, sem chave, os 11 dígitos.
	cpf TEXT NOT NULL,
	-- HMAC do CPF: é por ele que o login (senha e e-CPF) acha a conta.
	cpf_index TEXT,
	email_pessoal TEXT NOT NULL,
	email_recuperacao TEXT,
	senha TEXT NOT NULL,
	-- Empresa ou contrato — a quem a conta pertence, para saber quando revogar.
	vinculo TEXT NOT NULL DEFAULT '',
	primeiro_acesso INTEGER NOT NULL DEFAULT 1,
	ativo INTEGER NOT NULL DEFAULT 1,
	-- Quem criou (Admin Geral), em snapshot.
	criado_por_id INTEGER,
	criado_por_nome TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);--> statement-breakpoint

INSERT INTO colaboradores (
	id, nome, cpf, cpf_index, email_pessoal, senha, vinculo,
	primeiro_acesso, ativo, criado_por_id, criado_por_nome, created_at
)
SELECT
	id, nome, COALESCE(cpf, ''), cpf_index, email, senha, vinculo,
	primeiro_acesso, ativo, criado_por_id, criado_por_nome, created_at
FROM colaboradores_backup_0094;--> statement-breakpoint

CREATE UNIQUE INDEX colaboradores_cpf_index_unique
	ON colaboradores (cpf_index) WHERE cpf_index IS NOT NULL;--> statement-breakpoint

DROP TABLE colaboradores_backup_0094;
