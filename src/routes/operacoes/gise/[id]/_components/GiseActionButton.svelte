<script lang="ts">
	/**
	 * Botão/link de ação padrão das telas de GISE. Substitui o antigo snippet
	 * `actionButton` de GiseSeccional — como componente, pode ser usado pelos
	 * sub-componentes (relatórios, slots, equipes) sem prop-drilling do snippet.
	 * Mantém a assinatura do snippet original: `type` é o preset visual
	 * (outlined/filled/tonal) e `btnType` o atributo HTML do botão.
	 *
	 * C-MANTER (auditoria componentização 06/ago): NÃO unificar com
	 * `res-gise/_components/BotoesAcao.svelte`. Os dois clusters já divergem
	 * visualmente (href/loading/pendingCrud vs snippet module); fundir seria
	 * forçar uma API comum pior que a duplicação deliberada.
	 */
	import { loading } from '$lib/loading.svelte';
	const {
		label,
		iconPath = undefined,
		variant = 'surface',
		type = 'outlined',
		onclick = undefined,
		href = undefined,
		disabled = false,
		isLoading = false,
		classes = '',
		btnType = 'button',
		size = 'sm',
		pendingCrud = false
	}: {
		label: string;
		iconPath?: string;
		variant?: string;
		type?: string;
		onclick?: () => void;
		href?: string;
		disabled?: boolean;
		isLoading?: boolean;
		classes?: string;
		btnType?: 'button' | 'submit';
		size?: string;
		/** Flag de CRUD em andamento do composable — desabilita como o snippet fazia. */
		pendingCrud?: boolean;
	} = $props();

	const baseClass = $derived(
		`btn btn-${size} preset-${type}-${variant}-500 rounded-lg font-semibold min-w-0 max-w-full text-center whitespace-normal sm:whitespace-nowrap transition-all flex items-center justify-center gap-1.5 ${classes}`
	);
</script>

{#snippet btnIcon(path: string)}
	<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={path} />
	</svg>
{/snippet}

{#if href}
	<a class="{baseClass} no-underline" {href} target="_blank">
		{#if iconPath}{@render btnIcon(iconPath)}{/if}
		{label}
	</a>
{:else}
	<button
		class={baseClass}
		{onclick}
		disabled={disabled || loading.active || pendingCrud || isLoading}
		type={btnType}
	>
		{#if iconPath}
			{@render btnIcon(iconPath)}
		{/if}
		{label}
	</button>
{/if}
