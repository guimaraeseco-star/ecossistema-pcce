<script lang="ts">
	/**
	 * Par Adicionar/Fechar da edição inline de um papel do quadro de supervisão
	 * (supervisor, assessor, SEINT 1/2) — mesma marcação nos quatro slots.
	 */
	import Spinner from '$lib/components/Spinner.svelte';

	const {
		pending,
		onCancelar,
		class: klass = ''
	}: { pending: boolean; onCancelar: () => void; class?: string } = $props();
</script>

<div class="w-full grid grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 {klass}">
	<button
		type="submit"
		class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg w-full sm:w-auto transition-all"
		disabled={pending}
	>
		{#if pending}
			<Spinner size="sm" />
		{:else}
			Adicionar
		{/if}
	</button>
	<button
		type="button"
		class="btn preset-outlined-surface-500 text-sm px-3 py-1.5 rounded-lg w-full sm:w-auto"
		onclick={onCancelar}
		disabled={pending}
	>
		Fechar
	</button>
</div>
