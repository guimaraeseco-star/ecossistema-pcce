<script lang="ts">
	/**
	 * Histórico de GISEs encerradas: filtros, paginação e export.
	 *
	 * Tudo aqui é CLIENTE. A lista chega inteira por prop e é filtrada e
	 * paginada em memória — nenhum filtro volta ao servidor. Simples enquanto o
	 * volume for o de um ano de GISEs; se a listagem crescer, é este ponto que
	 * precisa virar consulta paginada, não a UI ao redor.
	 *
	 * A barra de busca detalhada replica `/operacoes/presenca` (`FiltroHistoricoSegmento` e
	 * tokens em `$lib/gise/filtro-historico-ui`), com o seletor de seccional a mais.
	 *
	 * Os três modos de tempo (mês civil, ciclo 21→20 e data exata) são MUTUAMENTE
	 * EXCLUSIVOS na consulta: só o recorte do modo ativo entra no predicado.
	 * Os campos nascem preenchidos com o ciclo/mês/dia correntes; o padrão da
	 * lista é o ciclo que contém hoje. Trocar o seletor esconde o campo inativo
	 * sem apagar o valor, para o usuário não perder o recorte ao ir e voltar.
	 *
	 * Exportar (botão no topo da área de resultados) exige um recorte de tempo
	 * ativo (`podeExportarHistorico`): sem ele o arquivo sairia com a base
	 * inteira. É por isso que o botão nasce desabilitado mesmo para o Admin
	 * Geral, e o histórico já abre filtrado pelo ciclo corrente.
	 */
	import { goto } from '$app/navigation';
	import SkeletonCards from '$lib/components/SkeletonCards.svelte';
	import BotaoLimparFiltros from '$lib/components/BotaoLimparFiltros.svelte';
	import { useSamePathNavigating } from '$lib/composables';
	import { apiFetchResponse } from '$lib/api-fetch';
	import { baixarBlob, nomeArquivoContentDisposition } from '$lib/utils/download';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import Paginador from '$lib/components/Paginador.svelte';
	import { statusLabel, statusColor, fmtDate, diaSemana } from '$lib/gise/formatters';
	import { hojeLocalISO } from '$lib/utils/datas';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { escalaPassaRecorteHistorico, type TipoEquipe } from '$lib/gise/historico-filtro';
	import { anosParaSeletorCiclo, cicloQueContem } from '$lib/gise/ciclos';
	import FiltroHistoricoSegmento from '$lib/gise/FiltroHistoricoSegmento.svelte';
	import CamposPeriodoHistorico from '$lib/gise/CamposPeriodoHistorico.svelte';
	import {
		CLASSE_BARRA_FILTRO,
		CLASSE_CAMPO_FILTRO,
		CLASSE_INPUT_FILTRO,
		CLASSE_ROTULO_FILTRO,
		CLASSE_TITULO_FILTRO
	} from '$lib/gise/filtro-historico-ui';
	import Download from '@lucide/svelte/icons/download';
	import Search from '@lucide/svelte/icons/search';
	import { mensagemDeErro } from '$lib/utils/erro';

	/**
	 * Corpo da página `/operacoes/gise/finalizadas`: escalas encerradas, com filtros
	 * (seccional, tipo de equipe, mês, ciclo ou data exata), paginação e
	 * exportação em XLSX/PDF do recorte filtrado.
	 */
	const {
		historico,
		seccionaisList,
		isAdminGeral
	}: {
		historico: {
			id: number;
			data_inicio: string;
			status: string;
			hora_entrada?: string;
			hora_saida?: string;
			seccionais?: { id: number; tipos?: string[]; nome?: string }[];
		}[];
		seccionaisList: { id: number; nome: string }[];
		isAdminGeral: boolean;
	} = $props();

	/** "2026-07" — recorte civil, usado quando o modo é mês/ano. */
	function getCurrentMonth() {
		return hojeLocalISO().slice(0, 7);
	}

	type ModoPeriodo = 'mes' | 'ciclo' | 'data';

	const cicloCorrente = cicloQueContem(hojeLocalISO());

	let filtroSeccional = $state<number | ''>('');
	let filtroTipoEquipe = $state<TipoEquipe | ''>('');
	let modoPeriodo = $state<ModoPeriodo>('ciclo');
	let filtroMesAno = $state(getCurrentMonth());
	let filtroData = $state(hojeLocalISO());
	let filtroAnoCiclo = $state(cicloCorrente.ano);
	let filtroNumeroCiclo = $state(cicloCorrente.ciclo);
	let paginaHistorico = $state(1);

	const ITEMS_POR_PAGINA = 5;

	const samePathNav = useSamePathNavigating();

	const historicoFiltrado = $derived(
		historico.filter((e) =>
			escalaPassaRecorteHistorico(e, {
				seccionalId: filtroSeccional === '' ? null : Number(filtroSeccional),
				tipoEquipe: filtroTipoEquipe || null,
				mesAno: modoPeriodo === 'mes' ? filtroMesAno : null,
				data: modoPeriodo === 'data' ? filtroData : null,
				anoCiclo: modoPeriodo === 'ciclo' ? filtroAnoCiclo : null,
				numeroCiclo: modoPeriodo === 'ciclo' ? filtroNumeroCiclo : null
			})
		)
	);

	// Exportar exige um recorte de tempo: sem isso o arquivo traria a base inteira.
	const podeExportarHistorico = $derived(
		isAdminGeral &&
			((modoPeriodo === 'mes' && !!filtroMesAno) ||
				(modoPeriodo === 'data' && !!filtroData) ||
				(modoPeriodo === 'ciclo' && filtroAnoCiclo != null && filtroNumeroCiclo != null))
	);

	const temFiltros = $derived.by(() => {
		if (filtroSeccional !== '' || filtroTipoEquipe !== '') return true;
		if (modoPeriodo === 'data' || modoPeriodo === 'mes') return true;
		const corrente = cicloQueContem(hojeLocalISO());
		return filtroAnoCiclo !== corrente.ano || filtroNumeroCiclo !== corrente.ciclo;
	});

	const anosCiclo = $derived.by(() => {
		const base = anosParaSeletorCiclo(hojeLocalISO());
		if (!base.includes(filtroAnoCiclo)) return [...base, filtroAnoCiclo].sort((a, b) => a - b);
		return base;
	});

	const historicoExportSlug = $derived(
		modoPeriodo === 'mes' && filtroMesAno
			? filtroMesAno.replace('-', '')
			: modoPeriodo === 'data' && filtroData
				? `d${filtroData.replace(/-/g, '')}`
				: modoPeriodo === 'ciclo'
					? `c${filtroAnoCiclo}${String(filtroNumeroCiclo).padStart(2, '0')}`
					: 'export'
	);

	function buildHistoricoExportHref(format: 'xlsx' | 'pdf'): string {
		const p = new SvelteURLSearchParams();
		p.set('format', format);
		if (filtroSeccional !== '') p.set('seccionalId', String(filtroSeccional));
		if (filtroTipoEquipe) p.set('tipoEquipe', filtroTipoEquipe);
		if (modoPeriodo === 'mes' && filtroMesAno) {
			p.set('periodo', 'mes');
			p.set('mesAno', filtroMesAno);
		} else if (modoPeriodo === 'data' && filtroData) {
			p.set('periodo', 'data');
			p.set('data', filtroData);
		} else if (modoPeriodo === 'ciclo') {
			p.set('periodo', 'ciclo');
			p.set('ano', String(filtroAnoCiclo));
			p.set('ciclo', String(filtroNumeroCiclo));
		}
		return `/api/gise/historico/export?${p.toString()}`;
	}

	async function baixarHistoricoArquivo(format: 'xlsx' | 'pdf') {
		const fallbackName = `gise_historico_${historicoExportSlug}.${format}`;
		const url = buildHistoricoExportHref(format);
		loading.show('Preparando download…');
		try {
			const res = await apiFetchResponse(url);
			const fileName = nomeArquivoContentDisposition(
				res.headers.get('Content-Disposition'),
				fallbackName
			);
			baixarBlob(await res.blob(), fileName);
			toaster.success({ title: 'Download iniciado' });
		} catch (err) {
			toaster.error({
				title: 'Falha no download',
				description: mensagemDeErro(err)
			});
		} finally {
			loading.hide();
		}
	}

	function onModoPeriodoMudou(raw: string | null) {
		if (raw !== 'data' && raw !== 'ciclo' && raw !== 'mes') return;
		const modo: ModoPeriodo = raw;
		modoPeriodo = modo;
		if (modo === 'mes') {
			if (!filtroMesAno) filtroMesAno = getCurrentMonth();
		} else if (modo === 'data') {
			if (!filtroData) filtroData = hojeLocalISO();
		} else {
			const corrente = cicloQueContem(hojeLocalISO());
			if (!filtroAnoCiclo) filtroAnoCiclo = corrente.ano;
			if (!filtroNumeroCiclo) filtroNumeroCiclo = corrente.ciclo;
		}
		paginaHistorico = 1;
	}

	function limparFiltrosHistorico() {
		filtroSeccional = '';
		filtroTipoEquipe = '';
		modoPeriodo = 'ciclo';
		filtroMesAno = getCurrentMonth();
		filtroData = hojeLocalISO();
		const corrente = cicloQueContem(hojeLocalISO());
		filtroAnoCiclo = corrente.ano;
		filtroNumeroCiclo = corrente.ciclo;
		paginaHistorico = 1;
	}

	const totalPaginasHistorico = $derived(
		Math.max(1, Math.ceil(historicoFiltrado.length / ITEMS_POR_PAGINA))
	);
	const historicoPaginado = $derived(
		historicoFiltrado.slice(
			(paginaHistorico - 1) * ITEMS_POR_PAGINA,
			paginaHistorico * ITEMS_POR_PAGINA
		)
	);
</script>

<div>
	<div class="space-y-2">
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<span class={CLASSE_TITULO_FILTRO}>Busca detalhada</span>
			<BotaoLimparFiltros
				{temFiltros}
				onclick={limparFiltrosHistorico}
				classes="w-full sm:w-auto"
			/>
		</div>
		<div class={CLASSE_BARRA_FILTRO}>
			<div class={CLASSE_CAMPO_FILTRO}>
				<label class={CLASSE_ROTULO_FILTRO} for="filtro-seccional">Seccional</label>
				<select
					id="filtro-seccional"
					bind:value={filtroSeccional}
					onchange={() => (paginaHistorico = 1)}
					class="{CLASSE_INPUT_FILTRO} w-full sm:w-[11.5rem]"
				>
					<option value="">Todas</option>
					{#each seccionaisList as sec (sec.id)}
						<option value={sec.id}>{sec.nome}</option>
					{/each}
				</select>
			</div>
			<FiltroHistoricoSegmento
				kind="tipo"
				value={filtroTipoEquipe}
				onValueChange={(v) => {
					filtroTipoEquipe = v === 'operacional' || v === 'seint' ? v : '';
					paginaHistorico = 1;
				}}
			/>
			<FiltroHistoricoSegmento
				kind="periodo"
				value={modoPeriodo}
				onValueChange={(v) => onModoPeriodoMudou(v)}
			/>
			<CamposPeriodoHistorico
				{modoPeriodo}
				anoCiclo={filtroAnoCiclo}
				numeroCiclo={filtroNumeroCiclo}
				mesAno={filtroMesAno}
				data={filtroData}
				{anosCiclo}
				onAnoCiclo={(v) => {
					filtroAnoCiclo = Number(v);
					paginaHistorico = 1;
				}}
				onNumeroCiclo={(v) => {
					filtroNumeroCiclo = Number(v);
					paginaHistorico = 1;
				}}
				onMesAno={(v) => {
					filtroMesAno = v;
					paginaHistorico = 1;
				}}
				onData={(v) => {
					filtroData = v;
					paginaHistorico = 1;
				}}
			/>
		</div>
	</div>

	<div class="mt-5 border-t border-surface-200 pt-5 dark:border-white/5 space-y-3">
		<div class="flex justify-end">
			<Popover positioning={{ placement: 'bottom-end' }}>
				<Popover.Trigger
					class="btn btn-sm preset-filled-primary-500 text-white justify-center disabled:cursor-not-allowed disabled:opacity-40"
					disabled={!podeExportarHistorico}
					title={podeExportarHistorico
						? 'Exportar lista filtrada'
						: 'Selecione mês/ano, ciclo ou data específica para habilitar'}
				>
					Baixar relatório
					<svg
						class="h-3.5 w-3.5 opacity-80"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 9l-7 7-7-7"
						/>
					</svg>
				</Popover.Trigger>
				<Portal>
					<Popover.Positioner>
						<Popover.Content
							class="z-50 min-w-[11rem] overflow-hidden rounded-xl border border-surface-200 bg-white py-1 shadow-xl dark:border-surface-600 dark:bg-surface-800"
						>
							<button
								type="button"
								class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-surface-800 hover:bg-surface-100 dark:text-surface-100 dark:hover:bg-surface-700"
								onclick={() => baixarHistoricoArquivo('xlsx')}
							>
								<span
									class="rounded bg-success-500/15 px-1.5 py-0.5 text-3xs font-black text-success-700 dark:text-success-400"
									>XLSX</span
								>
								Planilha
							</button>
							<button
								type="button"
								class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-surface-800 hover:bg-surface-100 dark:text-surface-100 dark:hover:bg-surface-700"
								onclick={() => baixarHistoricoArquivo('pdf')}
							>
								<span
									class="rounded bg-error-500/15 px-1.5 py-0.5 text-3xs font-black text-error-700 dark:text-error-400"
									>PDF</span
								>
								Documento
							</button>
						</Popover.Content>
					</Popover.Positioner>
				</Portal>
			</Popover>
		</div>
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			{#if samePathNav.current}
				<SkeletonCards count={6} />
			{:else if historicoPaginado.length === 0}
				<div
					class="col-span-full rounded-2xl border border-dashed border-surface-300 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-900/50 p-8 text-center flex flex-col items-center justify-center gap-3"
				>
					<div
						class="w-12 h-12 rounded-full bg-surface-200/50 dark:bg-surface-800/50 flex items-center justify-center mb-1"
					>
						<Search class="w-6 h-6 text-surface-400 dark:text-surface-500" stroke-width={1.5} />
					</div>
					<p class="text-sm font-semibold text-surface-700 dark:text-surface-300">
						Nenhum resultado encontrado
					</p>
					<p
						class="text-xs text-surface-600 dark:text-surface-400 max-w-xs mx-auto leading-relaxed"
					>
						Não encontramos escalas para os filtros aplicados. Tente alterar o período, o tipo de
						equipe ou a seccional.
					</p>
					{#if temFiltros}
						<div class="mt-2">
							<BotaoLimparFiltros
								{temFiltros}
								onclick={limparFiltrosHistorico}
								label="Limpar todos os filtros"
							/>
						</div>
					{/if}
				</div>
			{:else}
				{#each historicoPaginado as escala (escala.id)}
					<!-- Mesmo fundo/borda/sombra do CardGiseAtiva: o histórico usava
					     bg-surface-50 e ficava acinzentado ao lado dos cards ativos. -->
					<div
						class="rounded-2xl border border-surface-200 dark:border-white/5 bg-white/80 dark:bg-surface-900/60 backdrop-blur-md shadow-sm transition-all duration-200 hover:border-primary-500/40 hover:shadow-md dark:hover:border-primary-400/20"
					>
						<div class="flex flex-col gap-2 px-3 py-3 xs:flex-row xs:items-center xs:gap-2 sm:px-4">
							<button
								type="button"
								class="flex-1 min-w-0 flex items-center justify-between gap-2 sm:gap-3 text-left"
								onclick={() => goto(`/operacoes/gise/${escala.id}`)}
							>
								<div class="min-w-0">
									<p class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">
										{diaSemana(escala.data_inicio)}, {fmtDate(escala.data_inicio)}
										<span class="ml-1 opacity-50 font-normal">#{escala.id}</span>
									</p>
									<p class="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
										{escala.hora_entrada} às {escala.hora_saida}
									</p>
								</div>
								<span
									class="text-3xs sm:text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 text-center leading-tight {statusColor(
										escala.status
									)}"
								>
									{statusLabel(escala.status)}
								</span>
							</button>

							<div
								class="flex items-center gap-1 shrink-0 border-t pt-2 border-surface-200 dark:border-surface-700 xs:border-t-0 xs:border-l xs:pt-0 xs:pl-2 xs:ml-1 justify-end"
							>
								<a
									href="/api/gise/{escala.id}/download?format=pdf"
									download
									title="Baixar escala assinada (PDF)"
									aria-label="Baixar escala assinada (PDF)"
									class="inline-flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg text-surface-500 hover:bg-primary-500/10 hover:text-primary-600 transition-colors touch-manipulation"
									onclick={(e) => e.stopPropagation()}
								>
									<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
										/>
									</svg>
								</a>

								<Popover positioning={{ placement: 'bottom-end' }}>
									<Popover.Trigger
										class="inline-flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg text-surface-500 hover:bg-success-500/10 hover:text-success-600 transition-colors touch-manipulation"
										title="Baixar relatório de produtividade"
										aria-label="Baixar relatório de produtividade"
									>
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
											/>
										</svg>
									</Popover.Trigger>
									<Portal>
										<Popover.Positioner>
											<Popover.Content
												class="z-50 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-xl p-1.5 w-56 max-w-[calc(100vw-1.5rem)] sm:min-w-[200px] sm:w-auto"
											>
												<p
													class="text-3xs font-bold uppercase text-surface-600 dark:text-surface-400 px-2 pt-1 pb-1.5 tracking-wider"
												>
													Produtividade por seccional
												</p>
												{#each escala.seccionais ?? [] as sec (sec.id)}
													{#each sec.tipos ?? ['operacional'] as tipo (tipo)}
														<a
															href="/api/gise/{escala.id}/download?format=produtividade&seccionalId={sec.id}&equipeType={tipo}"
															download
															class="flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors touch-manipulation"
														>
															<Download
																class="w-3 h-3 shrink-0 text-success-500"
																aria-hidden="true"
															/>
															<span class="truncate"
																>{sec.nome} — {tipo === 'seint' ? 'SEINT' : 'Operacional'}</span
															>
														</a>
													{/each}
												{/each}
											</Popover.Content>
										</Popover.Positioner>
									</Portal>
								</Popover>

								<Popover positioning={{ placement: 'bottom-end' }}>
									<Popover.Trigger
										class="inline-flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-lg text-surface-500 hover:bg-warning-500/10 hover:text-warning-600 transition-colors touch-manipulation"
										title="Baixar relatório de extra assinado"
										aria-label="Baixar relatório de extra assinado"
									>
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
											/>
										</svg>
									</Popover.Trigger>
									<Portal>
										<Popover.Positioner>
											<Popover.Content
												class="z-50 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl shadow-xl p-1.5 w-56 max-w-[calc(100vw-1.5rem)] sm:min-w-[200px] sm:w-auto"
											>
												<p
													class="text-3xs font-bold uppercase text-surface-600 dark:text-surface-400 px-2 pt-1 pb-1.5 tracking-wider"
												>
													Extra por seccional
												</p>
												{#each escala.seccionais ?? [] as sec (sec.id)}
													<a
														href="/api/gise/{escala.id}/download?format=extraordinario&seccionalId={sec.id}"
														download
														class="flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors touch-manipulation"
													>
														<Download
															class="w-3 h-3 shrink-0 text-warning-500"
															aria-hidden="true"
														/>
														<span class="truncate">{sec.nome}</span>
													</a>
												{/each}
											</Popover.Content>
										</Popover.Positioner>
									</Portal>
								</Popover>
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		{#if totalPaginasHistorico > 1}
			<div
				class="mt-3 pt-3 border-t border-surface-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3"
			>
				<span class="text-xs text-surface-600 dark:text-surface-400">
					{historicoFiltrado.length} resultado(s) — página {paginaHistorico} de {totalPaginasHistorico}
				</span>
				<Paginador
					count={historicoFiltrado.length}
					pageSize={ITEMS_POR_PAGINA}
					page={paginaHistorico}
					onPageChange={(p) => (paginaHistorico = p)}
				/>
			</div>
		{/if}
	</div>
</div>
