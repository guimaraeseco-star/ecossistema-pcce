-- `dois_fatores_tokens.tipo` passa a admitir `reset_colaborador`.
--
-- E55: o colaborador ganha recuperação de senha pelo mesmo caminho do
-- servidor (código no e-mail → link). O desafio do código grava um `tipo`
-- próprio — reaproveitar `colaborador` (o 2FA do login) deixaria um código de
-- recuperação valer como segundo fator de login, e vice-versa. O CHECK da
-- 0083 não o admite, então é a terceira reconstrução desta tabela (0028,
-- 0083), pelo mesmo molde: copia tudo, porque quem está no meio de um login
-- durante o deploy não pode perder o código que acabou de receber.
DROP TABLE IF EXISTS dois_fatores_tokens_backup_0095;--> statement-breakpoint
ALTER TABLE dois_fatores_tokens RENAME TO dois_fatores_tokens_backup_0095;--> statement-breakpoint

CREATE TABLE dois_fatores_tokens (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	desafio_id TEXT NOT NULL UNIQUE,
	tipo TEXT NOT NULL CHECK(tipo IN (
		'policial',
		'admin',
		'colaborador',
		'assinatura',
		'reset_policial',
		'reset_admin',
		'reset_colaborador',
		'verificacao_email',
		'login_certificado'
	)),
	usuario_id INTEGER NOT NULL,
	codigo TEXT NOT NULL,
	tentativas INTEGER NOT NULL DEFAULT 0,
	expires_at TEXT NOT NULL,
	usado INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);--> statement-breakpoint

INSERT INTO dois_fatores_tokens (
	id, desafio_id, tipo, usuario_id, codigo,
	tentativas, expires_at, usado, created_at
)
SELECT
	id, desafio_id, tipo, usuario_id, codigo,
	tentativas, expires_at, usado, created_at
FROM dois_fatores_tokens_backup_0095;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS dois_fatores_tokens_desafio_id_unique
	ON dois_fatores_tokens (desafio_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_2fa_desafio
	ON dois_fatores_tokens (desafio_id);--> statement-breakpoint

DROP TABLE dois_fatores_tokens_backup_0095;
