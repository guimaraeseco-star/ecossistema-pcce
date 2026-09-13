<script lang="ts">
	/**
	 * Escalas extras FINALIZADAS — aba do Admin Geral.
	 *
	 * Era o bloco Histórico no rodapé de `/gise`. Saiu para uma rota própria
	 * para a lista de ativas não carregar o arquivo por baixo da dobra, e para
	 * o menu poder apontar para cada uma.
	 *
	 * Recusa quem não é Admin Geral no `load`; esta tela só apresenta.
	 */
	import type { PageProps } from './$types';
	import SecaoHistorico from '../_components/SecaoHistorico.svelte';
	import FiltroOperacaoGise from '../_components/FiltroOperacaoGise.svelte';

	const { data }: PageProps = $props();

	const escalas = $derived(data.escalas ?? []);
	const operacoes = $derived(data.operacoes ?? []);
	const seccionaisList = $derived(data.seccionaisList ?? []);

	let filtroOperacaoId = $state<number | null>(null);

	const historico = $derived(
		filtroOperacaoId === null ? escalas : escalas.filter((e) => e.operacao_id === filtroOperacaoId)
	);
</script>

<svelte:head>
	<title>Finalizadas | Ecossistema PCCE</title>
</svelte:head>

<div class="min-w-0 space-y-6">
	<div>
		<h1 class="h1 min-w-0 text-2xl font-bold">Finalizadas</h1>
		<p class="text-xs font-medium text-surface-600 dark:text-surface-400">
			Escalas extras encerradas.
		</p>
	</div>

	<FiltroOperacaoGise
		{operacoes}
		value={filtroOperacaoId}
		onChange={(id) => (filtroOperacaoId = id)}
	/>

	<SecaoHistorico {historico} {seccionaisList} isAdminGeral={true} />
</div>
