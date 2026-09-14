/**
 * O ARRASTE em si no modo "Organizar" de `/operacoes/produtividade` — quem está sendo
 * levado, sobre quem ele paira, e o que acontece ao soltar.
 *
 * Separado de `useProdutividade` porque são duas coisas de vidas diferentes: lá
 * mora a ORDEM (um dado da operação, que vai ao banco); aqui mora o estado de um
 * gesto, que nasce no `dragstart` e morre no `drop`. Misturá-los faria o
 * composable do painel guardar índices de mouse ao lado da agregação de 500
 * respostas.
 *
 * ## Por que o par (seção, índice)
 *
 * As três faixas do painel — indicadores, listagem, colunas — têm cada uma o seu
 * `{#each}`, e o índice 2 existe nas três. Guardar só o número faria soltar o
 * terceiro card de colunas sobre o terceiro ranking parecer um movimento válido.
 * O par identifica o card, e `soltarEm` recusa o cruzamento de seções: um gráfico
 * de colunas é uma faixa inteira com `<canvas>` e não cabe na grade de dois dos
 * rankings.
 *
 * ## O que ele NÃO faz
 *
 * Não reordena nada. `mover` é a função que o painel passou, e é lá que a ordem é
 * regravada — este módulo só decide QUANDO chamá-la. É o que permite as setas
 * ↑/↓ dos cards chamarem `mover` direto, sem passar por gesto nenhum: elas são o
 * caminho de quem está no celular ou no teclado, e existem pelo mesmo motivo que
 * existem no editor do formulário.
 */
import type { EscopoArraste } from './useProdutividade.svelte';

/**
 * O que está sendo arrastado: o ESCOPO em que ele vive e a posição dentro dele.
 *
 * O escopo é uma faixa (o card anda entre os cards dela) ou `'blocos'` (a faixa
 * inteira anda entre as outras). Um tipo só para os dois porque o gesto é o
 * mesmo — muda a lista sobre a qual ele opera.
 */
interface PosicaoArrastavel {
	secao: EscopoArraste;
	indice: number;
}

export interface OrganizacaoPainel {
	/** O modo de organização está ligado? Os cards só ganham alça quando sim. */
	readonly ativo: boolean;
	/** O card que está sendo arrastado, ou `null`. */
	readonly arrastando: PosicaoArrastavel | null;
	/** O card sob o cursor — o que recebe a marca de destino. */
	readonly alvo: PosicaoArrastavel | null;
	iniciarArraste(secao: EscopoArraste, indice: number): void;
	/** Marca o card sob o cursor como destino (só dentro da MESMA seção). */
	entrarEm(secao: EscopoArraste, indice: number): void;
	/** O arraste pode pousar aqui? Decide o `preventDefault` do `dragover`. */
	aceita(secao: EscopoArraste): boolean;
	soltarEm(secao: EscopoArraste, indice: number): void;
	limpar(): void;
	/** Move sem gesto — o caminho das setas ↑/↓, que é o acessível. */
	mover(secao: EscopoArraste, de: number, para: number): void;
}

/**
 * Estado do arraste dos cards do painel.
 *
 * @param getAtivo o modo de organização está ligado (vem do painel)
 * @param mover aplica o movimento na ordem — `moverCard` de `useProdutividade`
 */
export function useOrganizacaoPainel(
	getAtivo: () => boolean,
	mover: (secao: EscopoArraste, de: number, para: number) => void
): OrganizacaoPainel {
	let arrastando = $state<PosicaoArrastavel | null>(null);
	let alvo = $state<PosicaoArrastavel | null>(null);

	function limpar() {
		arrastando = null;
		alvo = null;
	}

	// Desligar o modo no meio de um arraste (o botão "Cancelar" da barra) deixaria
	// a marca de destino acesa no card sob o cursor, sem gesto nenhum em curso.
	$effect(() => {
		if (!getAtivo()) limpar();
	});

	return {
		get ativo() {
			return getAtivo();
		},
		get arrastando() {
			return arrastando;
		},
		get alvo() {
			return alvo;
		},
		iniciarArraste(secao, indice) {
			arrastando = { secao, indice };
			alvo = null;
		},
		aceita(secao) {
			return arrastando !== null && arrastando.secao === secao;
		},
		entrarEm(secao, indice) {
			if (arrastando?.secao !== secao) return;
			alvo = { secao, indice };
		},
		soltarEm(secao, indice) {
			// Soltar sobre outra faixa não move nem erra: o gesto simplesmente não
			// vale, e a alternativa (mover para o fim da faixa de origem) inventaria
			// uma intenção que ninguém teve.
			if (arrastando?.secao === secao) mover(secao, arrastando.indice, indice);
			limpar();
		},
		limpar,
		mover
	};
}
