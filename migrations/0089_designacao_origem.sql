-- Fase 2-C: quem manda na DESIGNAÇÃO do servidor.
--
-- A designação (a função exercida: Delegado Titular, Chefe de seção de
-- cartório, Operacional…) chegou pela planilha de pessoal e é regravada a cada
-- carga — `designacao_id` está no grupo "a folha é dona" de `colunasDoPolicial`.
-- A partir da tela de servidores o Admin Geral também a edita, e sem esta
-- coluna a próxima carga desfazia a correção dele em silêncio.
--
-- A régua é a MESMA de `unidade_responsaveis.origem`, e de propósito: o que a
-- TELA definiu vence, e a carga apenas RELATA a divergência em vez de
-- sobrescrever (o aviso sai na resposta do webhook e no relatório do
-- `scripts/importar-servidores.mjs`). Linha carregada da planilha continua
-- `'planilha'` — o default —, então recarregar a folha segue funcionando para
-- os 696 servidores que ninguém tocou.
ALTER TABLE policiais ADD COLUMN designacao_origem TEXT NOT NULL DEFAULT 'planilha'
	CHECK (designacao_origem IN ('planilha', 'sistema'));
