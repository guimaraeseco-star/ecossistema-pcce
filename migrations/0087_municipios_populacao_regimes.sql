-- Fase 2-B do Ecossistema PCCE: três acertos nos dados da fase 2-A.
--
-- 1. População pelo IBGE. A planilha trazia um valor preliminar do Censo 2022
--    ("População estimada - pessoas [2022]"). A API pública de agregados do
--    IBGE dá o Censo consolidado (tabela 4714) e a ESTIMATIVA anual (tabela
--    6579), e é ela que passa a alimentar a proporção habitantes/policial.
--    `populacao_2022` continua sendo o Censo; a estimativa vai em coluna
--    própria com o ano, porque os dois são números diferentes de fontes
--    diferentes e a tela diz qual está mostrando.
--
-- 2. Área ×1000. O importador tratava a área (número na planilha, 258.788)
--    como texto pt-BR e tirava o ponto — Juazeiro do Norte ficou com
--    258.788 km². Nenhum município do Ceará passa de 10.000 km² (o maior,
--    Santa Quitéria, tem 4.260), então o teto separa o errado do certo.
--
-- 3. Regimes de escala a partir da planilha ("RESUMO DOS PLANTÕES"), decisão
--    do responsável em 16/09/2026: TODA unidade do departamento funciona em
--    expediente; quem aparece como plantonista da semana tem plantão, quem
--    aparece como plantonista do fim de semana tem FDS. A subárvore é
--    percorrida a partir do departamento (sigla), para não tocar nas fixtures
--    de teste, que são raízes soltas.
ALTER TABLE municipios_cobertura ADD COLUMN populacao_estimada INTEGER;
ALTER TABLE municipios_cobertura ADD COLUMN populacao_ano INTEGER;
ALTER TABLE municipios_cobertura ADD COLUMN populacao_atualizada_em TEXT;

UPDATE municipios_cobertura SET area_km2 = area_km2 / 1000.0 WHERE area_km2 > 10000;

WITH RECURSIVE arvore(id) AS (
	SELECT id FROM unidades WHERE sigla = 'DPI SUL' AND seccional_id IS NULL
	UNION ALL
	SELECT u.id FROM unidades u JOIN arvore ON u.seccional_id = arvore.id
)
UPDATE unidades SET tem_expediente = 1 WHERE ativo = 1 AND id IN (SELECT id FROM arvore);

UPDATE unidades SET tem_plantao = 1 WHERE id IN (
	SELECT DISTINCT plantonista_unidade_id FROM plantao_cobertura
	WHERE periodo = 'semana' AND plantonista_unidade_id IS NOT NULL
);

UPDATE unidades SET tem_fds = 1 WHERE id IN (
	SELECT DISTINCT plantonista_unidade_id FROM plantao_cobertura
	WHERE periodo = 'fds' AND plantonista_unidade_id IS NOT NULL
);
