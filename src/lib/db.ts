/**
 * Ponto central de acesso ao banco — a API que rotas e endpoints consomem
 * (`import { ... } from '$lib/db'`).
 *
 * Módulos internos (`src/lib/db/`):
 *  - `core.ts`       — `getDB`, bindings R2 e o tipo `Database`
 *  - `unidades.ts`   — unidades e a hierarquia entre elas
 *  - `escalas.ts`    — escalas e `escala_policiais`
 *  - `documentos.ts` — documentos assinados
 *  - `webauthn.ts`   — credenciais de passkey da assinatura avançada
 *  - `colaboradores.ts` — a terceira identidade (servidora/terceirizada), só cadastro
 *  - `policiais/`    — cadastro, RBAC, histórico funcional e exclusão
 *  - `lgpd/`         — solicitações do titular, incidentes e retenção
 *  - `gise/`         — o módulo GISE inteiro
 *  - `audit/`, `operacoes/` — trilha forense e operações extraordinárias
 *
 * **Regra do barrel:** aqui ficam as FUNÇÕES da camada de dados e só os TIPOS
 * que alguém realmente importa por este caminho. Tipo consumido por um módulo
 * só deve vir do módulo de origem — a dependência fica explícita, e o barrel
 * não vira uma segunda lista para manter em dia. Em jul/2026, 16 tipos
 * reexportados aqui não tinham um único consumidor pelo barrel e saíram.
 */

export {
	getDB,
	getR2,
	tryGetR2,
	hasR2,
	batchNonEmpty,
	linhasAfetadas,
	likeContains,
	likePrefix
} from './db/core';
export type { Database } from './db/core';

export {
	auditar,
	registrarAuditComContexto,
	contextoDeEvento,
	listarAuditLog,
	resumoAuditoria,
	eventosCriticosRecentes,
	buscarAuditLog,
	cabecaCadeiaAudit,
	verificarIntegridadeAudit,
	metaDaAcao,
	CATALOGO_ACOES
} from './db/audit';
export type { AuditCriptoEnv } from './db/audit';

export { registrarAppLogs, listarAppLogs, resumoAppLogs } from './db/app-logs';

export { registrarAceite } from './db/termos';

export {
	listarColaboradores,
	buscarColaborador,
	buscarColaboradorAtivoPorEmail,
	criarColaborador,
	definirColaboradorAtivo,
	normalizarEmailColaborador
} from './db/colaboradores';
export type { ColaboradorResumo, NovoColaborador } from './db/colaboradores';

export {
	buscarCredencialAtiva,
	buscarCredencialPorId,
	listarCredenciaisDoDono,
	registrarCredencial,
	revogarCredenciaisAtivas,
	excluirCredenciaisDoDono,
	registrarUsoCredencial,
	criarDesafioWebauthn,
	consumirDesafioWebauthn
} from './db/webauthn';
export type { CredencialWebauthn, CredencialWebauthnResumo, DonoCredencial } from './db/webauthn';

export {
	buscarConfiguracao,
	salvarConfiguracao,
	buscarExigirFotoAssinatura,
	buscarExigirGpsAssinatura,
	buscarExigirCodigoEmailAssinatura,
	buscarRestringirSmartphone,
	buscarExigirPasskeyAssinatura,
	buscarProvedorEmailPadrao,
	EMAIL_PROVEDOR_PADRAO
} from './db/configuracoes';
export type { EmailProvedor } from './db/configuracoes';

export {
	vincularAdminGeral,
	desvincularAdminGeral,
	ehAdminGeralVinculado,
	buscarAdminVinculadoPorPolicial,
	buscarModulosAdminVinculado,
	atualizarModuloAdminVinculado
} from './db/admin-vinculado';
export type { ModulosAdmin, ResultadoToggleModulo } from './db/admin-vinculado';

export {
	listarPoliciais,
	buscarPolicial,
	buscarPolicialPorMatricula,
	criarPolicial,
	atualizarPolicial,
	excluirPolicial,
	listarLotacoes,
	promoverPolicial,
	criarSolicitacoesCadastro,
	listarSolicitacoesDoPolicial,
	listarSolicitacoesCadastroPendentes,
	decidirSolicitacaoCadastro,
	criarSolicitacaoAcao,
	listarSolicitacoesAcaoDoPolicial,
	listarSolicitacoesAcaoPendentes,
	buscarSolicitacaoAcao,
	fecharSolicitacaoAcao,
	registrarHistorico,
	atualizarPolicialComHistorico,
	listarHistoricoPolicial,
	buscarEventoHistorico,
	afastamentoVigente
} from './db/policiais';
export type {
	CampoSolicitacao,
	CamposDoEventoFuncional,
	MudancaSolicitada,
	NovaAcaoSolicitada,
	NovoEventoHistorico
} from './db/policiais';

export {
	listarUnidades,
	listarTodasUnidades,
	criarUnidade,
	atualizarUnidade,
	motivoParaRecusarSuperior,
	definirUnidadeAtiva,
	vinculosDaUnidade,
	descreverVinculosUnidade,
	buscarSeccionaisUnidades,
	buscarDepartamentoPadrao,
	arvoreUnidades,
	ancestraisDe,
	subarvoreDe,
	departamentoDe,
	type NoUnidade,
	type Departamento
} from './db/unidades';

export {
	listarEscalas,
	buscarEscala,
	criarEscala,
	excluirEscala,
	verificarEscalaExistente,
	marcarVisto,
	finalizarEscalaFDS,
	desfinalizarEscalaFDS,
	adicionarMultiplasDatasPlantao,
	inserirPoliciaisEscalaEmLotes,
	adicionarTodosPoliciais,
	listarPoliciaisEscala,
	listarPoliciaisEscalaQuery,
	criarSolicitacaoAssinatura,
	buscarSolicitacaoAssinatura,
	excluirSolicitacaoAssinatura,
	listarSolicitacoesEscalas,
	temSolicitacaoParaDpcAdmin
} from './db/escalas';

export {
	salvarDocumentoEscala,
	buscarDocumentoEscala,
	excluirDocumentoEscala,
	buscarDocumentoPorHash
} from './db/documentos';
export type { AssinaturaPasskeyMetadata } from './db/documentos';
export { passkeyMetaDeAssercao, circunstanciaDePersistir } from './db/documentos';

export type { GiseDetalhado } from './db/gise';
export {
	listarGiseEscalas,
	buscarGiseEscala,
	criarGiseEscala,
	buscarGiseDetalhado,
	buscarGiseDetalhadoEmLote,
	atualizarGiseEscala,
	finalizarGiseEscala,
	upsertGiseSeccional,
	atualizarGiseSeccional,
	excluirGiseSeccional,
	atualizarGiseEquipe,
	excluirGiseEquipe,
	criarGiseEquipe,
	reabrirGiseEscala,
	revogarAssinaturasSeccional,
	adicionarGiseMembro,
	removerGiseMembro,
	verificarGiseCompleta,
	clonarGiseParaData,
	verificarSlotEquipe,
	verificarConflitoMembroGise,
	verificarConflitoHorarioPolicial,
	verificarConflitoHorarioPorGise,
	buscarRespostasProdutividadeSeccional,
	salvarGiseDocumento,
	buscarGiseDocumento,
	isSupervisorGiseAtiva,
	isMembroGiseAtiva,
	isSupervisaoGiseAtiva,
	temGiseHistorico,
	temPresencaGisePendente,
	buscarGiseModeloFormulario,
	salvarGiseModeloFormulario,
	salvarOrdemPainelProdutividade,
	buscarRespostaGise,
	salvarRespostaGise,
	listarTodasRespostasGise,
	salvarEntradaGise,
	salvarSaidaGise,
	buscarPresencasGise,
	buscarAssinaturasRelatoriosGise,
	buscarAssinaturaRelatorioGise,
	salvarAssinaturaRelatorioGise,
	salvarTermoPresencaGise,
	buscarTermosPresencaGise,
	buscarTermoPresencaGise,
	resolverParticipacaoGisePolicial,
	horarioGiseLiberado,
	verificarSaidaCompletaSeccional,
	sincronizarStatusGiseAposPresencaRelatorios,
	tentarPromoverGiseProntaParaFinalizar,
	buscarGiseSeccionalMembros,
	adicionarGiseSeccionalUnidade,
	atualizarGiseSeccionalUnidade,
	removerGiseSeccionalUnidade,
	buscarVagasPadraoEquipesGise,
	salvarVagasPadraoEquipesGise,
	DEFAULT_SEINT_QUESTIONS,
	DEFAULT_QUESTIONS_FORM_OPERACIONAL
} from './db/gise';

export {
	TIPOS_EQUIPE,
	NOME_OPERACAO_PADRAO,
	tiposEquipeDaOperacao,
	operacaoAceitaTipoEquipe,
	normalizarTiposEquipe,
	listarOperacoes,
	buscarOperacao,
	buscarOperacaoPorNome,
	buscarOperacaoDaEscala,
	criarOperacao,
	atualizarOperacao,
	definirAtivoOperacao,
	excluirOperacao,
	contarEscalasPorOperacao,
	clonarModelosFormulario,
	listarLinhaBase,
	mapaLinhaBaseDaUnidade,
	upsertLinhaBase,
	unidadesParticipantesDaOperacao
} from './db/operacoes';
export type { TipoEquipeOperacao } from './db/operacoes';

export {
	criarPlano,
	buscarPlano,
	buscarPlanoPorNumero,
	listarPlanos,
	atualizarPlano,
	excluirPlano,
	criarEquipes,
	listarEquipes,
	buscarEquipe,
	atualizarEquipe,
	excluirEquipe,
	renumerarEquipes,
	nomePadraoEquipe,
	janelaDaEquipe,
	briefingDaEquipe,
	destinoDaEquipe,
	origemDaEquipe,
	listarMunicipios,
	matrizDoPlano,
	distanciaEntreMunicipios,
	procedenciaDaMedicao,
	listarOpcoes,
	opcoesDoPlano,
	valorPadrao,
	adicionarOpcao,
	definirOpcaoPadrao,
	removerOpcao,
	adicionarMembro,
	removerMembro,
	definirChefe,
	limparChefe,
	listarMembrosDoPlano,
	agruparPorEquipe,
	ressincronizarSnapshots,
	buscarCustoParametrosVigente,
	buscarCustoParametros,
	listarCustoParametros,
	criarCustoParametros,
	valoresDe,
	regrasDe,
	lancamentosMensais,
	piorExtratoDaEquipe
} from './db/planos';
export type { PlanoDaLista, MembroDoPlano, TipoOpcao } from './db/planos';
