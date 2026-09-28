<script lang="ts">
	/**
	 * RECEBIDOS — a caixa de entrada das escalas já assinadas que chegaram ao
	 * Admin Geral, com o "não lido" como estado padrão do filtro.
	 *
	 * Diferente das outras telas de lista, aqui a URL é a FONTE DE VERDADE dos
	 * filtros (`?seccional=&unidade=&ano=&mes=&vistos=&page=`): o `load` filtra e
	 * pagina no banco. Trafegar todas as escalas assinadas para filtrar no
	 * cliente era o gargalo apontado na auditoria de performance (B-2), e o
	 * volume só cresce.
	 *
	 * O localStorage continua guardando a última escolha, mas em papel
	 * secundário: quando a página abre SEM parâmetros, os filtros salvos são
	 * reaplicados via `replaceState` — assim a preferência sobrevive sem que a URL
	 * deixe de descrever o que está na tela.
	 *
	 * Marcar como visto é o único efeito colateral da tela, e é por escala — quem
	 * confere assume que conferiu aquele documento. O toggle é OTIMISTA (pinta
	 * antes da resposta) e guarda `togglingId` para ignorar cliques repetidos: sem
	 * isso, dois cliques rápidos invertiam o estado duas vezes e a tela terminava
	 * discordando do banco.
	 */
	import type { PageProps } from './$types';
	import { opcoesMeses } from '$lib/utils/datas';
	import Download from '@lucide/svelte/icons/download';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Lock from '@lucide/svelte/icons/lock';
	import Search from '@lucide/svelte/icons/search';
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import SkeletonCards from '$lib/components/SkeletonCards.svelte';
	import SkeletonTableRows from '$lib/components/SkeletonTableRows.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import type { EscalaListagem, Unidade } from '$lib/types';
	import PaginationControls from '$lib/components/PaginationControls.svelte';
	import BotaoLimparFiltros from '$lib/components/BotaoLimparFiltros.svelte';
	import {
		useAutorizacao,
		useFiltrosPaginados,
		useInvalidateOnFocus,
		useSamePathNavigating
	} from '$lib/composables';
	import { getSavedFilters } from '$lib/utils/localStorage';
	import type { ActionResult } from '@sveltejs/kit';
	import { loading as loadingService } from '$lib/loading.svelte';
	import CampoFiltroSelect from '$lib/components/CampoFiltroSelect.svelte';
	import CamposFiltroAnoMes from '$lib/components/CamposFiltroAnoMes.svelte';
	import { opcoesDeUnidades } from '$lib/unidades/opcoes';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import BadgeTipoEscala from '$lib/components/BadgeTipoEscala.svelte';
	import EstadoVazio from '$lib/components/EstadoVazio.svelte';
	import { fetchSyncEstado } from '$lib/sync-estado';
	import {
		CLASSE_CAIXA_FILTRO,
		CLASSE_INPUT_FILTRO,
		CLASSE_ROTULO_FILTRO
	} from '$lib/gise/filtro-historico-ui';

	const { data }: PageProps = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
	const samePathNav = useSamePathNavigating();

	const escalas = $derived(data.escalas as EscalaListagem[]);
	const unidades = $derived(data.unidades as Unidade[]);

	// Filtros server-side via URL (?seccional=&unidade=&ano=&mes=&vistos=&page=).
	// A URL é a fonte de verdade — o load pagina e filtra no banco em vez de
	// trafegar todas as escalas assinadas para filtrar no cliente (auditoria de
	// performance, B-2). O localStorage continua persistindo a última escolha e
	// é reaplicado (via replaceState) quando a página abre sem parâmetros.
	const KEY = 'filtros_recebidos';
	const defaults = {
		seccional: '' as number | '',
		unidade: '',
		naoLidos: true,
		ano: 0,
		mes: 0
	};
	const saved = getSavedFilters(KEY, defaults);

	let filtroSeccional = $state<number | ''>(
		untrack(() => Number(page.url.searchParams.get('seccional')) || '')
	);
	let filtroUnidade = $state(untrack(() => page.url.searchParams.get('unidade') ?? ''));
	let filtroAno = $state<number>(untrack(() => Number(page.url.searchParams.get('ano')) || 0));
	let filtroMes = $state<number>(untrack(() => Number(page.url.searchParams.get('mes')) || 0));
	let mostrarApenasNaoVistos = $state(
		untrack(() => page.url.searchParams.get('vistos') !== 'todos')
	);

	// Inbox “não vistos” fica quente (30s); histórico completo, frio (120s).
	// Probe: só invalida o load (e o badge do layout) se o carimbo mudou.
	useInvalidateOnFocus('app:recebidos', {
		isHot: () => mostrarApenasNaoVistos,
		also: ['app:recebidos-badge'],
		probe: async () => {
			try {
				const e = await fetchSyncEstado();
				return e.recebidos?.stamp ?? null;
			} catch {
				return null;
			}
		}
	});

	function buildQueryParams(p: number) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams();
		if (filtroSeccional !== '' && filtroSeccional !== null) {
			params.set('seccional', String(filtroSeccional));
		}
		if (filtroUnidade.trim()) params.set('unidade', filtroUnidade.trim());
		if (filtroAno) params.set('ano', String(filtroAno));
		if (filtroMes) params.set('mes', String(filtroMes));
		if (!mostrarApenasNaoVistos) params.set('vistos', 'todos');
		if (p > 1) params.set('page', String(p));
		return params;
	}

	// Persistência (localStorage) + navegação server-side + auto-nav.
	// Assinatura: [seccional, unidade, ano, mes, naoLidos] — debounce 350ms
	// só quando a unidade (índice 1) muda sozinha.
	const filtros = useFiltrosPaginados({
		chave: KEY,
		snapshot: () => ({
			seccional: filtroSeccional,
			unidade: filtroUnidade,
			naoLidos: mostrarApenasNaoVistos,
			ano: filtroAno,
			mes: filtroMes
		}),
		query: buildQueryParams,
		auto: {
			assinatura: () => [
				filtroSeccional ?? '',
				filtroUnidade,
				filtroAno ?? 0,
				filtroMes ?? 0,
				mostrarApenasNaoVistos
			],
			debounce: (anterior, atual) => {
				const unidadeMudou = anterior[1] !== atual[1];
				const outrosMudaram =
					anterior[0] !== atual[0] ||
					anterior[2] !== atual[2] ||
					anterior[3] !== atual[3] ||
					anterior[4] !== atual[4];
				return unidadeMudou && !outrosMudaram ? 350 : 0;
			}
		}
	});

	// Normaliza null vindo do clear do SearchableSelect.
	$effect(() => {
		if (filtroAno === null) filtroAno = 0;
		if (filtroMes === null) filtroMes = 0;
		if (filtroSeccional === null) filtroSeccional = '';
	});

	// Primeira visita sem parâmetros: reaplica os filtros persistidos
	// (comportamento da versão client-side), trocando a URL in-place.
	// O composable não cobre este restore — só persiste e auto-navega.
	let restaurouSalvos = false;
	$effect(() => {
		if (restaurouSalvos) return;
		restaurouSalvos = true;
		const savedSeccional = Number(saved.seccional) || '';
		const savedTemFiltros =
			savedSeccional !== '' ||
			saved.unidade !== '' ||
			saved.ano !== 0 ||
			saved.mes !== 0 ||
			saved.naoLidos !== true;
		if (page.url.search === '' && savedTemFiltros) {
			filtroSeccional = savedSeccional;
			filtroUnidade = saved.unidade;
			filtroAno = saved.ano;
			filtroMes = saved.mes;
			mostrarApenasNaoVistos = saved.naoLidos;
			untrack(() => filtros.navegar(1, { replace: true }));
		}
	});

	const unidadesArray = $derived(Array.isArray(unidades) ? unidades : []);
	const seccionais = $derived(unidadesArray.filter((u) => u.tipo === 'seccional'));
	const seccionaisOptions = $derived(opcoesDeUnidades(seccionais));

	const meses = opcoesMeses();
	const anos = [0, ...Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i)];

	const mesesOptions = meses;
	const anosOptions = $derived(
		anos.map((ano) => ({ value: ano, label: ano === 0 ? 'Todos' : String(ano) }))
	);

	async function recarregar() {
		loadingService.show('Atualizando caixa de entrada...');
		try {
			await invalidateShared('app:recebidos', 'app:recebidos-badge');
		} finally {
			loadingService.hide();
		}
	}

	let togglingId = $state<number | null>(null);

	function handleToggleVisto(escala: EscalaListagem) {
		return function ({ formData, cancel }: { formData: FormData; cancel: () => void }) {
			if (togglingId === escala.id) {
				cancel();
				return;
			}
			const novoStatus = !escala.visto_por_admin;
			formData.set('visto', String(novoStatus));
			escala.visto_por_admin = novoStatus ? 1 : 0;
			togglingId = escala.id;
			return async ({
				result
			}: {
				result: ActionResult;
				update: (opts?: { reset?: boolean }) => Promise<void>;
			}) => {
				togglingId = null;
				if (result.type === 'success') {
					// Atualiza lista + badge do layout nesta aba e nas outras.
					await invalidateShared('app:recebidos', 'app:recebidos-badge');
				} else {
					escala.visto_por_admin = novoStatus ? 0 : 1;
					toaster.create({ title: 'Erro ao atualizar status', type: 'error' });
				}
			};
		};
	}

	// Helper para formatar data de criação
	function formatRelativeTime(dateStr: string) {
		const date = new Date(dateStr.replace(' ', 'T'));
		return date.toLocaleString('pt-BR', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getMesExtenso(dataStr: string) {
		const data = new Date(dataStr + 'T00:00:00');
		return data.toLocaleString('pt-BR', { month: 'long' }).toUpperCase();
	}

	let dialogOpen = $state(false);
	/**
	 * Textos que a tabela do desktop e o card do celular mostram para o MESMO
	 * dado. Ficam em constante porque já divergiram: a coluna de leitura era
	 * "Visto" na tabela e "Lida" no card, e o tooltip do manifesto foi
	 * enriquecido só do lado do desktop — alguém melhorou uma cópia e a outra
	 * ficou para trás.
	 *
	 * Isto NÃO é o `ListaResponsiva` que a auditoria de 13/ago propôs, e não
	 * pretende ser: card e tabela querem campos e ênfases diferentes de
	 * propósito (ver a decisão registrada na §0 daquele documento). O que se
	 * unifica aqui é só o que TEM de ser idêntico — o texto que nomeia a mesma
	 * coisa.
	 */
	const ROTULO_VISTO = 'Visto';
	const TITULO_MANIFESTO =
		'PDF com folha de auditoria (evidências da assinatura: CPF, IP, GPS, selfie)';
	const TITULO_SEM_MANIFESTO =
		'PDF assinado sem folha de auditoria (para impressão e distribuição)';

	let escalaParaExcluir = $state<{ id: number; lotacao: string } | null>(null);

	function solicitarExclusao(id: number, lotacao: string) {
		escalaParaExcluir = { id, lotacao };
		dialogOpen = true;
	}

	function limparFiltros() {
		filtroSeccional = '';
		filtroUnidade = '';
		filtroAno = 0;
		filtroMes = 0;
		mostrarApenasNaoVistos = true;
		// O auto-nav do composable detecta a mudança e navega para a URL limpa.
	}

	const temFiltros = $derived(
		filtroSeccional !== '' ||
			filtroUnidade !== '' ||
			filtroAno !== 0 ||
			filtroMes !== 0 ||
			mostrarApenasNaoVistos !== true
	);

	function handleExcluir() {
		loadingService.show('Removendo escala...');
		return async ({ result }: { result: ActionResult }) => {
			loadingService.hide();
			if (result.type === 'success') {
				toaster.create({ title: 'Escala removida com sucesso', type: 'success' });
				await invalidateShared('app:recebidos', 'app:recebidos-badge');
				dialogOpen = false;
				escalaParaExcluir = null;
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover escala'), type: 'error' });
			}
		};
	}
</script>

<svelte:head>
	<title>Cx. de Entrada | Admin</title>
</svelte:head>

{#if !isAdmin}
	<div class="text-center py-32 text-surface-600 dark:text-surface-400">
		<Lock class="w-8 h-8 mx-auto mb-2" aria-hidden="true" />
		<p>Acesso restrito a administradores.</p>
	</div>
{:else}
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
		<div>
			<h1 class="h1 text-2xl font-bold">Cx. de Entrada</h1>
			<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
				Escalas assinadas enviadas ao Admin Geral — atualiza ao voltar à aba ou pelo botão Atualizar
			</p>
		</div>
		<div class="flex flex-wrap gap-2 justify-end w-full sm:w-auto">
			<BotaoLimparFiltros {temFiltros} onclick={limparFiltros} />
			<button
				type="button"
				class="btn preset-outlined-surface-500 btn-sm flex items-center gap-1.5"
				onclick={recarregar}
				disabled={loadingService.active}
			>
				{#if loadingService.active}
					Atualizando...
				{:else}
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
				{/if}
				{loadingService.active ? 'Atualizando...' : 'Atualizar'}
			</button>
		</div>
	</div>

	<!-- Filtros Rápidos -->
	<div class="{CLASSE_CAIXA_FILTRO} mb-4 flex flex-col gap-4">
		<div class="flex flex-col lg:flex-row gap-3 items-stretch lg:items-end w-full">
			<CampoFiltroSelect
				label="Seccional"
				width="lg:w-48"
				options={seccionaisOptions}
				bind:value={filtroSeccional}
				ariaLabel="Filtrar por seccional"
				opcaoVazia="Todas as seccionais"
			/>

			<label class="flex flex-col gap-1.5 w-full lg:w-64">
				<span class={CLASSE_ROTULO_FILTRO}>Unidade</span>
				<div class="relative w-full">
					<Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
					<input
						type="text"
						class="{CLASSE_INPUT_FILTRO} w-full pl-10"
						bind:value={filtroUnidade}
						placeholder="Digite um nome ou partes dele"
					/>
				</div>
			</label>

			<CamposFiltroAnoMes
				bind:ano={filtroAno}
				bind:mes={filtroMes}
				anos={anosOptions}
				meses={mesesOptions}
			/>

			<div class="flex items-center justify-between sm:justify-start gap-4 pb-2 lg:pb-3 lg:pl-2">
				<label class="flex items-center gap-2 cursor-pointer select-none">
					<input
						type="checkbox"
						class="checkbox"
						checked={!mostrarApenasNaoVistos}
						onchange={() => (mostrarApenasNaoVistos = false)}
					/>
					<span class="text-xs font-bold whitespace-nowrap text-surface-600 dark:text-surface-300"
						>Todas</span
					>
				</label>

				<label class="flex items-center gap-2 cursor-pointer select-none">
					<input
						type="checkbox"
						class="checkbox"
						checked={mostrarApenasNaoVistos}
						onchange={() => (mostrarApenasNaoVistos = true)}
					/>
					<span class="text-xs font-bold whitespace-nowrap text-surface-600 dark:text-surface-300"
						>Não lidas</span
					>
				</label>
			</div>
		</div>
	</div>

	<!-- Tabela de Cx. de Entrada -->
	<div class="rounded-3xl card-glass p-4 sm:p-5">
		{#if escalas.length === 0}
			<EstadoVazio
				class="py-20 px-4"
				mensagem="Nenhum recebimento encontrado"
				descricao="Tente ajustar os filtros acima para visualizar mais escalas."
			>
				{#snippet icone()}
					<Inbox class="w-10 h-10 text-surface-400" aria-hidden="true" />
				{/snippet}
			</EstadoVazio>
		{:else}
			<!-- Desktop table -->
			<!-- Sem `overflow-hidden` aqui (VIS-3): ele vence o `overflow:auto` do
			     `table-wrap` por ordem na folha e mata o scroll horizontal. O
			     `rounded-xl` continua recortando — `overflow:auto` já recorta. -->
			<div class="hidden md:block table-wrap rounded-xl">
				<table class="table">
					<thead>
						<tr>
							<th class="w-10 !text-center">{ROTULO_VISTO}</th>
							<th class="!text-center">Unidade</th>
							<th class="!text-center">Mês</th>
							<th class="!text-center">Tipo</th>
							<th class="!text-center">Recebido em</th>
							<th class="!text-center">Ações</th>
						</tr>
					</thead>
					<tbody>
						{#if samePathNav.current}
							<SkeletonTableRows
								cols={[
									'h-4 w-6',
									'h-4 w-32',
									'h-4 w-24',
									'h-6 w-20 rounded-full',
									'h-4 w-28',
									'h-8 w-16 rounded-lg'
								]}
							/>
						{:else}
							{#each escalas as escala (escala.id)}
								<tr
									class={escala.visto_por_admin ? 'opacity-60 grayscale-[0.5]' : 'bg-primary-500/5'}
								>
									<td class="text-center">
										<form
											method="POST"
											action="?/toggleVisto"
											use:enhance={handleToggleVisto(escala)}
											class="contents"
										>
											<input type="hidden" name="escala_id" value={escala.id} />
											{#if togglingId === escala.id}
												<Spinner size="sm" class="mx-auto text-primary-500" />
											{:else}
												<input
													type="checkbox"
													class="checkbox mx-auto"
													aria-label={`Marcar escala de ${escala.lotacao} como vista`}
													checked={!!escala.visto_por_admin}
													onchange={(e) => e.currentTarget.closest('form')?.requestSubmit()}
												/>
											{/if}
										</form>
									</td>
									<td class="font-bold text-sm text-center">{escala.lotacao}</td>
									<td class="text-center">
										<span class="text-sm font-medium">{getMesExtenso(escala.data_inicio)}</span>
									</td>
									<td class="text-center">
										<BadgeTipoEscala tipo={escala.tipo} tamanho="3xs" />
									</td>
									<td
										class="text-xs text-surface-600 dark:text-surface-400 whitespace-nowrap text-center font-mono tabular-nums"
									>
										{formatRelativeTime(escala.created_at)}
									</td>
									<td>
										<div class="flex gap-2 justify-center items-center">
											<a
												href="/escalas/{escala.id}"
												class="btn btn-sm preset-outlined-surface-500 text-xs"
												title="Ver Detalhes"
											>
												<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
													/><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
													/></svg
												>
											</a>

											{#if escala.is_assinada}
												<a
													href="/api/escalas/{escala.id}/documento-assinado"
													class="btn btn-sm preset-filled-success-500 text-xs font-bold transition-all"
													target="_blank"
													title={TITULO_SEM_MANIFESTO}
												>
													<Download class="w-4 h-4 mr-1" aria-hidden="true" />
													S/ manifesto
												</a>
												<a
													href="/api/escalas/{escala.id}/documento-assinado?manifesto=true"
													class="btn btn-sm preset-outlined-surface-500 text-xs font-semibold"
													target="_blank"
													title={TITULO_MANIFESTO}
												>
													C/ manifesto
												</a>
											{/if}

											<Popover positioning={{ placement: 'bottom-end', offset: { mainAxis: 4 } }}>
												<Popover.Trigger
													class="btn btn-sm preset-outlined-surface-500 text-xs font-bold"
													>Exportar ▾</Popover.Trigger
												>
												<Portal>
													<Popover.Positioner class="z-50">
														<Popover.Content
															class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[160px] max-w-[calc(100vw-1rem)]"
														>
															<a
																class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
																href={`/api/escalas/${escala.id}/download?format=docx`}
																target="_blank">Word (.docx)</a
															>
															<a
																class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
																href={`/api/escalas/${escala.id}/download?format=xlsx`}
																target="_blank">Excel (.xlsx)</a
															>
															<a
																class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
																href={`/api/escalas/${escala.id}/download?format=pdf`}
																target="_blank">PDF (.pdf)</a
															>
														</Popover.Content>
													</Popover.Positioner>
												</Portal>
											</Popover>

											<button
												type="button"
												class="btn btn-sm preset-filled-error-500 text-xs transition-all"
												title="Excluir"
												onclick={() => solicitarExclusao(escala.id, escala.lotacao)}
											>
												<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
													><path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
													/></svg
												>
											</button>
										</div>
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

			<!-- Mobile cards -->
			<div class="md:hidden space-y-3">
				{#if samePathNav.current}
					<SkeletonCards />
				{:else}
					{#each escalas as escala (escala.id)}
						<div
							class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border {escala.visto_por_admin
								? 'border-surface-200 dark:border-white/5 opacity-70'
								: 'border-primary-500/30 bg-primary-500/5'} transition-all"
						>
							<div class="flex items-start justify-between gap-3 mb-2">
								<div class="min-w-0">
									<p class="font-bold text-sm truncate">{escala.lotacao}</p>
									<p class="text-xs text-surface-600 dark:text-surface-400 font-medium">
										{getMesExtenso(escala.data_inicio)}
									</p>
								</div>
								<label class="flex flex-col items-center gap-1 shrink-0">
									<span class="text-3xs uppercase font-bold text-surface-600 dark:text-surface-400"
										>{ROTULO_VISTO}</span
									>
									<form
										method="POST"
										action="?/toggleVisto"
										use:enhance={handleToggleVisto(escala)}
										class="contents"
									>
										<input type="hidden" name="escala_id" value={escala.id} />
										{#if togglingId === escala.id}
											<Spinner size="xs" class="text-primary-500" />
										{:else}
											<input
												type="checkbox"
												class="checkbox checkbox-sm"
												aria-label={`Marcar escala de ${escala.lotacao} como vista`}
												checked={!!escala.visto_por_admin}
												onchange={(e) => e.currentTarget.closest('form')?.requestSubmit()}
											/>
										{/if}
									</form>
								</label>
							</div>

							<div class="flex items-center gap-2 mb-3">
								<BadgeTipoEscala tipo={escala.tipo} tamanho="3xs" />
								<span class="text-2xs text-surface-600 dark:text-surface-400"
									>{formatRelativeTime(escala.created_at)}</span
								>
							</div>

							<div
								class="flex flex-wrap gap-2 pt-3 border-t border-surface-200 dark:border-white/5"
							>
								<a
									href="/escalas/{escala.id}"
									class="btn btn-sm preset-outlined-surface-500 flex-1 text-xs">Detalhes</a
								>

								{#if escala.is_assinada}
									<a
										href="/api/escalas/{escala.id}/documento-assinado"
										class="btn btn-sm preset-filled-success-500 flex-1 text-xs transition-all"
										target="_blank"
										title={TITULO_SEM_MANIFESTO}>S/ manifesto</a
									>
									<a
										href="/api/escalas/{escala.id}/documento-assinado?manifesto=true"
										class="btn btn-sm preset-outlined-surface-500 flex-1 text-xs"
										target="_blank"
										title={TITULO_MANIFESTO}>C/ manifesto</a
									>
								{/if}

								<Popover positioning={{ placement: 'bottom', offset: { mainAxis: 4 } }}>
									<Popover.Trigger
										class="btn btn-sm preset-outlined-surface-500 w-full text-xs font-bold"
										>Exportar ▾</Popover.Trigger
									>
									<Portal>
										<Popover.Positioner class="z-50">
											<Popover.Content
												class="card p-1 bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-white/10 shadow-xl flex flex-col min-w-[200px] max-w-[calc(100vw-1rem)]"
											>
												<a
													class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
													href={`/api/escalas/${escala.id}/download?format=docx`}
													target="_blank">Word (.docx)</a
												>
												<a
													class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
													href={`/api/escalas/${escala.id}/download?format=xlsx`}
													target="_blank">Excel (.xlsx)</a
												>
												<a
													class="w-full text-left px-4 py-2 text-sm rounded hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors no-underline"
													href={`/api/escalas/${escala.id}/download?format=pdf`}
													target="_blank">PDF (.pdf)</a
												>
											</Popover.Content>
										</Popover.Positioner>
									</Portal>
								</Popover>

								<button
									type="button"
									class="btn btn-sm preset-filled-error-500 flex-1 text-xs font-bold transition-all"
									onclick={() => solicitarExclusao(escala.id, escala.lotacao)}>Excluir</button
								>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<PaginationControls
				paginaAtual={data.page}
				totalPaginas={data.totalPages}
				totalItens={data.total}
				itensPorPagina={data.limit}
				labelSingular="escala recebida"
				labelPlural="escala(s) recebida(s)"
				onPageChange={filtros.irParaPagina}
			/>
		{/if}
	</div>
{/if}

<ModalShell
	bind:open={dialogOpen}
	title="Excluir Escala?"
	largura="sm"
	pending={loadingService.active}
	cancelLabel="Cancelar"
>
	{#snippet description()}
		Tem certeza que deseja excluir esta escala de <strong>{escalaParaExcluir?.lotacao}</strong>?
		Esta ação não pode ser desfeita e removerá permanentemente o registro e o arquivo assinado.
	{/snippet}
	{#snippet footer()}
		<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
			<input type="hidden" name="escala_id" value={escalaParaExcluir?.id} />
			<button
				type="submit"
				class="btn preset-filled-error-500 flex items-center gap-2 transition-all"
				disabled={loadingService.active}
			>
				{loadingService.active ? 'Excluindo...' : 'Excluir'}
			</button>
		</form>
	{/snippet}
</ModalShell>

<style>
	/* Hide scrollbar for Chrome, Safari and Opera */
	:global(.scrollbar-none::-webkit-scrollbar) {
		display: none;
	}
	/* Hide scrollbar for IE, Edge and Firefox */
	:global(.scrollbar-none) {
		-ms-overflow-style: none; /* IE and Edge */
		scrollbar-width: none; /* Firefox */
	}
</style>
