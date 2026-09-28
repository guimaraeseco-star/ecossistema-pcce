/**
 * As opções da caixa "Tipo do Campo" do editor do formulário de presença.
 *
 * Eram um `<select>` com três `<optgroup>`; a caixa de busca (E76, etapa 2)
 * não tem grupos, então o nome do grupo vai como `detalhe` — aparece embaixo
 * de cada opção e também entra na busca ("inteligente" traz os sistemáticos).
 */
import { TIPOS_LISTA_APOSENTADOS } from '$lib/gise/tipos-pergunta';

const BASICO = 'Campos básicos';
const INTELIGENTE = 'Campos inteligentes (sistemáticos)';

const TIPOS_DE_CAMPO = [
	{ value: 'texto', label: 'Texto Curto', detalhe: BASICO },
	{ value: 'textarea', label: 'Texto Longo', detalhe: BASICO },
	{ value: 'numero', label: 'Número', detalhe: BASICO },
	{ value: 'sim_nao', label: 'Sim / Não (Condicional)', detalhe: BASICO },
	{ value: 'select_99', label: 'Quantitativo (0-99)', detalhe: BASICO },
	// Dois campos numa pergunta só (total e parte). É o que permite meta de
	// COBERTURA: "atender 100% das ocorrências" não se mede com um número solto.
	{ value: 'proporcao', label: 'Cobertura (total e atendidas)', detalhe: BASICO },
	// Primeiro dos inteligentes por ser o ÚNICO que pode se repetir no
	// formulário: os demais gravam em chave fixa e só funcionam uma vez (ver
	// `$lib/gise/tipos-pergunta`).
	{
		value: 'lista_detalhada',
		label: 'Quantidade + Lista Nome/Procedimento (reutilizável)',
		detalhe: INTELIGENTE
	},
	{ value: 'vtr_placa', label: 'VTR e Placa (Inteligente)', detalhe: INTELIGENTE },
	{ value: 'drogas_complex', label: 'Drogas Detalhado (Auto-Listagem)', detalhe: INTELIGENTE },
	{ value: 'armas_complex', label: 'Armas Detalhado (Auto-Listagem)', detalhe: INTELIGENTE },
	{ value: 'celulares_complex', label: 'Extração Celular (Auto-Listagem)', detalhe: INTELIGENTE },
	{ value: 'analise_complex', label: 'Análise de Dados (Auto-Listagem)', detalhe: INTELIGENTE },
	{
		value: 'relatorios_seint_complex',
		label: 'Relatórios SEINT (Auto-Listagem)',
		detalhe: INTELIGENTE
	},
	{ value: 'foragidos_complex', label: 'Alvos Foragidos (Auto-Listagem)', detalhe: INTELIGENTE },
	{
		value: 'operacoes_seint_complex',
		label: 'Operações SEINT (Auto-Listagem)',
		detalhe: INTELIGENTE
	},
	{ value: 'operacoes_seint_pura', label: 'Operações SEINT (Lista Pura)', detalhe: INTELIGENTE }
];

const ROTULO_DO_APOSENTADO: Record<string, string> = {
	mandados_maiores: 'Mandados Maiores (legado)',
	prisoes_maiores: 'Prisões Maiores (legado)',
	apreensoes_menores: 'Apreensões Menores (legado)'
};

/**
 * Os tipos oferecidos para uma pergunta. Os APOSENTADOS só aparecem na
 * pergunta que JÁ está com um deles: escondê-los sempre faria a caixa não
 * achar o valor atual — a pergunta pareceria sem tipo, e trocar o tipo troca a
 * chave da resposta. Fazem o mesmo que "Quantidade + Lista", só que em chave
 * fixa, o que os limita a uma ocorrência por formulário.
 */
export function opcoesDoTipoDoCampo(tipoAtual: string) {
	if (!TIPOS_LISTA_APOSENTADOS.includes(tipoAtual)) return TIPOS_DE_CAMPO;
	return [
		...TIPOS_DE_CAMPO,
		{
			value: tipoAtual,
			label: ROTULO_DO_APOSENTADO[tipoAtual] ?? tipoAtual,
			detalhe: 'Aposentado — prefira Quantidade + Lista'
		}
	];
}
