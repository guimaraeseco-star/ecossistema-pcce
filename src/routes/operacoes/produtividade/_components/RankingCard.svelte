<script lang="ts">
	/**
	 * Card de ranking por unidade (prisões / drogas / armas) no painel de
	 * produtividade — selecionável para export PNG/PDF.
	 *
	 * O rótulo de cada linha vem de fora (`rotuloGrupo`) porque o card serve aos
	 * dois eixos do painel: dizer "Seccional" acima do nome de uma delegacia é
	 * informação errada, não rótulo velho.
	 */
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';
	import type { Snippet } from 'svelte';
	import type { RankingItem } from '$lib/export-charts';

	const {
		id,
		title,
		ranking,
		color,
		icon,
		labelUnit,
		rotuloGrupo,
		selected,
		onToggle
	}: {
		id: string;
		title: string;
		ranking: RankingItem[];
		color: string;
		icon: Snippet<[string]>;
		labelUnit: string;
		/** "Seccional" ou "Delegacia" — o que cada linha do ranking É. */
		rotuloGrupo: string;
		selected: boolean;
		onToggle: (id: string) => void;
	} = $props();
</script>

<div
	class="card relative p-4 sm:p-6 bg-white dark:bg-surface-900 text-surface-900 dark:text-white border-2 transition-colors {selected
		? 'selected-for-export border-primary-500'
		: 'border-surface-200 dark:border-surface-800'} rounded-3xl flex flex-col h-full"
>
	<button
		type="button"
		onclick={() => onToggle(id)}
		aria-pressed={selected}
		aria-label={selected
			? 'Remover ranking da seleção de exportação'
			: 'Selecionar ranking para exportação'}
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
		<div class="p-2 rounded-lg" style="background: {color}20">
			{@render icon(color)}
		</div>
		<h3 class="text-lg font-black uppercase tracking-tighter">
			{title}
		</h3>
	</div>
	<div class="overflow-y-auto pr-2 custom-scrollbar flex-1">
		{#each ranking as item, idx (item.nome)}
			<div
				class="flex items-center gap-4 py-2.5 px-1 border-b border-surface-200/60 dark:border-white/5 last:border-0"
			>
				<span class="text-lg font-black text-surface-400 dark:text-surface-500 w-6 italic"
					>#{idx + 1}</span
				>
				<div class="flex-1">
					<p
						class="text-3xs font-black uppercase text-surface-600 dark:text-surface-400 leading-none mb-1"
					>
						{rotuloGrupo}
					</p>
					<!-- `title` com o nome inteiro: o `line-clamp-1` corta duas delegacias
					     do mesmo município no mesmo ponto. -->
					<p class="text-xs font-bold leading-tight line-clamp-1" title={item.nome}>
						{item.curto ?? item.nome}
					</p>
				</div>
				<div class="text-right">
					<p class="text-xl font-black" style="color: {color}">
						{labelUnit === 'kg' ? (item.total / 1000).toFixed(1) : item.total}<span
							class="text-3xs ml-0.5 opacity-50">{labelUnit}</span
						>
					</p>
					<p class="text-3xs font-bold uppercase opacity-50">Produção</p>
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: #64748b30;
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: #64748b60;
	}
</style>
