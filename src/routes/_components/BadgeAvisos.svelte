<script lang="ts">
	/**
	 * O número dos avisos (E59) — pendências + notícias não lidas — no canto
	 * de um cartão da home ou de um módulo. Some quando é zero. Dourado, e não
	 * azul, porque é ATENÇÃO: o que está ali depende de alguém.
	 */
	const { n, rotulo = 'avisos' }: { n: number; rotulo?: string } = $props();
</script>

{#if n > 0}
	<span
		class="absolute top-3 right-3 flex h-6 min-w-6 items-center justify-center rounded-full bg-warning-500 px-1.5 text-xs font-bold text-white tabular-nums shadow"
		aria-label={`${n} ${rotulo}`}
	>
		{n > 99 ? '99+' : n}
	</span>
{/if}
