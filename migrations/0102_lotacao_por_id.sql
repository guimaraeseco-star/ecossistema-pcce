-- A ligação servidor/escala → unidade passa a ter ID (decisão E51).
--
-- Até aqui ela era pelo NOME (`policiais.lotacao` = `unidades.nome`), herança
-- da planilha que originou o sistema. O nome é dado de exibição, não chave: se
-- alguém renomeia uma unidade, cada linha que guarda o nome antigo precisa ser
-- reescrita a mão, em cinco tabelas, e a que escapa fica órfã em silêncio — o
-- servidor some do escopo do administrador, a escala perde a lotação, e
-- ninguém percebe até montarem a próxima escala.
--
-- As colunas de TEXTO ficam, e isso é deliberado: elas passam a ser cache de
-- exibição, o que permite migrar as leituras uma a uma sem um "big bang". Só
-- depois que tudo estiver lendo por id é que uma migração de limpeza pode
-- removê-las.
--
-- Backfill pelo nome, com `JOIN unidades ON nome`. No espelho de 25/09 isso
-- casa 100% dos policiais e 100% das escalas. O que NÃO casa fica nulo, e nulo
-- aqui é resposta, não falha:
--
--   * 333 linhas de `policial_historico.unidade_destino` guardam nomes que não
--     existem no cadastro — "DRPC IGUATU", "2ª DP DE JUAZEIRO DO NORTE",
--     nomenclatura antiga da planilha e unidades de fora do DPI SUL. O
--     histórico é registro do passado: o texto continua lá, e o id fica nulo
--     porque não sabemos a que unidade DESTE cadastro ele corresponde;
--   * alguns `avisos.destinatario_lotacao` guardam coisas que nunca foram
--     unidade (o motivo "Aposentadoria", unidades de teste já apagadas).
ALTER TABLE policiais ADD COLUMN unidade_id INTEGER REFERENCES unidades(id);
ALTER TABLE escalas ADD COLUMN unidade_id INTEGER REFERENCES unidades(id);
ALTER TABLE policial_historico ADD COLUMN unidade_origem_id INTEGER REFERENCES unidades(id);
ALTER TABLE policial_historico ADD COLUMN unidade_destino_id INTEGER REFERENCES unidades(id);
ALTER TABLE policial_acao_solicitacoes ADD COLUMN unidade_origem_id INTEGER REFERENCES unidades(id);
ALTER TABLE policial_acao_solicitacoes ADD COLUMN unidade_destino_id INTEGER REFERENCES unidades(id);
ALTER TABLE avisos ADD COLUMN destinatario_unidade_id INTEGER REFERENCES unidades(id);

UPDATE policiais
   SET unidade_id = (SELECT u.id FROM unidades u WHERE u.nome = policiais.lotacao)
 WHERE coalesce(lotacao, '') <> '';

UPDATE escalas
   SET unidade_id = (SELECT u.id FROM unidades u WHERE u.nome = escalas.lotacao)
 WHERE coalesce(lotacao, '') <> '';

UPDATE policial_historico
   SET unidade_origem_id = (SELECT u.id FROM unidades u WHERE u.nome = policial_historico.unidade_origem),
       unidade_destino_id = (SELECT u.id FROM unidades u WHERE u.nome = policial_historico.unidade_destino);

UPDATE policial_acao_solicitacoes
   SET unidade_origem_id = (SELECT u.id FROM unidades u WHERE u.nome = policial_acao_solicitacoes.unidade_origem),
       unidade_destino_id = (SELECT u.id FROM unidades u WHERE u.nome = policial_acao_solicitacoes.unidade_destino);

UPDATE avisos
   SET destinatario_unidade_id = (SELECT u.id FROM unidades u WHERE u.nome = avisos.destinatario_lotacao)
 WHERE coalesce(destinatario_lotacao, '') <> '';

-- Os índices que as consultas de escopo vão usar: "quem é desta unidade?" é a
-- pergunta mais repetida do sistema.
CREATE INDEX IF NOT EXISTS idx_policiais_unidade ON policiais(unidade_id);
CREATE INDEX IF NOT EXISTS idx_escalas_unidade ON escalas(unidade_id);
CREATE INDEX IF NOT EXISTS idx_avisos_destinatario_unidade ON avisos(destinatario_unidade_id);
