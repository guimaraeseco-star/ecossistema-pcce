# Sistema de Gestão de Escalas — PCCE

Plataforma de gestão de escalas de plantão, expediente e GISE (Grupo de Intervenção e Suporte Especializado) da Polícia Civil do Estado do Ceará. Inclui geração de PDFs, assinatura digital ICP-Brasil (e-CPF via WebPKI/SERPRO), reconhecimento facial e controle completo de produtividade.

---

## Índice

1. [Stack Tecnológico](#1-stack-tecnológico)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Setup do Ambiente Local](#3-setup-do-ambiente-local)
4. [Variáveis de Ambiente](#4-variáveis-de-ambiente)
5. [Banco de Dados](#5-banco-de-dados)
6. [Scripts Disponíveis](#6-scripts-disponíveis)
7. [Arquitetura e Estrutura de Pastas](#7-arquitetura-e-estrutura-de-pastas)
8. [Módulos do Sistema](#8-módulos-do-sistema)
9. [Autenticação e Autorização](#9-autenticação-e-autorização)
10. [Padrões de Código](#10-padrões-de-código)
11. [Testes](#11-testes)
12. [Deploy em Produção](#12-deploy-em-produção)
13. [Softwares Externos e Integrações](#13-softwares-externos-e-integrações)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Stack Tecnológico

> As versões exatas estão no [`package.json`](package.json) — a tabela abaixo indica apenas a versão _major_ adotada.

| Camada                | Tecnologia                                                     | Major |
| --------------------- | -------------------------------------------------------------- | ----- |
| Meta-framework        | SvelteKit                                                      | 2     |
| UI                    | Svelte (runes)                                                 | 5     |
| Estilização           | Tailwind CSS + Skeleton UI                                     | 4 / 4 |
| ORM                   | Drizzle ORM                                                    | 0.4x  |
| Banco de dados        | Cloudflare D1 (SQLite serverless)                              | —     |
| Armazenamento         | Cloudflare R2 (PDFs, selfies, documentos)                      | —     |
| Hospedagem            | Cloudflare Pages (edge runtime)                                | —     |
| Validação             | Zod                                                            | 4     |
| Assinatura digital    | pdf-lib + @signpdf + node-forge + web-pki                      | —     |
| Reconhecimento facial | @vladmandic/face-api (TensorFlow.js)                           | 1     |
| E-mail                | Cloudflare Email Sending (binding `EMAIL`) + Resend (fallback) | —     |
| Geração de documentos | jsPDF + ExcelJS + docx                                         | —     |
| Monitoramento         | Sentry (Cloudflare Workers)                                    | 10    |
| Testes unitários      | Vitest                                                         | 4     |
| Testes E2E            | Playwright                                                     | 1     |
| Build                 | Vite                                                           | 8     |
| Linguagem             | TypeScript                                                     | 5     |

---

## 2. Pré-requisitos

Antes de começar, certifique-se de ter instalado:

- **Node.js v22+** (alinhado ao `engines` do `package.json`) — [nodejs.org](https://nodejs.org)
- **npm** (vem com o Node.js)
- **Wrangler CLI** (para interagir com Cloudflare localmente):
  ```bash
  npm install -g wrangler@latest
  ```

Opcionalmente, para testes E2E:

- **Playwright** com Chromium (instalado abaixo no setup)

Não é obrigatório ter conta Cloudflare para desenvolvimento local — o Wrangler/Miniflare simula D1 e R2 na sua máquina.

---

## 3. Setup do Ambiente Local

### 3.1 Clonar e instalar

```bash
git clone <url-do-repositorio> escalas
cd escalas
npm install
```

### 3.2 Configurar variáveis de ambiente

Crie o arquivo `.dev.vars` na raiz do projeto (o Wrangler usa esse arquivo para simular _secrets_ localmente):

```bash
cp .env.example .dev.vars
```

Edite `.dev.vars` com os valores mínimos para desenvolvimento:

```ini
# Gere cada um com `openssl rand -hex 32`. NÃO use uma string curta qualquer:
# os webhooks recusam SYNC_TOKEN com menos de 32 caracteres (fail-closed contra
# segredo fraco em produção), e a suíte E2E falha com 401 se você encurtar.
SYNC_TOKEN=<openssl rand -hex 32>
RESET_TOKEN=<outro openssl rand -hex 32, diferente do SYNC_TOKEN>
# Opcional — só se quiser testar envio de e-mail (2FA, primeiro acesso):
# RESEND_API_KEY=re_...
# RESEND_FROM_EMAIL=onboarding@resend.dev
```

> Veja a seção [Variáveis de Ambiente](#4-variáveis-de-ambiente) para a lista completa.

### 3.3 Criar o banco de dados local

```bash
npm run db:migrate
```

Isso aplica todas as migrações SQL na instância local do D1 (SQLite gerenciado pelo Wrangler em `.wrangler/`).

### 3.4 Iniciar o servidor

```bash
npm run dev
```

Acesse **http://localhost:5173**. O SvelteKit roda integrado ao Cloudflare adapter, simulando todas as _bindings_ (D1, R2) configuradas no `wrangler.toml`.

### 3.5 Modelos de reconhecimento facial

Os modelos do face-api já estão em `static/face-api/` e são servidos diretamente. Nenhuma ação adicional é necessária — o download é feito sob demanda pelo navegador.

### 3.6 Fluxo de desenvolvimento típico

```bash
# Terminal 1: servidor de desenvolvimento
npm run dev

# Terminal 2: type-check contínuo (altamente recomendado)
npm run check:watch

# Terminal 3: testes unitários em watch mode
npm run test:watch
```

Antes de abrir um PR, sempre execute:

```bash
npm run lint:fix   # corrige erros de lint automaticamente
npm run format     # formata o código com Prettier
npm run check      # type-check final
npm run test       # testes unitários
```

---

## 4. Variáveis de Ambiente

### Arquivo `.dev.vars` (local) / Cloudflare Pages → Settings → Environment Variables (produção)

> **Fonte autoritativa:** a lista completa e comentada de todas as variáveis está em [`.env.example`](.env.example); os tipos em [`src/app.d.ts`](src/app.d.ts). Para o detalhe operacional de cada uma (avisos, rotação, go-live), veja [`DEPLOY.md`](DEPLOY.md). A tabela abaixo resume as principais.

| Variável                                                           | Obrigatória | Descrição                                                                                                                                                                   |
| ------------------------------------------------------------------ | :---------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SYNC_TOKEN`                                                       |     ✅      | Bearer token para os webhooks de sincronização (`/api/webhook/sync-policiais`, `/api/webhook/sync-unidades`). Gere com `openssl rand -hex 32`.                              |
| `RESET_TOKEN`                                                      |     ⚠️      | Token **separado** do `SYNC_TOKEN` para o endpoint destrutivo `/api/webhook/reset-policiais`. Se não definido, o endpoint retorna 401 (fail-closed seguro).                 |
| E-mail (binding `EMAIL` ou `RESEND_API_KEY` + `RESEND_FROM_EMAIL`) | ✅ produção | Envio de 2FA, primeiro acesso e reset de senha. **Sem e-mail funcionando, o login com 2FA trava (fail-closed).**                                                            |
| `PASSWORD_PEPPER`                                                  | ⚠️ produção | Pepper de senha (HMAC antes do PBKDF2, formato `pbkdf2v3`). **Nunca rotacionar** sem plano de migração — ver [`DEPLOY.md`](DEPLOY.md#hashing-de-senha-e-o-password_pepper). |
| `CPF_ENCRYPTION_KEY` / `CPF_INDEX_KEY`                             | ⚠️ produção | Cifra de CPF em repouso (AES-256-GCM) + índice cego para lookup (LGPD).                                                                                                     |
| `RATE_LIMIT_IP_SALT`                                               | ⚠️ produção | Muda a chave do rate-limit de "/24 anonimizada" para hash salteado do IP completo (evita lockout do NAT corporativo).                                                       |

> **Teto de geração pesada.** As rotas que MONTAM documento (PDF da escala, comprovante de presença avançado) têm limite por **conta**, não por IP — ver [`rate-limit-pesado.ts`](src/lib/server/rate-limit-pesado.ts). São rotas autenticadas e autorizadas: o que faltava não era permissão, era custo. Contar por conta é o que evita o lockout que o `RATE_LIMIT_IP_SALT` acima descreve — numa delegacia todos saem pelo mesmo endereço, e um plantão em laço derrubaria o download dos colegas. Reusa `recovery_attempts` com propósito próprio, sem migration.
> | `APP_ORIGIN` | ⚠️ produção | Origem canônica (`https://...`) usada nos links de e-mail. |
> | `SUPER_ADMIN_LOGIN` / `SUPER_ADMIN_SENHA` / `SUPER_ADMIN_EMAIL` | ❌ | Conta root de break-glass via env. Prefira senha em hash PBKDF2 e defina o e-mail para exigir 2FA — ver [`DEPLOY.md`](DEPLOY.md#variáveis-e-secrets). |
> | `ADMIN_GERAL_LOGIN` / `ADMIN_GERAL_SENHA` | ❌ | Login de Admin Geral via env (bootstrap). Logins por credencial de bootstrap são auditados (`login_bootstrap`). |
> | `GISE_BASE_EQUIPE_WEBHOOK_URL` | ❌ | URL do Google Apps Script que popula a aba `Base_Equipe` da planilha. Ex: `https://script.google.com/macros/s/AKfy.../exec` |
> | `GISE_BASE_EQUIPE_SECRET` | ❌ | Segredo compartilhado com `ScriptProperties.BASE_EQUIPE_SECRET` no Apps Script. Gere com `openssl rand -hex 32`. |

> **Dica:** Use `openssl rand -hex 32` para gerar qualquer token seguro de 256 bits.
>
> **Legado:** `GMAIL_USER`/`GMAIL_APP_PASSWORD` (SMTP Gmail) não são mais lidos — o envio de e-mail usa o binding `EMAIL` da Cloudflare com fallback Resend.

### Bindings Cloudflare (`wrangler.toml`)

Não são variáveis de ambiente, mas recursos Cloudflare vinculados automaticamente:

| Binding        | Tipo        | Descrição                                             |
| -------------- | ----------- | ----------------------------------------------------- |
| `escalas_db`   | D1 Database | Banco de dados SQLite serverless principal            |
| `escalas_docs` | R2 Bucket   | Armazenamento de PDFs, selfies e documentos assinados |

---

## 5. Banco de Dados

### Tecnologia

O projeto usa **Cloudflare D1** (SQLite serverless) via **Drizzle ORM**. O schema está em `src/lib/server/schema.ts`.

- **Local**: SQLite gerenciado pelo Wrangler em `.wrangler/state/v3/d1/`
- **Produção**: D1 na infraestrutura Cloudflare

### Principais tabelas

| Tabela                           | Descrição                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `policiais`                      | Servidores (matrícula, CPF, cargo, lotação, senha PBKDF2, papel RBAC)                                                        |
| `policial_historico`             | Histórico funcional por servidor (movimentações, afastamentos, desvinculações, diffs de edição) com PDF anexo no R2          |
| `cadastro_solicitacoes`          | Pedidos de correção de CAMPO do cadastro (uma linha por campo), com justificativa e solicitante                              |
| `policial_acao_solicitacoes`     | Pedidos de movimentação/afastamento/desvinculação aguardando o Admin Geral, com a portaria anexa no R2                       |
| `administradores`                | Admins gerais do sistema                                                                                                     |
| `sessoes`                        | Sessões ativas (token, tipo, expiração em 1h de inatividade)                                                                 |
| `escalas`                        | Escalas de plantão, expediente e FDS                                                                                         |
| `escala_policiais`               | Associação policial ↔ escala (data, horário, equipe)                                                                         |
| `escala_documentos`              | PDFs assinados com metadados CAdES-LT (OCSP, TST, selfie, GPS, IP)                                                           |
| `audit_pendencias`               | Evento de auditoria que a cadeia recusou — reprocessado pelo cron de retenção                                                |
| `assinatura_intencoes`           | Amarra cada PDF preparado ao documento, ao assinante e a um único uso (15 min)                                               |
| `escala_solicitacoes_assinatura` | Solicitações de assinatura por unidade/respondência                                                                          |
| `unidades`                       | Hierarquia: departamento → seccional → delegacia. Ligada por **nome** (ver abaixo). `sigla` ("DPI SUL") só em departamento   |
| `operacoes`                      | Operações extraordinárias (GISE, CRAJUBAR, EDGE): tipos de equipe, ciclo, `ativo` e a config de escala da operação           |
| `operacao_linha_base`            | Valor inicial de cada indicador por (operação, unidade) — o denominador das metas percentuais                                |
| `gise_escalas`                   | Escalas extras (status, supervisor, assessor, configuração) — cada uma pertence a uma `operacao`                             |
| `gise_seccionais`                | Seccionais dentro de uma GISE                                                                                                |
| `gise_equipes`                   | Equipes (operacional/SEINT) com slots DPC/OIP                                                                                |
| `gise_membros`                   | Associação policial ↔ equipe GISE                                                                                            |
| `gise_presencas`                 | Registros de entrada/saída (GPS, selfie)                                                                                     |
| `gise_documentos`                | PDFs assinados de GISE                                                                                                       |
| `gise_modelo_formulario`         | Modelo do formulário de produtividade em JSON, um por (operação, tipo de equipe) — e a ordem dos cards do painel             |
| `gise_respostas_formulario`      | Respostas de formulários (JSON) por policial/equipe                                                                          |
| `gise_assinaturas_relatorios`    | Assinaturas de relatórios de extra/produtividade                                                                             |
| `custo_parametros`               | Valores de hora extra por faixa e das diárias, em centavos — **append-only**: cada gravação é uma versão nova                |
| `planos_operacionais`            | Plano operacional (operação COM deslocamento): número/ano, janela, coordenador, demandante, signatário e a versão de valores |
| `plano_opcoes`                   | Listas de BRIEFING, CIDADE DE ORIGEM e CIDADE DE DESTINO que o plano oferece aos seletores das equipes — uma padrão por tipo |
| `municipios`                     | Os 5.571 municípios do Brasil: código IBGE, nome oficial e coordenada da SEDE (CE na 0072, o resto na 0078)                  |
| `distancias_municipios`          | Distância RODOVIÁRIA entre duas sedes, em km — 16.836 pares, uma linha por par não ordenado                                  |
| `distancias_medicao`             | Procedência da matriz: de onde veio e quando foi medida                                                                      |
| `feriados`                       | Calendário nacional 2026–2030, gerado por `scripts/gerar-feriados.mjs`; só SUGERE, o pedido guarda a própria declaração      |
| `tempos_municipios`              | Matriz de TEMPO de trajeto (minutos) entre os municípios do Ceará, para a jornada da diária — separada da de km por decisão  |
| `tempos_medicao`                 | Procedência da matriz de tempos                                                                                              |
| `plano_equipes`                  | Equipes do plano: viatura, origem/destino e a distância entre eles, briefing, horário próprio e a rubrica                    |
| `plano_equipe_membros`           | Efetivo do plano, com `cargo`/`classe` CONGELADOS — são a base de cálculo, não acompanham promoção                           |
| `colaboradores`                  | A terceira identidade: servidora administrativa e terceirizada. Tipo de sessão próprio, que FALHA FECHADO fora do concedido  |
| `aceites_termos`                 | Histórico de aceite de termos de uso (versão, hash, IP, user-agent). `usuario_tipo` admite `colaborador` desde a 0081        |
| `audit_log`                      | Trilha de auditoria forense (eventos de negócio, cadeia de hash tamper-evident)                                              |
| `app_log`                        | Logs técnicos do servidor (warn/error do logger, correlacionados por `request_id`)                                           |

### Unidades formam UMA árvore, e a pergunta é sempre "está abaixo de"

Desde a fase 1 do Ecossistema (migração `0084`, decisões E23/E24/E26) a árvore de
`unidades` cobre o organograma inteiro da Polícia Civil (Decreto 37.465/2026), não só
departamento → subdepartamento → seccional → delegacia. Os tipos vivem num
catálogo único, [`src/lib/unidades/tipos.ts`](src/lib/unidades/tipos.ts) — fonte
do enum do schema, do Zod de `/unidades`, dos rótulos e da régua "quem pode ser pai
de quem" (pai precisa estar ACIMA na precedência; mesmo nível não pode).

- `seccional_id` é o **pai genérico**, apesar do nome (renomear a coluna exigiria
  reconstruir a tabela sem ganho de comportamento). Departamento especializado
  liga delegacia direto a si, sem seccional — por isso **nenhum código conta
  níveis fixos**: `ancestraisDe`, `subarvoreDe` e `departamentoDe` em
  [`src/lib/db/unidades.ts`](src/lib/db/unidades.ts) caminham na árvore carregada
  em memória (`arvoreUnidades`), param em ciclo e em pai inexistente.
- **O departamento é derivado**, nunca "o único ativo": `departamentoDoPlano(db,
demandanteUnidadeId)` resolve pela unidade demandante do plano operacional;
  `buscarDepartamentoPadrao` ficou só como fallback para quando não há unidade de
  contexto.
- `unidades.abrangencia` (`departamental` | `corporativa`): os órgãos de direção,
  gerência superior e execução instrumental (Delegacia-Geral, DPGI, COGEP,
  Logística, DTO, Corregedoria, CTIC) são irmãos dos departamentos na árvore e
  não ancestrais deles; marcados como corporativos, quem os administra vê a
  corporação inteira. A coluna existe desde a 0084; o resolvedor de escopo passa a
  lê-la na fase 2 (E25/E26).
- A tela `/unidades` mostra qualquer tipo do catálogo e trata toda unidade sem pai
  como raiz; o **cadastro pela tela ainda oferece só seccional e delegacia** — os
  demais níveis entram por migração de semente. A **edição** (modal, fase 2-B)
  aceita qualquer tipo e troca a unidade superior; o servidor recusa fechar
  ciclo (`motivoParaRecusarSuperior`: a própria unidade ou uma vinculada a ela).

### Unidade é referenciada por NOME

Herança da planilha que originou o sistema: `policiais.lotacao` e
`escalas.lotacao` guardam o **nome** da unidade, não uma chave estrangeira. Duas
consequências que valem para qualquer mudança nessa área:

- **Renomear cascateia.** `atualizarUnidade` propaga o nome novo para policiais e
  escalas na mesma operação. Um `UPDATE` direto no banco quebraria os vínculos.
- **Unidade NÃO se exclui — só se desativa.** Não existe ação de excluir na
  interface nem função de DELETE na camada de dados: `definirUnidadeAtiva` marca
  `ativo = 0`, a unidade some das listas de escolha (`listarUnidades`) e continua
  existindo para todo o resto. A tela de gestão usa `listarTodasUnidades` e a
  exibe marcada como "Desativada", com botão de reativar.

  O motivo é a assinatura: `gise_assinaturas_relatorios.seccional_id` referencia
  `unidades(id)`, e o D1 aplica chave estrangeira de verdade. Apagar a unidade
  levava junto o registro do ato de assinar — assinante, CPF, selfie,
  IP, GPS, hash do arquivo e a chave do PDF no R2 — e o portal público
  `/validar` passava a responder "documento não encontrado" para um papel já
  entregue, indistinguível de documento falso. Escala e lotação, que ligam por
  NOME e sem FK, ficavam órfãs sem erro nenhum.

  Como defesa em profundidade, a FK passou de `CASCADE` para `RESTRICT`
  (migração `0038`): mesmo um `DELETE` manual fora da aplicação é recusado pelo
  banco.

### Comandos de migração

```bash
# Aplicar migrações localmente
npm run db:migrate

# Aplicar migrações em staging (D1 dedicado escalas-db-staging)
npm run db:migrate:staging

# Aplicar migrações em produção (requer Wrangler autenticado; --yes obrigatório)
npm run db:migrate:prod -- --yes
```

> **Importante:** as migrações são **escritas à mão**, e editar
> `src/lib/server/schema.ts` **não cria tabela nenhuma** — muda só o tipo visto
> pelo TypeScript. Uma coluna que existe só no schema compila, passa no `check` e
> falha no primeiro `SELECT`. Toda alteração precisa do par: schema **+** um
> `migrations/00NN_descricao.sql` novo.
>
> Não use `drizzle-kit generate`. O `drizzle.config.ts` ainda aponta para o
> schema e as 12 primeiras migrações saíram dele, mas o gerador não produz o
> _rebuild_ de tabela (criar nova → copiar → dropar → renomear) que o SQLite do
> D1 exige para quase todo `ALTER` real.

### Histórico de migrações

O histórico completo está na própria pasta [`migrations/`](migrations/) — os nomes dos arquivos são autoexplicativos (`0000_initial_schema.sql` … `0069_plano_signatario.sql`). Para entender uma migração específica, leia o SQL dela e o trecho correspondente do [`src/lib/server/schema.ts`](src/lib/server/schema.ts).

O que já rodou em cada ambiente é rastreado pela tabela `_migrations_aplicadas`, gravada pelo runner [`scripts/migrate.ts`](scripts/migrate.ts). (O `migrations/meta/` do `drizzle-kit` foi removido em jul/2026: ficou parado em 2 entradas para dezenas de arquivos e só induzia a erro.)

---

## 6. Scripts Disponíveis

```bash
# Desenvolvimento
npm run dev                # Servidor local (localhost:5173)
npm run build              # Build de produção (.svelte-kit/cloudflare/)
npm run preview            # Pré-visualização local da build

# Qualidade de código
npm run check              # Type-check (Svelte Check + TypeScript)
npm run check:watch        # Type-check contínuo
npm run lint               # ESLint
npm run lint:strict        # ESLint falhando com qualquer warning
npm run lint:ci            # ESLint com o teto de warnings usado no CI (ratchet)
npm run lint:fix           # ESLint com auto-fix
npm run format             # Prettier em src/ (escreve)
npm run format:check       # Prettier em src/ sem alterar (só verifica)
npm run format:e2e         # Prettier em e2e/ (escreve)
npm run format:check:e2e   # Prettier em e2e/ sem alterar (gate próprio no CI)
npm run knip               # Detecção de código/exports mortos
npm run docs:inventario    # Inventário de documentação (cabeçalhos, contratos, opacos)
npm run docs:guard         # Falha se arquivo NOVO em lib/db vier sem doc (roda no CI)
npm run guard:autorizacao  # Falha se operação material não recusar ninguém (roda no CI)
npm run guard:duplicacao   # Falha em bloco de 10 linhas copiado entre arquivos (roda no CI)
npm run guard:achados      # Falha se sigla de achado citada no código não tiver onde ser lida (roda no CI)
npm run guard:entrada      # Falha se campo de FormData for lido sem limite no servidor (roda no CI)

# Testes
npm run test               # Vitest (run once)
npm run test:watch         # Vitest (watch mode)
npm run test:coverage      # Vitest com cobertura
npm run test:e2e           # Playwright (build + preview automáticos)
npm run test:e2e:ui        # Playwright com UI de debug
npm run test:e2e:report    # Abre o relatório da última execução E2E

# Banco de dados
npm run db:migrate               # Aplica migrações localmente
npm run db:migrate:staging       # Aplica migrações no D1 de staging
npm run db:migrate:prod -- --yes # Aplica migrações em produção (--yes obrigatório)

# Utilitários de usuários (scripts/)
# `--yes` nunca vem embutido (igual ao db:migrate:prod); contra produção,
# CONFIRMO_PRODUCAO precisa conter o nome do banco. Ver scripts/confirmar-producao.ts
npm run users:set-default-password -- --yes              # senha padrão p/ todos (local)
npm run users:clear-passwords-non-admins -- --yes        # limpa senhas de não-admins (local)
CONFIRMO_PRODUCAO=escalas-db npm run users:set-default-password:prod -- --yes
CONFIRMO_PRODUCAO=escalas-db npm run users:clear-passwords-non-admins:prod -- --yes
```

> **Duplicação / código morto:** além do `knip`, o repositório versiona [`.fallowrc.json`](.fallowrc.json) para o [`fallow`](https://github.com/fallow-rs/fallow) (`fallow dupes`) — sinal de investigação nas auditorias de compreensibilidade, não gate de CI.

### Revisão de PR grande: `npm run docs:inventario`

Antes de abrir (ou revisar) um PR que mexe em muitos arquivos, rode:

```bash
npm run docs:inventario          # resumo por categoria
npm run docs:inventario -- --lista   # backlog completo
```

Ele mede três coisas, na ordem de retorno que importa:

| métrica             | o que significa                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------ |
| **sem cabeçalho**   | o arquivo não diz o que é nem quem o usa — comentário de maior retorno                     |
| **opacos**          | ≥ 12 pontos de decisão por 100 linhas e < 6% de comentário: regra de negócio irrecuperável |
| **exports sem doc** | contrato público sem dizer o que devolve, o que assume e que efeito tem                    |

É heurística para PRIORIZAR, não gate: componente com 800 linhas de markup e
2% de comentário pode estar certo — o que ele precisa é do cabeçalho. O gate
automático é só para arquivo novo em `lib/db` (`npm run docs:guard`, no CI).

O histórico da varredura que zerou esse backlog está arquivado — ver
[`docs/HISTORICO.md`](docs/HISTORICO.md).

---

## 7. Arquitetura e Estrutura de Pastas

```
escalas/
├── src/
│   ├── routes/                     # Rotas SvelteKit (páginas + APIs)
│   │   ├── api/                    # Endpoints REST
│   │   │   ├── auth/               # Login, logout, 2FA, reset de senha
│   │   │   ├── escalas/            # CRUD escalas, geração PDF, assinaturas
│   │   │   ├── gise/               # GISE (escalas, equipes, presenças, formulários)
│   │   │   ├── planos/             # Plano operacional: download do PDF
│   │   │   ├── policiais/          # CRUD policiais, busca
│   │   │   ├── unidades/           # Hierarquia de unidades
│   │   │   ├── validar/            # Validação pública de assinaturas
│   │   │   ├── webhook/            # Sync de planilha Google + reset destrutivo
│   │   │   ├── configuracoes/      # Flags de assinatura (com cache edge)
│   │   │   ├── admin/              # Audit log, compliance, LGPD (incidentes/solicitações/limpeza)
│   │   │   ├── lgpd/               # Solicitações do titular (art. 18)
│   │   │   └── health/             # Health check
│   │   ├── login/                  # Página de login + 2FA + certificado A3
│   │   ├── alterar-senha/          # Troca de senha obrigatória (primeiro acesso)
│   │   ├── redefinir-senha/        # Reset de senha via token
│   │   ├── aceitar-termo/          # Aceite de termo de uso
│   │   ├── +page.svelte            # INÍCIO dos perfis administrativos: 4 cartões grandes (E39)
│   │   ├── grupo/[id]/             # Tela de um grupo da home: os cartões detalhados
│   │   ├── _components/            # Regras de navegação compartilhadas pelas rotas:
│   │   │                           #   menu-visibilidade.ts (sidebar), home-modulos.ts (home) e
│   │   │                           #   bem-vindo-cards.ts (quadros) — as três do MESMO par de flags
│   │   ├── bem-vindo/              # Boas-vindas do policial sem papel (escalas/bem-vindo e gise/bem-vindo só redirecionam para /)
│   │   ├── unidade/                # Gestão de unidade: lista por escopo e ficha ([id]) com contato, foto, AIS, municípios e plantão — E39
│   │   ├── super-admin/            # Console de boas-vindas do Super Admin
│   │   ├── escalas/                # Gestão de escalas (lista, nova, detalhe)
│   │   ├── painel/                 # Dashboard admin
│   │   ├── recebidos/              # Caixa de entrada de escalas recebidas
│   │   ├── gise/                   # GISE (lista, detalhe, config de questões)
│   │   │   └── planos/             # Planos operacionais (lista, criação, editor) — operação COM deslocamento
│   │   ├── res-gise/               # GISE do membro: "Presença GISE" (ativas) e "Histórico GISE" (?status=finalizadas) — duas abas da sidebar, mesma rota
│   │   ├── policiais/              # Gestão de policiais (lista, detalhe, upload CSV)
│   │   ├── unidades/               # Gestão de unidades
│   │   ├── produtividade/          # Dashboard de produtividade
│   │   ├── perfil/                 # Meu perfil — leitura + e-mail pessoal e chave de assinatura (do titular)
│   │   ├── solicitacoes/           # Fila de decisão do Admin Geral (cadastro + movimentar/afastar/desvincular)
│   │   ├── conf-ass/               # Configuração de assinatura
│   │   ├── config-geral/           # Configurações gerais (provedor de e-mail)
│   │   ├── valores/                # Atualização de valores de hora extra e diária (Admin Geral, E39) — versionados
│   │   ├── config-custos/          # Só redireciona (301) para /valores
│   │   ├── servidores/             # Servidores (antes /policiais, que só redireciona) — lista, ficha, upload
│   │   ├── auditoria/              # Trilha forense + logs técnicos (/auditoria/logs)
│   │   ├── validar/                # Validação pública de PDF assinado
│   │   ├── termo/                  # Consulta pública do termo de uso (/termo → versão vigente)
│   │   ├── +layout.svelte          # Layout raiz (sidebar, tema, toast)
│   │   ├── +layout.server.ts       # Load global (usuário, flags, papel GISE)
│   │   └── +error.svelte           # Página de erro
│   ├── lib/
│   │   ├── components/             # Componentes Svelte reutilizáveis
│   │   │   ├── PainelAssinaturaEscala.svelte   # Painel completo de assinatura
│   │   │   ├── PainelAssinaturaToken.svelte    # Assinatura via WebPKI/SERPRO
│   │   │   ├── SignaturePad.svelte             # Confirmação + selfie + GPS + 2FA
│   │   │   ├── SearchableSelect.svelte         # Select com busca async
│   │   │   ├── LoadingOverlay.svelte           # Overlay de loading global
│   │   │   └── ...
│   │   ├── composables/            # Lógica reativa reutilizável (Svelte 5)
│   │   │   ├── useAssinaturaEscala.svelte.ts   # Estado de assinatura
│   │   │   ├── useGiseEstado.svelte.ts         # Estados derivados GISE
│   │   │   ├── useCharts.svelte.ts             # Integração Chart.js
│   │   │   └── ...
│   │   ├── server/                 # Backend puro — nunca importar no cliente
│   │   │   │                       # Raiz = infra transversal; subpastas = domínio
│   │   │   ├── schema.ts           # Schema Drizzle (fonte de verdade do banco)
│   │   │   ├── api.ts              # Helpers de erro da API (ErrorCode, requireAuth…)
│   │   │   ├── email.ts            # Envio de e-mail (binding EMAIL / Resend)
│   │   │   ├── logger.ts           # Logger com contexto de request + persistência
│   │   │   ├── r2-cleanup.ts       # Limpeza de objetos no R2
│   │   │   ├── policial-permissao.ts  # Escopo administrativo sobre o cadastro
│   │   │   ├── assinatura/         # Assinatura digital: PAdES/CAdES, OCSP, TSA, selo
│   │   │   │   ├── pdf-signing.ts      # Geração e assinatura de PDFs
│   │   │   │   ├── pdf-verification.ts # Validação de assinaturas (OCSP, CAdES)
│   │   │   │   ├── icp-brasil/         # Trust store ICP-Brasil
│   │   │   │   └── ...
│   │   │   ├── auth/               # Login, certificado A3, sessão, CSRF, webhooks
│   │   │   ├── escalas/            # Regras de escala: conflito, exclusão, permissão
│   │   │   ├── gise/               # Regras GISE: permissão, papéis, termo de presença
│   │   │   ├── planos/             # Plano operacional: portão de permissão e montagem do custo
│   │   │   ├── export/             # Geração de PDF/XLSX/DOCX
│   │   │   ├── sync/               # Contrato de resposta dos webhooks de sincronização
│   │   │   ├── termo/              # Conteúdo e hash do termo de uso vigente
│   │   │   └── ...
│   │   ├── db/                     # Camada de acesso ao banco (queries tipadas)
│   │   │   ├── core.ts             # getDB()/getR2(), paginação e timestamps SQLite
│   │   │   ├── policiais.ts        # Queries de policiais
│   │   │   ├── escalas.ts          # Queries de escalas
│   │   │   ├── gise/               # Sub-módulo GISE
│   │   │   ├── planos/             # Planos operacionais, equipes, membros e valores de custo
│   │   │   └── ...
│   │   ├── schemas/                # Schemas Zod de validação
│   │   │   ├── auth.ts             # Login, reset, 2FA
│   │   │   ├── escala.ts           # Criação/edição de escala
│   │   │   ├── gise.ts             # GISE e operações
│   │   │   └── ...
│   │   ├── auth.ts                 # Exports públicos de auth (tipos, helpers RBAC)
│   │   ├── api-fetch.ts            # Fetch da API interna (CSRF + erro tipado) — obrigatório
│   │   ├── assinatura-token.ts     # Fluxo preparar → assinar → finalizar com certificado
│   │   ├── enhance-handler.ts      # Resultado de form action → toast (fonte única)
│   │   ├── sync-estado.ts          # Poll de revalidação no cliente (par de server/*/sync-estado)
│   │   ├── institucional.ts        # Nome oficial da corporação e dos órgãos (timbre e prosa)
│   │   ├── planos/                 # Regras puras do plano operacional (faixa de custo, horas, diárias, rótulos)
│   │   ├── serpro.ts               # Cliente WebSocket para Assinador SERPRO Desktop
│   │   ├── csrf.ts                 # Helpers CSRF (cliente)
│   │   ├── loading.svelte.ts       # Estado global de loading
│   │   ├── toast.ts                # Sistema de toasts
│   │   ├── crypto/                 # Primitivas: hash, token opaco, timing-safe, envelope AES
│   │   ├── utils/                  # Utilidades puras (sem barrel — importe o módulo)
│   │   │   ├── datas.ts            # Datas/calendário BR (ISO YYYY-MM-DD, fuso)
│   │   │   ├── formato.ts          # Máscaras de entrada (CPF, telefone, NUP)
│   │   │   ├── pii.ts              # Mascaramento de dado pessoal para exibição
│   │   │   ├── download.ts         # Download de blob no navegador
│   │   │   └── localStorage.ts     # Acesso seguro ao localStorage
│   │   └── logger.ts               # Logger estruturado
│   ├── hooks.server.ts             # Middleware global (CSRF, auth, headers de segurança)
│   ├── app.d.ts                    # Tipos globais (bindings CF, App.Locals)
│   ├── app.css                     # Estilos globais
│   ├── app.html                    # HTML raiz
│   └── theme.css                   # Variáveis CSS do tema
├── migrations/                     # Migrações SQL versionadas (escritas à mão)
├── scripts/                        # Scripts utilitários Node.js
│   ├── migrate.ts                  # Runner de migrações
│   ├── guard-autorizacao.mjs       # Gate CI: operação material precisa recusar alguém
│   ├── guard-docs-novos.mjs        # Gate CI: arquivo novo em lib/db com cabeçalho/JSDoc
│   ├── guard-duplicacao.mjs        # Gate CI: bloco repetido entre arquivos (baseline em duplicacao-baseline.json)
│   ├── guard-achados.mjs           # Gate CI: sigla de achado citada no código tem onde ser lida
│   ├── inventario-docs.mjs         # Inventário de documentação (`docs:inventario`)
│   ├── set-default-password-all-users.ts
│   ├── clear-passwords-non-admins.ts
│   ├── gerar-selo-institucional.mjs
│   └── GoogleAppsScript_Sync.gs   # Google Apps Script (sync planilha)
├── e2e/                            # Testes E2E Playwright
├── docs/                           # Documentação complementar (ver docs/README.md)
│   ├── QA_ASSINATURA_A3_DESKTOP.md # Roteiro de QA manual do fluxo Token A3
│   ├── HISTORICO.md                # Catálogo das auditorias/decisões arquivadas (preservadas no Git)
│   └── auditorias/                 # Auditorias em tratamento — AUSENTE quando não há nenhuma aberta
├── static/
│   └── face-api/                   # Modelos ML do face-api (servidos localmente)
├── wrangler.toml                   # Config Cloudflare (D1, R2, adapter)
├── drizzle.config.ts               # Config Drizzle ORM
├── svelte.config.js                # Config SvelteKit (adapter, CSP)
├── vite.config.ts                  # Config Vite (code splitting, aliases)
├── tsconfig.json                   # Config TypeScript (strict mode)
├── playwright.config.ts            # Config Playwright
├── DEPLOY.md                       # Runbook completo de operações em produção
├── TESTING.md                      # Roteiros de testes manuais (100+ casos)
└── CLAUDE.md                       # Diretrizes de código para o projeto
```

> **Mapa da documentação:** o índice completo (o que é vivo × registro histórico) está em [`docs/README.md`](docs/README.md).

---

## 8. Módulos do Sistema

### Escalas

Gestão do ciclo de vida de escalas de plantão, expediente e finais de semana (FDS):

- Criação e edição com seleção de policiais por unidade
- Geração de PDF com layout oficial
- Envio por e-mail para destinatário configurado
- Assinatura digital com e-CPF (WebPKI ou SERPRO Desktop)
- Validação pública de autenticidade via QR Code / hash

### Escala extra (operações)

Gerenciamento das escalas extraordinárias. A GISE deixou de ser a única: a aba
`/operacoes/gise` chama-se **Escala extra** e lista as escalas de TODAS as operações, com
filtro por operação na própria página.

**Operação** (`/operacoes/gise/operacoes`, Admin Geral) é cadastro: nome, sigla, ciclo, e
quais tipos de equipe usa — uma operação pode ter só equipe operacional, só de
inteligência, ou as duas. Cada operação é dona dos SEUS formulários de
produtividade (um por tipo de equipe habilitado), e criar uma nova pede em qual
operação basear o formulário, para não começar do zero.

**Operação COM escala não se exclui, desativa-se**: escala histórica e PDF
assinado continuam apontando para ela, e apagá-la deixaria documento entregue sem
origem. Operação que nunca recebeu escala nenhuma — a criada por engano, a de
teste — não é história de nada e ganha **Excluir**, levando junto os formulários
dela. Quem recusa é a action, recontando as escalas no servidor: a contagem que a
tela mostrou pode ter envelhecido, e o botão escondido nunca foi autorização.

A tela é um **slider de dois painéis**, no mesmo desenho do fluxo de presença de
`/operacoes/presenca`: a lista à esquerda, o formulário à direita. O painel aberto vive na
URL (`?form=nova` ou `?form=<id>`), e não num estado local — é o que faz o
"voltar" do navegador desfazer a abertura e o que permite ao endereço antigo
`/operacoes/gise/operacoes/[id]/config` redirecionar para o painel certo.

A LISTA não tem botão de voltar: Operações tem entrada própria na barra lateral,
e botão de voltar é de tela de DETALHE, alcançada de dentro de outra. O único
"Voltar às operações" da tela é o do painel do formulário, que fecha o painel. Os
botões de cada linha usam a faixa de navegação do §10 (`py-1.5`) e ficam
ancorados no topo à direita — o grupo quebra dentro de si, nunca em bloco, para
que todas as linhas terminem na mesma margem.

**Identidade e configuração são o MESMO formulário**, na criação e na edição:
nome, sigla, ciclo e tipos de equipe junto de vagas padrão, horário padrão e os
textos do bloco "Breve relatório" dos PDFs de extra. Antes eram dois botões e
duas telas, e quem criava uma operação saía com metade dela por preencher, sem
nada indicando isso. **Campo vazio herda o padrão do sistema**, e é isso que
torna a unificação inócua para o que já existe. Zero não é vazio (`0` = "esta
equipe não tem essa vaga").

A precedência, do mais específico ao mais geral:

```
colunas de gise_escalas → colunas de operacoes → configuracoes → constante do código
```

**Como se chega a cada coisa.** O editor do formulário de produtividade
(`/operacoes/presenca`) saiu da barra lateral do Admin Geral: formulário é DE uma operação,
e o item solto obrigava a escolher a operação depois de entrar. O caminho é o
botão **Formulário** de cada linha, e a tela tem o "voltar às operações" acima do
título.

**A barra lateral tem DOIS NÍVEIS.** Tudo que é de escala extra — Ativas,
Finalizadas (Admin Geral), Produtividade, Dados base, Minha presença, Meu
histórico — vive sob o item
**"Escala extra"**, que ao ser clicado SUBSTITUI o conteúdo da barra pelo
submenu. Antes eram até cinco linhas soltas, e o admin seccional via oito itens
de uma vez sem que nada dissesse que cinco eram do mesmo assunto — estavam só
perto uns dos outros.

Três decisões registradas:

- **substitui, não expande.** Cinco itens indentados sob um pai devolveriam a
  lista comprida que o agrupamento veio desfazer;
- **o nível é decidido ao ABRIR, pela rota** (`openSidebar`). Abrir o menu em
  `/operacoes/produtividade` e cair na raiz esconderia justamente onde a pessoa está;
- **`/operacoes/gise/operacoes` fica na RAIZ.** É cadastro, não operação do dia a dia, e
  acompanha os outros itens de gestão do Admin Geral.

O filho que leva a `/operacoes/gise` chama-se **"Ativas"** (as que estão em andamento).
O arquivo das já encerradas é a aba **"Finalizadas"** (`/operacoes/gise/finalizadas`), só
do Admin Geral, imediatamente abaixo de Ativas e acima de Produtividade.

Quem vê cada filho é `filhosExtra` (`+layout.svelte`), com as MESMAS condições de
antes do agrupamento, uma por uma. O pai só aparece se a lista não estiver vazia,
para nunca abrir num submenu vazio. E agrupar é apresentação: o recorte de verdade
segue no servidor — esconder item de menu nunca foi autorização.

**`/operacoes/dados-base` na barra lateral** aparece só para admin de unidade/seccional que
tenha efetivamente base a informar — unidade escalada em operação ativa com
indicador percentual (`temLinhaBaseAPreencher`). Antes aparecia para todo admin de
unidade, inclusive os de delegacias fora de qualquer operação, que abriam uma
tela vazia. Para o Admin Geral, o acesso é o botão **Dados base** na linha da
operação em `/operacoes/gise/operacoes` — e ele só existe na operação que PEDE base
(`operacoesComLinhaBase`, o mesmo critério da flag do menu). Nada disso é
autorização: quem recusa continua sendo `unidadesLinhaBaseAdministradas`, no
servidor.

**A operação vai no CAMINHO, não num seletor.** O preenchimento vive em
`/operacoes/dados-base/[operacaoId]`; `/operacoes/dados-base` é só o índice, que redireciona quando há
uma pendência só e oferece a lista quando há mais. Até ago/2026 a operação vinha
de `?operacaoId=` e a tela trazia um `<select>` ao lado dos campos — e o valor
digitado ali é o denominador de um percentual divulgado: gravá-lo sob a operação
errada muda o atingimento de uma unidade sem tocar em relatório nenhum. Com a
operação no caminho não há controle a errar, e a escolha acontece antes de
qualquer campo aparecer.

O **destino do "Voltar"** dessa tela vem do `load`, não é fixo: Admin Geral volta
a `/operacoes/gise/operacoes`, que é a porta por onde ele entrou; admin de unidade volta ao
índice **só quando há mais de uma** pendência. Com uma só não há botão — o índice
redirecionaria de volta para a mesma tela, e um "Voltar" que não sai do lugar é
pior que nenhum.

Sobre a rota ser `/operacoes/dados-base` e não `/operacoes/gise/dados-base`: `/operacoes/gise` é o prefixo
LEGADO — a GISE virou uma operação entre várias, e aninhar telas novas sob ele
espalharia um nome que o domínio já superou. Não há `+layout` compartilhado sob
`/operacoes/gise`, então o aninhamento também não compraria autorização nem dados comuns. Se
um dia a coerência de prefixo for perseguida, o caminho é renomear o módulo
inteiro, não estender o nome antigo.

**Indicadores e metas.** No editor do formulário (`/operacoes/presenca`), uma pergunta
contável pode ser marcada como indicador. São **três tipos de meta**, e é o
`metaTipo` que discrimina a união `IndicadorConfig` (`src/lib/types.ts`):

| `metaTipo`   | O que mede                            | Objetivo            | Linha de base |
| ------------ | ------------------------------------- | ------------------- | ------------- |
| `percentual` | variação sobre o valor inicial (−20%) | aumentar / diminuir | **exige**     |
| `absoluto`   | alvo fixo (mínimo de 1 por unidade)   | aumentar / diminuir | não usa       |
| `proporcao`  | cobertura: % do total atendido (100%) | **não tem**         | não usa       |

A meta percentual exige uma **linha de base** — o valor de partida da unidade —,
informada pelo admin de unidade/seccional em **`/operacoes/dados-base`**; se ela não foi
informada, o valor é pedido dentro do próprio formulário de produtividade.

`proporcao` é o tipo de **cobertura**, e anda junto com o tipo de campo
homônimo: uma pergunta só com dois números (o total existente e a parte
atendida), gravados em `${key}__total` e `${key}__parte`. Existe porque "atender
100% das ocorrências" não se mede com um número solto — 12 atendimentos são
ótimos se houve 12 ocorrências e ruins se houve 40. Ela não tem `objetivo`
(cobrir um todo não é aumentar nem diminuir) e não pede base: o denominador vem
no mesmo relatório. Só o tipo de campo `proporcao` aceita esta meta.

`/operacoes/produtividade` mostra base × realizado × meta por unidade, com filtro por
operação — e, nos indicadores de cobertura, a **porcentagem coberta** com a meta
como limiar constante, porque contagem e porcentagem não compartilham eixo.

### O que entra no painel, e em que forma

Tudo em `/operacoes/produtividade` sai do MODELO do formulário, e cada seção entra por um
critério diferente. Confundi-los foi a origem dos bugs corrigidos em ago/2026.

| Seção                 | Entra quando…                                            |
| --------------------- | -------------------------------------------------------- |
| Indicadores e metas   | a pergunta tem `indicador`                               |
| Colunas por unidade   | a pergunta tem `grafico.colunas`                         |
| Ranking de unidades   | a pergunta tem `grafico.ranking`                         |
| Detalhamento por tipo | a pergunta tem `grafico.detalhe` **e** comporta a quebra |
| Prisões (bloco fixo)  | o formulário TEM `prisoes_maiores` ou `mandados_maiores` |

**A marca é uma escolha, não uma consequência do tipo.** Até ago/2026 toda
pergunta de tipo contável virava card sozinha, e a quilometragem inicial da
viatura ocupava espaço ao lado das prisões — sem jeito de tirá-la a não ser
apagando o campo, o que apagaria a coleta. Agora o bloco "Mostrar na
produtividade" fica no editor, ao lado do de indicador, com uma caixinha por
forma. Marca e indicador são independentes: gráfico é uma leitura, indicador é
uma promessa com meta e linha de base.

**O título do card não é o enunciado da pergunta.** São públicos diferentes: a
pergunta é escrita para quem PREENCHE ("10. HOUVE APREENSÃO DE DROGAS?" —
numerada, em caixa alta, interrogativa), e o card é lido por quem ACOMPANHA, onde
serve o substantivo. O campo **"Título no painel de produtividade"** aparece no
editor assim que a pergunta ganha qualquer marca — gráfico ou indicador — e grava
em `rotulo_painel`. Um campo só para as duas marcas, porque o valor é um só e a
pergunta pode ser as duas coisas.

Quem resolve é `tituloNoPainel` (`$lib/produtividade/apresentacao`), em três
degraus: **rótulo próprio** → **identidade do tipo** (`Drogas`, `Armas`) →
**texto da pergunta**. O rótulo ganha até de `Drogas`, que é padrão de fábrica e
não decisão de quem montou a operação. Uma função só porque as duas seções do
painel fazem a mesma pergunta, e escrever a precedência duas vezes é o começo de
"o gráfico respeita o rótulo e o indicador não". Cor e unidade **não** cedem ao
campo: `'g'` diz onde o número foi somado, e trocá-la por digitação faria o card
mostrar gramas chamando-as de outra coisa. Nada disso entra no relatório
assinado — o PDF continua saindo com o enunciado que a pessoa respondeu.

**A ordem dos blocos no card do editor** é identidade da pergunta (etapa, texto,
tipo) → rótulos dos campos → marcas de painel → título do card: do que a pergunta
É para o que ela VIRA. As marcas ficavam no MEIO e empurravam para baixo o campo
que se usa toda vez, em favor de duas caixas que se marcam uma vez.

**As formas acumulam.** A pergunta de armas mostra ranking E detalhamento, que é
como o painel sempre a desenhou — e agora dá para desligar um dos dois. Ranking e
colunas são a MESMA conta em apresentações diferentes (valor por unidade); o
detalhamento é outra pergunta: quebra por categoria DENTRO da resposta.

**Detalhamento só onde existe a quebra.** Ela vive num objeto
`{ categoria: valor }` do blob, e só `drogas_complex` (`drogas_detalhe`) e
`armas_complex` (`armas_detalhe`) o gravam — `podeDetalhar` é quem responde. Nas
demais a caixinha aparece **desabilitada com a explicação**, mesmo padrão do tipo
de meta "Cobertura". Uma pergunta de número tem um valor só; o "detalhamento"
dela seria um card de uma barra.

**Como cada pergunta é somada** é decisão de `valorDaResposta`
(`$lib/produtividade/apresentacao`), e vale igual para as três formas: `sim_nao`
conta ocorrências, droga soma peso normalizado em gramas (mostrado em kg), e os
tipos de lista somam a chave de QUANTIDADE. Eram três cópias dessa regra até
ago/2026, cada uma com a sua tabela de chaves.

**O gate do "Sim".** Nos tipos que perguntam "houve X? → se sim, quantos", a
quantidade só conta com a resposta em `'Sim'` (`exigeSimParaContar`). O blob
guarda o que foi digitado: quem preenche a listagem, muda de ideia e responde
"Não" deixa o número lá. O relatório assinado sempre ignorou esse resto — ele só
expande a lista sob um "Sim" —, e o painel não ignorava. As duas leituras do
mesmo dado discordavam, e a do painel contava produção que o PDF não mostra.

**Prisões é o único bloco que continua escrito no código**, porque o detalhamento
dele soma três perguntas (flagrantes, mandados e total de presos) e uma marca
vive em uma pergunta só. O total de presos (P7) é somado por chave fixa junto do
bloco, e não pelo laço das perguntas marcadas: fosse pelo laço, desmarcar a P7
zeraria o card — um número errado, que é pior que um card ausente.

Duas migrações fizeram a virada sem mudar a tela: a `0053` carimbou o que já era
gráfico e a `0054` converteu esse carimbo em formas, marcando droga e arma com o
par ranking + detalhamento que os blocos fixos desenhavam.

Operação sem indicador, sem bloco e sem pergunta marcada mostra um aviso dizendo
onde é o conserto (o editor do formulário), em vez de uma página só com a barra
de filtros.

### A ordem dos cards: arrastada no painel, não herdada do formulário

Até ago/2026 a ordem era a do MODELO, e não havia como escolhê-la. Mover um card
exigia mover a PERGUNTA no editor — o que renumera o enunciado ("4. HOUVE…") e
reordena o formulário que o policial preenche: arrumar a leitura mexia na coleta.
E a pergunta marcada depois caía onde calhava; se a forma dela fosse ranking, no
TOPO da página, porque a faixa dos rankings vem acima da das colunas.

A ordem passa a ser um dado próprio da operação (`gise_modelo_formulario.painel_ordem`,
migração **0064**): um array JSON de ids de card, montado pelo Admin Geral no
botão **"Organizar painel"** da própria `/operacoes/produtividade`. Organizar na aba de
verdade, e não numa lista de nomes em outra tela, porque o que se arruma é a
leitura e a leitura é visual — o card ganha uma faixa com a posição, a alça e as
setas ↑/↓, e o conteúdo dele fica inerte para o arraste não esbarrar na caixinha
de exportação do canto.

Cinco regras, e nenhuma é estilo:

- **`NULL` = ordem do formulário.** É o que toda operação é até alguém
  organizar, e é o que o botão "Ordem do formulário" devolve;
- **só grava quando DIFERE do formulário.** Se o arranjo na tela é exatamente o
  que a ordem das perguntas daria — por "Ordem do formulário" ou por arrastar e
  voltar ao ponto de partida —, o que vai ao banco é a lista VAZIA. Gravar o
  arranjo natural escrito por extenso daria a mesma tela hoje e CONGELARIA a
  ordem atual das perguntas: reordená-las no editor deixaria de chegar ao painel,
  sem nada explicando. O padrão é seguir o formulário, e só se deixa de segui-lo
  quando alguém de fato personalizou (`mesmaOrdemDeIds`);
- **id fora da lista vai para o FIM** do bloco dele. É isto que responde ao
  "pergunta nova aparece por último" sem exigir uma reorganização a cada campo
  criado — e a alternativa (a lista ter de cobrir todo card existente) daria
  posição arbitrária a quem ainda não estivesse nela;
- **id órfão é ignorado.** A ordenação percorre os CARDS e só consulta a lista
  para saber a posição de cada um; desmarcar a pergunta no editor não deixa card
  fantasma;
- **o card se move dentro do BLOCO dele; o BLOCO se move entre os blocos.** São
  dois níveis, e o modo os distingue pela barra: a escura arrasta a faixa
  inteira, a clara arrasta um card. As três faixas têm formatos diferentes —
  indicador e colunas ocupam a largura inteira, ranking e detalhamento vão dois
  por linha —, e não há para onde levar um gráfico de colunas na grade dos
  rankings; o que se escolhe entre elas é a SEQUÊNCIA.

**As faixas entram na mesma lista salva**, com ids próprios (`bloco-colunas`), e
por isso a ordem das categorias coube sem coluna nova no banco e sem um segundo
caminho de leitura: cada consumidor — cada faixa, e a página com as faixas —
pergunta a posição dos SEUS ids e ignora o resto. Faixa VAZIA não entra na lista
nem ganha barra de arraste: contá-la faria a primeira seta não fazer nada, e no
modo apareceria uma barra sem nada embaixo (operação sem indicador é o caso
comum, não uma borda rara).

Arrastar bloco e arrastar card compartilham o estado, o wrapper e a regra de que
só se solta dentro do próprio escopo (`CardOrdenavel`, com `variante`). O
aninhamento cobrou uma coisa: a inércia do conteúdo (`pointer-events-none`, que
existe para o gesto não esbarrar na caixinha de exportação) pertence à FOLHA — no
bloco ela apagava as setas dos cards de dentro, e o wrapper do bloco passava a
interceptar o clique que era do card. Pelo mesmo motivo os manipuladores de
arraste só param a propagação quando o gesto em curso é do escopo deles: um bloco
solto sobre os cards de outro precisa que o evento SUBA até a faixa.

O bloco de prisões deixou de ter `<section>` própria e entrou na mesma lista dos
demais cards de listagem: ele continua escrito no código (o detalhamento
atravessa três perguntas), mas uma `<section>` acima das outras o pregava no
topo — e um card pregado seria a única exceção sem motivo. O que sobrou de
diferente nele é o ícone.

**A ordem é por (operação × tipo de equipe)**, que é o escopo da própria tela: o
seletor "Operacional / Inteligência" troca o formulário inteiro. A consequência
deliberada é que os cards de INDICADOR, que saem dos dois modelos unificados por
`key` e aparecem nas duas abas, guardam a ordem em separado em cada uma — o
painel operacional e o de inteligência são dois relatórios, para públicos
diferentes, e a manchete de um não precisa ser a do outro. A barra de organização
diz isso na tela.

Quem organiza é o **Admin Geral**, e só ele: a ordem é única e vale para todos
que abrem a operação, então é configuração — do mesmo tipo que o editor do
formulário. Admin de unidade e de seccional entram no painel para LER o resultado
do que informam em `/operacoes/dados-base`, com os dados recortados; esconder o botão não é
a autorização, quem recusa o PUT direto é `requireAdmin` em
`/api/produtividade/ordem`.

**Os botões do cabeçalho seguem essa mesma divisão.** "Organizar painel" muda o
que TODOS veem na operação; "Selecionar todos", "Baixar (imagem)" e "Baixar
(PDF)" produzem um arquivo para quem clicou. Os quatro moraram juntos sob o
rótulo "Baixar gráficos", que descrevia três deles e mentia sobre o primeiro —
hoje são dois grupos, e o de baixar some no modo organizar (ali os cards estão
inertes, e o botão convidaria a exportar um painel em rascunho).

Cobertura: `src/lib/produtividade/__tests__/ordem.test.ts` (a regra do "fim da
lista", ids órfãos, JSON inválido, a ordem das faixas e a comparação com o
natural) e `e2e/produtividade-ordem.spec.ts` (o arraste de card e de faixa, a ida
e volta pelo banco, a pergunta marcada depois, o arranjo que volta ao do
formulário e a recusa ao admin de unidade).

### O eixo do painel: delegacias ou seccionais

A barra de filtros de `/operacoes/produtividade` tem **duas linhas**. A de baixo
(quantidade, ordem, período) começa **recolhida** atrás de "Mais filtros" — é o
que se mexe enquanto se lê. Em cima fica o que se escolhe ao abrir o painel
(operação, "Visualizar por", tipo de equipe). A divisão já foi semântica ("só
os de baixo recortam dado") e desde ago/2026 é de USO. Quem precisa saber o que
recorta dado de verdade: **tipo de equipe e período** — quantidade e ordem
seguem mexendo só na apresentação da MESMA lista.

"Visualizar por" é um EIXO, não um filtro: a mesma resposta pertence às duas
chaves — `seccional_id` e `unidade_id` (este resolvido em
`listarTodasRespostasGise` como `COALESCE(slot, unidade_operacional, seccional)`).
Trocar de modo não recorta nada, só muda por qual delas a lista é somada, e é por
isso que o total do painel não muda ao alternar. Padrão: **Seccionais**, que é o
comportamento histórico.

Quem responde por agrupar, ordenar e recortar é `$lib/produtividade/agrupamento`
— fonte única dos três consumidores (cards de ranking, gráficos por pergunta e o
cabeçalho do PNG exportado). Três decisões dele valem registro:

- **equipe sem slot de delegacia** resolve `unidade_id` para a própria seccional,
  e ela entra no modo Delegacias como linha própria. Sem isso a soma das linhas
  ficaria menor que o total do painel, sem nada explicando a diferença;
- **a ordem é semântica** ("melhores"/"piores", não "maior"/"menor"): quem chama
  informa o valor pelo qual "melhor" se mede. Nos volumes é o total; nos
  indicadores, o **% de atingimento** — num indicador de redução, ordenar pelo
  número cru poria a pior unidade no topo de "melhores primeiro";
- **valor não avaliável** (`null` — unidade sem linha de base, período sem
  ocorrência) vai sempre para o fim, nos dois sentidos: não é a pior, é a que não
  se sabe.

A seção **Indicadores e metas** é a exceção deliberada: continua sempre por
DELEGACIA, porque a linha de base é informada por ela (`operacao_linha_base` é
por unidade) e agregá-la por seccional exigiria somar bases — o que funciona para
o acervo de inquéritos e produz um número sem sentido no indicador de tempo
MÉDIO. Ordem e Top-N valem nela; o eixo, não.

### Baixar os gráficos: PNG e PDF são dois caminhos diferentes

**"Baixar (imagem)"** desenha cada card do zero num canvas próprio
(`$lib/export-charts`) e salva um PNG por gráfico selecionado — com o recorte
descrito no cabeçalho, porque o PNG circula sozinho.

**"Baixar (PDF)"** é `window.print()`: quem pagina é o NAVEGADOR, e a folha é o
que o `@media print` da rota descreve. As duas consequências que importam:

- **quem controla a quebra é CSS**, não um gerador. O card é a unidade
  indivisível (`break-inside: avoid`), então ele só parte quando não cabe inteiro
  numa A4 — que é o que se quer. `overflow: visible` acompanha, porque scroll
  interno (o ranking rola na tela) vira corte no papel, e o teto de largura no
  `<canvas>` existe porque o Chart.js carrega para o papel a largura em px que o
  gráfico tinha na TELA;
- **os seletores são `:global()`, de propósito.** Todo card do painel vem de um
  componente filho (`SecaoGraficos`, `SecaoRankings`, `SecaoIndicadores`), e o
  CSS de componente do Svelte só alcança o markup do próprio arquivo. Escrito
  sem `:global()`, o bloco compilava para `.card.svelte-hash` e não casava com
  card nenhum: as regras existiam desde sempre e nunca valeram — era esse o
  gráfico partido ao meio relatado em ago/2026. O prefixo
  `.pagina-produtividade` devolve o limite que o escopo dava.

O cromo da tela (barra do topo, gaveta, filtros e os próprios botões de baixar)
sai por `print:hidden`, e com seleção ativa o papel leva só os cards
selecionados. Cabeçalho e rodapé do PDF (data, URL, número da página) são do
navegador, não da página: quem imprime tira em **Mais definições → Cabeçalhos e
rodapés**. Coberto por `e2e/produtividade-graficos.spec.ts`, que roda as
asserções em `media: print` — na tela as regras não valem, e CSS compilado
"existe" mesmo quando não seleciona nada.

O tipo de equipe indisponível na operação aparece **desabilitado**, não escondido:
o botão apagado diz que a operação não usa aquele tipo (`tiposEquipeHabilitados`,
em `$lib/gise/tipos-equipe`, compartilhado com o editor de formulário).

Os indicadores da OPERAÇÃO CRAJUBAR vêm semeados pela migração `0050` a partir
da tabela §9 do Plano Operacional Estratégico; a `0052` converte o de
atendimentos em fins de semana para cobertura de 100%, que é o que o plano pede.

### O quadro da seccional: uma ABA por unidade participante

Dentro do card de cada seccional em `/operacoes/gise/[id]`, as delegacias participantes são
**abas**: o painel abaixo mostra as equipes da aba aberta, e trocar de aba troca
o painel inteiro. Até ago/2026 cada unidade era uma CAIXA empilhada — faixa com
o nome e o "Remover DP", moldura, e as equipes espremidas dentro. Eram três
linhas de moldura por delegacia, tiradas justamente do espaço dos quadros de
equipe.

A troca é real e está registrada aqui porque não é gratuita: **só uma unidade
aparece por vez**. O que devolve a leitura de relance é o que a aba carrega —
`resumoDoSlot` (`$lib/gise/page-helpers`) dá o contador de equipes e o ponto
âmbar de "há vaga sem policial nesta unidade", para que "falta gente na Icó" não
dependa de alguém clicar na Icó. O rótulo usa `rotuloCurtoUnidade` (o município,
que é o que distingue); o nome completo fica no `title` e no topo do painel.

Três decisões do desenho:

- **`+ Unidades` é a última aba**, tracejada — é onde a próxima aba nasce. E a
  aba recém-criada **abre selecionada**: criada e deixada fechada, a unidade
  nasceria escondida atrás da anterior, e quem acabou de criá-la iria procurar o
  slot que "não apareceu". Como o id do slot só chega no `load` seguinte, o que
  se guarda é a intenção (`abrirUltimaAba`);
- **`+ Equipes` fica no rodapé do painel** e não nomeia alvo nenhum: tudo que
  está visível pertence à aba aberta. Era o problema que a versão empilhada
  criava, com um botão por caixa;
- **`Remover DP` saiu da faixa** e entrou no menu do lápis, junto de "Alterar
  unidade" — são as duas ações DA unidade, e ficam onde se mexe na unidade.

A barra rola na horizontal (`overflow-x-auto`) **e** trava o eixo vertical
(`overflow-y-hidden`): sem o segundo, o navegador computa o eixo Y como `auto`
por causa do primeiro e reserva uma barra de rolagem vertical dentro da faixa das
abas. Coberto por `e2e/gise-abas-unidade.spec.ts`, que é onde mora o resto do
comportamento — componente `.svelte` não tem teste unitário neste projeto.

### Horário: só aparece o que foge do padrão

O horário cai em cascata — `gise_escalas` → `gise_seccionais` → `gise_equipes` —
e as duas últimas têm coluna **nulável**: nulo já quer dizer "o mesmo de cima".
A tela resolvia a cascata e imprimia o resultado sempre, então `08:00h-16:00h`
repetido no cabeçalho da seccional e em cada card de equipe dizia o horário da
escala três vezes.

Agora horário **herdado** vira um relógio (com o horário em vigor no rótulo
acessível) mais o lápis; horário **próprio** aparece escrito, na tarja âmbar —
que substitui o selo "H. Personalizado", porque num quadro onde todo o resto
mostra só o relógio o horário escrito já é o destaque.

"Próprio" é comparação de **valor**, não de preenchimento: o selo antigo olhava
só se a coluna tinha algo, e quem salvasse 08:00 numa equipe cuja seccional já é
08:00 ganhava um "personalizado" que não personaliza nada. Quem responde é
`horarioEfetivo` / `temHorarioProprio` (`$lib/gise/horarios`), que também
substituem a cascata `equipe ?? seccional ?? escala` antes copiada em quatro
pontos entre `GiseEquipeCard` e `GiseSeccional`. A comparação normaliza antes —
`'08'` e `'08:00'` são a mesma hora, e essa diferença exata já produziu bug neste
projeto.

O resto do fluxo:

- Criação e configuração pelo supervisor (seccionais, equipes, questões)
- Visão do membro em duas abas da sidebar: **Presença GISE** (só aparece com escala ativa — confirmar entrada, relatório e saída) e **Histórico GISE** (participações já encerradas). Ambas usam a rota `/operacoes/presenca`; o histórico é `?status=finalizadas`
- Registro de presença (entrada/saída com GPS e selfie) — em desktop, confirmação por Token A3
- Comprovante de presença baixável nos dois fluxos: Token A3 serve o termo qualificado do R2; presença em tela gera o comprovante avançado sob demanda
- Preenchimento de formulários operacionais e SEINT por membros
- Assinatura de relatórios de extra/produtividade
- Relatórios e dashboards de produtividade

### Plano operacional (operação com deslocamento)

A escala extra acima é serviço **sem** deslocamento fora da circunscrição, com
ponto de origem fixo e pagamento sempre em hora extra. O **plano operacional**
(`/operacoes/planos`, Admin Geral) cobre o outro caso: uma ou mais equipes se
deslocam para cumprir mandados demandados por uma delegacia ou seccional, e o
pagamento passa a depender do dia e do horário.

Os dois nascem no MESMO botão de `/operacoes/gise/operacoes`, que pergunta qual dos dois
se está cadastrando — mas não compartilham tabela, rota nem PDF. `operacoes` é o
CATÁLOGO do qual as escalas GISE pendem (`gise_escalas.operacao_id`); um plano é
evento único, com equipes próprias. Discriminar por coluna faria toda consulta
de `/operacoes/gise` passar a filtrar.

**A DIÁRIA é verificada primeiro; não sendo devida, o relógio decide**
(`sugerirCusteio`). As duas verbas **nunca se somam** — e essa recusa é política
do DPI SUL, não do decreto: o Decreto nº 36.182/2024 permite percebê-las
concomitantemente. Precisa estar escrito, senão quem ler o decreto depois
"corrige" a inconsistência somando as duas.

| Pergunta, nesta ordem                                                                     | Rubrica                                        |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Deslocamento ≥ **limite** (padrão 100 km) **e** operação ≥ **4h** — com parecer favorável | diária, no mínimo **1,5** (piso da corporação) |
| Distância bastaria, mas a operação tem menos de 4h                                        | vale o relógio                                 |
| Distância bastaria, mas a equipe não tem hora de término                                  | vale o relógio, e a tela avisa                 |
| Abaixo do limite: 08:00–18:00 em dia útil                                                 | sem custo                                      |
| Abaixo do limite: 06:00–08:00 e 18:00–00:00 útil                                          | hora extra normal                              |
| 00:00–06:00 útil, ou fim de semana e feriado em qualquer hora                             | hora extra **plus** (+30%)                     |

A ordem não é comutativa, e o exemplo mudou quando o decreto entrou. Uma equipe
que sai de Jucás para Acopiara **às 04:00** percorre mais de 100 km: o relógio
sozinho diria hora extra pelas horas de madrugada, e a regra completa diz
DIÁRIA — a saída antes das 6h extrapola a jornada, e a diária substitui.

A MESMA equipe numa terça das 09:00 às 17:00 recebe **sem custo**, não diária:
a missão de um dia inteiramente dentro do expediente não extrapola a jornada
ordinária, e o decreto não concede diária por distância nenhuma. Antes desta
regra ela recebia diária, porque a distância decidia sozinha. É a correção que
este módulo trouxe, e é dinheiro nos dois sentidos.

### De onde vêm os 100 km, e por que 4 horas

O limite **não está no decreto** — os números de lá são outros: 8 horas de
jornada (o teste de mérito) e 120 km, este só dentro de região metropolitana e só
combinado com ausência de extrapolação. Os 100 km são a aritmética do próprio
decreto com a permanência REAL no lugar da presumida:

- o cálculo estimado do decreto é `2 × tempo de ida + 3h de permanência > 8h`;
- a operação do DPI SUL dura **4h** (04h–08h), não 3h;
- com o número real o teste vira `ida > 2h`, que nas estradas do Ceará cai perto
  de 100 km — a mediana medida é 123 km.

Medido em **4.005 pares** do Ceará (90 municípios, distância e tempo na mesma
chamada ao OSRM), `km ≥ 100` e `2×ida + 4h > 8h` concordam em **96,5%**; onde
discordam, é a convenção dos 100 km que concede. Daí o portão de duração: numa
operação de 2h, 100 km dariam `2×2 + 2 = 6h`, e a diária deixaria de se
justificar.

**O limite vale SÓ aqui, na sugestão de custeio do plano operacional** — é
convenção do DPI SUL, pode ser aplicada à mão, e o módulo de Diárias (rito
geral e de operação) NÃO o usa: lá decide o decreto (E44). Ele é campo da tela
de valores (`/valores`, do Admin Geral, ao lado dos valores das diárias) e
**congela na versão** — o plano guarda `custo_parametro_id`, então
subir o limite para 120 km amanhã não muda a rubrica de um plano de março já
impresso. As 4 horas seguem constante nomeada (`DURACAO_MINIMA_DIARIA_HORAS`):
foi o km que a corporação pediu para manejar.

### O parecer do decreto, e os alertas que ele emite

Quem decide se a diária é DEVIDA é `$lib/diarias/` — domínio próprio, porque a
futura aba de solicitação avulsa consome o mesmo motor:

| módulo        | pergunta                                        |
| ------------- | ----------------------------------------------- |
| `contagem.ts` | quantas diárias, e em qual **mês** cada uma cai |
| `jornada.ts`  | a missão de um dia extrapolou as 8 horas?       |
| `vedacoes.ts` | o que precisa de conferência humana             |
| `parecer.ts`  | o veredito, com o **dispositivo citado**        |

A quantidade é `N − 0,5` com pernoite (`N` = dias, início e fim inclusive), e ela
é escrita como **atribuição por dia** — cada dia vale 2 meias, o último vale 1.
Somado dá o mesmo `2N − 1`, mas quebrado por mês responde ao teto de 15
diárias/mês do art. 13 sem uma segunda regra: uma missão de 28/set a 03/out lança
3 diárias em setembro e 2,5 em outubro. **Saída às 23h da véspera é pernoite** —
`N = 2`, 1,5 diária, não 0,5.

A ordem do teste de jornada é do decreto e não é comutativa: fim de semana ou
feriado (presunção do art. 22) → horário declarado (saída antes das 6h ou retorno
após as 18h) → e **só na falta de horário declarado** a fórmula estimada. Como o
plano operacional sempre declara horário e a operação começa às 04h, toda equipe
extrapola pelo segundo caminho, a 20 km ou a 300 km — a fórmula estimada é
inalcançável ali, e existe para a aba futura.

**Os alertas não bloqueiam.** A vedação do art. 4º, §1º, II exige três condições
juntas — mesma região metropolitana, até 120 km e **sem** extrapolação —, e a
terceira é de relógio: na operação das 04h ela nunca fecha. Barrar pela geografia
sozinha recusaria o que a lei permite, então o código alerta e uma pessoa decide.
As três regiões (RMF 19, RMC 9, RMS 18 municípios) vêm do IBGE por
`scripts/gerar-regioes-metropolitanas.mjs`, chaveadas por código.

**A hora extra segue sem dispositivo citado.** A corporação a define como
trabalho fora de 08h–18h quando não couber diária; a norma que a rege ainda não
foi fornecida, e o cabeçalho de `horas-extras.ts` declara isso em vez de deixar
quem leu o decreto procurar ali um artigo que não existe.

### A distância é MEDIDA, e o trajeto passa pelo briefing

O deslocamento é `origem → briefing → destino`, não a reta entre as pontas: a
equipe sai de Jucás, se apresenta em Iguatu e cumpre mandados em Acopiara. A
diferença não é decorativa — Jucás → Iguatu → Juazeiro do Norte dá **189 km**
contra 114 km diretos.

O número vem de uma **matriz rodoviária gravada** (`distancias_municipios`,
16.836 pares), gerada uma vez por `scripts/gerar-distancias.mjs` e consultada
como busca local. Três razões para tabela em vez de API na hora:
REPRODUTIBILIDADE (o mesmo par devolve sempre o mesmo valor), DISPONIBILIDADE
(serviço fora do ar não pode impedir a montagem de um plano) e AUDITABILIDADE
(dá para dizer de onde veio cada número, e quando).

**Linha reta foi descartada com medição, não por gosto.** Em 12 pares reais do
Ceará o fator rodovia/reta variou de **1,10 a 1,62** — nenhum multiplicador fixo
serve — e em **3 dos 12** ela daria a rubrica errada, sempre para menos
(Iguatu → Juazeiro do Norte: 95 km em reta, 154 km por estrada). O erro cai em
cima do limite de 100 km, que é onde ele custa dinheiro.

As fontes, e por que cada uma: **IBGE** para nomes e códigos (é o nome que sai
impresso, e nem o Wikidata nem a constante do projeto acertavam os 184 —
"Guaiuba" sem acento num, "Ererê" por "Ereré" no outro); **Wikidata** (CC0) para
a coordenada da SEDE, não o centroide do polígono; **OSRM/OpenStreetMap** (ODbL)
para a rodovia, cuja licença permite ARMAZENAR o resultado — o Google Distance
Matrix proíbe guardar além de ~30 dias, o que inviabiliza tabela permanente.

O campo **continua editável**: uma equipe pode ter um desvio real. Quem decide se
o valor gravado é a medida ou uma correção é o SERVIDOR, que remede na gravação e
registra na auditoria — confiar num campo do formulário deixaria o corpo do POST
afirmar a procedência de um número que vira dinheiro.

**Atualizar a matriz é sob demanda e revisado.** `node scripts/gerar-distancias.mjs
--diff` regera e mostra só o que mudou, destacando em separado os pares que
CRUZARAM os 100 km — esses trocam a rubrica de todo plano futuro naquela rota, o
que é mudança de dinheiro e pede gente olhando. Não há rotina automática. Plano
já emitido nunca muda: `plano_equipes.distancia_km` guarda o número na linha da
equipe, e a tabela só PRÉ-PREENCHE — a mesma decisão de `custo_parametros`.

`NULL` é "ninguém mediu ainda" e é distinto de zero — zero afirma que
origem e destino são a mesma cidade. Sem a medida, a sugestão cai no horário e a
tela **avisa**, porque a diária não sugerida é a que não é paga.

**A janela da equipe VIRA O DIA quando o horário assim diz.** A equipe não tem
`data_fim` própria: ela é derivada do par `hora_inicio`/`hora_fim` por
`calcularDataSaida`, o mesmo desenho do plantão nas escalas. Sem derivar, a
equipe que sai às 23h da véspera tinha `hora_fim < hora_inicio` no mesmo dia,
`classificarJanela` devolvia TUDO ZERADO e ela ficava sem hora nenhuma sugerida,
em silêncio — e agora ficaria também sem a diária, porque o portão de 4h leria
duração zero. A `data_fim` do plano segue como teto, para operação de vários
dias.

O que a regra **não** decide: quantas diárias (é o Admin Geral quem sabe se a
equipe dorme fora uma ou três noites) e se a diária é estadual ou interestadual
— atravessar divisa de estado é outra pergunta, e 500 km dentro do Ceará
continuam sendo diária estadual.

Abaixo do limite, a janela SUGERE a quantidade de horas (`classificarJanela`);
quem grava é o Admin Geral, porque a equipe que desloca antes é o caso normal,
não a exceção.

**Os valores são atualizados em `/valores`** (Gestão de pessoal → Atualização
de valores, aberta ao Admin Geral desde a decisão E39; até set/2026 era
`/config-custos`, do Super Admin): hora extra por faixa de cargo/classe (DPC
1ª/2ª, DPC 3ª/especial, OIP A/B, OIP C/D) e as duas diárias, tudo em centavos.
O que protege contra o mau uso é o versionamento com autor, não o papel.

**A tabela é versionada e o plano guarda a versão que usou** (append-only, nunca
`UPDATE`). Reemitir em junho o PDF de um plano de março tem de devolver os
mesmos números depois de um reajuste — e o Anexo II imprime a versão aplicada,
para o total não ser confundido com erro de cálculo.

**`cargo` e `classe` congelam na linha do membro**: são a base de cálculo, e não
acompanham promoção posterior. Nome, matrícula, lotação e telefone continuam
vindo vivos do cadastro — são identificação, não mudam o valor pago.

**O signatário é campo DO PLANO**, não configuração global: o Titular assina umas
operações, o Adjunto outras. O nome vem da busca no cadastro (como o
coordenador) e vai congelado em `diretor_nome`; `diretor_id` guarda quem foi
escolhido, só para o editor reabrir mostrando a seleção. O cargo é lista
**fechada** (`cargosSignatario`) porque sai impresso sob a assinatura — campo
livre põe erro de digitação no papel, e ninguém revisa o rodapé de um PDF. A
lista é **gerada do departamento** em `unidades` (`departamentoDoPlano`), com o
órgão por extenso — "Diretor Titular do Departamento de Polícia do Interior
Sul", nunca a sigla — porque sob a assinatura o cargo qualifica a autoridade
que decide. A sigla (`unidades.sigla`) vai no cabeçalho e no item 5. Nada disso
é constante desde set/2026: cadastrar outro departamento é o que basta para o
plano sair em nome dele.

**Não há padrão global.** Um padrão único para um dado que VARIA ou é ignorado
quase sempre, ou leva a mudar a configuração de todos os planos seguintes para
acertar um. Sem escolha, o documento imprime a linha de assinatura em branco —
que é o estado honesto de um plano cujo signatário ainda não foi definido, e
visível para quem for emitir. `/valores` trata só de dinheiro.

**Briefing, origem e destino são LISTAS do plano** (`plano_opcoes`), não campo
livre por equipe. Numa operação com oito equipes saindo para três cidades o
destino era redigitado oito vezes, e bastava um acento diferente para o Anexo I
listar dois destinos onde só há um. O plano declara as opções uma vez — na
CRIAÇÃO ou depois, nos Parâmetros gerais — e a equipe escolhe num `<select>`.

São três porque a equipe percorre três lugares: sai de Jucás (**origem**), se
apresenta em Iguatu (**briefing**) e cumpre mandados em Acopiara (**destino**).
Uma tabela só para os três tipos, porque são a mesma forma — lista de texto com
uma padrão — e separá-las duplicaria índice, action e componente de tela.

As listas montadas na tela de CRIAÇÃO vivem em memória e viajam como campos
repetidos no mesmo POST que cria o plano: não há `plano_id` para gravá-las
antes. As regras de lista (primeira nasce padrão, sem repetir valor, removida a
padrão a próxima assume) ficam em `$lib/planos/opcoes` — enunciadas uma vez e
testadas —, porque valem nos dois lados e o array em memória não pode chamar o
SQL que o editor usa.

Uma opção de cada tipo é a **padrão** (estrela, como o chefe de equipe) e a
arbitragem é do BANCO: `uq_plano_opcoes_padrao` é único PARCIAL sobre
`(plano_id, tipo) WHERE padrao = 1`, então trocar a padrão é limpar a anterior e
marcar a nova no mesmo `batch` — duas abas não conseguem deixar duas padrões.
`uq_plano_opcoes_valor` recusa valor repetido no mesmo tipo, pelo índice e não
por um `SELECT` antes.

A padrão é **copiada** para a equipe nova, não herdada por referência: a equipe
guarda o TEXTO. É o que permite remover uma opção da lista sem esvaziar o
destino de uma equipe montada — muito menos o de um plano cujo documento já
circulou. Pelo mesmo motivo o seletor da equipe oferece o valor próprio dela
mesmo quando ele saiu da lista (`escolhasDaEquipe`): um `<select>` cujo `value`
não casa com nenhum `<option>` exibe o primeiro item, e salvar sem tocar no
campo trocaria o destino impresso.

Equipe com o campo VAZIO cai no padrão do plano (`briefingDaEquipe`,
`origemDaEquipe`, `destinoDaEquipe`) — a mesma cascata que o PDF usa. Lista com opções e nenhuma
padrão é estado possível (é como a migração encontrou os planos antigos, que não
tinham onde declarar qual seria) e o editor **avisa**: sem estrela, a equipe nova
continua nascendo em branco.

**Classe vazia não vira R$ 0 em silêncio.** `policiais.classe` é
`text NOT NULL DEFAULT ''`; sem faixa resolvida a linha sai como PENDÊNCIA na
tela e o endpoint de download **recusa com 409** nomeando quem falta. Equipe
`sem_custo` com membro sem classe gera AVISO, não pendência: ela pode virar com
custo, e o problema tem de aparecer enquanto ainda há tempo — não na véspera da
emissão.

O PDF (`GET /api/planos/[id]/download`) sai em três páginas: corpo com as nove
seções numeradas e a assinatura do Diretor, **Anexo I** com uma tabela por
equipe (efetivo, jornada, rubrica e valor de cada servidor) e **Anexo II** com o
consolidado por categoria. **CPF não entra no documento** — minimização LGPD: o
papel circula, e a Classe basta para justificar o valor da linha.

O que a tela mostra e o que o PDF imprime saem da MESMA chamada
(`montarCustoDoPlano`), e não de dois cálculos parecidos.

**Fora de escopo nesta entrega:** confirmação de presença, relatórios extras e
assinatura digital do plano.

### Assinatura Digital

Três modalidades suportadas:

| Modalidade      | Mecanismo                                                                | Dados coletados                                |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| **Qualificada** | e-CPF ICP-Brasil via WebPKI (Lacuna) ou Assinador SERPRO Desktop         | Certificado, OCSP, carimbo de tempo (CAdES-LT) |
| **Avançada**    | 2FA por e-mail (sempre) + selfie com liveness + GPS + selo institucional | Foto, coordenadas, user-agent, timestamp       |
| **Simples**     | Confirmação textual — **descontinuada** (restrita a fluxos FDS legados)  | IP, user-agent, timestamp                      |

O enquadramento jurídico de cada modalidade (Lei 14.063/2020, MP 2.200-2) está no parecer `ANALISE_JURIDICA_ASSINATURAS.md`, arquivado no histórico do Git — ver [`docs/HISTORICO.md`](docs/HISTORICO.md).

**Quem decide o nível é `cms_sha256`, nunca a existência da linha.** `gise_presenca_termos` recebe termo dos DOIS fluxos que produzem PDF de presença: Token A3 (qualificada) e passkey (avançada — o PDF leva o selo institucional, não certificado do titular). Só o `cades-finalizer` grava `cms_sha256`, então é ele a régua — a mesma que o `load` de `/validar` já aplicava para escolher entre verificação CAdES e selo. Classificar por "tem termo?" fazia o manifesto do Relatório Extraordinário imprimir **QUALIFICADA · ICP-BRASIL** sobre presença por passkey, e a página pública estampar o selo ICP-Brasil no termo dela. Afirmar ICP-Brasil onde não há certificado ICP derruba, em perícia, a credibilidade das outras evidências do mesmo documento.

### Validação Pública

A rota `/validar/[hash]` é **pública e sem autenticação**. Qualquer pessoa pode verificar a autenticidade de um documento assinado informando o código exibido no PDF. Visitante **autenticado** vê também o recorte da chave de assinatura (o mesmo da linha `CHAVE DE ASSINATURA` no manifesto) para confrontar com a ficha do servidor, sem abrir o banco. O anônimo não recebe esse recorte. O titular vê o mesmo recorte em Meu Perfil, com a data do último uso; o sistema não guarda o modelo do celular.

### Trava de tela não é trava

`maxlength`, botão escondido e `disabled` são dicas de digitação: somem num POST
direto, num `curl` ou com uma linha no devtools. A régua do projeto é que **toda
regra material recusa também no servidor** — o mesmo princípio de
"esconder o botão não é autorização" ([`CLAUDE.md`](CLAUDE.md)), aplicado a
ESTADO, EVIDÊNCIA e TAMANHO, não só a permissão.

A varredura de set/2026 encontrou três formas de a régua falhar, todas com a
mesma assinatura: a regra existia certa em um caminho e faltava no vizinho.

**1. A trava que não travava.** O gate de `exigirGpsAssinatura` checava
`typeof latitude !== 'number'` — e **`typeof NaN === 'number'`**. O cliente manda
a coordenada em texto e o servidor faz `parseFloat`, então `latitude=abc` chegava
como `NaN`, passava e a assinatura seguia com o manifesto imprimindo "Não
capturado". Pior que ausente: `latitude=999` passava também, e essa o manifesto
IMPRIME como o local do ato — evidência inventada corrói a credibilidade das
outras evidências do mesmo documento. Hoje o gate é
`coordenadaGeograficaValida` (finito + faixa), e coordenada implausível é
persistida como ausência mesmo com a flag desligada.

**2. Evidência exigida só na tela.** A confirmação de presença não passa por
`validarEvidenciasAvancada` (checa o 2FA à mão), e por isso `exigirFoto` e
`exigirGps` — **as duas com default `true`** — viviam apenas no `SignaturePad`.
Um POST direto registrava presença sem nenhuma das duas enquanto o painel do
admin as anunciava obrigatórias.

O gate agora é [`$lib/assinatura-evidencia`](src/lib/assinatura-evidencia.ts),
client-safe para a tela pedir pela MESMA regra, e ele **aceita ausência
DECLARADA**: a presença tem janela de horário e é a base do pagamento da diária,
então recusa seca deixaria de fora quem tem o GPS negado pelo aparelho — e a
tela já permitia seguir nesse caso. O motivo vem de lista FECHADA
(`permissao_negada`, `indisponivel_no_aparelho`, `falha_tecnica`) e entra na
trilha de auditoria.

**A exceção tem caminho de interface só para o GPS**, e a assimetria é do
produto, não um esquecimento do gate: o `SignaturePad` detecta a falha de
localização e manda o motivo, mas para a câmera ele DESABILITA o botão de
captura — não existe tela que envie `motivoSemFoto`. O servidor aceita os dois
porque a política é uma só; na prática, hoje, foto ausente é recusa, e o caminho
do policial com câmera quebrada é a presença por Token A3 no desktop. Se algum
dia a tela oferecer a exceção para a foto, o servidor já a entende.

Sendo preciso sobre o que isso compra: não impede quem quer burlar — um cliente
adulterado sempre pode declarar "GPS negado", que é a mesma fronteira de garantia
que o liveness já declara. O que muda é que a ausência deixa de ser INVISÍVEL:
antes o servidor gravava sem GPS e sem registrar nada; agora todo ato sem
evidência carrega o motivo, e o padrão fica CONTÁVEL no console de auditoria (um
servidor que declara "GPS negado" em todas as presenças aparece).

**3. `maxlength` sem contraparte.** Rota de API não cai nessa (o padrão
obrigatório é `validateBody` com Zod, que tem `.max()`); **form action lê
`FormData` na mão**. A regra estava certa em `gise/operacoes` e em
`planos/novo` — cada um com a SUA cópia de `texto(fd, campo, max)` — e ausente
num terceiro: `salvarBreveRelatorio` gravava as MESMAS três colunas que
`operacoes` limita a 200/2000 sem limite nenhum, nem na tela; e as
`observacoes` da escala tinham `maxlength=500` em quatro telas, servidor sem cap
e coluna sem CHECK. Os dois entram em PDF assinado. A implementação virou
[`$lib/server/form-data`](src/lib/server/form-data.ts), as duas cópias delegam, e
os limites do breve relatório são UMA constante lida pelas duas telas que editam
e pelas duas actions que gravam.

Corolário para código novo: **campo com `maxlength` na tela precisa do mesmo
número no servidor** — `textoLimitado(fd, campo, MAX)` em form action, `.max()`
no Zod em rota de API. Regex de e-mail prova o FORMATO e casa com string de
qualquer tamanho; o cap é `MAX_EMAIL`.

### PII forense não sai do servidor por engano

O manifesto do PDF assinado carrega **CPF, IP, GPS e selfie** de quem assinou, e
quem alcança esse conjunto é **só o Super Admin** — `podeBaixarForense`, em
[`cpf-assinante.ts`](src/lib/server/assinatura/cpf-assinante.ts). O portal
`/validar` já dizia isso por escrito ("IP, user-agent e GPS: omitidos").

O que faltava era a régua valer para o **payload de hidratação**, que é a
superfície fácil de esquecer: nada ali aparece na tela, então uma revisão visual
não flagra o excesso. Duas telas devolviam ao navegador dado que a interface não
usa — `/operacoes/gise/[id]` e `/escalas/[id]` mandavam o `assinante_cpf` **completo**
(decifrado) enquanto a API do MESMO campo,
`/api/gise/[id]/documento-assinado/info`, mascarava para todo mundo que não é
Super Admin; e `/operacoes/gise/[id]` mandava a linha CRUA de `buscarPresencasGise` — CPF,
IP, user-agent, latitude, longitude e as chaves R2 das selfies de cada
integrante — para o Admin Geral, o admin de seccional e o **supervisor**, que é
policial comum.

Duas regras, uma para cada metade, e as duas com teste:

- **CPF de assinante que sai do servidor passa por `cpfAssinanteParaExibir`**,
  que decifra e mascara na MESMA chamada. É o ponto: o helper conveniente já é o
  recortado, então não se obtém a versão crua por distração. `decifrarCpfDoDB`
  direto continua certo para quem GERA o manifesto — ali o dado forense é o
  produto;
- **presenças que vão à tela passam por `presencasParaCliente`**
  ([`presenca-cliente.ts`](src/lib/server/gise/presenca-cliente.ts)), que devolve
  `policial_id` + entrada/saída e nada mais. Objeto NOVO, campo a campo, não
  `delete` das chaves indesejadas: coluna nova em `buscarPresencasGise`
  (evidência é o tipo de tabela que cresce) não passa a viajar de graça.

A minimização por PROJEÇÃO — recortar antes de serializar, e de preferência no
`SELECT` — é a mesma que os e-mails do quadro de supervisão já recebiam dentro
desse próprio `load`. A lição é que ela precisava valer para as duas metades do
mesmo `return`.

### Observabilidade e Auditoria

Dois registros complementares, ambos restritos ao **Super Admin**:

| Console           | Fonte                                                          | Conteúdo                                                                                                                                         |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/auditoria`      | `audit_log` ([`src/lib/db/audit.ts`](src/lib/db/audit.ts))     | Trilha forense de eventos de negócio: catálogo de ações, ator × alvo, severidade, cadeia de hash verificável, exportação CSV/PDF                 |
| `/auditoria/logs` | `app_log` ([`src/lib/db/app-logs.ts`](src/lib/db/app-logs.ts)) | Logs técnicos: todo `logger.warn`/`logger.error` do servidor, persistido por request após a resposta (`waitUntil`, sem custo no caminho crítico) |

Os dois se correlacionam pelo `request_id` (gerado em `hooks.server.ts` e propagado por AsyncLocalStorage) — que é também o `errorId` exibido ao usuário em erros 5xx e a tag enviada ao Sentry. No detalhe de um evento da auditoria, o Request ID é um link para os logs técnicos daquela mesma request.

O logger estruturado ([`src/lib/logger.ts`](src/lib/logger.ts)) continua emitindo JSON para Cloudflare Logs/Logpush; a persistência em `app_log` é um espelho consultável de dentro do app (níveis `debug`/`info` não são persistidos). Retenção: purga automática junto à limpeza LGPD (`lgpd.retencao.app_log_dias`, default 90 dias).

---

## 9. Autenticação e Autorização

### Uma senha, duas identidades (Admin Geral vinculado)

O Admin Geral **vinculado** é uma pessoa com DUAS linhas: uma em `policiais` e
uma em `administradores` com `policial_id` apontando para ela. A linha admin não
tem senha própria — recebe um placeholder aleatório que ninguém lê. O login de
administrador autentica contra `policiais.senha`, a mesma senha do modo usuário.

Daí saem duas perguntas que todo fluxo de credencial precisa responder, e que
são fáceis de responder pela metade. As duas têm resposta única em
[`server/auth/credencial.ts`](src/lib/server/auth/credencial.ts):

| pergunta                  | resposta                                             |
| ------------------------- | ---------------------------------------------------- |
| onde gravar a senha nova? | `resolverCredencial().dono` — a linha que o login LÊ |
| quais sessões derrubar?   | `revogarSessoesDaCredencial()` — as DUAS identidades |

Gravar na linha errada não muda nada: a senha nova não passa a valer e a antiga
continua valendo. Derrubar só o cookie do modo atual deixa vivo o outro,
destravado pela mesma senha. Desativar o policial fecha os dois modos —
`buscarAdminAtivo` confere o vínculo, e a desativação revoga as sessões abertas.

Sessão em cache não vale para quem MUTA: `ttlCacheSessaoParaMetodo` devolve 0
em `POST`/`PUT`/`PATCH`/`DELETE`. Leitura pode estar até um TTL atrasada; ação,
não — o Cache API é por colo, e nenhuma invalidação local alcança outro data
center.

### Fluxo de login

1. Usuário informa matrícula + senha
2. Servidor verifica com PBKDF2-HMAC-SHA256 (100k iterações — teto do runtime da Cloudflare —, salt 16 bytes, timing-safe). Em produção, a senha passa antes por HMAC com o `PASSWORD_PEPPER` (formato `pbkdf2v3`) — ver [`DEPLOY.md`](DEPLOY.md#hashing-de-senha-e-o-password_pepper)
3. 2FA: gera código de 6 dígitos e envia por e-mail (fail-closed — conta sem e-mail cadastrado não recebe sessão)
4. Sessão criada com token de 256 bits, expira em **1 hora de inatividade** — qualquer requisição de gente renova o relógio no banco e no cookie (`SESSION_TTL_MS` em `src/lib/auth.ts`; o poll de fundo não conta como atividade, ver [`DEPLOY.md`](DEPLOY.md#duração-da-sessão))
5. Sessão armazenada em cookie `session_token` (httpOnly, secure, SameSite=strict)

Alternativa: **login por certificado digital A3** (e-CPF ICP-Brasil) via `/api/auth/certificado/*`, dispensa senha e 2FA por e-mail. Além da assinatura do desafio e da cadeia ICP-Brasil, o login consulta a **revogação (OCSP)** do certificado: um e-CPF revogado é recusado; se o responder da AC estiver indisponível, o login prossegue e registra `metadados.ocsp = 'unknown'` na auditoria (soft-fail). O botão existe nas duas abas do `/login`: na aba **Policial** cria sessão operacional; na aba **Administrador** (`comoAdmin`) resolve a conta admin vinculada ao policial do certificado e cria sessão de administrador no módulo escolhido.

### Alternância de acesso (ADM Geral ↔ Usuário)

Quem tem **Admin Geral vinculado** (linha em `administradores` ligada ao seu policial) pode alternar entre o modo Administrador e o modo Usuário **sem sair e logar de novo**, por um botão na barra superior à direita (`/api/auth/alternar-acesso`). A troca só recria a sessão apontando para a outra identidade da **mesma pessoa** — **não concede privilégio novo**: quem não tem a conta vinculada não vê o botão e o endpoint responde 403. Como a pessoa já passou pelo 2FA no login (o admin vinculado usa o mesmo e-mail/2FA), a troca é imediata, análoga ao swap de módulo GISE/Escalas. Cada alternância é auditada (`alternar_acesso`).

### Primeiro acesso

Após criar um policial/admin, a conta fica bloqueada até o usuário definir sua própria senha (`primeiro_acesso = true`). O sistema redireciona automaticamente para `/alterar-senha`, onde ele confirma o **e-mail pessoal** por código antes de gravar a senha nova — o e-mail é o canal de recuperação, e sem ele confirmado uma senha perdida deixa a conta inacessível.

O onboarding tem **duas fases, nesta ordem**: (1) `primeiro_acesso` — senha + e-mail pessoal; (2) aceite do Termo de Uso vigente. Enquanto a fase 1 está pendente o portão do Termo **não** é imposto (`impoeAceiteDoTermo` em [`onboarding-gates.ts`](src/lib/server/auth/onboarding-gates.ts)): a superfície alcançável já está reduzida a quatro rotas de onboarding, e exigir o aceite ali produziria um 403 sem saída — `/aceitar-termo` é inalcançável enquanto o portão de `primeiro_acesso` devolve todo mundo para `/alterar-senha`. Definida a senha, o `goto('/')` cai no portão do Termo e segue para `/aceitar-termo`.

A tela de primeiro acesso **não** oferece o cadastro da chave de assinatura. O convite vive onde a falta da chave morde: na hora de assinar, e só com `exigir_passkey_assinatura` ligada — ver [`DEPLOY.md`](DEPLOY.md#chave-de-assinatura-passkey--webauthn).

### Termo de uso

O aceite do termo de uso é obrigatório a cada nova versão. Qualquer mudança no arquivo `src/lib/server/termo/termo-vigente.ts` gera um novo hash que invalida aceites anteriores e exige reaceite na próxima sessão.

### Papéis (RBAC)

| Tipo                     | Papel             | Acesso                                                                                                                                                                                                                          |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin` + `isSuperAdmin` | Super Admin       | Tudo do Admin Geral **mais**: promover admins, gerenciar policiais/unidades, configurar política de assinatura, baixar o forense pelo portal `/validar`                                                                         |
| `admin`                  | Admin Geral       | Operação global (escalas, GISE, LGPD/compliance) em todas as unidades — não remodela a base; cadastra colaboradores; consoles de auditoria são do Super Admin                                                                   |
| `policial`               | `admin_seccional` | Gerencia escalas da sua seccional e **solicita** correções cadastrais e atos de RH dos servidores dela; informa a linha de base dos indicadores das unidades (`/operacoes/dados-base`) e vê `/operacoes/produtividade` escopado |
| `policial`               | `admin_unidade`   | O mesmo, escopado à sua unidade                                                                                                                                                                                                 |
| `policial`               | —                 | Acessa apenas suas próprias escalas e GISE                                                                                                                                                                                      |
| `colaborador`            | —                 | Terceira identidade (servidora administrativa, terceirizada): entra por e-mail, sempre com 2FA; alcança SÓ a lista fechada de `colaboradorPodeAcessarRota` e o que o módulo de diárias designar                                 |

A matriz completa de capacidades por papel está em [`DEPLOY.md`](DEPLOY.md#papéis-e-privilégios-de-administrador). Membros de GISE têm papéis adicionais (`supervisor`, `assessor/SEINT`, `membro`) calculados dinamicamente a partir da tabela `gise_membros`.

### A terceira identidade: colaborador

Servidora administrativa e colaboradora terceirizada não cabem em `policiais`
(entrariam nos seletores de escala e no efetivo do plano, com matrícula e cargo
que não têm) nem em `administradores` (ganhariam Admin Geral nos ~160 pontos
que perguntam `tipo === 'admin'`). São a tabela `colaboradores` com o tipo de
sessão `colaborador` (migrações 0081–0083), e o desenho é **falhar fechado**:

- toda verificação que pergunta por `admin` ou `policial` responde "não";
- a validação de sessão decide POR TIPO e recusa o que não conhece — nunca "o
  que não é admin é policial", porque os ids das tabelas colidem;
- o `hooks.server.ts` só deixa a sessão de colaborador entrar na lista fechada
  de `colaboradorPodeAcessarRota` (`/colaborador`, onboarding, logout); o resto
  responde 403 ou volta para a área dele;
- as rotas de credencial e assinatura (passkey, e-mail pessoal, reautenticação,
  LGPD do titular) usam `requireAuthComCadastro`, que recusa colaborador com o
  tipo estreitado (`UsuarioComCadastro`) — é o que impede um
  `tipo === 'policial' ? … : …` lá dentro de tratá-lo como admin por exclusão.

O **Admin Geral** cria e gerencia a conta (`/colaboradores`) — e o Super Admin
junto, por ser um Admin Geral com poderes extras. Admin de seccional e de
unidade ficam de fora: eles têm escopo sobre servidor já cadastrado, e criar uma
identidade de acesso é outra coisa.

**A assimetria é sabida**: o Admin Geral não cadastra policial nem unidade (ver
a matriz em [`DEPLOY.md`](DEPLOY.md#papéis-e-privilégios-de-administrador)), mas
cadastra colaborador. Ela se sustenta no que a identidade alcança — o
colaborador falha fechado em tudo e só age onde for designado — e em quem opera
o módulo de diárias no dia a dia.

O login é por **e-mail + senha + código por e-mail**, sempre — inclusive no
primeiro acesso, porque o e-mail é obrigatório na conta e é o que prova, no
primeiro login, que a pessoa controla o endereço cadastrado. A senha nasce
provisória, gerada pelo servidor e mostrada uma vez a quem cadastrou; não há
recuperação por link — o administrador gera outra.

### Cadastro do servidor: quem pede e quem decide

A ficha em `/servidores/[id]` é **uma tela só, com dois poderes**, e o portão que
os separa é [`ficha-permissao.ts`](src/lib/server/policiais/ficha-permissao.ts):

| modo          | quem                              | o que acontece ao submeter                      |
| ------------- | --------------------------------- | ----------------------------------------------- |
| `direto`      | Admin Geral                       | grava o cadastro / executa o ato na hora        |
| `solicitacao` | `admin_seccional`/`admin_unidade` | vira pedido pendente para o Admin Geral decidir |

O que cada regra fixa, e por quê:

- **o servidor não pede alteração do próprio cadastro.** `/perfil` é leitura,
  mais as duas coisas que pertencem ao titular: o **e-mail pessoal** (canal de
  recuperação da conta — quem o troca assume a identidade no próximo "esqueci a
  senha", então a troca exige a senha dele mais um código no novo endereço) e a
  **chave de assinatura**, que prova controle exclusivo do aparelho;
- **e-mail pessoal não é solicitável por administrador nenhum**, pelo mesmo
  motivo. Todo o resto do cadastro é: nome, matrícula, cargo, CPF, telefone,
  classe, regime e e-mail funcional (`CAMPOS_SOLICITAVEIS` em
  [`cadastro-campos.ts`](src/lib/cadastro-campos.ts));
- **todo pedido vai com justificativa**, de até 300 caracteres, que acompanha
  cada linha da fila — decidir sem o motivo à vista é decidir no escuro;
- **lotação NÃO é campo solicitável**: transferir servidor é MOVIMENTAÇÃO, no
  quadro "Afastar / Movimentar Servidor", com data, NUP e portaria anexa. Dois
  caminhos abertos produziriam transferência sem portaria, indistinguível de uma
  com portaria depois de gravada;
- **o CPF não é decifrado para quem só pede.** O campo aparece em branco na
  ficha do modo `solicitacao` e serve para informar o número NOVO — ler o atual
  nunca foi necessário para isso (minimização, LGPD art. 6º III);
- **papel administrativo e Admin Geral aparecem, informativos.** Conceder
  permissão não é "corrigir um dado", e as actions que os alteram seguem
  exigindo `isAdminGeral`. Mostrar o estado responde "por que esta pessoa
  administra a minha unidade?" sem obrigar ninguém a perguntar.

O EFEITO dos três atos de RH mora em
[`acoes-rh.ts`](src/lib/server/policiais/acoes-rh.ts), e é o MESMO objeto nos
dois caminhos: a ficha o executa direto, e a aprovação em `/solicitacoes` o
executa a partir da linha do pedido. Enquanto o efeito morava dentro das form
actions, aprovar teria de reescrevê-lo — a forma exata dos bugs de cópia
divergente catalogados no [`CLAUDE.md`](CLAUDE.md).

O PDF anexo sobe **no momento do pedido**: é o que permite ao Admin Geral baixar
a portaria antes de aprovar (`/api/policiais/solicitacoes/[id]/documento`, atrás
do mesmo portão da ficha). Aprovado, a chave passa a pertencer ao evento em
`policial_historico`; recusado, o objeto é apagado do bucket — nenhuma outra
linha voltaria a referenciá-lo.

### Autorização das operações materiais

Esconder o botão na tela não é autorização: o POST direto tem de morrer no
servidor. Toda mutação de API (`POST`/`PUT`/`PATCH`/`DELETE`) e form action do
SvelteKit é **operação material**, e `npm run guard:autorizacao` (rodado no CI)
verifica que cada uma recusa alguém — o próprio comando imprime o total atual.

O guard não procura o nome de um helper, e isso é deliberado. A decisão de
autorização é tomada de treze formas diferentes, porque ela genuinamente difere
por domínio: escala vai por lotação mais solicitação de assinatura
(`verificarPermissaoEscala`), GISE vai por participação da seccional, quadro de
supervisão ou vínculo de equipe (`verificarPermissaoGise`,
`resolverParticipacaoGisePolicial`), policial vai por escopo administrado
(`lotacoesAdministradas`), e várias rotas resolvem no preâmbulo local do próprio
arquivo (`autorizarAcao`, `carregarEscalaComPermissao`). Uma lista de nomes
nunca estaria completa — e deixaria passar justamente o handler novo com o
resolvedor novo, que é o caso perigoso.

O que o guard olha é o RESULTADO, que é fechado:

| nível | o que a operação faz     | como aparece                                                                        |
| ----- | ------------------------ | ----------------------------------------------------------------------------------- |
| 2     | recusa por **permissão** | `fail(403)`, `forbidden()`, `requireAdmin`, `requireSuperAdmin`, `exigirAdminGeral` |
| 1     | só exige **sessão**      | `fail(401)`, `unauthorized()`, `requireAuth`                                        |
| 0     | não recusa ninguém       | —                                                                                   |

Nível 0 e 1 existem legitimamente: login não tem sessão para exigir, trocar a
própria senha não tem segundo sujeito para autorizar, e webhook se autentica por
segredo compartilhado. As dispensas ficam declaradas **com motivo** em
`scripts/guard-autorizacao.mjs` — a diferença entre "público de propósito" e
"esqueceram o guard" não está no código, só na cabeça de quem escreveu; ali ela
fica escrita. Encolher aquela lista é progresso.

O guard reprova em quatro situações, e a última é a que impede falso verde:
operação nova em nível 0/1 sem declaração; dispensa que virou nível 2 (lista
mentindo); dispensa que aponta para operação inexistente; e **handler declarado
que o parser não conseguiu ler** — rota que o guard não enxerga é rota que ele
não protege.

Nas regressões já vistas (assinar com ACL de leitura, GISE `finalizada`,
lotação fora do escopo, presença fora da janela), `HELPERS_OBRIGATORIOS` exige
o helper **no corpo** do handler — import no arquivo ou 403 genérico não
bastam. A lista cresce só com achado novo.

### Proteção CSRF

O projeto usa o padrão _double-submit cookie_:

- Geração: cookie `csrf_token` com token aleatório de 256 bits (não httpOnly)
- Verificação: todos os métodos mutantes (`POST`, `PUT`, `PATCH`, `DELETE`) em `/api/*` exigem o header `x-csrf-token` igual ao cookie
- Rotas isentas: `/api/auth/login`, `/api/health`, `/api/webhook` (autenticados por bearer token próprio)

---

## 10. Padrões de Código

> Diretrizes obrigatórias de API, pastas `server/`, `api-fetch`, autorização e
> goldens jurídicos: [`CLAUDE.md`](CLAUDE.md). Abaixo: runes, Server-first e UI.

### Svelte 5 — Runes obrigatórias

```svelte
<!-- ✅ CORRETO -->
<script lang="ts">
	let { titulo, onSalvar } = $props();
	let nome = $state('');
	let nomeUppercase = $derived(nome.toUpperCase());

	$effect(() => {
		document.title = titulo;
	});
</script>

<!-- ❌ NUNCA faça -->
<script lang="ts">
	export let titulo;           // use $props()
	let nome = '';               // use $state()
	$: upper = nome.toUpperCase(); // use $derived()
	import { writable } from 'svelte/store'; // use $state em arquivos .svelte.ts
	onMount(() => { ... });      // use $effect()
</script>
```

### Composables reutilizáveis

Para lógica reativa compartilhada entre componentes, crie arquivos `.svelte.ts`:

```typescript
// src/lib/composables/useContador.svelte.ts
export function useContador(inicial = 0) {
	let valor = $state(inicial);
	const dobro = $derived(valor * 2);

	return {
		get valor() {
			return valor;
		},
		get dobro() {
			return dobro;
		},
		incrementar() {
			valor++;
		}
	};
}
```

### Constantes e snippets compartilhados

Antes de declarar uma constante "óbvia" no componente, verifique se ela já existe
em [`src/lib/utils/datas.ts`](src/lib/utils/datas.ts):

- `MESES_PT` — nomes dos meses, índice 0 = Janeiro (base de `Date.getMonth()`;
  para mês 1-12 do banco/URL use `MESES_PT[mes - 1]`);
- `opcoesMeses()` / `opcoesMeses(true)` — as mesmas opções no formato
  `{ value, label }` do `SearchableSelect`, com a entrada "Todos" (valores
  numéricos ou string);
- `DIAS_SEMANA_CURTO` — `Dom…Sáb`, índice 0 = domingo.

Snippets de UI repetidos entre componentes irmãos vão para um `.svelte` próprio e
são **exportados pelo `<script module>`** — só funciona se o snippet não
referenciar nada do `<script>` de instância, então os imports de que ele depende
também ficam no bloco `module` ([docs](https://svelte.dev/docs/svelte/snippet)).
Exemplo: [`src/routes/operacoes/presenca/_components/BotoesAcao.svelte`](src/routes/operacoes/presenca/_components/BotoesAcao.svelte).

### SvelteKit — Server-first

Devolva no `load()` apenas o que a página realmente consome: papéis do usuário
não precisam ir no payload (a UI lê `page.data.usuario` via `useAutorizacao`), e
parâmetros de URL usados só para montar a query ficam no servidor.

```typescript
// ✅ CORRETO: Server Action em +page.server.ts
export const actions = {
	salvar: async ({ request, locals }) => {
		const data = await request.formData();
		const parsed = minhaSchema.parse(Object.fromEntries(data));
		await salvarNoBanco(parsed);
		return { sucesso: true };
	}
};

// ✅ CORRETO: Load function no servidor
export const load: PageServerLoad = async ({ locals }) => {
	return { policiais: await buscarPoliciais(getDB(locals.platform)) };
};
```

### Validação com Zod

Sempre valide inputs de formulários e APIs no servidor com Zod. Os schemas ficam em `src/lib/schemas/`.

```typescript
import { z } from 'zod';
import { fail } from '@sveltejs/kit';

const schema = z.object({
	nome: z.string().min(3, 'Mínimo 3 caracteres'),
	cargo: z.enum(['DPC', 'OIP'])
});

// Em uma action:
const result = schema.safeParse(Object.fromEntries(formData));
if (!result.success) return fail(400, { erro: result.error.flatten() });
```

### Code splitting

O `vite.config.ts` já configura code splitting manual para manter o bundle inicial leve. Ao adicionar novas dependências pesadas, avalie adicioná-las a um chunk existente ou criar um novo:

```typescript
// vite.config.ts — chunks manuais
manualChunks(id) {
	if (id.includes('@vladmandic/face-api') || id.includes('@tensorflow')) return 'face-api';
	if (id.includes('pdf-lib') || id.includes('jspdf') || id.includes('@signpdf')) return 'pdf';
	// ...
}
```

### Padrões visuais (UI)

Regras estabelecidas na auditoria visual de jul/2026 (`AUDITORIA_VISUAL_UX_2026-07-11.md`, arquivada — ver [`docs/HISTORICO.md`](docs/HISTORICO.md)). Os tokens vivem em [`src/theme.css`](src/theme.css) (paleta oklch de 7 canais) e [`src/app.css`](src/app.css) (`@theme` + `@utility`).

**Cores** — sempre pelos canais do tema (`primary`, `secondary`, `tertiary`, `success`, `warning`, `error`, `surface`). Nunca cores cruas da paleta Tailwind (`text-red-500`, `bg-indigo-600`…). Os valores dos canais são a paleta do protótipo do Ecossistema (decisão E2, set/2026): `primary` = azul `#3b82f6` (Tailwind blue), `surface` = slate com fundos `#0b0f19`/`#131b2e` no escuro e canvas `#f1f5f9` no claro, `success`/`warning`/`error` = emerald/amber/red — tudo em oklch em `theme.css`. Mudar um valor lá muda o sistema inteiro; é o único lugar.

**Texto pequeno** — dois degraus abaixo de `text-xs`, e só eles: `text-2xs` (0,7rem — labels, badges) e `text-3xs` (0,625rem — metadados densos, piso absoluto). Não criar `text-[...]` arbitrários.

**Contraste** — texto informativo em superfícies claras usa no mínimo
`text-surface-600`; em superfícies escuras, `dark:text-surface-400`. Este é o
par padrão: `text-surface-600 dark:text-surface-400`. `text-surface-500` não
é permitido sobre `surface-50` ou branco (não atinge AA) e só se justifica em
uma superfície escura fixa, onde seu contraste tenha sido verificado.
`text-surface-400` puro fica restrito a ícones decorativos, placeholders e
estados `disabled`/inativos.

**Placeholder** — a cor é regra de base no `app.css` (`input::placeholder` /
`textarea::placeholder`: `surface-400` no claro, `surface-500` no escuro), não
utilitário de call site. O Skeleton não pinta `::placeholder`, então o campo
herdava o cinza escuro do navegador e a dica lia como valor digitado — "Digite
a nova senha" parecia senha preenchida. O par muda com o tema porque o apagado
de cada um é diferente: no escuro o texto secundário já é `surface-400`, e
repeti-lo empataria placeholder com conteúdo. A regra mora em `@layer base`, de
modo que um `placeholder:*` do call site ainda vence — reserve isso para
exceção de FORMA (o `/validar` troca fonte e tamanho porque o campo é
`font-mono text-xl`), nunca para reajustar a cor à mão.

**Foco de teclado** — nunca `outline-none`/`focus:outline-none` sem substituto visível (`focus-visible:ring-2 focus-visible:ring-primary-500 …` ou `focus-within:ring` no container).

**Estilizar componente do Skeleton — `transform` não se anula com `translate-*`** (auditoria visual de ago/2026). Os utilitários `translate-*`/`scale-*`/`rotate-*` do Tailwind v4 escrevem as **propriedades individuais** (`translate`, `scale`, `rotate`); o CSS de componente do Skeleton posiciona peças com a propriedade **`transform`**. São propriedades diferentes: o navegador aplica as duas e os deslocamentos **somam**. A classe parece sobrescrever e não sobrescreve — não gera erro, não gera aviso, só sai do lugar.

Foi a causa única dos dois "desalinhamentos" relatados: o thumb do `ToggleSwitch` saía 14 px **fora** do trilho (`translate-x-5` + `translateX(16px)` = 36 px de curso num trilho que só tem 20 px) e o chevron do `SearchableSelect` subia 12 px, vazando 7 px acima do campo (`!translate-y-0` não cancelava `translateY(-50%)`).

Para neutralizar um `transform` do Skeleton, zere **`transform`** — as duas ocorrências estão resolvidas de uma vez no `app.css`, por seletor `[data-scope=…][data-part=…]`, e não classe por classe. Dos componentes em uso, só combobox e switch aplicam `transform` (`tree-view` também, mas não é usado); ao adotar um componente novo do Skeleton, confira o `.css` dele em `@skeletonlabs/skeleton-common/src/components/` antes de posicionar peças por classe.

O item **selecionado** do combobox (`data-state=checked`) leva `preset-filled`: fundo `surface-950-50` (preto no lado claro do par `light-dark()`, que é o único lado que este app enxerga) com o `text-surface-800` do `SearchableSelect` por cima. No hover o `data-highlighted` cobre; ao sair do item, o preto volta. A recusa — fundo transparente, o checkmark marca a seleção — está no mesmo bloco do `app.css`.

**Contorno de campo e iOS** — `.input`/`.select`/`.textarea` do Skeleton desenham o contorno com `border-width: 0` **mais um ring inset (`box-shadow`)**. iOS não pinta `box-shadow` em campo de formulário com aparência nativa, então no iPhone os campos ficavam **sem contorno nenhum** — login e senha inclusive. O `app.css` corrige na raiz: `appearance: none` em `.input`/`.textarea` (devolve o desenho ao CSS) e em `select.select` também — sem isso, no Windows/Chromium o chrome nativo deixa de pintar as arestas retas da `border` depois de abrir a lista, e sobram só os cantos. A seta passa a ser `background-image`; o recuo é `0.75rem` à esquerda (igual ao `.input`) e `2rem` à direita (a seta). O ring do Skeleton é zerado também no `:focus` — senão ele reaparece fragmentado por baixo da borda. Em `forced-colors` o controle volta ao nativo. Não volte a depender de `box-shadow` para a aresta de um campo, nem recoloque a seta nativa no `select`.

Essas regras ficam **fora de `@layer`** no `app.css`: CSS sem camada vence qualquer `@layer` (inclusive `utilities`), que é o único jeito determinístico de ganhar do CSS de componente do Skeleton sem espalhar `!important`. O preço é que elas vencem também os utilitários do call site — por isso só tocam propriedades que ninguém sobrescreve. Não acrescente `border-*` de `.input` ali (quebraria o `border-2` de erro do `SignaturePad`), e não use os pares `--color-*-200-800` do Skeleton, que são `light-dark()` e seguem `color-scheme`: o tema escuro deste app é a **classe** `.dark`, então o par resolveria sempre para o valor claro.

**Superfícies elevadas** — `card-elevated` (fundo canônico de modal/card sobre a página) e `card-elevated-2` (sub-card aninhado); translúcidas: `card-glass` / `card-glass-auth`. Hierarquia: glass/blur só na chrome (sidebar/topbar); conteúdo da página preferir `card-elevated` opaco — evita empilhar translucidez com a folha xl. Não montar pares `bg-* dark:bg-*` à mão.

**Quadro de preenchimento** — `card-quadro`: bloco que precisa se separar do VIZINHO, não da página. Difere de `card-elevated` na borda (2px numa surface mais escura, em vez de 1px translúcida) — a de 1px somava com a folha do layout e dois blocos seguidos pareciam um só. Em uso nos quadros de seccional da GISE e nos quatro blocos do plano operacional. O utilitário traz só contorno e fundo; `rounded-*`, padding e `hover:shadow-md` ficam no call site, e a sombra que reage ao ponteiro só entra em bloco que ABRE ao clique — num quadro estático ela promete interação que não existe.

**Modais** — código novo usa `$lib/components/ModalShell.svelte`, que mantém
o `Dialog` do Skeleton por dentro e centraliza backdrop, painel, rodapé,
camadas, `Portal` e bloqueio de fechamento durante `pending`. Use `z-50` na
base, `camada="empilhado"`/`"duplo"` para `z-[60]`/`z-[70]` e
`portal={true}` somente sob ancestral com `transform`/`contain`. Não
reimplemente foco, Escape, ARIA ou scroll lock. Um modal que não cabe nesse
contrato permanece explícito e registra no próprio arquivo a diferença de
interação ou regra de domínio.

**Botões (semântica dos presets)** — seis papéis, e só esses. Preenchido colorido leva **texto branco** (regra global em `app.css` sobre `.btn`/`.btn-icon`); não pintar `text-white` nem `text-warning-950` no call site. O feedback tátil de clique (afundar 5% pressionado) é **global e automático** para `.btn`/`.btn-icon` (regra em `app.css`) — não adicionar `active:scale-95` inline; use-o apenas em elementos interativos custom fora dessas classes.

| Papel     | Preset                        | Exemplos                                          |
| --------- | ----------------------------- | ------------------------------------------------- |
| CTA       | `preset-filled-primary-500`   | Salvar, Criar, Novo plano, Nova escala            |
| Confirmar | `preset-filled-success-500`   | Aprovar, já assinado, solicitar assinatura        |
| Destruir  | `preset-filled-error-500`     | Excluir, Sair                                     |
| Recusar   | `preset-outlined-error-500`   | Rejeitar, Remover membro, revogar pedido          |
| Neutro    | `preset-outlined-surface-500` | Cancelar, Voltar, Abrir, Editar, PDF, Detalhes    |
| Atenção   | `preset-filled-warning-500`   | Assinar (pendente), Limpar filtros ativo, reabrir |

`tertiary` e `outlined-primary` **não** são papéis de botão — chip/badge e, no máximo, link. `preset-filled-surface-500` não vai em `.btn` (contraste 3,90:1 já em repouso). Peso: `font-semibold` no botão comum; `font-bold` só no CTA final da página. Sem `font-black` e sem `uppercase` em botão de linha.

**Tamanho de botão** — `.btn-sm` do tema NÃO embute padding vertical: sem `py-*` o botão fica em ~24px de altura. A escala em uso é `py-1.5` (~34px, botões de navegação como o Voltar), `py-2.5` (~40px, CTA de modal/formulário) e `py-3.5` (~48px, ação final de página). Nada de `py-4 text-lg`, que produz um bloco de ~64px destoante do resto da tela.

**Voltar** — usar `$lib/components/BotaoVoltar.svelte`, sempre **acima do `<h1>`**, nunca no rodapé. `href` para mudar de rota, `onclick` para desfazer estado local. Com `href`, o clique VOLTA pelo histórico quando a tela foi aberta de dentro do app (`useOrigemDaNavegacao`, registrado no `afterNavigate` do layout raiz) e só navega para o `href` quando não há de onde voltar (URL colada, nova aba) — é o que evita o pingue-pongue lista → ficha → lista no voltar do navegador. Não repetir a palavra "Voltar" em outro controle da mesma tela (o passo anterior de um wizard é "Anterior") — duas coisas diferentes com o mesmo rótulo trocam de lugar na cabeça de quem usa.

**Rodapé de ação em tela longa** — usar `$lib/components/RodapeAcoes.svelte`: status à esquerda, botões à direita, `sticky bottom-0`. É para a tela em que a ação principal é frequente e ficaria presa no fim do documento — o wizard do relatório e o editor do modelo, os dois com formulários de dezenas de campos. `sticky` e não `fixed`: `fixed` sai do fluxo, passa por cima do conteúdo e exige um `padding-bottom` de reserva que ninguém mantém quando a altura do rodapé muda. Não funciona dentro de ancestral com `overflow` — ele gruda no ancestral que ROLA, e um container `overflow-hidden` não rola.

O status **tem de dizer algo que mude**. A barra do editor nasceu com dois estados — "Salvando…", que dura o tempo da requisição, e "Pronto para salvar", que era o `else` — e dizia a mesma frase tendo-se mexido em algo ou não. Hoje ela compara o que está na tela com o modelo carregado (`alteracoesNaoSalvas`), que é o que torna concreto o aviso de que nada é gravado até clicar em Salvar.

**Estado de tarefa (marcador)** — o mesmo lugar mostra os dois estados: `Check` em círculo `bg-success-500` cumprida, `Clock` em círculo `bg-warning-500` pendente. Não usar ponto cinza para "falta fazer" (lê-se como "desligado"), e não variar a cor de concluído por tipo de tarefa — na mesma linha, um quadro verde e outro cinza parecem estados diferentes quando são o mesmo.

**Border-radius** — o tema define `--radius-base` (= `rounded-xl`, botões/inputs) e `--radius-container` (= `rounded-2xl`, cards/modais); pills/chips usam `rounded-full`. Em código novo, não usar `rounded`/`rounded-md`; reservar `rounded-lg` para elementos ≤ 32 px de altura.

**Z-index (escala)** — `z-10` elementos locais · `z-20`/`z-30` overlays locais e FABs (acima do conteúdo da página, abaixo da chrome) · `z-40` topbar mobile + backdrop da sidebar · `z-50` sidebar, modais e popovers em portal · `z-[60]`/`z-[70]` modal sobre modal · `z-[100]` diálogos globais (logout, avisos) · `9999` toasts · `10000` LoadingOverlay e barra de progresso de navegação. Não inventar valores fora da escala.

**Breakpoints** — `xs:` (400 px, definido no `@theme`) para telefones estreitos; demais são os padrões do Tailwind. Exceção documentada: o corte da sidebar no `+layout.svelte` é `min-[900px]` (deliberado — não migrar para `lg:`).

**Largura de conteúdo** — páginas usam o container do layout (`max-w-6xl`, largura de leitura); telas de detalhe não travam largura. **Tela de TABELA LARGA usa 1408 px** (`max-w-[88rem]`), e quem decide é `src/routes/_components/largura-pagina.ts` pela rota — `/unidade`, `/municipios` e `/servidores` hoje: com 12, 9 e 7 colunas, em 1152 px cada nome de unidade quebrava em duas ou três linhas. Tela nova com muitas colunas entra nessa lista, não recebe um `max-w` solto no markup (que desalinharia o cabeçalho). **No celular, tabela de muitas colunas vira CARTÃO** (`md:hidden` para os cartões, `hidden md:block` para a tabela), como `/servidores` já fazia — com os mesmos dados e as mesmas ações, nada exclusivo de um tamanho de tela; e cabeçalho `sticky` só de `sm` para cima, senão o deslocamento calculado joga a linha de colunas para o meio da tabela. Em coluna SECUNDÁRIA, o nome da unidade vai curto (`$lib/unidades/nome`, "DP de Milagres") com o nome completo no `title`; onde a unidade é o assunto da linha, vai por extenso. Ambiente e folha xl usam `bg-white` / `surface-900` (teste visual). A folha em `xl` acrescenta borda e `rounded-2xl` (sem blur/ring). Glass/blur ficam na chrome (sidebar/topbar), não no canvas. As regras de `max-w` continuam as mesmas. Quando uma página precisa ser mais estreita, a trava envolve **a página toda, `<header>` incluído** (`solicitacoes` = `max-w-5xl`) — travar só um bloco do meio desalinha o card do título. Dentro de um card largo, o certo é o inverso: o conteúdo que ganha com a largura (formulário, tabela) fica solto, e só os elementos intrinsecamente estreitos — stepper, CTA, estado vazio, selo de status — recebem teto.

**Tipografia (ênfase)** — Inter em tudo (corpo 400–700; títulos/wordmark 800 via `font-heading` ou `.h1`/`.h2` — paleta e fonte do protótipo do Ecossistema, decisão E2). Título de página no chrome da app: **`h1 text-2xl font-bold`**. O tamanho é o `text-2xl`, não a classe `.h1`/`.h2` do Skeleton — essas sozinhas pintam um heading maior (foi o que deixou "Solicitações" destoando). Régua de peso: page title = `font-bold`; labels e cabeçalhos de coluna = `font-semibold`/`font-bold`; wordmark da chrome = `font-bold` sólido (sem `bg-clip-text`/gradient). Evitar `font-extrabold`/`font-black` em código novo — reservar `font-black` só para KPI numérico isolado que precise gritar. O legado migra oportunisticamente ao tocar no arquivo.

**Container queries** — quando o layout de um bloco depende do espaço que sobra **para ele** (e não do tamanho da tela), use `@container` no ancestral e as variantes `@2xl:`/`@4xl:` nos filhos, em vez de `sm:`/`lg:`. Cuidado: `container-type: inline-size` implica `contain: layout`, ou seja o elemento passa a ser containing block de descendentes `position: fixed` — nunca colocar `@container` acima de um `Dialog`/overlay, ou o modal fica preso dentro do card.

**Tarefa longa vira modal — formulário longo vira rota** — quando uma tela tem passos sequenciais (confirmar presença → entregar relatório → confirmar saída), a página mostra o **estado** (barra de progresso + um quadro compacto por passo, lado a lado na ordem de execução) e cada passo abre um modal com o seu formulário. Ver `res-gise/_components/FormularioServico.svelte`. Empilhar os passos como seções do mesmo card foi o que gerou faixas de ~1050px com o conteúdo perdido no meio no desktop.

O modal é para o passo que cabe em uma tela. Passando disso — o relatório de produtividade tem 19 perguntas de nível 0 mais os filhos condicionais — o passo vira **rota própria com wizard**: `res-gise/relatorio/[giseId]`. Uma etapa por tela, navegador de etapas (`lg:` coluna lateral `sticky`, no celular faixa rolável — a MESMA `<ol>`, com `lg:flex-col`), coluna de conteúdo em `max-w-3xl` e rodapé `sticky` com Voltar/Avançar. Rota, e não modal, porque o preenchimento tem endereço, sobrevive a um reload e admite rascunho.

**Rascunho local (autosave)** — formulário longo grava o blob no `localStorage` a cada pausa de digitação (debounce 800 ms), com chave por (registro, dono). Restaurar exige uma regra explícita: aplique sozinho **só quando não há nada no servidor**; havendo, o servidor manda e o rascunho vira uma oferta com botão. Nunca decida por comparação de relógios — os carimbos do banco são hora local em texto e o do navegador é do aparelho. Limpe o rascunho ao entregar **e** trave o autosave nesse instante, senão um timer pendente regrava o que acabou de ser apagado.

**Reordenar lista onde a posição é informação** — arraste (HTML5 DnD com alça: a alça liga o `draggable` no `mousedown`, senão não dá para selecionar texto nos campos do card) **mais** setas ↑/↓, que são o único caminho no toque e no teclado. Arraste sozinho é inacessível. E se a ordem aparece escrita no conteúdo (o "4." dentro do texto da pergunta), reordenar tem de reescrever esse conteúdo — ver `$lib/gise/renumerar-perguntas.ts`; um badge derivado de `indexOf` se acerta sozinho e esconde o problema.

**Tipos de pergunta do formulário de produtividade** — a tabela é `$lib/gise/tipos-pergunta.ts`: quais tipos abrem listagem, quais aceitam sub-pergunta e **onde cada um grava no blob**. Mexer em tipo de pergunta começa por lá, nunca pelos componentes. `chavesLista` é a fonte ÚNICA da chave da resposta, e é ela que o indicador de meta, o gráfico e a expansão do relatório consultam — uma tabela paralela escrita à mão já custou aos tipos de lista o direito de virar gráfico, e ninguém notou porque o indicador continuava funcionando.

Três tipos estão **aposentados** (`TIPOS_LISTA_APOSENTADOS`): `mandados_maiores`, `prisoes_maiores` e `apreensoes_menores`. Eles fazem exatamente o que `lista_detalhada` faz — mesmo widget, mesma forma de item, mesma expansão —, só que gravando em **chave fixa**, o que os limita a **uma ocorrência por formulário**. O genérico deriva as chaves da `key` da pergunta e por isso se repete; quem quer nomear a linha no PDF usa `subtexto_item` ("Procedimento 1" em vez de "Item 1"). Eles não foram removidos porque trocar o tipo de uma pergunta troca a chave da resposta — na prática, apaga o histórico dela —, e o editor os oferece apenas na pergunta que **já** está com um deles: escondê-los sempre faria o `<select>` cair na primeira opção e mudar o tipo sozinho ao salvar.

Ao acrescentar um tipo, a expansão em `db/gise/respostas.ts` é obrigatória no mesmo passo: sem ela o policial preenche, o dado é gravado e **some do PDF assinado sem erro nenhum**.

**A URL manda na seleção** — se uma tela escreve o item selecionado na query string (`?giseId=`), ela precisa **ler de volta**, senão recarregar ou voltar de outra rota cai na lista com a URL apontando para um item que não está na tela. O efeito que faz isso escreve o mesmo estado que lê: a guarda de igualdade é o que faz a segunda passada parar.

**Ícones** — código novo usa
[`@lucide/svelte`](https://lucide.dev) (já é dependência; herda
`currentColor`). **Nunca emoji como ícone** (✍️ ✅ 🔒…): renderizam diferente
por SO e ignoram a cor do tema. O SVG inline legado migra oportunisticamente
ao tocar no arquivo.

**Transições** — em código novo, prefira a propriedade específica (`transition-colors`, `transition-transform`, `transition-opacity`) a `transition-all`, que anima layout sem querer e custa mais. O legado migra oportunisticamente.

**Loading** — usar `$lib/components/Spinner.svelte` (acessível, herda `currentColor`); não desenhar SVG `animate-spin` à mão. Carregamento de página: skeletons (`SkeletonCard`) + barra de progresso do layout; operações de API: `loading.show()`/`hide()`.

**Tabelas** — padrão duplo: `<div class="hidden md:block table-wrap"><table class="table">…` no desktop + lista de cards `md:hidden` no mobile. Nunca `<table>` sem `table-wrap`.

---

## 11. Testes

### Testes unitários (Vitest)

```bash
npm run test          # Executa uma vez
npm run test:watch    # Watch mode (recomendado durante desenvolvimento)
```

Arquivos de teste ficam em `src/` com o padrão `*.test.ts`, **sempre** em pastas `__tests__/` junto do código testado (convenção verificada no CI; rode `npm run test` para o total atual). Os principais grupos:

- `src/lib/__tests__/` — autenticação (PBKDF2/pepper, sessões, 2FA), CSRF, headers de segurança, utilitários
- `src/lib/schemas/__tests__/` — schemas Zod (LGPD, formulários GISE)
- `src/lib/gise/__tests__/` — regras GISE puras: etapas do formulário, renumeração, tipos de pergunta
- `src/lib/crypto/__tests__/` — criptografia de campos e CPF, primitivas (hash, token, timing-safe)
- `src/lib/db/__tests__/` — camada de dados: auditoria forense, retenção LGPD, upserts de assinatura
- `src/lib/server/__tests__/` — infraestrutura transversal: e-mail, `r2-cleanup`, `request-context`, Sentry/PII, schema × migrações
- `src/lib/server/assinatura/__tests__/` — CAdES, OCSP, TSA, trust store ICP-Brasil, ByteRange, verificação, goldens dos carimbos visuais
- `src/lib/server/auth/__tests__/` — fluxo de login, login por certificado (e revogação), webhooks
- `src/lib/server/gise/__tests__/` — permissões GISE, termo de presença, carimbos de revalidação
- `src/lib/server/export/__tests__/` — goldens de PDF (escalas) e cabeçalho institucional
- `src/lib/server/escalas/__tests__/` — permissões de escala, carimbos de revalidação

### Testes E2E (Playwright)

```bash
# Instalar browsers (apenas uma vez)
npx playwright install --with-deps chromium

npm run test:e2e            # todos os specs
npm run test:e2e:ui         # interface visual (útil para debugar)
npm run test:e2e:report     # abre o relatório da última execução

npm run test:e2e -- e2e/auth.spec.ts       # um arquivo
npm run test:e2e -- --project=chromium     # só desktop (pula o projeto mobile)
```

> **`SYNC_TOKEN` curto derruba 4 specs com 401.** Os webhooks recusam segredo
> com menos de 32 caracteres, então um placeholder do tipo `token-de-dev` faz
> `webhook-sync.spec.ts` falhar inteiro — uma falha que parece bug do sistema e
> é só configuração. Gere com `openssl rand -hex 32`, como manda o
> [`.env.example`](.env.example).

> **O E2E roda contra o seu D1 local, não contra um banco limpo.** O
> `global-setup` purga o que a própria suíte cria (faixa de id 99xxx), mas não
> toca em dados reais — se você andou usando o app, eles continuam lá. Os specs
> são escritos para tolerar isso (asserções miradas na fixture); se algum falhar
> por dado alheio, é bug do spec, não do seu banco.

Os testes E2E fazem build + preview automático antes de rodar (via `e2e/servidor-e2e.ts`), e o `global-setup` aplica as migrations pendentes no D1 local e semeia os fixtures — não é preciso preparar o banco manualmente. Configure credenciais de teste em `e2e/global-setup.ts`. Além do projeto `chromium`, um projeto `mobile` (Pixel 7 emulado) reexecuta os specs de UI em viewport de celular.

**Cobertura negativa automática:** `autorizacao-negativa.spec.ts` varre
`src/routes/**` em tempo de teste e exerce **todas** as operações materiais em
dois cenários — anônimo, e policial de outra unidade contra um recurso real —
exigindo 401/403/404 e nenhum documento criado ou apagado. A tabela não é
escrita à mão: rota nova entra sozinha, sem depender de alguém lembrar. É o
complemento executável do `guard:autorizacao`, que só lê o código: o guard vê
_se_ existe gate, o spec vê se ele **vem antes do trabalho** e se olha o
**recurso**, não só o usuário. Foi ele que achou o FLW-GISE-004.

Duas armadilhas ao mexer nele: alvo protegido por outro motivo (escala já
assinada, GISE fechada) não testa permissão — o 409 chega primeiro e esconde a
falta do 403; e form action **não** usa o status HTTP, porque o `ActionResult`
viaja em JSON sob 200 mesmo quando a action executou.

**Fluxo A3 qualificado em CI:** o build de E2E injeta uma **CA de teste** no trust store ICP-Brasil (`E2E_TEST_CA=1` no build → `define` do Vite → `trust-store.ts`; chaves regeneradas a cada execução em `e2e/ca-teste/artefatos/`, gitignored). O spec `assinatura-qualificada-a3.spec.ts` faz o papel do Assinador SERPRO no runner (CMS CAdES assinado com o "e-CPF" de teste) e percorre preparar → finalizar → download → `/validar` contra a verificação real do servidor — incluindo os negativos de CA desconhecida, CPF divergente e digest adulterado. Em build normal a constante não existe e o ramo é código morto: **não há env de runtime capaz de ligar a CA de teste em produção**.

### Testes manuais

O arquivo [`TESTING.md`](TESTING.md) é o roteiro de **exceção**: cobre o que exige hardware ou ambiente real (Assinador SERPRO com token físico, caixa de e-mail, ACT ICP). O gate de regressão é a suíte automatizada (Vitest + Playwright no CI); os casos do TESTING.md já cobertos por spec estão anotados no próprio arquivo.

---

## 12. Deploy em Produção

> Para o runbook completo de operações, leia [`DEPLOY.md`](DEPLOY.md).

### Pré-requisitos

- Wrangler autenticado: `wrangler login`
- Variáveis de ambiente configuradas no **Cloudflare Pages → Settings → Environment Variables**
- Projeto Pages criado no dashboard Cloudflare

### Deploy via CI/CD (recomendado)

Faça push ou abra PR para as branches `main` ou `staging`. O GitHub Actions (`.github/workflows/deploy.yml`) executa automaticamente:

1. `npm run lint:ci` + `npm run format:check` + `npm run format:check:e2e`
2. `npm run knip` (código e exports mortos)
3. `npx svelte-check --threshold error`
4. `npx vitest run --coverage`
5. `npm run build`
6. **Oito guards**, cada um num passo próprio: convenção de testes (`__tests__/`), padrão de erros de API
   (`$lib/server/api`), permissão de documento assinado, `guard:autorizacao`, `guard:duplicacao`,
   `guard:achados`, `guard:entrada` e `docs:guard`
7. Migrações D1 locais + `npx playwright test` (E2E)
8. Migração D1 do ambiente alvo **e** `wrangler pages deploy` (push em `staging` gera um
   _preview deployment_ com D1/R2 dedicados) — a migração roda ANTES do deploy, e falhar nela
   impede o deploy

### Deploy manual

```bash
# 1. Aplicar migrações de banco em produção (SEMPRE antes de deploiar código novo)
npm run db:migrate:prod -- --yes

# 2. Build
npm ci
npm run build

# 3. Deploy
wrangler pages deploy .svelte-kit/cloudflare --project-name=escalas
```

### Checklist pré-deploy

- [ ] Todas as variáveis de ambiente estão configuradas no dashboard Cloudflare
- [ ] `RESET_TOKEN` é diferente de `SYNC_TOKEN` (ou intencionalmente vazio)
- [ ] Migrações aplicadas: `npm run db:migrate:prod -- --yes`
- [ ] Testes passando: `npm run test`
- [ ] Type-check limpo: `npm run check`
- [ ] Build sem erros: `npm run build`

### Smoke tests pós-deploy

1. Acessar a URL do projeto e fazer login
2. `GET /api/health` deve retornar `200 OK`
3. Verificar uma escala existente e conferir o PDF
4. Conferir logs em **Cloudflare Pages → Functions → Logs**

### Cache edge de configurações

As flags de assinatura (`exigir_foto`, `exigir_gps`, etc.) são cacheadas por 5 minutos em todos os PoPs Cloudflare. Quando um admin altera a configuração em `/conf-ass`, o cache é invalidado automaticamente via Cloudflare Cache API.

Todas elas são aplicadas **no servidor** — inclusive `restringir_smartphone`, que recusa a assinatura avançada por user-agent não-móvel em vez de só esconder o painel, e `exigir_passkey_assinatura`, que exige uma chave WebAuthn do celular na assinatura da escala. Ver [`DEPLOY.md`](DEPLOY.md#cache-edge-das-flags-de-assinatura) e [`DEPLOY.md`](DEPLOY.md#chave-de-assinatura-passkey--webauthn) para o alcance probatório de cada uma.

### Reset destrutivo (emergência)

O endpoint `/api/webhook/reset-policiais` **apaga todas as tabelas operacionais**. Requer quatro camadas simultâneas:

1. `Authorization: Bearer <SYNC_TOKEN>`
2. `X-Reset-Token: <RESET_TOKEN>`
3. `X-Confirm-Reset: <YYYY-MM-DD em UTC>` (confirmação explícita do dia)
4. `X-Webhook-Timestamp` + `X-Webhook-Nonce` (anti-replay, 5 min) — **obrigatórios aqui**, independentemente de `WEBHOOK_REPLAY_ENFORCE`, porque a camada 3 sozinha deixaria 24 h de janela para reenvio

> ⚠️ Use apenas via o menu da planilha Google Sheets, que exige confirmação dupla.

---

## 13. Softwares Externos e Integrações

### Assinador SERPRO Desktop

Para assinatura qualificada com certificado A3 (hardware token), o usuário precisa ter o **Assinador SERPRO Desktop** instalado na máquina. O sistema se conecta a ele via WebSocket local.

- Download: [assinador.serpro.gov.br](https://www.serpro.gov.br/menu/nossas-forcas/especializados/assinador-digital)
- O sistema tenta automaticamente as portas 65166, 65156 e 65500 em `assinador-desktop.serpro.gov.br` e `127.0.0.1`
- **Em ambiente de desenvolvimento**: logs detalhados de conexão aparecem no console do navegador (gateados por `import.meta.env.DEV`)

### WebPKI (Lacuna Software)

Alternativa ao SERPRO para assinatura qualificada. Requer extensão do navegador ou plugin instalado. A biblioteca (`web-pki`) é carregada sob demanda.

- Documentação: [docs.lacunasoftware.com](https://docs.lacunasoftware.com/articles/web-pki/)

### Google Apps Script (sincronização de planilha)

O arquivo [`scripts/GoogleAppsScript_Sync.gs`](scripts/GoogleAppsScript_Sync.gs) é um Apps Script configurado em uma planilha Google que sincroniza policiais e unidades. Ele chama os webhooks da aplicação autenticado pelo `SYNC_TOKEN` (com replay protection — ver [`DEPLOY.md`](DEPLOY.md#replay-protection-dos-webhooks-p13)).

Para configurar:

1. Abra a planilha Google em `Extensões → Apps Script`
2. Cole o conteúdo de `scripts/GoogleAppsScript_Sync.gs`
3. Use o menu "🚀 Sincronização D1" → "⚙️ Configurar tokens" para gravar `SYNC_TOKEN` (e `RESET_TOKEN`, se for usar reset) no `PropertiesService`
4. Para a integração `Base_Equipe` (GISE), publique como Web App — detalhes em [`scripts/README.md`](scripts/README.md)

### Reconhecimento facial (face-api)

Os modelos de IA do `@vladmandic/face-api` estão em `static/face-api/` e são **servidos pelo próprio projeto** (sem dependência externa de CDN). Isso garante conformidade com a CSP e evita _rate limiting_.

Para atualizar os modelos: siga as instruções em `static/face-api/README.md`.

### E-mail transacional (2FA, primeiro acesso, reset de senha)

O envio de e-mail usa o **binding `EMAIL`** (Cloudflare Email Sending, configurado em Pages → Settings → Bindings) como caminho primário, com **Resend** como fallback (`RESEND_API_KEY` + `RESEND_FROM_EMAIL`). A implementação está em `src/lib/server/email.ts`.

> **Importante:** sem e-mail funcionando, o 2FA (fail-closed) e o primeiro acesso travam. Ver [`DEPLOY.md`](DEPLOY.md#variáveis-e-secrets).

---

## 14. Troubleshooting

### `npm run dev` falha com erro de binding D1/R2

O banco local ainda não existe. Rode `npm run db:migrate` antes.

### Type errors em arquivos `.svelte` que não aparecem no editor

Execute `npm run check` (usa o Svelte Check, que é mais rigoroso que o servidor de linguagem do editor). O VS Code com a extensão oficial do Svelte geralmente alinha com o check, mas pode haver delay.

### Erro de CSRF em chamadas de API no desenvolvimento

Certifique-se de que o frontend usa `csrfHeaders()` de `$lib/csrf` em todas as requisições mutantes:

```typescript
import { csrfHeaders } from '$lib/csrf';

await fetch('/api/meu-endpoint', {
	method: 'POST',
	headers: { ...csrfHeaders(), 'Content-Type': 'application/json' },
	body: JSON.stringify(dados)
});
```

### Assinador SERPRO não conecta

1. Verifique se o Assinador SERPRO Desktop está rodando na bandeja do sistema
2. Abra `https://assinador-desktop.serpro.gov.br:65166` no navegador e aceite o certificado self-signed
3. No Firefox, o fluxo de autorização do certificado é mais simples que no Chrome
4. Abra o console do navegador (F12) — em desenvolvimento, logs detalhados de tentativa de conexão são exibidos

### Sessão expirada logo após login

Verifique se o relógio do servidor está sincronizado (NTP). O D1 usa timestamps UTC. Uma diferença grande de fuso pode invalidar sessões prematuramente.

### Migrações em produção falham

1. Certifique-se de que o Wrangler está autenticado: `wrangler whoami`
2. Verifique se o `database_id` em `wrangler.toml` corresponde ao banco correto no dashboard
3. Confira a tabela `_migrations_aplicadas` no D1 — é ela que rastreia o que já rodou:
   `npx wrangler d1 execute escalas-db --remote --command "SELECT * FROM _migrations_aplicadas ORDER BY id DESC LIMIT 10"`

### Análise de bundle

Para inspecionar o tamanho dos chunks após o build:

```bash
npm run build
# Abre bundle-stats.html no navegador
```

---

_Em caso de dúvidas técnicas, comece pelos arquivos `+page.server.ts` da rota em questão — eles contêm a lógica de negócio mais próxima do banco. Para dúvidas de produto, consulte a liderança técnica do time._
