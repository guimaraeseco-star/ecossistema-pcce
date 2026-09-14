/**
 * Modelos PADRÃO do formulário de produtividade da GISE — dados, não consulta.
 *
 * São o fallback de quando `gise_modelo_formulario` não tem linha para o tipo:
 * o assessor edita o modelo, e até editar valem estas constantes. Ficam num
 * arquivo próprio porque eram ~330 linhas de tabela dentro do módulo que grava
 * e lê as respostas — quem abria `respostas.ts` para mexer numa query passava
 * por elas inteiras antes de chegar em qualquer código.
 *
 * Ter UMA fonte aqui é o que o projeto já pagou para aprender: existia uma
 * cópia idêntica de 122 linhas do modelo SEINT dentro da página `/operacoes/presenca`
 * (achado 11.3 do antigo `ARQUIVOS.md` — ver `docs/HISTORICO.md`). Editar um
 * lado e não o outro deixava o policial respondendo um formulário e o relatório
 * lendo outro.
 *
 * `PerguntaModelo` mora aqui pelo mesmo motivo: é a FORMA destes dados, e os
 * consumidores importam os dois juntos.
 */

/** Pergunta de um modelo de formulário GISE (operacional ou SEINT). */
export interface PerguntaModelo {
	id: number;
	texto: string;
	tipo: string;
	key: string;
	/** Etapa do wizard (só nível 0 — ver `GiseModeloPerguntaConfig.etapa`). */
	etapa?: string;
	filhos: PerguntaModelo[];
	subtexto_qtd?: string;
	subtexto_lista?: string;
	subtexto_tipo?: string;
	/** Nome de cada linha da listagem no relatório — ver `GiseModeloPerguntaConfig`. */
	subtexto_item?: string;
}

/**
 * Modelo padrão OPERACIONAL — versão com rótulos CURTOS (relatórios/agregação).
 *
 * Os textos do FORMULÁRIO na tela são deliberadamente diferentes (instruções de
 * preenchimento + subtextos) e vivem em `TEXTOS_FORM_OPERACIONAL` logo abaixo;
 * `DEFAULT_QUESTIONS_FORM_OPERACIONAL` deriva ESTRUTURA daqui e só sobrepõe os
 * textos — impossível as duas versões divergirem em ids/tipos/keys.
 */
export const DEFAULT_QUESTIONS = [
	{ id: 1, texto: '1. VTR E PLACA', tipo: 'vtr_placa', key: 'vtr_placa', filhos: [] },
	{ id: 2, texto: '2. KM INICIAL', tipo: 'numero', key: 'km_inicial', filhos: [] },
	{ id: 3, texto: '3. KM FINAL', tipo: 'numero', key: 'km_final', filhos: [] },
	{
		id: 4,
		texto: '4. HOUVE PROCEDIMENTOS EM FLAGRANTE REALIZADOS?',
		tipo: 'prisoes_maiores',
		key: 'procedimentos_flagrante_bool',
		subtexto_qtd: '4.1 QUANTIDADE:',
		subtexto_lista: '4.2 INFORMAR NOMES E PROCEDIMENTOS:',
		filhos: []
	},
	{
		id: 5,
		texto: '5. MANDADOS CUMPRIDOS (MAIORES)',
		tipo: 'mandados_maiores',
		key: 'mandados_cumpridos',
		filhos: []
	},
	{
		id: 6,
		texto: '6. APREENSÕES CUMPRIDAS (MENORES)',
		tipo: 'apreensoes_menores',
		key: 'apreensoes_cumpridas',
		filhos: []
	},
	{
		id: 7,
		texto: '7. PRISÕES/APREENSÕES FLAGRANTE',
		tipo: 'select_99',
		key: 'prisoes_apreensoes_flagrante',
		filhos: []
	},
	{
		id: 8,
		texto: '8. TENTATIVA CUMPRIMENTO MANDADO',
		tipo: 'sim_nao',
		key: 'tentativa_mandado',
		filhos: []
	},
	{
		id: 9,
		texto: '9. MANDADO BUSCA E APREENSÃO',
		tipo: 'sim_nao',
		key: 'busca_apreensao',
		filhos: []
	},
	{
		id: 10,
		texto: '10. APREENSÃO DE DROGAS',
		tipo: 'drogas_complex',
		key: 'apreensoes_drogas',
		filhos: []
	},
	{
		id: 11,
		texto: '11. HOUVE APREENSÃO DE ARMAS/MUNIÇÕES?',
		tipo: 'armas_complex',
		key: 'apreensoes_armas_bool',
		subtexto_tipo: '11.1 TIPO DE ARMA:',
		subtexto_qtd: '11.1.1 QUANTIDADE:',
		filhos: []
	},
	{ id: 12, texto: '12. LOCAL DE CRIME', tipo: 'select_99', key: 'local_crime', filhos: [] },
	{
		id: 13,
		texto: '13. ORDEM DE MISSÃO CUMPRIDA',
		tipo: 'select_99',
		key: 'ordem_missao',
		filhos: []
	},
	{
		id: 14,
		texto: '14. LEVANTAMENTO DE ALVOS',
		tipo: 'select_99',
		key: 'levantamento_alvos',
		filhos: []
	},
	{ id: 15, texto: '15. OITIVAS REALIZADAS', tipo: 'select_99', key: 'oitivas', filhos: [] },
	{
		id: 16,
		texto: '16. REPRESENTAÇÃO PRISÃO',
		tipo: 'select_99',
		key: 'representacao_prisao',
		filhos: []
	},
	{
		id: 17,
		texto: '17. REPRESENTAÇÃO BUSCA',
		tipo: 'select_99',
		key: 'representacao_busca',
		filhos: []
	},
	{ id: 18, texto: '18. Nº ABORDAGENS', tipo: 'select_99', key: 'abordagens', filhos: [] },
	{ id: 19, texto: '19. RESUMO DILIGÊNCIAS', tipo: 'textarea', key: 'descricao', filhos: [] }
];

/**
 * Textos do FORMULÁRIO operacional (instruções de preenchimento) por `key`.
 * Divergência INTENCIONAL em relação aos rótulos curtos de `DEFAULT_QUESTIONS`:
 * na tela o policial precisa de comando ("DIGITE O KM..."); no relatório, de
 * rótulo compacto ("KM INICIAL"). Antes, a versão de formulário era uma cópia
 * integral de ~120 linhas dentro de `/operacoes/presenca/+page.server.ts`, escondendo a
 * relação entre as duas (achado 11.3 do antigo ARQUIVOS.md — ver docs/HISTORICO.md).
 */
const TEXTOS_FORM_OPERACIONAL: Record<
	string,
	Partial<
		Pick<PerguntaModelo, 'texto' | 'etapa' | 'subtexto_qtd' | 'subtexto_lista' | 'subtexto_tipo'>
	>
> = {
	vtr_placa: { etapa: 'Viatura', texto: '1. DIGITE A VTR E A PLACA' },
	km_inicial: { etapa: 'Viatura', texto: '2. DIGITE O KM INCIAL DA VTR' },
	km_final: { etapa: 'Viatura', texto: '3. DIGITE O KM FINAL DA VTR' },
	procedimentos_flagrante_bool: {
		etapa: 'Ocorrências',
		texto: '4. Houve PROCEDIMENTOS em flagrante realizados?'
	},
	mandados_cumpridos: {
		etapa: 'Ocorrências',
		texto: '5. Houve MANDADOS cumpridos (MAIORES)?',
		subtexto_qtd: '5.1 QUANTIDADE:',
		subtexto_lista: '5.2 INFORMAR NOMES E MANDADOS:'
	},
	apreensoes_cumpridas: {
		etapa: 'Ocorrências',
		texto: '6. Houve APREENSÕES cumpridas (MENORES)?',
		subtexto_qtd: '6.1 QUANTIDADE:',
		subtexto_lista: '6.2 INFORMAR NOMES E PROCESSOS:'
	},
	prisoes_apreensoes_flagrante: {
		etapa: 'Ocorrências',
		texto: '7. Nº PRISÕES/APREENSÕES em flagrante (por preso)'
	},
	tentativa_mandado: {
		etapa: 'Ocorrências',
		texto: '8. Houve tentativa de cumprimento de mandado?'
	},
	busca_apreensao: { etapa: 'Ocorrências', texto: '9. Houve mandado de busca e apreensão?' },
	apreensoes_drogas: {
		etapa: 'Apreensões',
		texto: '10. Houve apreensão de drogas?',
		subtexto_tipo: '10.1 TIPO DE DROGA:'
	},
	apreensoes_armas_bool: { etapa: 'Apreensões', texto: '11. Houve APREENSÃO DE ARMAS/MUNIÇÕES?' },
	local_crime: { etapa: 'Diligências', texto: '12. Local de Crime' },
	ordem_missao: { etapa: 'Diligências', texto: '13. Ordem de Missão Cumprida' },
	levantamento_alvos: { etapa: 'Diligências', texto: '14. Levantamento de Alvos' },
	oitivas: { etapa: 'Diligências', texto: '15. Oitivas Realizadas' },
	representacao_prisao: { etapa: 'Diligências', texto: '16. Representação Prisão' },
	representacao_busca: { etapa: 'Diligências', texto: '17. Representação Busca' },
	abordagens: { etapa: 'Diligências', texto: '18. Nº Abordagens' },
	descricao: { etapa: 'Diligências', texto: '19. Descreva resumidamente as diligências' }
};

/**
 * Modelo padrão OPERACIONAL para a UI do formulário (`/operacoes/presenca`): mesma
 * estrutura de `DEFAULT_QUESTIONS`, com os textos de preenchimento aplicados.
 */
export const DEFAULT_QUESTIONS_FORM_OPERACIONAL: PerguntaModelo[] = DEFAULT_QUESTIONS.map((q) => ({
	...q,
	...(TEXTOS_FORM_OPERACIONAL[q.key] ?? {})
}));

/**
 * Modelo padrão do formulário SEINT — fonte ÚNICA, usada como fallback tanto
 * aqui (agregação/relatórios) quanto no load de `/operacoes/presenca` (UI do formulário
 * e botão "restaurar padrão"). Antes existia uma cópia idêntica de 122 linhas
 * na página (achado 11.3 do antigo ARQUIVOS.md — ver docs/HISTORICO.md).
 */
export const DEFAULT_SEINT_QUESTIONS = [
	{
		id: 1,
		texto: '1. Houve EXTRAÇÃO DE DADOS DE APARELHOS CELULARES?',
		tipo: 'sim_nao',
		key: 'extracao_celulares',
		filhos: [
			{
				id: 101,
				texto: '1.1 Quantidade de aparelhos analisados (1 a 99)',
				tipo: 'numero',
				key: 'extracao_qtd',
				filhos: []
			},
			{
				id: 102,
				texto: '1.2 Listagem de aparelhos analisados (Modelo, Nº proc, Delegacia, Concluída)',
				tipo: 'textarea',
				key: 'extracao_lista',
				filhos: []
			}
		]
	},
	{
		id: 2,
		texto: '2. Houve ANÁLISE DE DADOS DE EXTRAÇÃO?',
		tipo: 'sim_nao',
		key: 'analise_extracao',
		filhos: [
			{
				id: 201,
				texto: '2.1 Quantidade de aparelhos analisados (1 a 99)',
				tipo: 'numero',
				key: 'analise_qtd',
				filhos: []
			},
			{
				id: 202,
				texto: '2.2 Listagem de aparelhos analisados (Tamanho, Modelo, Nº proc, Delegacia)',
				tipo: 'textarea',
				key: 'analise_lista',
				filhos: []
			}
		]
	},
	{
		id: 3,
		texto: '3. Houve PRODUÇÃO DE RELATÓRIOS?',
		tipo: 'sim_nao',
		key: 'producao_relatorios',
		filhos: [
			{
				id: 301,
				texto: '3.1 Quantidade de relatórios produzidos (1 a 99)',
				tipo: 'numero',
				key: 'relatorios_qtd',
				filhos: []
			},
			{
				id: 302,
				texto:
					'3.2 Listagem de relatórios produzidos (Nº Relatório, Alvos, Proc. Vinculado, Delegacia)',
				tipo: 'textarea',
				key: 'relatorios_lista',
				filhos: []
			}
		]
	},
	{
		id: 4,
		texto: '4. Houve LEVANTAMENTO DE DADOS DE ALVOS FORAGIDOS?',
		tipo: 'sim_nao',
		key: 'levantamento_foragidos',
		filhos: [
			{
				id: 401,
				texto: '4.1 Quantidade de levantamentos produzidos (1 a 99)',
				tipo: 'numero',
				key: 'levantamentos_qtd',
				filhos: []
			},
			{
				id: 402,
				texto:
					'4.2 Listagem de relatórios produzidos (Nome do Alvo, Proc. Vinculado, Delegacia, Resultado)',
				tipo: 'textarea',
				key: 'levantamentos_lista',
				filhos: []
			}
		]
	},
	{
		id: 5,
		texto: '5. Houve INTERCEPTAÇÃO TELEFÔNICA?',
		tipo: 'sim_nao',
		key: 'interceptacao_tel',
		filhos: [
			{
				id: 501,
				texto: '5.1 Quantidade de INTERCEPTAÇÃO TELEFÔNICA (1 a 99)',
				tipo: 'numero',
				key: 'interceptacao_qtd',
				filhos: []
			},
			{
				id: 502,
				texto: '5.2 Existem OPERAÇÕES que necessitaram de acompanhamento?',
				tipo: 'sim_nao',
				key: 'operacoes_acompanhamento_bool',
				filhos: [
					{
						id: 503,
						texto: '5.2.1 Listagem de OPERAÇÕES (Nome da operação e Delegacia de origem)',
						tipo: 'textarea',
						key: 'operacoes_lista',
						filhos: []
					}
				]
			}
		]
	}
];
