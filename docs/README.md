# Índice da Documentação

Mapa de toda a documentação do projeto, separada em **documentos vivos** (mantidos atualizados — se o código mudar, eles mudam junto) e **registros históricos** (fotografias de auditorias/decisões em uma data específica — arquivados no histórico do Git e catalogados em [`HISTORICO.md`](HISTORICO.md)).

## Documentos vivos

| Documento                                                                                             | Conteúdo                                                                                                                                                                                                                             | Público-alvo                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| [`README.md`](../README.md) (raiz)                                                                    | Visão geral, stack, setup local, arquitetura, módulos, padrões de código, troubleshooting                                                                                                                                            | Qualquer dev entrando no projeto      |
| [`DEPLOY.md`](../DEPLOY.md) (raiz)                                                                    | Runbook de produção: variáveis/secrets, papéis de admin, backup/rollback, staging, trust store ICP-Brasil, TSA, go-live                                                                                                              | Operador / responsável pelo deploy    |
| [`TESTING.md`](../TESTING.md) (raiz)                                                                  | Roteiro manual de **exceção** (hardware/ambiente real); o gate de regressão é a suíte automatizada — casos cobertos por spec estão anotados                                                                                          | QA / dev antes de release             |
| [`PARAMETROS.md`](PARAMETROS.md)                                                                      | **Parâmetros do sistema para desenvolvedores e IA**: identidade, stack, fluxo, módulos com estado EXISTE/PLANEJADO, perfis, modelo de dados, integrações, paleta, decisões E1–E38, glossário. Atualizado no mesmo PR de toda mudança | Dev / agente de IA / novo colaborador |
| [`CLAUDE.md`](../CLAUDE.md) (raiz)                                                                    | Diretrizes de código para agentes e devs: Svelte 5, erros de API, autorização, layout de `server/`, `api-fetch`, testes, goldens                                                                                                     | Dev / agente de IA                    |
| [`apostila/APOSTILA.md`](apostila/README.md)                                                          | Apostila de onboarding: domínio, stack, arquitetura, regras verificadas no CI, módulos e primeira contribuição (com `.docx` e `.pdf` gerados)                                                                                        | Dev entrando no projeto               |
| [`apostila/APOSTILA-IMPLANTACAO.md`](apostila/README.md)                                              | Apostila de implantação: infraestrutura Cloudflare, catálogo completo de variáveis/secrets com a consequência de cada ausência, GitHub Actions, primeiro deploy e go-live                                                            | Operador do deploy                    |
| [`QA_ASSINATURA_A3_DESKTOP.md`](QA_ASSINATURA_A3_DESKTOP.md)                                          | Roteiro de QA manual do fluxo de presença GISE por Token A3 (exige hardware; não roda em CI)                                                                                                                                         | QA com token físico                   |
| [`.env.example`](../.env.example) (raiz)                                                              | **Fonte autoritativa** de todas as variáveis de ambiente, comentadas                                                                                                                                                                 | Dev / operador                        |
| [`scripts/README.md`](../scripts/README.md)                                                           | Scripts utilitários (migrações, senhas) e setup detalhado da integração Google Sheets / Base_Equipe                                                                                                                                  | Operador                              |
| [`src/lib/server/assinatura/icp-brasil/README.md`](../src/lib/server/assinatura/icp-brasil/README.md) | Trust store ICP-Brasil: o que é, como atualizar (script Windows/Linux), frequência                                                                                                                                                   | Dev / operador                        |
| [`static/face-api/README.md`](../static/face-api/README.md)                                           | Modelos de reconhecimento facial servidos localmente e como atualizá-los                                                                                                                                                             | Dev                                   |

## Planos de produto em aberto

Decisões de produto ainda não executadas. Quando o comportamento correspondente
entrar no código, o plano vira registro histórico ([`HISTORICO.md`](HISTORICO.md))
e os documentos vivos (README/DEPLOY/TESTING/termo) atualizam no mesmo PR.

| Documento                                                | Conteúdo                                                                                              | Status                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`PLANO_CHAVE_ASSINATURA.md`](PLANO_CHAVE_ASSINATURA.md) | Chave de assinatura (passkey) em toda avançada; senha + 2FA + chave como piso; cadastro só no celular | 15/ago/2026 — fases 0–3 no código; fase 4 (trancar a flag) ainda não |

## Registros históricos e decisões arquivadas

Os relatórios de auditoria, as avaliações e os planos de produto já executados **não vivem mais no working tree** — a primeira leva saiu em 2026-07-20; as posteriores, na data da linha do catálogo. Continuam preservados no histórico do Git. O catálogo completo (o que cada um registra, quais achados vieram de cada um e o comando `git show` para lê-los) está em [`HISTORICO.md`](HISTORICO.md).

## Convenções

- **Novas auditorias** podem ser commitadas em `docs/auditorias/` (data no nome ou no cabeçalho) enquanto seus achados estão sendo tratados; quando encerradas, o arquivo é removido e catalogado no [`HISTORICO.md`](HISTORICO.md) — o histórico do Git mantém a rastreabilidade dos achados (A1–A8, I-1…I-4, M-3/M-4, R2-1…R2-4, B-1…B-6…) citados em comentários do código.
- `docs/auditorias/` está **vazia — nenhuma auditoria aberta**. A última,
  segurança de 21/ago (SEC-01…SEC-38), encerrou no mesmo ciclo e foi catalogada
  no [`HISTORICO.md`](HISTORICO.md): 20 remediados e 17 aceitos com registro, os
  de operação promovidos ao [`DEPLOY.md`](../DEPLOY.md). Antes dela, a de
  componentização (13/ago), também catalogada; e a visual (VIS-1…VIS-17), com o
  resíduo manual em [`TESTING.md`](../TESTING.md) §16, que é onde mora roteiro
  que a automação não alcança.
- **Auditoria não se arquiva pela data, e sim pelos achados.** Antes de remover
  o arquivo, reverifique cada achado contra o código e escreva o resultado no
  próprio documento; o que sobrar aberto continua no working tree. A de
  componentização de 13/ago passou seis dias na RAIZ do repositório, como
  `REVISAO-COMPONENTIZACAO.me` — fora da pasta, fora desta lista e com a
  extensão errada —, enquanto esta seção afirmava que não havia auditoria
  aberta. Auditoria fora de `docs/auditorias/` é auditoria que ninguém releva.
- Documentos **vivos** que ficarem defasados devem ser corrigidos no mesmo PR que muda o comportamento correspondente.
