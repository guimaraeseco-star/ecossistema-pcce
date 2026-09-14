<script lang="ts">
	/**
	 * Painel do SUPERVISOR para assinar de uma vez os relatórios de
	 * extraordinário de todas as seccionais.
	 *
	 * O valor do card está em separar as pendências por CAUSA, porque o
	 * bloqueio não é o mesmo:
	 *   - "falta saída" — alguma equipe não confirmou entrada/saída de todos
	 *     (`checkAllSigned`), e nesse caso o relatório sequer PODE ser assinado;
	 *   - "falta assinar" — já está pronta, só espera o supervisor.
	 * As duas já apareceram juntas sob um rótulo único, que escondia justamente
	 * qual era o impedimento.
	 *
	 * O aviso jurídico antes de assinar não é enfeite: o fluxo individual
	 * (ModalRelatorioDigital) sempre o exibiu, e o lote assinava sem ele — o
	 * mesmo ato com duas cerimônias diferentes. Ao mexer num, mexa no outro.
	 *
	 * Downloads ficam no modal (`Conferência/Downloads`): o card cobre todas as
	 * equipes, então não há atalho S/C manifesto aqui — o modal deixa escolher
	 * por seccional ou em lote.
	 */
	import Check from '@lucide/svelte/icons/check';
	import Clock from '@lucide/svelte/icons/clock';
	import Clipboard from '@lucide/svelte/icons/clipboard';
	import { slide } from 'svelte/transition';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import SquarePen from '@lucide/svelte/icons/square-pen';
	import Info from '@lucide/svelte/icons/info';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { loading } from '$lib/loading.svelte';
	import { getMembrosFromSec, checkAllSigned } from '$lib/gise/page-helpers';
	import { toaster } from '$lib/toast';
	import { page } from '$app/state';
	import { avancadaEmTelaDoLayout } from '$lib/chave-assinatura-ui';
	import ConviteChaveAssinatura from '$lib/components/ConviteChaveAssinatura.svelte';

	const TEXTO_INFO_LOTE =
		'Neste quadro, o supervisor poderá conferir e em seguida assinar os relatórios de extra de todas as equipes. A assinatura também pode ocorrer de forma individual, através do quadro de cada seccional.';

	interface Props {
		quantidadePendentes: number;
		assinandoLote: boolean;
		etapaAssinatura: string;
		progressoLote: { atual: number; total: number };
		isMobile: boolean;
		onAssinarManualLote: () => void;
		onAssinarDigitalLote: () => void | Promise<void>;
		podeAssinar?: boolean;
		// Novas props para exibir assinaturas concluídas
		assinaturasRelatorios?:
			| {
					tipo: string;
					seccional_id: number;
					assinante_nome?: string;
					assinante_id?: number | null;
			  }[]
			| null;
		seccionais?:
			| {
					seccional_id?: number;
					id?: number;
					seccional_nome?: string;
					unidades?: import('$lib/db/gise').GiseUnidadeSlot[];
			  }[]
			| null;
		supervisaoExtraUnidadeId?: number | null;
		giseStatus?: string;
		onConferencia?: () => void;
	}

	const {
		quantidadePendentes,
		assinandoLote,
		etapaAssinatura,
		progressoLote,
		isMobile,
		onAssinarManualLote,
		onAssinarDigitalLote,
		podeAssinar = true,
		assinaturasRelatorios = [],
		seccionais = [],
		supervisaoExtraUnidadeId = null,
		giseStatus = '',
		onConferencia
	}: Props = $props();

	let expandido = $state(false);
	const avancadaDisponivel = $derived(avancadaEmTelaDoLayout(page.data));
	const restringirSmartphone = $derived((page.data.restringirSmartphone as boolean) ?? false);
	const avancadaDesktopDisponivel = $derived(
		!isMobile && !restringirSmartphone && avancadaDisponivel
	);

	const naoIniciou = $derived(
		['em_definicao_supervisor', 'em_preenchimento', 'aguardando_assinatura'].includes(
			giseStatus ?? ''
		)
	);

	const concluidosExtra = $derived(
		(assinaturasRelatorios ?? []).filter(
			(a) =>
				a.tipo === 'extraordinario' &&
				(supervisaoExtraUnidadeId == null || a.seccional_id !== supervisaoExtraUnidadeId)
		)
	);

	function nomeSeccional(seccionalId: number): string {
		const s = seccionais?.find((x) => x.seccional_id === seccionalId || x.id === seccionalId);
		return s?.seccional_nome?.trim() || `Seccional #${seccionalId}`;
	}

	const seccionaisComEquipes = $derived(
		(seccionais ?? []).filter((sec) => getMembrosFromSec(sec).length > 0)
	);

	const isAssinado = (sec: { seccional_id?: number; id?: number }) =>
		concluidosExtra.some((c) => c.seccional_id === sec.seccional_id || c.seccional_id === sec.id);

	const seccionaisFaltantes = $derived(seccionaisComEquipes.filter((sec) => !isAssinado(sec)));
	const seccionaisAssinadas = $derived(seccionaisComEquipes.filter((sec) => isAssinado(sec)));

	// As pendências das faltantes têm CAUSAS diferentes, e o card agora as separa:
	//  - falta SAÍDA: alguma equipe ainda não confirmou entrada/saída de todos os
	//    membros (`checkAllSigned`), então o relatório nem pode ser assinado;
	//  - falta ASSINAR: já está pronta (todos saíram), só aguarda o supervisor.
	// Antes as duas apareciam juntas sob o rótulo "Faltando envio de:", que além de
	// impreciso escondia qual era o bloqueio real.
	const seccionaisSemSaida = $derived(seccionaisFaltantes.filter((sec) => !checkAllSigned(sec)));
	const seccionaisAAssinar = $derived(seccionaisFaltantes.filter((sec) => checkAllSigned(sec)));

	const nomesDe = (lista: typeof seccionaisComEquipes) =>
		lista.length > 0
			? lista.map((s) => nomeSeccional(s.seccional_id ?? s.id ?? 0)).join(', ')
			: 'Nenhum';

	const totalEquipes = $derived(seccionaisComEquipes.length);
	const totalAssinados = $derived(seccionaisAssinadas.length);
	const totalProntosNaoAssinados = $derived(
		seccionaisFaltantes.filter((sec) => checkAllSigned(sec)).length
	);

	const statusLoteInfo = $derived.by(() => {
		if (totalEquipes > 0 && totalAssinados === totalEquipes) {
			return {
				text: 'Todos Assinados',
				class: 'bg-success-500/15 text-success-700 dark:text-success-400'
			};
		}
		if (totalAssinados > 0 && totalAssinados < totalEquipes) {
			return {
				text: 'Assinados (parcial)',
				class: 'bg-success-500/15 text-success-700 dark:text-success-400'
			};
		}
		if (totalAssinados === 0 && totalProntosNaoAssinados === totalEquipes && totalEquipes > 0) {
			return {
				text: 'Todos prontos para ass.',
				class: 'bg-warning-500/15 text-warning-700 dark:text-warning-400'
			};
		}
		if (
			totalAssinados === 0 &&
			totalProntosNaoAssinados > 0 &&
			totalProntosNaoAssinados < totalEquipes
		) {
			return {
				text: 'pronto para ass. (parcial)',
				class: 'bg-warning-500/15 text-warning-700 dark:text-warning-400'
			};
		}
		return {
			text: 'Aguardando saída equipes',
			class: 'bg-surface-500/10 text-surface-500 dark:text-surface-400'
		};
	});

	function mostrarOrientaConferencia() {
		toaster.warning({
			title: 'Conferência de Relatório',
			description:
				'Para visualizar o relatório individualmente de cada equipe, por favor, acesse a aba de detalhamento de cada seccional na seção "Seccionais Participantes" logo abaixo.'
		});
	}

	/** Todas as equipes com relatório de extra já assinado — segue o padrão dos
	    demais cards (escala/relatório de extra): oferecer download em vez de só conferência. */
	const todosAssinados = $derived(totalEquipes > 0 && totalAssinados === totalEquipes);

	/** Nome(s) de quem assinou — exibido no lugar da descrição quando todos os
	    relatórios estão assinados, como os demais cards de documento já fazem. */
	const nomesAssinantes = $derived(
		[...new Set(concluidosExtra.map((a) => a.assinante_nome?.trim()).filter(Boolean))].join(', ')
	);

	/** Diálogo de ciência jurídica antes da assinatura em lote por Token —
	    espelha o aviso do fluxo individual (ModalRelatorioDigital →
	    PainelAssinaturaToken), que o lote não exibia. */
	let confirmandoLote = $state(false);

	function confirmarAssinaturaLote() {
		confirmandoLote = false;
		void onAssinarDigitalLote();
	}
</script>

<!-- Situação das seccionais em 3 linhas (saída pendente / pronta p/ assinar /
     assinada). Snippet único: as variantes mobile e desktop do card renderizam
     exatamente o mesmo conteúdo, mudando só o espaçamento. -->
{#snippet linhasSituacao(_mobile: boolean)}
	<p class="text-2xs leading-snug text-surface-500 dark:text-surface-400">
		<span class="text-warning-600 dark:text-warning-400 font-medium">Faltando saída de:</span>
		{naoIniciou ? 'Aguardando início' : nomesDe(seccionaisSemSaida)}
	</p>
	<p class="mt-0.5 text-2xs leading-snug text-surface-500 dark:text-surface-400">
		<span class="text-error-600 dark:text-error-400 font-medium">Pronto para assinar:</span>
		{naoIniciou ? 'Aguardando início' : nomesDe(seccionaisAAssinar)}
	</p>
	<p class="mt-0.5 text-2xs leading-snug text-surface-500 dark:text-surface-400">
		<span class="text-success-600 dark:text-success-400 font-medium">Assinado de:</span>
		{naoIniciou ? 'Aguardando início' : nomesDe(seccionaisAssinadas)}
	</p>
{/snippet}

{#snippet tituloComInfo()}
	<div class="flex items-center gap-1.5">
		<p class="text-3xs font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500">
			Assinaturas em lote (equipes)
		</p>
		<Popover positioning={{ placement: 'bottom-start' }}>
			<Popover.Trigger
				type="button"
				class="inline-flex items-center justify-center rounded-full p-0.5 text-surface-400 transition-colors hover:bg-surface-100 hover:text-primary-600 dark:hover:bg-surface-800 dark:hover:text-primary-400"
				aria-label="Informações sobre assinaturas em lote"
				title="Informações"
			>
				<Info class="h-3.5 w-3.5" aria-hidden="true" />
			</Popover.Trigger>
			<Portal>
				<Popover.Positioner>
					<Popover.Content
						class="z-50 max-w-xs rounded-xl border border-surface-200 bg-white p-3 text-2xs leading-snug text-surface-600 shadow-xl dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300"
					>
						{TEXTO_INFO_LOTE}
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover>
	</div>
{/snippet}

<!-- Ícone + badge de status do lote — mesma marcação nos layouts mobile e
     desktop, só o tamanho do container/ícone muda. -->
{#snippet iconeStatusLote(tamanhoContainer: string)}
	<div
		class="{tamanhoContainer} shrink-0 flex items-center justify-center rounded-lg {statusLoteInfo.text ===
			'Todos Assinados' || statusLoteInfo.text === 'Assinados (parcial)'
			? 'bg-success-100 dark:bg-success-900/30'
			: statusLoteInfo.text === 'Todos prontos para ass.' ||
				  statusLoteInfo.text === 'pronto para ass. (parcial)'
				? 'bg-warning-100 dark:bg-warning-900/30'
				: 'bg-surface-100 dark:bg-surface-800'}"
	>
		<!-- Um `{#if}` só. Antes eram DOIS em paralelo — o mesmo teste de status
		     escolhia a cor na `class` do <svg> e o desenho no <path>, e nada
		     obrigava os dois a concordarem. Trocar o SVG inline por lucide (B-6.2)
		     é o que permitiu fundir: o componente carrega cor e ícone juntos. -->
		{#if statusLoteInfo.text === 'Todos Assinados' || statusLoteInfo.text === 'Assinados (parcial)'}
			<Check class="w-3.5 h-3.5 text-success-600 dark:text-success-400" aria-hidden="true" />
		{:else if statusLoteInfo.text === 'Todos prontos para ass.' || statusLoteInfo.text === 'pronto para ass. (parcial)'}
			<Clock class="w-3.5 h-3.5 text-warning-600 dark:text-warning-400" aria-hidden="true" />
		{:else}
			<Clipboard class="w-3.5 h-3.5 text-surface-400 dark:text-surface-500" aria-hidden="true" />
		{/if}
	</div>
{/snippet}

{#snippet badgeStatusLote()}
	<span
		class="inline-flex items-center gap-1 rounded-full {statusLoteInfo.class} px-1.5 py-0.5 text-3xs font-bold uppercase"
	>
		{statusLoteInfo.text}
	</span>
{/snippet}

<!-- Barra de progresso "assinando em lote" — mesma marcação nos dois layouts,
     só a classe do container externo muda. -->
{#snippet barraProgressoLote(wrapperClass: string)}
	{#if assinandoLote}
		<div class={wrapperClass}>
			<p
				class="text-3xs font-bold uppercase tracking-widest text-warning-700 dark:text-warning-400 text-center"
			>
				{etapaAssinatura}
			</p>
			<div class="w-full bg-surface-200 dark:bg-surface-700 rounded-full h-2 overflow-hidden">
				<div
					class="bg-warning-500 h-full transition-all duration-500 ease-out"
					style="width: {(progressoLote.atual / progressoLote.total) * 100}%"
				></div>
			</div>
			<p class="text-3xs text-surface-500 dark:text-surface-400 text-center">
				{progressoLote.atual} de {progressoLote.total}
			</p>
		</div>
	{/if}
{/snippet}

<div class="flex flex-col gap-1.5 w-full animate-fade">
	{@render tituloComInfo()}
	<div
		class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-sm hover:shadow-md transition-all duration-300"
	>
		{#if isMobile}
			<!-- Mobile layout: Collapsible card -->
			<button
				type="button"
				class="flex w-full items-center gap-2 p-3 text-left cursor-pointer active:bg-surface-100/60 dark:active:bg-surface-700/40"
				onclick={() => {
					expandido = !expandido;
				}}
			>
				{@render iconeStatusLote('h-7 w-7')}
				<div class="min-w-0 flex-1">
					{@render badgeStatusLote()}
				</div>
				<ChevronDown
					class="h-4 w-4 shrink-0 text-surface-400 transition-transform duration-200 {expandido
						? 'rotate-180'
						: ''}"
				/>
			</button>

			<!-- Body -->
			{#if expandido}
				<div
					transition:slide={{ duration: 200 }}
					class="px-3 pb-3 pt-2.5 border-t border-surface-200/50 dark:border-surface-700/50 flex flex-col justify-between gap-2.5"
				>
					<div class="space-y-2">
						{#if todosAssinados}
							<p class="text-xs font-bold text-surface-800 dark:text-surface-100 break-words">
								{nomesAssinantes || 'Assinado'}
							</p>
						{:else}
							{@render linhasSituacao(true)}
						{/if}

						{@render barraProgressoLote('flex flex-col gap-1.5')}
					</div>

					{#if !assinandoLote}
						<div class="flex items-center gap-1.5 flex-wrap justify-end">
							<button
								type="button"
								class="btn btn-xs preset-outlined-surface-500 px-2.5 py-1.5 text-3xs font-semibold rounded-lg flex items-center gap-1"
								onclick={onConferencia || mostrarOrientaConferencia}
							>
								<PenLine class="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
								Conferência/Downloads
							</button>
							{#if !todosAssinados && podeAssinar}
								{#if avancadaDisponivel}
									<button
										type="button"
										class="btn btn-xs preset-filled-warning-500 border border-warning-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-warning-600 disabled:opacity-40 flex items-center gap-1"
										disabled={loading.active || quantidadePendentes === 0}
										onclick={onAssinarManualLote}
									>
										<PenLine class="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
										Tela
									</button>
								{:else}
									<div class="max-w-[12rem]">
										<ConviteChaveAssinatura isMobile={true} compact />
									</div>
								{/if}
							{/if}
						</div>
					{/if}

					<!-- Listagem discreta de assinaturas concluídas -->
					{#if concluidosExtra.length > 0}
						<div class="mt-1 pt-2.5 border-t border-surface-200/50 dark:border-surface-700/50">
							<p
								class="text-3xs font-bold uppercase tracking-widest text-surface-400 dark:text-surface-500 mb-1.5 px-0.5"
							>
								Relatórios Assinados
							</p>
							<div class="flex flex-wrap gap-1.5">
								{#each concluidosExtra as ass (ass.seccional_id)}
									<div
										class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-success-500/5 border border-success-500/10 text-3xs"
										title="Assinado por {ass.assinante_nome}"
									>
										<span class="text-success-600 dark:text-success-400">✓</span>
										<span class="font-medium text-surface-600 dark:text-surface-300"
											>{nomeSeccional(ass.seccional_id)}</span
										>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/if}
		{:else}
			<!-- Desktop layout: Premium row layout -->
			<div class="flex items-center justify-between gap-4 p-3.5 px-4">
				<!-- Parte 1: Status e Título -->
				<div class="flex items-center gap-3 min-w-[250px] shrink-0">
					{@render iconeStatusLote('h-8 w-8')}
					<div class="min-w-0">
						{@render badgeStatusLote()}
					</div>
				</div>

				<!-- Parte 2: Informações/Detalhes -->
				<div
					class="flex-1 min-w-0 text-left border-l border-surface-200/40 dark:border-surface-800/80 pl-4 py-0.5"
				>
					{#if todosAssinados}
						<p class="text-xs font-bold text-surface-800 dark:text-surface-100 break-words">
							{nomesAssinantes || 'Assinado'}
						</p>
					{:else}
						{@render linhasSituacao(false)}
					{/if}

					{@render barraProgressoLote('flex flex-col gap-1.5 mt-2 max-w-md')}

					<!-- Listagem discreta de assinaturas concluídas -->
					{#if concluidosExtra.length > 0}
						<div class="mt-2 pt-2 border-t border-surface-200/40 dark:border-surface-800/80">
							<p
								class="text-3xs font-bold uppercase tracking-widest text-surface-400 dark:text-surface-500 mb-1.5 px-0.5"
							>
								Relatórios Assinados
							</p>
							<div class="flex flex-wrap gap-1.5">
								{#each concluidosExtra as ass (ass.seccional_id)}
									<div
										class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-success-500/5 border border-success-500/10 text-3xs"
										title="Assinado por {ass.assinante_nome}"
									>
										<span class="text-success-600 dark:text-success-400">✓</span>
										<span class="font-medium text-surface-600 dark:text-surface-300"
											>{nomeSeccional(ass.seccional_id)}</span
										>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<!-- Parte 3: Ações -->
				<div
					class="flex items-center gap-1.5 shrink-0 justify-end border-l border-surface-200/40 dark:border-surface-800/80 pl-4 py-0.5"
				>
					<button
						type="button"
						class="btn btn-xs preset-outlined-surface-500 px-2.5 py-1.5 text-3xs font-semibold rounded-lg flex items-center gap-1"
						onclick={onConferencia || mostrarOrientaConferencia}
					>
						<PenLine class="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
						Conferência/Downloads
					</button>
					{#if !todosAssinados && podeAssinar && !assinandoLote}
						{#if avancadaDesktopDisponivel}
							<button
								type="button"
								class="btn btn-xs preset-filled-warning-500 border border-warning-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-warning-600 disabled:opacity-40 flex items-center gap-1 hover:scale-[1.02] transition-all"
								disabled={loading.active || quantidadePendentes === 0}
								onclick={onAssinarManualLote}
							>
								<PenLine class="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
								Assinar
							</button>
						{:else}
							<button
								type="button"
								class="btn btn-xs preset-filled-warning-500 px-2.5 py-1.5 text-3xs font-semibold rounded-lg disabled:opacity-40 flex items-center gap-1"
								disabled={loading.active || quantidadePendentes === 0}
								onclick={() => (confirmandoLote = true)}
							>
								<PenLine class="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
								Token
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Ciência jurídica antes de disparar a assinatura em lote — o mesmo aviso do
     fluxo individual (Lei 14.063/2020 art. 4º §1º), que o lote não exibia. -->
{#snippet descricaoAssinaturaLote()}
	Você está assinando, de uma só vez, os Relatórios de extra pendentes de
	<strong class="text-surface-900 dark:text-surface-50">
		{quantidadePendentes}
		{quantidadePendentes === 1 ? 'equipe' : 'equipes'}
	</strong>.
{/snippet}

<ModalShell
	open={confirmandoLote}
	title="Assinatura Digital em Lote"
	description={descricaoAssinaturaLote}
	largura="lg"
	camada="empilhado"
	padding="compacto"
	familia="assinatura"
	pending={assinandoLote || loading.active}
	onOpenChange={(novoOpen) => {
		if (!novoOpen) confirmandoLote = false;
	}}
>
	<!-- Aviso jurídico (Lei 14.063/2020 art. 4º §1º) -->
	<p class="text-2xs text-surface-500 dark:text-surface-400 italic leading-snug">
		Ao clicar em <strong>Assinar</strong>, você confirma que leu os documentos e que estas
		assinaturas têm valor jurídico equivalente à manuscrita, conforme o
		<a href="/termo" target="_blank" rel="noopener" class="underline hover:text-primary-600"
			>Termo de Uso</a
		>
		aceito.
	</p>

	<button
		type="button"
		class="btn btn-sm preset-filled-primary-500 font-bold px-4 py-2 rounded-lg shadow-sm hover:scale-[1.02] transition-transform w-full flex items-center justify-center gap-2"
		onclick={confirmarAssinaturaLote}
		disabled={assinandoLote || loading.active}
	>
		<SquarePen class="w-4 h-4" aria-hidden="true" />
		Assinar com Certificado Digital (SERPRO)
	</button>

	<button
		type="button"
		class="w-full btn preset-outlined-surface-500 py-3 rounded-2xl text-sm"
		onclick={() => (confirmandoLote = false)}
		disabled={assinandoLote || loading.active}
	>
		Cancelar e fechar
	</button>
</ModalShell>
