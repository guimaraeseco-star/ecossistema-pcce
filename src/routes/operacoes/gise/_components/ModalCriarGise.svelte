<script lang="ts">
	/**
	 * Modal de CRIAR GISE — cria uma escala por DIA selecionado no calendário,
	 * em lote. GISE é serviço de um dia, então abrir o mês inteiro de uma vez é o
	 * uso normal, não exceção.
	 *
	 * Três modos, que só mudam a ESTRUTURA inicial de cada escala criada:
	 * - `completa`: uma seccional para cada seccional cadastrada;
	 * - `clonada`: copia a árvore de outra GISE (seccionais, slots e equipes com
	 *   suas vagas) — sem membros, que são preenchidos do zero;
	 * - `branco`: só a escala, sem seccional nenhuma.
	 *
	 * Cada dia pode ser marcado como FERIADO no próprio calendário, porque isso
	 * muda o efetivo esperado, e a marcação é por dia — não por lote.
	 *
	 * A seleção viaja num hidden como JSON (`datasJsonHidden`) em vez de um campo
	 * por dia: são até 31 datas com a flag de feriado junto, e o servidor cria
	 * todas em paralelo.
	 */
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { MESES_PT, DIAS_SEMANA_CURTO, isoData, hojeLocalISO } from '$lib/utils/datas';
	import { fmtDate, diaSemana } from '$lib/gise/formatters';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { loading } from '$lib/loading.svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import CalendarioNavMes from '$lib/components/CalendarioNavMes.svelte';
	import { page } from '$app/state';
	import type { ActionResult } from '@sveltejs/kit';

	let {
		open = $bindable(false),
		escalas,
		operacoes = [],
		onSuccess
	}: {
		open: boolean;
		escalas: { id: number; data_inicio: string; status: string }[];
		/**
		 * Operações ATIVAS que podem receber escalas novas, com o horário padrão de
		 * cada uma — trocar de operação troca os horários sugeridos.
		 */
		operacoes?: {
			id: number;
			nome: string;
			hora_entrada_padrao?: string | null;
			hora_saida_padrao?: string | null;
		}[];
		onSuccess: (count: number, firstId?: number) => void;
	} = $props();

	let diasModal = $state<Record<string, { f: boolean }>>({});
	let calAno = $state(2026);
	let calMes = $state(0);
	let novaHoraEntrada = $state('08:00');
	let novaHoraSaida = $state('16:00');
	let modoCriacao = $state<'completa' | 'clonada' | 'branco'>('completa');
	let clonarDeId = $state<number | ''>('');
	/**
	 * Operação da escala nova. Inicia na primeira ativa em vez de vazia: a escala
	 * SEMPRE pertence a uma operação, e um seletor em branco convidaria a criar
	 * escala sem operação — que é o estado legado que a migração 0048 eliminou.
	 */
	// svelte-ignore state_referenced_locally
	let operacaoId = $state<number | ''>(operacoes[0]?.id ?? '');

	const diasModalOrdenados = $derived(
		Object.keys(diasModal)
			.sort()
			.map((iso) => ({ iso, feriado: diasModal[iso].f }))
	);
	const datasJsonHidden = $derived(
		JSON.stringify(diasModalOrdenados.map(({ iso, feriado }) => ({ data: iso, feriado })))
	);
	const calTitulo = $derived(`${MESES_PT[calMes]} de ${calAno}`);
	const gradeCalendario = $derived.by(() => {
		const year = calAno;
		const month = calMes;
		const first = new Date(year, month, 1).getDay();
		const n = new Date(year, month + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < first; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		while (cells.length < 42) cells.push(null);
		return cells;
	});

	let prevOpen = false;
	$effect(() => {
		if (open && !prevOpen) {
			const h = hoje();
			diasModal = { [h]: { f: false } };
			const [y, m] = h.split('-').map(Number);
			calAno = y;
			calMes = m - 1;
			modoCriacao = 'completa';
			clonarDeId = escalas.length > 0 ? escalas[0].id : '';
			operacaoId = operacoes[0]?.id ?? '';
			aplicarHorarioDaOperacao(operacaoId);
		}
		prevOpen = open;
	});

	/**
	 * Horário sugerido ao trocar de operação: o padrão DELA, senão o do sistema.
	 *
	 * Só reescreve os campos, sem travá-los — o admin continua podendo digitar
	 * outro horário para esta escala. Sem isto, escolher a CRAJUBAR mantinha na
	 * tela o horário do GISE e a escala nascia com ele.
	 */
	function aplicarHorarioDaOperacao(id: number | '') {
		const op = operacoes.find((o) => o.id === id);
		novaHoraEntrada =
			op?.hora_entrada_padrao ?? (page.data.defaultHoraEntrada as string) ?? '08:00';
		novaHoraSaida = op?.hora_saida_padrao ?? (page.data.defaultHoraSaida as string) ?? '16:00';
	}

	function calCicloDia(iso: string) {
		const next = { ...diasModal };
		if (!(iso in next)) {
			next[iso] = { f: false };
		} else if (!next[iso].f) {
			next[iso] = { f: true };
		} else {
			delete next[iso];
		}
		diasModal = next;
	}

	function calRemoverDia(iso: string) {
		if (!(iso in diasModal)) return;
		const next = { ...diasModal };
		delete next[iso];
		diasModal = next;
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

	function validarHora(v: string): boolean {
		if (!v) return true;
		return /^\d{1,2}:\d{2}$/.test(v);
	}

	const hoje = hojeLocalISO;

	function handleCriarGise({ cancel }: { cancel: () => void }) {
		if (diasModalOrdenados.length === 0) {
			toaster.error({ title: 'Selecione pelo menos um dia' });
			cancel();
			return;
		}
		if (!novaHoraEntrada || !novaHoraSaida) {
			toaster.error({ title: 'Preencha os horários' });
			cancel();
			return;
		}
		if (!validarHora(novaHoraEntrada) || !validarHora(novaHoraSaida)) {
			toaster.error({ title: 'Formato inválido', description: 'Use o formato HH:MM, ex: 08:00' });
			cancel();
			return;
		}
		loading.show('Criando escala(s) GISE...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				const d = result.data as Record<string, unknown>;
				const count = (d.count as number) ?? 1;
				const primeiroId = (d.ids as number[])?.[0] ?? (d.id as number);
				toaster.success({
					title: `${count} escala(s) GISE criada(s)`,
					description: count > 1 ? 'As escalas foram adicionadas à lista de escalas ativas.' : ''
				});
				open = false;
				await invalidateShared('app:gise-list');
				onSuccess(count, primeiroId);
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.error({ title: (d?.error as string) || 'Erro ao criar GISE' });
			}
		};
	}
</script>

<!--
	Exceção deliberada ao ModalShell: wizard com calendário, três modos de
	criação e ações por etapa — o mesmo motivo de `ModalNovaEscala`. Extrair
	só a moldura adicionaria variantes sem reduzir as regras locais.
-->
<Dialog
	{open}
	onOpenChange={(e) => {
		if (!loading.active) open = e.open;
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card-elevated rounded-2xl shadow-2xl w-full max-w-lg p-3 sm:p-4 space-y-2.5 max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto"
		>
			<Dialog.Title
				class="text-base sm:text-lg font-bold text-surface-900 dark:text-surface-50 leading-tight"
			>
				Nova escala extra
			</Dialog.Title>
			<p class="text-3xs sm:text-xs text-surface-600 dark:text-surface-400 leading-snug">
				Uma escala por dia. No calendário: <span
					class="text-primary-600 dark:text-primary-400 font-medium">1º clique</span
				>
				seleciona (azul), <span class="text-error-600 dark:text-error-400 font-medium">2º</span>
				marca feriado (vermelho),
				<span class="font-medium text-surface-600 dark:text-surface-400">3º</span> remove o dia.
			</p>

			<!-- Calendário -->
			<div
				class="rounded-xl border border-surface-200 dark:border-surface-700 p-2 sm:p-2.5 space-y-1 bg-white dark:bg-surface-800/40"
			>
				<CalendarioNavMes
					titulo={calTitulo}
					onAnterior={calMesAnterior}
					onProximo={calMesProximo}
				/>
				<div
					class="grid grid-cols-7 gap-px text-center text-3xs font-semibold uppercase tracking-wide text-surface-600 dark:text-surface-400 py-0.5"
				>
					{#each DIAS_SEMANA_CURTO as ds (ds)}
						<span>{ds}</span>
					{/each}
				</div>
				<div class="grid grid-cols-7 gap-0.5">
					{#each gradeCalendario as cell, i (i)}
						{#if cell}
							{@const iso = cell ? isoData(calAno, calMes + 1, cell.day) : ''}
							{@const sel = iso in diasModal}
							{@const fer = sel && diasModal[iso].f}
							{@const ehHoje = iso === hoje()}
							<button
								type="button"
								onclick={() => iso && calCicloDia(iso)}
								class="relative h-9 sm:h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center touch-manipulation
									{sel
									? fer
										? 'border-error-500 bg-error-500/15 text-error-900 dark:text-error-100'
										: 'border-primary-500 bg-primary-500/10 text-primary-800 dark:text-primary-100'
									: 'border-transparent bg-surface-100/80 dark:bg-surface-700/50 text-surface-700 dark:text-surface-200 hover:bg-surface-200/80 dark:hover:bg-surface-600'}
									{ehHoje && !sel ? 'ring-1 ring-surface-400 dark:ring-surface-500' : ''}"
								aria-pressed={sel}
								aria-label="Dia {cell?.day} de {MESES_PT[calMes]}, {sel
									? fer
										? 'feriado'
										: 'selecionado'
									: 'não selecionado'}"
							>
								{cell?.day}
								{#if fer}
									<span
										class="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-error-500"
										title="Feriado"
									></span>
								{/if}
							</button>
						{:else}
							<div class="h-9 sm:h-9"></div>
						{/if}
					{/each}
				</div>
			</div>

			{#if diasModalOrdenados.length > 0}
				<div class="min-w-0 space-y-0.5">
					<span class="text-3xs font-semibold text-surface-600 dark:text-surface-400"
						>Dias ({diasModalOrdenados.length})</span
					>
					<div
						class="flex flex-nowrap items-stretch gap-1.5 overflow-x-auto max-w-full pb-0.5 [scrollbar-width:thin]"
					>
						{#each diasModalOrdenados as { iso, feriado } (iso)}
							<span
								class="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-md text-3xs font-medium border shrink-0
								{feriado
									? 'border-error-400/80 bg-error-500/10 text-error-900 dark:text-error-100'
									: 'border-primary-400/80 bg-primary-500/10 text-primary-900 dark:text-primary-100'}"
							>
								{fmtDate(iso)}
								{#if feriado}<span class="text-3xs font-bold text-error-600 dark:text-error-400"
										>F</span
									>{/if}
								<button
									type="button"
									class="p-0.5 rounded text-surface-400 hover:text-error-600 dark:hover:text-error-400 shrink-0"
									aria-label="Remover {fmtDate(iso)}"
									onclick={() => calRemoverDia(iso)}
								>
									<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
										><path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M6 18L18 6M6 6l12 12"
										/></svg
									>
								</button>
							</span>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Horários -->
			<div class="rounded-xl border border-surface-200 dark:border-surface-700 p-2.5 space-y-1.5">
				<p class="text-3xs sm:text-xs font-semibold text-surface-600 dark:text-surface-400">
					Horário padrão (todos os dias)
				</p>
				<div class="grid grid-cols-2 gap-2">
					<div>
						<label
							for="novaHoraEntrada"
							class="text-3xs text-surface-600 dark:text-surface-400 block mb-0.5">Entrada</label
						>
						<input
							id="novaHoraEntrada"
							type="text"
							placeholder="Ex: 08:00"
							bind:value={novaHoraEntrada}
							class="w-full px-2.5 py-1.5 rounded-lg border bg-white dark:bg-surface-800 text-sm {novaHoraEntrada &&
							!validarHora(novaHoraEntrada)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
					<div>
						<label
							for="novaHoraSaida"
							class="text-3xs text-surface-600 dark:text-surface-400 block mb-0.5">Saída</label
						>
						<input
							id="novaHoraSaida"
							type="text"
							placeholder="Ex: 16:00"
							bind:value={novaHoraSaida}
							class="w-full px-2.5 py-1.5 rounded-lg border bg-white dark:bg-surface-800 text-sm {novaHoraSaida &&
							!validarHora(novaHoraSaida)
								? 'border-error-500'
								: 'border-surface-300 dark:border-surface-700'}"
						/>
					</div>
				</div>
			</div>

			<!-- Operação da escala: decide qual formulário de produtividade as
			     equipes vão preencher e sob quais indicadores ela é medida.
			     No modo "Copiar" não aparece — a cópia herda a operação do original,
			     senão clonar uma escala da CRAJUBAR poderia produzir uma do GISE. -->
			{#if operacoes.length > 0 && modoCriacao !== 'clonada'}
				<div class="space-y-2">
					<label
						for="nova-operacao"
						class="block text-3xs sm:text-xs font-semibold text-surface-600 dark:text-surface-400"
					>
						Operação
					</label>
					<select
						id="nova-operacao"
						bind:value={operacaoId}
						onchange={() => aplicarHorarioDaOperacao(operacaoId)}
						class="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
					>
						{#each operacoes as op (op.id)}
							<option value={op.id}>{op.nome}</option>
						{/each}
					</select>
				</div>
			{/if}

			<!-- Tipo de Criação -->
			<div class="space-y-2">
				<p class="text-3xs sm:text-xs font-semibold text-surface-600 dark:text-surface-400">
					Tipo de Escala
				</p>
				<div class="grid grid-cols-3 gap-1 sm:gap-2">
					<button
						type="button"
						class="btn py-2 rounded-lg flex flex-col items-center gap-0.5 border transition-all min-h-0 {modoCriacao ===
						'completa'
							? 'border-primary-500 bg-primary-500/10 text-primary-600'
							: 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400'}"
						onclick={() => (modoCriacao = 'completa')}
					>
						<span class="font-bold text-3xs sm:text-xs leading-tight text-center">Completa</span>
						<span class="text-3xs opacity-70 leading-tight text-center hidden sm:block"
							>Seccionais</span
						>
					</button>
					<button
						type="button"
						class="btn py-2 rounded-lg flex flex-col items-center gap-0.5 border transition-all min-h-0 {modoCriacao ===
						'branco'
							? 'border-primary-500 bg-primary-500/10 text-primary-600'
							: 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400'}"
						onclick={() => (modoCriacao = 'branco')}
					>
						<span class="font-bold text-3xs sm:text-xs leading-tight text-center">Em branco</span>
						<span class="text-3xs opacity-70 leading-tight text-center hidden sm:block"
							>Sem equipes</span
						>
					</button>
					<button
						type="button"
						class="btn py-2 rounded-lg flex flex-col items-center gap-0.5 border transition-all min-h-0 {modoCriacao ===
						'clonada'
							? 'border-primary-500 bg-primary-500/10 text-primary-600'
							: 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400'}"
						onclick={() => (modoCriacao = 'clonada')}
						disabled={escalas.length === 0}
					>
						<span class="font-bold text-3xs sm:text-xs leading-tight text-center">Copiar</span>
						<span class="text-3xs opacity-70 leading-tight text-center hidden sm:block"
							>De outra</span
						>
					</button>
				</div>

				{#if modoCriacao === 'clonada'}
					<div class="mt-1 animate-in fade-in slide-in-from-top-1 duration-300">
						<label
							for="clonarDe"
							class="text-3xs font-medium text-surface-600 dark:text-surface-400 block mb-0.5"
							>Escolha a escala de origem</label
						>
						<select
							id="clonarDe"
							bind:value={clonarDeId}
							class="w-full px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-xs sm:text-sm"
						>
							{#each escalas.slice(0, 10) as esc (esc.id)}
								<option value={esc.id}>
									GISE — {diaSemana(esc.data_inicio)}
									{fmtDate(esc.data_inicio)} ({esc.status})
								</option>
							{/each}
						</select>
					</div>
				{/if}
			</div>
			<div class="flex justify-end gap-2 pt-1">
				<button
					type="button"
					class="btn preset-outlined-surface-500 text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl"
					onclick={() => (open = false)}
				>
					Cancelar
				</button>
				<form method="POST" action="?/criar" use:enhance={handleCriarGise} class="contents">
					<input type="hidden" name="datas_json" value={datasJsonHidden} />
					<input type="hidden" name="hora_entrada" value={novaHoraEntrada} />
					<input type="hidden" name="hora_saida" value={novaHoraSaida} />
					<input type="hidden" name="modo" value={modoCriacao} />
					{#if modoCriacao !== 'clonada' && operacaoId}
						<input type="hidden" name="operacao_id" value={operacaoId} />
					{/if}
					{#if modoCriacao === 'clonada' && clonarDeId}
						<input type="hidden" name="clonar_de" value={clonarDeId} />
					{/if}
					<button
						type="submit"
						class="btn preset-filled-primary-500 text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl font-semibold"
						disabled={loading.active ||
							diasModalOrdenados.length === 0 ||
							(modoCriacao === 'clonada' && !clonarDeId)}
					>
						{loading.active ? 'Criando...' : 'Criar Escala'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
