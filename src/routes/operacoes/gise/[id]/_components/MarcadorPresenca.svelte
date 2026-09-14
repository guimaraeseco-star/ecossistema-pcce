<script lang="ts">
	/**
	 * Indicador de presença do escalado: um par de selos "Entrada" / "Saída", cada
	 * um com ícone de FEITO (✓ verde) ou AGUARDANDO (relógio âmbar).
	 *
	 * Antes a UI mostrava um selo só — "Entrada" quando faltava a saída e "✓"
	 * quando as duas estavam confirmadas — e NADA quando nem a entrada existia.
	 * Ou seja: "aguardando entrada" era visualmente idêntico a "sem informação".
	 * Aqui os dois momentos são sempre explícitos.
	 *
	 * Compartilhado pelo quadro de supervisão (ao lado do rótulo do papel, para não
	 * disputar espaço com o nome) e pelos cards de membro das equipes.
	 */
	import Check from '@lucide/svelte/icons/check';
	import Clock from '@lucide/svelte/icons/clock';
	import FileText from '@lucide/svelte/icons/file-text';

	const {
		entrada,
		saida,
		/** SEINT com entrada+saída confirmadas mas relatório SEINT ainda não enviado. */
		faltaRelatorio = false
	}: {
		entrada: boolean;
		saida: boolean;
		faltaRelatorio?: boolean;
	} = $props();

	const OK = 'bg-success-500/15 text-success-700 dark:text-success-400';
	const PEND = 'bg-warning-500/15 text-warning-700 dark:text-warning-400';
</script>

{#snippet selo(rotulo: string, feito: boolean)}
	<span
		class="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-3xs font-bold leading-none whitespace-nowrap {feito
			? OK
			: PEND}"
		title={feito ? `${rotulo} confirmada` : `Aguardando confirmação de ${rotulo.toLowerCase()}`}
	>
		{#if feito}
			<Check size={10} class="shrink-0" />
		{:else}
			<Clock size={10} class="shrink-0" />
		{/if}
		{rotulo}
	</span>
{/snippet}

<span class="inline-flex flex-wrap items-center gap-1">
	{@render selo('Entrada', entrada)}
	{@render selo('Saída', saida)}
	{#if faltaRelatorio}
		<span
			class="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-3xs font-bold leading-none whitespace-nowrap {PEND}"
			title="Falta enviar o relatório SEINT (entrada e saída já confirmadas)"
		>
			<FileText size={10} class="shrink-0" />
			Relatório
		</span>
	{/if}
</span>
