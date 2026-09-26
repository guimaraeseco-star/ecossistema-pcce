<script lang="ts">
	/**
	 * Modal de NOVA ESCALA. Um formulário por tipo, porque os três não têm nada
	 * em comum além do título:
	 *
	 * - `plantao` e `expediente` são MENSAIS: escolhe-se mês/ano e o intervalo é
	 *   preenchido do dia 1 ao último (`preencherMensal`), com horário 00:00 →
	 *   23:59 — a escala cobre o mês inteiro, o horário de cada plantão é por
	 *   servidor;
	 * - `fds` é por DIAS avulsos, escolhidos num calendário, com um horário único
	 *   aplicado a todos.
	 *
	 * `escalasExistentes` chega do pai só para evitar duplicata ANTES do submit:
	 * `mesOcupado` desabilita mês que já tem escala daquele tipo naquela lotação,
	 * e `mesAnteriorInfo` habilita "criar com base no mês anterior". É prevenção
	 * de UI — quem valida de verdade é `verificarEscalaExistente` no servidor,
	 * que aqui só devolveria erro depois de o usuário preencher tudo.
	 *
	 * Todo o estado é resetado ao FECHAR (não ao abrir): reabrir depois de um
	 * cancelamento não pode trazer de volta o rascunho da tentativa anterior.
	 */
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import {
		MESES_PT,
		DIAS_SEMANA_CURTO,
		isoData,
		diasNoMes,
		labelFds,
		adicionarDias,
		formatarDiaMes
	} from '$lib/utils/datas';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import Calendar from '@lucide/svelte/icons/calendar';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import type { Unidade } from '$lib/types';
	import type { ActionResult } from '@sveltejs/kit';
	import SeletorHoraMinuto from '$lib/components/SeletorHoraMinuto.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { opcoesDeUnidades } from '$lib/unidades/opcoes';

	let {
		open = $bindable(false),
		isAdmin,
		lotacaoUsuario,
		unidades,
		escalasExistentes,
		oncriado,
		onfechar
	}: {
		open: boolean;
		isAdmin: boolean;
		lotacaoUsuario: string | null;
		unidades: Unidade[];
		escalasExistentes: { lotacao: string; tipo: string | null; mes: number; ano: number }[];
		oncriado: (id: number) => void;
		onfechar: () => void;
	} = $props();

	let tipo = $state<'plantao' | 'expediente' | 'fds' | null>(null);
	let pendingCriar = $state(false);
	let pendingComBase = $state(false);
	let titulo = $state('');
	let cidade = $state('');
	let dataInicio = $state('');
	let dataFim = $state('');
	let horaEntrada = $state('00');
	let minutoEntrada = $state('00');
	let horaSaida = $state('23');
	let minutoSaida = $state('59');
	let lotacao = $state('');
	let pickerAno = $state(new Date().getFullYear());

	let fdsDias = $state<string[]>([]);
	let calAno = $state(new Date().getFullYear());
	let calMes = $state(new Date().getMonth());
	let fdsHoraEntrada = $state('08');
	let fdsMinutoEntrada = $state('00');
	let fdsHoraSaida = $state('08');
	let fdsMinutoSaida = $state('00');

	$effect(() => {
		if (open) return;
		// reset ao fechar
		tipo = null;
		fdsDias = [];
		titulo = '';
		dataInicio = '';
		dataFim = '';
		cidade = '';
		pickerAno = new Date().getFullYear();
		if (!isAdmin) lotacao = '';
	});

	const delegacias = $derived(unidades.filter((u: Unidade) => u.tipo === 'delegacia'));
	// A escala ainda se liga à unidade pelo NOME (`lotacao`), então a escolha devolve o nome.
	const opcoesDelegacia = $derived(opcoesDeUnidades(delegacias, { valor: 'nome', maes: unidades }));
	const unidadeSelecionada = $derived(
		isAdmin
			? (delegacias.find((u: Unidade) => u.nome === lotacao) ?? null)
			: (unidades.find((u: Unidade) => u.nome === lotacaoUsuario) ?? null)
	);

	const fdsDiasOrdenados = $derived([...fdsDias].sort());
	const fdsDataInicio = $derived(fdsDiasOrdenados[0] ?? '');
	const fdsDataFim = $derived(fdsDiasOrdenados.at(-1) ?? '');
	const fdsLotacao = $derived(isAdmin ? lotacao : (lotacaoUsuario ?? ''));
	const fdsCidade = $derived(unidadeSelecionada?.cidade ?? '');
	const fdsTituloAuto = $derived.by(() => {
		if (!fdsLotacao || fdsDiasOrdenados.length === 0) return '';
		const inicio = new Date(fdsDiasOrdenados[0] + 'T00:00:00');
		const fim = new Date(fdsDiasOrdenados.at(-1)! + 'T00:00:00');
		const dS = String(inicio.getDate()).padStart(2, '0');
		const mS = String(inicio.getMonth() + 1).padStart(2, '0');
		const dF = String(fim.getDate()).padStart(2, '0');
		const mF = String(fim.getMonth() + 1).padStart(2, '0');
		return `ESCALA DE PLANTÃO DO FINAL DE SEMANA - ${fdsLotacao.toUpperCase()} - ${dS}/${mS} a ${dF}/${mF}`;
	});
	const gradeCalendario = $derived.by(() => {
		const first = new Date(calAno, calMes, 1).getDay();
		const n = new Date(calAno, calMes + 1, 0).getDate();
		const cells: ({ day: number } | null)[] = [];
		for (let i = 0; i < first; i++) cells.push(null);
		for (let d = 1; d <= n; d++) cells.push({ day: d });
		while (cells.length % 7 !== 0) cells.push(null);
		while (cells.length < 42) cells.push(null);
		return cells;
	});
	const mesSelecionado = $derived.by(() => {
		if (!dataInicio || !tipo || tipo === 'fds') return null;
		const parts = dataInicio.split('-').map(Number);
		return { mes: parts[1], ano: parts[0] };
	});
	const mesAnteriorInfo = $derived.by(() => {
		if (!mesSelecionado || !lotacao || !tipo || tipo === 'fds') return null;
		const { mes, ano } = mesSelecionado;
		const mesPrev = mes === 1 ? 12 : mes - 1;
		const anoPrev = mes === 1 ? ano - 1 : ano;
		const existe = escalasExistentes.some(
			(e) => e.lotacao === lotacao && e.tipo === tipo && e.mes === mesPrev && e.ano === anoPrev
		);
		return { mes: mesPrev, ano: anoPrev, existe };
	});
	const fdsHorarioLabel = $derived(
		`${fdsHoraEntrada}:${fdsMinutoEntrada}H A ${fdsHoraSaida}:${fdsMinutoSaida}H`
	);

	function nextMes(): number {
		const m = new Date().getMonth() + 1;
		return m === 12 ? 1 : m + 1;
	}
	function nextAno(): number {
		const h = new Date();
		return h.getMonth() + 1 === 12 ? h.getFullYear() + 1 : h.getFullYear();
	}
	function sabadoDaSemanaLocal(): Date {
		const hoje = new Date();
		const dow = hoje.getDay();
		const offset = dow === 0 ? -1 : 6 - dow;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const sab = new Date(hoje);
		sab.setDate(hoje.getDate() + offset);
		return sab;
	}
	function mesOcupado(mes: number, ano: number): boolean {
		const loc = isAdmin ? lotacao : (lotacaoUsuario ?? '');
		if (!loc || !tipo || tipo === 'fds') return false;
		return escalasExistentes.some(
			(e) => e.lotacao === loc && e.tipo === tipo && e.mes === mes && e.ano === ano
		);
	}
	function preencherMensal(t: 'plantao' | 'expediente', u: Unidade, mes: number, ano: number) {
		dataInicio = isoData(ano, mes, 1);
		dataFim = isoData(ano, mes, diasNoMes(ano, mes));
		horaEntrada = '00';
		minutoEntrada = '00';
		horaSaida = '23';
		minutoSaida = '59';
		const tipoLabel = t === 'plantao' ? 'PLANTÃO' : 'EXPEDIENTE';
		titulo = `ESCALA DE ${tipoLabel} DA ${u.nome.toUpperCase()} – ${MESES_PT[mes - 1].toUpperCase()} ${ano}`;
		cidade = u.cidade || '';
		lotacao = u.nome;
	}
	function escolherTipo(t: 'plantao' | 'expediente' | 'fds') {
		if (t === 'fds') {
			const sab = sabadoDaSemanaLocal();
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const dom = new Date(sab);
			dom.setDate(sab.getDate() + 1);
			const fmt = (d: Date) =>
				`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
			fdsDias = [fmt(sab), fmt(dom)];
			calAno = sab.getFullYear();
			calMes = sab.getMonth();
			fdsHoraEntrada = '08';
			fdsMinutoEntrada = '00';
			fdsHoraSaida = '08';
			fdsMinutoSaida = '00';
		} else {
			dataInicio = '';
			dataFim = '';
			titulo = '';
			pickerAno = new Date().getFullYear();
		}
		tipo = t;
	}
	function selecionarMes(mes: number) {
		const u = unidadeSelecionada;
		if (u && tipo && tipo !== 'fds') preencherMensal(tipo, u, mes, pickerAno);
	}
	function tiposDisponiveis(u: Unidade) {
		const sab = sabadoDaSemanaLocal();
		const sabISO = isoData(sab.getFullYear(), sab.getMonth() + 1, sab.getDate());
		const tipos: Array<{
			tipo: 'plantao' | 'expediente' | 'fds';
			label: string;
			desc: string;
			icon: typeof Moon;
		}> = [];
		if (u.tem_plantao)
			tipos.push({
				tipo: 'plantao',
				label: 'Plantão Mensal',
				desc: `${MESES_PT[nextMes() - 1]} ${nextAno()}`,
				icon: Moon
			});
		if (u.tem_expediente)
			tipos.push({
				tipo: 'expediente',
				label: 'Expediente Mensal',
				desc: `${MESES_PT[nextMes() - 1]} ${nextAno()}`,
				icon: Sun
			});
		if (u.tem_fds)
			tipos.push({
				tipo: 'fds',
				label: 'Final de Semana',
				desc: labelFds(sabISO, adicionarDias(sabISO, 1)),
				icon: Calendar
			});
		return tipos;
	}
	function calToggleDia(iso: string) {
		if (fdsDias.includes(iso)) fdsDias = fdsDias.filter((d) => d !== iso);
		else fdsDias = [...fdsDias, iso];
	}
	function calMesAnterior() {
		if (calMes === 0) {
			calMes = 11;
			calAno--;
		} else calMes--;
	}
	function calMesProximo() {
		if (calMes === 11) {
			calMes = 0;
			calAno++;
		} else calMes++;
	}

	function handleCriar({ cancel }: { cancel: () => void }) {
		if (tipo === 'fds' && fdsDiasOrdenados.length === 0) {
			toaster.create({ title: 'Selecione pelo menos um dia', type: 'error' });
			cancel();
			return;
		}
		pendingCriar = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingCriar = false;
			const d =
				result.type === 'success' || result.type === 'failure'
					? (result.data as Record<string, unknown> | undefined)
					: undefined;
			if (result.type === 'success' && d?.id) {
				open = false;
				toaster.create({ title: 'Escala criada com sucesso', type: 'success' });
				oncriado(d.id as number);
			} else if (result.type === 'failure' || result.type === 'error') {
				toaster.create({ title: String(d?.error || 'Erro ao criar escala'), type: 'error' });
			}
		};
	}
	function handleCriarComBase() {
		pendingComBase = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingComBase = false;
			const d =
				result.type === 'success' || result.type === 'failure'
					? (result.data as Record<string, unknown> | undefined)
					: undefined;
			if (result.type === 'success' && d?.id) {
				const adicionados = (d.adicionados as number) ?? 0;
				const naoProcessados = (d.nao_processados as Array<{ nome: string }>) ?? [];
				open = false;
				if (naoProcessados.length > 0) {
					toaster.create({
						title: `Escala criada com ${adicionados} servidor(es)`,
						description: `${naoProcessados.length} servidor(es) não processados (rotação não identificada).`,
						type: 'success'
					});
				} else {
					toaster.create({
						title: `Escala criada com ${adicionados} servidor(es)`,
						type: 'success'
					});
				}
				oncriado(d.id as number);
			} else if (result.type === 'failure' || result.type === 'error') {
				toaster.create({ title: String(d?.error || 'Erro ao criar escala'), type: 'error' });
			}
		};
	}
</script>

<!--
	Exceção deliberada ao ModalShell: este wizard mantém navegação, validação e
	ações dentro de cada etapa, sem o rodapé fixo do primitive. Extrair apenas a
	moldura adicionaria variantes sem reduzir as regras locais.
-->
<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open) {
			open = false;
			onfechar();
		}
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 w-full max-w-lg card-elevated shadow-2xl rounded-2xl overflow-y-auto max-h-[calc(100dvh-2rem)]"
		>
			<Dialog.Title class="h3 font-bold mb-4">Nova Escala</Dialog.Title>

			{#if tipo === null}
				<!-- Passo 1: escolha de tipo -->
				{#if isAdmin}
					<label class="label mb-4">
						<span class="label-text font-semibold">Unidade</span>
						<SearchableSelect
							bind:value={() => lotacao || null, (v) => (lotacao = v == null ? '' : String(v))}
							options={opcoesDelegacia}
							ariaLabel="Unidade"
						/>
					</label>
				{/if}

				{#if unidadeSelecionada}
					{#if !isAdmin}
						<p class="text-sm font-semibold text-surface-600 dark:text-surface-400 mb-3">
							{unidadeSelecionada.nome}
						</p>
					{/if}
					<p class="text-sm text-surface-600 dark:text-surface-400 mb-3">Qual tipo de escala?</p>
					<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
						{#each tiposDisponiveis(unidadeSelecionada) as t (t.tipo)}
							<button
								type="button"
								class="p-4 rounded-2xl border-2 border-surface-200 dark:border-white/10 bg-surface-100/60 dark:bg-surface-800/60 hover:border-primary-500 hover:bg-primary-500/10 transition-all text-center group"
								onclick={() => escolherTipo(t.tipo)}
							>
								<t.icon
									class="w-7 h-7 mx-auto mb-1 text-surface-600 dark:text-surface-300 group-hover:text-primary-500 transition-colors"
									aria-hidden="true"
								/>
								<p class="font-bold text-sm group-hover:text-primary-500 transition-colors">
									{t.label}
								</p>
								<p class="text-xs text-surface-600 dark:text-surface-400 mt-0.5">{t.desc}</p>
							</button>
						{/each}
					</div>
				{:else if !isAdmin}
					<p class="text-sm text-surface-600 dark:text-surface-400 py-4 text-center">
						Nenhum tipo de escala configurado para sua unidade.
					</p>
				{/if}

				<div class="flex justify-end mt-6">
					<button
						type="button"
						class="btn preset-outlined-surface-500"
						onclick={() => {
							open = false;
							onfechar();
						}}
					>
						Cancelar
					</button>
				</div>
			{:else if tipo === 'fds'}
				<!-- Calendário FDS -->
				<div class="space-y-2.5">
					<div>
						<h2 class="text-base font-bold text-surface-900 dark:text-surface-50 leading-tight">
							Nova Escala — Final de Semana
						</h2>
						{#if unidadeSelecionada}
							<p class="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
								{unidadeSelecionada.nome}
							</p>
						{/if}
					</div>

					<div
						class="rounded-xl border border-surface-200 dark:border-surface-700 p-2 sm:p-2.5 space-y-1 bg-white dark:bg-surface-800/40"
					>
						<div class="flex items-center justify-between gap-1.5">
							<button
								type="button"
								class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
								aria-label="Mês anterior"
								onclick={calMesAnterior}
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
								class="text-xs sm:text-sm font-semibold text-surface-800 dark:text-surface-100 text-center min-w-0 flex-1"
							>
								{MESES_PT[calMes]} de {calAno}
							</p>
							<button
								type="button"
								class="btn preset-outlined-surface-500 p-1.5 rounded-lg shrink-0"
								aria-label="Próximo mês"
								onclick={calMesProximo}
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
									{@const iso = isoData(calAno, calMes + 1, cell.day)}
									{@const sel = fdsDias.includes(iso)}
									<button
										type="button"
										onclick={() => calToggleDia(iso)}
										class="h-9 rounded-md text-xs font-medium transition-colors border flex items-center justify-center touch-manipulation
										{sel
											? 'border-warning-500 bg-warning-500/15 text-warning-900 dark:text-warning-100'
											: 'border-transparent bg-surface-100/80 dark:bg-surface-700/50 text-surface-700 dark:text-surface-200 hover:bg-surface-200/80 dark:hover:bg-surface-600'}"
										aria-pressed={sel}
										aria-label="Dia {cell.day} de {MESES_PT[calMes]}">{cell.day}</button
									>
								{:else}
									<div class="h-9"></div>
								{/if}
							{/each}
						</div>
					</div>

					{#if fdsDiasOrdenados.length > 0}
						<div class="min-w-0 space-y-0.5">
							<span class="text-3xs font-semibold text-surface-600 dark:text-surface-400"
								>Dias selecionados ({fdsDiasOrdenados.length})</span
							>
							<div
								class="flex flex-nowrap items-stretch gap-1.5 overflow-x-auto max-w-full pb-0.5 [scrollbar-width:thin]"
							>
								{#each fdsDiasOrdenados as iso (iso)}
									<span
										class="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-md text-3xs font-medium border shrink-0 border-warning-400/80 bg-warning-500/10 text-warning-900 dark:text-warning-100"
									>
										{formatarDiaMes(iso)}
										<button
											type="button"
											class="p-0.5 rounded text-surface-400 hover:text-error-600 dark:hover:text-error-400 shrink-0"
											aria-label="Remover {formatarDiaMes(iso)}"
											onclick={() => (fdsDias = fdsDias.filter((d) => d !== iso))}
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

					<div
						class="rounded-xl border border-surface-200 dark:border-surface-700 p-2.5 space-y-1.5"
					>
						<p class="text-3xs sm:text-xs font-semibold text-surface-600 dark:text-surface-400">
							Horário
						</p>
						<div class="grid grid-cols-2 gap-2">
							<div>
								<span class="text-3xs text-surface-600 dark:text-surface-400 block mb-0.5"
									>Hora entrada</span
								>
								<div class="flex gap-1">
									<SeletorHoraMinuto
										bind:hora={fdsHoraEntrada}
										bind:minuto={fdsMinutoEntrada}
										selectClass="select text-xs flex-1"
									/>
								</div>
							</div>
							<div>
								<span class="text-3xs text-surface-600 dark:text-surface-400 block mb-0.5"
									>Hora saída</span
								>
								<div class="flex gap-1">
									<SeletorHoraMinuto
										bind:hora={fdsHoraSaida}
										bind:minuto={fdsMinutoSaida}
										selectClass="select text-xs flex-1"
									/>
								</div>
							</div>
						</div>
						<p class="text-3xs text-primary-600 dark:text-primary-400 font-medium">
							{fdsHorarioLabel}
						</p>
					</div>

					{#if fdsTituloAuto}
						<div class="rounded-xl bg-surface-100 dark:bg-surface-800/50 px-3 py-2">
							<p class="text-3xs text-surface-600 dark:text-surface-400 mb-0.5">Título gerado</p>
							<p class="text-xs text-surface-700 dark:text-surface-200 font-medium leading-snug">
								{fdsTituloAuto}
							</p>
						</div>
					{/if}

					<div class="flex justify-end gap-2 pt-1">
						<button
							type="button"
							class="btn preset-outlined-surface-500 text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl"
							onclick={() => (tipo = null)}>← Voltar</button
						>
						<form method="POST" action="?/criar" use:enhance={handleCriar} class="contents">
							<input type="hidden" name="tipo" value="fds" />
							<input type="hidden" name="data_inicio" value={fdsDataInicio} />
							<input type="hidden" name="data_fim" value={fdsDataFim} />
							<input
								type="hidden"
								name="hora_entrada"
								value={`${fdsHoraEntrada}:${fdsMinutoEntrada}`}
							/>
							<input type="hidden" name="hora_saida" value={`${fdsHoraSaida}:${fdsMinutoSaida}`} />
							<input type="hidden" name="cidade" value={fdsCidade} />
							<input type="hidden" name="lotacao" value={fdsLotacao} />
							<input type="hidden" name="titulo" value={fdsTituloAuto} />
							<button
								type="submit"
								class="btn preset-filled-warning-500 border-2 border-warning-600/30 hover:border-warning-600 text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl transition-all"
								disabled={pendingCriar || fdsDiasOrdenados.length === 0}
							>
								{pendingCriar ? 'Criando...' : 'Criar Escala'}
							</button>
						</form>
					</div>
				</div>
			{:else}
				<!-- Plantão / Expediente — Picker de mês -->
				<div class="space-y-4">
					<div>
						<h2 class="text-base font-bold text-surface-900 dark:text-surface-50 leading-tight">
							Nova Escala — {tipo === 'plantao' ? 'Plantão Mensal' : 'Expediente Mensal'}
						</h2>
						{#if unidadeSelecionada}
							<p class="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
								{unidadeSelecionada.nome}
							</p>
						{/if}
					</div>

					<div class="flex items-center justify-between gap-2">
						<button
							type="button"
							class="btn preset-outlined-surface-500 p-1.5 rounded-lg"
							aria-label="Ano anterior"
							onclick={() => pickerAno--}
						>
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15 19l-7-7 7-7"
								/></svg
							>
						</button>
						<span class="font-bold text-lg text-surface-900 dark:text-surface-50">{pickerAno}</span>
						<button
							type="button"
							class="btn preset-outlined-surface-500 p-1.5 rounded-lg"
							aria-label="Próximo ano"
							onclick={() => pickerAno++}
						>
							<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 5l7 7-7 7"
								/></svg
							>
						</button>
					</div>

					<div class="grid grid-cols-4 gap-2">
						{#each MESES_PT as nomeMes, i (nomeMes)}
							{@const mesNum = i + 1}
							{@const ocupado = mesOcupado(mesNum, pickerAno)}
							{@const selecionado =
								mesSelecionado?.mes === mesNum && mesSelecionado?.ano === pickerAno}
							<button
								type="button"
								disabled={ocupado}
								onclick={() => selecionarMes(mesNum)}
								class="py-2.5 px-1 rounded-xl border-2 text-sm font-medium transition-all relative
								{ocupado
									? 'opacity-40 cursor-not-allowed border-surface-200 dark:border-white/10 text-surface-400 dark:text-surface-500 bg-surface-100 dark:bg-surface-800/30'
									: selecionado
										? 'border-primary-500 bg-primary-500/15 text-primary-700 dark:text-primary-400'
										: 'border-surface-200 dark:border-white/10 hover:border-primary-400 hover:bg-primary-500/10 text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-800/30'}"
								title={ocupado ? 'Escala já criada para este mês' : nomeMes}
							>
								{nomeMes.substring(0, 3)}
								{#if ocupado}
									<span
										class="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-surface-400 dark:bg-surface-500"
									></span>
								{/if}
							</button>
						{/each}
					</div>

					{#if titulo}
						<div class="rounded-xl bg-surface-100 dark:bg-surface-800/50 px-3 py-2">
							<p class="text-3xs text-surface-600 dark:text-surface-400 mb-0.5">Título gerado</p>
							<p class="text-xs text-surface-700 dark:text-surface-200 font-medium leading-snug">
								{titulo}
							</p>
						</div>

						<p class="text-xs font-semibold text-surface-600 dark:text-surface-400">
							Como deseja criar esta escala?
						</p>

						<div class="grid grid-cols-2 gap-2">
							<form
								method="POST"
								action="?/criarComBase"
								use:enhance={handleCriarComBase}
								class="contents"
							>
								<input type="hidden" name="lotacao" value={lotacao} />
								<input type="hidden" name="tipo" value={tipo} />
								<input type="hidden" name="mes" value={mesSelecionado?.mes} />
								<input type="hidden" name="ano" value={mesSelecionado?.ano} />
								<button
									type="submit"
									disabled={pendingComBase || !mesAnteriorInfo?.existe}
									title={mesAnteriorInfo?.existe ? '' : 'Sem escala no mês anterior para copiar'}
									class="p-3 rounded-xl border-2 text-left transition-all h-full
									{mesAnteriorInfo?.existe
										? 'border-surface-300 dark:border-white/15 hover:border-primary-500 hover:bg-primary-500/10 cursor-pointer'
										: 'opacity-40 cursor-not-allowed border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-surface-800/20'}"
								>
									<p
										class="font-semibold text-sm text-surface-800 dark:text-surface-100 leading-tight"
									>
										Com base em {MESES_PT[(mesAnteriorInfo?.mes ?? 1) - 1]}/{mesAnteriorInfo?.ano}
									</p>
									<p class="text-xs text-surface-600 dark:text-surface-400 mt-1 leading-snug">
										{tipo === 'plantao'
											? 'Copia os servidores e recalcula os dias pela rotação'
											: 'Copia os servidores do mês anterior'}
									</p>
									{#if pendingComBase}<p class="text-xs text-primary-500 mt-1">Gerando...</p>{/if}
								</button>
							</form>

							<form method="POST" action="?/criar" use:enhance={handleCriar} class="contents">
								<input type="hidden" name="titulo" value={titulo} />
								<input type="hidden" name="data_inicio" value={dataInicio} />
								<input type="hidden" name="data_fim" value={dataFim} />
								<input
									type="hidden"
									name="hora_entrada"
									value={`${horaEntrada}:${minutoEntrada}`}
								/>
								<input type="hidden" name="hora_saida" value={`${horaSaida}:${minutoSaida}`} />
								<input type="hidden" name="tipo" value={tipo} />
								<input type="hidden" name="cidade" value={cidade} />
								<input type="hidden" name="lotacao" value={lotacao} />
								<button
									type="submit"
									disabled={pendingCriar}
									class="p-3 rounded-xl border-2 text-left transition-all h-full border-surface-300 dark:border-white/15 hover:border-success-500 hover:bg-success-500/10 cursor-pointer"
								>
									<p
										class="font-semibold text-sm text-surface-800 dark:text-surface-100 leading-tight"
									>
										Escala limpa
									</p>
									<p class="text-xs text-surface-600 dark:text-surface-400 mt-1 leading-snug">
										Começa do zero, sem servidores
									</p>
									{#if pendingCriar}<p class="text-xs text-success-500 mt-1">Criando...</p>{/if}
								</button>
							</form>
						</div>
					{/if}

					<div class="flex justify-start pt-1">
						<button
							type="button"
							class="btn btn-sm preset-outlined-surface-500"
							onclick={() => {
								tipo = null;
								dataInicio = '';
								dataFim = '';
								titulo = '';
							}}>← Voltar</button
						>
					</div>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog>
