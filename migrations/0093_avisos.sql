-- Avisos: o que mudou e quem precisa saber.
--
-- Decisão do responsável em 20/09/2026 (E59): a delegacia precisa saber o que
-- o DPI SUL fez com os servidores dela (aprovou a movimentação que ela pediu,
-- registrou o titular, lançou o abono…), e o DPI SUL precisa saber o que a
-- ponta fez por conta própria (lançou a programação de férias, pediu uma LTS
-- por CID-F). São NOTÍCIAS — a pessoa lê e marca como lida —, diferentes das
-- PENDÊNCIAS (o que ela precisa resolver), que continuam calculadas ao vivo
-- das tabelas de origem e não se gravam aqui.
--
-- Cada linha tem UM destinatário: o Admin Geral (`admin_geral`) ou uma
-- LOTAÇÃO (`lotacao`, pelo nome — E51 migra para id depois). A lotação é lida
-- por quem a administra: o admin da unidade e o da seccional acima. "Lido" é
-- da linha, não da pessoa: a caixa da unidade é uma só, e quem leu primeiro
-- leu por ela. Quem fez a ação nunca recebe o aviso dela — o emissor decide
-- o outro lado. `cartao` é o cartão da home que o aviso acende
-- (`servidores`, `unidade`…); `link` é o lugar exato da alteração.
CREATE TABLE avisos (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	destinatario_tipo TEXT NOT NULL CHECK (destinatario_tipo IN ('admin_geral', 'lotacao')),
	destinatario_lotacao TEXT,
	cartao TEXT NOT NULL,
	tipo TEXT NOT NULL,
	titulo TEXT NOT NULL,
	texto TEXT NOT NULL DEFAULT '',
	link TEXT NOT NULL DEFAULT '',
	autor_id INTEGER,
	autor_nome TEXT NOT NULL DEFAULT '',
	lido_em TEXT,
	lido_por_id INTEGER,
	lido_por_nome TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_avisos_destinatario ON avisos(destinatario_tipo, destinatario_lotacao, lido_em);
