<script lang="ts">
	/**
	 * Modal de data e horários da GISE: calendário de UM dia (com marcação de
	 * feriado) e as horas de entrada/saída do serviço.
	 *
	 * O calendário é desenhado à mão, não é `<input type="date">`, porque
	 * precisa de um estado que o nativo não tem: clicar no dia JÁ selecionado
	 * alterna feriado em vez de reselecionar. Feriado muda o pagamento do
	 * extraordinário, então é decisão consciente e não um efeito colateral de
	 * escolher a data.
	 *
	 * Datas se montam com `isoData(ano, mês 1-12, dia)`, nunca com
	 * `toISOString()` sobre um `Date` local — a diferença some em UTC e aparece
	 * como um dia de erro no fuso de Brasília. `calMes` é 0-based (vem de
	 * `getMonth`), daí o `+1` na chamada.
	 *
	 * Os campos são preenchidos no `$effect` da abertura, não na criação: o
	 * modal permanece montado entre aberturas, e sem isso ele mostraria os
	 * valores da GISE anterior.
	 */
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import {
		MESES_PT,
		DIAS_SEMANA_CURTO,
		isoData,
		hojeLocalISO,
		formatarData as fmtDate
	} from '$lib/utils/datas';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toaster } from '$lib/toast';
	import { normalizarHora, validarHora } from '$lib/gise/horarios';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';

	interface GiseInfo {
		data_inicio: string;
		hora_entrada: string | null;
		hora_saida: string | null;
		feriado?: boolean | number;
	}

	interface Props {
		open: boolean;
		pendingCrud: boolean;
		editaBloqueado: boolean;
		gise: GiseInfo;
		onClose: () => void;
		onSubmit: SubmitFunction;
	}

	const { open, pendingCrud, editaBloqueado, gise, onClose, onSubmit }: Props = $props();

	// Estado do calendário e horários
	let dataInicio = $state('');
	let feriado = $state(false);
	let horaEntrada = $state('');
	let horaSaida = $state('');

	// Lógica do calendário
	let calAno = $state(new Date().getFullYear());
	let calMes = $state(new Date().getMonth());

	const calTitulo = $derived(`${MESES_PT[calMes]} de ${calAno}`);
	const gradeCalendario = $derived.by(() => {
		const first = new Date(calAno, calMes, 1).getDay();
		const n = new Date(calAno, calMes + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < first; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		return cells;
	});

	const hoje = hojeLocalISO;

	function selecionarDia(iso: string) {
		if (dataInicio === iso) {
			feriado = !feriado;
		} else {
			dataInicio = iso;
			feriado = false;
		}
	}

	function calMesAnterior() {
		if (calMes === 0) {
			calMes = 11;
			calAno--;
		} else {
			calMes--;
		}
	}

	function calMesProximo() {
		if (calMes === 11) {
			calMes = 0;
			calAno++;
		} else {
			calMes++;
		}
	}

	$effect(() => {
		if (open) {
			dataInicio = gise.data_inicio;
			feriado = !!gise.feriado;
			horaEntrada = gise.hora_entrada ?? '';
			horaSaida = gise.hora_saida ?? '';
			const [y, m] = dataInicio.split('-').map(Number);
			calAno = y;
			calMes = m - 1;
		}
	});

	const onSubmitWrapper: SubmitFunction = (input) => {
		const horas = [horaEntrada, horaSaida];
		if (horas.some((h) => !h)) {
			toaster.error({ title: 'Preencha todos os horários' });
			input.cancel();
			return;
		}
		if (horas.some((h) => !validarHora(h))) {
			toaster.error({ title: 'Formato inválido', description: 'Use o formato HH:MM, ex: 14:00' });
			input.cancel();
			return;
		}
		return onSubmit(input);
	};
</script>

<!--
	Exceção deliberada ao ModalShell: o calendário usa painel mais baixo,
	header compacto com CloseTrigger próprio e formulário integrado. Essas três
	diferenças são de interação, não apenas classes visuais.
-->
<Dialog
	{open}
	onOpenChange={(e) => {
		if (!pendingCrud && !e.open) onClose();
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card-elevated rounded-2xl shadow-2xl w-full max-w-lg p-3 sm:p-4 space-y-3 max-h-[calc(100dvh-1rem)] overflow-y-auto"
		>
			<div class="flex items-center justify-between">
				<Dialog.Title class="text-base sm:text-lg font-bold text-surface-900 dark:text-surface-50">
					Editar Data e Horários
				</Dialog.Title>
				<Dialog.CloseTrigger
					class="btn btn-sm p-1 opacity-50 hover:opacity-100"
					aria-label="Fechar"
				>
					<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/></svg
					>
				</Dialog.CloseTrigger>
			</div>

			{#if editaBloqueado}
				<div
					class="rounded-xl bg-warning-500/10 border border-warning-500/30 px-3 py-2 text-xs text-warning-700 dark:text-warning-400"
				>
					<AlertTriangle class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> A assinatura digital
					será <strong>revogada</strong> ao salvar.
				</div>
			{/if}

			<p class="text-3xs sm:text-xs text-surface-600 dark:text-surface-400 leading-snug">
				No calendário: <span class="text-primary-600 dark:text-primary-400 font-medium"
					>1º clique</span
				>
				seleciona a data,
				<span class="text-error-600 dark:text-error-400 font-medium">2º clique</span> marca como feriado.
			</p>

			<!-- Calendário -->
			<div
				class="rounded-xl border border-surface-200 dark:border-surface-700 p-2 sm:p-2.5 space-y-1 bg-white dark:bg-surface-800/40"
			>
				<div class="flex items-center justify-between gap-1.5">
					<button
						type="button"
						class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
						onclick={calMesAnterior}
						aria-label="Mês anterior"
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 19l-7-7 7-7"
							/></svg
						>
					</button>
					<p
						class="text-xs sm:text-sm font-semibold text-surface-800 dark:text-surface-100 text-center flex-1"
					>
						{calTitulo}
					</p>
					<button
						type="button"
						class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
						onclick={calMesProximo}
						aria-label="Próximo mês"
					>
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5l7 7-7 7"
							/></svg
						>
					</button>
				</div>
				<div
					class="grid grid-cols-7 gap-px text-center text-3xs font-semibold uppercase tracking-wide text-surface-600 dark:text-surface-400 py-0.5"
				>
					{#each DIAS_SEMANA_CURTO as ds (ds)}<span>{ds}</span>{/each}
				</div>
				<div class="grid grid-cols-7 gap-0.5">
					{#each gradeCalendario as cell, i (i)}
						{#if cell}
							{@const iso = cell ? isoData(calAno, calMes + 1, cell.day) : ''}
							{@const sel = iso === dataInicio}
							{@const fer = sel && feriado}
							{@const ehHoje = iso === hoje()}
							<button
								type="button"
								onclick={() => iso && selecionarDia(iso)}
								class="relative h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center
									{sel
									? fer
										? 'border-error-500 bg-error-500/15 text-error-900 dark:text-error-100'
										: 'border-primary-500 bg-primary-500/10 text-primary-800 dark:text-primary-100'
									: 'border-transparent bg-surface-100/80 dark:bg-surface-700/50 text-surface-700 dark:text-surface-200 hover:bg-surface-200/80 dark:hover:bg-surface-600'}
									{ehHoje && !sel ? 'ring-1 ring-surface-400 dark:ring-surface-500' : ''}"
							>
								{cell?.day}
								{#if fer}<span
										class="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-error-500"
										title="Feriado"
									></span>{/if}
							</button>
						{:else}
							<div class="h-9"></div>
						{/if}
					{/each}
				</div>
			</div>

			<!-- Exibição da data selecionada -->
			<div
				class="flex items-center gap-2 px-3 py-2 rounded-xl border border-primary-400/30 bg-primary-500/5"
			>
				<div class="bg-primary-500/10 p-1.5 rounded-lg text-primary-600">
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
						/></svg
					>
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-3xs font-bold uppercase text-primary-600/60 leading-none mb-0.5">
						Data Selecionada
					</p>
					<p class="text-sm font-bold text-primary-700 dark:text-primary-400">
						{fmtDate(dataInicio)}
						{feriado ? '(Feriado)' : ''}
					</p>
				</div>
			</div>

			<!-- Horários -->
			<div
				class="rounded-xl border border-surface-200 dark:border-surface-700 p-2.5 space-y-1.5 bg-white dark:bg-surface-800/40"
			>
				<p class="text-3xs sm:text-xs font-semibold text-surface-600 dark:text-surface-400">
					Horários da Escala
				</p>
				<div class="grid grid-cols-2 gap-2">
					<div>
						<label
							for="editHoraEntrada"
							class="text-3xs text-surface-600 dark:text-surface-400 block mb-0.5">Entrada</label
						>
						<input
							id="editHoraEntrada"
							type="text"
							placeholder="Ex: 08:00"
							bind:value={horaEntrada}
							class="w-full px-2.5 py-1.5 rounded-lg border bg-white dark:bg-surface-800 text-sm {horaEntrada &&
							!validarHora(horaEntrada)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
					<div>
						<label
							for="editHoraSaida"
							class="text-3xs text-surface-600 dark:text-surface-400 block mb-0.5">Saída</label
						>
						<input
							id="editHoraSaida"
							type="text"
							placeholder="Ex: 16:00"
							bind:value={horaSaida}
							class="w-full px-2.5 py-1.5 rounded-lg border bg-white dark:bg-surface-800 text-sm {horaSaida &&
							!validarHora(horaSaida)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
				</div>
				<p class="text-3xs text-surface-600 dark:text-surface-400">
					Formato: HH:MM · ex: 08:00 · 14:30
				</p>
			</div>

			<div class="flex justify-end gap-2 pt-1">
				<button
					type="button"
					class="btn preset-outlined-surface-500 text-xs sm:text-sm px-4 py-2 rounded-xl"
					onclick={onClose}>Cancelar</button
				>
				<form
					method="POST"
					action="?/salvarDatasHorarios"
					use:enhance={onSubmitWrapper}
					class="contents"
				>
					<input type="hidden" name="data_inicio" value={dataInicio} />
					<input type="hidden" name="hora_entrada" value={normalizarHora(horaEntrada) ?? ''} />
					<input type="hidden" name="hora_saida" value={normalizarHora(horaSaida) ?? ''} />
					<input type="hidden" name="feriado" value={feriado ? 'true' : 'false'} />
					<button
						type="submit"
						class="btn preset-filled-primary-500 text-xs sm:text-sm px-6 py-2 rounded-xl font-bold transition-all"
						disabled={pendingCrud}
					>
						{pendingCrud ? 'Salvando...' : 'Salvar Alterações'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
