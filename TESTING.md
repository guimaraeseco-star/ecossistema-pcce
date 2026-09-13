# Testes Manuais — ESCALAS

Roteiro de regressão manual dos fluxos de negócio. **Papel deste arquivo: exceção, não gate** — a regressão padrão é a suíte automatizada (`npm run test` + `npm run test:e2e`, ambas no CI). Use este roteiro para o que a automação não alcança (hardware físico, caixa de e-mail real, ACT ICP) e para QA exploratório antes de releases grandes. Casos já automatizados estão marcados com `[E2E: <spec>]` — não precisam de reexecução manual.

> **Rodando o E2E na sua máquina — duas armadilhas que dão FALSO VERDE:**
>
> 1. **`SUPER_ADMIN_LOGIN` de dev no `.dev.vars` faz os specs de Super Admin PULAREM, em silêncio.** `e2e/servidor-e2e.ts` preserva o valor que já existe (para não destruir seu ambiente), e `isSuperAdmin` sai da igualdade com `administradores.login` do fixture. Com um login diferente de `e2e-super-admin`, o probe do `beforeAll` dá 403 e os testes viram `-` no relatório em vez de `✓`. **Confira a contagem de `skipped`**, não só o "passed" — foi assim que um teste quebrado do `plano-operacional.spec.ts` passou local e reprovou no CI. Para exercitá-los, fixe `SUPER_ADMIN_LOGIN=e2e-super-admin` (e restaure depois).
> 2. **Form action postada com `x-sveltekit-action` responde HTTP 200 mesmo quando recusa.** O `fail()` vira `action_json({ type: 'failure', status }, undefined)` e o status real vai no CORPO. Asserte o corpo (`resultadoDaAction` em `plano-operacional.spec.ts`), nunca `res.status()`.

> **Fluxo Token A3 (presença GISE no desktop):** roteiro dedicado em [`docs/QA_ASSINATURA_A3_DESKTOP.md`](docs/QA_ASSINATURA_A3_DESKTOP.md) — o Assinador SERPRO + token físico seguem manuais, mas a cadeia criptográfica do fluxo A3 (preparar → CMS → finalizar → validar) roda em CI com CA de teste (`e2e/assinatura-qualificada-a3.spec.ts`).

## 1. Autenticação e Sessão

### 1.1 Login com 2FA (Fluxo Principal)

- [ ] Acessar `/login` sem estar autenticado
- [ ] Submeter matrícula + senha corretos → receber e-mail com código 2FA
- [ ] Inserir código 2FA correto → redirecionar para a tela de boas-vindas conforme papel `[E2E: boas-vindas-rbac.spec.ts — exceto Super Admin, que depende de SUPER_ADMIN_LOGIN]`
  - Super Admin → `/super-admin`
  - Admin Geral → `/` (home de módulos em quatro grupos; os cartões seguem os módulos LIGADOS na conta; a troca GISE ↔ Escalas na sidebar só filtra a barra)
  - Admin Seccional / Unidade → `/` (home de módulos; `/escalas/bem-vindo` e `/gise/bem-vindo` redirecionam com 301)
  - Demais policiais → `/bem-vindo` (cards de atalho conforme papel/GISE)

### 1.2 Validações de Login

- [ ] Senha incorreta → mensagem de erro (sem revelar se matrícula existe)
- [ ] 5 tentativas falhas seguidas → bloqueio por 15 minutos (rate limiting)
- [ ] Código 2FA expirado → mensagem informando expiração
- [ ] Código 2FA incorreto 5 vezes → o desafio esgota e nem o código certo passa mais `[Vitest: desafio-2fa-uso-unico.test.ts]`
- [ ] Código 2FA correto usado DUAS vezes → só a primeira cria sessão `[Vitest: desafio-2fa-uso-unico.test.ts]`
- [ ] Pedir código de redefinição 4× em 10 min → o 4º é recusado sem enviar e-mail `[Vitest: janela-timestamp.test.ts]`

### 1.3 Redefinição de senha

- [ ] Abrir o link de redefinição duas vezes na MESMA tela e submeter as duas → só a primeira troca a senha; a segunda diz "inválido ou já utilizado" `[Vitest: token-redefinicao-uso-unico.test.ts]`
- [ ] Link expirado → "expirou, solicite um novo", e o link continua expirado (não vira "inválido") na segunda tentativa

### 1.4 Primeiro Acesso

> `[Vitest: onboarding-gates.test.ts]` cobre a REGRA das duas fases: com
> `primeiro_acesso` pendente o portão do Termo não é imposto em rota nenhuma;
> resolvido, vale a allowlist do Termo. Manual: a tela de ponta a ponta.

- [ ] Login com credencial temporária → redirecionar para `/alterar-senha`
- [ ] Tentar acessar outra página sem alterar senha → redirecionado de volta
- [ ] "Enviar código" → o OTP chega no e-mail pessoal informado, e o passo **não** morre com "Aceite o Termo de Uso vigente antes de continuar" (o aceite vem depois — as duas APIs de verificação de e-mail correm dentro da fase 1)
- [ ] Conta cujo e-mail pessoal JÁ estava preenchido (ex.: após `users:set-default-password`) → o "Enviar código" **não** pede a senha de acesso; fora do primeiro acesso, em Meu Perfil, a troca do e-mail pessoal continua pedindo
- [ ] Sem confirmar o e-mail pessoal, o botão "Definir senha e continuar" fica desabilitado; POST direto da action → 400 ("Confirme seu e-mail pessoal antes de concluir o primeiro acesso")
- [ ] Alterar senha com sucesso → **cai em `/aceitar-termo`** (com o termo vigente pendente); aceitar → boas-vindas do papel
- [ ] A tela de primeiro acesso **não** oferece cadastrar a chave de assinatura — nem no celular, com ou sem `exigir_passkey_assinatura` ligada
- [ ] "Sair e voltar ao login" encerra a sessão; reabrir o sistema cai em `/login`, **não** devolve para `/alterar-senha`

### 1.4b Colaborador (terceira identidade)

> `[Vitest: colaborador-rotas.test.ts, auth-flow.test.ts (colaborador), credencial.test.ts (colaborador), colaboradores.test.ts]` cobrem a lista fechada de rotas, o login sempre com 2FA, a credencial standalone e a recusa de sessão de tipo desconhecido. Manual: o fluxo de ponta a ponta.

- [ ] **Admin Geral** (não só o Super Admin) vê "Colaboradores" na barra lateral, ao lado de "Policiais", e abre `/colaboradores`; admin de seccional e de unidade **não** veem o item, e a URL direta os manda para fora
- [ ] Admin Geral → `/colaboradores` → "Cadastrar" (nome, e-mail, CPF opcional, vínculo) → a senha provisória aparece UMA vez na caixa amarela; "Copiar" funciona; "Fechar" some com ela
- [ ] E-mail repetido (mesmo com caixa diferente) → "Já existe um colaborador com este e-mail"; CPF inválido → "CPF inválido"
- [ ] `/login` → "Sou colaborador(a)" → campo vira E-mail, some o certificado e "Esqueceu a senha?"; "Voltar" restaura o alternador
- [ ] Login com a senha provisória → **pede o código por e-mail mesmo sendo primeiro acesso** → código certo → `/alterar-senha` sem pedir e-mail pessoal → senha nova → `/aceitar-termo` → `/colaborador` (área com "Nenhuma função designada")
- [ ] Sidebar do colaborador tem só "Boas-vindas" e "Sair"; digitar `/escalas`, `/perfil`, `/res-gise` ou `/painel` na URL volta para `/colaborador`; `fetch` de `/api/sync/estado` responde 403
- [ ] Admin Geral → "Nova senha" → nova provisória; a sessão aberta do colaborador cai no próximo request; o próximo login exige troca de novo
- [ ] "Desativar" → o login responde "E-mail ou senha inválidos" (mesma mensagem de senha errada); "Reativar" restaura
- [ ] Policial e admin: login, 2FA, primeiro acesso e assinatura **inalterados**

### 1.5 Login por certificado A3 (desktop, Assinador SERPRO)

- [ ] Aba **Policial** → "Entrar com Certificado Digital" → assinar o desafio no token → sessão operacional criada (sem senha e sem 2FA)
- [ ] Aba **Administrador** → sessão de admin criada se o policial do certificado tiver conta admin vinculada; redireciona para a boas-vindas do módulo que a conta permite (troca na sidebar se tiver os dois)
- [ ] Certificado de policial SEM vínculo admin na aba Administrador → 403 com mensagem clara
- [ ] Certificado revogado (OCSP) → login recusado

### 1.6 Logout

- [ ] Clicar em logout → sessão encerrada, cookie removido
- [ ] Tentar acessar página protegida após logout → redirecionar para `/login`
- [ ] Sessão expirada (após 8h) → redirecionar para `/login` ao tentar qualquer ação

---

## 2. Troca de Senha (`/alterar-senha`)

- [ ] Acessar com usuário autenticado
- [ ] Informar senha atual incorreta → erro de validação
- [ ] Informar nova senha igual à atual → erro ou aviso
- [ ] Alterar senha com sucesso → confirmação e redirecionamento
- [ ] Nova senha muito curta/fraca → validação de política de senha (se existir)

---

## 3. Gestão de Escalas (`/escalas`)

### 3.1 Listagem

- [ ] Visualizar lista de escalas com paginação
- [ ] Filtrar por lotação
- [ ] Filtrar por mês/ano
- [ ] Filtrar por tipo (plantão / expediente / FDS)
- [ ] Busca por texto
- [ ] Limpar filtros → lista completa restaurada
- [ ] Filtros persistem ao navegar entre páginas (localStorage)
- [ ] Admin sem escalas → estado vazio com mensagem

### 3.2 Criar Escala (modal "Nova Escala" em `/escalas`)

> `[E2E: escala-crud.spec.ts]` cobre a criação pela action (`?/criar`): admin de unidade cria e a escala aparece na listagem; policial sem papel → 403; duplicata de tipo/lotação/período → 409. Manual: o modal em si (etapas de tipo→data) e o redirect para `/escalas/[id]`.

- [ ] Card "Nova Escala" (home) e botão da listagem abrem o modal
- [ ] Escolher tipo (plantão mensal / expediente mensal / FDS) → etapa de data correspondente
- [ ] Mês/FDS que já possui escala para a lotação → aviso/bloqueio de duplicata
- [ ] Criar escala com dados válidos → redireciona para `/escalas/[id]` (edição)
- [ ] Cancelar/fechar o modal → volta ao estado anterior sem criar
- [ ] Escala criada → aparece na listagem
- [ ] (servidor) Policial sem papel de administração → 403 ao criar via POST direto (`/escalas?/criar`)

### 3.3 Editar Escala (`/escalas/[id]`)

> `[E2E: escala-crud.spec.ts]` cobre o `?/adicionar` servidor: admin adiciona e o servidor aparece na lista devolvida; mesmo servidor/data de novo → 409 (choque global); policial de outra lotação → 403. Manual: edição inline de campos, remoção e os fluxos por tipo (plantão/FDS) na tela.

- [ ] Carregar página com dados corretos da escala
- [ ] Editar campos e salvar → dados atualizados
- [ ] Editar campos com dados inválidos → erro de validação
- [ ] Adicionar policial à escala (data de plantão, horário, equipe)
- [ ] Remover policial da escala → policial removido
- [ ] Adicionar policial inexistente ou inativo → erro

### 3.4 Deletar Escala

- [ ] Solicitar exclusão → confirmação solicitada
- [ ] Confirmar exclusão → escala removida da listagem
- [ ] Cancelar exclusão → nada alterado
- [ ] (servidor) Policial sem papel de administração → 403 ao excluir via POST direto (`/escalas?/excluir`) `[E2E: escala-crud.spec.ts]`
- [ ] Excluir escala assinada (por qualquer caminho: /escalas, /recebidos, /painel) → documento, cópia de conferência e selfie removidos do R2 junto _(revogação e re-assinatura: `[E2E: escala-revogacao.spec.ts]`; limpeza R2 no unitário `r2-cleanup.test.ts`)_

### 3.5 Marcar Visto

- [ ] Admin marca escala como "vista" → status atualizado

---

## 4. Escala extra (`/gise`)

### 4.1 Listagem

- [ ] A aba da sidebar chama-se **Escala extra** (não "Escalas GISE")
- [ ] Admin vê todas as escalas
- [ ] Supervisor vê apenas a sua
- [ ] Membro vê a escala atribuída
- [ ] Escalas com diferentes status exibidas corretamente
- [ ] Com mais de uma operação cadastrada, os chips de filtro aparecem; clicar em
      um deles deixa só as escalas daquela operação, e a paginação volta à
      página 1
- [ ] Cada card mostra o selo da operação (sigla, ou nome se não houver sigla)
- [ ] `/gise` lista só as escalas ativas; o histórico não aparece nesta página
- [ ] Admin Geral vê a aba **Finalizadas** no submenu, entre Ativas e Produtividade
- [ ] `/gise/finalizadas` mostra a busca detalhada das escalas encerradas
- [ ] Supervisor / admin seccional / policial não vê a aba Finalizadas; abrir a
      URL redireciona para `/gise`

### 4.2 Criar escala extra

- [ ] Criar com data de início, hora entrada/saída e supervisor
- [ ] Datas inválidas → validação
- [ ] Criada → aparece com status `em_definicao_supervisor`
- [ ] O modal pede a **operação**; a escala nasce com o selo dela
- [ ] Operação desativada não aparece no seletor

### 4.3 Clonar escala extra

- [ ] Clonar estrutura de escala anterior → nova com mesma estrutura de seccionais/equipes
- [ ] No modo "Copiar" o seletor de operação **não** aparece — a cópia herda a
      operação do original (clonar uma escala da CRAJUBAR não pode gerar uma do
      GISE)

### 4.4 Gerenciar Seccional (`/gise/[id]`)

- [ ] Adicionar seccional à GISE
- [ ] Atualizar dados da seccional (horário, unidade operacional)
- [ ] Deletar seccional → removida da GISE
- [ ] Adicionar seccional duplicada → erro

### 4.5 Abas de unidade no quadro da seccional

> `[E2E: gise-abas-unidade.spec.ts]` cobre trocar de aba, a aba nova abrindo
> selecionada, a barra sem rolagem vertical e o horário herdado saindo como
> relógio. Manual: o que só aparece com DADO REAL — muitas delegacias na barra e
> nomes longos.

- [ ] Seccional com **seis ou mais** delegacias → a barra rola na horizontal, em
      UMA linha só, sem barra de rolagem vertical
- [ ] Nome longo ("Delegacia de Polícia Civil de …") → a aba mostra o município;
      o nome completo aparece no `title` e no topo do painel
- [ ] Unidade com vaga não preenchida → ponto âmbar na aba, sem precisar abri-la
- [ ] Remover a unidade da aba ABERTA → o painel cai para outra aba existente
      (não fica em branco)
- [ ] No celular, tocar nas abas troca o painel e o **+ Equipes** age na unidade
      aberta

### 4.6 Gerenciar Equipes

- [ ] Criar equipe operacional com slots DPC/OIP
- [ ] Criar equipe SEINT
- [ ] Atualizar slots de equipe
- [ ] Deletar equipe → removida
- [ ] Equipe SEM horário próprio → o card mostra o relógio (e o horário em vigor
      ao passar o mouse), não o horário escrito
- [ ] Editar o horário da equipe para um valor DIFERENTE → o horário passa a
      aparecer escrito, na tarja âmbar
- [ ] Editar e salvar o MESMO horário da seccional → volta ao relógio (não é
      horário próprio)
- [ ] O mesmo vale para o cabeçalho da seccional contra o horário da escala

### 4.7 Gerenciar Membros

- [ ] Adicionar policial ativo à equipe
- [ ] Remover policial da equipe
- [ ] Adicionar policial além do limite de slots → erro ou aviso
- [ ] Adicionar policial inativo → erro

### 4.8 Fluxo de Status GISE

Verificar cada transição de status:

| De                            | Para                          | Ação                        |
| ----------------------------- | ----------------------------- | --------------------------- |
| `em_definicao_supervisor`     | `em_preenchimento`            | Supervisor define estrutura |
| `em_preenchimento`            | `aguardando_assinatura`       | Seccional preenchida        |
| `aguardando_assinatura`       | `em_andamento`                | Após assinatura             |
| `em_andamento`                | `aguardando_relatorios`       | Operação encerrada          |
| `aguardando_relatorios`       | `aguardando_assinatura_relat` | Relatórios submetidos       |
| `aguardando_assinatura_relat` | `pronta_para_finalizar`       | Relatórios assinados        |
| `pronta_para_finalizar`       | `finalizada`                  | Finalização                 |

- [ ] Verificar cada transição acima
- [ ] Reabrir GISE finalizada → status volta ao estado anterior
- [ ] Tentar forçar transição de status inválida → erro

### 4.9 Finalizar GISE

- [ ] Finalizar GISE no status correto → status `finalizada`
- [ ] Tentar finalizar GISE em status incorreto → erro

### 4.10 Operações (`/gise/operacoes`, Admin Geral)

- [ ] A tela lista `GISE` e `OPERAÇÃO CRAJUBAR` (semeadas pelas migrações), com a
      contagem de escalas de cada uma
- [ ] Criar operação **EDGE** marcando só "Inteligência (SEINT)" e escolhendo
      `GISE` em "basear o formulário em" → a EDGE nasce com o formulário SEINT
      copiado e SEM o operacional
- [ ] Nome repetido → erro 409 legível ("Já existe uma operação chamada…")
- [ ] Desmarcar os dois tipos de equipe → erro de validação
- [ ] Desativar tira a operação do seletor de criação de escala e dos filtros,
      mas ela continua aparecendo no cadastro
- [ ] **Excluir** aparece só na operação sem escala nenhuma; na `GISE` e na
      `CRAJUBAR` só há "Desativar"
- [ ] Policial comum abrindo `/gise/operacoes` → redirecionado

### 4.11 Formulário da operação (`/gise/operacoes`)

> `[E2E: operacoes-formulario.spec.ts]` prova o formulário único de criação e
> edição (identidade + configuração gravadas juntas), o preenchimento na
> reabertura, a distinção `NULL` × `0` das vagas, o placeholder do valor
> herdado, `#f_base` só na criação, o redirecionamento do endereço antigo de
> configurações, e a exclusão — inclusive que ela leva o formulário junto
> (`gise_modelo_formulario` da operação → 0) e que o botão some assim que a
> operação ganha uma escala.
>
> Manual: o que só se vê rolando a tela, com o histórico do navegador, ou
> gerando PDF.

**O slider:**

- [ ] "Nova operação" desliza a tela para a esquerda; a lista sai de vista e o
      formulário ocupa a largura toda
- [ ] "Editar" numa linha faz o mesmo deslize
- [ ] O "voltar" do NAVEGADOR fecha o painel e devolve a lista
- [ ] Abrir uma operação, voltar e abrir outra → os campos são os da segunda (não
      sobra texto da primeira)
- [ ] A LISTA não tem botão de voltar — Operações tem entrada própria na barra
      lateral

**Os botões (§10 do README):**

- [ ] Com as três linhas do cadastro lado a lado, os botões de todas terminam na
      **mesma margem direita**, ancorados no topo — a linha com quatro botões não
      pode descer inteira para baixo do texto
- [ ] Faltando largura, o grupo quebra **dentro de si** (um botão desce), nunca
      em bloco
- [ ] "Nova operação" tem a altura de botão de navegação, não de CTA de modal

**Os campos:**

- [ ] Esvaziar um campo já preenchido e salvar → volta a mostrar o valor herdado
      em cinza
- [ ] Desmarcar um tipo de equipe → o bloco de vagas daquele tipo some na hora
- [ ] Horário fora do formato `HH:MM` → erro de validação; vazio é aceito (herda)

**Efeitos:**

- [ ] Criar escala nova pela operação configurada → nasce com o horário e as
      vagas dela; trocar a operação no modal troca os horários sugeridos
- [ ] Alterar o texto do breve relatório e gerar o PDF de extra de uma escala
      daquela operação → o texto novo aparece; numa escala de OUTRA operação, não
- [ ] A confirmação de exclusão cita o formulário que se perde, além do nome

### 4.12 Navegação do módulo (barra lateral)

> `[E2E: sidebar-escala-extra.spec.ts]` prova o agrupamento em dois níveis: a
> raiz encolhe, o submenu SUBSTITUI a barra (os itens da raiz somem em vez de
> indentar), o voltar restaura, a gaveta abre já no submenu quando a rota é de
> um filho e na raiz quando não é, o item da rota atual fica aceso, e o recorte
> por papel de Admin Geral (Operações na RAIZ) e de policial comum.
> `[E2E: operacoes-linha-base.spec.ts]` prova que "Dados base" só aparece na
> linha da operação que pede base e para o admin da unidade que participa dela.
>
> Manual: teclado, leitor de tela, os papéis que as fixtures não cobrem e o
> tempo de cache.

**O menu de dois níveis:**

- [ ] Só pelo teclado: Tab até "Escala extra", Enter, e o foco cai no voltar;
      Enter de novo devolve o foco ao pai
- [ ] Com leitor de tela, entrar e sair do submenu é anunciado (o `aria-label`
      da navegação troca entre "Menu principal" e "Escala extra")
- [ ] O chevron do pai aponta para a direita e gira ao abrir

**O que cada papel vê no submenu:**

- [ ] Admin seccional: os cinco itens
- [ ] Policial sem nenhuma participação: **o pai não aparece** (submenu vazio não
      ganha porta)

**Os itens da RAIZ (Admin Geral):**

- [ ] "Operações" e "Plano Op." aparecem lado a lado, e a rota atual acende só um
      dos dois — estar em `/gise/planos` **não** pode acender "Ativas"
- [ ] "Valores de custo" NÃO aparece para o Admin Geral: é aba do Super Admin
- [ ] A home de módulos (`/`) tem um cartão ou atalho para cada item do menu
      (`__tests__/home-modulos.test.ts` reprova o esquecimento, mas a
      conferência visual é a que pega texto trocado); a barra mostra os mesmos
      quatro grupos da home (Gestão de pessoal · operacional · de unidade ·
      Administrativo) e "Início" leva a `/`
- [ ] Cartão planejado (Diárias, Extras, Armamento, Veículos, Patrimônio móvel,
      Municípios, Atualização de valores) aparece desligado com "Em breve · fase N";
      Municípios e Atualização de valores só para o Admin Geral
- [ ] Gestão de unidade: admin de unidade cai direto na ficha da delegacia; admin
      de seccional vê a tabela com a seccional no topo e as delegacias dela;
      Admin Geral vê o departamento, as seccionais e as delegacias em blocos, com
      busca por qualquer parte do nome; cada número de efetivo abre `/policiais`
      filtrado; id de unidade fora do escopo na URL → 403

**Herdado dos ciclos anteriores:**

- [ ] `/res-gise` (Admin Geral) mostra "VOLTAR ÀS OPERAÇÕES" acima do título
- [ ] Admin de unidade fora de qualquer escala → **não** vê "Dados base"
- [ ] Desativar a operação → o item some do menu do admin daquela unidade em até
      1 minuto (cache de 60s)

### 4.13 Indicadores e linha de base

**Configurar o indicador** (`/res-gise`, Admin Geral):

- [ ] O seletor de operação troca o formulário mostrado
- [ ] Numa pergunta do tipo Número, marcar "usar como indicador de meta",
      escolher **diminuir**, meta **20%**, unidade "procedimentos" e salvar
- [ ] O bloco de indicador **não** aparece em pergunta de texto livre
- [ ] Em pergunta que não seja de cobertura, a opção "Cobertura — % do total
      atendido" do **Tipo de meta** aparece desabilitada, com a explicação abaixo

**Informar a base** (`/dados-base/<operação>`, admin de unidade/seccional):

> `[E2E: operacoes-linha-base.spec.ts]` prova a tela sem seletor de operação, o
> 404 de id inexistente, o redirecionamento direto quando há uma pendência só e
> a ausência de "Voltar" nesse caso, o retorno do Admin Geral a `/gise/operacoes`,
> o recorte às unidades administradas, a gravação da base própria e a recusa do
> POST direto na base de outra unidade.

- [ ] Com MAIS DE UMA pendência, `/dados-base` mostra a lista para escolher (e
      nenhum campo)
- [ ] Sem pendência nenhuma → texto explicando as duas condições (meta percentual
      **e** unidade escalada)
- [ ] Informado o valor e salvo, o card passa a "Todos informados"
- [ ] Campo deixado em branco não grava nada (em branco é "ainda não sei", não zero)

**Escape pelo formulário** (`/res-gise/relatorio/[giseId]`, policial):

- [ ] Com a base NÃO informada, o campo "valor antes da operação" aparece na
      etapa em que a pergunta está, e o valor é gravado ao enviar o relatório
- [ ] Com a base já informada pela aba, o campo **não** aparece — e retificar o
      relatório não sobrescreve o valor oficial da unidade

**Meta de cobertura** (o tipo `proporcao`):

> `[E2E: cobertura.spec.ts]` prova os dois campos e os rótulos no editor, a meta
> de cobertura sem "Objetivo" (100% por padrão), a reconstrução do objeto ao
> trocar o tipo de meta (sem `objetivo` pendurado), a razão "75% (9 de 12)" na
> tela, o aviso de parte maior que o total sem bloquear a gravação, e o "sem
> ocorrências no período" com total zero.

- [ ] No PDF do relatório de produtividade, a pergunta sai como "9 de 12 (75%)"
      numa linha só
- [ ] Em `/dados-base`, o indicador de cobertura **não** aparece — ele não pede
      valor inicial a ninguém

**Gráficos** (`/produtividade`):

- [ ] O filtro de operação troca os indicadores mostrados
- [ ] O card de um indicador de cobertura mostra UMA série em porcentagem, com o
      tique da meta no mesmo lugar em todas as unidades; a tabela dele traz
      Total, Atendidas e Cobertura (e não "Linha de base")
- [ ] Unidade sem nenhuma ocorrência no período **não** entra no contador
      "N/M unidades na meta" — não havia o que atender
- [ ] Cada card mostra base, realizado e a marca da meta por unidade, e o
      contador "N/M unidades na meta"
- [ ] Unidade sem base aparece no aviso de pendência, e a barra dela fica sem a
      marca de meta
- [ ] "Ver como tabela" mostra os mesmos números em texto
- [ ] Alternar tema claro/escuro redesenha o gráfico com a tinta certa
- [ ] Eixo em pt-BR (`1.240`, não `1,240`)
- [ ] Admin de unidade entra e vê **apenas** os dados da própria unidade

**O que entra no painel, e em que forma:**

> `[E2E: produtividade-graficos.spec.ts]` + `produtividade/__tests__/questions`
> provam que só a pergunta marcada vira gráfico, que desligar UMA forma tira só
> o card dela, que os blocos fixos somem na operação cujo formulário não tem a
> pergunta e aparecem na que tem, que a caixa "Detalhamento" fica desabilitada
> onde não há quebra por tipo, que a operação sem nada a mostrar explica o que
> fazer, e que o editor reflete o que está gravado.
>
> Manual: a virada sobre os dados REAIS. Os dois itens de conferência pós-deploy
> das migrações `0053`/`0054` saíram daqui — eram verificação de UMA subida, já
> feita, e o banco está em `0062`. Roteiro manual descreve o comportamento
> permanente; conferência de migração específica vive no `DEPLOY.md`, junto da
> migração.

- [ ] A pergunta de **drogas** e a de **armas** vêm com "Ranking de unidades" e
      "Detalhamento por tipo" marcadas, e "Colunas" desmarcada
- [ ] Reabrir o formulário do policial → os campos continuam lá e continuam
      sendo preenchidos (a marca é de exibição, não de coleta)
- [ ] Marcar uma sub-pergunta (nível 1) → ela também vira card
- [ ] Desmarcar a pergunta **7. PRISÕES/APREENSÕES FLAGRANTE** → o card "Total de
      Presos (P7)" do bloco de prisões **continua** com o número certo (ele não
      depende da marca)
- [ ] Com cards desmarcados, "Selecionar Todos (N)" conta só o que está na tela,
      e a exportação em PNG não gera imagem de card ausente
- [ ] Exportar o PNG do ranking de drogas → o peso sai em **kg**; o do
      detalhamento, em **g** (é a mesma conta em unidades diferentes)

**O título do card (`rotulo_painel`):**

- [ ] No card de uma pergunta do editor, a ordem é: texto e tipo → rótulos do
      campo inteligente → as caixas de painel e de meta → **"Título no painel de
      produtividade"**
- [ ] Com o campo vazio, o placeholder mostra o que vai sair — o texto da
      pergunta, ou "Drogas"/"Armas" nas duas de identidade própria
- [ ] Preencher, salvar e abrir `/produtividade` → o card usa o título curto, nas
      **colunas, no ranking e no detalhamento** (era só o ranking que respeitava
      "Drogas"; as colunas mostravam o enunciado inteiro)
- [ ] Marcar a mesma pergunta como indicador → o card da seção "Indicadores e
      metas" usa **o mesmo** título, sem um segundo campo para preencher
- [ ] Escrever um título na pergunta de **drogas** → ele ganha de "Drogas", mas o
      peso continua saindo em **kg** (o campo muda o nome, não a unidade)
- [ ] Deixar só espaços no campo → o card volta ao padrão, sem cabeçalho em
      branco
- [ ] Baixar o PNG do card → a imagem sai com o título novo
- [ ] Gerar o relatório assinado da escala → o PDF continua com o **enunciado**
      da pergunta, não com o título do painel

**Rodapé de salvar do editor** (`/res-gise`, Admin Geral):

- [ ] Abrir o editor → o botão "Salvar Modelo" está visível **sem rolar**, no pé
      da tela, e o status diz **"Tudo salvo"**
- [ ] Rolar até o fim da lista de perguntas → o rodapé continua no pé, e o fim da
      página não fica escondido atrás dele
- [ ] Editar qualquer campo (texto, etapa, uma caixinha) → o status vira
      **"Alterações não salvas"** com a bolinha amarela
- [ ] Salvar → volta para "Tudo salvo" sozinho, sem recarregar a página
- [ ] Trocar a aba Operacional/SEINT sem editar nada → "Tudo salvo" nas duas
- [ ] No celular, o rodapé não cobre o último campo do formulário

**Tipos de lista: o genérico e os aposentados:**

> `[E2E: lista-reutilizavel.spec.ts]` + `produtividade-graficos.spec.ts` provam
> que o tipo aposentado não é oferecido em pergunta nova, que duas perguntas do
> tipo genérico não misturam suas listas, e que a pergunta de lista vira ranking
> com o gate do "Sim" (responder "Não" zera a contagem do painel).

- [ ] Abrir a pergunta 4 da GISE (que já é `prisoes_maiores`) → o tipo aparece
      no grupo **"Aposentados"**, selecionado, com o aviso abaixo. Salvar sem
      mexer **não** troca o tipo dela
- [ ] Na pergunta genérica, preencher **"Nome de cada item no relatório"** com
      `Procedimento` → no PDF as linhas saem como "↳ Procedimento 1"; em branco,
      saem como "↳ Item 1"

---

## 5. Plano operacional (`/gise/planos` e `/config-custos`)

> Módulo de ago/2026 — a operação COM deslocamento de equipes. Cobertura
> automatizada: `src/lib/planos/__tests__/` (faixa de custo, janela de horas,
> diárias, consolidado), `src/lib/db/planos/__tests__/` (numeração, chefe único,
> um servidor por plano), os goldens `plano_operacional*` em
> `pdf-goldens.test.ts` e `[E2E: plano-operacional.spec.ts]`, que percorre
> valores → plano → equipe → PDF, incluindo a recusa por classe faltando e o
> congelamento da tabela de valores. O que sobra para a mão é o VISUAL do
> documento e o que atravessa as telas com o mouse.

### 5.1 Valores de custo (Super Admin)

- [ ] `/config-custos` abre para o Super Admin e mostra a versão vigente mais o histórico — e **não** traz mais o quadro de signatário, que foi para o formulário do plano
- [ ] **Admin Geral em `/config-custos` → sai da tela** `[E2E: plano-operacional.spec.ts]` (não é dele: quem planeja escolhe quantas horas, não quanto vale a hora)
- [ ] Preencher os quatro valores normais → "Aplicar +30% nos quatro" preenche os `plus` (27,30 → 35,49) e eles continuam editáveis
- [ ] Campo de dinheiro **vazio** → erro com mensagem; zero tem de ser DIGITADO (vazio virando R$ 0 em silêncio foi bug corrigido na entrega)
- [ ] Gravar → aparece uma VERSÃO nova no histórico; a anterior continua listada (a tabela é append-only)

### 5.2 Criação do plano

- [ ] O formulário ocupa a **largura da folha** e as seções se separam por título e linha — sem cartão dentro de cartão, e sem o título deslocado para uma coluna estreita
- [ ] **NUP**: digitar só números aplica a máscara `00000.000000/0000-00` conforme se digita, e para em 17 dígitos
- [ ] Horário de apresentação, previsão de término e data de término ficam na **mesma linha**
- [ ] **Signatário**: o nome é buscado no cadastro (como o coordenador) e o cargo é um `<select>` com três opções geradas do departamento cadastrado — Diretor Titular do Departamento de Polícia do Interior Sul, Diretor Adjunto do Departamento de Polícia do Interior Sul, Delegado de Polícia
- [ ] Sem escolher signatário, o plano nasce sem ele e o PDF imprime a linha de assinatura em branco (não há padrão global — `/config-custos` é só sobre dinheiro)

- [ ] `/gise/operacoes` → "Nova operação" pergunta **Operação** ou **Plano operacional**
- [ ] Escolher _Operação_ → abre o painel de sempre, sem nenhuma mudança de comportamento
- [ ] Escolher _Plano operacional_ → `/gise/planos/novo`
- [ ] Sem tabela de valores gravada, a tela avisa que o Anexo II sairia zerado — e ainda assim deixa criar o plano
- [ ] Criar → redireciona para o editor, com o número `N/ANO` sequencial do ano corrente
- [ ] Dois planos criados no mesmo ano recebem números diferentes `[Vitest: planos.test.ts]` (o `UNIQUE (ano, numero)` é a tranca real, não a consulta prévia)

### 5.3 Editor, custo e o que bloqueia a emissão

### 5.3.1 Distância medida sozinha

- [ ] Opção de origem/destino é escolhida num **seletor dos 184 municípios**, não digitada; a de briefing mantém o texto livre e ganha a **cidade onde fica**
- [ ] Briefing sem cidade → a lista avisa, e a distância da equipe sai medida de ponta a ponta (sem a parada)
- [ ] Equipe criada com as três cidades resolvidas **nasce com a distância preenchida** `[E2E: plano-operacional.spec.ts]`, e o texto ao lado nomeia o trajeto: "Jucás → Sede da 4ª Seccional do Interior Sul → Acopiara, 72 km"
- [ ] **Trocar o destino no seletor muda o número na hora**, sem salvar — a matriz do plano já subiu no `load`
- [ ] Digitar no campo **trava** a medida ("Informada à mão"), e trocar a cidade depois disso NÃO sobrescreve o valor digitado
- [ ] O botão **"Usar a medida"** devolve o controle ao cálculo
- [ ] O trajeto passa pelo briefing: Jucás → Iguatu → Juazeiro do Norte dá **189 km**, e não os 114 km diretos `[Vitest: distancia.test.ts]`
- [ ] `node scripts/gerar-distancias.mjs --diff` mostra só o que mudou e **destaca em separado** quem cruzou os 100 km
- [ ] A auditoria de `salvarEquipe` registra `distancia_procedencia` como `medida` ou `manual` — decidido pelo SERVIDOR, não por campo do formulário

### 5.3.2 A diária primeiro, o horário na recusa

- [ ] Equipe **sem distância informada** → aviso na tela dizendo que a rubrica sai só pelo horário; o campo aparece SEMPRE, não só quando origem e destino estão preenchidos
- [ ] Distância de **40 km** em janela noturna → "Sugerir custeio" propõe HORA EXTRA, e o texto diz "abaixo do limite de 100 km — vale o horário"
- [ ] Distância de **180 km** na MESMA janela (04:00–08:00) → propõe DIÁRIA, e a quantidade nasce em **1,5 diária**, o piso da corporação
- [ ] **100 km exatos** já são diária — o limite é inclusivo `[Vitest: custeio.test.ts]`
- [ ] Deslocamento longo em **pleno expediente** (terça, 09:00–17:00) → **SEM CUSTO**, e o texto diz que a diária não é devida citando o dispositivo: a missão de um dia não extrapolou as 8 horas. **Antes desta regra isso dava diária** — a distância decidia sozinha
- [ ] A MESMA equipe às **04:00–08:00** → diária, porque a saída antes das 6h extrapola
- [ ] O mesmo deslocamento **no sábado** → diária, pela presunção do art. 22
- [ ] Ao propor diária, as horas são ZERADAS — as duas verbas não se somam (política do DPI SUL, e a tela não sugere o contrário)

**O portão de 4 horas e o limite manejável**

- [ ] Operação de **2 horas** a 300 km → hora extra, com o texto "a operação tem menos de 4 horas — o percurso não alcança a jornada de 8 horas"
- [ ] Operação de **exatamente 4 horas** a 150 km → diária; com 3 horas, hora extra `[Vitest: custeio.test.ts]`
- [ ] Equipe **sem hora de término** a 300 km → aviso próprio ("sem a janela fechada não há como aferir"), diferente do aviso de operação curta
- [ ] Em `/config-custos`, gravar **120 km** como distância mínima → a equipe de 110 km deixa de sugerir diária, e a de 130 km continua sugerindo
- [ ] Campo de km vazio, com vírgula, zero ou acima de 2000 → recusa nomeando o campo, sem gravar a versão pela metade
- [ ] A tabela **Versões gravadas** mostra a coluna "Diária a partir de" — é por ela que se explica um plano antigo com rubrica diferente
- [ ] Plano criado ANTES da troca continua com o limite da versão dele (o `custo_parametro_id` congela) `[Vitest: planos.test.ts]`

**A janela que vira o dia, e os alertas do decreto**

- [ ] Equipe com **23:00 → 10:00** → a janela termina no dia seguinte e a sugestão traz **11 horas**, não zero `[Vitest: planos.test.ts]`
- [ ] A mesma equipe recebe **1,5 diária** (`N = 2`, pernoite), não 0,5
- [ ] Equipe 04:00 → 08:00 continua no mesmo dia, com 4 horas `[Vitest: planos.test.ts]`
- [ ] Equipe de Juazeiro do Norte para Crato (12 km, ambos na RMC) **em pleno expediente** → alerta de vedação com "art. 4º, §1º, II"; a MESMA equipe às 04:00 **não** alerta, porque extrapola `[Vitest: vedacoes.test.ts]`
- [ ] Servidor que já passaria de 15 diárias no mês → alerta de teto com "art. 13", e a diária **continua sendo concedida** (o alerta pede conferência, não bloqueia)
- [ ] Missão de 28/set a 03/out lança 3 diárias em setembro e 2,5 em outubro — o teto é por mês de cada data `[Vitest: contagem.test.ts]`
- [ ] Apagar o campo de distância → volta a `NULL` no banco, não a zero `[E2E: plano-operacional.spec.ts]`
- [ ] Distância acima de 9999 → recusa nomeando o campo, sem gravar truncado `[E2E: plano-operacional.spec.ts]`
- [ ] A distância NÃO é copiada para equipe nova: ela é do par origem→destino daquela equipe `[E2E: plano-operacional.spec.ts]`

- [ ] Plano em **dia útil das 14:00 às 17:00**, sem distância → "Sugerir custeio" propõe SEM CUSTO
- [ ] O mesmo plano movido para **sábado** → sugere as mesmas horas como hora extra **plus**
- [ ] **Bordas**: Parâmetros gerais, cards de equipe, Anexo II e Documento têm o MESMO contorno (`card-quadro`), e dois blocos vizinhos não se leem como um só
- [ ] Equipe com horário próprio (ex.: apresentação 03:30) usa o dela; equipe sem horário HERDA o do plano — o Anexo I imprime o valor efetivo
- [ ] O editor abre com coordenador, demandante e signatário **já preenchidos** quando o plano os tem — campo vazio ali significaria "ninguém designado", e salvar por cima apagaria a designação
- [ ] Trocar o signatário de UM plano não muda o padrão global nem os outros planos
- [ ] **Na tela de CRIAÇÃO**, "Opções das equipes" já deixa montar as três listas (briefing, origem, destino) antes de o plano existir — acrescentar, remover e trocar a estrela sem nunca submeter o formulário por engano
- [ ] Marcar como padrão a SEGUNDA opção de uma lista na criação → o plano nasce com ela estrelada, e não com a primeira que foi digitada (a escolha vence a ordem de inserção) `[E2E: plano-operacional.spec.ts]`
- [ ] **Parâmetros gerais → "Opções das equipes"**: acrescentar um local de briefing, uma cidade de origem e uma de destino; a PRIMEIRA de cada tipo nasce com a estrela
- [ ] Acrescentar o MESMO valor de novo → recusa nomeando a lista ("já está na lista de cidades de destino") `[Vitest: planos.test.ts]` — quem recusa é o índice, não uma consulta prévia
- [ ] Marcar outra como padrão → a estrela SAI da anterior (nunca duas), e remover a padrão faz a primeira das restantes assumir
- [ ] Lista com opções e nenhuma padrão (é como os planos antigos vieram da migração) → o editor avisa que as equipes novas continuam nascendo em branco
- [ ] As duas listas gravam **sozinhas**, sem passar pelo "Salvar parâmetros" — uma edição pela metade nos outros campos não vai junto
- [ ] Criar equipe DEPOIS de marcar as padrões → ela nasce com briefing e destino já preenchidos `[E2E: plano-operacional.spec.ts]`
- [ ] No card da equipe, briefing/origem/destino são `<select>` com as opções do plano; a opção vazia nomeia **o padrão do plano** ("— padrão: Iguatu —"), não o valor que a equipe já tem
- [ ] Remover da lista uma opção que uma equipe já usa → o destino da equipe **continua lá** e ainda aparece no seletor dela (a equipe guarda o texto, não uma referência)
- [ ] POST direto em `?/definirOpcaoPadrao` com o `opcao_id` de OUTRO plano → recusa, e a linha alheia não muda `[E2E: plano-operacional.spec.ts]` (classe do FLW-ESC-002)
- [ ] "Editar" (ou o clique na ficha) abre o preenchimento num modal, com os mesmos campos; "Custo da equipe" aparece DEPOIS do bloco "Efetivo"; "Salvar Alterações" fica no rodapé do modal; "Excluir" fica no cabeçalho da ficha, ao lado de Editar
- [ ] Editar horas/diárias e salvar → os campos de custo persistem, mesmo estando FORA do `<form>` (chegam por `form=`)
- [ ] "Excluir equipe" **pede confirmação** dizendo quantos servidores vão junto; "Cancelar" não apaga nada
- [ ] Servidor **sem classe no cadastro** numa equipe com custo → linha em vermelho, "impede a emissão", e o botão de baixar o PDF desabilitado
- [ ] Com a pendência aberta, **GET direto em `/api/planos/<id>/download` → 409** nomeando quem falta `[E2E: plano-operacional.spec.ts]` (o botão escondido nunca foi autorização)
- [ ] O mesmo servidor sem classe numa equipe **sem custo** → AVISO, não pendência: a emissão continua liberada (equipe sem custo pode virar com custo, e o problema tem de aparecer antes da véspera)
- [ ] Um servidor não entra DUAS vezes no mesmo plano, nem em equipes diferentes
- [ ] Definir outro chefe na equipe → o anterior perde a marca (um chefe por equipe)

### 5.4 O PDF

- [ ] Três páginas: corpo, `ANEXO I` e `ANEXO II`
- [ ] O corpo cabe numa folha só, com a data e a assinatura do Diretor **na mesma página** do texto — assinatura sozinha na folha seguinte é defeito
- [ ] O bloco de assinatura traz o nome e o cargo **escolhidos naquele plano**
- [ ] Anexo I: uma tabela por equipe, com destino, VTR, apresentação e briefing; chefe marcado com `*`; `Total:` por equipe
- [ ] Jornada sai como `6h (5N/1A)` na hora extra e `1,5 diárias` na diária; equipe sem custo imprime `Sem custo` e `R$ 0,00`
- [ ] **CPF não aparece em lugar nenhum do documento** (minimização LGPD — o papel circula)
- [ ] Anexo II: os dois blocos com as colunas ALINHADAS entre si, `TOTAL GERAL` = soma dos dois, e igual à soma dos totais do Anexo I e ao painel da tela
- [ ] O rodapé institucional aparece nas três páginas
- [ ] **Reajustar os valores em `/config-custos` NÃO muda o PDF do plano já criado** `[E2E: plano-operacional.spec.ts]` — é a prova de que a versão ficou congelada; a linha de procedência do Anexo II segue citando a versão antiga

## 6. Assinatura Digital — Escalas

### 6.1 Assinatura Simples (Nome/CPF) — descontinuada, restrita a fluxos FDS legados

- [ ] Preparar assinatura → PDF gerado com sucesso
- [ ] Assinar com nome e CPF → documento assinado
- [ ] Hash de verificação gerado após assinatura
- [ ] Download do PDF assinado disponível

### 6.2 Assinatura WebPKI (Certificado ICP-Brasil)

- [ ] Selecionar método WebPKI
- [ ] Extensão WebPKI detectada no navegador
- [ ] Listar certificados disponíveis
- [ ] Assinar com certificado válido → finalizar com sucesso
- [ ] Tentar sem extensão instalada → mensagem de erro adequada
- [ ] Certificado expirado → mensagem de erro

> `[E2E: assinatura-qualificada-a3.spec.ts]` cobre a cadeia criptográfica do fluxo qualificado (preparar → CMS → finalizar → download → `/validar`, com negativos de CA desconhecida, CPF divergente e digest adulterado) usando CA de teste. O que segue manual em 5.2/5.3 é a integração com o assinador real (WebPKI/SERPRO, PIN, token físico, certificado expirado de verdade).

### 6.3 Assinatura SERPRO

- [ ] Selecionar método SERPRO
- [ ] Aplicação desktop SERPRO conectada via WebSocket
- [ ] Assinar com sucesso → finalizar com sucesso
- [ ] SERPRO não conectado → mensagem de erro

### 6.4 Código de Assinatura por E-mail

- [ ] Solicitar código de assinatura por e-mail
- [ ] Inserir código correto → autorização concedida
- [ ] Código incorreto → erro de validação
- [ ] Código expirado → erro com instrução para solicitar novo

### 6.5 Re-assinatura e revogação

> `[E2E: escala-revogacao.spec.ts]` cobre o ciclo qualificado (CA de teste): assinar → documento baixável e `/validar` encontra → revogar (DELETE) → documento some do banco e do `/validar` → reassinar (hash novo). Também a re-assinatura sem revogar (overwrite): o hash antigo deixa de resolver (achado R2-4). Guarda: policial de outra lotação não revoga → 403. A limpeza dos objetos R2 em si (quais apagar) é coberta no unitário `r2-cleanup.test.ts`.

- [ ] Tentar assinar escala já assinada → erro informando documento já assinado

---

## 7. Assinatura Digital — GISE

### 7.1 Assinatura da GISE Principal

- [ ] Preparar assinatura da GISE → PDF gerado
- [ ] Assinar simples com nome/CPF
- [ ] Assinar com WebPKI ou SERPRO
- [ ] Selfie capturada durante assinatura (se configurado)
- [ ] GPS coletado durante assinatura (se configurado)
- [ ] Hash de verificação gerado após assinatura

### 7.2 Presença (Check-in / Check-out)

> `[E2E: presenca-gise.spec.ts]` cobre entrada/saída em tela com 2FA + GPS + foto (2FA **sempre** obrigatório — as actions leem a fonte única `lerFlagsAssinatura`, que o força ligado), o comprovante sob demanda dos dois sentidos, o **vínculo na escrita** (não-participante com 2FA válido → 403, não grava) e as guardas do comprovante (anônimo 401, não-participante 403, tipo inválido 400, sem presença 404). Manual: selfie/câmera real (liveness é client-side) e o fluxo por Token A3 (janela de horário + hardware — QA A3).
>
> Desde ago/2026 cobre também a **política de evidência** que o servidor passou a impor (ver README §"Evidência de presença"): sem foto e sem motivo declarado → recusado e nada gravado; motivo de lista fechada → aceito, gravado sem selfie e com o motivo nos metadados do evento de auditoria. Os itens abaixo marcados com ⚠️ dependem da flag correspondente em `/conf-ass`.
>
> **A exceção declarada tem caminho de interface só para o GPS.** O `SignaturePad` detecta a falha de localização e manda o motivo; para a câmera ele desabilita o botão de captura, então `motivoSemFoto` é aceito pelo servidor mas nenhuma tela do produto o envia hoje.

- [ ] Policial registra entrada com selfie
- [ ] Policial registra saída com selfie
- [ ] Timestamps de entrada e saída salvos corretamente
- [ ] ⚠️ Com `exigir_gps` ligada, negar a permissão de localização: a tela segue com o MOTIVO detectado (`permissao_negada`), a confirmação passa, e o motivo aparece no console de auditoria nos metadados do evento
- [ ] ⚠️ Com `exigir_foto` ligada, negar a permissão da câmera: a tela **bloqueia** o botão de captura (não há caminho de exceção na interface para a foto — só para o GPS). O caminho do policial nesse caso é a presença por Token A3 no desktop
- [ ] ⚠️ POST direto na form action sem foto e sem motivo, com a flag ligada → recusado, e `gise_presencas` continua sem a linha
- [ ] No desktop (com restrição de smartphone), a tela de confirmação mostra APENAS o botão "Confirmar … com Certificado Digital"
- [ ] Após confirmar (tela OU Token A3), o botão **"Comprovante"** aparece ao lado do aviso de Entrada/Saída Confirmada e baixa o PDF
  - Presença por Token A3 → serve o termo qualificado (ICP-Brasil) guardado no R2
  - Presença em tela → gera o comprovante **avançado** sob demanda (evidências do ato), SEM menção a ICP-Brasil no rodapé

### 7.3 Formulários de Produtividade

- [ ] Policial preenche formulário de respostas
- [ ] Salvar respostas → persistido no banco
- [ ] Atualizar respostas já salvas → substituído corretamente

### 7.4 Assinatura de Relatórios Seccional

> `[E2E: relatorio-extra-gise.spec.ts]` cobre a assinatura **qualificada** do relatório extraordinário pelo supervisor via CA de teste (preparar → CMS → finalizar → documento persistido → `/validar`) e as guardas: não-supervisor → 403, seccional inválida → 400, saída incompleta → 400, CPF do token ≠ supervisor → 400.
> `[E2E: relatorio-extra-avancado.spec.ts]` cobre a assinatura **avançada em tela** (endpoint `assinar`): supervisor com 2FA + selfie/GPS → 200; não-supervisor → 403; saída incompleta → 400; sem 2FA → 400.
> A montagem do manifesto (todas as presenças + supervisor, FOTO condicional) é coberta no unitário `manifesto-signers.test.ts`. Manual: o Assinador SERPRO real, a selfie/câmera de verdade e a assinatura do relatório de `produtividade`.

- [ ] Preparar relatório seccional
- [ ] Assinar relatório tipo `extraordinario`
- [ ] Assinar relatório tipo `produtividade`
- [ ] Finalizar assinatura do relatório
- [ ] Manifesto do relatório de extra contém TODAS as assinaturas de presença **tanto** quando o supervisor assina por Token A3 **quanto** pelo celular/tela; campo "FOTO DO ATO" só aparece quando há selfie
- [ ] Botões de download "C/ manifesto" só aparecem para quem pode baixá-lo (admin, ou DPC assinante do documento); demais perfis veem apenas "S/ manifesto"

---

## 8. Validação Pública de Documentos (`/validar/[hash]`)

- [ ] Acessar URL pública com hash válido → exibir informações do documento
- [ ] Hash inválido ou inexistente → página de erro adequada
- [ ] Download do documento validado → PDF baixado corretamente (só autenticado)
- [ ] Verificar integridade: hash do arquivo bate com o registrado no banco
- [ ] Exibir dados do assinante (nome mascarado, CPF parcial, data/hora) — IP/GPS/UA **não** saem na página pública
- [ ] Assinatura por chave, visitante **autenticado**: recorte da credencial (o mesmo do manifesto) + situação (ativa/revogada/ausente). Anônimo **não** vê o recorte

---

## 9. Gestão de Policiais (`/policiais`)

### 9.1 Listagem

- [ ] Filtrar por lotação, cargo, seccional
- [ ] Busca por nome ou matrícula
- [ ] Paginação funcional

### 9.2 Criar Policial

- [ ] Criar com todos os campos obrigatórios preenchidos
- [ ] Matrícula duplicada → erro de unicidade
- [ ] CPF em formato inválido → validação (se houver)
- [ ] Atribuir papel (admin_seccional, admin_unidade) + unidade → persistido

### 9.3 Editar Policial (`/policiais/[id]`)

- [ ] Editar dados básicos (nome, telefone, cargo, lotação)
- [ ] Alterar papel → permissões atualizadas
- [ ] Desativar policial → flag `ativo = false`
- [ ] Policial desativado não aparece em seleções de equipe/escala

### 9.4 Upload em Lote (`/policiais/upload`)

- [ ] Upload de CSV válido → policiais criados em lote
- [ ] CSV com linhas inválidas → relatório de erros por linha
- [ ] CSV vazio → mensagem de erro

### 9.5 Meu Perfil (`/perfil`) e Solicitações (`/solicitacoes`)

> `[E2E: solicitacoes-cadastro.spec.ts]` cobre o caminho feliz completo: o admin
> de unidade pede, o Admin Geral aprova, o servidor vê o valor aplicado — e
> confirma que `/perfil` não tem mais botão de solicitar. O que sobra abaixo é o
> que o E2E não alcança: escopo cruzado, ações de RH e recusa.

**Meu perfil — o que o servidor faz (e não faz mais)**

- [ ] `/perfil` é somente leitura: identificação, dados cadastrais (telefone, classe, regime, lotação) e o texto que manda procurar o administrador da unidade/seccional
- [ ] Não existe formulário nem botão de solicitar alteração; o único controle é o de e-mail pessoal (§ 8.6) e o cartão da chave de assinatura

**Ficha do servidor (`/policiais/[id]`) — modo `solicitacao`**

- [ ] Admin de unidade/seccional abre `/policiais` e vê APENAS servidores do escopo dele; "Novo Policial", "Importar Excel" e "Excluir" não aparecem
- [ ] Abrir pela URL a ficha de um servidor de OUTRA unidade → 403 ("não está sob a sua administração")
- [ ] Editar um campo → botão "Solicitar alteração" só habilita com mudança real **e** justificativa preenchida (contador até 300)
- [ ] Enviar → cria solicitação PENDENTE (cadastro NÃO muda) e aparece no quadro "Solicitações deste servidor"
- [ ] Nova solicitação do mesmo campo substitui a pendente anterior
- [ ] CPF aparece em branco (com placeholder dizendo se há ou não CPF cadastrado); preenchê-lo cria pedido, deixá-lo vazio não
- [ ] Lotação é somente leitura, com o aviso de que se altera por Movimentação
- [ ] "Papel Administrativo" e "Admin Geral" aparecem marcados como **informativo**, sem controles; POST direto em `?/salvarPapel` ou `?/toggleAdminGeral` → 403
- [ ] "Afastar / Movimentar Servidor" aparece; cada modal exige justificativa e o botão diz "Solicitar" (não "Salvar")
- [ ] Desvinculação pedida por admin de unidade → servidor **continua ativo** até a aprovação

**Fila do Admin Geral (`/solicitacoes`)**

- [ ] Duas seções: "Dados cadastrais" (tabela) e "Movimentação, afastamento e desvinculação" (cartões)
- [ ] Cada linha/cartão mostra servidor, de/para (ou o pedido inteiro), **justificativa** e quem pediu
- [ ] Cartão de ação com PDF anexo → botão baixa a portaria antes de decidir
- [ ] Aprovar (✓) cadastral → valor aplicado imediatamente; Rejeitar (✗) → cadastro intacto; ambos auditados
- [ ] Aprovar movimentação → lotação trocada **e** evento na timeline do servidor, creditado a quem PEDIU; aprovar desvinculação → servidor inativado e sessões derrubadas
- [ ] Rejeitar uma ação com anexo → pedido fechado e o PDF sai do bucket
- [ ] Decidir duas vezes o mesmo pedido (duas abas) → a segunda recebe 409, sem reaplicar o ato
- [ ] Valores inválidos (classe de outro cargo, CPF malformado, telefone curto, e-mail sem `@`) → erro de validação
- [ ] Admin de unidade/seccional acessando `/solicitacoes` → redirecionado (a fila é de quem decide)

### 9.6 E-mail pessoal pelo perfil (cadastro/troca)

> `[E2E: email-pessoal.spec.ts]` também protege o contrato do `ModalShell`:
> foco inicial e restaurado, fechamento por Escape/backdrop e bloqueio desses
> dismisses enquanto a requisição está pendente.

- [ ] Sem e-mail pessoal: "Cadastrar" abre o modal SEM campo de senha; código chega no novo endereço; confirmar persiste verificado
- [ ] Com e-mail pessoal: "Alterar" exige a senha de acesso; senha errada → "Senha incorreta."; sem senha o envio fica bloqueado
- [ ] Código correto → e-mail trocado, selo "Verificado" e **aviso de segurança no e-mail funcional**
- [ ] Código errado/expirado → erro; reenvio disponível após o timer
- [ ] Troca também registrada na auditoria (detalhe indica TROCA + aviso)

---

## 10. Gestão de Unidades (`/unidades`)

- [ ] Criar unidade do tipo `seccional` (sem seccional_id)
- [ ] Criar unidade do tipo `delegacia` com seccional vinculada
- [ ] Criar delegacia sem seccional → erro de validação
- [ ] Nome duplicado → erro de unicidade
- [ ] Editar unidade (nome, cidade, flags de plantão/expediente/FDS)
- [ ] Deletar unidade sem dependências → removida com sucesso
- [ ] Tentar deletar unidade com policiais ou escalas vinculados → erro ou aviso

---

## 11. Painel Administrativo (`/painel`)

### 11.1 Controle de Acesso

- [ ] Acesso negado para não-admin → redirecionamento
- [ ] Admin acessa painel completo sem erro

### 11.2 Relatório de Compliance

- [ ] Filtrar por mês/ano
- [ ] Unidades com escala assinada → indicador correto
- [ ] Unidades com escala não assinada → indicador correto
- [ ] Unidades sem escala → indicador correto
- [ ] Endpoint `/api/admin/compliance` retorna dados no formato esperado

### 11.3 Auditoria

> `[E2E: auditoria.spec.ts]` cobre o caminho do Super Admin: `/api/admin/audit` lista paginado; a trilha **captura** um evento ponta a ponta (webhook `sync_policiais` recuperável filtrando por ação); export CSV → 200 `text/csv`; janela longa demais → 400. Os negativos de RBAC (anônimo 401, policial/Admin Geral 403) estão em `boas-vindas-rbac.spec.ts`. A cadeia de hash/canonicalização está no unitário `audit-forense.test.ts`.

- [ ] Ver log de auditoria das ações do sistema
- [ ] Filtrar por usuário, ação ou entidade
- [ ] Endpoint `/api/admin/audit` retorna dados no formato esperado

### 11.4 Logs técnicos (`/auditoria/logs`)

> Acesso exclusivo do **Super Admin** (mesma política de `/auditoria`). Grava apenas `warn`/`error` do servidor; a persistência acontece após a resposta (waitUntil), então o registro pode levar alguns segundos para aparecer.
>
> `[E2E: auditoria-logs.spec.ts]` prova o pipeline inteiro: um `logger.warn` real (webhook com bearer inválido) → flush pós-resposta → `app_log` → o console exibe o registro filtrado por busca. O redirect de não-Super-Admin está em `boas-vindas-rbac.spec.ts`.

- [ ] Botão "Logs técnicos" no cabeçalho de `/auditoria` abre a página
- [ ] Provocar um aviso (ex.: chamar um webhook com token errado) → registro aparece com nível "Aviso", rota e Request ID
- [ ] Filtrar por nível, busca livre e período
- [ ] Filtrar por Request ID (usar o link no detalhe de um evento da auditoria) → mostra os logs daquela request
- [ ] Expandir um registro → contexto JSON formatado
- [ ] Usuário não Super Admin acessando `/auditoria/logs` → redirecionado

---

## 12. Produtividade (`/produtividade`)

> `[E2E: produtividade.spec.ts]` cobre o acesso: Admin Geral entra e vê o dashboard; policial → 403; anônimo → `/login`. `[E2E: produtividade-visualizacao.spec.ts]` cobre o eixo: os controles da barra (a linha de quantidade/ordem/período atrás de "Mais filtros"), o total que não muda ao alternar delegacias × seccionais, a equipe sem slot como linha própria, ordem/Top-N e o tipo de equipe desabilitado. A agregação tem cobertura unitária em `produtividade/__tests__/{stats,agrupamento}`. Manual: gráficos com dados reais e o PNG exportado.

- [ ] Carregar dados de produtividade das GISE finalizadas
- [ ] Gráficos renderizados corretamente
- [ ] Filtrar por período
- [ ] Dados vazios → estado vazio com mensagem
- [ ] Com mais de 200 respostas acumuladas → stats/rankings/gráficos contam o conjunto completo (o load pagina internamente em lotes de 500)

**Organizar o painel (arrastar os cards):**

> `[E2E: produtividade-ordem.spec.ts]` cobre o mecanismo: o arraste, as setas, a
> ida e volta pelo banco, a pergunta marcada depois entrando por último e a
> recusa (403) ao admin de unidade. A regra do "fim da lista" tem cobertura
> unitária em `produtividade/__tests__/ordem`. Manual: o gesto no dispositivo
> real, que é onde o arraste por toque não existe e as setas são o único caminho.

- [ ] Como Admin Geral, **Organizar painel** aparece no alto; como admin de
      unidade/seccional, não aparece
- [ ] No modo, cada card ganha a faixa CLARA com a posição, a alça e as setas
      ↑/↓, e cada bloco ganha a faixa ESCURA com o nome dele; o conteúdo do card
      não responde a clique (arrastar não marca card para exportação)
- [ ] Arrastar um card sobre outro do MESMO bloco troca os dois; soltar sobre
      outro bloco não move nada
- [ ] Arrastar/mover o BLOCO leva a categoria inteira: "Gráficos de colunas"
      acima de "Rankings" reordena a página toda, e os cards de cada bloco
      continuam onde estavam
- [ ] Bloco sem card nenhum (operação sem indicador de meta) não aparece no modo
      — nem a barra escura dele
- [ ] No **celular**, o arraste não existe — as setas ↑/↓ movem, e é por elas que
      o modo se usa em tela pequena
- [ ] **Salvar ordem** → a página recarrega já na ordem nova; sair e voltar
      mantém
- [ ] **Sair sem salvar** e **Desfazer** devolvem a ordem gravada
- [ ] **Ordem do formulário** volta os cards à ordem das perguntas (é rascunho —
      só vale depois de Salvar)
- [ ] Arrastar e voltar ao arranjo original antes de salvar → o painel volta a
      **seguir** o formulário (a coluna `painel_ordem` fica `[]`), e reordenar as
      perguntas no editor volta a chegar ao painel
- [ ] Marcar uma pergunta nova como gráfico no editor → o card dela aparece no
      **fim** do bloco dele, não no topo
- [ ] Fora do modo, "Organizar painel" fica separado do grupo "Baixar gráficos";
      dentro do modo, o grupo de baixar some
- [ ] Trocar de tipo de equipe mantém o rascunho de cada aba; o seletor de
      OPERAÇÃO fica desabilitado enquanto se organiza

**Baixar (PDF) — é o `window.print()` do navegador:**

> `[E2E: produtividade-graficos.spec.ts]` prova em `media: print` que o card pede
> `break-inside: avoid`, que ele transborda em vez de cortar, e que filtros,
> botões e cards não selecionados somem. O que segue é o que só o diálogo de
> impressão real mostra — paginação de verdade e fidelidade do canvas.

- [ ] Selecionar alguns gráficos → **Baixar (PDF)** → nenhum card sai partido
      entre duas folhas; o único que quebra é o que sozinho não cabe numa A4
- [ ] Nenhum gráfico sai cortado na lateral, e o ranking mostra TODAS as linhas
      (na tela ele rola; no papel tem de transbordar)
- [ ] Com "Gráficos de plano de fundo" ligado no diálogo, as barras de
      detalhamento saem preenchidas
- [ ] Sem barra do topo, sem gaveta, sem barra de filtros e sem os botões de
      baixar; a data/URL do alto e do pé são do NAVEGADOR (saem em
      "Mais definições → Cabeçalhos e rodapés")

**O eixo (`Visualizar por`):**

- [ ] Abre em **Seccionais** — o comportamento de antes
- [ ] Alternar para **Delegacias** reparte a mesma produção: a SOMA das barras
      não muda, só a quebra
- [ ] O rótulo de cada linha do ranking acompanha ("Seccional" → "Delegacia"), e
      o nome curto mostra o MUNICÍPIO (não "Delegacia" repetido)
- [ ] Passar o mouse sobre uma barra mostra o nome COMPLETO da unidade
- [ ] Uma equipe escalada direto na seccional (sem slot) aparece como linha
      própria no modo Delegacias

**Quantidade e ordem:**

- [ ] Top 5 / Top 10 cortam o ranking, os gráficos por pergunta e os cards de
      indicador. Cada seção corta pela SUA métrica: o "top 5" de prisões pode ser
      um conjunto diferente do "top 5" de drogas — é o que "as 5 que mais X"
      significa
- [ ] "Piores primeiro" inverte; num indicador de REDUÇÃO, "melhores primeiro"
      traz quem mais reduziu (e não quem tem o maior número)
- [ ] Unidade sem linha de base fica no FIM do ranking de indicadores nos dois
      sentidos, e não no topo de "piores"
- [ ] O PNG exportado traz no cabeçalho o recorte aplicado ("Top 5 delegacias —
      piores primeiro"), e não só o nome da operação

**Tipo de equipe:**

- [ ] Numa operação só operacional, o botão "Inteligência" vem **desabilitado**
      (visível e apagado, não escondido), com dica ao passar o mouse
- [ ] Estando em "Inteligência" e trocando para uma operação que não a usa, o
      filtro cai sozinho em "Operacional" — sem painel vazio inexplicado

---

## 13. Configurações de Assinatura (`/conf-ass`)

> Acesso exclusivo do **Super Admin**. As flags são cacheadas no edge por até 5 min — a alteração deve refletir no fluxo de assinatura em ≤ 5 min.
>
> `[E2E: conf-ass.spec.ts]` cobre: GET com flags + `bloqueados` (base legal); anônimo barrado (CSRF antes da auth) e Admin Geral → 403; **invariante legal** — nem o Super Admin desliga o 2FA (PUT `false` → 400 e GET segue `true`); PUT vazio → 400; e a **invalidação do cache edge** (PUT → GET reflete na hora, sem esperar o TTL). Manual: o efeito das flags na tela de assinatura real.

- [ ] Visualizar configuração atual das flags de assinatura
- [ ] Ligar/desligar `exigir_foto_assinatura` → refletido na próxima assinatura
- [ ] Ligar/desligar `exigir_gps_assinatura` → refletido na próxima assinatura
- [ ] Ligar/desligar `restringir_smartphone` → em desktop, fluxo A3 oferecido
- [ ] Com `restringir_smartphone` ligado, POST direto de um desktop (curl/devtools) em `/api/escalas/<id>/assinar-simples` → **403** ("só pode ser feita pelo celular"); pelo celular, o manifesto do PDF traz a linha `POLÍTICA DE DISPOSITIVO`. O fluxo por Token A3 no desktop **continua funcionando** — ele é desktop por projeto
- [ ] Ligar `exigir_passkey_assinatura` → em escala, GISE, extra e presença o fluxo passa a preparar → biometria → finalizar; POST direto no um-tiro (`assinar-simples` / `assinar` / form action de presença) → **403**
- [ ] Presença com a flag ligada: o `preparar-assinatura-avancada` **não** grava entrada/saída. Cancelar a biometria deixa o plantão sem presença; só o `finalizar` (após a asserção) persiste.
- [ ] Sem chave registrada em `/perfil`, com a flag ligada → lê o documento (200) e o POST de avançada → **403** (no celular aponta Meu Perfil; no desktop, Token A3). Cadastro da chave só no celular; reposição pede os dois e-mails
- [ ] Com a flag DESLIGADA e sem chave → nenhuma tela convida a cadastrar: assina em tela pelo caminho de um tiro, e o primeiro acesso não menciona chave nenhuma. O convite só aparece com a flag ligada, na hora de assinar
- [ ] Com a flag DESLIGADA, o cartão "Chave de assinatura" some das DUAS telas — `/perfil` (titular) e `/policiais/[id]` (Admin Geral) — **mesmo com chave já registrada**; o resto de cada tela segue inteiro. Religar a flag traz os dois de volta `[Vitest: chave-assinatura.test.ts]`
- [ ] Corolário do item acima: com a flag desligada não há botão de revogar em lugar nenhum. Para revogar nesse estado, ligue `exigir_passkey_assinatura` em `/conf-ass`, revogue e desligue de novo
- [ ] Com chave já cadastrada, o perfil mostra o recorte (igual ao manifesto), o vínculo, o último uso e explica que o sistema **não** guarda o modelo do celular — a pessoa localiza a chave no gerenciador do iPhone/Google ou tentando assinar. Avisa: mesma conta Apple/Google → **não** cadastrar de novo (assinar); só repor se trocou/perdeu o aparelho
- [ ] Cadastro, reposição e revogação (titular ou Admin Geral) disparam aviso no **e-mail funcional** (recorte da chave, sem IP). Falha de envio **não** desfaz o ato
- [ ] Manifesto do PDF assinado por passkey traz a linha `CHAVE DE ASSINATURA` com "biometria/PIN do titular" e o vínculo da credencial (sincronizada x deste aparelho)
- [ ] Revogar a chave em `/perfil` e tentar assinar → recusado; recadastrar e assinar → funciona. Revogar dispara aviso no e-mail funcional
- [ ] Admin Geral em `/policiais/[id]` vê o cartão "Chave de assinatura": chave única, cadastro só pelo próprio servidor em Meu Perfil, da função de administrador só é possível revogar. Recorte do identificador (igual ao manifesto), data e vínculo; chaves revogadas aparecem abaixo. Revogar por lá impede novas assinaturas e **não** afeta documentos já assinados
- [ ] Após assinar com passkey, a linha de `escala_documentos` traz `webauthn_client_data`/`webauthn_assinatura` preenchidos (é o que permite reconferir a asserção depois)
- [ ] Tentar desligar `exigir_codigo_email_assinatura` → **bloqueado** (2FA por e-mail é requisito legal mínimo; o PUT rejeita `exigirCodigoEmail=false`)

---

## 14. Resultados GISE (`/res-gise`)

- [ ] Membro GISE acessa seus resultados e formulários
- [ ] Formulários de produtividade preenchidos exibidos corretamente
- [ ] Sem GISE atribuída → estado vazio com mensagem

### 14.1 Wizard do relatório (`/res-gise/relatorio/[giseId]`)

> O gate de entrada, a navegação entre etapas, o autosave e o envio têm
> cobertura E2E. Manual: o rascunho em condições que o navegador headless não
> reproduz.

- [ ] Preencher metade, **fechar a aba** e reabrir a rota → rascunho restaurado com o horário
- [ ] Aba anônima / `localStorage` cheio → o formulário continua funcionando (sem rascunho, sem erro)
- [ ] Dois policiais da mesma equipe no mesmo aparelho → cada um vê o próprio rascunho
- [ ] Colega entrega o relatório enquanto você tem rascunho → banner de oferta, e "Descartar" some com ele
- [ ] Admin Geral define etapas no editor → o wizard abre exatamente nesses grupos, na mesma ordem
- [ ] Modelo antigo (nenhuma pergunta com etapa) → uma etapa só, sem navegador
- [ ] Celular: o navegador mostra só a etapa anterior (esquerda) e a atual (direita); na 1ª etapa, só a atual, encostada à direita

### 14.2 Reordenar perguntas no editor

> Arraste, setas e renumeração têm cobertura automatizada
> (`e2e/reordenar-perguntas.spec.ts` + `lib/gise/renumerar-perguntas.test`).
> Manual: o que depende de aparelho real.

- [ ] Celular/tablet: as setas ↑/↓ movem (o arraste HTML5 não funciona no toque — é esperado)
- [ ] Arrastar um card sobre outro no desktop → destaque no destino e a ordem troca ao soltar
- [ ] Selecionar texto dentro do card **não** inicia arraste (só a alça inicia)
- [ ] Reordenar e **não salvar** → sair da tela desfaz tudo, inclusive a renumeração
- [ ] Pergunta cujo texto não começa com número ("Quantos?") → continua sem número após reordenar

### 14.3 Tipo "Quantidade + Lista Nome/Procedimento" (`lista_detalhada`)

> Escrita e expansão têm cobertura automatizada
> (`e2e/lista-reutilizavel.spec.ts` + `db/__tests__/produtividade-lista-reutilizavel`).
> Manual: o que só o PDF mostra.

- [ ] Duas perguntas do tipo, ambas preenchidas → **baixar o PDF de produtividade** e conferir que cada uma lista os SEUS itens
- [ ] Mesma conferência com um tipo original (ex.: "Prisões Maiores") junto na tela — as listas não podem se cruzar
- [ ] Trocar o tipo de uma pergunta já respondida → o detalhe antigo some do relatório (é esperado: a chave mudou)

### 14.4 Tipo "Cobertura (total e atendidas)" (`proporcao`)

> Escrita, rótulos e a reconstrução da meta ao trocar de tipo têm cobertura
> automatizada (`e2e/cobertura.spec.ts` + `gise/__tests__/indicadores` +
> `produtividade/__tests__/metas`). Manual: o PDF e o gráfico.

- [ ] Preencher a cobertura e **baixar o PDF de produtividade** → a pergunta sai numa linha só, no formato "9 de 12 (75%)"
- [ ] Duas perguntas de cobertura no mesmo formulário → cada uma com o seu par de números no PDF
- [ ] Em `/produtividade`, o card do indicador de cobertura mostra UMA série em porcentagem e o tique da meta no mesmo ponto em todas as unidades
- [ ] Unidade sem ocorrência no período → "sem ocorrências" na tabela, e fora do contador "N/M unidades na meta"
- [ ] Trocar uma pergunta de cobertura já respondida para outro tipo → os dois números somem do relatório (é esperado: as chaves mudaram)

---

## 15. Documentos Recebidos (`/recebidos`)

- [ ] Listar documentos recebidos pelo usuário logado
- [ ] Sem documentos → estado vazio com mensagem

---

## 16. Controle de Acesso (RBAC)

> `[E2E: boas-vindas-rbac.spec.ts]` cobre: policial comum barrado em `/painel` e `/auditoria`; Admin Geral com `/painel` liberado e consoles de auditoria vetados (Super Admin only, inclusive na API `/api/admin/audit`); anônimo → `/login`. `[E2E: escalas-cross-lotacao.spec.ts]` cobre o isolamento entre lotações. Manual: perfis que dependem de env (Super Admin) e a varredura exploratória completa da tabela.

| Papel              | Deve acessar                                                                                         | Não deve acessar                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Super Admin        | Tudo (inclusive gestão de policiais/unidades, `/conf-ass`, promoção de admins e PDF forense íntegro) | —                                                             |
| Admin Geral        | Operação global (escalas, GISE, LGPD, `/painel`)                                                     | Gestão de policiais/unidades, `/conf-ass`, promoção de admins |
| Admin Seccional    | Escalas/policiais da seccional                                                                       | `/painel`                                                     |
| Admin Unidade      | Escalas/policiais da unidade                                                                         | `/painel`, dados de outras unidades                           |
| Supervisor GISE    | `/gise/[id]` da sua GISE                                                                             | Outras GISE                                                   |
| Membro GISE        | `/res-gise`                                                                                          | `/gise/[id]` (visão admin)                                    |
| Policial sem papel | Suas escalas                                                                                         | Qualquer gestão                                               |

> A matriz completa de capacidades está em [`DEPLOY.md`](DEPLOY.md#papéis-e-privilégios-de-administrador).

- [ ] Testar cada papel tentando acessar rota não autorizada → redirecionamento ou erro 403

---

## 17. Acessibilidade e visual (resíduo da auditoria VIS-1…VIS-17)

Os dezessete achados da auditoria visual de 29/jul/2026 estão implementados e
verificados por medição (contraste calculado de `theme.css`, CSS compilado,
Playwright). O que sobrou é exatamente o que a automação não alcança — leitor
de tela real e olho humano sobre a amostra. A auditoria foi arquivada
(`git show f67345f:docs/auditorias/AUDITORIA_VISUAL_2026-07-29.md`, catálogo em
[`docs/HISTORICO.md`](docs/HISTORICO.md)); estes itens ficam aqui porque são
roteiro manual, não relatório.

- [ ] **VIS-13** — viewport < 900px, com TECLADO e LEITOR DE TELA: abrir a
      sidebar móvel; o foco entra na navegação; conteúdo principal, atalho de
      salto e barra móvel ficam inertes; Escape, botão fechar, backdrop e
      navegar devolvem o foco ao botão Menu
- [ ] **VIS-1 / VIS-4** — amostragem visual nos dois modos: texto informativo
      e presets `filled` de `tertiary`/`success` legíveis em claro E escuro
- [ ] **VIS-5** — as exceções estruturais que NÃO usam `ModalShell` (logout do
      `+layout`, `DialogInfo`, wizards `ModalNovaEscala`/`ModalCriarGise`,
      `ModalDatasHoras`, `ModalDownloadExtras`, `ModalBreveRelatorio`, os três
      diálogos de `PainelAcoesServidor`) continuam abrindo, fechando e
      devolvendo o foco
- [ ] **VIS-7** — ícones migrados para Lucide mantêm tamanho e alinhamento nas
      telas de escala, GISE e painel
- [ ] **Placeholder × conteúdo** — nos dois modos, em campo VAZIO a dica
      ("Digite sua senha", "Buscar unidade…") lê visivelmente mais apagada que
      o rótulo e que um valor digitado ao lado. Conferir também num campo sem
      a classe `.input` (o combobox de Lotação em `/perfil`) — a regra é por
      elemento, não por classe
- [ ] **Select vazio** — campo de seleção sem valor mostra `-`, nunca uma
      caixa em branco (que lê como falha de carregamento). O Classe de
      `/perfil` era o único assim

---

## 18. Segurança

- [ ] Submeter formulário sem token CSRF → request bloqueada
- [ ] Injeção de caracteres especiais em campos de busca → sem efeito (ORM parameterizado)
- [ ] Usar cookie de sessão de outro usuário → acesso negado
- [ ] Acessar PDF alheio via hash adivinhado → acesso negado (hash não-sequencial)
- [ ] Verificar headers de segurança: `X-Frame-Options`, `X-Content-Type-Options`, `CSP`

---

## 19. Health Check

- [ ] `GET /api/health` → retorna 200 com status OK
- [ ] Conectividade com banco de dados refletida no health check

---

## 20. Webhooks de Sincronização (operador / Apps Script)

> `[E2E: webhook-sync.spec.ts]` cobre o contrato ponta a ponta contra o D1: `sync-policiais` cria e atualiza (upsert) a partir do payload do Apps Script, cargo inválido conta como falha sem derrubar o lote, `sync-unidades` cria a seccional; **M-4** — um SYNC_TOKEN válido tentando `papel: seccional` NÃO promove (fica `null`); **reset destrutivo** fail-closed (SYNC válido mas sem a 2ª credencial → 401, nada apagado); auth negativa (sem/errado bearer → 401). A lógica de auth (Bearer/HMAC/replay) tem cobertura unitária em `webhook-auth.test.ts`.

- [ ] (manual) Rodar o menu "🚀 Sincronização D1" da planilha real → policiais/unidades refletidos no sistema
- [ ] (manual) Reset destrutivo com as 3 credenciais corretas em ambiente de teste → tabelas operacionais zeradas com snapshot no log

---

## 21. Direitos do Titular — LGPD art. 18

> `[E2E: lgpd-solicitacoes.spec.ts]` cobre o ciclo completo: o titular abre a solicitação (`/api/lgpd/solicitar` → 201) e a vê na sua lista; um policial não acessa a lista administrativa (403); o Admin Geral lista, detalha e responde (conclui); o titular vê o desfecho; reencerrar uma solicitação já concluída → 409.

- [ ] (manual) Conferir o texto de prazo (15 dias úteis) e o e-mail do encarregado (DPO) exibidos ao titular
- [ ] (manual) Fluxo pela UI (`/perfil` / painel LGPD) além dos endpoints
