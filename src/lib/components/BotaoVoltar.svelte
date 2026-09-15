<script lang="ts">
	/**
	 * Botão "← VOLTAR" do topo de tela de detalhe — acima do `<h1>`, nunca no
	 * rodapé.
	 *
	 * Existe porque o mesmo bloco (botão contornado pequeno + seta que desliza no
	 * hover + rótulo em maiúsculas) estava copiado em cinco arquivos, um deles já
	 * com `ArrowLeft` do lucide e os outros com o SVG à mão. Cada cópia era uma
	 * chance de a próxima tela nascer com outro tamanho de seta ou outro peso de
	 * fonte — que foi exatamente o que aconteceu com o wizard do relatório.
	 *
	 * `href` renderiza um `<a>` (navegação de verdade: nova aba, URL visível);
	 * `onclick` renderiza um `<button>`, para quem volta desfazendo estado local
	 * em vez de mudar de rota. Passar os dois é erro de uso — o `href` vence.
	 *
	 * Com `href`, o clique normal VOLTA pelo histórico quando a página foi
	 * alcançada de dentro do app (`useOrigemDaNavegacao`): é o que impede o
	 * pingue-pongue lista → ficha → lista que o voltar do navegador fazia depois
	 * de um "Voltar" que empilhava navegação nova. O `href` continua sendo o
	 * destino de "abrir em nova aba" e o de quem chegou pela URL.
	 */
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { useOrigemDaNavegacao } from '$lib/composables';

	const {
		href,
		onclick,
		rotulo = 'Voltar',
		class: classe = ''
	}: {
		href?: string;
		onclick?: () => void;
		/** Só troque quando o destino não for óbvio ("Voltar para a escala"). */
		rotulo?: string;
		class?: string;
	} = $props();

	const origem = useOrigemDaNavegacao();

	/** Clique simples com histórico do app: desfaz a entrada em vez de empilhar outra. */
	function voltarPeloHistorico(e: MouseEvent) {
		if (!origem.podeVoltar || e.defaultPrevented) return;
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		history.back();
	}

	const CLASSES =
		'btn btn-sm preset-outlined-surface-500 hover:bg-surface-50 dark:hover:bg-surface-900 px-3 py-1.5 rounded-xl transition-all flex w-fit max-w-full items-center gap-2 group';
</script>

{#snippet conteudo()}
	<ArrowLeft size={16} class="shrink-0 transition-transform group-hover:-translate-x-1" />
	<span class="text-sm font-bold uppercase tracking-wider">{rotulo}</span>
{/snippet}

{#if href}
	<a {href} class="{CLASSES} {classe}" onclick={voltarPeloHistorico}>{@render conteudo()}</a>
{:else}
	<button type="button" class="{CLASSES} {classe}" {onclick}>{@render conteudo()}</button>
{/if}
