-- Fase 1 do Ecossistema PCCE (decisões E23 e E26): a árvore de `unidades` passa
-- a cobrir o organograma inteiro da corporação (Decreto 37.465/2026), não só
-- departamento → subdepartamento → seccional → delegacia.
--
-- `tipo` não tem CHECK no banco (desde a 0004): os valores novos —
-- delegacia_geral, diretoria, coordenadoria, corregedoria, celula, secao,
-- nucleo, unidade — são regidos pelo catálogo `src/lib/unidades/tipos.ts`, e é
-- lá (e no Zod) que a régua vive. `seccional_id` continua sendo o ponteiro
-- genérico de PAI, apesar do nome; renomear a coluna exigiria reconstruir a
-- tabela e reescrever toda referência sem ganho de comportamento.
--
-- `abrangencia` (E26): órgãos de direção/gerência superior e de execução
-- instrumental — Gabinete, DPGI, COGEP, Logística, DTO, Corregedoria, CTIC —
-- são irmãos dos departamentos na árvore, e não ancestrais deles; marcados como
-- `corporativa`, quem os administra vê a corporação inteira. Tudo que existe
-- hoje é `departamental` (o DPI SUL e a sua subárvore).
ALTER TABLE unidades
	ADD COLUMN abrangencia TEXT NOT NULL DEFAULT 'departamental'
	CHECK (abrangencia IN ('departamental', 'corporativa'));
