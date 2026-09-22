<script lang="ts">
	/**
	 * Lista e CADASTRO de policiais — a tela de onde nasce o vínculo de cada
	 * pessoa com uma unidade, e por consequência todo o escopo de RBAC.
	 *
	 * Listagem paginada no servidor (20 por página) com filtros de lotação,
	 * cargo, seccional e busca. A tela ABRE SEM FILTRO (decisão dele, 17/09):
	 * só a URL seleciona — o que vinha do localStorage deixava os botões
	 * "Afastados"/"OIP" acesos com a lista inteira embaixo, porque o servidor
	 * lê a URL e não o navegador. O filtro por seccional é do CLIENTE: ele restringe
	 * as opções de lotação do dropdown, não a consulta. `'__todas__'` é a
	 * sentinela de "sem filtro" que o servidor entende.
	 *
	 * Quem chega aqui são os TRÊS papéis administrativos, com poderes diferentes:
	 * o Admin Geral vê a corporação inteira e cadastra/exclui; o admin de
	 * seccional e o de unidade veem só o escopo deles (recorte do servidor, não
	 * do filtro) e entram pelo botão "Gerenciar" para PEDIR correções na ficha.
	 * Cadastrar e excluir não aparecem para eles — as actions recusariam de
	 * qualquer forma, e botão que só serve para receber 403 é armadilha.
	 *
	 * O que a tela deliberadamente NÃO faz:
	 *
	 * - não define senha. O cadastro cria o registro com senha aleatória e
	 *   `primeiro_acesso`, e o policial entra pelo link enviado por e-mail;
	 * - não exibe CPF de ninguém: o campo é de ENTRADA, mascarado ao digitar
	 *   (`formatarCPF`) e enviado limpo (`limparCPF`) para ser cifrado no
	 *   servidor. A lista não traz CPF em claro do banco.
	 *
	 * O formulário de cadastro PODE conceder papel administrativo já na criação —
	 * e aí `papel_unidade_id` é obrigatório, porque papel sem alcance deixa o
	 * escopo indefinido (`papelSemUnidade` trava o submit). A única exceção é o
	 * admin de unidade cadastrando outro admin da própria unidade, onde o alcance
	 * é implícito. Alterar papel depois é na tela do policial
	 * (`/servidores/[id]`).
	 */
	import type { PageProps } from './$types';
	import { goto } from '$app/navigation';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { fly } from 'svelte/transition';
	import SkeletonCards from '$lib/components/SkeletonCards.svelte';
	import SkeletonTableRows from '$lib/components/SkeletonTableRows.svelte';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import PaginationControls from '$lib/components/PaginationControls.svelte';
	import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';
	import BotaoLimparFiltros from '$lib/components/BotaoLimparFiltros.svelte';
	import EstadoVazio from '$lib/components/EstadoVazio.svelte';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import ModalCadastrarPolicial from './_components/ModalCadastrarPolicial.svelte';
	import Search from '@lucide/svelte/icons/search';
	import {
		useAutorizacao,
		useConfirmationDialog,
		useFiltrosPaginados,
		useSamePathNavigating
	} from '$lib/composables';
	import type { Policial, Unidade } from '$lib/types';
	import {
		COR_SITUACAO,
		ROTULO_SITUACAO,
		rotuloAfastamento,
		type SituacaoServidor
	} from '$lib/servidores/afastamentos';
	import { formatarData } from '$lib/utils/datas';
	import type { ActionResult } from '@sveltejs/kit';
	import {
		CLASSE_CAIXA_FILTRO,
		CLASSE_CONTROLE_SEGMENTO_LARGO,
		CLASSE_INPUT_FILTRO,
		CLASSE_ITEM_SEGMENTO_LARGO,
		CLASSE_ROTULO_FILTRO
	} from '$lib/gise/filtro-historico-ui';

	const { data }: PageProps = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
	const samePathNav = useSamePathNavigating();
	const isAdminOrSeccional = $derived(auth.isAdminOrSeccional);
	const isAdminUnidade = $derived(auth.isAdminUnidade);

	const unidades = $derived(data.unidades as Unidade[]);
	const designacoes = $derived(data.designacoes as { id: number; nome: string; simbolo: string }[]);
	/**
	 * A linha da lista: o cadastro, a situação de hoje (fase 2-C) e a designação
	 * já resolvida pelo `load` — o `designacao_id` cru não diz nada na tela.
	 */
	type LinhaServidor = Policial & {
		situacao: SituacaoServidor;
		afastamento: { subtipo: string; data_inicio: string; data_fim: string | null } | null;
		designacao: string | null;
		designacao_simbolo: string | null;
		pendenciasFerias: { reprogramacoesPendentes: number; abonosSemCiencia: number } | null;
		abono: { inicio: string; fim: string } | null;
	};
	const policiais = $derived(data.policiais as LinhaServidor[]);

	// Paginação
	let paginaAtual = $state(untrack(() => data.pagination.page));
	const totalPaginas = $derived(data.pagination.totalPages);
	const ITEMS_POR_PAGINA = 20;

	// Filtros
	let filtroLotacao = $state(untrack(() => data.filtros.lotacao || ''));
	let filtroCargo = $state(untrack(() => data.filtros.cargo || ''));
	// Situação de hoje: '' (todos) | ativos | ferias | afastados. Vem da URL
	// quando o link parte da Gestão de unidade.
	let filtroSituacao = $state(untrack(() => data.filtros.situacao || ''));
	let filtroSeccional = $state<number | 'todas'>(
		untrack(() => {
			const raw = data.filtros.seccional || 'todas';
			return raw === 'todas' ? 'todas' : Number(raw);
		})
	);
	let filtroBusca = $state(untrack(() => data.filtros.busca || ''));
	let filtroDesignacao = $state(untrack(() => data.filtros.designacao || ''));

	const seccionais = $derived(unidades.filter((u) => u.tipo === 'seccional'));
	// Toda unidade ATIVA é lotação possível — departamento, subdepartamento,
	// seccional e unidade de atendimento também têm servidores. Só delegacias
	// aqui deixava o link vindo da Gestão de unidade (lotação = departamento)
	// sem opção correspondente, e o filtro se perdia. Com uma seccional
	// escolhida: ela e o que responde a ela.
	const delegaciasDropdown = $derived(
		filtroSeccional === 'todas'
			? unidades
			: unidades.filter((u) => u.id === filtroSeccional || u.seccional_id === filtroSeccional)
	);

	// Dialog de confirmação
	const confirmDialog = useConfirmationDialog<{ id: number; nome: string }>();

	// Special sentinel value for "sem lotação" filter
	const SEM_LOTACAO = '__sem_lotacao__';
	const TODAS_UNIDADES = '__todas__';

	// Persistência dos filtros + navegação (query server-side). A paginação
	// abaixo preserva a URL corrente; por isso navegarComFiltros vai sempre à
	// página 1.
	const filtros = useFiltrosPaginados({
		chave: 'filtros_policiais',
		snapshot: () => ({
			lotacao: filtroLotacao,
			cargo: filtroCargo,
			seccional: filtroSeccional,
			busca: filtroBusca,
			situacao: filtroSituacao,
			designacao: filtroDesignacao
		}),
		query: (p) => {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const params = new URLSearchParams();
			if (
				filtroLotacao &&
				filtroLotacao !== 'todas' &&
				filtroLotacao !== TODAS_UNIDADES &&
				filtroLotacao !== SEM_LOTACAO
			) {
				params.set('lotacao', filtroLotacao);
			}
			if (filtroCargo) params.set('cargo', filtroCargo);
			if (filtroDesignacao) params.set('designacao', filtroDesignacao);
			if (filtroSituacao) params.set('situacao', filtroSituacao);
			if (filtroBusca) params.set('busca', filtroBusca);
			if (filtroSeccional && filtroSeccional !== 'todas') {
				params.set('seccional', String(filtroSeccional));
			}
			params.set('page', String(p));
			return params;
		}
	});

	// Cadastro
	let cadastroOpen = $state(false);
	let excluindo = $state(false);

	$effect(() => {
		// Resetar para página 1 ao filtrar
		if (filtroCargo || filtroBusca || filtroLotacao || filtroSeccional) {
			paginaAtual = 1;
		}
	});

	function navegarComFiltros() {
		filtros.navegar(1);
	}

	function solicitarExclusao(id: number, nome: string) {
		confirmDialog.openDialog({ id, nome });
	}

	function handleExcluir() {
		excluindo = true;
		return async ({ result }: { result: ActionResult }) => {
			if (result.type === 'success') {
				await invalidateShared('app:policiais');
				toaster.create({
					title: `${confirmDialog.currentItem?.nome} removido com sucesso`,
					type: 'success'
				});
				confirmDialog.closeDialog();
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
			excluindo = false;
		};
	}

	// "Limpar filtros" volta para SEM filtro de lotação, em todos os papéis: o
	// recorte de quem o usuário alcança é do servidor (`escopoLotacoes`), não
	// deste campo. O admin de unidade tinha aqui a própria `lotacao` como base
	// fixa, e isso mentia desde que o escopo passou a vir do PAPEL: quem foi
	// nomeado administrador da DP 1 e é lotado na DP 5 limpava os filtros e via
	// zero servidores — a interseção de um filtro pela DP 5 com um escopo da
	// DP 1 (a mesma confusão lotação × papel do FLW-RBAC-003).
	const filtroLotacaoBase = '';

	function limparFiltros() {
		filtroLotacao = filtroLotacaoBase;
		filtroCargo = '';
		filtroDesignacao = '';
		filtroSituacao = '';
		filtroSeccional = 'todas';
		filtroBusca = '';
		paginaAtual = 1;
		navegarComFiltros();
	}

	const temFiltros = $derived(
		filtroLotacao !== filtroLotacaoBase ||
			filtroCargo !== '' ||
			filtroDesignacao !== '' ||
			filtroSituacao !== '' ||
			filtroSeccional !== 'todas' ||
			filtroBusca !== ''
	);

	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	function handleBuscaInput() {
		if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(navegarComFiltros, 400);
	}
</script>

<svelte:head>
	<title>Gerenciar Policiais | Ecossistema PCCE</title>
</svelte:head>

<!-- Selo da situação de hoje: férias em dourado, afastado em vermelho, com o
     tipo e o fim — a referência rápida que faltava (pedido de 15/09/2026). -->
{#snippet seloSituacao(p: LinhaServidor)}
	{#if p.situacao === 'ativo'}
		<span class="text-xs {COR_SITUACAO.ativo}">{ROTULO_SITUACAO.ativo}</span>
		{#if p.abono}
			<!-- Está de pé porque converteu os dias em dinheiro — a unidade precisa
			     ver isso, senão pergunta por que ele não está de férias. -->
			<span class="block text-3xs text-surface-500">em abono até {formatarData(p.abono.fim)}</span>
		{/if}
	{:else}
		<span class="block text-xs font-semibold {COR_SITUACAO[p.situacao]}"
			>{p.situacao === 'ferias' ? 'Férias' : rotuloAfastamento(p.afastamento?.subtipo ?? '')}</span
		>
		<span class="block text-3xs text-surface-500"
			>{p.afastamento?.data_fim
				? `até ${formatarData(p.afastamento.data_fim)}`
				: `desde ${formatarData(p.afastamento?.data_inicio ?? '')}`}</span
		>
	{/if}
	{@render alertaFerias(p.pendenciasFerias)}
{/snippet}

<!-- Pendência de férias: pedido aguardando a COGEP ou abono sem ciência da
     unidade. Fica até a unidade resolver na ficha — por isso é alerta, não
     informação (decisão dele, 17/09). -->
{#snippet alertaFerias(pend: { reprogramacoesPendentes: number; abonosSemCiencia: number } | null)}
	{#if pend && (pend.reprogramacoesPendentes > 0 || pend.abonosSemCiencia > 0)}
		<span
			class="mt-0.5 block text-3xs font-semibold text-warning-700 dark:text-warning-400"
			title={[
				pend.reprogramacoesPendentes > 0 &&
					`${pend.reprogramacoesPendentes} reprogramação de férias aguardando a COGEP`,
				pend.abonosSemCiencia > 0 && `${pend.abonosSemCiencia} abono sem ciência da unidade`
			]
				.filter(Boolean)
				.join(' · ')}
		>
			⚠ Férias: {pend.reprogramacoesPendentes > 0
				? 'pedido pendente'
				: ''}{pend.reprogramacoesPendentes > 0 && pend.abonosSemCiencia > 0
				? ' · '
				: ''}{pend.abonosSemCiencia > 0 ? 'abono sem ciência' : ''}
		</span>
	{/if}
{/snippet}

<!-- A função exercida, com o símbolo da gratificação embaixo quando há (DAS/DNS).
     Servidor sem designação é o da célula vazia na planilha, não um erro. -->
{#snippet designacaoDaLinha(p: LinhaServidor)}
	{#if p.designacao}
		<span class="block text-xs">{p.designacao}</span>
		{#if p.designacao_simbolo}
			<span class="block text-3xs tracking-wide text-surface-500 uppercase"
				>{p.designacao_simbolo}</span
			>
		{/if}
	{:else}
		<span class="text-xs text-surface-400">—</span>
	{/if}
{/snippet}

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
	<h1 class="h1 text-2xl font-bold">Gerenciar Policiais</h1>
	<div class="flex flex-wrap justify-end gap-2">
		<BotaoLimparFiltros {temFiltros} onclick={limparFiltros} />
		{#if isAdmin}
			<a
				href="/servidores/upload"
				class="btn btn-sm preset-outlined-surface-500 hidden sm:inline-flex">Importar Excel</a
			>
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 transition-colors"
				onclick={() => (cadastroOpen = true)}>Novo Policial</button
			>
		{/if}
	</div>
</div>

{#if isAdmin}
	<ModalCadastrarPolicial
		bind:open={cadastroOpen}
		{unidades}
		{isAdmin}
		{isAdminOrSeccional}
		{isAdminUnidade}
		lotacaoUsuario={data.lotacaoUsuario}
		semTitular={data.semTitular}
	/>
{/if}

<ModalShell
	bind:open={confirmDialog.isOpen}
	title="Excluir Policial?"
	largura="sm"
	pending={excluindo}
	cancelLabel="Cancelar"
>
	{#snippet description()}
		Tem certeza que deseja excluir o policial "{confirmDialog.currentItem?.nome}" do sistema de
		cadastro?
	{/snippet}

	{#snippet footer()}
		<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
			<input type="hidden" name="policial_id" value={confirmDialog.currentItem?.id} />
			<button
				type="submit"
				class="btn btn-sm preset-filled-error-500 flex items-center gap-2 transition-colors"
				disabled={excluindo}
			>
				{excluindo ? 'Excluindo...' : 'Remover Policial'}
			</button>
		</form>
	{/snippet}
</ModalShell>

<div class="space-y-6 mt-2">
	<section class="{CLASSE_CAIXA_FILTRO} space-y-4">
		<div class="flex flex-col md:flex-row md:flex-wrap items-stretch md:items-end gap-4">
			<div class="flex flex-col gap-1.5 flex-1 min-w-[260px] lg:max-w-sm">
				<span class={CLASSE_ROTULO_FILTRO}>Situação hoje</span>
				<SegmentedControl
					value={filtroSituacao || ''}
					onValueChange={(e) => {
						filtroSituacao = e.value ?? '';
						navegarComFiltros();
					}}
					class="w-full"
				>
					<SegmentedControl.Control class={CLASSE_CONTROLE_SEGMENTO_LARGO}>
						{#each [['', 'Todos'], ['ativos', 'Ativos'], ['ferias', 'Férias'], ['afastados', 'Afastados']] as [val, label] (val)}
							<SegmentedControl.Item value={val} class={CLASSE_ITEM_SEGMENTO_LARGO}>
								<SegmentedControl.ItemText>{label}</SegmentedControl.ItemText>
								<SegmentedControl.ItemHiddenInput />
							</SegmentedControl.Item>
						{/each}
					</SegmentedControl.Control>
				</SegmentedControl>
			</div>
			<div class="flex flex-col gap-1.5 flex-1 min-w-[220px] lg:max-w-xs">
				<span class={CLASSE_ROTULO_FILTRO}>Cargo</span>
				<SegmentedControl
					value={filtroCargo || ''}
					onValueChange={(e) => {
						filtroCargo = e.value ?? '';
						navegarComFiltros();
					}}
					class="w-full"
				>
					<SegmentedControl.Control class={CLASSE_CONTROLE_SEGMENTO_LARGO}>
						{#each [['', 'Todos'], ['DPC', 'DPC'], ['OIP', 'OIP']] as [val, label] (val)}
							<SegmentedControl.Item value={val} class={CLASSE_ITEM_SEGMENTO_LARGO}>
								<SegmentedControl.ItemText>{label}</SegmentedControl.ItemText>
								<SegmentedControl.ItemHiddenInput />
							</SegmentedControl.Item>
						{/each}
					</SegmentedControl.Control>
				</SegmentedControl>
			</div>
			<!-- Designação = a FUNÇÃO exercida, não o cargo: é ela que responde
			     "quem são os de plantão", "quantos chefes de cartório há aqui".
			     Fora do `isAdmin` de propósito — o administrador de seccional e de
			     unidade precisa da mesma pergunta dentro do escopo dele. -->
			<label class="flex flex-col gap-1.5 flex-1 min-w-[240px] lg:max-w-xs">
				<span class={CLASSE_ROTULO_FILTRO}>Designação</span>
				<select
					class="{CLASSE_INPUT_FILTRO} w-full"
					bind:value={filtroDesignacao}
					onchange={navegarComFiltros}
				>
					<option value="">Todas as designações</option>
					{#each designacoes as d (d.id)}
						<option value={String(d.id)}>{d.nome}{d.simbolo ? ` (${d.simbolo})` : ''}</option>
					{/each}
				</select>
			</label>

			{#if isAdmin}
				<label class="flex flex-col gap-1.5 flex-1 min-w-[220px] lg:max-w-xs">
					<span class={CLASSE_ROTULO_FILTRO}>Seccional</span>
					<select
						class="{CLASSE_INPUT_FILTRO} w-full"
						bind:value={filtroSeccional}
						onchange={() => {
							filtroLotacao = '';
							navegarComFiltros();
						}}
					>
						<option value="todas">Todas as Seccionais</option>
						{#each seccionais as sec (sec.id)}
							<option value={sec.id}>{sec.nome}</option>
						{/each}
					</select>
				</label>
				<label class="flex flex-col gap-1.5 flex-1 min-w-[240px] lg:max-w-xs">
					<span class={CLASSE_ROTULO_FILTRO}>Unidade de Lotação</span>
					<select
						class="{CLASSE_INPUT_FILTRO} w-full"
						bind:value={filtroLotacao}
						onchange={navegarComFiltros}
					>
						<option value="">Selecione uma unidade...</option>
						<option value={TODAS_UNIDADES}>Todas as unidades</option>
						{#each delegaciasDropdown as del (del.id)}
							<option value={del.nome}>{del.nome}</option>
						{/each}
						<option value={SEM_LOTACAO}>— Sem lotação —</option>
					</select>
				</label>
			{/if}

			<label class="flex flex-col gap-1.5 flex-1 min-w-[220px]">
				<span class={CLASSE_ROTULO_FILTRO}>Buscar por Nome ou Matrícula</span>
				<div class="relative w-full">
					<input
						type="text"
						class="{CLASSE_INPUT_FILTRO} w-full pl-10 pr-4"
						bind:value={filtroBusca}
						placeholder="Nome ou matrícula..."
						oninput={handleBuscaInput}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
								navegarComFiltros();
							}
						}}
					/>
					<div class="absolute inset-y-0 left-3 flex items-center pointer-events-none opacity-50">
						<Search class="w-4 h-4" />
					</div>
				</div>
			</label>
		</div>
		{#if isAdmin && !filtroLotacao && !filtroBusca}
			<p class="text-xs text-surface-600 dark:text-surface-400 italic px-1">
				Selecione uma unidade ou pesquise por nome/matrícula para visualizar os policiais.
			</p>
		{/if}
	</section>

	<section class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6 overflow-hidden">
		{#if policiais.length === 0}
			<EstadoVazio>
				<p class="mb-4">
					{filtroCargo
						? `Nenhum policial com cargo ${filtroCargo} encontrado.`
						: 'Nenhum policial cadastrado.'}
				</p>
				{#if isAdmin && !filtroCargo}
					<a
						href="/servidores"
						class="btn preset-filled-primary-500 transition-colors"
						onclick={(e) => {
							e.preventDefault();
							cadastroOpen = true;
						}}>Cadastrar Policial</a
					>
				{/if}
			</EstadoVazio>
		{:else}
			<!-- Desktop table -->
			<div class="hidden md:block table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th class="w-[20%]">Nome</th>
							<th class="w-[10%] whitespace-nowrap px-4">Matrícula</th>
							<th class="w-[7%] whitespace-nowrap px-4">Cargo</th>
							<th class="w-[16%] px-4">Designação</th>
							<th class="whitespace-nowrap px-4">Situação</th>
							<th class="w-[11%] whitespace-nowrap px-4">Telefone</th>
							<th class="w-[18%]">Lotação</th>
							<th>Ações</th>
						</tr>
					</thead>
					<tbody>
						{#if samePathNav.current}
							<SkeletonTableRows
								cols={[
									'h-4 w-40',
									'h-4 w-20',
									'h-6 w-16 rounded-full',
									'h-4 w-36',
									'h-4 w-32',
									'h-4 w-28',
									'h-4 w-28',
									'h-8 w-32 rounded-lg'
								]}
							/>
						{:else}
							{#each policiais as p (p.id)}
								<tr>
									<td class="w-[20%]">{p.nome}</td>
									<td class="font-mono tabular-nums whitespace-nowrap px-4">{p.matricula}</td>
									<td class="px-4">
										<span
											class="badge text-xs {p.cargo === 'DPC'
												? 'preset-filled-primary-500'
												: 'preset-filled-warning-500'}">{p.cargo}</span
										>
									</td>
									<td class="w-[16%] px-4">{@render designacaoDaLinha(p)}</td>
									<td class="px-4">{@render seloSituacao(p)}</td>
									<td class="font-mono tabular-nums whitespace-nowrap px-4">{p.telefone}</td>
									<td class="w-[18%]">{p.lotacao}</td>
									<td>
										<div class="flex gap-2">
											<a
												href="/servidores/{p.id}"
												class="btn btn-sm preset-outlined-surface-500"
												title="Gerenciar cadastro, movimentações e histórico">Gerenciar</a
											>
											{#if isAdmin}
												<button
													type="button"
													class="btn btn-sm preset-filled-error-500 transition-colors"
													onclick={() => solicitarExclusao(p.id, p.nome)}>Excluir</button
												>
											{/if}
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
					{#each policiais as p, i (p.id)}
						<div
							transition:fly={{ y: 8, delay: i * 30, duration: 200 }}
							class="p-4 rounded-2xl card-elevated-2 hover:border-primary-500/30 transition-colors"
						>
							<div class="flex items-center justify-between mb-2">
								<span class="font-semibold text-sm">{p.nome}</span>
								<span
									class="badge text-xs {p.cargo === 'DPC'
										? 'preset-filled-primary-500'
										: 'preset-filled-warning-500'}">{p.cargo}</span
								>
							</div>
							<div class="space-y-1 text-sm mb-3">
								<div class="flex justify-between gap-3">
									<span class="shrink-0 text-surface-600 dark:text-surface-400">Designação</span>
									<span class="text-right">{@render designacaoDaLinha(p)}</span>
								</div>
								<div class="flex justify-between">
									<span class="text-surface-600 dark:text-surface-400">Situação</span>
									{@render seloSituacao(p)}
								</div>
								<div class="flex justify-between">
									<span class="text-surface-600 dark:text-surface-400">Matrícula</span>
									<span class="text-surface-900 dark:text-surface-100 font-mono tabular-nums"
										>{p.matricula}</span
									>
								</div>
								<div class="flex justify-between">
									<span class="text-surface-600 dark:text-surface-400">Telefone</span>
									<span class="text-surface-900 dark:text-surface-100 font-mono tabular-nums"
										>{p.telefone}</span
									>
								</div>
								<div class="flex justify-between">
									<span class="text-surface-600 dark:text-surface-400">Lotação</span>
									<span class="text-right text-surface-900 dark:text-surface-100">{p.lotacao}</span>
								</div>
							</div>
							<div class="flex gap-2 pt-3 border-t border-surface-200 dark:border-white/5">
								<a
									href="/servidores/{p.id}"
									class="btn btn-sm preset-outlined-surface-500 flex-1 text-center"
									title="Gerenciar cadastro, movimentações e histórico">Gerenciar</a
								>
								{#if isAdmin}
									<button
										type="button"
										class="btn btn-sm preset-filled-error-500 transition-colors flex-1"
										onclick={() => solicitarExclusao(p.id, p.nome)}>Excluir</button
									>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<PaginationControls
				{paginaAtual}
				{totalPaginas}
				totalItens={data.pagination.total}
				itensPorPagina={ITEMS_POR_PAGINA}
				labelSingular="policial"
				labelPlural="policial(is)"
				onPageChange={(p: number) => {
					paginaAtual = p;
					const params = new URLSearchParams(window.location.search);
					params.set('page', p.toString());
					goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
				}}
			/>
		{/if}
	</section>
</div>
