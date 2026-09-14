<script lang="ts">
	/**
	 * Card de uma equipe dentro de um slot de unidade: vagas DPC/OIP, horários
	 * (com edição inline do Admin Geral), membros e o fluxo de adicionar membro.
	 * O estado de edição vem de `GiseSeccionalEstado` (compartilhado com os
	 * demais cards — os fluxos são mutuamente exclusivos por id).
	 *
	 * Sem tarja lateral: o tipo já está no título, e a cor da seccional mora no
	 * card externo. A faixa duplicava o recorte e virava arco-íris nos pares
	 * Operacional/SEINT.
	 */
	import { enhance } from '$app/forms';
	// O MESMO teto que a action impõe no servidor.
	import { MAX_VAGAS_EQUIPE } from '$lib/gise/tipos-equipe';
	import type { GiseDetalhado, GiseEquipeComMembros } from '$lib/db/gise';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import MarcadorPresenca from './MarcadorPresenca.svelte';
	import {
		validarHora,
		normalizarHora,
		horarioEfetivo,
		temHorarioProprio
	} from '$lib/gise/horarios';
	import type { GiseSeccionalActions } from '$lib/composables/gise/useGiseSeccionalActions.svelte';
	import type { GiseSeccionalEstado } from './gise-seccional-estado.svelte';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Clock from '@lucide/svelte/icons/clock';

	type Seccional = GiseDetalhado['seccionais'][number];

	const {
		equipe,
		sec,
		gise,
		isAdminGeral,
		isSeccional,
		podeEditar,
		modoEdicaoGeral,
		minhaSeccionalId,
		estado,
		actions
	}: {
		equipe: GiseEquipeComMembros;
		sec: Seccional;
		gise: GiseDetalhado;
		isAdminGeral: boolean;
		isSeccional: boolean;
		podeEditar: boolean;
		modoEdicaoGeral: boolean;
		minhaSeccionalId: number | null;
		estado: GiseSeccionalEstado;
		actions: GiseSeccionalActions;
	} = $props();

	// Mesma regra usada duas vezes no template original (remover/adicionar
	// membro): Admin Geral em modo edição, ou Adm Seccional da própria
	// seccional com a escala editável.
	const podeEditarMembros = $derived(
		podeEditar &&
			((isAdminGeral && modoEdicaoGeral) ||
				(isSeccional &&
					sec.seccional_id === minhaSeccionalId &&
					(estado.modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))
	);

	/**
	 * O horário da equipe só é ESCRITO quando difere do que ela herdaria.
	 *
	 * A cascata equipe → seccional → escala é do banco (as duas primeiras têm
	 * coluna nulável, e nulo quer dizer "o mesmo de cima"). Resolver e imprimir
	 * sempre fazia o quadro repetir o horário da escala em cada card, sem dizer
	 * nada; quando é herdado sobra o relógio, com o horário em vigor no rótulo.
	 *
	 * A comparação é de VALOR: o selo "H. Personalizado" que morava aqui olhava
	 * só se a coluna tinha algo, então quem salvasse 08:00 numa equipe cuja
	 * seccional já é 08:00 ganhava um "personalizado" que não personaliza nada.
	 */
	const horario = $derived(horarioEfetivo(equipe, sec, gise));
	const equipeTemHorarioProprio = $derived(temHorarioProprio(equipe, sec, gise));

	/**
	 * O relógio do horário HERDADO só aparece ao lado do lápis, em modo edição.
	 *
	 * Ele não é informação: o horário herdado já está no cabeçalho da seccional e
	 * na escala. O que ele faz é dizer ONDE se clica para personalizar — fora da
	 * edição não há onde clicar, e ele vira enfeite repetido em cada card. O
	 * horário PRÓPRIO continua visível sempre, porque aí sim é informação que só
	 * existe neste card.
	 */
	const podeEditarHorario = $derived(isAdminGeral && podeEditar && modoEdicaoGeral);

	const buscarMembroAdicional = $derived(
		estado.cargoParaAdicionar ? actions.buscarPorCargo(estado.cargoParaAdicionar) : undefined
	);
</script>

<div
	class="flex-1 min-w-0 rounded-xl border border-surface-200 dark:border-surface-700/60 p-2.5 sm:p-3 bg-white dark:bg-surface-900 shadow-sm hover:shadow-md transition-shadow duration-200"
>
	<div class="mb-3 flex flex-col gap-2 xs:flex-row xs:items-start xs:justify-between">
		{#if isAdminGeral && podeEditar && modoEdicaoGeral}
			<form
				id="remover-equipe-form-{equipe.id}"
				method="POST"
				action="?/removerEquipe"
				use:enhance={actions.handleRemoverEquipe}
				class="hidden"
				aria-hidden="true"
			>
				<input type="hidden" name="equipeId" value={equipe.id} />
			</form>
		{/if}

		<div class="min-w-0 flex-1 space-y-1.5">
			<span
				class="block min-w-0 text-sm font-semibold capitalize text-surface-900 dark:text-surface-100"
			>
				Equipe {equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT'}
			</span>

			<div
				class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 {estado.editandoEquipe ===
					equipe.id || estado.editandoHorariosEquipeId === equipe.id
					? 'flex-col items-start'
					: ''}"
			>
				{#if estado.editandoEquipe === equipe.id}
					<div class="flex flex-wrap items-center gap-1.5">
						<label for="edit-dpc-{equipe.id}" class="text-sm text-surface-600 dark:text-surface-400"
							>DPC:</label
						>
						<input
							id="edit-dpc-{equipe.id}"
							type="number"
							min="0"
							max={MAX_VAGAS_EQUIPE}
							bind:value={estado.editSlotsDpc}
							class="w-14 px-2 py-1 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center"
						/>
						<label for="edit-oip-{equipe.id}" class="text-sm text-surface-600 dark:text-surface-400"
							>OIP:</label
						>
						<input
							id="edit-oip-{equipe.id}"
							type="number"
							min="0"
							max={MAX_VAGAS_EQUIPE}
							bind:value={estado.editSlotsOip}
							class="w-14 px-2 py-1 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-center"
						/>
						<div class="flex items-center gap-2 shrink-0">
							<form
								method="POST"
								action="?/salvarSlotsEquipe"
								use:enhance={actions.handleSalvarSlotsEquipe}
								class="contents"
							>
								<input type="hidden" name="equipeId" value={equipe.id} />
								<input type="hidden" name="slots_dpc" value={estado.editSlotsDpc} />
								<input type="hidden" name="slots_oip" value={estado.editSlotsOip} />
								<button
									type="submit"
									class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded transition-all"
									disabled={actions.pendingCrud}
									aria-label="Salvar vagas"
									title="Confirmar">{actions.pendingSalvarSlotsEquipe ? '…' : '✓'}</button
								>
							</form>
							<button
								type="button"
								class="btn btn-sm preset-outlined-surface-500 text-sm py-1 px-2 rounded"
								onclick={() => (estado.editandoEquipe = null)}
								aria-label="Cancelar edição de vagas"
								title="Cancelar">×</button
							>
						</div>
					</div>
				{:else}
					<div class="flex flex-wrap items-center gap-2 min-w-0">
						<span class="text-sm text-surface-600 dark:text-surface-400"
							>{equipe.slots_dpc} DPC + {equipe.slots_oip} OIP</span
						>
						{#if isAdminGeral && podeEditar && modoEdicaoGeral}
							<button
								type="button"
								class="btn btn-xs preset-outlined-surface-500 rounded p-1 shrink-0"
								onclick={() => {
									estado.editandoEquipe = equipe.id;
									estado.editSlotsDpc = equipe.slots_dpc;
									estado.editSlotsOip = equipe.slots_oip;
								}}
								title="Editar vagas da equipe"
							>
								<PenLine class="w-3 h-3" aria-hidden="true" />
							</button>
						{/if}
					</div>
				{/if}

				{#if estado.editandoHorariosEquipeId === equipe.id}
					<div class="flex flex-wrap items-center gap-2">
						<input
							type="text"
							placeholder="08:00"
							class="min-w-0 flex-1 xs:flex-none xs:w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {estado.editEqHoraEnt &&
							!validarHora(estado.editEqHoraEnt)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-600'}"
							bind:value={estado.editEqHoraEnt}
						/>
						<span class="opacity-30">-</span>
						<input
							type="text"
							placeholder="16:00"
							class="min-w-0 flex-1 xs:flex-none xs:w-20 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {estado.editEqHoraSai &&
							!validarHora(estado.editEqHoraSai)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-600'}"
							bind:value={estado.editEqHoraSai}
						/>
						<div class="flex items-center gap-2 shrink-0">
							<form
								method="POST"
								action="?/salvarHorariosEquipe"
								use:enhance={actions.handleSalvarHorariosEquipe}
								class="contents"
							>
								<input type="hidden" name="eqId" value={equipe.id} />
								<input
									type="hidden"
									name="hora_entrada"
									value={normalizarHora(estado.editEqHoraEnt) ?? ''}
								/>
								<input
									type="hidden"
									name="hora_saida"
									value={normalizarHora(estado.editEqHoraSai) ?? ''}
								/>
								<button
									type="submit"
									class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded transition-all"
									disabled={actions.pendingCrud}
									title="Confirmar">{actions.pendingSalvarHorariosEquipe ? '…' : '✓'}</button
								>
							</form>
							<button
								type="button"
								class="btn btn-sm preset-outlined-surface-500 text-sm py-1 px-2 rounded"
								onclick={() => (estado.editandoHorariosEquipeId = null)}>×</button
							>
						</div>
					</div>
				{:else}
					<div class="flex flex-wrap items-center gap-2 min-w-0">
						<div
							class="flex flex-wrap items-center gap-1.5 text-sm text-surface-600 dark:text-surface-400 font-medium min-w-0"
						>
							{#if equipeTemHorarioProprio}
								<span
									class="rounded border border-warning-500/20 bg-warning-500/10 px-1.5 py-0.5 font-bold text-warning-600 dark:text-warning-400"
									title="Horário próprio desta equipe">{horario.entrada}h-{horario.saida}h</span
								>
							{:else if podeEditarHorario}
								<Clock
									class="h-3.5 w-3.5 shrink-0"
									aria-label="Horário herdado: {horario.entrada}h-{horario.saida}h"
								/>
							{/if}
						</div>
						{#if podeEditarHorario}
							<button
								type="button"
								class="btn btn-xs preset-outlined-surface-500 rounded p-1 shrink-0"
								onclick={() => {
									estado.editandoHorariosEquipeId = equipe.id;
									estado.editEqHoraEnt = horario.entrada;
									estado.editEqHoraSai = horario.saida;
								}}
								title="Editar horários da equipe"
							>
								<PenLine class="w-3 h-3" aria-hidden="true" />
							</button>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		{#if isAdminGeral && podeEditar && modoEdicaoGeral}
			<button
				type="submit"
				form="remover-equipe-form-{equipe.id}"
				class="btn btn-sm preset-outlined-error-500 inline-flex w-full xs:w-auto shrink-0 items-center justify-center gap-1 whitespace-nowrap px-2 py-1 text-xs"
				disabled={actions.pendingCrud}
			>
				{actions.pendingRemoverEquipe ? 'Removendo...' : 'Remover equipe'}
			</button>
		{/if}
	</div>

	<!-- Membros -->
	{#if equipe.membros?.length}
		<div class="space-y-1 mb-2">
			{#each equipe.membros as m (m.id)}
				<div
					class="flex items-start justify-between gap-2 text-sm px-3 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-800"
				>
					<div class="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
						<span class="min-w-0 break-words font-semibold text-surface-900 dark:text-surface-100"
							>{m.policial_nome}</span
						>
						<span class="text-surface-600 dark:text-surface-400"
							>{m.policial_cargo} · {m.policial_matricula}</span
						>
						<!-- Estado de presença SEMPRE explícito (entrada e saída). Antes só
						     havia selo quando a entrada existia, então "aguardando entrada"
						     ficava visualmente idêntico a "sem informação". -->
						<MarcadorPresenca
							entrada={!!m.presenca?.entrada_timestamp}
							saida={!!m.presenca?.saida_timestamp}
						/>
					</div>
					{#if podeEditarMembros}
						<form
							method="POST"
							action="?/removerMembro"
							use:enhance={actions.handleRemoverMembro}
							class="shrink-0"
						>
							<input type="hidden" name="memId" value={m.id} />
							<button
								type="submit"
								class="inline-flex items-center justify-center w-5 h-9 rounded-md border border-error-500/35 bg-error-500/10 text-error-600 hover:bg-error-500/20 hover:text-error-700 dark:text-error-400 dark:hover:text-error-300 transition-colors touch-manipulation -mr-1"
								aria-label="Remover policial da equipe"
								title="Remover policial"
								disabled={actions.pendingCrud}
							>
								{#if actions.pendingRemoverMembro}…{:else}×{/if}
							</button>
						</form>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="text-sm text-surface-600 dark:text-surface-400 italic mb-3">Nenhum membro alocado</p>
	{/if}

	<!-- Adicionar membro -->
	{#if podeEditarMembros}
		{#if estado.equipeParaAdicionar === equipe.id}
			<form method="POST" action="?/adicionarMembro" use:enhance={actions.handleAdicionarMembro}>
				<input type="hidden" name="secId" value={sec.id} />
				<input type="hidden" name="equipe_id" value={estado.equipeParaAdicionar} />
				<input type="hidden" name="policial_id" value={estado.policialParaAdicionar} />
				<div class="flex flex-col sm:flex-row gap-2 sm:items-end">
					<div class="w-full flex-1 min-w-32">
						{#key estado.cargoParaAdicionar}
							<SearchableSelect
								bind:value={estado.policialParaAdicionar}
								loadOptions={buscarMembroAdicional}
								ariaLabel={`Selecionar ${estado.cargoParaAdicionar ?? 'policial'} para a equipe`}
								placeholder={`Pesquisar ${estado.cargoParaAdicionar}...`}
								class="w-full"
							/>
						{/key}
					</div>
					<div class="w-full sm:w-auto flex gap-2">
						<button
							type="submit"
							class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg flex-1 sm:flex-none transition-all"
							disabled={!estado.policialParaAdicionar || actions.pendingCrud}
							>{actions.pendingAdicionarMembro ? 'Adicionando...' : 'Adicionar'}</button
						>
						<button
							type="button"
							class="btn preset-outlined-surface-500 text-sm px-3 py-1.5 rounded-lg flex-1 sm:flex-none"
							onclick={() => {
								estado.equipeParaAdicionar = null;
								estado.policialParaAdicionar = '';
								estado.cargoParaAdicionar = null;
							}}>Fechar</button
						>
					</div>
				</div>
			</form>
		{:else if !isAdminGeral}
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-sm preset-outlined-surface-500 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap"
					onclick={() => {
						estado.equipeParaAdicionar = equipe.id;
						estado.cargoParaAdicionar = 'OIP';
						estado.policialParaAdicionar = '';
					}}
				>
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
						/></svg
					>
					+ Adicionar OIP
				</button>
				{#if equipe.slots_dpc > 0}
					<button
						type="button"
						class="btn btn-sm preset-outlined-surface-500 w-full sm:w-auto flex items-center justify-center gap-1 whitespace-nowrap"
						onclick={() => {
							estado.equipeParaAdicionar = equipe.id;
							estado.cargoParaAdicionar = 'DPC';
							estado.policialParaAdicionar = '';
						}}
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
							/></svg
						>
						+ Adicionar DPC
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</div>
