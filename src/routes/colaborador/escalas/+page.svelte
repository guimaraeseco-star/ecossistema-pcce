<script lang="ts">
	/**
	 * Escalas da unidade do colaborador, em leitura (E61). Mês e ano na URL;
	 * cada linha abre `/escalas/[id]` — que, para ele, não tem botão de edição.
	 */
	import type { PageProps } from './$types';
	import { formatarData, MESES_PT } from '$lib/utils/datas';

	const { data }: PageProps = $props();
	const ROTULO: Record<string, string> = {
		plantao: 'Plantão',
		expediente: 'Expediente',
		fds: 'FDS'
	};
	const anterior = $derived(
		data.mes === 1 ? { mes: 12, ano: data.ano - 1 } : { mes: data.mes - 1, ano: data.ano }
	);
	const proximo = $derived(
		data.mes === 12 ? { mes: 1, ano: data.ano + 1 } : { mes: data.mes + 1, ano: data.ano }
	);
</script>

<svelte:head>
	<title>Escalas da unidade | Ecossistema PCCE</title>
</svelte:head>

<div class="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
	<div>
		<h1 class="h1 text-2xl font-bold">Escalas — {data.unidade}</h1>
		<p class="mt-1 text-sm text-surface-600 dark:text-surface-400">
			Só leitura: a unidade liberou ver as escalas, não montá-las.
		</p>
	</div>
	<div class="flex items-center gap-2 text-sm">
		<a
			class="btn btn-sm preset-outlined-surface-500"
			href="/colaborador/escalas?mes={anterior.mes}&ano={anterior.ano}">‹</a
		>
		<span class="min-w-40 text-center font-semibold">{MESES_PT[data.mes - 1]} de {data.ano}</span>
		<a
			class="btn btn-sm preset-outlined-surface-500"
			href="/colaborador/escalas?mes={proximo.mes}&ano={proximo.ano}">›</a
		>
	</div>
</div>

<div class="overflow-x-auto rounded-2xl border border-surface-200 dark:border-white/10">
	<table class="table w-full">
		<thead>
			<tr>
				<th>Escala</th>
				<th>Tipo</th>
				<th>Período</th>
				<th>Situação</th>
			</tr>
		</thead>
		<tbody>
			{#if data.escalas.length === 0}
				<tr>
					<td colspan="4" class="py-8 text-center text-surface-600 dark:text-surface-400">
						Nenhuma escala neste mês.
					</td>
				</tr>
			{/if}
			{#each data.escalas as e (e.id)}
				<tr>
					<td>
						<a
							href="/escalas/{e.id}"
							class="font-medium text-primary-700 underline-offset-2 hover:underline dark:text-primary-400"
							>{e.titulo}</a
						>
					</td>
					<td class="text-sm">{ROTULO[e.tipo ?? ''] ?? e.tipo ?? '—'}</td>
					<td class="text-sm tabular-nums"
						>{formatarData(e.data_inicio)} – {formatarData(e.data_fim)}</td
					>
					<td class="text-xs">
						{#if e.assinada}
							<span class="font-semibold text-success-700 dark:text-success-400">Assinada</span>
						{:else if e.finalizada}
							<span class="font-semibold text-surface-600 dark:text-surface-300">Enviada</span>
						{:else}
							<span class="text-warning-700 dark:text-warning-400">Em preenchimento</span>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
