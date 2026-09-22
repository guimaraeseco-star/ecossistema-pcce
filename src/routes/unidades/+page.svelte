<script lang="ts">
	/**
	 * Cadastro de UNIDADES — departamentos, seccionais e delegacias, com a
	 * hierarquia entre elas (`seccional_id`) e as flags de quais tipos de escala
	 * cada uma aceita.
	 *
	 * É a tabela mais estrutural do sistema: `policiais.lotacao` e
	 * `escalas.lotacao` referenciam a unidade pelo NOME, não por chave
	 * estrangeira. Renomear aqui cascateia no servidor (`atualizarUnidade`
	 * reescreve as duas colunas) e excluir exige checar vínculos antes — daí o
	 * modal de exclusão dedicado, que não é confirmação genérica.
	 *
	 * Filtro e busca são do CLIENTE: são poucas centenas de unidades, todas já
	 * carregadas pelo `load`, e filtrar local dá resposta imediata.
	 * `filtroSeccional` esconde departamentos por desenho — eles não pertencem a
	 * seccional nenhuma, e mantê-los na lista filtrada faria o resultado parecer
	 * errado.
	 *
	 * `unidadesAgrupadas` monta a ÁRVORE a partir da lista plana e, no fim,
	 * acrescenta os ÓRFÃOS na raiz: unidade cujo pai não está na lista (por causa
	 * do filtro, ou porque o `seccional_id` aponta para algo que não existe mais)
	 * precisa continuar visível e editável — some da árvore, some da tela, e
	 * ninguém conserta o vínculo quebrado.
	 */
	import type { PageProps } from './$types';
	import SkeletonCards from '$lib/components/SkeletonCards.svelte';
	import SkeletonTableRows from '$lib/components/SkeletonTableRows.svelte';
	import FloatingRefresh from '$lib/components/FloatingRefresh.svelte';
	import BotaoLimparFiltros from '$lib/components/BotaoLimparFiltros.svelte';
	import type { Unidade } from '$lib/types';
	import { nivelTipoUnidade, rotuloTipoUnidade } from '$lib/unidades/tipos';
	import { useAutorizacao, useFiltrosPaginados, useSamePathNavigating } from '$lib/composables';
	import { getSavedFilters } from '$lib/utils/localStorage';
	import ModalCadastrarUnidade from './_components/ModalCadastrarUnidade.svelte';
	import ModalEditarUnidade from './_components/ModalEditarUnidade.svelte';
	import ModalDesativarUnidade from './_components/ModalDesativarUnidade.svelte';
	import BadgeTipoEscala from '$lib/components/BadgeTipoEscala.svelte';
	import EstadoVazio from '$lib/components/EstadoVazio.svelte';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Search from '@lucide/svelte/icons/search';
	import {
		CLASSE_CAIXA_FILTRO,
		CLASSE_INPUT_FILTRO,
		CLASSE_ROTULO_FILTRO
	} from '$lib/gise/filtro-historico-ui';

	const { data }: PageProps = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
	const samePathNav = useSamePathNavigating();
	const savedFilters = getSavedFilters('filtros_unidades', { seccional: 'todas', busca: '' });

	const unidades = $derived(data.unidades as Unidade[]);

	let filtroSeccional = $state<number | 'todas'>(
		(savedFilters.seccional as unknown as number) || 'todas'
	);
	let filtroBusca = $state(savedFilters.busca);

	useFiltrosPaginados({
		chave: 'filtros_unidades',
		snapshot: () => ({ seccional: filtroSeccional, busca: filtroBusca })
	});

	const unidadesFiltradas = $derived(
		unidades.filter((u) => {
			if (filtroSeccional !== 'todas') {
				if (u.tipo === 'departamento' || u.tipo === 'sub_departamento') return false;
				if (u.tipo === 'seccional' && u.id !== filtroSeccional) return false;
				if (u.tipo === 'delegacia' && u.seccional_id !== filtroSeccional) return false;
			}
			if (filtroBusca && !u.nome.toLowerCase().includes(filtroBusca.toLowerCase())) return false;
			return true;
		})
	);

	// Precedência do catálogo (`$lib/unidades/tipos`): irmãos ordenam por tipo
	// (mais alto na árvore primeiro) e depois por nome.
	const tipoRank = (tipo: string) => nivelTipoUnidade(tipo);

	type LinhaUnidade = Unidade & {
		depth: number;
		isChild?: boolean;
		isLastChild?: boolean;
		hasChildren?: boolean;
	};

	const unidadesAgrupadas = $derived.by(() => {
		const all = unidadesFiltradas;
		const childrenOf = (pid: number) =>
			all
				.filter((u) => u.seccional_id === pid)
				.sort((a, b) => {
					const ta = tipoRank(a.tipo);
					const tb = tipoRank(b.tipo);
					if (ta !== tb) return ta - tb;
					return a.nome.localeCompare(b.nome, 'pt-BR');
				});

		// Raiz é qualquer unidade sem pai — Delegacia-Geral, um departamento
		// avulso, uma seccional órfã. Contar tipos aqui quebraria no primeiro
		// órgão do organograma que não fosse departamento nem seccional.
		const roots = all
			.filter((u) => u.seccional_id == null)
			.sort((a, b) => {
				const ta = tipoRank(a.tipo);
				const tb = tipoRank(b.tipo);
				if (ta !== tb) return ta - tb;
				return a.nome.localeCompare(b.nome, 'pt-BR');
			});

		const out: LinhaUnidade[] = [];

		function walk(u: Unidade, depth: number) {
			const kids = childrenOf(u.id);
			out.push({ ...u, depth, isChild: depth > 0, hasChildren: kids.length > 0 });
			kids.forEach((k) => walk(k, depth + 1));
		}

		for (const r of roots) walk(r, 0);

		const linked = new Set(out.map((x) => x.id));
		const orphans = all
			.filter((u) => !linked.has(u.id))
			.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
		for (const o of orphans) {
			out.push({ ...o, depth: 0, isChild: false, hasChildren: false, isLastChild: true });
		}

		return out;
	});

	const seccionais = $derived(unidades.filter((u) => u.tipo === 'seccional'));

	// Edição (estrutura + ficha) no modal dedicado
	let edicaoOpen = $state(false);
	let unidadeEmEdicao = $state<Unidade | null>(null);

	// Desativação (não há exclusão de unidade — ver o cabeçalho)
	let dialogDesativarOpen = $state(false);
	let unidadeParaDesativar = $state<{ id: number; nome: string; ativo: boolean } | null>(null);

	// Cadastro
	let cadastroOpen = $state(false);

	const temFiltros = $derived(filtroSeccional !== 'todas' || filtroBusca !== '');

	function iniciarEdicao(u: Unidade) {
		unidadeEmEdicao = u;
		edicaoOpen = true;
	}

	function solicitarDesativacao(id: number, nome: string, ativo: boolean) {
		unidadeParaDesativar = { id, nome, ativo };
		dialogDesativarOpen = true;
	}

	function limparFiltros() {
		filtroSeccional = 'todas';
		filtroBusca = '';
	}

	const tipoLabel = (tipo: string) => rotuloTipoUnidade(tipo);
</script>

<svelte:head>
	<title>Gerenciar Unidades | Ecossistema PCCE</title>
</svelte:head>

<!-- Os mesmos badges das listagens de escala, aqui dizendo quais REGIMES a
     unidade tem habilitados — não o tipo de uma escala existente. Cor e rótulo
     vêm do componente compartilhado de propósito: é o que faz "Plantão" ter a
     mesma cara na unidade e na escala que ela gera. -->
{#snippet badges(u: Unidade)}
	{#if u.tem_plantao}<BadgeTipoEscala tipo="plantao" tamanho="3xs" />{/if}
	{#if u.tem_expediente}<BadgeTipoEscala tipo="expediente" tamanho="3xs" />{/if}
	{#if u.tem_fds}<BadgeTipoEscala tipo="fds" tamanho="3xs" />{/if}
{/snippet}

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
	<h1 class="h1 text-2xl font-bold">Unidades Policiais</h1>
	<div class="flex flex-wrap gap-2">
		<BotaoLimparFiltros {temFiltros} onclick={limparFiltros} />
		{#if isAdmin}
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 transition-all"
				onclick={() => (cadastroOpen = true)}
			>
				<svg class="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 4v16m8-8H4"
					/></svg
				>
				Cadastrar
			</button>
		{/if}
	</div>
</div>

<div class="{CLASSE_CAIXA_FILTRO} mb-6">
	<div class="flex flex-col sm:flex-row gap-4">
		<label class="flex flex-col gap-1.5 flex-1">
			<span class={CLASSE_ROTULO_FILTRO}>Filtrar por Seccional</span>
			<select class="{CLASSE_INPUT_FILTRO} w-full" bind:value={filtroSeccional}>
				<option value="todas">Todas as Seccionais</option>
				{#each seccionais as sec (sec.id)}
					<option value={sec.id}>{sec.nome}</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1.5 flex-1">
			<span class={CLASSE_ROTULO_FILTRO}>Buscar por Nome</span>
			<div class="relative">
				<input
					type="text"
					class="{CLASSE_INPUT_FILTRO} w-full pl-10"
					bind:value={filtroBusca}
					placeholder="Digite o nome da unidade..."
				/>
				<div class="absolute inset-y-0 left-3 flex items-center pointer-events-none opacity-50">
					<Search class="w-4 h-4" />
				</div>
			</div>
		</label>
	</div>
</div>

<ModalDesativarUnidade bind:open={dialogDesativarOpen} unidade={unidadeParaDesativar} />
<ModalCadastrarUnidade bind:open={cadastroOpen} {seccionais} {unidades} />

<div class="p-4 sm:p-6 rounded-2xl card-elevated shadow-sm overflow-hidden">
	{#if data.unidades.length === 0}
		<EstadoVazio
			class="py-20"
			mensagem="Nenhuma unidade cadastrada."
			descricao={isAdmin
				? 'Cadastre unidades acima para habilitar a importação de policiais.'
				: undefined}
		>
			{#snippet icone()}
				<Building2 class="w-10 h-10 text-surface-400" aria-hidden="true" />
			{/snippet}
		</EstadoVazio>
	{:else}
		<!-- Desktop table -->
		<div class="hidden md:block table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Nome da Unidade</th>
						<th>Tipo / Hierarquia</th>
						<th>Localização</th>
						{#if isAdmin}<th>Ações</th>{/if}
					</tr>
				</thead>
				<tbody>
					{#if samePathNav.current}
						<SkeletonTableRows cols={['h-4 w-44', 'h-6 w-28 rounded-full', 'h-4 w-24']} />
					{:else}
						{#each unidadesAgrupadas as u (u.id)}
							<tr>
								<td
									class="relative"
									style:padding-left={u.depth > 0 ? `${Math.min(u.depth, 8) * 0.75}rem` : null}
								>
									{#if u.hasChildren}
										<div
											class="absolute left-1 top-1/2 bottom-0 w-px bg-surface-400 dark:bg-surface-500"
										></div>
									{/if}
									{#if u.isChild}
										<div
											class="absolute left-1 top-0 {u.isLastChild
												? 'bottom-1/2'
												: 'bottom-0'} w-px bg-surface-400 dark:bg-surface-500"
										></div>
										<div
											class="absolute left-1 top-1/2 w-4 h-px bg-surface-400 dark:bg-surface-500"
										></div>
									{/if}
									<div>
										<span class="font-medium block {u.ativo ? '' : 'opacity-60 line-through'}"
											>{u.nome}</span
										>
										{#if !u.ativo}
											<span
												class="inline-block mt-1 mr-1 text-3xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-warning-500/20 text-warning-700 dark:text-warning-300"
												>Desativada</span
											>
										{/if}
										<span
											class="inline-block mt-1 text-3xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-surface-200/80 dark:bg-surface-700/80 text-surface-600 dark:text-surface-300"
											>{tipoLabel(u.tipo)}</span
										>
										{#if u.sigla}
											<span
												class="inline-block mt-1 ml-1 text-3xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-primary-500/15 text-primary-700 dark:text-primary-300"
												>{u.sigla}</span
											>
										{/if}
										<div class="flex gap-1.5 mt-1.5 items-center">
											{@render badges(u)}
										</div>
									</div>
								</td>
								<td class="text-surface-600 dark:text-surface-300 text-xs">
									{#if u.seccional_id}
										<span class="opacity-70">Subordinada a</span>
										<span class="font-semibold block truncate max-w-[14rem]">
											{unidades.find((x) => x.id === u.seccional_id)?.nome ?? `#${u.seccional_id}`}
										</span>
									{:else}
										<span class="italic opacity-60">—</span>
									{/if}
								</td>
								<td class="text-surface-600 dark:text-surface-300 text-sm font-medium italic"
									>{u.cidade || 'Sem cidade'}</td
								>
								{#if isAdmin}
									<td>
										<div class="flex gap-2">
											<button
												type="button"
												class="btn btn-sm preset-outlined-surface-500"
												onclick={() => iniciarEdicao(u)}>Editar</button
											>
											<button
												type="button"
												class="btn btn-sm {u.ativo
													? 'preset-outlined-surface-500'
													: 'preset-filled-success-500'} transition-all"
												onclick={() => solicitarDesativacao(u.id, u.nome, u.ativo)}
												>{u.ativo ? 'Desativar' : 'Reativar'}</button
											>
										</div>
									</td>
								{/if}
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
				{#each unidadesAgrupadas as u (u.id)}
					<div
						class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border {u.isChild
							? 'border-l-4 border-l-surface-400 dark:border-l-surface-600 border-surface-200 dark:border-white/10 ml-3 sm:ml-6'
							: 'border-surface-200 dark:border-white/10'}"
					>
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="font-semibold text-sm {u.ativo ? '' : 'opacity-60 line-through'}">
									{u.nome}
								</p>
								{#if !u.ativo}
									<span
										class="inline-block mt-0.5 text-3xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-warning-500/20 text-warning-700 dark:text-warning-300"
										>Desativada</span
									>
								{/if}
								<p
									class="text-3xs font-bold uppercase text-surface-600 dark:text-surface-400 mt-0.5"
								>
									{tipoLabel(u.tipo)}
									{#if u.sigla}
										<span class="ml-1 text-primary-700 dark:text-primary-300">{u.sigla}</span>
									{/if}
								</p>
								{#if u.seccional_id}
									<p class="text-3xs text-surface-600 dark:text-surface-400 mt-0.5 truncate">
										Subordinada a: {unidades.find((x) => x.id === u.seccional_id)?.nome ??
											u.seccional_id}
									</p>
								{/if}
								<div class="flex flex-wrap gap-1.5 mt-1.5 mb-1">
									{@render badges(u)}
								</div>
								<p class="text-2xs text-surface-600 dark:text-surface-300 font-medium italic mt-1">
									{u.cidade || 'Sem cidade'}
								</p>
							</div>
							{#if isAdmin}
								<div class="flex gap-2 shrink-0">
									<button
										type="button"
										class="btn btn-sm preset-outlined-surface-500"
										onclick={() => iniciarEdicao(u)}>Editar</button
									>
									<button
										type="button"
										class="btn btn-sm {u.ativo
											? 'preset-outlined-surface-500'
											: 'preset-filled-success-500'} transition-all"
										onclick={() => solicitarDesativacao(u.id, u.nome, u.ativo)}
										>{u.ativo ? 'Desativar' : 'Reativar'}</button
									>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<p class="mt-3 text-surface-600 dark:text-surface-400 text-sm">
			{unidadesFiltradas.length} unidade{unidadesFiltradas.length !== 1 ? 's' : ''} encontrada{unidadesFiltradas.length !==
			1
				? 's'
				: ''}
		</p>
	{/if}
</div>
<FloatingRefresh chaves="app:unidades" />
<ModalEditarUnidade bind:open={edicaoOpen} unidade={unidadeEmEdicao} {unidades} />
