-- O colaborador lotado numa unidade, e o que a unidade liberou para ele (E61).
--
-- Decisão do responsável em 21/09/2026: em vez de esperar a designação do
-- módulo de diárias, a UNIDADE define o que o seu terceirizado pode. O Admin
-- Geral vincula o colaborador a uma unidade no cadastro; o admin da unidade
-- (ou o da seccional acima, com aviso à unidade) marca, na ficha da unidade,
-- as chaves de um catálogo fechado (`lib/colaboradores/acessos.ts`): ver os
-- servidores, propor alteração de cadastro, afastamento, férias, ver escalas,
-- ler avisos. Sem chave, o colaborador continua na tela vazia. Ele nunca
-- decide e nunca vê outra unidade — o alcance é a unidade da coluna abaixo.
--
-- `unidade_id` por id, não por nome: é a linha da E51 (lotação → id). Nulo =
-- ainda não lotado (as contas existentes). Sem FK declarada, como as demais
-- referências a `unidades` deste banco (ver `policiais.papel_unidade_id`).
ALTER TABLE colaboradores ADD COLUMN unidade_id INTEGER;--> statement-breakpoint

CREATE TABLE colaborador_acessos (
	colaborador_id INTEGER NOT NULL,
	chave TEXT NOT NULL,
	concedido_por_id INTEGER,
	concedido_por_nome TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
	PRIMARY KEY (colaborador_id, chave)
);
