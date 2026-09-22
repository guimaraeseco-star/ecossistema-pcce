-- Respondência TEMPORÁRIA (decisão E68, 22/09/2026).
--
-- Até aqui a única respondência era a de VACÂNCIA: a unidade sem titular, com
-- um delegado de outra respondendo por ela por tempo indeterminado. Falta a do
-- dia a dia — o titular sai de férias ou se afasta, alguém responde ENQUANTO
-- ele está fora, e ele continua titular e volta sozinho no fim.
--
-- Por isso três colunas e um índice novo:
--
--   `carater`               distingue as duas. O que já existe é `permanente`
--                           (titular e respondente de vacância); a nova figura
--                           é `temporaria`.
--   `substitui_policial_id` quem ela cobre — o titular que se afastou. Guardar
--                           o id, e não deduzir "o titular da época", é o que
--                           permite ler a sucessão anos depois sem refazer a
--                           conta.
--   `evento_id`             o afastamento (`policial_historico`) que a
--                           originou. É o vínculo que faz o retorno antecipado
--                           (E58) encurtar a respondência junto, em vez de
--                           deixar um substituto vigente com o titular de volta.
--
-- O índice de unicidade passa a ser por (unidade, caráter): a unidade pode ter
-- ao mesmo tempo UM permanente aberto e UMA temporária aberta — é justamente o
-- caso das férias do titular. Sem isso o INSERT da temporária esbarraria no
-- titular vigente.
ALTER TABLE unidade_responsaveis ADD COLUMN carater TEXT NOT NULL DEFAULT 'permanente';
ALTER TABLE unidade_responsaveis ADD COLUMN substitui_policial_id INTEGER REFERENCES policiais(id);
ALTER TABLE unidade_responsaveis ADD COLUMN evento_id INTEGER REFERENCES policial_historico(id);

DROP INDEX IF EXISTS idx_unidade_responsaveis_vigente;
CREATE UNIQUE INDEX idx_unidade_responsaveis_vigente
	ON unidade_responsaveis(unidade_id, carater)
	WHERE data_fim IS NULL;

CREATE INDEX IF NOT EXISTS idx_unidade_responsaveis_evento ON unidade_responsaveis(evento_id);
