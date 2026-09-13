<script lang="ts">
	/**
	 * PAINEL DE COMPLIANCE — quais unidades deviam ter escala e não têm.
	 *
	 * Uma linha por (unidade × regime × mês) exigível, com o estado apurado: em
	 * dia, pendente, assinada, ignorada. É a tela que o Admin Geral usa para
	 * cobrar, então "ausência de escala" é o dado principal — e por isso a
	 * apuração é do servidor, que sabe o universo de unidades, e não da lista de
	 * escalas existentes.
	 *
	 * `data.compliance` chega como PROMISE (streaming do `load`): a página pinta
	 * os filtros de imediato e o relatório preenche quando resolve. A promessa é
	 * resolvida aqui num `$effect` em vez de `{#await}` no markup para preservar
	 * a cadeia de deriveds (dados → filtrados → agrupados) — com `{#await}` cada
	 * bloco receberia o valor por conta própria e a filtragem teria de ser
	 * duplicada. `null` significa "computando" e é o que mostra o skeleton.
	 *
	 * "Ignorar" uma pendência é TRIAGEM LOCAL: a chave vai para o localStorage
	 * deste navegador, não para o banco. Serve para o admin tirar da frente o que
	 * já resolveu por fora — a pendência continua existindo e outro admin (ou
	 * outro navegador) continua vendo. Não confundir com decisão registrada.
	 */
	import type { PageProps } from './$types';
	import { opcoesMeses } from '$lib/utils/datas';
	import Lock from '@lucide/svelte/icons/lock';
	import Check from '@lucide/svelte/icons/check';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import Search from '@lucide/svelte/icons/search';
	import PartyPopper from '@lucide/svelte/icons/party-popper';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import SkeletonCard from '$lib/components/SkeletonCard.svelte';
	import SkeletonCards from '$lib/components/SkeletonCards.svelte';
	import SkeletonTableRows from '$lib/components/SkeletonTableRows.svelte';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { browser } from '$app/environment';
	import CampoFiltroSelect from '$lib/components/CampoFiltroSelect.svelte';
	import BotaoLimparFiltros from '$lib/components/BotaoLimparFiltros.svelte';
	import { toaster } from '$lib/toast';
	import type { ItemCompliance } from '$lib/types';
	import { useAutorizacao, useInvalidateOnFocus, useSamePathNavigating } from '$lib/composables';
	import { getSavedFilters } from '$lib/utils/localStorage';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { fetchSyncEstado } from '$lib/sync-estado';
	import { loading as loadingService } from '$lib/loading.svelte';
	import { CLASSE_CAIXA_FILTRO } from '$lib/gise/filtro-historico-ui';
	import BadgeTipoEscala from '$lib/components/BadgeTipoEscala.svelte';
	import EstadoVazio from '$lib/components/EstadoVazio.svelte';
	import type { ActionResult } from '@sveltejs/kit';

	const { data }: PageProps = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
	const samePathNav = useSamePathNavigating();
	const savedFilters = getSavedFilters('filtros_painel', {
		regime: 'todos',
		seccional: '',
		unidade: '',
		mesCorrente: true,
		agrupamento: 'nenhum',
		pendentes: true,
		ignorados: false
	});

	// `data.compliance` chega como PROMISE (streaming do load): o shell pinta
	// já com os filtros, e o relatório preenche quando resolver. `null` =
	// computando (skeleton). Resolver aqui — em vez de {#await} no template —
	// preserva a cadeia de deriveds (dados → dadosFiltrados → dadosAgrupados).
	let complianceResolvido = $state<ItemCompliance[] | null>(null);
	$effect(() => {
		const promessa = data.compliance;
		complianceResolvido = null;
		let ativo = true;
		Promise.resolve(promessa)
			.then((v) => {
				if (ativo) complianceResolvido = v as ItemCompliance[];
			})
			.catch(() => {
				if (!ativo) return;
				complianceResolvido = [];
				toaster.create({ title: 'Erro ao carregar o compliance', type: 'error' });
			});
		return () => {
			ativo = false;
		};
	});
	const dados = $derived(complianceResolvido ?? []);
	const carregandoCompliance = $derived(complianceResolvido === null);
	const unidadesDB = $derived(data.unidades);

	// Filtros
	const filtroRegime = 'todos';
	let filtroSeccional = $state<number | 'todas' | ''>(
		savedFilters.seccional !== undefined
			? (savedFilters.seccional as unknown as number | 'todas' | '')
			: ''
	);
	let filtroUnidade = $state(savedFilters.unidade);
	// svelte-ignore state_referenced_locally
	let filtroAno = $state(data.filtroAno);
	// svelte-ignore state_referenced_locally
	let filtroMes = $state(data.filtroMes);
	const filtroAgrupamento = 'unidade';
	let filtroPendentes = $state(true);
	let mostrarIgnorados = $state(!!savedFilters.ignorados);

	// Compliance é caro: foco/poll só refetch se o carimbo mudou; broadcast força.
	useInvalidateOnFocus('app:painel', {
		isHot: () => filtroPendentes,
		probe: async () => {
			try {
				const e = await fetchSyncEstado();
				return e.painel?.stamp ?? null;
			} catch {
				return null;
			}
		}
	});

	// Salvar filtros a cada mudança
	$effect(() => {
		if (browser) {
			localStorage.setItem(
				'filtros_painel',
				JSON.stringify({
					regime: filtroRegime,
					seccional: filtroSeccional,
					unidade: filtroUnidade,
					agrupamento: filtroAgrupamento,
					ignorados: mostrarIgnorados
				})
			);
		}
	});

	const seccionais = $derived(unidadesDB.filter((u) => u.tipo === 'seccional'));

	// Itens ignorados (persistidos no localStorage)
	const ignorados = new SvelteSet<string>();

	function chaveIgnorado(item: ItemCompliance): string {
		return `${item.unidade_nome}|${item.tipo_regime}|${item.data_inicio}`;
	}

	function ignorarItem(item: ItemCompliance) {
		const chave = chaveIgnorado(item);
		ignorados.add(chave);
		localStorage.setItem('compliance_ignorados', JSON.stringify([...ignorados]));
	}

	function restaurarItem(item: ItemCompliance) {
		const chave = chaveIgnorado(item);
		ignorados.delete(chave);
		localStorage.setItem('compliance_ignorados', JSON.stringify([...ignorados]));
	}

	const dadosFiltrados = $derived(
		dados.filter((d) => {
			const ignorado = ignorados.has(chaveIgnorado(d));
			if (!mostrarIgnorados && ignorado) return false;
			if (mostrarIgnorados && !ignorado) return false;
			if (filtroRegime !== 'todos' && d.tipo_regime !== filtroRegime) return false;
			if (filtroPendentes && d.status === 'ok') return false;

			if (filtroSeccional !== 'todas') {
				const udb = unidadesDB.find((u) => u.nome === d.unidade_nome);
				if (udb) {
					if (udb.tipo === 'seccional' && udb.id !== filtroSeccional) return false;
					if (udb.tipo === 'delegacia' && udb.seccional_id !== filtroSeccional) return false;
				}
			}

			if (filtroUnidade && d.unidade_nome !== filtroUnidade) return false;
			return true;
		})
	);

	const dadosAgrupados = $derived.by(() => {
		const base = [...dadosFiltrados];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const gruposMap = new Map<string, ItemCompliance[]>();
		for (const item of base) {
			const chave = item.unidade_nome;
			if (!gruposMap.has(chave)) gruposMap.set(chave, []);
			gruposMap.get(chave)!.push(item);
		}

		return Array.from(gruposMap.entries()).map(([titulo, itens]) => ({ titulo, itens }));
	});

	const unidadesDropdown = $derived(
		[
			...new Set(
				dados
					.filter((d) => {
						if (filtroSeccional === 'todas') return true;
						const udb = unidadesDB.find((u) => u.nome === d.unidade_nome);
						if (!udb) return true;
						return (
							(udb.tipo === 'seccional' && udb.id === filtroSeccional) ||
							(udb.tipo === 'delegacia' && udb.seccional_id === filtroSeccional)
						);
					})
					.map((d) => d.unidade_nome)
			)
		].sort()
	);

	const totais = $derived({
		ok: dados.filter((d) => d.status === 'ok' && !ignorados.has(chaveIgnorado(d))).length,
		nao_assinada: dados.filter(
			(d) => d.status === 'nao_assinada' && !ignorados.has(chaveIgnorado(d))
		).length,
		nao_criada: dados.filter((d) => d.status === 'nao_criada' && !ignorados.has(chaveIgnorado(d)))
			.length,
		ignorados: ignorados.size
	});

	const seccionaisOptions = $derived(seccionais.map((s) => ({ value: s.id, label: s.nome })));

	const unidadesDropdownOptions = $derived(unidadesDropdown.map((u) => ({ value: u, label: u })));

	const mesesOptions = opcoesMeses(true);

	const anosOptions = [
		{ value: 'todos', label: 'Todos' },
		{ value: '2024', label: '2024' },
		{ value: '2025', label: '2025' },
		{ value: '2026', label: '2026' },
		{ value: '2027', label: '2027' }
	];

	// Normalizações para quando as caixas de seleção forem limpas (null / '')
	$effect(() => {
		if (filtroSeccional === null) {
			filtroSeccional = '';
		}
	});

	$effect(() => {
		if (filtroUnidade === null) {
			filtroUnidade = '';
		}
	});

	// Sync local month/year state with query parameters.
	// `ultimoNavegado` impede navegação repetida para o mesmo alvo: se o
	// servidor normalizar o valor (ex.: '05' → '5'), o estado local diverge de
	// `data` para sempre e, sem o guard, este efeito entraria em loop infinito
	// de goto().
	let ultimoNavegado: string | null = null;
	$effect(() => {
		if (filtroAno === null) filtroAno = 'todos';
		if (filtroMes === null) filtroMes = 'todos';

		const alvo = `${filtroAno}|${filtroMes}`;
		if (alvo !== `${data.filtroAno}|${data.filtroMes}` && alvo !== ultimoNavegado) {
			ultimoNavegado = alvo;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const params = new URLSearchParams(page.url.searchParams);
			params.set('ano', filtroAno);
			params.set('mes', filtroMes);
			goto(`?${params}`, { keepFocus: true, noScroll: true });
		}
	});

	$effect(() => {
		filtroAno = data.filtroAno;
		filtroMes = data.filtroMes;
	});

	// Limpar unidade quando a seccional muda DE FATO. Compara o valor
	// normalizado (null ≡ '') para não disparar quando o efeito de
	// normalização converte null → '' sem mudança real de seccional.
	let prevSeccional: string | number | undefined;
	$effect(() => {
		const sec = filtroSeccional ?? '';
		if (prevSeccional !== undefined && sec !== prevSeccional) {
			filtroUnidade = '';
		}
		prevSeccional = sec;
	});

	// Exclusão de escala (para "não assinada")
	let escalaExcluirOpen = $state(false);
	let itemParaExcluir = $state<ItemCompliance | null>(null);

	async function carregar() {
		loadingService.show('Atualizando dados de compliance...');
		try {
			const stored = localStorage.getItem('compliance_ignorados');
			if (stored) {
				ignorados.clear();
				for (const k of JSON.parse(stored) as string[]) ignorados.add(k);
			}
		} catch {
			/* ignora */
		}
		// Chave declarada com depends() no load: invalidate(pathname) exigia
		// match exato de URL e não funcionava com ?ano=&mes= presentes.
		await invalidateShared('app:painel');
		loadingService.hide();
	}

	async function limparFiltros() {
		filtroSeccional = '';
		filtroUnidade = '';
		filtroPendentes = true;
		mostrarIgnorados = false;

		const hoje = new Date();
		filtroAno = String(hoje.getFullYear());
		filtroMes = String(hoje.getMonth() + 1);

		await goto('?', { keepFocus: true, noScroll: true });
	}

	function handleExcluirEscala() {
		loadingService.show('Excluindo escala...');
		return async ({ result }: { result: ActionResult }) => {
			loadingService.hide();
			if (result.type === 'success') {
				toaster.create({ title: 'Escala excluída com sucesso!', type: 'success' });
				await invalidateShared('app:painel');
				escalaExcluirOpen = false;
				itemParaExcluir = null;
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao excluir escala'), type: 'error' });
			}
		};
	}

	const temFiltros = $derived(
		filtroSeccional !== 'todas' ||
			filtroUnidade !== '' ||
			filtroPendentes !== true ||
			mostrarIgnorados !== false ||
			filtroAno !== String(new Date().getFullYear()) ||
			filtroMes !== String(new Date().getMonth() + 1)
	);

	$effect(() => {
		if (isAdmin && browser) {
			try {
				const stored = localStorage.getItem('compliance_ignorados');
				if (stored) {
					ignorados.clear();
					for (const k of JSON.parse(stored) as string[]) ignorados.add(k);
				}
			} catch {
				/* ignora */
			}
		}
	});
</script>

<svelte:head>
	<title>Painel de Compliance | Ecossistema PCCE</title>
</svelte:head>

{#if !isAdmin}
	<div class="text-center py-32 text-surface-600 dark:text-surface-400">
		<Lock class="w-8 h-8 mx-auto mb-2" aria-hidden="true" />
		<p>Acesso restrito a administradores.</p>
	</div>
{:else}
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
		<div>
			<h1 class="h1 text-2xl font-bold">Painel de Compliance</h1>
			<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
				Controle de envio e assinatura de escalas por unidade
			</p>
		</div>
		<div class="flex flex-wrap gap-2 justify-end w-full sm:w-auto">
			<BotaoLimparFiltros
				{temFiltros}
				onclick={limparFiltros}
				disabledExtra={loadingService.active}
			/>
			<button
				type="button"
				class="btn preset-outlined-surface-500 btn-sm"
				onclick={carregar}
				disabled={loadingService.active}
			>
				{#if loadingService.active}
					Atualizando...
				{:else}
					<svg class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
				{/if}
				Atualizar
			</button>
		</div>
	</div>

	<!-- Cards de resumo -->
	{#if !loadingService.active}
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
			<div class="p-4 rounded-2xl bg-success-500/10 border border-success-500/20 text-center">
				<p class="text-2xl font-bold text-success-600 dark:text-success-400">{totais.ok}</p>
				<p class="text-xs text-surface-600 dark:text-surface-400 mt-1 font-medium">
					<CheckCircle2 class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> Em dia
				</p>
			</div>
			<div class="p-4 rounded-2xl bg-warning-500/10 border border-warning-500/20 text-center">
				<p class="text-2xl font-bold text-warning-600 dark:text-warning-400">
					{totais.nao_assinada}
				</p>
				<p class="text-xs text-surface-600 dark:text-surface-400 mt-1 font-medium">
					<Clock class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> Não Assinada
				</p>
			</div>
			<div class="p-4 rounded-2xl bg-error-500/10 border border-error-500/20 text-center">
				<p class="text-2xl font-bold text-error-600 dark:text-error-400">{totais.nao_criada}</p>
				<p class="text-xs text-surface-600 dark:text-surface-400 mt-1 font-medium">
					<XCircle class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> Não Criada
				</p>
			</div>
			<button
				type="button"
				class="p-4 rounded-2xl bg-surface-500/10 border border-surface-500/20 text-center cursor-pointer hover:bg-surface-500/20 transition-colors"
				onclick={() => {
					mostrarIgnorados = !mostrarIgnorados;
					filtroPendentes = false;
				}}
			>
				<p class="text-2xl font-bold text-surface-600 dark:text-surface-400">{totais.ignorados}</p>
				<p class="text-xs text-surface-600 dark:text-surface-400 mt-1 font-medium">
					<BellOff class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> Ignorados
				</p>
			</button>
		</div>
	{/if}

	<!-- Filtros -->
	<div class="{CLASSE_CAIXA_FILTRO} mb-6 flex flex-col gap-4 sm:gap-5">
		<div class="flex flex-col lg:flex-row flex-wrap gap-3 items-stretch lg:items-end w-full">
			<CampoFiltroSelect
				label="Seccional"
				width="lg:w-48"
				options={seccionaisOptions}
				bind:value={filtroSeccional}
				ariaLabel="Filtrar por seccional"
				placeholder="Selecione"
			/>

			<CampoFiltroSelect
				label="Unidade"
				width="lg:w-48"
				options={unidadesDropdownOptions}
				bind:value={filtroUnidade}
				ariaLabel="Filtrar por unidade"
				placeholder="Todas as unidades"
			/>

			<CampoFiltroSelect
				label="Ano"
				width="lg:w-28"
				options={anosOptions}
				bind:value={filtroAno}
				ariaLabel="Filtrar por ano"
				placeholder="Todos"
			/>

			<CampoFiltroSelect
				label="Mês"
				width="lg:w-36"
				options={mesesOptions}
				bind:value={filtroMes}
				ariaLabel="Filtrar por mês"
				placeholder="Todos"
			/>
		</div>

		{#if mostrarIgnorados}
			<div class="pt-1 border-t border-surface-100 dark:border-white/5">
				<button
					type="button"
					class="btn btn-sm preset-soft-surface text-xs font-bold"
					onclick={() => {
						mostrarIgnorados = false;
						filtroPendentes = true;
					}}
				>
					← Voltar para pendências
				</button>
			</div>
		{/if}

		<hr class="opacity-50 dark:opacity-10" />
	</div>

	<!-- Modo ignorados: banner informativo -->
	{#if mostrarIgnorados}
		<div
			class="mb-4 p-3 rounded-xl bg-surface-500/10 border border-surface-500/20 text-sm text-surface-600 dark:text-surface-400 flex items-center gap-2"
		>
			<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/></svg
			>
			Exibindo itens ignorados. Para restaurar, clique em <strong>Restaurar</strong> na linha correspondente.
		</div>
	{/if}

	<ModalShell
		bind:open={escalaExcluirOpen}
		title="Excluir Escala?"
		largura="sm"
		pending={loadingService.active}
		cancelLabel="Cancelar"
	>
		{#snippet description()}
			Tem certeza que deseja excluir esta escala de <strong>{itemParaExcluir?.unidade_nome}</strong
			>? O status voltará a ser "Não Criada".
		{/snippet}
		{#snippet footer()}
			<form
				method="POST"
				action="?/excluirEscala"
				use:enhance={handleExcluirEscala}
				class="contents"
			>
				<input type="hidden" name="escala_id" value={itemParaExcluir?.escala_id} />
				<button
					type="submit"
					class="btn preset-filled-error-500 flex items-center gap-2 transition-all"
					disabled={loadingService.active}
				>
					{loadingService.active ? 'Excluindo...' : 'Confirmar Exclusão'}
				</button>
			</form>
		{/snippet}
	</ModalShell>

	<!-- Tabela -->
	<div class="rounded-3xl card-glass p-4 sm:p-5">
		{#if loadingService.active}
			<div
				class="flex flex-col items-center justify-center py-16 gap-3 text-surface-400 dark:text-surface-500"
			>
				<span class="text-sm">Carregando...</span>
			</div>
		{:else if !filtroSeccional}
			<EstadoVazio class="py-20" mensagem="Escolha um opção nos filtros para exibir">
				{#snippet icone()}
					<Search class="w-10 h-10 text-surface-400" aria-hidden="true" />
				{/snippet}
			</EstadoVazio>
		{:else if carregandoCompliance}
			<!-- Compliance ainda resolvendo (streaming) — sem isto cairia no
			     estado vazio "Nenhuma pendência" durante o cálculo -->
			<div class="space-y-2" aria-busy="true">
				{#each { length: 6 } as _, i (i)}
					<SkeletonCard lines={2} hasFooter={false} />
				{/each}
			</div>
		{:else if dadosFiltrados.length === 0}
			<EstadoVazio
				class="py-20"
				mensagem={mostrarIgnorados ? 'Nenhum item ignorado' : 'Nenhuma pendência encontrada!'}
				descricao={mostrarIgnorados
					? 'Você não ignorou nenhuma pendência.'
					: 'Todas as escalas estão em dia com os filtros selecionados.'}
			>
				{#snippet icone()}
					{#if mostrarIgnorados}
						<BellOff class="w-10 h-10 text-surface-400" aria-hidden="true" />
					{:else}
						<PartyPopper class="w-10 h-10 text-success-500" aria-hidden="true" />
					{/if}
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
							<th>Unidade</th>
							<th>Regime</th>
							<th>Período</th>
							<th>Status</th>
							<th class="text-left">Ações</th>
						</tr>
					</thead>
					<tbody>
						{#if samePathNav.current}
							<SkeletonTableRows
								cols={[
									'h-4 w-40',
									'h-6 w-20 rounded-full',
									'h-4 w-28',
									'h-6 w-20 rounded-full',
									'h-8 w-24 rounded-lg'
								]}
							/>
						{:else}
							{#each dadosAgrupados as grupo (grupo.titulo)}
								{#if grupo.titulo}
									<tr class="bg-surface-200/50 dark:bg-surface-800/50 shadow-inner">
										<td
											colspan="5"
											class="py-1.5 px-4 text-3xs font-semibold uppercase tracking-widest text-primary-600 dark:text-primary-400"
										>
											{grupo.titulo}
										</td>
									</tr>
								{/if}
								{#each grupo.itens as item (item.unidade_nome + item.tipo_regime + item.data_inicio)}
									<tr class={ignorados.has(chaveIgnorado(item)) ? 'opacity-50' : ''}>
										<td class="font-medium max-w-[305px] truncate">{item.unidade_nome}</td>
										<td>
											<BadgeTipoEscala tipo={item.tipo_regime} tamanho="xs" />
										</td>
										<td
											class="text-sm text-surface-600 dark:text-surface-300 whitespace-nowrap font-mono tabular-nums"
											>{item.periodo}</td
										>
										<td>
											{#if item.status === 'ok'}
												<span
													class="badge preset-filled-success-500 text-white text-xs font-bold px-2"
													><CheckCircle2 class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> Em dia</span
												>
											{:else if item.status === 'nao_assinada' && item.escala_id}
												<div class="flex items-center gap-1.5">
													<a
														href="/escalas/{item.escala_id}"
														class="badge bg-warning-500/15 text-warning-700 dark:text-warning-300 border border-warning-500/30 text-xs font-bold px-2 hover:bg-warning-500/30 transition-colors pointer-events-auto"
														><Clock class="inline w-3 h-3 -mt-0.5" aria-hidden="true" /> Não Assinada</a
													>
													<button
														type="button"
														class="text-error-500 hover:text-error-600 hover:bg-error-500/10 p-1 rounded-md transition-colors leading-none font-bold"
														title="Excluir escala"
														onclick={(e) => {
															e.preventDefault();
															itemParaExcluir = item;
															escalaExcluirOpen = true;
														}}>✕</button
													>
												</div>
											{:else if item.status === 'nao_assinada'}
												<span
													class="badge bg-warning-500/15 text-warning-700 dark:text-warning-300 border border-warning-500/30 text-xs font-bold px-2"
													><Clock class="inline w-3 h-3 -mt-0.5" aria-hidden="true" /> Não Assinada</span
												>
											{:else}
												<span
													class="badge bg-error-500/15 text-error-700 dark:text-error-300 border border-error-500/30 text-xs font-bold px-2"
													><XCircle class="inline w-3 h-3 -mt-0.5" aria-hidden="true" /> Não Criada</span
												>
											{/if}
										</td>
										<td>
											<div class="flex gap-2 justify-start">
												{#if mostrarIgnorados}
													<button
														type="button"
														class="btn btn-sm preset-outlined-surface-500"
														onclick={() => restaurarItem(item)}>Restaurar</button
													>
												{:else}
													<div class="flex gap-2 items-center">
														<button
															type="button"
															class="btn btn-sm preset-outlined-surface-500 opacity-60 hover:opacity-100"
															title="Ignorar esta pendência"
															onclick={() => ignorarItem(item)}
															><BellOff class="w-4 h-4" aria-hidden="true" /></button
														>
													</div>
												{/if}
											</div>
										</td>
									</tr>
								{/each}
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

			<!-- Mobile cards -->
			<div class="md:hidden space-y-2">
				{#if samePathNav.current}
					<SkeletonCards />
				{:else}
					{#each dadosAgrupados as grupo (grupo.titulo)}
						{#if grupo.titulo}
							<div
								class="py-2 px-4 bg-surface-100 dark:bg-surface-800/40 text-3xs font-bold uppercase tracking-widest text-primary-600 dark:text-primary-400 rounded-lg"
							>
								{grupo.titulo}
							</div>
						{/if}

						<div
							class="divide-y divide-surface-200 dark:divide-white/5 bg-white/50 dark:bg-surface-900/30 rounded-xl overflow-hidden border border-surface-200 dark:border-white/5 mb-4"
						>
							{#each grupo.itens as item (item.unidade_nome + item.tipo_regime + item.data_inicio)}
								<div
									class="p-4 flex items-center justify-between gap-3 {ignorados.has(
										chaveIgnorado(item)
									)
										? 'opacity-50'
										: ''}"
								>
									<div class="min-w-0 flex-1">
										<p class="font-bold text-sm truncate">{item.unidade_nome}</p>
										<div class="flex items-center gap-2 mt-1.5 flex-wrap">
											<BadgeTipoEscala tipo={item.tipo_regime} tamanho="3xs" />
											<span
												class="text-xs text-surface-600 dark:text-surface-400 font-medium font-mono tabular-nums"
												>{item.periodo}</span
											>
										</div>
										<div class="mt-2">
											{#if item.status === 'ok'}
												<span
													class="text-xs text-success-600 dark:text-success-400 font-bold flex items-center gap-1"
												>
													<Check class="w-3.5 h-3.5" aria-hidden="true" />
													Em dia
												</span>
											{:else if item.status === 'nao_assinada' && item.escala_id}
												<div class="flex items-center gap-2">
													<a
														href="/escalas/{item.escala_id}"
														class="text-xs text-warning-600 dark:text-warning-400 font-bold hover:underline decoration-warning-500 flex items-center gap-1"
													>
														<div class="w-2 h-2 rounded-full bg-warning-500 animate-pulse"></div>
														Não Assinada
													</a>
													<button
														type="button"
														class="text-error-500 font-bold px-1.5 py-0.5 bg-error-500/10 rounded"
														onclick={(e) => {
															e.preventDefault();
															itemParaExcluir = item;
															escalaExcluirOpen = true;
														}}>✕</button
													>
												</div>
											{:else if item.status === 'nao_assinada'}
												<span
													class="text-xs text-warning-600 dark:text-warning-400 font-bold flex items-center gap-1"
												>
													<div class="w-2 h-2 rounded-full bg-warning-500"></div>
													Não Assinada
												</span>
											{:else}
												<span
													class="text-xs text-error-600 dark:text-error-400 font-bold flex items-center gap-1"
												>
													<div class="w-2 h-2 rounded-full bg-error-500"></div>
													Não Criada
												</span>
											{/if}
										</div>
									</div>

									<div class="shrink-0 flex items-center gap-2">
										{#if mostrarIgnorados}
											<button
												type="button"
												class="btn btn-sm preset-outlined-surface-500 text-xs font-bold"
												onclick={() => restaurarItem(item)}>Restaurar</button
											>
										{:else}
											<button
												type="button"
												class="btn btn-sm w-9 h-9 !p-0 preset-outlined-surface-500 flex items-center justify-center rounded-full"
												title="Ignorar"
												onclick={() => ignorarItem(item)}
											>
												<BellOff class="w-4 h-4" aria-hidden="true" />
											</button>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
{/if}
