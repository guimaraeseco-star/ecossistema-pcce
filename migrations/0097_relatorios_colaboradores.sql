-- O relatório diário das ações dos colaboradores (E61, parte b).
--
-- Decisão do responsável em 21/09/2026: todo dia às 19h de Brasília, inclusive
-- fim de semana, o admin de cada unidade que tem colaborador recebe no e-mail
-- pessoal o que cada colaborador da unidade fez naquele dia, tirado da
-- auditoria. Esta tabela é o "já mandei": uma linha por unidade e dia, gravada
-- ANTES do envio, para o cron (GitHub Actions → `/api/webhook/relatorio-colaboradores`)
-- poder ser reexecutado — por retentativa ou à mão — sem mandar o mesmo
-- relatório duas vezes. Dia sem ação não gera linha nem e-mail.
CREATE TABLE relatorios_colaboradores (
	unidade_id INTEGER NOT NULL,
	dia TEXT NOT NULL,
	enviado_em TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
	-- Quem recebeu (nomes dos admins da unidade, para a conferência).
	destinatarios TEXT NOT NULL DEFAULT '',
	-- Quantas ações o relatório listou.
	acoes INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (unidade_id, dia)
);
