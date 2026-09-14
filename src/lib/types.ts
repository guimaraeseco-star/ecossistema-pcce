/**
 * Os tipos que a TELA usa — e a fronteira entre eles e os do banco.
 *
 * Metade do arquivo é reexport puro do `server/schema` (`Policial`, `Escala`,
 * `Unidade`…), para que componente não importe de `$lib/server/` e acabe
 * arrastando código de servidor para o bundle do cliente. A outra metade são as
 * formas que só existem DEPOIS da consulta: linha de listagem com os campos
 * calculados (`EscalaListagem`), a escala como o `/operacoes/presenca` a enxerga, o
 * modelo de pergunta da produtividade.
 *
 * Por isso `EscalaListagem extends Escala` em vez de repetir os campos: o que
 * está aqui é o ACRÉSCIMO da consulta, e herdar deixa visível quais campos são
 * do banco e quais a query inventou.
 */
import type {
	Policial,
	Escala,
	EscalaPolicial,
	Unidade,
	GisePresenca,
	Operacao,
	PolicialHistorico,
	CadastroSolicitacao,
	PolicialAcaoSolicitacao
} from './server/schema';

export type {
	Policial,
	Escala,
	Unidade,
	PolicialHistorico,
	CadastroSolicitacao,
	PolicialAcaoSolicitacao
};

/**
 * Meta que move um NÚMERO numa direção — a forma original do indicador.
 *
 * `percentual` = relativa à LINHA DE BASE informada pela unidade ("redução
 * mínima de 20% do acervo"); é o padrão do editor. `absoluto` = alvo fixo, sem
 * base ("mínimo de 1 operação por unidade/mês") — não há valor anterior contra o
 * que comparar, e por isso nada é pedido à delegacia.
 */
export interface IndicadorMetaValor {
	/** Para onde o número deve andar. Decide o sinal da meta e a leitura do gráfico. */
	objetivo: 'aumentar' | 'diminuir';
	metaTipo: 'percentual' | 'absoluto';
	/** 20 para "20%" quando `percentual`; o próprio alvo quando `absoluto`. */
	metaValor: number;
	/** Como o número é medido: 'procedimentos', 'dias', 'ocorrências atendidas'. */
	unidadeMedida?: string;
	/** Texto do campo na aba de dados base; cai no texto da pergunta se vazio. */
	rotuloBase?: string;
}

/**
 * Meta de COBERTURA: que fatia de um total foi atendida.
 *
 * Existe porque "atender 100% das ocorrências" não é aumentar nem diminuir um
 * número — é cobrir uma parte de um todo que varia a cada período. Escrevê-la
 * como `aumentar` mentiria no rótulo ("aumentar 100%") e como `absoluto`
 * perderia o denominador: 12 atendimentos são ótimos se houve 12 ocorrências e
 * ruins se houve 40.
 *
 * O total e a parte vêm da MESMA pergunta (tipo `proporcao`, dois campos), então
 * esta meta não pede linha de base à unidade — o denominador é informado junto
 * do numerador, no próprio relatório.
 *
 * `objetivo` não existe aqui de propósito: não há direção a escolher, e um campo
 * opcional ignorado convidaria a preenchê-lo com algo que ninguém lê.
 *
 * Não exportada: ninguém a nomeia fora daqui — quem consome usa `IndicadorConfig`
 * e estreita por `metaTipo`. Exportar o que ninguém importa vira uma segunda
 * lista para manter em dia.
 */
interface IndicadorMetaProporcao {
	metaTipo: 'proporcao';
	/** Cobertura perseguida, em % do total. 100 = atender tudo. */
	metaValor: number;
	/** O que está sendo contado: 'ocorrências', 'chamados', 'plantões'. */
	unidadeMedida?: string;
}

/**
 * Meta de um indicador, gravada JUNTO da pergunta no modelo do formulário.
 *
 * Fica aqui, e não em tabela própria, porque o indicador É a pergunta: separá-los
 * criaria duas listas para manter em dia, e uma pergunta renomeada ou removida
 * deixaria uma meta órfã apontando para uma `key` que não existe mais.
 *
 * União discriminada por `metaTipo`, e não uma interface só com campos
 * opcionais: é ela que faz o compilador cobrar de cada tela o ramo da proporção
 * em vez de deixá-la ler um `objetivo` que não existe e cair no ramo "aumentar"
 * em silêncio.
 */
export type IndicadorConfig = IndicadorMetaValor | IndicadorMetaProporcao;

/**
 * As formas que uma pergunta assume no painel de produtividade.
 *
 * Acumulam: a mesma pergunta pode render um ranking E um detalhamento, que é
 * como o painel sempre mostrou drogas e armas. Cada forma vira um card próprio,
 * exportável em PNG separadamente.
 *
 * - `colunas` — uma barra por unidade, no gráfico Chart.js;
 * - `ranking` — as mesmas unidades numa lista ordenada e numerada. Mesma conta,
 *   outra leitura: a barra compara silhuetas, a lista dá a posição;
 * - `detalhe` — quebra por CATEGORIA dentro da resposta (por tipo de droga, por
 *   tipo de arma), e não por unidade. Só existe onde a pergunta guarda essa
 *   quebra — ver `podeDetalhar` em `$lib/gise/tipos-pergunta`.
 */
export interface GraficoConfig {
	colunas?: boolean;
	ranking?: boolean;
	detalhe?: boolean;
}

/** Item do formulário GISE (modelo operacional / SEINT em JSON). */
export interface GiseModeloPerguntaConfig {
	id: number;
	texto: string;
	tipo: string;
	key: string;
	obrigatoria?: boolean;
	/**
	 * Nome da etapa do formulário em que a pergunta aparece (o wizard de
	 * `/operacoes/presenca/relatorio` agrupa por este valor, na ordem da primeira
	 * ocorrência). Só vale em perguntas de NÍVEL 0 — filhos herdam a etapa do
	 * pai, porque separá-los dele quebraria o gate "só aparece sob um Sim".
	 *
	 * Opcional de propósito: modelo antigo (sem o campo) e pergunta nova criada
	 * pelo editor caem numa etapa única, e o formulário vira página só. É o que
	 * mantém a mudança retrocompatível com os modelos já salvos no banco.
	 */
	etapa?: string;
	/**
	 * Marca a pergunta como INDICADOR de meta da operação — o que a promove de
	 * "campo do relatório" a série acompanhada em gráfico, com meta e linha de
	 * base.
	 *
	 * Opcional de propósito: pergunta sem este campo continua sendo o que sempre
	 * foi, e modelo antigo (todos, até ago/2026) segue válido sem migração de
	 * dado. Só tipos contáveis aceitam — ver `TIPOS_INDICADORAVEIS` em
	 * `$lib/gise/indicadores`, que é quem valida.
	 */
	indicador?: IndicadorConfig;
	/**
	 * Como a pergunta aparece no painel de produtividade.
	 *
	 * Ausente, ou com as três formas desligadas, = não aparece. Essa é a leitura
	 * para todo modelo daqui em diante: o painel é uma escolha, não uma
	 * consequência do tipo do campo. Antes da migração 0053 toda pergunta de tipo
	 * contável virava gráfico automaticamente, e o resultado era a quilometragem
	 * inicial da viatura ocupando um card ao lado das prisões.
	 *
	 * Objeto e não booleano porque as formas ACUMULAM: a pergunta de armas produz
	 * o ranking por unidade E o detalhamento por tipo de arma, que é como o painel
	 * sempre a mostrou. A 0053 carimbou o booleano `true` e a 0054 o converteu
	 * neste objeto, marcando de quebra as perguntas de droga e de arma com as
	 * formas que os blocos fixos já desenhavam — as duas viradas foram invisíveis
	 * na tela.
	 *
	 * Independente de `indicador`, e de propósito: indicador tem meta e linha de
	 * base e vive na seção própria. Uma pergunta pode ser um, outro, os dois ou
	 * nenhum.
	 */
	grafico?: GraficoConfig;
	/**
	 * O título do card no painel de produtividade — gráfico, ranking,
	 * detalhamento e indicador de meta.
	 *
	 * Existe porque o enunciado de uma pergunta e o título de um card não são a
	 * mesma frase. A pergunta é escrita para quem PREENCHE ("10. HOUVE APREENSÃO
	 * DE DROGAS?", numerada, em caixa alta, interrogativa); o card é lido por quem
	 * ACOMPANHA, e ali o que serve é o substantivo — "Drogas". Antes disto o card
	 * exibia o enunciado inteiro, numeração e ponto de interrogação incluídos.
	 *
	 * Vazio ou ausente cai no texto da pergunta (ou na identidade fixa de drogas e
	 * armas) — ver `tituloNoPainel` em `$lib/produtividade/apresentacao`, que é
	 * quem resolve. Nenhum modelo precisou de migração: não preencher devolve
	 * exatamente o que a tela já mostrava.
	 *
	 * NÃO entra no relatório assinado: é rótulo de leitura, e o PDF continua
	 * saindo com o enunciado que a pessoa respondeu.
	 */
	rotulo_painel?: string;
	filhos?: GiseModeloPerguntaConfig[];
	subtexto_qtd?: string;
	subtexto_lista?: string;
	/**
	 * Como cada linha da listagem é nomeada no relatório assinado — "Procedimento
	 * 1", "Mandado 1", "Apreensão 1".
	 *
	 * Existe para o tipo reutilizável (`lista_detalhada`) poder substituir os
	 * tipos de chave fixa sem perder o nome no PDF. Aqueles três traziam o rótulo
	 * embutido no tipo; o genérico serve a qualquer pergunta e por isso pergunta.
	 *
	 * Vazio ou ausente cai em "Item", que é o que o genérico sempre usou — modelo
	 * antigo continua saindo igual, sem migração.
	 */
	subtexto_item?: string;
	subtexto_tipo?: string;
	subtexto_detalhe?: string;
	/** Rótulo do campo DENOMINADOR no tipo `proporcao`; cai em "Total" se vazio. */
	subtexto_total?: string;
	/** Rótulo do campo NUMERADOR no tipo `proporcao`; cai em "Atendidas" se vazio. */
	subtexto_parte?: string;
}

/** Linha da lista "minhas escalas" em `/operacoes/presenca` (+page.server). */
export type ResGiseMinhaEscalaLinha = {
	id: number;
	data_inicio: string;
	status: string;
	hora_entrada: string;
	hora_saida: string;
	equipe_id: number;
	sec_hora_entrada: string | null;
	sec_hora_saida: string | null;
	eq_hora_entrada: string | null;
	eq_hora_saida: string | null;
	equipe_tipo: string;
	seccional_id: number;
	seccional_nome: string;
	presenca: GisePresenca | undefined;
	assinada: boolean;
	extraAssinado: boolean;
	equipeRespondida: boolean;
	horarioPrevisto: { inicio: string; fim: string };
};

/**
 * Linha da visão admin em `/operacoes/presenca`. Só compõe a união `ResGiseEscalaSelecionavel`
 * (o load não devolve mais uma lista admin separada), por isso não é exportada.
 */
type ResGiseListaAdminLinha = {
	id: number;
	data_inicio: string;
	status: string;
	seccional_id: number;
	seccional_nome: string;
	equipe_id: number;
	equipe_tipo: string;
	equipeRespondida: boolean;
	extraAssinado: boolean;
	isAdminView: true;
	/** Só em `minhasEscalas`; opcional aqui para compatibilidade com helpers compartilhados. */
	presenca?: GisePresenca;
	horarioPrevisto?: { inicio: string; fim: string };
};

/** Shape de `data` em `src/routes/operacoes/presenca/+page.svelte` (+page.server load). */
export type ResGisePageData = {
	minhasEscalas: ResGiseMinhaEscalaLinha[];
	isSupervisorGise: boolean;
	/** Assessor ou SEINT em GISE ativa (quadro de supervisão). */
	isSupervisaoGise?: boolean;
	/** ID da unidade sintética usada em assinaturas do relatório de extra da supervisão. */
	supervisaoExtraUnidadeId: number | null;
	/** Carimbo do 1º envio da resposta de produtividade (local, "YYYY-MM-DD HH:MM:SS") ou null. */
	respostaEnviadaEm?: string | null;
	/** Carimbo da última retificação da resposta de produtividade ou null. */
	respostaAtualizadaEm?: string | null;
	restringirSmartphone: boolean;
	/** Operações ativas — o editor mostra um formulário por operação. */
	operacoes: Operacao[];
	/** A operação em edição (resolvida no servidor a partir de `?operacaoId=`). */
	operacaoSelecionadaId: number | null;
	modeloOperacional: GiseModeloPerguntaConfig[];
	modeloSeint: GiseModeloPerguntaConfig[];
	/** Versão salva ANTES da última alteração de cada modelo — alimenta o
	 *  "Restaurar Anterior" do editor do Admin Geral. `null` enquanto só houve
	 *  a primeira gravação (coluna `config_anterior`, migração 0039). */
	modeloAnteriorOperacional: GiseModeloPerguntaConfig[] | null;
	modeloAnteriorSeint: GiseModeloPerguntaConfig[] | null;
};

export type ResGiseEscalaSelecionavel = ResGiseMinhaEscalaLinha | ResGiseListaAdminLinha;

export interface EscalaPolicialComDados extends EscalaPolicial {
	nome: string;
	matricula: string;
	cpf: string | null;
	cargo: string;
	telefone: string | null;
	lotacao: string;
	classe: string;
	regime: string;
	observacoes: string;
	equipe: string;
}

export interface EscalaListagem extends Escala {
	is_assinada: boolean;
}

/**
 * Uma linha do painel de COMPLIANCE: a exigência de escala (unidade × regime ×
 * período) e o estado em que ela está.
 *
 * `status` distingue os três casos que o painel precisa cobrar de formas
 * diferentes — `nao_criada` (ninguém montou), `nao_assinada` (montada mas sem
 * valor de documento) e `ok`. Sem escala não há `escala_id`.
 *
 * Vive aqui, e não na rota, porque é produzido em DOIS lugares com algoritmos
 * distintos — o `load` de `/painel` (qualquer mês/ano) e
 * `/api/admin/compliance` (mês corrente + FDS da semana) — e consumido pela
 * mesma tela. Duas declarações idênticas em arquivos diferentes divergem em
 * silêncio.
 */
export interface ItemCompliance {
	unidade_nome: string;
	tipo_regime: 'plantao' | 'expediente' | 'fds';
	periodo: string;
	data_inicio: string;
	data_fim: string;
	status: 'ok' | 'nao_assinada' | 'nao_criada';
	escala_id?: number;
}
