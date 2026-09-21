/**
 * Barrel dos schemas Zod — o ÚNICO barrel que o projeto mantém de propósito.
 *
 * `$lib/utils/` não tem barrel (a regra está no `CLAUDE.md`: importe o módulo,
 * para o call site dizer de que assunto a função veio). Aqui é o contrário, e
 * a razão é o padrão obrigatório: rota de API valida com `validateBody(request,
 * xSchema)`, e um import por schema faria cada rota nova escolher entre
 * descobrir o arquivo certo ou copiar um schema parecido. O barrel é o que
 * mantém "usar schema" mais fácil que "não usar".
 *
 * Schema novo entra aqui junto com o arquivo — fora do barrel ele existe e
 * ninguém acha.
 */
export { policialSchema, policialUpdateSchema } from './policial';
export { escalaSchema, escalaPolicialSchema } from './escala';
export {
	loginSchema,
	alterarSenhaSchema,
	verificar2faSchema,
	reenviarCodigoSchema,
	solicitarRedefinicaoSchema,
	confirmarRedefinicaoSchema,
	emailRecuperacaoSchema,
	solicitarVerificacaoEmailSchema,
	confirmarVerificacaoEmailSchema,
	certificadoVerificarSchema,
	reautenticarAssinaturaSchema
} from './auth';
export { unidadeSchema } from './unidade';
export { colaboradorSchema } from './colaborador';
export {
	giseSignatureSchema,
	giseIdParamSchema,
	giseDownloadSchema,
	giseHistoricoExportQuerySchema,
	painelOrdemSchema
} from './gise';
export { assinaturaConfigSchema } from './config';
export { policialSearchQuerySchema } from './policial-search';
export {
	prepararAssinaturaSchema,
	finalizarAssinaturaEscalasSchema,
	finalizarAssinaturaGiseSchema,
	prepararPresencaSchema,
	finalizarPresencaSchema,
	assinarSimplesSchema,
	assinarPresencaAvancadaSchema,
	finalizarPasskeyEscalaSchema
} from './assinatura-pdf';
export {
	novoIncidenteSchema,
	atualizarIncidenteSchema,
	responderSolicitacaoSchema,
	novaSolicitacaoTitularSchema
} from './lgpd';
export { webauthnRegistroSchema } from './webauthn';
