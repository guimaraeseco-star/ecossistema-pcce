-- Completa o `avisos.destinatario_unidade_id` que ninguém gravava (E51).
--
-- A `0102` criou a coluna e fez o backfill do que existia até ali. Mas o único
-- ponto que cria avisos (`criarAvisos`) continuou gravando só o NOME — então
-- todo aviso emitido entre o deploy da `0102` e o desta migração nasceu com o
-- id nulo. Em produção, conferido em 25/09 à noite: os avisos 5 a 11 — sete,
-- emitidos entre 15:13 e 17:13 daquele dia, para Tauá, a 2ª Seccional e Cedro
-- —, TODOS com o id nulo, e TODOS com um nome que casa com uma unidade.
--
-- Isso não fazia diferença enquanto a caixa de avisos filtrava pelo nome. Passa
-- a fazer agora, porque a caixa passa a filtrar pelo id: sem este backfill,
-- cada aviso desses sumiria da caixa de quem deveria lê-lo — exatamente o
-- defeito que a mudança existe para corrigir, só que ao contrário.
--
-- Mesma regra da `0102`: casa pelo nome, e o que não casa fica nulo. Nulo aqui
-- é resposta, não falha — há avisos cujo texto de destino nunca foi unidade
-- ("Aposentadoria", unidades de teste apagadas), e para esses a caixa continua
-- decidindo pelo TEXTO, como sempre decidiu.
--
-- Idempotente: só toca o que ainda está nulo.
UPDATE avisos
   SET destinatario_unidade_id = (SELECT u.id FROM unidades u WHERE u.nome = avisos.destinatario_lotacao)
 WHERE destinatario_unidade_id IS NULL
   AND coalesce(destinatario_lotacao, '') <> '';

-- E o GATILHO, que fecha a janela que o backfill sozinho deixaria aberta.
--
-- O deploy aplica as migrações ANTES de publicar o código novo (de propósito:
-- migração que falha impede o deploy). Entre um passo e outro, por um ou dois
-- minutos, o código ANTIGO continua no ar e continua criando aviso só com o
-- nome. O backfill acima já rodou; esse aviso nasceria com o id nulo e ficaria
-- invisível para sempre na caixa que agora filtra por id.
--
-- O gatilho resolve isso no próprio banco: todo aviso que chega sem o id, mas
-- com um nome que casa com uma unidade, recebe o id na hora. Não depende de o
-- código lembrar — é o que também protege de um caminho de escrita futuro que
-- esqueça. O código novo grava o id por conta própria (`criarAvisos`), e aí a
-- condição do `WHEN` é falsa e o gatilho não faz nada.
--
-- É o primeiro gatilho do projeto. Só age em INSERT: o destinatário de um
-- aviso não muda depois de criado — o que se atualiza é só o "lido".
CREATE TRIGGER IF NOT EXISTS avisos_destinatario_unidade_id
AFTER INSERT ON avisos
WHEN NEW.destinatario_unidade_id IS NULL
 AND coalesce(NEW.destinatario_lotacao, '') <> ''
BEGIN
	UPDATE avisos
	   SET destinatario_unidade_id = (SELECT u.id FROM unidades u WHERE u.nome = NEW.destinatario_lotacao)
	 WHERE id = NEW.id;
END;
