-- Fase 2 do Ecossistema PCCE (decisões E32 e E39): os municípios ATENDIDOS e a
-- cobertura de cada um. `municipios` (IBGE, 5.571 linhas, com coordenada da
-- sede) já existia para as diárias e continua sendo a lista-mãe; o que nasce
-- aqui é o recorte do departamento — quem atende, quem faz o plantão, AIS,
-- custódia, RISP e as forças coirmãs (PM, BM, PEFOCE).
--
-- Três tabelas e não uma, porque são três perguntas diferentes:
--   - `municipios_cobertura`: os dados do MUNICÍPIO (um por IBGE);
--   - `unidade_municipios`: quem RESPONDE por ele — N:N, porque Juazeiro do
--     Norte tem duas delegacias responsáveis pelo mesmo município;
--   - `plantao_cobertura`: quem faz o PLANTÃO e de que tipo, por período —
--     em quatro casos o plantonista do fim de semana não é o da semana.
-- Municípios não têm proposta de alteração (E6): só Admin Geral e Super Admin
-- editam; a tela é visível de departamento para cima (E32).
CREATE TABLE municipios_cobertura (
	ibge TEXT PRIMARY KEY REFERENCES municipios(ibge),
	departamento_id INTEGER NOT NULL REFERENCES unidades(id),
	area_km2 REAL,
	populacao_2022 INTEGER,
	ais TEXT NOT NULL DEFAULT '',
	nucleo_custodia TEXT NOT NULL DEFAULT '',
	risp TEXT NOT NULL DEFAULT '',
	comando_pm TEXT NOT NULL DEFAULT '',
	batalhao_pm TEXT NOT NULL DEFAULT '',
	batalhao_bm TEXT NOT NULL DEFAULT '',
	companhia_bm TEXT NOT NULL DEFAULT '',
	pefoce TEXT NOT NULL DEFAULT '',
	macrorregiao TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_municipios_cobertura_departamento ON municipios_cobertura(departamento_id);

CREATE TABLE unidade_municipios (
	unidade_id INTEGER NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
	ibge TEXT NOT NULL REFERENCES municipios(ibge),
	principal INTEGER NOT NULL DEFAULT 1,
	PRIMARY KEY (unidade_id, ibge)
);
CREATE INDEX idx_unidade_municipios_ibge ON unidade_municipios(ibge);

CREATE TABLE plantao_cobertura (
	ibge TEXT NOT NULL REFERENCES municipios(ibge),
	periodo TEXT NOT NULL CHECK (periodo IN ('semana', 'fds')),
	plantonista_unidade_id INTEGER REFERENCES unidades(id),
	tipo TEXT NOT NULL CHECK (tipo IN ('fisico', 'virtual', 'fisico_misto', 'sem_atendimento')),
	PRIMARY KEY (ibge, periodo)
);
CREATE INDEX idx_plantao_cobertura_plantonista ON plantao_cobertura(plantonista_unidade_id);
