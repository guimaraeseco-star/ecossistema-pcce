-- "Trabalha em" (E66): a lotação é a unidade; o local é onde a pessoa trabalha.
--
-- Decisão do responsável em 22/09/2026. As unidades físicas que não são órgãos
-- da estrutura — os postos de Fortim, Quixeré e Aiuaba e o núcleo de Juazeiro —
-- eram unidades penduradas na SECCIONAL (ou no departamento), e os servidores
-- estavam lotados nelas. Na vida real esses servidores são lotados na delegacia
-- (ou no departamento) e apenas TRABALHAM ali. Então:
--
--   1. as subunidades continuam existindo na árvore, mas penduradas na unidade
--      a que pertencem (Fortim → Aracati, Quixeré → Russas, Aiuaba → Tauá; o
--      núcleo de Juazeiro já pendia do departamento);
--   2. `policiais.local_id` diz onde a pessoa trabalha — a própria lotação
--      (nulo = a sede) ou um DESCENDENTE dela. Quem define é o DPI SUL.
--
-- O backfill move os 21 servidores dessas subunidades para a lotação certa e
-- grava o local. Nenhuma dessas subunidades tem escala (conferido em 22/09),
-- então não há escala a remendar; `unidade_municipios` não se toca — a
-- subunidade continua sendo a responsável pelo município dela.
ALTER TABLE policiais ADD COLUMN local_id INTEGER;--> statement-breakpoint

-- 1. As subunidades passam a pender da unidade a que pertencem.
UPDATE unidades SET seccional_id = (SELECT id FROM unidades WHERE nome = 'Delegacia de Polícia Civil de Aracati')
	WHERE nome = 'Unidade de Atendimento de Fortim';--> statement-breakpoint
UPDATE unidades SET seccional_id = (SELECT id FROM unidades WHERE nome = 'Delegacia de Polícia Civil de Russas')
	WHERE nome = 'Unidade de Atendimento de Quixeré';--> statement-breakpoint
UPDATE unidades SET seccional_id = (SELECT id FROM unidades WHERE nome = 'Delegacia de Polícia Civil de Tauá')
	WHERE nome = 'Unidade de Atendimento de Aiuaba';--> statement-breakpoint

-- 2. Quem estava lotado numa subunidade passa a ser lotado na unidade-pai,
--    trabalhando na subunidade. A ordem importa: o `local_id` é gravado com a
--    lotação ANTIGA ainda no lugar.
UPDATE policiais SET local_id = (SELECT id FROM unidades WHERE unidades.nome = policiais.lotacao)
	WHERE lotacao IN (
		'Unidade de Atendimento de Fortim',
		'Unidade de Atendimento de Quixeré',
		'Unidade de Atendimento de Aiuaba',
		'Departamento de Polícia do Interior Sul - Juazeiro'
	);--> statement-breakpoint
UPDATE policiais SET lotacao = (
		SELECT pai.nome FROM unidades sub JOIN unidades pai ON pai.id = sub.seccional_id
		WHERE sub.id = policiais.local_id
	)
	WHERE local_id IS NOT NULL;--> statement-breakpoint

CREATE INDEX idx_policiais_local ON policiais(local_id);
