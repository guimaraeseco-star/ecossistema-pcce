<script lang="ts">
	/**
	 * Municípios — o MAPA (fase 2-B): cabeçalho com o departamento e a escolha
	 * do critério de cor (AIS ou seccional); o desenho, a legenda e o painel do
	 * município ficam em `_components/MapaMunicipios.svelte`.
	 */
	import type { PageProps } from './$types';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import MapaMunicipios from '../_components/MapaMunicipios.svelte';

	const { data }: PageProps = $props();
	let corPor = $state<'ais' | 'seccional'>('ais');
</script>

<svelte:head>
	<title>Mapa dos municípios | Ecossistema PCCE</title>
</svelte:head>

<BotaoVoltar href="/municipios" />

<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
	<div>
		<p
			class="text-2xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-400"
		>
			Municípios · mapa
		</p>
		<h1 class="h1 mt-0.5 text-2xl font-bold">
			{data.departamento.sigla || data.departamento.nome}
		</h1>
		<p class="mt-1 text-sm text-surface-600 dark:text-surface-400">
			{data.municipios.length} município{data.municipios.length === 1 ? '' : 's'} atendido{data
				.municipios.length === 1
				? ''
				: 's'}; os demais municípios do Ceará aparecem em cinza.
		</p>
	</div>
	<div class="flex items-center gap-2 text-sm">
		<span class="text-surface-600 dark:text-surface-400">Cor por</span>
		<div class="flex overflow-hidden rounded-lg border border-surface-300 dark:border-white/10">
			{#each [['ais', 'AIS'], ['seccional', 'Seccional']] as const as [valor, rotulo] (valor)}
				<button
					type="button"
					class="px-3 py-1.5 text-xs font-semibold {corPor === valor
						? 'bg-primary-600 text-white'
						: 'bg-white text-surface-700 hover:bg-surface-100 dark:bg-surface-900 dark:text-surface-200 dark:hover:bg-surface-800'}"
					aria-pressed={corPor === valor}
					onclick={() => (corPor = valor)}>{rotulo}</button
				>
			{/each}
		</div>
	</div>
</div>

<MapaMunicipios municipios={data.municipios} {corPor} />
