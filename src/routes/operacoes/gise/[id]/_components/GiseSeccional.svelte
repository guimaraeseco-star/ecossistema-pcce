<script lang="ts">
	/**
	 * Card de UMA SECCIONAL dentro da escala GISE — o bloco que o admin daquela
	 * seccional preenche e que o Admin Geral e o supervisor acompanham.
	 *
	 * Contém a árvore inteira abaixo da seccional: slots de unidade
	 * (`GiseSlotUnidade`), equipes de cada slot, membros de cada equipe, e os
	 * downloads/assinaturas dos relatórios (`SeccionalRelatoriosDownloads`).
	 *
	 * A divisão de trabalho é deliberada:
	 * - `useGiseSeccionalActions` tem os 11 fluxos de mutação (form actions,
	 *   toasts, invalidação, modal de remoção);
	 * - `GiseSeccionalEstado` tem o estado de edição inline do card;
	 * - este arquivo é markup e ligação entre os dois.
	 *
	 * Sem essa separação o card passava de mil linhas — foi o que motivou a
	 * extração.
	 *
	 * Sem tarja lateral: o nome da seccional já identifica o bloco, e a faixa
	 * colorida por id virava arco-íris na lista.
	 */
	import { enhance } from '$app/forms';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import type { GiseDetalhado, GiseUnidadeSlot, GiseEquipeComMembros } from '$lib/db/gise';
	import type { Unidade, GiseAssinaturaRelatorio } from '$lib/server/schema';
	import ModalRemoverSeccional from './modais/ModalRemoverSeccional.svelte';
	import { useGiseSeccionalActions } from '$lib/composables/gise';
	import {
		validarHora,
		normalizarHora,
		horarioEfetivo,
		temHorarioProprio
	} from '$lib/gise/horarios';
	import { GiseSeccionalEstado } from './gise-seccional-estado.svelte';
	import GiseActionButton from './GiseActionButton.svelte';
	import SeccionalRelatoriosDownloads from './SeccionalRelatoriosDownloads.svelte';
	import GiseSlotUnidade from './GiseSlotUnidade.svelte';
	import GiseAbasUnidades from './GiseAbasUnidades.svelte';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Clock from '@lucide/svelte/icons/clock';

	type Seccional = GiseDetalhado['seccionais'][number];

	interface Props {
		sec: Seccional;
		gise: GiseDetalhado;
		/** Tipos de equipe que a operação desta escala usa; repassado ao slot. */
		tiposEquipePermitidos: string[];
		todasUnidades: Unidade[];
		isAdminGeral: boolean;
		isSeccional: boolean;
		isSupervisor: boolean;
		podeEditar: boolean;
		podeDownload: boolean;
		isMobile: boolean;
		minhaSeccionalId: number | null;
		modoEdicaoGeral: boolean;
		assinaturasRelatorios: GiseAssinaturaRelatorio[] | undefined;
		restringirSmartphone: boolean;
		recolhida: boolean;
		onToggleRecolher: () => void;
		onAssinarRelatorioManual: (seccionalId: number) => void;
		onAssinarRelatorioDigital: (
			seccionalId: number,
			tipo: 'extraordinario',
			seccionalNome: string
		) => void;
		onFinalizarSuccess?: () => void;
	}

	const {
		sec,
		gise,
		tiposEquipePermitidos,
		todasUnidades,
		isAdminGeral,
		isSeccional,
		isSupervisor,
		podeEditar,
		podeDownload,
		isMobile,
		minhaSeccionalId,
		modoEdicaoGeral,
		assinaturasRelatorios,
		restringirSmartphone,
		recolhida,
		onToggleRecolher,
		onAssinarRelatorioManual,
		onAssinarRelatorioDigital,
		onFinalizarSuccess
	}: Props = $props();

	// Estado de UI (edição inline), compartilhado com GiseSlotUnidade e
	// GiseEquipeCard. Vive numa classe única porque é mutuamente exclusivo
	// entre as equipes/slots renderizados por esta seccional.
	const estado = new GiseSeccionalEstado();

	// `btn-sm` + `py-2` (~40px): o `.btn` cheio inflava o Finalizar acima do
	// Cancelar e dos pills de download da mesma barra.
	const classeAcaoBarra =
		'btn btn-sm py-2 px-4 text-sm rounded-lg font-semibold inline-flex items-center justify-center';
	const classeAcaoBarraGise =
		'border-2 py-2 px-4 text-sm w-full sm:w-auto inline-flex items-center';

	// CRUD: `pendingCrud`, todos os `use:enhance` handlers, fluxo do modal de
	// remover seccional e factory `buscarPorCargo` vivem no composable.
	const actions = useGiseSeccionalActions({
		onFinalizarSeccionalSuccess: () => {
			estado.modoEdicaoSeccional = false;
			onFinalizarSuccess?.();
		},
		onSelecionarUnidadeSuccess: () => {
			estado.selecionandoUnidadeSlotId = null;
			estado.slotUnidadeId = '';
		},
		onAdicionarEquipeSuccess: () => {
			estado.adicionandoEquipe = false;
			estado.adicionandoEquipeSlotId = null;
		},
		onSalvarSlotsEquipeSuccess: () => {
			estado.editandoEquipe = null;
		},
		onSalvarHorariosEquipeSuccess: () => {
			estado.editandoHorariosEquipeId = null;
		},
		onSalvarHorariosSecSuccess: () => {
			estado.editandoHorariosSeccional = false;
		},
		onAdicionarMembroSuccess: () => {
			estado.equipeParaAdicionar = null;
			estado.policialParaAdicionar = '';
			estado.cargoParaAdicionar = null;
		},
		onAdicionarUnidadeSuccess: () => {
			estado.novoSlotUnidadeId = '';
			estado.adicionandoSlot = false;
			// A aba nova precisa ABRIR: criada e deixada fechada, a unidade nasceria
			// escondida atrás da aba anterior — e quem acabou de criá-la iria
			// procurar o slot que "não apareceu". Como o id só chega no próximo
			// `load`, o pedido é "a última", resolvido em `abaAtiva`.
			estado.abrirUltimaAba = true;
		},
		getHorariosEquipeFormulario: () => ({
			entrada: estado.editEqHoraEnt,
			saida: estado.editEqHoraSai
		}),
		getHorariosSecFormulario: () => ({
			entrada: estado.editSecHoraEnt,
			saida: estado.editSecHoraSai
		})
	});

	/**
	 * A unidade ABERTA nas abas.
	 *
	 * Derivado, e não um `$state` cru, porque a lista de slots vem do servidor e
	 * muda debaixo da tela: aba removida (ou escala recarregada) tem de cair para
	 * uma que exista, senão o painel some sem nada explicando.
	 */
	const slots = $derived(sec.unidades ?? []);
	const abaAtiva = $derived.by(() => {
		if (estado.abrirUltimaAba && slots.length > 0) return slots[slots.length - 1].id;
		const escolhida = slots.find((u) => u.id === estado.abaSlotId);
		return escolhida?.id ?? slots[0]?.id ?? null;
	});
	const slotAberto = $derived(slots.find((u) => u.id === abaAtiva) ?? null);

	/**
	 * Horário da seccional: só é ESCRITO quando difere do da escala.
	 *
	 * `gise_seccionais.hora_*` é nulável, e nulo já quer dizer "o mesmo da
	 * escala" — imprimir sempre a cascata resolvida repetia o horário da escala
	 * em cada linha do quadro sem dizer nada. Quando é herdado, sobra o relógio
	 * (com o horário em vigor no `title`) e o lápis.
	 */
	const horarioSec = $derived(horarioEfetivo(sec, gise));
	const secTemHorarioProprio = $derived(temHorarioProprio(sec, gise));

	/**
	 * Mesma regra dos cards de equipe: o relógio do horário HERDADO só acompanha
	 * o lápis. Fora da edição ele não diz nada que a escala já não diga, e some.
	 */
	const podeEditarHorarioSec = $derived(
		podeEditar &&
			((isAdminGeral && modoEdicaoGeral) ||
				(isSeccional &&
					sec.seccional_id === minhaSeccionalId &&
					(estado.modoEdicaoSeccional || sec.status === 'pendente' || sec.status === 'retificada')))
	);

	const pendingCrud = $derived(actions.pendingCrud);
	const pendingFinalizar = $derived(actions.pendingFinalizarSeccional);
	const pendingSalvarHorariosSec = $derived(actions.pendingSalvarHorariosSec);
	const pendingAdicionarUnidade = $derived(actions.pendingAdicionarUnidade);
</script>

{#snippet statusBadge(status: string, isSeccionalBadge = false)}
	{#if isSeccionalBadge}
		<span
			class="text-sm px-1.5 py-0.5 rounded-full font-bold {status === 'preenchida' ||
			status === 'preenchida_retificada'
				? 'bg-success-500/20 text-success-700 dark:text-success-400'
				: status === 'retificada'
					? 'bg-warning-500/20 text-warning-600 dark:text-warning-400 border border-warning-500/40'
					: 'bg-surface-500/20 text-surface-600 dark:text-surface-400'}"
		>
			{status === 'preenchida'
				? 'Preenchida'
				: status === 'preenchida_retificada'
					? 'Preenchida (Retificada)'
					: status === 'retificada'
						? 'Preenchida (Retificada)'
						: 'Pendente'}
		</span>
	{/if}
{/snippet}

{#snippet relatoriosDownloads(compact: boolean)}
	<SeccionalRelatoriosDownloads
		{compact}
		{sec}
		{gise}
		{assinaturasRelatorios}
		{podeDownload}
		{isAdminGeral}
		{isSeccional}
		{isSupervisor}
		{isMobile}
		{restringirSmartphone}
		{pendingCrud}
		{onAssinarRelatorioManual}
		{onAssinarRelatorioDigital}
	/>
{/snippet}

<div
	class="card-quadro rounded-2xl mb-4 overflow-hidden hover:shadow-md transition-shadow duration-300"
>
	<!-- Cabeçalho da seccional -->
	<div
		class="flex flex-wrap items-center gap-2 justify-between px-4 sm:px-5 py-3 {recolhida
			? ''
			: 'border-b border-surface-200/40 dark:border-surface-700/40'}"
	>
		<div class="flex-1 min-w-0 flex flex-wrap items-center gap-y-1">
			<button
				type="button"
				class="flex items-center gap-x-3 text-left active:scale-[0.99] transition-transform min-w-0"
				onclick={onToggleRecolher}
			>
				<div
					class="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0"
				>
					<svg
						class="w-5 h-5 transition-transform duration-300 {recolhida ? '-rotate-90' : ''}"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 9l-7 7-7-7"
						/>
					</svg>
				</div>
				<span
					class="font-bold text-surface-900 dark:text-surface-50 text-sm sm:text-base truncate mr-2"
				>
					{sec.seccional_nome}
				</span>
				{@render statusBadge(sec.status, true)}
			</button>

			{#if estado.editandoHorariosSeccional}
				<div class="flex flex-wrap items-center gap-2 ml-2">
					<input
						type="text"
						placeholder="08:00"
						class="w-16 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {estado.editSecHoraEnt &&
						!validarHora(estado.editSecHoraEnt)
							? 'border-error-500'
							: 'border-surface-300 dark:border-surface-600'}"
						bind:value={estado.editSecHoraEnt}
					/>
					<span class="opacity-30">-</span>
					<input
						type="text"
						placeholder="16:00"
						class="w-16 px-2 py-1 text-sm rounded border bg-white dark:bg-surface-900 {estado.editSecHoraSai &&
						!validarHora(estado.editSecHoraSai)
							? 'border-error-500'
							: 'border-surface-300 dark:border-surface-600'}"
						bind:value={estado.editSecHoraSai}
					/>
					<div class="flex items-center gap-2 shrink-0">
						<form
							method="POST"
							action="?/salvarHorariosSec"
							use:enhance={actions.handleSalvarHorariosSec}
							class="contents"
						>
							<input type="hidden" name="secId" value={sec.id} />
							<input
								type="hidden"
								name="hora_entrada"
								value={normalizarHora(estado.editSecHoraEnt) ?? ''}
							/>
							<input
								type="hidden"
								name="hora_saida"
								value={normalizarHora(estado.editSecHoraSai) ?? ''}
							/>
							<button
								type="submit"
								class="btn btn-sm preset-filled-primary-500 text-sm py-1 px-2 rounded transition-all"
								disabled={pendingCrud}
								title="Confirmar">{pendingSalvarHorariosSec ? '…' : '✓'}</button
							>
						</form>
						<button
							type="button"
							class="btn btn-sm preset-outlined-surface-500 text-sm py-1 px-2 rounded"
							onclick={() => (estado.editandoHorariosSeccional = false)}>×</button
						>
					</div>
				</div>
			{:else}
				<div
					class="flex items-center gap-1.5 text-xs sm:text-sm text-surface-500 font-medium sm:ml-2"
				>
					{#if secTemHorarioProprio}
						<span
							class="rounded bg-warning-500/10 px-1.5 py-0.5 font-bold text-warning-600 dark:text-warning-400"
							title="Horário próprio desta seccional"
							>{horarioSec.entrada}h-{horarioSec.saida}h</span
						>
					{:else if podeEditarHorarioSec}
						<Clock
							class="h-3.5 w-3.5 shrink-0"
							aria-label="Horário da escala: {horarioSec.entrada}h-{horarioSec.saida}h"
						/>
					{/if}

					{#if podeEditarHorarioSec}
						<button
							type="button"
							class="btn btn-xs preset-outlined-surface-500 rounded p-1 shrink-0 ml-1"
							onclick={(e) => {
								e.stopPropagation();
								estado.editandoHorariosSeccional = true;
								estado.editSecHoraEnt = horarioSec.entrada;
								estado.editSecHoraSai = horarioSec.saida;
							}}
							title="Editar horários da seccional"
						>
							<PenLine class="w-3 h-3" aria-hidden="true" />
						</button>
					{/if}
				</div>
			{/if}
		</div>

		{#if isAdminGeral && podeEditar && modoEdicaoGeral}
			<div class="hidden shrink-0 items-start sm:flex">
				<form
					method="POST"
					action="?/removerSeccional"
					use:enhance={actions.handleRemoverSeccionalForm}
					class="block"
				>
					<input type="hidden" name="secId" value={sec.id} />
					<button
						type="submit"
						class="btn btn-sm preset-outlined-error-500 flex w-auto items-center justify-center gap-1 whitespace-nowrap"
						disabled={pendingCrud}
						title="Excluir seccional desta escala"
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/></svg
						>
						Excluir seccional
					</button>
				</form>
			</div>
		{/if}
	</div>

	{#if !recolhida}
		{#if podeDownload || (isAdminGeral && podeEditar && modoEdicaoGeral)}
			<Accordion collapsible class="border-b border-surface-200 dark:border-surface-700 sm:hidden">
				<Accordion.Item value="downloads">
					<Accordion.ItemTrigger
						class="flex w-full cursor-pointer items-center justify-center px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-100/90 dark:text-surface-200 dark:hover:bg-surface-800/50"
					>
						<span class="inline-flex items-center gap-1.5 font-semibold">
							Downloads da Seccional
							<Accordion.ItemIndicator>
								<svg
									class="h-4 w-4 shrink-0 text-surface-500 transition-transform"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M19 9l-7 7-7-7"
									/>
								</svg>
							</Accordion.ItemIndicator>
						</span>
					</Accordion.ItemTrigger>
					<Accordion.ItemContent
						class="flex flex-col gap-2 border-t border-surface-200/80 px-4 pb-3 pt-2 dark:border-surface-700"
					>
						{@render relatoriosDownloads(true)}
					</Accordion.ItemContent>
				</Accordion.Item>
			</Accordion>

			{#if isAdminGeral && podeEditar && modoEdicaoGeral}
				<Accordion
					collapsible
					class="border-b border-surface-200 dark:border-surface-700 sm:hidden"
				>
					<Accordion.Item value="opcoes">
						<Accordion.ItemTrigger
							class="flex w-full cursor-pointer items-center justify-center px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-100/90 dark:text-surface-200 dark:hover:bg-surface-800/50"
						>
							<span class="inline-flex items-center gap-1.5 font-semibold">
								Opções da Seccional
								<Accordion.ItemIndicator>
									<svg
										class="h-4 w-4 shrink-0 text-surface-500 transition-transform"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 9l-7 7-7-7"
										/>
									</svg>
								</Accordion.ItemIndicator>
							</span>
						</Accordion.ItemTrigger>
						<Accordion.ItemContent
							class="flex flex-col gap-2 border-t border-surface-200/80 px-4 pb-3 pt-2 dark:border-surface-700"
						>
							<form
								method="POST"
								action="?/removerSeccional"
								use:enhance={actions.handleRemoverSeccionalForm}
								class="block w-full"
							>
								<input type="hidden" name="secId" value={sec.id} />
								<button
									type="submit"
									class="btn btn-sm preset-outlined-error-500 flex w-full items-center justify-center gap-1 whitespace-nowrap"
									disabled={pendingCrud}
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/></svg
									>
									Excluir seccional
								</button>
							</form>

							<button
								type="button"
								class="btn btn-sm preset-outlined-surface-500 w-full flex items-center justify-center gap-1 whitespace-nowrap"
								onclick={() => {
									estado.adicionandoSlot = true;
									estado.novoSlotUnidadeId = '';
								}}
							>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
									/></svg
								>
								+ Unidades
							</button>
						</Accordion.ItemContent>
					</Accordion.Item>
				</Accordion>
			{/if}
		{/if}

		<!-- Ações Seccional & Downloads -->
		<div
			class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-4 px-4 sm:px-5 py-3 border-b border-surface-200 dark:border-surface-700"
		>
			{#if podeDownload}
				<div class="max-sm:hidden w-full min-w-0">
					{@render relatoriosDownloads(false)}
				</div>
			{/if}

			<div
				class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full shrink-0 lg:w-auto lg:ml-auto {podeDownload
					? 'border-t border-surface-200/70 pt-3 dark:border-surface-700 lg:border-t-0 lg:pt-0'
					: ''}"
			>
				{#if isSeccional && sec.seccional_id === minhaSeccionalId && podeEditar}
					{#if sec.status === 'preenchida' && !estado.modoEdicaoSeccional}
						<GiseActionButton
							label="Editar Escala"
							variant="primary"
							type="filled"
							onclick={() => (estado.modoEdicaoSeccional = true)}
							classes={classeAcaoBarraGise}
							{pendingCrud}
						/>
					{:else}
						<div class="flex w-full sm:w-auto items-stretch gap-2">
							<form
								method="POST"
								action="?/finalizarSeccional"
								use:enhance={actions.handleFinalizarSeccional}
								class="contents"
							>
								<input type="hidden" name="secId" value={sec.id} />
								<button
									type="submit"
									class="{classeAcaoBarra} preset-filled-success-500 disabled:opacity-50 disabled:cursor-not-allowed flex-1 sm:flex-initial"
									disabled={pendingCrud ||
										(sec.unidades ?? []).length === 0 ||
										(sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === null) ||
										(sec.unidades ?? []).some(
											(s: GiseUnidadeSlot) =>
												!(s.equipes ?? []).some(
													(eq: GiseEquipeComMembros) => (eq.membros ?? []).length > 0
												)
										)}
									title={(sec.unidades ?? []).length === 0
										? 'Adicione ao menos uma unidade antes de finalizar'
										: (sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === null)
											? 'Todos os slots devem ter uma unidade selecionada'
											: (sec.unidades ?? []).some(
														(s: GiseUnidadeSlot) =>
															!(s.equipes ?? []).some(
																(eq: GiseEquipeComMembros) => (eq.membros ?? []).length > 0
															)
												  )
												? 'Cada unidade deve ter pelo menos 1 policial alocado'
												: ''}
								>
									{#if pendingFinalizar}
										{sec.status === 'preenchida'
											? 'Finalizando edição...'
											: sec.status === 'retificada'
												? 'Confirmando...'
												: 'Enviando escala...'}
									{:else}
										{sec.status === 'preenchida'
											? 'Finalizar edição'
											: sec.status === 'retificada'
												? 'Confirmar retificação'
												: 'Finalizar envio'}
									{/if}
								</button>
							</form>

							{#if estado.modoEdicaoSeccional}
								<GiseActionButton
									label="Cancelar edição"
									variant="surface"
									type="outlined"
									onclick={() => {
										estado.modoEdicaoSeccional = false;
										estado.selecionandoUnidadeSlotId = null;
										estado.equipeParaAdicionar = null;
										estado.cargoParaAdicionar = null;
									}}
									classes="flex-1 sm:flex-initial {classeAcaoBarraGise}"
									{pendingCrud}
								/>
							{/if}
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<div class="p-2 sm:p-3 space-y-2">
			<!-- Unidades participantes: uma ABA cada, e o painel abaixo mostra as
			     equipes da aba aberta. -->
			{#if slots.length > 0}
				<div>
					<GiseAbasUnidades
						{slots}
						secId={sec.id}
						{abaAtiva}
						onSelecionar={(id) => {
							estado.abaSlotId = id;
							estado.abrirUltimaAba = false;
						}}
						podeAdicionar={isAdminGeral && podeEditar && modoEdicaoGeral && !estado.adicionandoSlot}
						onAdicionar={() => {
							estado.adicionandoSlot = true;
							estado.novoSlotUnidadeId = '';
						}}
					/>
					{#if slotAberto}
						<GiseSlotUnidade
							slot={slotAberto}
							{sec}
							{gise}
							{tiposEquipePermitidos}
							{todasUnidades}
							{isAdminGeral}
							{isSeccional}
							{podeEditar}
							{modoEdicaoGeral}
							{minhaSeccionalId}
							{estado}
							{actions}
						/>
					{/if}
				</div>
			{/if}

			<!-- Admin Geral: adicionar slot de unidade -->
			{#if isAdminGeral && podeEditar && modoEdicaoGeral}
				{#if estado.adicionandoSlot}
					<div
						class="flex flex-wrap gap-2 items-end p-3 rounded-xl border border-dashed border-primary-400/50 bg-primary-500/5"
					>
						<div class="flex-1 min-w-40">
							<label
								for="novo-slot-unidade-{sec.id}"
								class="text-xs font-medium text-surface-600 dark:text-surface-400 block mb-1"
								>Unidade (opcional — pode deixar em branco)</label
							>
							<select
								id="novo-slot-unidade-{sec.id}"
								bind:value={estado.novoSlotUnidadeId}
								class="w-full px-2 py-1.5 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
							>
								<option value="">Slot em branco (Adm Seccional preenche depois)</option>
								{#each todasUnidades.filter((d: Unidade) => d.tipo === 'delegacia' && d.seccional_id === sec.seccional_id && !(sec.unidades ?? []).some((s: GiseUnidadeSlot) => s.unidade_id === d.id)) as d (d.id)}
									<option value={d.id}>{d.nome}</option>
								{/each}
							</select>
						</div>
						<!-- No mobile os dois botões dividem UMA linha em partes iguais
						     (`w-full` + `flex-1`); em sm+ voltam à largura natural. -->
						<div class="w-full grid grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0">
							<form
								method="POST"
								action="?/adicionarUnidade"
								use:enhance={actions.handleAdicionarUnidade}
								class="w-full sm:w-auto"
							>
								<input type="hidden" name="secId" value={sec.id} />
								<input type="hidden" name="unidadeId" value={estado.novoSlotUnidadeId} />
								<button
									type="submit"
									class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-xl transition-all w-full sm:w-auto"
									disabled={pendingCrud}
									>{pendingAdicionarUnidade ? 'Adicionando...' : 'Confirmar'}</button
								>
							</form>
							<button
								type="button"
								class="btn preset-outlined-surface-500 text-sm px-3 py-1.5 rounded-xl w-full sm:w-auto"
								onclick={() => {
									estado.adicionandoSlot = false;
									estado.novoSlotUnidadeId = '';
								}}>Cancelar</button
							>
						</div>
					</div>
				{:else if slots.length === 0}
					<!-- Sem nenhuma unidade não há barra de abas onde pendurar o "+", então
					     o gatilho aparece aqui. Com abas, quem o oferece é a última delas. -->
					<div class="flex justify-end">
						<button
							type="button"
							class="btn preset-outlined-surface-500 text-sm px-3 py-1.5 rounded-xl border-dashed flex items-center gap-2 max-sm:hidden"
							onclick={() => {
								estado.adicionandoSlot = true;
								estado.novoSlotUnidadeId = '';
							}}
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
								/></svg
							>
							+ Unidades
						</button>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<ModalRemoverSeccional
	open={actions.dialogRemoverSeccionalAberto}
	pending={pendingCrud}
	onOpenChange={(open) => (actions.dialogRemoverSeccionalAberto = open)}
	onConfirm={actions.confirmarRemoverSeccional}
/>
