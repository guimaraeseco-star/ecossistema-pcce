<script lang="ts">
	/**
	 * Card de uma GISE ativa na lista `/operacoes/gise`.
	 *
	 * Concentra o "o que falta" da escala: o chip de status e os dois botões
	 * (escala × extras) são atalho do mesmo controle de dentro da escala
	 * (`?assinar=` na URL). Quem não é o supervisor da escala vê só os downloads.
	 *
	 * Sem faixa colorida no topo — o chip já carrega o status; a barra
	 * duplicava a informação e virava um arco-íris na grade.
	 */
	import { goto } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import { statusLabel, statusColor, fmtDate, diaSemana } from '$lib/gise/formatters';
	import { escalaGiseJaAssinada } from '$lib/gise/status-escala';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Check from '@lucide/svelte/icons/check';

	const {
		ativa,
		operacaoNome = '',
		isSupervisor,
		assinaViaToken,
		larguraDesktop,
		usuario,
		menuExpandidoId,
		onAssEscala,
		onAssExtra,
		onEscalaPdf,
		onExtraPdf,
		onToggleMenu
	}: {
		ativa: {
			id: number;
			status: string;
			data_inicio: string;
			hora_entrada: string;
			hora_saida: string;
			totalSeccionais: number;
			extrasPendentes: number;
			assinaturasRelatorioExtra?: number;
			supervisor_id?: number | null;
			assessor_id?: number | null;
			seint1_id?: number | null;
			seint2_id?: number | null;
		};
		/** Sigla/nome da operação desta escala; vazio esconde o selo. */
		operacaoNome?: string;
		isSupervisor: boolean;
		/**
		 * O APARELHO assina por token A3 (computador) ou em tela (celular).
		 * Só muda o texto do tooltip — quem dispara o fluxo é a página.
		 */
		assinaViaToken: boolean;
		/**
		 * A VIEWPORT chegou ao `md` do Tailwind. Tem de bater com as classes
		 * `md:` deste arquivo, e por isso NÃO é o mesmo booleano acima: no iPad
		 * em paisagem o aparelho é móvel e a largura é de desktop.
		 */
		larguraDesktop: boolean;
		usuario: { id?: number | null } | null;
		menuExpandidoId: number | null;
		onAssEscala: () => void;
		onAssExtra: () => void;
		onEscalaPdf: () => void;
		onExtraPdf: () => void;
		onToggleMenu: () => void;
	} = $props();

	// O quadro de supervisão (supervisor/assessor/SEINT) rende um relatório de
	// extra próprio, somado ao de cada seccional — daí o "+1" no total esperado.
	const temSupervisao = $derived(
		!!(ativa.supervisor_id || ativa.assessor_id || ativa.seint1_id || ativa.seint2_id)
	);
	const totalExtras = $derived(ativa.totalSeccionais + (temSupervisao ? 1 : 0));
	const escalaConcluida = $derived(escalaGiseJaAssinada(ativa.status));
	// Três estados do botão de extras: nenhum, alguns (tertiary) e todos (success).
	// `>=` e não `===` porque uma seccional removida depois da assinatura deixaria
	// o contador acima do total esperado.
	const jaAssinados = $derived(ativa.assinaturasRelatorioExtra ?? 0);
	const extraConcluido = $derived(jaAssinados >= totalExtras);
	const extraParcial = $derived(jaAssinados > 0 && jaAssinados < totalExtras);
</script>

<div
	class="flex flex-col rounded-2xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-sm overflow-hidden hover:shadow-md hover:border-primary-500/40 dark:hover:border-primary-400/20 transition-all duration-200 group"
>
	<div class="flex flex-col gap-3 p-4 sm:p-5 flex-1">
		<div class="flex items-center gap-2 flex-wrap">
			<span
				class="inline-flex items-center rounded-full bg-primary-500/10 px-2 py-0.5 text-3xs font-bold uppercase tracking-wide text-primary-700 dark:text-primary-400"
			>
				Ativa #{ativa.id}
			</span>
			{#if operacaoNome}
				<!-- Sem o selo, escalas de operações diferentes ficam visualmente
				     idênticas na mesma lista — e elas têm formulários e metas
				     diferentes. -->
				<span
					class="inline-flex items-center rounded-full bg-tertiary-500/15 px-2 py-0.5 text-3xs font-bold uppercase tracking-wide text-tertiary-700 dark:text-tertiary-300 border border-tertiary-500/20"
				>
					{operacaoNome}
				</span>
			{/if}
			<span
				class="inline-flex items-center rounded-full px-2 py-0.5 text-3xs font-bold uppercase tracking-wide {statusColor(
					ativa.status
				)}"
			>
				{statusLabel(ativa.status)}
			</span>
			{#if ativa.supervisor_id === usuario?.id}
				<span
					class="inline-flex items-center rounded-full bg-warning-500/15 px-2 py-0.5 text-3xs font-bold uppercase tracking-wide text-warning-700 dark:text-warning-400 border border-warning-500/20"
				>
					Sou Supervisor
				</span>
			{/if}
		</div>

		<div class="flex-1">
			<p
				class="text-base sm:text-lg font-bold text-surface-800 dark:text-surface-100 leading-tight group-hover:text-primary-600 dark:group-hover:text-primary-300 transition-colors"
			>
				{diaSemana(ativa.data_inicio)}, {fmtDate(ativa.data_inicio)}
			</p>
			<p class="text-sm font-medium text-surface-600 dark:text-surface-300 mt-1">
				{ativa.hora_entrada} às {ativa.hora_saida}
			</p>
		</div>

		<div class="flex flex-col gap-2 pt-3 border-t border-surface-100 dark:border-surface-700/50">
			{#if isSupervisor && ativa.supervisor_id === usuario?.id}
				<div class="flex gap-2 w-full">
					<button
						type="button"
						class="btn btn-sm flex-1 font-bold text-xs px-3 py-1.5 flex items-center justify-center gap-1 transition-all {ativa.status ===
						'aguardando_assinatura'
							? 'preset-filled-warning-500'
							: escalaConcluida
								? 'preset-filled-success-500 text-white'
								: 'bg-surface-200/50 dark:bg-surface-800 text-surface-600 dark:text-surface-400 border border-surface-300/50 dark:border-surface-700'}"
						onclick={onAssEscala}
						title={ativa.status === 'aguardando_assinatura'
							? assinaViaToken
								? 'Assinar via Token'
								: 'Assinar em Tela'
							: escalaConcluida
								? 'Escala já assinada'
								: 'Ver o que falta para assinar'}
					>
						{#if escalaConcluida}
							<Check class="w-3 h-3 shrink-0" strokeWidth={3} aria-hidden="true" />
						{:else}
							<PenLine class="w-3 h-3 shrink-0" aria-hidden="true" />
						{/if}
						{escalaConcluida ? 'Escala assinada' : 'Ass. Escala'}
					</button>

					<button
						type="button"
						class="btn btn-sm flex-1 font-bold text-xs px-3 py-1.5 flex items-center justify-center gap-1 transition-all {extraConcluido
							? 'preset-filled-success-500 text-white'
							: extraParcial
								? 'preset-filled-warning-500'
								: ativa.extrasPendentes > 0
									? 'preset-filled-warning-500'
									: 'bg-surface-200/50 dark:bg-surface-800 text-surface-600 dark:text-surface-400 border border-surface-300/50 dark:border-surface-700'}"
						onclick={onAssExtra}
						title={ativa.extrasPendentes > 0
							? assinaViaToken
								? 'Assinar extras via Token'
								: 'Assinar extras em Tela'
							: extraConcluido
								? 'Todos os extras assinados'
								: 'Ver status dos extras'}
					>
						{#if extraConcluido}
							<Check class="w-3 h-3 shrink-0" strokeWidth={3} aria-hidden="true" />
						{:else}
							<PenLine class="w-3 h-3 shrink-0" aria-hidden="true" />
						{/if}
						{extraConcluido ? 'Extra assinado' : `Ass. Extra (${jaAssinados}/${totalExtras})`}
					</button>
				</div>
			{/if}

			<button
				type="button"
				class="btn btn-sm w-full md:hidden {menuExpandidoId === ativa.id
					? 'preset-filled-primary-500'
					: 'preset-outlined-surface-500'} text-xs px-3 py-1.5 transition-all font-bold"
				onclick={onToggleMenu}
			>
				{menuExpandidoId === ativa.id ? 'Ocultar' : 'Opções'}
			</button>

			<!--
				`larguraDesktop`, e não o predicado de aparelho: o botão "Opções"
				acima é `md:hidden`, então a partir de 768 px não existe nada na
				tela capaz de abrir esta linha — ela precisa vir aberta na MESMA
				largura em que aquele botão some.
			-->
			{#if larguraDesktop || menuExpandidoId === ativa.id}
				<div
					class="flex flex-row gap-2 mt-1 w-full"
					transition:slide={{ duration: larguraDesktop ? 0 : 200 }}
				>
					<button
						type="button"
						class="btn flex-1 justify-center preset-outlined-surface-500 text-xs py-2 px-1 font-semibold whitespace-nowrap"
						onclick={() => goto(`/operacoes/gise/${ativa.id}`)}
					>
						Abrir escala
					</button>
					<button
						type="button"
						class="btn flex-1 justify-center preset-outlined-surface-500 text-xs py-2 px-1 font-semibold whitespace-nowrap"
						onclick={onEscalaPdf}
					>
						Escala PDF
					</button>
					<button
						type="button"
						class="btn flex-1 justify-center preset-outlined-surface-500 text-xs py-2 px-1 font-semibold whitespace-nowrap"
						onclick={onExtraPdf}
						title={isSupervisor
							? 'Baixar relatório de extra da supervisão'
							: 'Entrar na escala para escolher o relatório'}
					>
						Extra PDF
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>
