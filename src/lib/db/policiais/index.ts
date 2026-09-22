/**
 * Fachada da camada de dados do POLICIAL — o cadastro e o que orbita a
 * identidade dele.
 *
 * Um módulo por assunto, porque as quatro perguntas são independentes:
 *  - `cadastro.ts` — CRUD, lotações, promoção (RBAC);
 *  - `historico.ts` — a linha do tempo funcional, incluindo `afastamentoVigente`
 *    (o predicado que decide se o policial pode ser escalado hoje);
 *  - `exclusao.ts` — o impedimento de excluir quem tem vínculo ASSINADO, que é
 *    regra de integridade documental, não de cadastro;
 *  - `solicitacoes.ts` — os pedidos de correção de CAMPO do cadastro, feitos
 *    pelo administrador de seccional/unidade, e a decisão do Admin Geral;
 *  - `acao-solicitacoes.ts` — os mesmos pedidos, quando o que se pede é um ATO
 *    de RH (movimentar, afastar, desvincular). Vivem separados porque o formato
 *    é outro: datas, NUP e PDF anexo não cabem em `campo`/`valor_novo`.
 *
 * `atualizarPolicial` (cadastro) e `atualizarPolicialComHistorico` (histórico)
 * NÃO são intercambiáveis: a segunda grava o evento junto, na mesma transação.
 * Quem edita dado funcional pela UI usa a segunda.
 *
 * Até ago/2026 estes quatro viviam na raiz de `lib/db/` como `policiais.ts` +
 * `policial-*.ts` + `cadastro-solicitacoes.ts`, misturados a outros domínios —
 * o sintoma que o `CLAUDE.md` descreve para `lib/server/`.
 */
export {
	listarPoliciais,
	buscarPolicial,
	buscarPolicialPorMatricula,
	criarPolicial,
	upsertPolicial,
	atualizarPolicial,
	excluirPolicial,
	listarLotacoes,
	promoverPolicial
} from './cadastro';

export {
	registrarHistorico,
	atualizarPolicialComHistorico,
	listarHistoricoPolicial,
	buscarEventoHistorico,
	encurtarAfastamento,
	corrigirAfastamento,
	excluirAfastamento,
	afastamentoVigente
} from './historico';
export type { NovoEventoHistorico, CamposDoEventoFuncional } from './historico';

export { listarDesignacoes, designacaoAtiva, motivoParaRecusarDesignacao } from './designacoes';

export {
	listarFeriasDoPolicial,
	buscarFracao,
	registrarProgramacao,
	excluirProgramacao,
	corrigirFracao,
	abrirReprogramacao,
	anotarNupDaReprogramacao,
	decidirReprogramacao,
	registrarAbono,
	darCienciaDoAbono,
	pendenciasDeFerias,
	contagemParaTeto,
	pendenciasDeFeriasPorLotacao,
	abonosVigentesDe,
	feriasDoAno
} from './ferias';
export type { FracaoCompleta, FeriasDoPolicial, PendenciasDeFerias, FeriasNoMes } from './ferias';
export type { DesignacaoDaTela } from './designacoes';

export { impedimentoParaExcluirPolicial } from './exclusao';

export {
	criarSolicitacoesCadastro,
	listarSolicitacoesDoPolicial,
	listarSolicitacoesCadastroPendentes,
	decidirSolicitacaoCadastro
} from './solicitacoes';
export type { CampoSolicitacao, MudancaSolicitada } from './solicitacoes';

export {
	criarSolicitacaoAcao,
	listarSolicitacoesAcaoDoPolicial,
	listarSolicitacoesAcaoPendentes,
	buscarSolicitacaoAcao,
	fecharSolicitacaoAcao
} from './acao-solicitacoes';
export type { NovaAcaoSolicitada } from './acao-solicitacoes';
