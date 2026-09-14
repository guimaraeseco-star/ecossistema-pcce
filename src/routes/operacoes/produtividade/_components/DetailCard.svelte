<script lang="ts">
	/**
	 * Card de detalhamento (breakdown) ao lado do ranking — selecionável
	 * para export PNG/PDF.
	 */
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';
	const {
		id,
		title,
		details,
		total,
		color,
		unit,
		selected,
		onToggle
	}: {
		id: string;
		title: string;
		details: [string, number][];
		total: number;
		color: string;
		unit: string;
		selected: boolean;
		onToggle: (id: string) => void;
	} = $props();
</script>

<div
	class="card relative p-4 sm:p-6 bg-white dark:bg-surface-900 border-2 transition-colors {selected
		? 'selected-for-export border-primary-500'
		: 'border-surface-200 dark:border-surface-800'} rounded-3xl flex flex-col h-full"
>
	<button
		type="button"
		onclick={() => onToggle(id)}
		aria-pressed={selected}
		aria-label={selected
			? 'Remover detalhamento da seleção de exportação'
			: 'Selecionar detalhamento para exportação'}
		class="absolute top-2 right-2 md:top-3 md:right-3 w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl flex items-center justify-center transition-colors {selected
			? 'bg-primary-500 text-white'
			: 'bg-surface-100 dark:bg-surface-800 text-surface-500'}"
	>
		{#if selected}
			<Check class="w-4 h-4 md:w-6 md:h-6" strokeWidth={4} aria-hidden="true" />
		{:else}
			<Plus class="w-3 h-3 md:w-5 md:h-5 opacity-40" strokeWidth={3} aria-hidden="true" />
		{/if}
	</button>

	<div class="flex items-center gap-3 mb-6">
		<div class="p-2 rounded-lg" style="background: {color}10">
			<svg
				class="w-5 h-5"
				style="color: {color}"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
				/></svg
			>
		</div>
		<h3 class="text-lg font-black uppercase tracking-tighter text-surface-900 dark:text-surface-50">
			{title}
		</h3>
	</div>
	<div class="space-y-4 flex-1">
		{#each details as [tipo, valor] (tipo)}
			<div class="space-y-1">
				<div class="flex justify-between text-3xs font-black uppercase">
					<span class="text-surface-600 dark:text-surface-400">{tipo}</span>
					<span style="color: {color}"
						>{unit === 'kg' ? (valor / 1000).toFixed(1) : valor.toLocaleString()}{unit}</span
					>
				</div>
				<div class="h-2 w-full bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
					<div
						class="h-full transition-all duration-1000"
						style="background: {color}; width: {(valor / (total || 1)) * 100}%"
					></div>
				</div>
			</div>
		{:else}
			<p class="text-center text-xs text-surface-600 dark:text-surface-400 italic py-8">
				Sem registros no período.
			</p>
		{/each}
	</div>
</div>
