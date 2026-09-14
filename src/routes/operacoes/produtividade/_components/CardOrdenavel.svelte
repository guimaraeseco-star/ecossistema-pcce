<script lang="ts">
	/**
	 * A moldura de arraste de UM card do painel, no modo "Organizar".
	 *
	 * Envolve o card real sem o alterar: quem entra por `children` é o mesmo
	 * `RankingCard`, `DetailCard`, gráfico de colunas ou card de indicador que a
	 * tela mostra fora do modo. Era esse o pedido — organizar na PRÓPRIA aba de
	 * produtividade, e não numa lista de nomes em outra tela, porque o que se
	 * arruma é a leitura e a leitura é visual.
	 *
	 * Três decisões que não são estilo:
	 *
	 * - **o conteúdo fica inerte** (`pointer-events-none`). Sem isso, o gesto de
	 *   arrastar passa por cima da caixinha de seleção que todo card tem no canto,
	 *   e organizar o painel marcaria cards para exportação sem querer;
	 * - **`draggable` no card inteiro**, e não numa alça que o liga no `mousedown`
	 *   (que é como o editor do formulário faz). Lá o card tem campos de texto e
	 *   `draggable` fixo impediria selecioná-los; aqui o conteúdo já é inerte, e
	 *   pegar o card por qualquer ponto é o gesto que se espera de um painel;
	 * - **as setas ↑/↓ fazem a mesma coisa** e são o único caminho no celular e no
	 *   teclado — `dragstart` não existe em toque. Mesma razão de existirem no
	 *   editor do formulário.
	 *
	 * A faixa de controles fica ACIMA do card, e não sobreposta a ele. Sobreposta
	 * ela cobria o título do card no canto esquerdo e a caixinha de exportação no
	 * direito — os dois cantos que todo card do painel já usa.
	 *
	 * ## Serve para as duas coisas que se arrastam
	 *
	 * Um CARD dentro da faixa dele, e uma FAIXA inteira entre as outras
	 * (`variante`). São o mesmo gesto sobre listas diferentes, e por isso o mesmo
	 * componente: um segundo wrapper para blocos duplicaria os cinco manipuladores
	 * de arraste, e a primeira divergência entre eles apareceria como "o bloco não
	 * solta onde o card solta". O que muda é o PESO da barra — a do bloco é escura
	 * e diz o nome da faixa, porque ela manda no que está embaixo dela.
	 */
	import type { Snippet } from 'svelte';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { EscopoArraste } from './useProdutividade.svelte';
	import type { OrganizacaoPainel } from './useOrganizacaoPainel.svelte';

	const {
		organizacao,
		secao,
		indice,
		total,
		rotulo,
		variante = 'card',
		children
	}: {
		organizacao: OrganizacaoPainel;
		/** A faixa em que o card vive, ou `'blocos'` quando o arrastável É a faixa. */
		secao: EscopoArraste;
		indice: number;
		/** Quantos itens há neste escopo — desabilita a seta do primeiro e do último. */
		total: number;
		/** O nome do que se move, para o `aria-label` das setas dizer o quê. */
		rotulo: string;
		/** `'bloco'` desenha a barra escura da faixa; `'card'`, a clara do card. */
		variante?: 'card' | 'bloco';
		children: Snippet;
	} = $props();

	const ehBloco = $derived(variante === 'bloco');

	const arrastando = $derived(
		organizacao.arrastando?.secao === secao && organizacao.arrastando.indice === indice
	);
	const alvo = $derived(
		!arrastando && organizacao.alvo?.secao === secao && organizacao.alvo.indice === indice
	);
</script>

<!-- `role="listitem"` porque é o que a tela é neste modo: uma lista ORDENADA em
     que a posição é a informação. O contêiner de cada faixa recebe `role="list"`
     junto. Mesma escolha do editor do formulário. -->
<div
	class="flex h-full flex-col gap-2 rounded-3xl transition-all {arrastando
		? 'opacity-40'
		: ''} {alvo
		? 'ring-4 ring-primary-500/60 ring-offset-4 ring-offset-surface-50 dark:ring-offset-surface-950'
		: ''}"
	role="listitem"
	draggable="true"
	ondragstart={(e) => {
		// O arraste é de quem foi PEGO, não do bloco que o contém: sem parar aqui, o
		// evento sobe e o wrapper do bloco reescreve a origem — pegar um card
		// arrastaria a faixa inteira.
		e.stopPropagation();
		organizacao.iniciarArraste(secao, indice);
	}}
	ondragover={(e) => {
		// `aceita` antes de parar: quando o que está em curso é o arraste de um
		// BLOCO, o card deixa o evento subir, e é o bloco que se marca como destino.
		// Era isso ou o bloco nunca receber um bloco solto sobre os cards dele.
		if (!organizacao.aceita(secao)) return;
		e.preventDefault();
		e.stopPropagation();
	}}
	ondragenter={(e) => {
		if (!organizacao.aceita(secao)) return;
		e.stopPropagation();
		organizacao.entrarEm(secao, indice);
	}}
	ondrop={(e) => {
		if (!organizacao.aceita(secao)) return;
		e.preventDefault();
		e.stopPropagation();
		organizacao.soltarEm(secao, indice);
	}}
	ondragend={(e) => {
		e.stopPropagation();
		organizacao.limpar();
	}}
>
	<!-- `print:hidden` porque o modo é de tela: se alguém imprimir com ele ligado,
	     o papel não leva alça nem seta. -->
	<div
		class="flex cursor-grab items-center justify-between gap-2 px-2 py-1 active:cursor-grabbing print:hidden {ehBloco
			? 'rounded-2xl bg-surface-900 py-2 px-3 text-white dark:bg-surface-50 dark:text-surface-950'
			: 'rounded-xl bg-surface-200/70 dark:bg-surface-800/70'}"
	>
		<span
			class="inline-flex min-w-0 items-center gap-1.5 text-3xs font-black uppercase tracking-widest {ehBloco
				? ''
				: 'text-surface-600 dark:text-surface-300'}"
		>
			<GripVertical size={ehBloco ? 16 : 14} class="shrink-0" aria-hidden="true" />
			<span class="shrink-0">{indice + 1}º</span>
			{#if ehBloco}
				<span class="shrink-0 opacity-60">bloco ·</span>
			{/if}
			<span class="truncate {ehBloco ? '' : 'opacity-70'}">{rotulo}</span>
		</span>
		<span class="flex shrink-0 items-center gap-1">
			<button
				type="button"
				class="rounded-lg bg-white p-1 text-surface-700 shadow-sm transition-colors hover:bg-primary-500 hover:text-white disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-surface-700 dark:bg-surface-900 dark:text-surface-200 dark:disabled:hover:bg-surface-900"
				disabled={indice <= 0}
				aria-label="Mover {rotulo} para cima"
				onclick={() => organizacao.mover(secao, indice, indice - 1)}
			>
				<ChevronUp size={16} />
			</button>
			<button
				type="button"
				class="rounded-lg bg-white p-1 text-surface-700 shadow-sm transition-colors hover:bg-primary-500 hover:text-white disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-surface-700 dark:bg-surface-900 dark:text-surface-200 dark:disabled:hover:bg-surface-900"
				disabled={indice >= total - 1}
				aria-label="Mover {rotulo} para baixo"
				onclick={() => organizacao.mover(secao, indice, indice + 1)}
			>
				<ChevronDown size={16} />
			</button>
		</span>
	</div>

	<!-- Inerte só no CARD, e é o que a aninhagem cobra: o conteúdo de um bloco são
	     os cards dele, cada um com a SUA barra de setas. Marcar o bloco inteiro
	     inerte apagava esses botões — o wrapper do bloco passava a interceptar o
	     clique que era do card. A inércia pertence à folha, que é onde de fato há
	     controle a silenciar (a caixinha de exportação no canto). -->
	<div
		class="flex-1 cursor-grab select-none active:cursor-grabbing {ehBloco
			? ''
			: 'pointer-events-none'}"
	>
		{@render children()}
	</div>
</div>
