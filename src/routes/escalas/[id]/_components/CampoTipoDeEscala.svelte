<script lang="ts">
	/**
	 * "Tipo de Escala" (1×3 ou 2×6) — o campo que o formulário de equipe nova e
	 * o formulário rápido de OIP mostram igual. Virou caixa de busca na E76
	 * (etapa 2); morando aqui, os dois não voltam a divergir.
	 */
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';

	let { value = $bindable() }: { value: '1x3' | '2x6' } = $props();

	const OPCOES = [
		{ value: '1x3', label: '1×3' },
		{ value: '2x6', label: '2×6' }
	];
</script>

<label class="label sm:col-span-2">
	<span class="label-text">Tipo de Escala</span>
	<SearchableSelect ariaLabel="Tipo de Escala" bind:value options={OPCOES} obrigatorio />
</label>
