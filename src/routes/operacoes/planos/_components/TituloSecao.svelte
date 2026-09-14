<script lang="ts">
	/**
	 * Título de quadro nas telas de plano operacional.
	 *
	 * **Usado pelas DUAS rotas da família `/operacoes/planos`:** a criação
	 * (`novo/+page.svelte`) e o editor (`[id]/+page.svelte`). Editar aqui mexe nas
	 * duas — declaração exigida pela regra de "pasta de família" do `CLAUDE.md`.
	 *
	 * O `uppercase tracking-wider` é o que separa o nome do quadro dos rótulos
	 * dos campos: sem isso, "Identificação" e "Nome da operação" pesam igual.
	 */
	const { texto, apoio }: { texto: string; apoio?: string } = $props();
</script>

<div>
	<h2 class="text-sm font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400">
		{texto}
	</h2>
	{#if apoio}
		<p class="text-xs text-surface-600 dark:text-surface-400 mt-1 normal-case">{apoio}</p>
	{/if}
</div>
