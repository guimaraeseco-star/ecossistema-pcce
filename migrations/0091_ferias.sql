-- Fase 2-C: FÉRIAS — o que vem antes do gozo.
--
-- Até aqui férias era só o evento de afastamento (`policial_historico`,
-- subtipo `ferias`): o GOZO. O que faltava é o que a COGEP e a unidade
-- manuseiam: a fração programada, o pedido de reprogramação e o abono. A
-- leitura da lei e as decisões do responsável (17/09/2026) estão em
-- `C:\Ecossistema-PCCE\01-planos\Fase2C-Ferias-Abono-proposta.md`.
--
-- O que este sistema NÃO faz: a programação anual — ela é do GUARDIÃO
-- (sistema do Governo) e entra aqui já homologada, digitada pela unidade.
--
-- 1. `ferias_fracoes`: uma linha por fração programada (1ª, 2ª, 3ª) de um
--    exercício. `status` guarda só o que é decidido por ATO — `programada`,
--    `sustada`, `suspensa`; "em gozo" e "gozada" saem da data e não se gravam.
--    A fração sustada/suspensa aponta para a que a substituiu; a sucessão
--    fica inteira. `historico_id` liga ao evento de afastamento que ela gera:
--    é por ele que a situação de hoje, o efetivo e os painéis continuam
--    funcionando sem saber que existe programação.
--
-- 2. `ferias_reprogramacoes`: o pedido à COGEP. `tipo` é decidido pelo
--    sistema a partir dos fatos (a fração começou? → suspensão; não? →
--    sustação), nunca escolhido — é isso que impede o pedido errado. Fica
--    `pendente` até a unidade homologar a resposta, e enquanto pendente é
--    ALERTA no cartão da unidade e no do servidor.
--
--    As férias são UM período, ainda que fracionado (decisão do responsável,
--    17/09/2026): a SUSTAÇÃO alcança todas as frações ainda não iniciadas do
--    exercício de uma vez (`fracoes_ids`), e o pedido pode redividir os dias
--    que restam (`novos_periodos` — 30 dias sustados podem voltar como
--    10+20). A SUSPENSÃO é a exceção: mira a fração em gozo (`fracao_id`), e
--    os dias que voltam são só os que faltavam.
--
-- 3. `ferias_abonos`: os 10 dias convertidos em pecúnia (Lei 19.472/2025,
--    Dec. 37.363/2026). Registrado só pelo Admin Geral, porque o servidor pede
--    direto à COGEP — e é por isso que existe `ciencia_unidade_em`: a unidade
--    precisa saber que naqueles dias o servidor TRABALHA, senão ele recebe o
--    dinheiro e tira as férias mesmo assim. Sem ciência, é alerta na unidade.
CREATE TABLE ferias_fracoes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	policial_id INTEGER NOT NULL REFERENCES policiais(id),
	exercicio INTEGER NOT NULL,
	ordem INTEGER NOT NULL CHECK (ordem IN (1, 2, 3)),
	data_inicio TEXT NOT NULL,
	data_fim TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'programada' CHECK (status IN ('programada', 'sustada', 'suspensa')),
	origem TEXT NOT NULL DEFAULT 'guardiao' CHECK (origem IN ('guardiao', 'reprogramacao')),
	substituida_por_id INTEGER REFERENCES ferias_fracoes(id),
	historico_id INTEGER REFERENCES policial_historico(id) ON DELETE SET NULL,
	observacao TEXT NOT NULL DEFAULT '',
	registrado_por_id INTEGER,
	registrado_por_nome TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_ferias_fracoes_policial ON ferias_fracoes(policial_id, exercicio);
CREATE INDEX idx_ferias_fracoes_inicio ON ferias_fracoes(data_inicio);

CREATE TABLE ferias_reprogramacoes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	policial_id INTEGER NOT NULL REFERENCES policiais(id),
	exercicio INTEGER NOT NULL,
	tipo TEXT NOT NULL CHECK (tipo IN ('sustacao', 'suspensao')),
	-- Só na suspensão: a fração em gozo.
	fracao_id INTEGER REFERENCES ferias_fracoes(id),
	-- Só na sustação: as frações alcançadas, todas de uma vez (JSON de ids).
	fracoes_ids TEXT NOT NULL DEFAULT '[]',
	-- Os períodos pedidos, JSON [{inicio, fim, dias}] — um ou mais.
	novos_periodos TEXT NOT NULL DEFAULT '[]',
	-- Só na suspensão: o dia em que o servidor voltou ao serviço.
	data_suspensao TEXT,
	justificativa TEXT NOT NULL DEFAULT '',
	-- O ofício gerado, como foi ao NUP — guardado para conferência posterior.
	texto_oficio TEXT NOT NULL DEFAULT '',
	nup TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'deferida', 'indeferida')),
	decidida_em TEXT,
	decidida_por_id INTEGER,
	decidida_por_nome TEXT NOT NULL DEFAULT '',
	registrado_por_id INTEGER,
	registrado_por_nome TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_ferias_reprog_policial ON ferias_reprogramacoes(policial_id, status);

CREATE TABLE ferias_abonos (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	fracao_id INTEGER NOT NULL REFERENCES ferias_fracoes(id),
	policial_id INTEGER NOT NULL REFERENCES policiais(id),
	posicao TEXT NOT NULL CHECK (posicao IN ('iniciais', 'finais')),
	abono_inicio TEXT NOT NULL,
	abono_fim TEXT NOT NULL,
	nup TEXT NOT NULL DEFAULT '',
	data_requerimento TEXT,
	status TEXT NOT NULL DEFAULT 'deferido' CHECK (status IN ('deferido', 'indeferido')),
	decidido_em TEXT,
	ciencia_unidade_em TEXT,
	ciencia_unidade_por_id INTEGER,
	ciencia_unidade_por_nome TEXT NOT NULL DEFAULT '',
	registrado_por_id INTEGER,
	registrado_por_nome TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX idx_ferias_abonos_policial ON ferias_abonos(policial_id, status);
