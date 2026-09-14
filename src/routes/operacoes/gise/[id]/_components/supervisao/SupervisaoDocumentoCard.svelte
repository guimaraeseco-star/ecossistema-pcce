<script lang="ts">
	/**
	 * Moldura dos cards de documento do quadro de supervisão (escala GISE e
	 * relatório de extra). Unifica as quatro variantes que se repetiam no
	 * template de GiseSupervisao: mobile (card expansível) × desktop (linha
	 * horizontal em três partes), para cada documento.
	 *
	 * O título fica FORA do card (como em Assinaturas em lote); dentro só o
	 * badge de status — evita repetir o mesmo rótulo. Texto orientativo vai em
	 * `textoInfo` (ícone i + popover), não no corpo do card.
	 *
	 * O conteúdo específico entra pelos snippets `detalhes` e `acoes`, que
	 * recebem `mobile: boolean` para as diferenças pontuais entre variantes.
	 *
	 * O ícone à esquerda espelha o card de lote: check verde quando assinado
	 * (`badgeEstado === 'sucesso'`).
	 *
	 * Este é o ÚNICO ponto do quadro que ramifica por dispositivo, então lê
	 * `useMobile()` direto (fonte única desde ago/2026) em vez de receber o
	 * valor — que antes descia quatro níveis por prop até aqui.
	 */
	import { slide } from 'svelte/transition';
	import type { Snippet } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import Check from '@lucide/svelte/icons/check';
	import Clipboard from '@lucide/svelte/icons/clipboard';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Info from '@lucide/svelte/icons/info';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import { useMobile } from '$lib/composables';

	const mobileState = useMobile();

	let {
		titulo,
		textoInfo = '',
		badgeEstado,
		badgeLabel,
		expandido = $bindable(false),
		detalhes,
		acoes
	}: {
		/** Rótulo acima do card (mobile e desktop). */
		titulo: string;
		/** Texto do popover do ícone de informação (opcional). */
		textoInfo?: string;
		badgeEstado: 'sucesso' | 'alerta' | 'neutro';
		badgeLabel: string;
		/** Corpo expandido/recolhido do card mobile (bindable). */
		expandido?: boolean;
		detalhes: Snippet<[boolean]>;
		acoes: Snippet<[boolean]>;
	} = $props();

	const isMobile = $derived(mobileState.isMobile);

	const iconeBoxClass = $derived(
		badgeEstado === 'sucesso'
			? 'bg-success-100 dark:bg-success-900/30'
			: badgeEstado === 'alerta'
				? 'bg-warning-100 dark:bg-warning-900/30'
				: 'bg-surface-100 dark:bg-surface-800'
	);

	const iconeStrokeClass = $derived(
		badgeEstado === 'sucesso'
			? 'text-success-600 dark:text-success-400'
			: badgeEstado === 'alerta'
				? 'text-warning-600 dark:text-warning-400'
				: 'text-surface-400 dark:text-surface-500'
	);
</script>

{#snippet badge()}
	{#if badgeEstado === 'sucesso'}
		<span
			class="inline-flex items-center gap-1 rounded-full bg-success-500/15 px-1.5 py-0.5 text-3xs font-bold uppercase text-success-700 dark:text-success-400"
		>
			<CheckCircle2 size={9} />{badgeLabel}
		</span>
	{:else if badgeEstado === 'alerta'}
		<span
			class="inline-flex items-center gap-1 rounded-full bg-warning-500/15 px-1.5 py-0.5 text-3xs font-bold uppercase text-warning-700 dark:text-warning-400"
		>
			<Clock size={9} />{badgeLabel}
		</span>
	{:else}
		<span
			class="inline-flex items-center gap-1 rounded-full bg-surface-500/15 px-1.5 py-0.5 text-3xs font-bold uppercase text-surface-700 dark:text-surface-400"
		>
			<Clock size={9} />{badgeLabel}
		</span>
	{/if}
{/snippet}

{#snippet iconeStatus(tamanho: 'sm' | 'md')}
	{@const box = tamanho === 'sm' ? 'h-7 w-7' : 'h-8 w-8'}
	<div class="{box} shrink-0 flex items-center justify-center rounded-lg {iconeBoxClass}">
		<!-- A cor vem de `iconeStrokeClass` e só o desenho variava, então aqui o
		     `{#if}` já era único — a troca por lucide (B-6.2) é direta. O terceiro
		     path era uma prancheta com o `d` corrompido (dois subpaths de
		     prancheta concatenados, um deles inválido); `Clipboard` desenha o que
		     ele tentava desenhar. -->
		{#if badgeEstado === 'sucesso'}
			<Check class="w-3.5 h-3.5 {iconeStrokeClass}" aria-hidden="true" />
		{:else if badgeEstado === 'alerta'}
			<ClipboardCheck class="w-3.5 h-3.5 {iconeStrokeClass}" aria-hidden="true" />
		{:else}
			<Clipboard class="w-3.5 h-3.5 {iconeStrokeClass}" aria-hidden="true" />
		{/if}
	</div>
{/snippet}

<div class="flex flex-col gap-1.5 w-full">
	<div class="flex items-center gap-1.5">
		<p class="text-3xs font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500">
			{titulo}
		</p>
		{#if textoInfo}
			<Popover positioning={{ placement: 'bottom-start' }}>
				<Popover.Trigger
					type="button"
					class="inline-flex items-center justify-center rounded-full p-0.5 text-surface-400 transition-colors hover:bg-surface-100 hover:text-primary-600 dark:hover:bg-surface-800 dark:hover:text-primary-400"
					aria-label="Informações sobre {titulo}"
					title="Informações"
				>
					<Info class="h-3.5 w-3.5" aria-hidden="true" />
				</Popover.Trigger>
				<Portal>
					<Popover.Positioner>
						<Popover.Content
							class="z-50 max-w-xs rounded-xl border border-surface-200 bg-white p-3 text-2xs leading-snug text-surface-600 shadow-xl dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
						>
							{textoInfo}
						</Popover.Content>
					</Popover.Positioner>
				</Portal>
			</Popover>
		{/if}
	</div>

	{#if isMobile}
		<div
			class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow duration-300"
		>
			<button
				type="button"
				class="flex w-full items-center gap-2 p-3 text-left cursor-pointer active:bg-surface-100/60 dark:active:bg-surface-700/40"
				onclick={() => {
					expandido = !expandido;
				}}
			>
				{@render iconeStatus('sm')}
				<div class="min-w-0 flex-1">
					{@render badge()}
				</div>
				<ChevronDown
					class="h-4 w-4 shrink-0 text-surface-400 transition-transform duration-200 {expandido
						? 'rotate-180'
						: ''}"
				/>
			</button>
			{#if expandido}
				<div
					transition:slide={{ duration: 200 }}
					class="px-3 pb-3 pt-2.5 border-t border-surface-200/50 dark:border-surface-700/50 flex-1 flex flex-col justify-between gap-2.5"
				>
					<div class="space-y-2">
						{@render detalhes(true)}
					</div>
					<div class="flex items-center gap-1.5 flex-wrap justify-end">
						{@render acoes(true)}
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<div
			class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 flex items-center justify-between gap-4 p-3.5 px-4"
		>
			<div class="flex items-center gap-3 min-w-[180px] shrink-0">
				{@render iconeStatus('md')}
				<div class="min-w-0">
					{@render badge()}
				</div>
			</div>

			<div
				class="flex-1 min-w-0 text-left border-l border-surface-200/40 dark:border-surface-800/80 pl-4 py-0.5"
			>
				{@render detalhes(false)}
			</div>

			<div
				class="flex items-center gap-1.5 shrink-0 justify-end border-l border-surface-200/40 dark:border-surface-800/80 pl-4 py-0.5"
			>
				{@render acoes(false)}
			</div>
		</div>
	{/if}
</div>
