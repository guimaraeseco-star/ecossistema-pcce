# Ecossistema PCCE — Parâmetros do Sistema para Desenvolvedores

> **Para quem é**: qualquer pessoa ou IA que vá escrever código neste sistema.
> **Para que serve**: alinhar decisões antes de escrever, para que dois desenvolvedores (ou um desenvolvedor e uma IA) não construam a mesma coisa de dois jeitos.
> **Como ler**: cada item traz o estado — `EXISTE` (está em produção hoje) ou `PLANEJADO (fase N)` (decidido, não construído). O que não está aqui não foi decidido.
> **Como manter**: ver §0. Este documento é vivo; um documento desatualizado é pior que nenhum.

| Campo               | Valor                                                                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Versão do documento | 1.1 — 12/09/2026                                                                                                                                                                                                                                                                                                |
| Responsável         | Erlon (Admin Geral, matrícula 19845117)                                                                                                                                                                                                                                                                         |
| Onde mora           | `docs/PARAMETROS.md` neste repositório (a cópia em `C:\Ecossistema-PCCE\PARAMETROS-DO-SISTEMA.md` é só rascunho e deixa de valer)                                                                                                                                                                               |
| Linkado de          | `CLAUDE.md` e `docs/README.md`                                                                                                                                                                                                                                                                                  |
| Documentos-irmãos   | `README.md` (setup, arquitetura, padrões de código, §10 visual), `DEPLOY.md` (produção), `TESTING.md` (roteiro manual), `CLAUDE.md` (regras para a IA), `docs/HISTORICO.md` (auditorias arquivadas), plano do Ecossistema (`Plano-Ecossistema-PCCE-v3.docx`, decisões E1–E38), plano de diárias (decisões 1–72) |

---

## 0. Regras de manutenção deste documento

1. **Toda mudança de comportamento, tabela, rota, papel ou cor é acompanhada da atualização deste arquivo no MESMO pull request.** É a mesma regra que já vale para `README.md`/`DEPLOY.md`/`TESTING.md`.
2. Quando um item sai de `PLANEJADO` para `EXISTE`, troca-se a etiqueta e anota-se a migração ou o PR.
3. Decisão nova recebe número (`E31`, `E32`…) na tabela §11 e a data. Decisão revogada não é apagada: fica com `REVOGADA por E-n`.
4. Nada de segredo, senha, token, CPF ou e-mail pessoal aqui. Este arquivo é público dentro do repositório.
5. Linguagem: português do Brasil, frases curtas, tabelas. Sem jargão que não esteja no glossário (§14).

---

## 1. Identidade do sistema

| Item                      | Valor                                                                                                                                                                              | Estado                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Nome                      | **Ecossistema PCCE** (decisão E30)                                                                                                                                                 | PLANEJADO (fase 0) — hoje o sistema se chama "Escalas"                                                       |
| O que é                   | Plataforma modular da Polícia Civil do Ceará: delegacias, municípios, servidores, operações, financeiro (diárias, extras, valores), patrimônio, escalas, relatórios, administração | PLANEJADO — hoje existem escalas, operações (plano operacional, GISE), cadastro de policiais e administração |
| Onde nasce                | Departamento de Polícia do Interior Sul (DPI SUL)                                                                                                                                  | EXISTE                                                                                                       |
| Para onde cresce          | Toda a corporação (organograma do Decreto 37.465, DOE 03/07/2026) — §7.3                                                                                                           | PLANEJADO (fases 1–2)                                                                                        |
| Situação operacional      | **Em construção; não opera oficialmente** — só testes. Dado legado não pesa em decisão de modelo                                                                                   | EXISTE                                                                                                       |
| Domínio                   | **`dpisul.com.br`** — Registro.br, titular guimaraes.eco@gmail.com, pago por 2 anos, **vence 12/09/2028** (E38). Será `APP_ORIGIN` e domínio de e-mail                             | PLANEJADO (fase 0) — registrado em 12/09/2026                                                                |
| Base normativa de diárias | Decreto Estadual nº 35.922/2024, alterado pelo Decreto nº 36.182/2024                                                                                                              | referência                                                                                                   |

---

## 2. Linguagens, frameworks e ferramentas

Versões conforme `package.json` em 12/09/2026 (o `^` indica a faixa aceita).

| Camada               | Tecnologia                                                                                        | Versão                | Observação                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Linguagem            | **TypeScript** (strict)                                                                           | ^5.9                  | Nada de JavaScript solto em `src/`                                                                                                                     |
| Runtime local        | Node.js                                                                                           | ≥ 22 (em uso: 24)     | `engines.node`                                                                                                                                         |
| Framework web        | **SvelteKit**                                                                                     | ^2.70                 | Server-first: `load()` e form actions no servidor                                                                                                      |
| UI                   | **Svelte 5 com runes**                                                                            | ^5.56                 | `$state`, `$derived`, `$effect`, `$props`, `$bindable`, snippets. **Proibido**: `writable()`, `$:`, `export let`, slots, `onMount` para lógica reativa |
| CSS                  | **Tailwind CSS 4** + **Skeleton UI 4**                                                            | ^4.3 / ^4.13          | Tema em `src/theme.css` (`[data-theme='policial']`); tokens em oklch                                                                                   |
| Ícones               | `@lucide/svelte`                                                                                  | ^1.28                 |                                                                                                                                                        |
| Validação            | **Zod**                                                                                           | ^4.4                  | Toda entrada de API por `validateBody`; form action por leitores de `$lib/server/form-data`                                                            |
| Banco                | **Cloudflare D1** (SQLite) via **Drizzle ORM**                                                    | ^0.45                 | Schema em `src/lib/server/schema.ts`; migrações SQL escritas à mão em `migrations/NNNN_nome.sql`                                                       |
| Arquivos             | **Cloudflare R2**                                                                                 | —                     | PDFs assinados, portarias anexas, (planejado) fotos de delegacias                                                                                      |
| Hospedagem           | **Cloudflare Pages** (+ Functions)                                                                | adapter-cloudflare ^7 | Deploy pelo CI com `wrangler pages deploy`                                                                                                             |
| E-mail               | Cloudflare Email Sending **ou** Resend, com fallback automático                                   | —                     | Provedor padrão em Configurações Gerais                                                                                                                |
| Erros                | Sentry (`@sentry/cloudflare`)                                                                     | ^10                   | Opcional; sem `SENTRY_DSN` não reporta                                                                                                                 |
| PDF                  | `pdf-lib`; assinatura PAdES/CAdES própria; carimbo de tempo RFC 3161 (`TSA_URL`)                  | —                     | Goldens em `__tests__` — **não mudar um byte sem intenção**                                                                                            |
| Certificado digital  | Assinador SERPRO (aplicativo local do usuário, token A3) + cadeia ICP-Brasil (`icp-brasil/*.pem`) | —                     | Sem conta em serviço externo                                                                                                                           |
| Passkey              | `@simplewebauthn`                                                                                 | —                     | Segundo fator de assinatura                                                                                                                            |
| Testes unitários     | **Vitest** (`environment: node`, sem DOM)                                                         | ^4.1                  | ~2.500 testes; cobertura por `@vitest/coverage-v8`                                                                                                     |
| Testes ponta a ponta | **Playwright**                                                                                    | ^1.62                 | Em `e2e/`; único lugar que testa componente `.svelte`                                                                                                  |
| Qualidade            | ESLint ^10, Prettier ^3.9, knip ^6, svelte-check ^4.7                                             | —                     |                                                                                                                                                        |
| CLI Cloudflare       | Wrangler                                                                                          | ^4.123                | Login OAuth na máquina do desenvolvedor                                                                                                                |
| Planos/documentos    | `docx` ^9 (gera os `.docx` dos planos a partir de `.mjs`)                                         | —                     | Fora do app                                                                                                                                            |

---

## 3. Repositório e fluxo de trabalho

| Item                                | Regra                                                                                                                                                                                                                                                                                                                                                               | Estado             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Repositório atual                   | `julioborgesigt/escalas` (GitHub, público), branch `main` = produção                                                                                                                                                                                                                                                                                                | EXISTE             |
| Repositório futuro                  | Conta própria do Erlon, **novo repositório** (não fork), público por enquanto; o atual não é tocado; mudanças do atual entram por `cherry-pick` seletivo (E11)                                                                                                                                                                                                      | PLANEJADO (fase 0) |
| Branches                            | Uma branch por entrega (`feat/…`, `fix/…`, `chore/…`) a partir de `main`; PR para `main`; **o repositório exige branch atualizada com `main` antes do merge** → merges sequenciais                                                                                                                                                                                  | EXISTE             |
| CI (`.github/workflows/deploy.yml`) | ~25 min: `format:check` → `lint:ci` → `format:check:e2e` → `knip` → `svelte-check` → `vitest` + cobertura → `build` → 8 guards → migrações D1 locais → Playwright. Push em `staging` faz deploy de staging; merge em `main`, produção                                                                                                                               | EXISTE             |
| Antes de todo push                  | Rodar **a mesma sequência localmente** (`npm run lint:ci && npm run format:check && npm run format:check:e2e && npm run knip && npm run check && npm test && npm run build` + guards). `npx prettier --write src/` antes de commitar é barato                                                                                                                       | regra              |
| Guards (falham o CI)                | `guard:autorizacao` (toda mutação recusa alguém no servidor), `guard:entrada` (todo campo de FormData tem limite), `guard:duplicacao` (bloco de 10 linhas repetido reprova, salvo baseline), `guard:achados` (sigla de auditoria citada existe no catálogo), `docs:guard` (arquivo novo em `src/lib/db/` tem cabeçalho e JSDoc), convenção de testes (`__tests__/`) | EXISTE             |
| Documentos vivos                    | `README.md`, `DEPLOY.md`, `TESTING.md` e **este** — atualizados no mesmo PR                                                                                                                                                                                                                                                                                         | regra              |
| Verificação de tela                 | **Toda mudança visível é conferida no app local (`npm run dev`, http://localhost:5173) antes do PR**, por quem pediu a mudança. CI verde não substitui                                                                                                                                                                                                              | regra              |
| Migrações                           | Numeradas, sequenciais, à mão, nunca editadas depois de mesclada. Última em produção: `0083`. Próximas: `0084`–`0088` (Ecossistema), `0089+` (diárias). Ver §8                                                                                                                                                                                                      | EXISTE / PLANEJADO |
| Autorização para codar              | Neste projeto **nenhum código é escrito sem autorização expressa** do responsável para aquela fase/passo                                                                                                                                                                                                                                                            | regra              |
| Commits                             | Mensagem em português, prefixo convencional (`feat:`, `fix:`, `chore:`, `docs:`, `style:`)                                                                                                                                                                                                                                                                          | EXISTE             |

---

## 4. Organização do código

Detalhe completo em `CLAUDE.md` e `README.md`. Resumo do que causa conflito quando ignorado:

| Onde                             | O que vai                                                                                                                                                                                                     | Regra                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/lib/server/` (raiz)         | só infra transversal: `api.ts`, `schema.ts`, `logger.ts`, `sentry.ts`, `email.ts`, `db-errors.ts`, `csp.ts`, `app-origin.ts`, `request-context.ts`, `r2-cleanup.ts`, `policial-permissao.ts`, `edge-cache.ts` | arquivo com prefixo de domínio (`gise-*`, `escala-*`) está na pasta errada |
| `src/lib/server/<dominio>/`      | `assinatura/`, `auth/`, `escalas/`, `gise/`, `export/`, `sync/`, `termo/`, `policiais/`, `planos/` + (planejado) `servidores/`, `delegacias/`, `municipios/`, `patrimonio/`, `financeiro/`, `relatorios/`     | cada domínio com seu `__tests__/`                                          |
| `src/lib/db/`                    | acesso a dados por tabela/assunto; `lib/db.ts` é barrel deliberado                                                                                                                                            | cabeçalho + JSDoc obrigatórios (guard)                                     |
| `src/lib/schemas/`               | Zod compartilhado entre cliente e servidor                                                                                                                                                                    |                                                                            |
| `src/lib/utils/`                 | **sem barrel**: importar `$lib/utils/datas`, `$lib/utils/formato`, `$lib/utils/pii`, `$lib/utils/download`, `$lib/utils/localStorage`                                                                         |                                                                            |
| `src/lib/components/`            | componente usado por **duas rotas irmãs** ou mais                                                                                                                                                             |                                                                            |
| `src/routes/<rota>/_components/` | peça que só aquela rota (ou aquela família rota + sub-rota) usa; o `_` a tira do roteador                                                                                                                     | família declara no cabeçalho de cada arquivo quais telas atinge            |
| `src/routes/_components/`        | regra de navegação em `.ts` puro e testado: `menu-visibilidade.ts` e `bem-vindo-cards.ts` — **item novo entra nos dois**                                                                                      | teste reprova destino de menu sem cartão                                   |
| `*.test.ts`                      | sempre em `__tests__/` ao lado do código; fixtures em `__tests__/fixtures/`                                                                                                                                   | componente `.svelte` não tem teste unitário — regra vai para `.ts` puro    |
| `e2e/`                           | Playwright                                                                                                                                                                                                    |                                                                            |
| `scripts/`                       | guards, geradores (feriados, municípios, tempos), baseline de duplicação                                                                                                                                      |                                                                            |
| `migrations/`                    | SQL                                                                                                                                                                                                           |                                                                            |

**Padrões obrigatórios de código** (detalhe em `CLAUDE.md`):

- Erros de API sempre por `$lib/server/api` (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `rateLimited`, `serverError`, `apiError` + `ErrorCode`). Nunca `json({ error })` à mão.
- Fetch no cliente sempre por `$lib/api-fetch` (`apiFetch`, `apiFetchResponse`); download por `$lib/utils/download`; fluxo de assinatura por `$lib/assinatura-token`. `fetch` cru só em POST de form action.
- Duplicação: **extrair antes de comentar**. Se extrair piorar, registrar a decisão no código e na baseline com `nota`.
- Artefato com valor jurídico (PDF assinado, e-mail transacional, termo): rodar goldens antes e depois; regravar só com mudança intencional.
- Comentário explica **decisão** (regra da corporação, ordem obrigatória, armadilha, consequência legal), não o que o código já diz. Cabeçalho de módulo no topo do arquivo.

---

## 5. Módulos, rotas e estado

| Módulo                              | Rota (planejada)                                                                           | Rota atual                                                                                                                            | Conteúdo                                                                                                                                                                                                            | Estado                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Home / painel de módulos            | `/`                                                                                        | `/bem-vindo`, `/painel`                                                                                                               | um cartão por módulo alcançável — Delegacias, Municípios, Servidores, Operações, Financeiro, Patrimônio, Escalas, Relatórios, Administração — com contadores e alertas; cabeçalho unidade / usuário / perfil        | PLANEJADO (fase 1)                                                                                    |
| Servidores                          | `/servidores`, `/servidores/[id]`, `/servidores/propostas`, `/servidores/ferias`           | `/policiais`, `/policiais/[id]`, `/solicitacoes`                                                                                      | cadastro, ficha, linha do tempo, propor→homologar (campo a campo e ações de RH), afastamentos, férias/abono/deslocamento, alertas. **Cargos: só DPC e OIP** (E31)                                                   | EXISTE (núcleo) / PLANEJADO (fase 2: 19 afastamentos, férias, posse, nascimento, designação, painéis) |
| Delegacias                          | `/delegacias`, `/delegacias/[id]`, `/delegacias/[id]/patrimonio`                           | `/unidades` (estrutura, Super Admin)                                                                                                  | ficha rica (contatos, AIS, plantão, custódia, xadrezes, tira-gravame, foto), efetivo por cargo, patrimônio, municípios atendidos, propostas                                                                         | PLANEJADO (fase 2)                                                                                    |
| Municípios                          | `/municipios`, `/municipios/[ibge]`                                                        | — (tabela existe para diárias)                                                                                                        | 89 atendidos com cobertura (delegacia, AIS, plantão semana/FDS, custódia, RISP, PM, BM, PEFOCE, macrorregião); **sem proposta — só Admin Geral/Super Admin editam**; **visível só de departamento para cima** (E32) | PLANEJADO (fase 2)                                                                                    |
| Patrimônio                          | `/patrimonio`                                                                              | —                                                                                                                                     | veículos (caracterizado/descaracterizado), armas, algemas, móveis, computadores…; tipos parametrizados; movimentações; propostas (E34)                                                                              | PLANEJADO (fase 4)                                                                                    |
| Escalas                             | `/escalas/…`                                                                               | `/escalas/…`, `/recebidos`, `/validar`                                                                                                | escala ordinária, assinatura, validação — **regra não muda** (E7)                                                                                                                                                   | EXISTE                                                                                                |
| Operações                           | `/operacoes/planos`, `/operacoes/gise`, `/operacoes/produtividade`                         | `/gise`, `/res-gise`, `/produtividade`, planos em `/api/planos`                                                                       | plano operacional, GISE, produtividade — **regra não muda** (E9, E20)                                                                                                                                               | EXISTE (muda de endereço na fase 1)                                                                   |
| Financeiro → Diárias                | `/financeiro/diarias/…`                                                                    | —                                                                                                                                     | plano de diárias (72 decisões): ritos geral e de operação, documentos, tempestividade, indexador                                                                                                                    | PLANEJADO (fase 5)                                                                                    |
| Financeiro → Extras                 | `/financeiro/extras`                                                                       | —                                                                                                                                     | horas extras (Cota)                                                                                                                                                                                                 | PLANEJADO (fase 6, plano próprio)                                                                     |
| Financeiro → Atualização de Valores | `/financeiro/valores`                                                                      | `/config-custos` (Super Admin)                                                                                                        | valores de hora extra e diária, versionados (`custo_parametros`) — base de Extras e Diárias; **aberto ao Admin Geral** (E33)                                                                                        | EXISTE (muda de endereço e de acesso na fase 1)                                                       |
| Relatórios                          | `/relatorios`                                                                              | `/produtividade`, exportações da auditoria, relatório GISE (espalhados)                                                               | dashboard estratégico e relatórios que cruzam módulos; período homólogo e unidade zerada como padrão (E35, E36)                                                                                                     | PLANEJADO (fase 6)                                                                                    |
| Prisões                             | —                                                                                          | —                                                                                                                                     | registro pela delegacia → homologação → dashboard; 24 colunas documentadas em `02-origem\App_Prisoes_DPISul` (E37)                                                                                                  | FUTURO, sem fase                                                                                      |
| Administração                       | `/admin/…`                                                                                 | `/super-admin`, `/unidades`, `/colaboradores`, `/config-geral`, `/conf-ass`, `/auditoria`, `/auditoria/logs`, `/dados-base`, `/termo` | estrutura, acessos, colaboradores, configurações, assinatura, auditoria, LGPD, importações (custos saem daqui para Financeiro → Valores)                                                                            | EXISTE (muda de endereço na fase 1)                                                                   |
| Colaborador (terceirizado)          | `/colaborador`                                                                             | `/colaborador`                                                                                                                        | área do terceirizado; alcança só o que for designado                                                                                                                                                                | EXISTE (login por e-mail) / PLANEJADO (fase 3: login por CPF, designações)                            |
| Autenticação                        | `/login`, `/alterar-senha`, `/redefinir-senha`, `/aceitar-termo`, `/perfil`, `/api/auth/*` | idem                                                                                                                                  | senha + 2FA por e-mail, certificado SERPRO, passkey, primeiro acesso por link                                                                                                                                       | EXISTE                                                                                                |

Rotas antigas viram redirecionamento 301 para as novas durante a fase 1 e saem ao fim dela.

---

## 6. Perfis, hierarquia e autorização

### 6.1 Perfis

| Perfil                    | Quem é                                                    | Escopo                                                     | Estado                                                                  |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Policial (sem papel)      | servidor comum                                            | ele mesmo                                                  | EXISTE                                                                  |
| Admin de unidade          | chefe de delegacia                                        | a delegacia                                                | EXISTE — vira "Admin da Delegacia X" (E25)                              |
| Admin de seccional        | chefe de seccional                                        | as delegacias da seccional                                 | EXISTE — vira "Admin da Nª Seccional" (E25)                             |
| Admin Geral               | diretor, gabinete ou servidores lotados no departamento   | o departamento                                             | EXISTE (irrestrito) — vira "Admin do DPI SUL", escopo = subárvore (E25) |
| Administrador corporativo | Gabinete, DPGI, COGEP, Logística, DTO, Corregedoria, CTIC | a corporação inteira (ver); o que faz é por módulo         | PLANEJADO (fase 2, E26)                                                 |
| Super Admin               | administração técnica do sistema                          | tudo técnico; **não é nível da hierarquia policial** (E27) | EXISTE                                                                  |
| Colaborador               | terceirizado                                              | só onde designado; falha fechado                           | EXISTE                                                                  |

### 6.2 Regras de autorização (não negociáveis)

- **Toda operação material (POST/PUT/PATCH/DELETE e form action) recusa alguém no servidor.** Esconder botão não é autorização. Verificado por `guard:autorizacao`.
- Não existe `autorizar()` único: usa-se o resolvedor do domínio — `verificarPermissaoEscala`, `verificarPermissaoGise`, `resolverParticipacaoGisePolicial`, `lotacoesAdministradas`, `requireAdmin`, `requireSuperAdmin`, `requireAuthComCadastro`. Operação pública de propósito é declarada com motivo em `scripts/guard-autorizacao.mjs`.
- `requireAuth` prova sessão, não permissão. Id que vem do corpo/FormData é conferido contra o escopo de quem chamou.
- **Admin Geral homologa e também altera direto** (E5). Admins de unidade e seccional só propõem.
- **Propostas** (propor → homologar) valem para servidores (existe), delegacias e patrimônio (planejado). **Municípios não têm proposta** (E6) e só aparecem de departamento para cima (E32).
- **Dado sensível fora do escopo é mascarado, não omitido** (E36): a tela mostra que o registro existe, com o campo protegido no lugar do conteúdo.
- Colaborador: allowlist de rotas em `src/lib/server/auth/colaborador-rotas.ts`; tudo fora dela é 403/redirect.
- Identidade e credencial de outra pessoa (e-mail de acesso, senha, telefone) **nunca** são alterados por script ou conveniência de teste.

---

## 7. Modelo de dados

### 7.1 Hoje (`EXISTE`) — 57 tabelas em `src/lib/server/schema.ts`, 86 migrações aplicadas

Grupos e tabelas centrais (nomes como no banco):

| Grupo               | Tabelas                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identidade e acesso | `policiais` (cargo `DPC\|OIP`, CPF cifrado + `cpf_index`, papel, `primeiro_acesso`), `administradores`, `colaboradores` (e-mail único = login, CPF cifrado + índice, `ativo`), `sessoes` (tipo `policial\|admin\|colaborador`), `dois_fatores_tokens`, `reset_senha_tokens`, `credenciais_webauthn`, `webauthn_desafios`, `passkey_reposicao`, `login_attempts`, `recovery_attempts`, `aceites_termos` |
| Estrutura           | `unidades` (tipo `departamento\|sub_departamento\|seccional\|delegacia`, `seccional_id` = pai, `sigla` única quando não vazia, flags plantão/expediente/FDS), `municipios` (5.571, IBGE, lat/lon), `feriados` (nacionais 2026–2030), `tempos_municipios` (16.836 pares), `distancias_municipios`                                                                                                       |
| Servidores — RH     | `cadastro_solicitacoes` (campo a campo), `policial_acao_solicitacoes` (movimentação, afastamento, desvinculação; NUP, datas, PDF no R2), `policial_historico` (linha do tempo; tipos movimentação, afastamento, desvinculação, edição, papel)                                                                                                                                                          |
| Escalas             | `escalas`, `escala_policiais`, `escala_documentos`, `escala_solicitacoes_assinatura`, `assinatura_intencoes`, `assinatura_reauth`                                                                                                                                                                                                                                                                      |
| Operações           | `planos_operacionais`, `plano_equipes`, `plano_equipe_membros`, `plano_opcoes`, `operacoes`, `operacao_linha_base`, `gise_*` (escalas, seccionais, equipes, membros, documentos, modelo/respostas de formulário, presenças, termos, assinaturas de relatórios), `base_equipe_pendencias`                                                                                                               |
| Financeiro (base)   | `custo_parametros` (valores de hora extra e diária, **append-only**, versionados)                                                                                                                                                                                                                                                                                                                      |
| Plataforma          | `configuracoes`, `audit_log` (encadeado), `audit_checkpoints`, `audit_pendencias`, `app_log`, `lgpd_incidentes`, `lgpd_solicitacoes`, `webhook_nonces`                                                                                                                                                                                                                                                 |

### 7.2 Planejado — por migração

| Migração                       | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Fase | Decisões      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------- |
| `0084`                         | `unidades`: `endereco`, `telefone`, `email`, `ais`, `tipo_plantao`, `plantao_semana_unidade_id`, `plantao_fds_unidade_id`, `nucleo_custodia`, `tira_gravame`, `xadrezes`, `xadrezes_obs`, `foto_key`; `unidade_municipios` (N:N); `municipios`: `area_km2`, `populacao`, `populacao_ano`; `municipio_cobertura` (AIS, responsável, plantão semana/FDS + tipo + obs, custódia, RISP, comando PM, batalhão PM, batalhão BM, companhia BM, PEFOCE, macrorregião) | 2    | E14, E15, E16 |
| `0085`                         | `designacoes` (parametrizada); `policiais`: cargo **fica `DPC\|OIP`** (E31), `data_posse`, `data_nascimento`, `designacao_id`, `foto_key`; `policial_ferias` (exercício, NUP, divisão 30/10-10-10/10-20/20-10/15-15/livre, abono 0–10 dias, deslocamento); `policial_historico.tipo` + `legado`, `abono`; `SUBTIPOS_AFASTAMENTO` de 5 para 19                                                                                                                 | 2    | E18, E22      |
| `0086`                         | `propostas_alteracao` (entidade `unidade\|patrimonio`, campo, valores, status, decisor) — generalização de `cadastro_solicitacoes`; decisão de migrar a de policiais fica registrada na fase 2                                                                                                                                                                                                                                                                | 2    | E6            |
| `0087`                         | `colaboradores` reconstruída: CPF obrigatório e único (login por CPF)                                                                                                                                                                                                                                                                                                                                                                                         | 3    | E10           |
| `0088`                         | `patrimonio_tipos`, `patrimonio_itens`, `patrimonio_movimentos`                                                                                                                                                                                                                                                                                                                                                                                               | 4    | E22, E34      |
| `0089+`                        | módulo de diárias (plano de 72 decisões, renumerado)                                                                                                                                                                                                                                                                                                                                                                                                          | 5    | E8            |
| fase 1 (sem migração de dados) | `unidades.tipo` ganha os tipos do organograma (`delegacia_geral`, `diretoria`, `coordenadoria`, `corregedoria`, `celula`, `secao`, `nucleo`, `unidade`), `abrangencia` (`departamental\|corporativa`), `caminho` materializado; `seccional_id` documentado como `pai_id`                                                                                                                                                                                      | 1    | E23, E24, E26 |

### 7.3 A árvore de unidades (regra que tudo consome)

- Uma só árvore, um só deploy para a corporação (E28). Raiz = Delegacia-Geral.
- **Departamento é dado, nunca constante** (E19; decisão 17 de diárias). Timbre, sigla do indexador, cargo por extenso do subscritor: tudo sobe a árvore a partir da unidade.
- `departamentoDe(unidade)` = ancestral do tipo departamento. Departamento especializado liga delegacia direto, sem seccional — resolvedor de escopo **anda a árvore**, não conta níveis.
- Referências fixas a "DPI SUL" ou "Seccional do Interior Sul" que ainda existem no código (10 ocorrências no painel, `institucional.ts`) saem na fase 1.

---

## 8. Integrações entre módulos

Integração aqui é **por dados**, não por chamada entre módulos: um módulo lê a tabela que o outro escreve, dentro da mesma transação D1.

| De → para                                                                     | O que passa                                                                                                                                                                                                                                                                 | Estado                                 |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Estrutura (`unidades`, árvore) → todos                                        | escopo de autorização, timbre, sigla, departamento derivado                                                                                                                                                                                                                 | EXISTE                                 |
| Servidores (`policiais`, afastamentos) → Escalas, Operações, Diárias, painéis | quem pode ser escalado; status vigente (Ativo/Afastado/Deslocado, calculado — E18); efetivo por cargo                                                                                                                                                                       | EXISTE (parcial) / PLANEJADO           |
| Municípios (`municipios`, `tempos_municipios`, `feriados`) → Diárias          | destino, tempo de trajeto, dias úteis; cobertura → ficha da delegacia e painéis                                                                                                                                                                                             | EXISTE (dados) / PLANEJADO (cobertura) |
| Operações (plano operacional, Frequência/PGTO) → Financeiro/Diárias           | **rito de operação**: a Frequência devolvida origina o pedido; origem do beneficiário é a **equipe** do plano (decisão 53); PGTO decide quem entra (54); retirar/substituir pela Frequência (51). Só a Frequência nasce no plano; Requerimento e Despacho nascem em diárias | PLANEJADO (fase 5) — regra fechada     |
| Financeiro → Valores (`custo_parametros`) → Operações, Diárias, Extras        | valores versionados de hora extra e diária; o documento grava qual versão usou; base de Extras e Diárias (E33)                                                                                                                                                              | EXISTE                                 |
| Escalas (furo por afastamento → cobertura) → Financeiro/Extras                | origem natural das horas extras                                                                                                                                                                                                                                             | PLANEJADO (fase 6, a avaliar — E7)     |
| Delegacias ↔ Patrimônio                                                       | itens por unidade; contagens na ficha                                                                                                                                                                                                                                       | PLANEJADO (fase 4)                     |
| Todos → Relatórios                                                            | dashboard estratégico e relatórios cruzados, somente leitura, por escopo                                                                                                                                                                                                    | PLANEJADO (fase 6)                     |
| Todos → Auditoria (`audit_log` encadeado)                                     | toda ação material auditada com ator, alvo, antes/depois quando cabe; catálogo de ações mantido                                                                                                                                                                             | EXISTE                                 |
| Todos → E-mail                                                                | notificações e 2FA por `email.ts` (layout único, goldens)                                                                                                                                                                                                                   | EXISTE                                 |
| Todos → R2                                                                    | documentos assinados, portarias, fotos                                                                                                                                                                                                                                      | EXISTE / PLANEJADO (fotos)             |
| RH da PCCE ↔ Servidores                                                       | **futuro** (E29): só após o sistema rodando e aprovado; degraus importação → sincronização → mão dupla                                                                                                                                                                      | FORA DO HORIZONTE                      |

### 8.1 Views (painéis) e sua relação com os módulos

- Painéis são **somente leitura** e **todo cartão leva ao módulo** onde o dado se corrige ou se propõe (E17). Painel não edita.
- Números agregados são calculados no servidor (`load()` com `COUNT`/`GROUP BY` dentro do escopo), nunca no navegador a partir da lista inteira.
- Filtros são parâmetros de URL (um painel filtrado é um link).
- O mesmo painel serve a unidade, seccional, departamento e corporação; o que muda é o escopo devolvido. Filtro "departamento" só aparece quando há mais de um.
- "O que este perfil vê" é regra em `.ts` puro e testado (`menu-visibilidade.ts`, `bem-vindo-cards.ts` e os que vierem), nunca só em `.svelte`.
- Alertas (calculados, sem tabela): retorno de afastamento em ≤ 5 dias; posse ≤ 30 dias; propostas pendentes; propostas rejeitadas sem correção.
- Indicadores padrão (E36): **período homólogo** (compara com o mesmo período do ano anterior, fechado) e **unidade zerada** (unidade sem registro no período aparece destacada, não some).

---

## 9. Identidade visual

### 9.1 Hoje (`EXISTE`) — `src/theme.css`, tema `policial`

| Token                                               | Valor                                                                                                                    | Uso                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `--color-primary-500`                               | `oklch(67% 0.17 210°)` (azul-petróleo)                                                                                   | ação principal      |
| `--color-surface-50 … 950`                          | `oklch(98% 0.005 255°) … oklch(17% 0.025 255°)`                                                                          | fundos claro/escuro |
| `--color-success-500` / `warning-500` / `error-500` | `oklch(62% 0.16 140°)` / `oklch(69% 0.18 80°)` / `oklch(58% 0.2 15°)`                                                    | estados             |
| Fontes                                              | **Inter** (corpo, 400/500/600/700) e **Outfit** (títulos, 500/700/800), **self-hosted** — a CSP não admite fonte externa |                     |
| Modo                                                | claro e escuro (`dark:`)                                                                                                 |                     |

### 9.2 Alvo (`PLANEJADO`, fase 1) — paleta do Ecossistema (E2)

Origem: `style.css` do protótipo (40 variáveis). Portada para tokens do tema; componentes continuam os do Escalas (README §10).

| Papel                        | Escuro                            | Claro                  | Destino no tema                                         |
| ---------------------------- | --------------------------------- | ---------------------- | ------------------------------------------------------- |
| Fundo principal              | `#0b0f19`                         | `#f1f5f9`              | `surface-950` / `surface-50`                            |
| Fundo secundário             | `#131b2e`                         | `#ffffff`              | `surface-900` / branco                                  |
| Cartão                       | `rgba(30,41,59,.45)` translúcido  | `rgba(255,255,255,.8)` | utilitário `card-glass` (hoje existe `card-glass-auth`) |
| Borda                        | `rgba(255,255,255,.08)`           | `rgba(15,23,42,.08)`   | `border-surface-*`                                      |
| Primária                     | `#3b82f6` (hover `#2563eb`)       | idem                   | `primary-500/600` — **substitui o azul-petróleo atual** |
| Texto principal / secundário | `#f8fafc` / `#94a3b8`             | `#0f172a` / `#64748b`  | `surface-50/400` e `surface-950/500`                    |
| Sucesso / alerta / erro      | `#10b981` / `#f59e0b` / `#ef4444` | idem                   | `success/warning/error-500`                             |
| Sombra                       | `0 8px 32px rgba(0,0,0,.37)`      | —                      | utilitário                                              |
| Transição                    | `all .3s cubic-bezier(.4,0,.2,1)` | —                      | utilitário                                              |
| Fonte                        | Inter                             | Inter                  | corpo Inter; títulos: decidir na fase 1 se Outfit fica  |

Regras visuais que não mudam: cores, tipografia, modais, botões, z-index e tabelas seguem o README §10 — **não reinventar tokens nem classes à mão**; SweetAlert2 do protótipo não entra; ícones Lucide.

---

## 10. Ambientes, infraestrutura e segredos

| Ambiente | Onde                                                                   | Banco                                                                                                                         | Bucket                 | Como chega                                 |
| -------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------ |
| Local    | `npm run dev` → http://localhost:5173 (IPv6; `127.0.0.1` não responde) | SQLite do Miniflare em `.wrangler/state/v3/d1/…` — **espelho da produção**, recarregado por `C:\Ecossistema-PCCE\04-espelho\` | emulado                | atalho "Escalas local" na área de trabalho |
| Staging  | Pages, branch `staging`                                                | `escalas-db-staging`                                                                                                          | `escalas-docs-staging` | push em `staging`                          |
| Produção | Pages, branch `main`                                                   | `escalas-db`                                                                                                                  | `escalas-docs`         | merge em `main`                            |

- Variáveis: fonte autoritativa em `.env.example`; local em `.dev.vars` (não versionado); produção em Pages → Environment variables. **Segredos nunca entram no repositório nem neste documento.**
- Chaves criptográficas (pepper de senha, CPF, IP de auditoria, cadeia de auditoria): **novas por conta/ambiente** (E12); dado cifrado não migra entre contas.
- E-mail exige domínio verificado (Cloudflare Email Sending ou Resend).
- Trust store ICP-Brasil: popular antes do primeiro deploy (DEPLOY.md §Trust Store); Action mensal abre PR de atualização.
- Backup: Action diária do D1 (`backup-d1.yml`); retenção LGPD (`cleanup-retencao.yml`).
- Conta própria (fase 0): passo a passo no plano §10.

---

## 11. Índice de decisões

- **Diárias 1–72**: `Plano-Modulo-Diarias-DPI-SUL.docx` §2. As mais citadas: 17 (departamento é dado), 51/53/54 (rito de operação), 60 (sem homologador — analista decide, autoridade assina), 61 (escopo da designação = unidade e tudo abaixo), 65 (timbre sobe a árvore), 68 (beneficiário externo por `cpf_index`), 69 (cargo por extenso), 70 (sigla única), 71 (login do colaborador — **revisada por E10**), 72 (Admin Geral designa).
- **Ecossistema E1–E30**: `Plano-Ecossistema-PCCE-v2.docx` §3 e §14.

| Nº  | Decisão (resumo)                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| E1  | Escalas é a base; Ecossistema dá forma, visual e três domínios                                                            |
| E2  | Visual do Ecossistema portado para Tailwind/Skeleton; componentes do Escalas                                              |
| E3  | Módulos e submódulos por pasta de rota; módulo novo = pasta + cartão + flags                                              |
| E4  | Hierarquia atual permanece; chefes = admins                                                                               |
| E5  | Admin Geral homologa e altera direto                                                                                      |
| E6  | Propostas para servidores, delegacias, material; municípios só Admin Geral/Super Admin                                    |
| E7  | Escala de plantão fica como está                                                                                          |
| E8  | Diárias mantém as 72 decisões; vira `/financeiro/diarias`                                                                 |
| E9  | Operações = plano operacional + GISE; Financeiro = Diárias + Cota                                                         |
| E10 | Terceirizado entra por CPF; desativável                                                                                   |
| E11 | Conta própria; repositório novo, não fork; cherry-pick seletivo do atual                                                  |
| E12 | Chaves criptográficas novas                                                                                               |
| E13 | Importação por script enquanto a planilha for fonte; corte único                                                          |
| E14 | Fotos para o R2                                                                                                           |
| E15 | Plantão por município: semana / FDS + tipo                                                                                |
| E16 | Área e população da planilha; atualizáveis pela API do IBGE por script                                                    |
| E17 | Todo cartão de painel leva ao módulo; painel não edita                                                                    |
| E18 | Status vigente do servidor é calculado                                                                                    |
| E19 | Departamento é dado (nada em constante)                                                                                   |
| E20 | Escalas e Operações não mudam de regra; goldens intactos                                                                  |
| E21 | (substituída por E30)                                                                                                     |
| E22 | Designações e tipos de material são cadastros parametrizados                                                              |
| E23 | Árvore completa do organograma; `seccional_id` = pai; caminho materializado                                               |
| E24 | Departamento do usuário é derivado; `buscarDepartamentoPadrao` sai                                                        |
| E25 | Um papel "administrador da unidade X" em qualquer nível; rótulo pelo tipo                                                 |
| E26 | Nível corporativo por `abrangencia = corporativa`; o que faz é por módulo                                                 |
| E27 | Super Admin continua técnico                                                                                              |
| E28 | Uma instância só; referências fixas viram dado; filtro por departamento                                                   |
| E29 | Integração com RH da PCCE é futura, após sistema rodando e aprovado                                                       |
| E30 | Nome "Ecossistema PCCE"                                                                                                   |
| E31 | Cargos são só DPC e OIP em todos os níveis; EPC/IPC viram OIP na importação                                               |
| E32 | Municípios separado de Delegacias; visível só de departamento para cima                                                   |
| E33 | Financeiro agrupa tudo que é dinheiro: Diárias, Extras, Atualização de Valores (o `config-custos`, aberto ao Admin Geral) |
| E34 | Material chama-se Patrimônio (veículos, armas, algemas, móveis, computadores…)                                            |
| E35 | Relatórios é módulo próprio (dashboard estratégico, relatórios cruzados)                                                  |
| E36 | Dado sensível fora do escopo é mascarado; período homólogo e unidade zerada são indicadores padrão                        |
| E37 | Prisões é módulo futuro, sem fase (24 colunas documentadas no App de Prisões)                                             |
| E38 | Domínio `dpisul.com.br` (vence 12/09/2028) — `APP_ORIGIN` e e-mail                                                        |

---

## 12. Dados sensíveis e LGPD

- CPF: cifrado (`CPF_ENCRYPTION_KEY`) + índice cego (`CPF_INDEX_KEY`) para busca; nunca em claro em log, auditoria, URL ou documento além do necessário.
- IP: cifrado na auditoria (`AUDIT_IP_ENCRYPTION_KEY`).
- Auditoria: append-only, encadeada por `AUDIT_CHAIN_KEY`; `dados_antes/depois` guardam o que identifica, não o que expõe (sem senha, sem CPF).
- Anexo sem referência (portaria de proposta recusada) é apagado do R2 — dado pessoal sem base não fica guardado.
- Planilhas de importação com CPF ficam **fora do repositório** (`C:\Ecossistema-PCCE\03-dados\`), nunca em `C:\escalas`.
- Testes e ambiente local não alteram e-mail, senha ou telefone de ninguém.

---

## 13. Fases (ordem e dependências)

| Fase | Entrega                                                                                                   | Depende de                          |
| ---- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 0    | Infra na conta própria; primeiro deploy do sistema como está                                              | —                                   |
| 1    | Casca + visual; rotas novas com 301; árvore completa; departamento derivado; referências fixas viram dado | 0                                   |
| 2    | Servidores, Delegacias, Municípios (0084–0086), painéis, alertas, importação                              | 1                                   |
| 3    | Colaboradores por CPF (0087), designações                                                                 | 1                                   |
| 4    | Patrimônio (0088)                                                                                         | 2 + dados do usuário                |
| 5    | Financeiro → Diárias (0089+)                                                                              | 2, 3                                |
| 6    | Operações (só endereço, feito na 1), Extras (plano próprio) e Relatórios                                  | 2, 5                                |
| 7    | RH (futuro)                                                                                               | sistema aprovado; acordo COGEP/CTIC |

Toda fase: autorização expressa → PRs pequenos e sequenciais → CI local antes do push → conferência de tela pelo responsável antes do PR → docs vivos no mesmo PR.

---

## 14. Glossário

| Termo                      | Significado                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| PCCE                       | Polícia Civil do Estado do Ceará                                                                                                               |
| DPI SUL / DPI Norte        | Departamento de Polícia do Interior Sul / Norte                                                                                                |
| DPC, OIP                   | Delegado de Polícia Civil, Oficial Investigador de Polícia Civil — os dois únicos cargos do sistema (E31); Escrivão e Inspetor entram como OIP |
| Classe                     | 1ª, 2ª, 3ª… / A–D — progressão na carreira                                                                                                     |
| Designação                 | função exercida na unidade (Delegado Titular, Operacional, Chefe de seção…)                                                                    |
| Seccional                  | unidade intermediária entre departamento e delegacias (regional)                                                                               |
| AIS                        | Área Integrada de Segurança                                                                                                                    |
| RISP                       | Região Integrada de Segurança Pública                                                                                                          |
| CRPM, BPM, BBM, CIA        | Comando Regional / Batalhão da PM; Batalhão / Companhia dos Bombeiros                                                                          |
| PEFOCE                     | Perícia Forense do Ceará (núcleo regional)                                                                                                     |
| Núcleo de custódia         | unidade que recebe presos da delegacia                                                                                                         |
| Tira-gravame               | serviço de baixa de gravame veicular na delegacia                                                                                              |
| Xadrez                     | cela na delegacia                                                                                                                              |
| Plantonista                | delegacia que responde pelo plantão de um município (semana / fim de semana; físico, misto, virtual)                                           |
| GISE                       | Gestão Integrada de Serviço Extraordinário — módulo de escalas extraordinárias com presença e relatório                                        |
| Plano operacional          | planejamento de operação com equipes, custos e Frequência                                                                                      |
| Frequência / PGTO          | documento de presença da operação; PGTO = marcação de pagamento que define quem entra na diária                                                |
| NUP                        | Número Único de Protocolo (processo)                                                                                                           |
| Portaria                   | ato administrativo (movimentação, afastamento…), anexado em PDF                                                                                |
| Colaborador / terceirizado | identidade sem matrícula, designada pelo Admin Geral para funções de apoio                                                                     |
| Propor → homologar         | fluxo em que admin de unidade/seccional propõe e o Admin Geral decide                                                                          |
| Golden                     | arquivo de referência (PDF/e-mail) que o teste compara byte a byte                                                                             |
| Guard                      | script do CI que reprova violação de uma regra do projeto                                                                                      |
| Miniflare                  | emulador local da Cloudflare usado pelo `wrangler dev`                                                                                         |

---

## 15. Pendências que afetam desenvolvimento

| Pendência                                                                                                                       | Quem           | Bloqueia                                         |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------ |
| Cortes/ajustes no plano do Ecossistema                                                                                          | Erlon          | fase 0                                           |
| Cartão na Cloudflare (R2) — aceito; domínio `dpisul.com.br` registrado, falta apontar o DNS para a Cloudflare                   | Erlon + fase 0 | fase 0                                           |
| Vencimento do domínio 12/09/2028 — lembrete em 08/2028 e renovação automática no Registro.br                                    | Erlon          | —                                                |
| Lista de designações                                                                                                            | Erlon          | fase 2 (nasce parametrizada; importa o que vier) |
| Tipos e dados de patrimônio                                                                                                     | Erlon          | fase 4                                           |
| Planilha de servidores do Apps Script                                                                                           | Erlon          | importação da fase 2                             |
| Título com Outfit ou só Inter                                                                                                   | fase 1         | visual                                           |
| Migrar `cadastro_solicitacoes` para `propostas_alteracao` ou manter as duas                                                     | fase 2         | modelo                                           |
| Material em `C:\Ecossistema-PCCE\referencia_leitura\` é possivelmente desatualizado: **perguntar ao responsável antes de usar** | todos          | —                                                |

---

## 16. Histórico deste documento

| Versão | Data       | O que mudou                                                                                                                                                                                                                               |
| ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0    | 12/09/2026 | Criação, a partir do estado do repositório (`main` em `e9123c28`, migração 0083) e do plano do Ecossistema v2 (E1–E30)                                                                                                                    |
| 1.1    | 12/09/2026 | Rodada da tarde: E31–E38 (cargos DPC/OIP, Municípios separado e de departamento para cima, Financeiro agrupa Diárias/Extras/Valores, Patrimônio, Relatórios, regras de painel do App de Prisões, Prisões futuro, domínio `dpisul.com.br`) |
