<script lang="ts">
	/**
	 * O PAINEL de uma unidade (DP) — o conteúdo da aba aberta em
	 * `GiseAbasUnidades`: nome da unidade, equipes (`GiseEquipeCard`) e o fluxo do
	 * Admin Geral de adicionar equipe. Estado de edição compartilhado via
	 * `GiseSeccionalEstado`.
	 *
	 * Até ago/2026 este componente era uma CAIXA empilhada com as demais unidades,
	 * e o nome da delegacia vinha numa faixa própria com o "Remover DP" ao lado.
	 * Eram três linhas de moldura por unidade, justamente no espaço dos quadros de
	 * equipe. Hoje a moldura é o painel da aba, e ele já sabe de quem é: por isso
	 * o botão de adicionar equipe é só **+ Equipes**, sem nomear alvo — tudo que
	 * está visível pertence à unidade da aba.
	 *
	 * O "Remover DP" saiu da faixa e entrou no menu do lápis, junto de "Alterar
	 * unidade": são as duas ações DA UNIDADE, e ficam onde se mexe na unidade.
	 *
	 * E o painel NÃO leva tarja lateral: ela some para devolver os 6px de
	 * largura aos quadros de equipe. O card da seccional e os quadros de equipe
	 * também não levam tarja — o nome e o tipo já identificam o bloco.
	 */
	import { enhance } from '$app/forms';
	// O MESMO teto que a action impõe no servidor.
	import { MAX_VAGAS_EQUIPE } from '$lib/gise/tipos-equipe';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import type { GiseDetalhado, GiseUnidadeSlot } from '$lib/db/gise';
	import type { Unidade } from '$lib/server/schema';
	import type { GiseSeccionalActions } from '$lib/composables/gise/useGiseSeccionalActions.svelte';
	import type { GiseSeccionalEstado } from './gise-seccional-estado.svelte';
	import GiseEquipeCard from './GiseEquipeCard.svelte';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Building from '@lucide/svelte/icons/building';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import X from '@lucide/svelte/icons/x';

	type Seccional = GiseDetalhado['seccionais'][number];

	const {
		slot,
		sec,
		gise,
		tiposEquipePermitidos,
		todasUnidades,
		isAdminGeral,
		isSeccional,
		podeEditar,
		modoEdicaoGeral,
		minhaSeccionalId,
		estado,
		actions
	}: {
		slot: GiseUnidadeSlot;
		sec: Seccional;
		gise: GiseDetalhado;
		/** Tipos de equipe que a OPERAÇÃO desta escala usa — a EDGE pode ter só um. */
		tiposEquipePermitidos: string[];
		todasUnidades: Unidade[];
		isAdminGeral: boolean;
		isSeccional: boolean;
		podeEditar: boolean;
		modoEdicaoGeral: boolean;
		minhaSeccionalId: number | null;
		estado: GiseSeccionalEstado;
		actions: GiseSeccionalActions;
	} = $props();

	const podeEditarCabecalhoUnidade = $derived(
		(isSeccional &&
			sec.seccional_id === minhaSeccionalId &&
			(estado.modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')) ||
			(isAdminGeral && podeEditar && modoEdicaoGeral)
	);

	/** Só o Admin Geral em modo edição remove a unidade do quadro. */
	const podeRemoverUnidade = $derived(isAdminGeral && podeEditar && modoEdicaoGeral);

	function abrirSelecaoUnidade() {
		estado.selecionandoUnidadeSlotId = slot.id;
		estado.slotUnidadeId = slot.unidade_id ?? '';
	}
</script>

<div
	id="painel-un-{sec.id}-{slot.id}"
	role="tabpanel"
	aria-labelledby="aba-un-{sec.id}-{slot.id}"
	tabindex="-1"
	class="rounded-b-xl border border-t-0 border-surface-300 bg-white p-2 dark:border-surface-700 dark:bg-surface-950 sm:p-3"
>
	<!-- Topo do painel: quem é esta unidade e o que se pode fazer com ela -->
	<div class="mb-2 flex flex-col gap-2">
		{#if podeEditarCabecalhoUnidade && estado.selecionandoUnidadeSlotId === slot.id}
			<div class="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
				<div class="w-full flex-1">
					<select
						bind:value={estado.slotUnidadeId}
						class="w-full rounded-xl border border-surface-300 bg-white px-2 py-1.5 text-sm font-medium dark:border-surface-700 dark:bg-surface-800"
					>
						<option value=""
							>{slot.nome ? 'Selecionar outra unidade...' : 'Selecionar unidade...'}</option
						>
						{#each todasUnidades.filter((d: Unidade) => d.tipo === 'delegacia' && d.seccional_id === sec.seccional_id && !(sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === d.id && s.id !== slot.id)) as d (d.id)}
							<option value={d.id}>{d.nome}</option>
						{/each}
					</select>
				</div>
				<div class="flex w-full shrink-0 gap-2 sm:w-auto">
					<form
						method="POST"
						action="?/selecionarUnidade"
						use:enhance={actions.handleSelecionarUnidade}
						class="flex-1 sm:flex-initial"
					>
						<input type="hidden" name="slotId" value={slot.id} />
						<input type="hidden" name="unidadeId" value={estado.slotUnidadeId} />
						<button
							type="submit"
							class="btn w-full rounded-xl px-4 py-1.5 text-sm font-semibold transition-all preset-filled-primary-500 sm:w-auto sm:px-6"
							disabled={!estado.slotUnidadeId || actions.pendingCrud}
						>
							{actions.pendingSelecionarUnidade ? 'Salvando...' : 'Confirmar'}
						</button>
					</form>
					<button
						type="button"
						class="btn flex-1 rounded-xl px-4 py-1.5 text-sm font-semibold preset-outlined-surface-500 sm:w-auto sm:flex-initial sm:px-6"
						onclick={() => {
							estado.selecionandoUnidadeSlotId = null;
							estado.slotUnidadeId = '';
						}}
					>
						Cancelar
					</button>
				</div>
			</div>
		{:else}
			<div class="flex w-full min-w-0 flex-row items-center gap-2">
				{#if slot.nome}
					<span
						class="min-w-0 truncate text-sm font-semibold text-surface-900 dark:text-surface-100"
						>{slot.nome}</span
					>
				{:else}
					<span class="text-sm italic text-surface-600 dark:text-surface-400"
						>Unidade não definida</span
					>
				{/if}

				{#if podeEditarCabecalhoUnidade}
					{#if podeRemoverUnidade}
						<!-- As duas ações DA UNIDADE atrás do mesmo lápis. Sozinho na
						     faixa, o "Remover DP" gastava uma linha inteira do quadro. -->
						<Popover positioning={{ placement: 'bottom-start' }}>
							<Popover.Trigger
								class="btn btn-xs shrink-0 rounded p-1 preset-outlined-surface-500"
								title="Ações desta unidade"
								aria-label="Ações desta unidade"
							>
								<PenLine class="h-3 w-3" aria-hidden="true" />
							</Popover.Trigger>
							<Portal>
								<Popover.Positioner>
									<Popover.Content
										class="z-50 min-w-[12rem] overflow-hidden rounded-xl border border-surface-200 bg-white py-1 shadow-xl dark:border-surface-600 dark:bg-surface-800"
									>
										<button
											type="button"
											class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-surface-800 hover:bg-surface-100 dark:text-surface-100 dark:hover:bg-surface-700"
											onclick={abrirSelecaoUnidade}
										>
											<PenLine class="h-3.5 w-3.5" aria-hidden="true" />
											{slot.nome ? 'Alterar unidade' : 'Definir unidade'}
										</button>
										<form
											method="POST"
											action="?/removerUnidade"
											use:enhance={actions.handleRemoverUnidade}
											class="block"
										>
											<input type="hidden" name="secId" value={sec.id} />
											<input type="hidden" name="linkId" value={slot.id} />
											<button
												type="submit"
												class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-error-600 hover:bg-error-500/10 dark:text-error-400"
												disabled={actions.pendingCrud}
											>
												<X class="h-3.5 w-3.5" aria-hidden="true" />
												{actions.pendingRemoverUnidade ? 'Removendo...' : 'Remover DP do quadro'}
											</button>
										</form>
									</Popover.Content>
								</Popover.Positioner>
							</Portal>
						</Popover>
					{:else if slot.nome}
						<button
							type="button"
							class="btn btn-xs shrink-0 rounded p-1 preset-outlined-surface-500"
							title="Alterar unidade"
							aria-label="Alterar unidade"
							onclick={abrirSelecaoUnidade}
						>
							<PenLine class="h-3 w-3" aria-hidden="true" />
						</button>
					{:else}
						<button
							type="button"
							class="btn flex w-auto shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-sm preset-outlined-warning-500"
							onclick={abrirSelecaoUnidade}
						>
							<Building class="h-3.5 w-3.5" aria-hidden="true" />
							Definir DP
						</button>
					{/if}
				{/if}
			</div>
		{/if}
	</div>

	<!-- Equipes da unidade desta aba -->
	<div class="grid grid-cols-1 gap-2 sm:gap-3 {slot.equipes?.length > 1 ? 'md:grid-cols-2' : ''}">
		{#each slot.equipes ?? [] as equipe (equipe.id)}
			<GiseEquipeCard
				{equipe}
				{sec}
				{gise}
				{isAdminGeral}
				{isSeccional}
				{podeEditar}
				{modoEdicaoGeral}
				{minhaSeccionalId}
				{estado}
				{actions}
			/>
		{/each}
	</div>

	<!-- Admin Geral: adicionar equipe a esta unidade -->
	{#if isAdminGeral && podeEditar && modoEdicaoGeral}
		<div class="mt-2 flex justify-end">
			{#if estado.adicionandoEquipe && estado.adicionandoEquipeSlotId === slot.id}
				<div
					class="flex w-full flex-wrap items-end gap-2 rounded-xl border border-dashed border-surface-300 p-3 dark:border-surface-600 sm:w-auto"
				>
					<div>
						<label
							for="novaEquipeTipo-{slot.id}"
							class="mb-1 block text-sm font-medium text-surface-600 dark:text-surface-400"
							>Tipo</label
						>
						<select
							id="novaEquipeTipo-{slot.id}"
							bind:value={estado.novaEquipeTipo}
							onchange={() => {
								if (estado.novaEquipeTipo === 'operacional') {
									estado.novaEquipeDpc = 1;
									estado.novaEquipeOip = 3;
								} else {
									estado.novaEquipeDpc = 0;
									estado.novaEquipeOip = 2;
								}
							}}
							class="rounded-xl border border-surface-300 bg-white px-2 py-1.5 text-sm dark:border-surface-700 dark:bg-surface-800"
						>
							<!-- Só os tipos que a operação usa. Não é a autorização — quem
							     recusa o POST é `adicionarEquipe`; isto evita oferecer uma
							     opção que daria erro. -->
							{#if tiposEquipePermitidos.includes('operacional')}
								<option value="operacional">Operacional</option>
							{/if}
							{#if tiposEquipePermitidos.includes('seint')}
								<option value="seint">SEINT</option>
							{/if}
						</select>
					</div>
					<div>
						<label
							for="novaEquipeDpc-{slot.id}"
							class="mb-1 block text-sm font-medium text-surface-600 dark:text-surface-400"
							>DPC</label
						>
						<input
							id="novaEquipeDpc-{slot.id}"
							type="number"
							min="0"
							max={MAX_VAGAS_EQUIPE}
							bind:value={estado.novaEquipeDpc}
							class="w-14 rounded-xl border border-surface-300 bg-white px-2 py-1.5 text-center text-sm dark:border-surface-700 dark:bg-surface-800"
						/>
					</div>
					<div>
						<label
							for="novaEquipeOip-{slot.id}"
							class="mb-1 block text-sm font-medium text-surface-600 dark:text-surface-400"
							>OIP</label
						>
						<input
							id="novaEquipeOip-{slot.id}"
							type="number"
							min="0"
							max={MAX_VAGAS_EQUIPE}
							bind:value={estado.novaEquipeOip}
							class="w-14 rounded-xl border border-surface-300 bg-white px-2 py-1.5 text-center text-sm dark:border-surface-700 dark:bg-surface-800"
						/>
					</div>
					<!-- No mobile os dois botões dividem UMA linha em partes iguais
					     (`w-full` + `flex-1`); em sm+ voltam à largura natural. -->
					<div class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
						<form
							method="POST"
							action="?/adicionarEquipe"
							use:enhance={actions.handleAdicionarEquipe}
							class="w-full sm:w-auto"
						>
							<input type="hidden" name="secId" value={sec.id} />
							<input type="hidden" name="unidadeId" value={slot.id} />
							<input type="hidden" name="tipo" value={estado.novaEquipeTipo} />
							<input type="hidden" name="slots_dpc" value={estado.novaEquipeDpc} />
							<input type="hidden" name="slots_oip" value={estado.novaEquipeOip} />
							<button
								type="submit"
								class="btn w-full rounded-lg px-3 py-1.5 text-sm transition-all preset-filled-primary-500 sm:w-auto"
								disabled={actions.pendingCrud}
								>{actions.pendingAdicionarEquipe ? 'Adicionando...' : 'Adicionar'}</button
							>
						</form>
						<button
							type="button"
							class="btn w-full rounded-lg px-2 py-1.5 text-sm preset-outlined-surface-500 sm:w-auto"
							onclick={() => {
								estado.adicionandoEquipe = false;
								estado.adicionandoEquipeSlotId = null;
							}}>Cancelar</button
						>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="btn btn-sm flex w-full items-center justify-center gap-1 whitespace-nowrap preset-outlined-surface-500 sm:w-auto"
					onclick={() => {
						estado.adicionandoEquipe = true;
						estado.adicionandoEquipeSlotId = slot.id;
						estado.novaEquipeTipo = 'operacional';
						estado.novaEquipeDpc = 1;
						estado.novaEquipeOip = 3;
					}}
				>
					<UserPlus class="h-3.5 w-3.5" aria-hidden="true" />
					+ Equipes
				</button>
			{/if}
		</div>
	{/if}
</div>
