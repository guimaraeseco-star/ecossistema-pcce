<script lang="ts">
	/**
	 * DOCUMENTOS do quadro de supervisão — orquestra escala GISE, relatório de
	 * extra e o snippet opcional `loteSection`.
	 *
	 * `loteSection` é o único prop, e é conteúdo, não estado: o card de
	 * assinaturas em lote é montado pela página (usa os pendentes e os fluxos de
	 * assinatura dela) e só é POSICIONADO aqui.
	 *
	 * O que a permissão controla é o BOTÃO de download/assinatura, não a
	 * visibilidade do bloco (`quadro.exigeRelatorioExtra`).
	 */
	import type { Snippet } from 'svelte';
	import SupervisaoDocEscala from './SupervisaoDocEscala.svelte';
	import SupervisaoDocExtra from './SupervisaoDocExtra.svelte';
	import { quadroSupervisao } from './quadro-supervisao-estado.svelte';

	const { loteSection }: { loteSection?: Snippet } = $props();

	const quadro = quadroSupervisao();

	const mostrarColEscala = $derived(
		!!quadro.documentoAssinadoInfo?.existe ||
			quadro.mostrarPainelAssinaturaEscala ||
			quadro.painelAssinaturaEscalaReadonly ||
			quadro.isSupervisor
	);

	const mostrarSecaoDocumentos = $derived(
		mostrarColEscala || quadro.exigeRelatorioExtra || !!loteSection
	);
</script>

{#if mostrarSecaoDocumentos}
	<div class="border-t border-surface-200/60 dark:border-surface-700/60 pt-3 mt-4 sm:mt-5">
		<div class="flex flex-col gap-4">
			{#if mostrarColEscala}
				<SupervisaoDocEscala />
			{/if}

			{#if quadro.exigeRelatorioExtra}
				<SupervisaoDocExtra />
			{/if}

			{@render loteSection?.()}
		</div>
	</div>
{/if}
