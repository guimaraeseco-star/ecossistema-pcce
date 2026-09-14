<script lang="ts">
	/**
	 * Recorte por operação nas listas `/operacoes/gise` (ativas) e `/operacoes/gise/finalizadas`.
	 *
	 * Só desenha quando há mais de uma operação — com uma só, o controle não
	 * filtraria nada. As duas telas compartilham este chip para o guard de
	 * duplicação não acusar o bloco copiado.
	 */
	import { CLASSE_ROTULO_FILTRO } from '$lib/gise/filtro-historico-ui';

	const {
		operacoes,
		value,
		onChange
	}: {
		operacoes: { id: number; sigla?: string | null; nome: string }[];
		value: number | null;
		onChange: (id: number | null) => void;
	} = $props();
</script>

{#if operacoes.length > 1}
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<span class={CLASSE_ROTULO_FILTRO}>Operação</span>
		<button
			type="button"
			class="rounded-full px-3 py-1 text-2xs font-semibold transition-colors {value === null
				? 'bg-primary-500 text-white'
				: 'bg-surface-200 text-surface-700 dark:bg-surface-800 dark:text-surface-300'}"
			onclick={() => onChange(null)}
		>
			Todas
		</button>
		{#each operacoes as op (op.id)}
			<button
				type="button"
				class="rounded-full px-3 py-1 text-2xs font-semibold transition-colors {value === op.id
					? 'bg-primary-500 text-white'
					: 'bg-surface-200 text-surface-700 dark:bg-surface-800 dark:text-surface-300'}"
				onclick={() => onChange(op.id)}
			>
				{op.sigla || op.nome}
			</button>
		{/each}
	</div>
{/if}
