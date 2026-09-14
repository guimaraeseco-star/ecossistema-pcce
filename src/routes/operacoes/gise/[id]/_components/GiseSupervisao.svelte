<script lang="ts">
	/**
	 * Cabeçalho da seção QUADRO DE SUPERVISÃO da GISE: título, o aviso de
	 * assinatura pendente e a ordem dos dois blocos —
	 *   1. `SupervisaoDesignacao` — designar papéis (Admin Geral);
	 *   2. `SupervisaoDocumentos` — assinaturas de escala e extra do quadro.
	 *
	 * Não repassa nada: o estado do quadro vem do contexto publicado pela página
	 * (`supervisao/quadro-supervisao-estado.svelte.ts`, cujo cabeçalho explica
	 * por que é contexto e não props). O único prop é o snippet `loteSection`,
	 * que é conteúdo montado pela página.
	 *
	 * Sem "card" externo: o quadro é uma SEÇÃO da página (título + blocos), não
	 * um cartão dentro de cartão.
	 */
	import type { Snippet } from 'svelte';
	import Clock from '@lucide/svelte/icons/clock';
	import SupervisaoDesignacao from './supervisao/SupervisaoDesignacao.svelte';
	import SupervisaoDocumentos from './supervisao/SupervisaoDocumentos.svelte';
	import { quadroSupervisao } from './supervisao/quadro-supervisao-estado.svelte';

	const { loteSection }: { loteSection?: Snippet } = $props();

	const quadro = quadroSupervisao();

	const avisarEscalaPendente = $derived(
		!quadro.editando &&
			!quadro.documentoAssinadoInfo?.existe &&
			quadro.exigeRelatorioExtra &&
			!(quadro.mostrarPainelAssinaturaEscala || quadro.painelAssinaturaEscalaReadonly)
	);
</script>

<section class="space-y-3 sm:space-y-5">
	<div class="flex flex-wrap items-baseline justify-between gap-2 sm:gap-4">
		<h2 class="text-xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">
			Supervisão e apoio
		</h2>

		<div class="flex w-full sm:w-auto flex-wrap items-center justify-end gap-2 sm:gap-3">
			{#if avisarEscalaPendente}
				<span
					class="inline-flex items-center gap-1.5 rounded-full bg-warning-500 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-warning-500/20"
				>
					<Clock size={12} class="shrink-0" />
					Ass. Escala Pend.
				</span>
			{/if}
		</div>
	</div>

	<SupervisaoDesignacao />

	<SupervisaoDocumentos {loteSection} />
</section>
