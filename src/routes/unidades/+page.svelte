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
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import type { Unidade } from '$lib/types';
	import { CIDADES_CEARA } from '$lib/constants/cidades';
	import { useAutorizacao, useFiltrosPaginados, useSamePathNavigating } from '$lib/composables';
	import { getSavedFilters } from '$lib/utils/localStorage';
	import type { ActionResult } from '@sveltejs/kit';
	import ModalCadastrarUnidade from './_components/ModalCadastrarUnidade.svelte';
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

	const tipoRank: Record<string, number> = {
		departamento: 0,
		sub_departamento: 1,
		seccional: 2,
		delegacia: 3
	};

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
					const ta = tipoRank[a.tipo] ?? 9;
					const tb = tipoRank[b.tipo] ?? 9;
					if (ta !== tb) return ta - tb;
					return a.nome.localeCompare(b.nome, 'pt-BR');
				});

		const roots = all
			.filter(
				(u) =>
					(u.tipo === 'departamento' && u.seccional_id == null) ||
					(u.tipo === 'seccional' && u.seccional_id == null)
			)
			.sort((a, b) => {
				if (a.tipo !== b.tipo) return a.tipo === 'departamento' ? -1 : 1;
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

	// Edição inline
	let editandoId = $state<number | null>(null);
	let editNome = $state('');
	let editTipo = $state<Unidade['tipo']>('delegacia');
	let editSeccionalId = $state<number | null>(null);
	let editTemPlantao = $state(false);
	let editTemExpediente = $state(false);
	let editTemFds = $state(false);
	let editCidade = $state('');
	let editSigla = $state('');
	let pendingEditar = $state(false);

	// Desativação (não há exclusão de unidade — ver o cabeçalho)
	let dialogDesativarOpen = $state(false);
	let unidadeParaDesativar = $state<{ id: number; nome: string; ativo: boolean } | null>(null);

	// Cadastro
	let cadastroOpen = $state(false);

	const temFiltros = $derived(filtroSeccional !== 'todas' || filtroBusca !== '');

	function iniciarEdicao(u: Unidade) {
		editandoId = u.id;
		editNome = u.nome;
		editTipo = u.tipo;
		editSeccionalId = u.seccional_id;
		editTemPlantao = u.tem_plantao ?? false;
		editTemExpediente = u.tem_expediente ?? false;
		editTemFds = u.tem_fds ?? false;
		editCidade = u.cidade ?? '';
		editSigla = u.sigla ?? '';
	}

	function cancelarEdicao() {
		editandoId = null;
		editNome = '';
		editTipo = 'delegacia';
		editSeccionalId = null;
		editTemPlantao = false;
		editTemExpediente = false;
		editTemFds = false;
		editCidade = '';
		editSigla = '';
	}

	function handleEditar() {
		pendingEditar = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingEditar = false;
			if (result.type === 'success') {
				await invalidateShared('app:unidades');
				toaster.create({ title: 'Unidade atualizada com sucesso!', type: 'success' });
				cancelarEdicao();
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao atualizar unidade'), type: 'error' });
			}
		};
	}

	function solicitarDesativacao(id: number, nome: string, ativo: boolean) {
		unidadeParaDesativar = { id, nome, ativo };
		dialogDesativarOpen = true;
	}

	function limparFiltros() {
		filtroSeccional = 'todas';
		filtroBusca = '';
	}

	function tipoLabel(tipo: string) {
		if (tipo === 'departamento') return 'Departamento';
		if (tipo === 'sub_departamento') return 'Subdepartamento';
		if (tipo === 'seccional') return 'Seccional';
		return 'Delegacia';
	}
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

{#snippet editInputs()}
	<input type="hidden" name="id" value={editandoId} />
	<input type="hidden" name="nome" value={editNome} />
	<input type="hidden" name="tipo" value={editTipo} />
	<input type="hidden" name="seccional_id" value={editSeccionalId ?? ''} />
	<input type="hidden" name="tem_plantao" value={editTemPlantao ? 'on' : ''} />
	<input type="hidden" name="tem_expediente" value={editTemExpediente ? 'on' : ''} />
	<input type="hidden" name="tem_fds" value={editTemFds ? 'on' : ''} />
	<input type="hidden" name="cidade" value={editCidade} />
	<input type="hidden" name="sigla" value={editSigla} />
{/snippet}

{#snippet editFields(datalistId: string)}
	<input
		class="input text-sm w-full"
		type="text"
		bind:value={editNome}
		onkeydown={(e) => {
			if (e.key === 'Escape') cancelarEdicao();
		}}
	/>
	<div class="flex flex-wrap items-center gap-3 text-sm py-2">
		<label class="flex items-center space-x-1.5"
			><input class="checkbox" type="checkbox" bind:checked={editTemPlantao} /><span>Plantão</span
			></label
		>
		<label class="flex items-center space-x-1.5"
			><input class="checkbox" type="checkbox" bind:checked={editTemExpediente} /><span
				>Expediente</span
			></label
		>
		<label class="flex items-center space-x-1.5"
			><input class="checkbox" type="checkbox" bind:checked={editTemFds} /><span>FDS</span></label
		>
		<input
			class="input text-xs w-full sm:w-auto sm:min-w-[140px] sm:max-w-[200px]"
			type="text"
			list={datalistId}
			bind:value={editCidade}
			placeholder="Mudar cidade..."
		/>
		<datalist id={datalistId}>
			{#each CIDADES_CEARA as c (c)}
				<option value={c}></option>
			{/each}
		</datalist>
		{#if editTipo === 'departamento' || editTipo === 'sub_departamento'}
			<!-- Sigla é atributo de departamento; delegacia e seccional não têm. -->
			<input
				class="input text-xs w-full sm:w-auto sm:max-w-[140px]"
				type="text"
				maxlength="20"
				bind:value={editSigla}
				placeholder="Sigla (DPI SUL)"
				aria-label="Sigla do departamento"
			/>
		{/if}
	</div>
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
<ModalCadastrarUnidade bind:open={cadastroOpen} {seccionais} />

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
									{#if isAdmin && editandoId === u.id}
										<div class="flex flex-col gap-2">
											{@render editFields('cidades-ce-edicao')}
										</div>
									{:else}
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
									{/if}
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
										{#if editandoId === u.id}
											<form
												method="POST"
												action="?/editar"
												use:enhance={handleEditar}
												class="flex gap-2"
											>
												{@render editInputs()}
												<button
													type="submit"
													class="btn btn-sm preset-filled-primary-500 flex items-center gap-1.5 transition-all"
													disabled={pendingEditar || !editNome.trim()}
												>
													{pendingEditar ? 'Salvando...' : 'Salvar'}
												</button>
												<button
													type="button"
													class="btn btn-sm preset-outlined-surface-500"
													onclick={cancelarEdicao}>Cancelar</button
												>
											</form>
										{:else}
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
										{/if}
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
						{#if isAdmin && editandoId === u.id}
							<div class="space-y-2">
								{@render editFields('cidades-ce-edicao-mobile')}
								<form method="POST" action="?/editar" use:enhance={handleEditar} class="flex gap-2">
									{@render editInputs()}
									<button
										type="submit"
										class="btn btn-sm preset-filled-primary-500 flex-1 flex items-center justify-center gap-1.5 transition-all"
										disabled={pendingEditar || !editNome.trim()}
									>
										{pendingEditar ? 'Salvando...' : 'Salvar'}
									</button>
									<button
										type="button"
										class="btn btn-sm preset-outlined-surface-500 flex-1"
										onclick={cancelarEdicao}>Cancelar</button
									>
								</form>
							</div>
						{:else}
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
									<p
										class="text-2xs text-surface-600 dark:text-surface-300 font-medium italic mt-1"
									>
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
						{/if}
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
