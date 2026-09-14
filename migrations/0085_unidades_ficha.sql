-- Fase 2 do Ecossistema PCCE (decisão E39, Gestão de unidade — item 3.1): a
-- ficha da unidade passa a ter o que a delegacia vê de si mesma e o que a
-- planilha "DADOS DAS DELEGACIAS, MUNICIPIO" traz por unidade.
--
-- `foto_url` é o link de origem (Google Drive) e `foto_key` a cópia no R2
-- (`unidades/{id}/foto.jpg`) feita pelo script de importação depois de
-- conferir que o link abre; a ficha usa o R2 e cai na URL se não houver cópia.
-- `ais` é a AIS da unidade (uma só — a da linha do município-sede na
-- planilha); a AIS de cada município atendido fica em `municipios_cobertura`.
ALTER TABLE unidades ADD COLUMN endereco TEXT NOT NULL DEFAULT '';
ALTER TABLE unidades ADD COLUMN telefone TEXT NOT NULL DEFAULT '';
ALTER TABLE unidades ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE unidades ADD COLUMN foto_url TEXT;
ALTER TABLE unidades ADD COLUMN foto_key TEXT;
ALTER TABLE unidades ADD COLUMN ais TEXT NOT NULL DEFAULT '';
ALTER TABLE unidades ADD COLUMN tira_gravame INTEGER NOT NULL DEFAULT 0;
ALTER TABLE unidades ADD COLUMN xadrezes INTEGER NOT NULL DEFAULT 0;
