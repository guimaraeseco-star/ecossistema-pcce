-- Afastamento: a classificação do CID numa LTS.
--
-- Decisão do responsável em 20/09/2026, ao adotar a tabela de afastamentos do
-- sistema anterior como referência do modal: a licença para tratamento de
-- saúde (LTS) passa a registrar se o diagnóstico é `CID-F` (transtornos
-- mentais e comportamentais) ou `CID-Outras`. Não é curiosidade clínica — é o
-- gatilho da Portaria nº 39/2026/PCCE/GABDG: com CID-F, a unidade recolhe a
-- arma institucional sob cautela, o porte fica suspenso até perícia da DIPEM
-- e a COGEP/COSAÚDE/DTO são comunicadas. O sistema avisa quem cadastra e o
-- DPI SUL; sem a coluna, o aviso não teria de onde nascer.
--
-- Vai nas duas tabelas porque o pedido da unidade (`policial_acao_solicitacoes`)
-- vira o evento (`policial_historico`) na aprovação, campo a campo. Vazia em
-- todo afastamento que não é LTS.
ALTER TABLE policial_acao_solicitacoes ADD COLUMN tipo_cid TEXT;
ALTER TABLE policial_historico ADD COLUMN tipo_cid TEXT;
