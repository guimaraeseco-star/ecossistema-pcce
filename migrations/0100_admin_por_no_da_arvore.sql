-- O Admin Geral passa a ser o administrador de UM NÓ da árvore (E65 + E71).
--
-- Até aqui toda sessão `admin` tinha escopo irrestrito e o departamento era
-- INFERIDO (a lotação do policial vinculado, ou o "departamento padrão" = o
-- mais antigo). Isso funcionava porque o sistema serve um departamento só;
-- passa a não funcionar no dia em que servir dois, e já não funcionava para
-- responder "este admin administra o quê?" sem adivinhar.
--
-- `unidade_id` é esse nó. Hoje é sempre um departamento; a coluna não se chama
-- `departamento_id` porque a E65 prevê o dia em que o administrador se amarra a
-- um nó acima (Delegacia-Geral, uma coordenadoria), e renomear coluna em
-- produção custa mais do que escolher o nome certo agora.
--
-- Backfill: o admin VINCULADO herda o departamento que está acima da lotação
-- do policial dele — subindo a árvore, porque a lotação em regra é uma
-- delegacia, não o departamento. O admin de bootstrap (env, sem policial
-- vinculado) fica NULO de propósito: pela E65 ele deixa de operar e passa a ser
-- só a chave do Super Admin. **Antes do deploy** o Super Admin precisa promover
-- o Admin Geral de carne e osso na tela nova de Administradores — senão não
-- sobra ninguém operando o departamento.
ALTER TABLE administradores ADD COLUMN unidade_id INTEGER REFERENCES unidades(id);

UPDATE administradores
SET unidade_id = (
	WITH RECURSIVE sobe(id, tipo, pai) AS (
		SELECT u.id, u.tipo, u.seccional_id
		FROM unidades u
		WHERE u.nome = (SELECT p.lotacao FROM policiais p WHERE p.id = administradores.policial_id)
		UNION ALL
		SELECT u2.id, u2.tipo, u2.seccional_id
		FROM unidades u2
		JOIN sobe ON u2.id = sobe.pai
	)
	SELECT id FROM sobe WHERE tipo = 'departamento' LIMIT 1
)
WHERE policial_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_administradores_unidade ON administradores(unidade_id);
