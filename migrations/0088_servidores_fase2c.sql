-- Fase 2-C do Ecossistema PCCE — Servidores (decisões de 16/09/2026, documento
-- `Fase2C-Servidores-proposta.md`): o que a planilha de pessoal do DPI Sul tem
-- e o sistema ainda não guardava.
--
-- 1. `policiais` ganha o que a planilha traz por servidor: `cargo_anterior`
--    (IPC/EPC — E31 unificou em OIP, o histórico fica aqui), `data_nascimento`,
--    `data_posse` e a designação. Núcleos NÃO entram (não são oficiais).
--
-- 2. `designacoes` é catálogo PARAMETRIZADO (E-parte C): a função exercida
--    (Operacional, Plantão, Cartório, chefias de seção, Delegado Titular…) e o
--    símbolo (DAS-4, DAS-1, DNS-3…). Semeado com os 18 valores da planilha;
--    a tela de cadastro poderá acrescentar. `ordem` é a ordem de exibição.
--
-- 3. `unidade_responsaveis`: quem responde pela unidade — TITULAR ou
--    RESPONDENTE (delegado de outra unidade respondendo subsidiariamente,
--    §7.1 da proposta da fase 2), sempre DPC, com início obrigatório e fim
--    aberto enquanto vigente. Uma linha vigente por unidade (índice parcial).
--    `origem` diz se veio da carga da planilha (o "Delegado Titular" da
--    coluna DESIGNAÇÃO) ou do cadastro pela tela; a carga só mexe no que é
--    dela. O respondente NÃO conta no efetivo da unidade (decisão dele).
--
-- 4. `policial_historico.legado`: o evento veio da carga da planilha (uma
--    linha por servidor: início, período, término, tipo) e é RE-ESCRITO a
--    cada carga — o que a operação registrar pela tela (legado = 0) fica.
--    Os subtipos de afastamento sobem de 5 para os 19 do Estatuto (Lei
--    12.124/93): a régua é o Zod em `$lib/servidores/afastamentos`; os cinco
--    valores antigos continuam válidos (`licenca_medica` → lê-se como LTS).
CREATE TABLE designacoes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	nome TEXT NOT NULL UNIQUE,
	simbolo TEXT NOT NULL DEFAULT '',
	ordem INTEGER NOT NULL DEFAULT 100,
	ativo INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

INSERT INTO designacoes (nome, simbolo, ordem) VALUES
	('Diretor de Departamento', 'DNS-2', 10),
	('Delegado Seccional', 'DNS-3', 20),
	('Delegado Titular', 'DAS-1', 30),
	('Delegado Adjunto', 'DAS-3', 40),
	('Delegado Auxiliar', 'DAS-4', 50),
	('Supervisor de núcleo de inteligência', 'DAS-1', 60),
	('Orientador de célula de planejamento e controle', 'DNS-3', 65),
	('Chefe de seção de investigações e operações', 'DAS-4', 70),
	('Chefe de seção de expedientes e cartório', 'DAS-4', 71),
	('Chefe de seção de operações', 'DAS-4', 72),
	('Chefe de seção de inteligência', 'DAS-4', 73),
	('Chefe de seção administrativa', 'DAS-4', 74),
	('Inteligência', '', 80),
	('Operacional', '', 81),
	('Plantão', '', 82),
	('Cartório', '', 83),
	('Sem cargo', '', 90);

ALTER TABLE policiais ADD COLUMN cargo_anterior TEXT NOT NULL DEFAULT '';
ALTER TABLE policiais ADD COLUMN data_nascimento TEXT;
ALTER TABLE policiais ADD COLUMN data_posse TEXT;
ALTER TABLE policiais ADD COLUMN designacao_id INTEGER REFERENCES designacoes(id);
CREATE INDEX idx_policiais_designacao ON policiais(designacao_id);

CREATE TABLE unidade_responsaveis (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	unidade_id INTEGER NOT NULL REFERENCES unidades(id),
	policial_id INTEGER NOT NULL REFERENCES policiais(id),
	papel TEXT NOT NULL CHECK (papel IN ('titular', 'respondente')),
	data_inicio TEXT NOT NULL,
	data_fim TEXT,
	portaria TEXT NOT NULL DEFAULT '',
	observacao TEXT NOT NULL DEFAULT '',
	origem TEXT NOT NULL DEFAULT 'sistema' CHECK (origem IN ('sistema', 'planilha')),
	registrado_por_id INTEGER,
	registrado_por_nome TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE UNIQUE INDEX idx_unidade_responsaveis_vigente ON unidade_responsaveis(unidade_id) WHERE data_fim IS NULL;
CREATE INDEX idx_unidade_responsaveis_policial ON unidade_responsaveis(policial_id);

ALTER TABLE policial_historico ADD COLUMN legado INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_pol_hist_legado ON policial_historico(policial_id, legado);
