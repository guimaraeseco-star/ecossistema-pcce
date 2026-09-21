/**
 * Catálogo central das ações auditáveis: cada ação carrega rótulo PT-BR,
 * categoria e severidade padrão.
 *
 * É DADO, não consulta — e é lido também pela UI (o console de auditoria monta
 * os filtros a partir daqui). Vive num arquivo próprio porque eram ~350 linhas
 * de tabela no meio do módulo que grava e lê a trilha: quem abria `audit.ts`
 * para mexer numa query passava por elas antes de chegar em qualquer código.
 *
 * Acrescentar ação é acrescentar linha AQUI. Ação usada sem estar no catálogo
 * cai no fallback de `metaDaAcao`, que a marca como desconhecida em vez de
 * inventar rótulo.
 */

// ---- Classificação ----------------------------------------------------------

export type AuditCategoria =
	| 'autenticacao'
	| 'escala'
	| 'gise'
	| 'policial'
	| 'unidade'
	| 'operacao'
	| 'configuracao'
	| 'documento'
	| 'lgpd'
	| 'sistema';

export type AuditSeveridade = 'info' | 'aviso' | 'critico';
export type AuditResultado = 'sucesso' | 'falha' | 'negado';
export type AuditActorTipo = 'policial' | 'admin' | 'colaborador' | 'sistema' | 'webhook';

interface AcaoMeta {
	label: string;
	categoria: AuditCategoria;
	severidade: AuditSeveridade;
}

/**
 * Catálogo central de ações auditáveis. Adicione AQUI ao instrumentar um novo
 * fluxo — o rótulo, a categoria e a severidade derivam deste mapa. A coluna
 * `acao` é texto livre no banco, então ações fora do catálogo ainda gravam
 * (com fallback em `metaDaAcao`), mas o ideal é mantê-las registradas aqui.
 */
export const CATALOGO_ACOES = {
	// Autenticação / sessão
	login: { label: 'Login', categoria: 'autenticacao', severidade: 'info' },
	logout: { label: 'Logout', categoria: 'autenticacao', severidade: 'info' },
	falha_login: { label: 'Falha de login', categoria: 'autenticacao', severidade: 'aviso' },
	login_bootstrap: {
		label: 'Login break-glass (Super Admin sem 2FA)',
		categoria: 'autenticacao',
		severidade: 'critico'
	},
	login_certificado: {
		label: 'Login por certificado A3',
		categoria: 'autenticacao',
		severidade: 'info'
	},
	alterar_senha: { label: 'Alteração de senha', categoria: 'autenticacao', severidade: 'aviso' },
	solicitar_redefinicao_senha: {
		label: 'Solicitação de redefinição de senha',
		categoria: 'autenticacao',
		severidade: 'info'
	},
	redefinir_senha: {
		label: 'Redefinição de senha concluída',
		categoria: 'autenticacao',
		severidade: 'aviso'
	},
	primeiro_acesso_link: {
		label: 'Link de primeiro acesso',
		categoria: 'autenticacao',
		severidade: 'info'
	},
	verificar_email_pessoal: {
		label: 'Verificação de e-mail pessoal',
		categoria: 'autenticacao',
		severidade: 'info'
	},
	alternar_modulo: {
		label: 'Alternância de módulo (GISE/Escalas)',
		categoria: 'autenticacao',
		severidade: 'info'
	},
	alternar_acesso: {
		label: 'Alternância de acesso (ADM Geral/Usuário)',
		categoria: 'autenticacao',
		severidade: 'info'
	},
	aceitar_termos: {
		label: 'Aceite do Termo de Uso',
		categoria: 'autenticacao',
		severidade: 'info'
	},

	// Policiais / RBAC
	criar_policial: { label: 'Criação de policial', categoria: 'policial', severidade: 'aviso' },
	editar_policial: { label: 'Edição de policial', categoria: 'policial', severidade: 'info' },
	excluir_policial: { label: 'Exclusão de policial', categoria: 'policial', severidade: 'critico' },
	mudar_papel: { label: 'Mudança de papel (RBAC)', categoria: 'policial', severidade: 'critico' },
	toggle_admin_geral: {
		label: 'Alteração de Admin Geral',
		categoria: 'policial',
		severidade: 'critico'
	},
	importar_policiais: {
		label: 'Importação de policiais em massa',
		categoria: 'policial',
		severidade: 'aviso'
	},
	registrar_movimentacao: {
		label: 'Movimentação de policial (transferência)',
		categoria: 'policial',
		severidade: 'aviso'
	},
	registrar_afastamento: {
		label: 'Registro de afastamento de policial',
		categoria: 'policial',
		severidade: 'info'
	},
	desvincular_policial: {
		label: 'Desvinculação (baixa) de policial',
		categoria: 'policial',
		severidade: 'critico'
	},

	// Colaboradores (terceira identidade — só o Super Admin cria e desativa)
	criar_colaborador: {
		label: 'Criação de colaborador',
		categoria: 'policial',
		severidade: 'aviso'
	},
	desativar_colaborador: {
		label: 'Desativação de colaborador',
		categoria: 'policial',
		severidade: 'aviso'
	},
	reativar_colaborador: {
		label: 'Reativação de colaborador',
		categoria: 'policial',
		severidade: 'aviso'
	},
	redefinir_senha_colaborador: {
		label: 'Senha provisória de colaborador',
		categoria: 'autenticacao',
		severidade: 'aviso'
	},
	// E61: lotação pelo Admin Geral, acessos pela unidade, e o relatório diário.
	lotar_colaborador: {
		label: 'Lotação de colaborador',
		categoria: 'policial',
		severidade: 'aviso'
	},
	definir_acessos_colaborador: {
		label: 'Acessos de colaborador definidos pela unidade',
		categoria: 'policial',
		severidade: 'aviso'
	},
	relatorio_colaboradores: {
		label: 'Relatório diário de colaboradores enviado',
		categoria: 'sistema',
		severidade: 'info'
	},

	// Unidades
	criar_unidade: { label: 'Criação de unidade', categoria: 'unidade', severidade: 'aviso' },
	editar_unidade: { label: 'Edição de unidade', categoria: 'unidade', severidade: 'info' },
	excluir_unidade: { label: 'Exclusão de unidade', categoria: 'unidade', severidade: 'critico' },

	// Operações extraordinárias (GISE, CRAJUBAR, EDGE…)
	criar_operacao: { label: 'Criação de operação', categoria: 'operacao', severidade: 'aviso' },
	editar_operacao: { label: 'Edição de operação', categoria: 'operacao', severidade: 'aviso' },
	ativar_operacao: { label: 'Reativação de operação', categoria: 'operacao', severidade: 'aviso' },
	desativar_operacao: {
		label: 'Desativação de operação',
		categoria: 'operacao',
		severidade: 'aviso'
	},
	// A linha de base é o denominador de uma meta divulgada — mudá-la muda o
	// percentual de atingimento de uma unidade sem tocar em nenhum relatório.
	informar_linha_base: {
		label: 'Linha de base de indicador informada',
		categoria: 'operacao',
		severidade: 'aviso'
	},

	// Escalas
	criar_escala: { label: 'Criação de escala', categoria: 'escala', severidade: 'info' },
	editar_escala: { label: 'Edição de escala', categoria: 'escala', severidade: 'info' },
	excluir_escala: { label: 'Exclusão de escala', categoria: 'escala', severidade: 'aviso' },
	adicionar_policial_escala: {
		label: 'Policial adicionado à escala',
		categoria: 'escala',
		severidade: 'info'
	},
	remover_policial_escala: {
		label: 'Policial removido da escala',
		categoria: 'escala',
		severidade: 'info'
	},
	assinar_escala: { label: 'Assinatura de escala', categoria: 'escala', severidade: 'aviso' },
	revogar_assinatura: {
		label: 'Revogação de assinatura',
		categoria: 'escala',
		severidade: 'critico'
	},
	finalizar_escala_fds: {
		label: 'Finalização de escala de fim de semana',
		categoria: 'escala',
		severidade: 'info'
	},
	// A escala de FDS não é assinada: o marco é a ENTREGA por e-mail. Reenviar e
	// reabrir são, nesse fluxo, o que revogar e reabrir são no fluxo assinado —
	// por isso têm ação própria, e reabrir é `critico`: desfaz um documento que
	// já circulou fora do sistema.
	reenviar_escala_fds: {
		label: 'Reenvio da escala de fim de semana por e-mail',
		categoria: 'escala',
		severidade: 'aviso'
	},
	reabrir_escala_fds: {
		label: 'Reabertura de escala de fim de semana já enviada',
		categoria: 'escala',
		severidade: 'critico'
	},
	solicitar_assinatura_escala: {
		label: 'Solicitação de assinatura de escala',
		categoria: 'escala',
		severidade: 'info'
	},
	exportar_escala: { label: 'Exportação de escala', categoria: 'escala', severidade: 'info' },

	// GISE
	criar_gise: { label: 'Criação de GISE', categoria: 'gise', severidade: 'info' },
	editar_gise: { label: 'Edição de GISE', categoria: 'gise', severidade: 'info' },
	finalizar_gise: { label: 'Finalização de GISE', categoria: 'gise', severidade: 'aviso' },
	reabrir_gise: { label: 'Reabertura de GISE', categoria: 'gise', severidade: 'critico' },
	assinar_gise: { label: 'Assinatura de GISE', categoria: 'gise', severidade: 'aviso' },
	assinar_relatorio_gise: {
		label: 'Assinatura de relatório GISE',
		categoria: 'gise',
		severidade: 'aviso'
	},
	presenca_gise_entrada: {
		label: 'Registro de entrada (presença GISE)',
		categoria: 'gise',
		severidade: 'info'
	},
	presenca_gise_saida: {
		label: 'Registro de saída (presença GISE)',
		categoria: 'gise',
		severidade: 'info'
	},
	passkey_registrada: {
		label: 'Registro de chave de assinatura (passkey)',
		categoria: 'policial',
		severidade: 'aviso'
	},
	// Aviso, e não info: revogar é o que permite registrar em OUTRO aparelho, e
	// é por esse caminho que uma tomada de conta se disfarçaria de suporte. A
	// linha da trilha é o que responde "quem autorizou este novo aparelho".
	passkey_revogada: {
		label: 'Revogação de chave de assinatura (passkey)',
		categoria: 'policial',
		severidade: 'aviso'
	},
	solicitar_alteracao_cadastro: {
		label: 'Solicitação de alteração cadastral',
		categoria: 'policial',
		severidade: 'info'
	},
	aprovar_alteracao_cadastro: {
		label: 'Aprovação de alteração cadastral',
		categoria: 'policial',
		severidade: 'aviso'
	},
	rejeitar_alteracao_cadastro: {
		label: 'Rejeição de alteração cadastral',
		categoria: 'policial',
		severidade: 'info'
	},
	// O PEDIDO de movimentar/afastar/desvincular feito pelo administrador de
	// seccional ou de unidade. Fica separado do ATO (`registrar_movimentacao` e
	// companhia): pedir não muda o cadastro, e juntar os dois faria a trilha
	// mostrar duas transferências onde houve uma.
	solicitar_acao_policial: {
		label: 'Solicitação de movimentação/afastamento/desvinculação',
		categoria: 'policial',
		severidade: 'info'
	},
	aprovar_acao_policial: {
		label: 'Aprovação de movimentação/afastamento/desvinculação',
		categoria: 'policial',
		severidade: 'critico'
	},
	rejeitar_acao_policial: {
		label: 'Rejeição de movimentação/afastamento/desvinculação',
		categoria: 'policial',
		severidade: 'info'
	},
	// Composição da GISE — quem está de serviço, e sob qual escopo. Separadas por
	// entidade e verbo (e não agrupadas num `alterar_composicao_gise`) porque é
	// assim que o operador procura: "quem tirou gente da escala", "quem removeu a
	// seccional". A severidade real é decidida no desfecho da mudança, que sabe se
	// ela derrubou documento ou assinatura (`_actions/desfecho.ts`).
	gise_membro_adicionado: {
		label: 'Policial alocado em equipe da GISE',
		categoria: 'gise',
		severidade: 'info'
	},
	gise_membro_removido: {
		label: 'Policial desalocado de equipe da GISE',
		categoria: 'gise',
		severidade: 'info'
	},
	gise_equipe_criada: { label: 'Equipe criada na GISE', categoria: 'gise', severidade: 'info' },
	gise_equipe_alterada: {
		label: 'Equipe da GISE alterada (vagas/horário)',
		categoria: 'gise',
		severidade: 'info'
	},
	gise_equipe_removida: {
		label: 'Equipe removida da GISE',
		categoria: 'gise',
		severidade: 'aviso'
	},
	gise_seccional_adicionada: {
		label: 'Seccional incluída na GISE',
		categoria: 'gise',
		severidade: 'info'
	},
	gise_seccional_removida: {
		label: 'Seccional removida da GISE',
		categoria: 'gise',
		severidade: 'aviso'
	},
	gise_seccional_preenchida: {
		label: 'Seccional declarou preenchimento concluído',
		categoria: 'gise',
		severidade: 'info'
	},
	gise_seccional_alterada: {
		label: 'Horários da seccional alterados',
		categoria: 'gise',
		severidade: 'info'
	},
	gise_unidade_slot_criado: {
		label: 'Slot de unidade criado na seccional',
		categoria: 'gise',
		severidade: 'info'
	},
	gise_unidade_slot_removido: {
		label: 'Slot de unidade removido da seccional',
		categoria: 'gise',
		severidade: 'aviso'
	},
	gise_unidade_selecionada: {
		label: 'Unidade escolhida para um slot da seccional',
		categoria: 'gise',
		severidade: 'info'
	},

	exportar_gise: { label: 'Exportação de GISE', categoria: 'gise', severidade: 'info' },
	salvar_config_gise: {
		label: 'Alteração de configuração do GISE',
		categoria: 'configuracao',
		severidade: 'aviso'
	},

	// Documentos / assinatura
	preparar_assinatura: {
		label: 'Preparação de assinatura',
		categoria: 'documento',
		severidade: 'info'
	},
	download_validar_forense: {
		label: 'Download forense de validação',
		categoria: 'documento',
		severidade: 'info'
	},

	// Configuração
	salvar_config_assinatura: {
		label: 'Alteração de configuração de assinatura',
		categoria: 'configuracao',
		severidade: 'aviso'
	},
	salvar_config_geral: {
		label: 'Alteração de configuração geral',
		categoria: 'configuracao',
		severidade: 'aviso'
	},
	// Os valores de hora extra e diária que o plano operacional aplica. Fica em
	// `aviso`, como as outras ações de configuração: `critico` neste catálogo é
	// identidade e RBAC (criar/excluir policial, mudar papel), e valor de custo
	// não é dessa classe. O que dá rastreabilidade aqui não é a severidade — é a
	// tabela ser append-only, com uma linha por gravação.
	salvar_custo_parametros: {
		label: 'Nova versão dos valores de custo (hora extra / diária)',
		categoria: 'configuracao',
		severidade: 'aviso'
	},

	// Plano operacional (operação com deslocamento). `exportar_*` fica em `aviso`
	// como os outros exports: o PDF leva nome, matrícula, lotação e telefone do
	// efetivo, então baixar é acesso a dado pessoal e precisa ficar registrado.
	criar_plano_operacional: {
		label: 'Criação de plano operacional',
		categoria: 'operacao',
		severidade: 'info'
	},
	editar_plano_operacional: {
		label: 'Alteração de plano operacional',
		categoria: 'operacao',
		severidade: 'info'
	},
	excluir_plano_operacional: {
		label: 'Exclusão de plano operacional',
		categoria: 'operacao',
		severidade: 'aviso'
	},
	exportar_plano_operacional: {
		label: 'Download do plano operacional',
		categoria: 'operacao',
		severidade: 'aviso'
	},

	// LGPD
	registrar_incidente: {
		label: 'Registro de incidente LGPD',
		categoria: 'lgpd',
		severidade: 'aviso'
	},
	atualizar_incidente: {
		label: 'Atualização de incidente LGPD',
		categoria: 'lgpd',
		severidade: 'info'
	},
	solicitar_direito_lgpd: {
		label: 'Solicitação de direito do titular (LGPD)',
		categoria: 'lgpd',
		severidade: 'info'
	},
	responder_solicitacao_lgpd: {
		label: 'Resposta a solicitação LGPD',
		categoria: 'lgpd',
		severidade: 'aviso'
	},

	// Sistema / integrações
	limpeza_retencao: {
		label: 'Limpeza de retenção (LGPD)',
		categoria: 'sistema',
		severidade: 'info'
	},
	sync_policiais: {
		label: 'Sincronização de policiais (webhook)',
		categoria: 'sistema',
		severidade: 'aviso'
	},
	sync_unidades: {
		label: 'Sincronização de unidades (webhook)',
		categoria: 'sistema',
		severidade: 'aviso'
	},
	// A GISE fecha no sistema mas não chega à planilha que paga o
	// extraordinário. `critico` porque o efeito é FORA do sistema e ninguém aqui
	// dentro percebe: a tela mostra a escala finalizada normalmente.
	sync_base_equipe_pendente: {
		label: 'Envio da Base_Equipe pendente (planilha não recebeu)',
		categoria: 'sistema',
		severidade: 'critico'
	},
	reset_policiais: {
		label: 'Reset de policiais (webhook)',
		categoria: 'sistema',
		severidade: 'critico'
	},
	verificar_integridade_audit: {
		label: 'Verificação de integridade da trilha',
		categoria: 'sistema',
		severidade: 'info'
	}
} as const satisfies Record<string, AcaoMeta>;

export type AcaoAudit = keyof typeof CATALOGO_ACOES;

/** Metadados da ação (rótulo/categoria/severidade), com fallback para ações fora do catálogo. */
export function metaDaAcao(acao: string): AcaoMeta {
	return (
		(CATALOGO_ACOES as Record<string, AcaoMeta>)[acao] ?? {
			label: acao,
			categoria: 'sistema',
			severidade: 'info'
		}
	);
}
