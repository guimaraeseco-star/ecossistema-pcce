<script lang="ts">
	/**
	 * Data, feriado e horários — o quadro "Data de execução".
	 *
	 * **Usado pelas DUAS rotas da família `/operacoes/planos`:** a criação
	 * (`novo/+page.svelte`) e o editor (`[id]/+page.svelte`). Editar aqui mexe nas
	 * duas — declaração exigida pela regra de "pasta de família" do `CLAUDE.md`.
	 *
	 * O calendário e os `hidden` da data/feriado são idênticos nas duas telas.
	 * Os horários também POSTAM os mesmos `name`; o que muda é o texto de apoio
	 * (criação vs. editor) e o placeholder da criação.
	 */
	import CalendarioDia from '$lib/components/CalendarioDia.svelte';
	import TituloSecao from './TituloSecao.svelte';

	let {
		dataInicio = $bindable(),
		feriado = $bindable(false),
		horaInicio = $bindable(''),
		horaFim = $bindable(''),
		dataFim = $bindable(''),
		apoioTermino,
		notaRodape,
		placeholderHoraInicio = '',
		placeholderHoraFim = ''
	}: {
		dataInicio: string;
		feriado: boolean;
		horaInicio: string;
		horaFim: string;
		dataFim: string;
		apoioTermino: string;
		notaRodape: string;
		placeholderHoraInicio?: string;
		placeholderHoraFim?: string;
	} = $props();
</script>

<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
	<TituloSecao
		texto="Data de execução"
		apoio="Escolha a data da operação. Caso seja feriado, dê um clique duplo no dia escolhido."
	/>

	<CalendarioDia bind:valor={dataInicio} bind:feriado />
	<input type="hidden" name="data_inicio" value={dataInicio} />
	{#if feriado}<input type="hidden" name="feriado" value="1" />{/if}

	<div class="grid grid-cols-1 gap-4 xs:grid-cols-2 sm:flex sm:flex-wrap">
		<label class="block min-w-0 space-y-1">
			<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
				>Horário de apresentação</span
			>
			<input
				name="hora_inicio"
				bind:value={horaInicio}
				placeholder={placeholderHoraInicio}
				class="input w-full sm:w-32"
			/>
		</label>
		<label class="block min-w-0 space-y-1">
			<span class="text-sm font-medium text-surface-700 dark:text-surface-200">
				Previsão de término <span class="text-surface-600 dark:text-surface-400"
					>{apoioTermino}</span
				>
			</span>
			<input
				name="hora_fim"
				bind:value={horaFim}
				placeholder={placeholderHoraFim}
				class="input w-full sm:w-32"
			/>
		</label>
		<label class="block min-w-0 space-y-1 xs:col-span-2 sm:col-auto">
			<span class="text-sm font-medium text-surface-700 dark:text-surface-200">
				Data de término <span class="text-surface-600 dark:text-surface-400">(se virar o dia)</span>
			</span>
			<input type="date" name="data_fim" bind:value={dataFim} class="input w-full sm:w-44" />
		</label>
	</div>
	<p class="text-xs text-surface-600 dark:text-surface-400">{notaRodape}</p>
</section>
