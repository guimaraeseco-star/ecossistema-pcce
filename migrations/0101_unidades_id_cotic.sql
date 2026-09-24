-- O CÓDIGO DA UNIDADE NA COTIC, ao lado do nosso id (decisão dele em 24/09).
--
-- A COTIC vai mandar a lista oficial das delegacias com os códigos dela. A
-- pergunta era se esses códigos deviam VIRAR o `unidades.id` ou morar ao lado;
-- ele escolheu ao lado, e a razão está na conta: hoje mais de doze colunas
-- apontam para `unidades.id` (a árvore em `seccional_id`, o papel do
-- administrador, o local de trabalho, a direção, a cobertura de municípios, os
-- planos, as GISE, o nó da conta administrativa). Reescrever a chave primária
-- para adotar uma numeração externa é a operação mais arriscada que este banco
-- comporta, e qualquer linha esquecida passaria a apontar para a unidade
-- errada em silêncio.
--
-- O código da COTIC é um DADO da unidade — como a sigla, o AIS ou o telefone —,
-- não a identidade dela aqui dentro. Fica em TEXTO de propósito: código externo
-- pode ter zero à esquerda ou letra, e um inteiro comeria os dois.
--
-- Índice PARCIAL, pela mesma razão da sigla (0080): só os preenchidos entram.
-- Enquanto a lista não chega, todas as unidades ficam com '' — e um UNIQUE
-- pleno recusaria a segunda unidade sem código.
ALTER TABLE unidades ADD COLUMN id_cotic TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_unidades_id_cotic
	ON unidades (id_cotic) WHERE id_cotic <> '';
