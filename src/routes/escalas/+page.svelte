<script lang="ts">
	/**
	 * Tela de ESCALAS — três visões em uma rota, alternadas por `visao`:
	 *
	 * - `home`: atalhos e pendências (o que o usuário vê ao entrar);
	 * - `lista`: a tabela filtrável de escalas, paginada no servidor —
	 *   `?status=aguardando` (criadas, ainda não arquivadas) ou
	 *   `?status=arquivada` (assinadas / FDS enviadas);
	 * - `assinaturas`: as escalas que dependem da assinatura deste usuário.
	 *
	 * A visão inicial vem do servidor (`data.initialView`, derivada do `?v=`):
	 * qualquer query string já indica busca/filtro e abre direto na `lista`. Isso
	 * mantém link compartilhado e recarga de página estáveis, em vez de sempre
	 * cair na home e obrigar a refiltrar.
	 *
	 * Filtros: `useFiltrosPaginados` cuida de persistir em localStorage, navegar
	 * no servidor e resetar a página quando qualquer filtro muda — exceto a busca,
	 * que tem handler próprio (debounce). `seccional` participa da assinatura de
	 * mudança mas NÃO vai para a query: ela só filtra o dropdown de delegacias no
	 * cliente.
	 *
	 * A tela também é um dos pontos de assinatura: hospeda o SignaturePad e o
	 * painel de token.
	 */
	import type { PageProps } from './$types';
	import { opcoesMeses } from '$lib/utils/datas';
	import Clock from '@lucide/svelte/icons/clock';
	import Archive from '@lucide/svelte/icons/archive';
	import Plus from '@lucide/svelte/icons/plus';
	import { goto } from '$app/navigation';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import type { EscalaListagem, Unidade } from '$lib/types';
	import { apiFetch } from '$lib/api-fetch';
	import { loading } from '$lib/loading.svelte';
	import type { ActionResult } from '@sveltejs/kit';
	import {
		useAutorizacao,
		useAssinaturaEscala,
		useMobile,
		useFiltrosPaginados,
		useInvalidateOnFocus
	} from '$lib/composables';
	import { getSavedFilters } from '$lib/utils/localStorage';
	import { fetchSyncEstado } from '$lib/sync-estado';
	import type { SignaturePadConfirmPayload } from '$lib/components/SignaturePadTypes';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import ModalAssinaturaAvancada from '$lib/components/ModalAssinaturaAvancada.svelte';
	import { page } from '$app/state';
	import { avancadaEmTelaDoLayout } from '$lib/chave-assinatura-ui';
	import FloatingRefresh from '$lib/components/FloatingRefresh.svelte';
	import ModalNovaEscala from './_components/ModalNovaEscala.svelte';
	import TabelaEscalas from './_components/TabelaEscalas.svelte';
	import SecaoAssinaturas from './_components/SecaoAssinaturas.svelte';
	import CardNavegacao from './_components/CardNavegacao.svelte';
	import DialogSolicitarAssinatura from '$lib/components/DialogSolicitarAssinatura.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import BotaoLimparFiltros from '$lib/components/BotaoLimparFiltros.svelte';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import {
		CLASSE_CAIXA_FILTRO,
		CLASSE_INPUT_SEARCHABLE,
		CLASSE_ROTULO_FILTRO
	} from '$lib/gise/filtro-historico-ui';
	import { mensagemDeErro } from '$lib/utils/erro';
	import {
		filtrosPadrao,
		temFiltrosAtivos,
		queryDeFiltros,
		delegaciasVisiveis,
		destinoDaEdicao,
		tituloDaLista,
		anosDisponiveis
	} from './_components/filtros-escalas';

	const { data }: PageProps = $props();

	const auth = useAutorizacao();
	const isAdmin = $derived(auth.isAdmin);
	const isAdminSeccional = $derived(auth.isAdminSeccional);
	const lotacaoUsuario = $derived(auth.lotacaoUsuario);
	const papelUnidadeId = $derived(data.papelUnidadeId);

	const isAdminDPC = $derived(
		!isAdmin && (auth.isAdminSeccional || auth.isAdminUnidade) && page.data.usuario?.cargo === 'DPC'
	);
	// `filtrosPadrao()` é a fonte ÚNICA dos padrões — antes eles estavam escritos
	// aqui, no `limparFiltros` e no `temFiltros`, e o daqui discordava dos outros
	// dois em `lotacao` (ver `_components/filtros-escalas.ts`).
	const PADRAO = filtrosPadrao();
	const savedFilters = getSavedFilters('filtros_escalas', PADRAO);

	const unidades = $derived(data.unidades);
	const paginaAtual = $derived(data.pagination.page);

	let filtroLotacao = $state(untrack(() => data.filtros.lotacao || savedFilters.lotacao));
	let filtroMes = $state(untrack(() => data.filtros.mes || savedFilters.mes));
	let filtroAno = $state(untrack(() => data.filtros.ano || savedFilters.ano));
	let filtroTipo = $state(untrack(() => data.filtros.tipo || savedFilters.tipo));
	let filtroSeccional = $state<number | 'todas'>(
		(savedFilters.seccional as unknown as number) || 'todas'
	);
	let filtroBusca = $state(untrack(() => data.filtros.busca || savedFilters.busca));
	let filtroStatus = $state<'aguardando' | 'arquivada' | ''>(
		untrack(() => {
			const s = data.filtros.status || savedFilters.status;
			return s === 'aguardando' || s === 'arquivada' ? s : '';
		})
	);

	// Persistência (localStorage) + navegação server-side + auto-nav ao mudar
	// qualquer filtro exceto a busca (que navega via seu próprio handler).
	// `seccional` entra na assinatura (reseta a página) mas não vai à query —
	// só afeta o dropdown de delegacias no cliente.
	const filtros = useFiltrosPaginados({
		chave: 'filtros_escalas',
		snapshot: () => ({
			lotacao: filtroLotacao,
			mes: filtroMes,
			ano: filtroAno,
			tipo: filtroTipo,
			seccional: filtroSeccional,
			busca: filtroBusca,
			status: filtroStatus
		}),
		query: buildQueryParamsComFiltros,
		auto: {
			assinatura: () => [
				filtroSeccional ?? 'todas',
				filtroLotacao ?? '',
				filtroTipo ?? 'todos',
				filtroMes ?? 0,
				filtroAno ?? 0,
				filtroStatus ?? ''
			]
		}
	});

	// Normaliza null vindo do clear do SearchableSelect (mantém o default no select).
	$effect(() => {
		if (filtroSeccional === null) filtroSeccional = 'todas';
		if (filtroLotacao === null) filtroLotacao = '';
		if (filtroTipo === null) filtroTipo = 'todos';
		if (filtroMes === null) filtroMes = 0;
		if (filtroAno === null) filtroAno = 0;
	});

	const seccionais = $derived(unidades.filter((u: Unidade) => u.tipo === 'seccional'));
	const delegaciasDropdown = $derived(delegaciasVisiveis(unidades, filtroSeccional));
	const delegaciasDaSeccional = $derived(
		unidades.filter((u: Unidade) => u.tipo === 'delegacia' && u.seccional_id === papelUnidadeId)
	);

	const seccionaisOptions = $derived([
		{ value: 'todas', label: 'Todas as Seccionais' },
		...seccionais.map((sec) => ({ value: sec.id, label: sec.nome }))
	]);

	const unidadesOptions = $derived([
		{ value: '', label: 'Selecione uma unidade...' },
		{ value: 'todas', label: 'Todas as unidades' },
		...delegaciasDropdown.map((del) => ({ value: del.nome, label: del.nome }))
	]);

	const unidadesDaSeccionalOptions = $derived([
		{ value: '', label: 'Todas as unidades' },
		...delegaciasDaSeccional.map((del) => ({ value: del.nome, label: del.nome }))
	]);

	const escalas = $derived(data.escalas ?? []);
	// Exclusão otimista: ids removidos somem da tabela na hora; o
	// invalidate('app:escalas') que segue corrige total/paginação no fundo.
	let removidosLocais = $state<number[]>([]);
	const escalasVisiveis = $derived(escalas.filter((e) => !removidosLocais.includes(e.id)));
	const totalPaginas = $derived(data.pagination.totalPages);

	let dialogOpen = $state(false);
	let dialogRevogarOpen = $state(false);
	let escalaParaExcluir = $state<{ id: number; titulo: string } | null>(null);
	let escalaParaRevogar = $state<{ id: number; titulo: string } | null>(null);
	let pendingExcluir = $state(false);
	let pendingRevogar = $state(false);

	const meses = opcoesMeses();
	const anos = anosDisponiveis();

	const tiposOptions = [
		{ value: 'todos', label: 'Todos' },
		{ value: 'plantao', label: 'Plantão' },
		{ value: 'expediente', label: 'Expediente' },
		{ value: 'fds', label: 'Final de Semana' }
	];

	const mesesOptions = meses;
	const anosOptions = $derived(
		anos.map((ano) => ({ value: ano, label: ano === 0 ? 'Todos' : String(ano) }))
	);

	function buildQueryParamsComFiltros(p: number) {
		return queryDeFiltros(snapshotFiltros(), p);
	}

	/** Os filtros correntes como valor puro — a fronteira com as regras testadas. */
	function snapshotFiltros() {
		return {
			lotacao: filtroLotacao,
			mes: filtroMes,
			ano: filtroAno,
			tipo: filtroTipo,
			seccional: filtroSeccional,
			busca: filtroBusca,
			status: filtroStatus
		};
	}

	function limparFiltros() {
		filtroSeccional = PADRAO.seccional;
		filtroLotacao = PADRAO.lotacao;
		filtroMes = PADRAO.mes;
		filtroAno = PADRAO.ano;
		filtroTipo = PADRAO.tipo;
		filtroBusca = PADRAO.busca;
		// Mantém `filtroStatus`: limpar filtros não troca a pasta (aguardando/arquivada).

		filtros.navegar(1);
	}

	function solicitarExclusao(id: number, titulo: string) {
		escalaParaExcluir = { id, titulo };
		dialogOpen = true;
	}

	let escalaAbrirComSolicitacao = $state<number | null>(null);
	let dialogRevogarSolicitacaoOpen = $state(false);

	function solicitarEdicao(esc: EscalaListagem) {
		// A ordem entre os três destinos é regra, e está testada em
		// `_components/filtros-escalas.ts` — não a reescreva aqui.
		const destino = destinoDaEdicao(esc, {
			podeOIPSolicitar,
			temSolicitacao: !!solicitacoesMap[esc.id]
		});
		if (destino === 'revogar') {
			escalaParaRevogar = { id: esc.id, titulo: esc.titulo };
			dialogRevogarOpen = true;
		} else if (destino === 'solicitacao') {
			escalaAbrirComSolicitacao = esc.id;
			dialogRevogarSolicitacaoOpen = true;
		} else {
			goto(`/escalas/${esc.id}`);
		}
	}

	async function confirmarRevogacao() {
		if (!escalaParaRevogar) return;
		pendingRevogar = true;
		const id = escalaParaRevogar.id;
		dialogRevogarOpen = false;
		try {
			await apiFetch(`/api/escalas/${id}/documento-assinado`, { method: 'DELETE' });
			toaster.create({
				title: 'Assinatura revogada',
				description: 'A escala agora pode ser editada.',
				type: 'info'
			});
			goto(`/escalas/${id}`);
		} catch (e: unknown) {
			toaster.create({
				title: mensagemDeErro(e, 'Erro ao revogar assinatura'),
				type: 'error'
			});
		} finally {
			pendingRevogar = false;
			escalaParaRevogar = null;
		}
	}

	const temFiltros = $derived(temFiltrosAtivos(snapshotFiltros(), PADRAO));

	function handleExcluir() {
		pendingExcluir = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingExcluir = false;
			if (result.type === 'success') {
				const removida = escalaParaExcluir;
				toaster.create({
					title: `Escala de ${removida!.titulo} removida`,
					type: 'success'
				});
				if (removida) removidosLocais = [...removidosLocais, removida.id];
				dialogOpen = false;
				escalaParaExcluir = null;
				await invalidateShared('app:escalas');
				removidosLocais = [];
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
		};
	}

	let dialogNovaEscalaAberto = $state(false);

	let visao = $state<'home' | 'lista' | 'assinaturas'>(
		untrack(() => {
			const iv = data.initialView;
			return iv === 'lista' || iv === 'assinaturas' ? iv : 'home';
		})
	);

	function abrirLista(status: 'aguardando' | 'arquivada') {
		filtroStatus = status;
		visao = 'lista';
		goto(`?${buildQueryParamsComFiltros(1)}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	$effect(() => {
		const iv = data.initialView;
		if (iv === 'home' || iv === 'assinaturas') {
			visao = iv;
		}
	});

	$effect(() => {
		const s = data.filtros.status;
		if (s === 'aguardando' || s === 'arquivada') filtroStatus = s;
		else if (data.initialView === 'home') filtroStatus = '';
	});

	const tituloLista = $derived(tituloDaLista(filtroStatus));

	const podeAssinar = $derived(data.podeAssinar);
	const escalasParaAssinar = $derived(data.escalasParaAssinar);

	// Pendências: foco + broadcast + poll quente se houver fila ou visão assinaturas.
	useInvalidateOnFocus('app:escalas', {
		isHot: () => escalasParaAssinar.length > 0 || visao === 'assinaturas',
		probe: async () => {
			try {
				const e = await fetchSyncEstado();
				// Sem fatia para este papel: pula o tick (não força invalidate).
				return e.escalas?.stamp ?? null;
			} catch {
				return null;
			}
		}
	});

	const podeOIPSolicitar = $derived(data.podeOIPSolicitar);
	const solicitacoesMap = $derived(data.solicitacoesMap);

	let dialogSolicitar = $state(false);
	let escalaSolicitandoId = $state<number | null>(null);

	function abrirDialogSolicitar(escalaId: number) {
		escalaSolicitandoId = escalaId;
		dialogSolicitar = true;
	}

	async function cancelarSolicitacao(escalaId: number) {
		loading.show('Cancelando solicitação...');
		try {
			await apiFetch(`/api/escalas/${escalaId}/solicitar-assinatura`, { method: 'DELETE' });
			await invalidateShared('app:escalas');
			toaster.create({ title: 'Solicitação cancelada', type: 'success' });
		} catch (e: unknown) {
			toaster.create({
				title: mensagemDeErro(e, 'Erro ao cancelar solicitação'),
				type: 'error'
			});
		} finally {
			loading.hide();
		}
	}

	const usuarioLogado = $derived(page.data.usuario ?? null);
	const mobileState = useMobile();
	const isMobile = $derived(mobileState.isMobile);
	const restringirSmartphone = $derived((page.data.restringirSmartphone as boolean) ?? false);
	const assinaturaTelaBloqueada = $derived(restringirSmartphone && !isMobile);
	const avancadaDisponivel = $derived(avancadaEmTelaDoLayout(page.data));
	const avancadaDesktopDisponivel = $derived(
		!isMobile && !restringirSmartphone && avancadaDisponivel
	);

	let escalaAssinandoId = $state<number | null>(null);
	let dialogAssinaturaTela = $state(false);

	const assinaturaRapida = useAssinaturaEscala({
		getParams: () => ({
			escalaId: String(escalaAssinandoId ?? ''),
			isFDS: false,
			policiaisCount: 1,
			usuario: usuarioLogado
		}),
		onDocumentoAssinado: async () => {
			dialogAssinaturaTela = false;
			escalaAssinandoId = null;
			await invalidateShared('app:escalas');
		}
	});

	let painelTokenRapidoControl = $state<{ assinarComSerpro: () => Promise<void> } | null>(null);

	function iniciarAssinaturaTela(id: number) {
		if (!avancadaDisponivel) return;
		escalaAssinandoId = id;
		dialogAssinaturaTela = true;
	}

	async function iniciarAssinaturaToken(id: number) {
		escalaAssinandoId = id;
		await Promise.resolve();
		await painelTokenRapidoControl?.assinarComSerpro();
	}

	function assinarComTokenNoModal() {
		dialogAssinaturaTela = false;
		if (escalaAssinandoId != null) {
			void iniciarAssinaturaToken(escalaAssinandoId);
		}
	}
</script>

<svelte:head>
	<title>Arquivo de Escalas | Ecossistema PCCE</title>
</svelte:head>

{#if visao === 'home'}
	<!-- A folha desta visão é curta (só o título e três atalhos). Sem altura
	     mínima ela colava no topo e o resto da página ficava vazio; o `calc`
	     desconta topbar (`pt-20`) e as margens do `<main>` (`pb-12`, e em
	     `xl` o padding da folha). O título fica no lugar de sempre; os
	     quadros ocupam o centro do espaço que sobra, um pouco acima do
	     meio geométrico (`pb-[28vh]`), lado a lado. -->
	<div class="flex min-h-[calc(100dvh-8rem)] flex-col xl:min-h-[calc(100dvh-11rem)] print:min-h-0">
		<h1 class="h1 text-2xl font-bold">Escalas ordinárias</h1>

		<div class="flex flex-1 items-center justify-center pb-[28vh]">
			{#if isAdminDPC}
				<div class="grid grid-cols-1 gap-6 w-full max-w-xs">
					{#if podeAssinar && escalasParaAssinar.length > 0}
						<CardNavegacao
							titulo="Assinaturas Pendentes"
							descricao="Escalas prontas para assinar com sua assinatura digital"
							contador={escalasParaAssinar.length}
							realce="tertiary"
							onclick={() => {
								visao = 'assinaturas';
								goto('/escalas?v=assinaturas', { replaceState: true, noScroll: true });
							}}
						/>
					{:else}
						<CardNavegacao
							titulo="Nenhuma pendência"
							descricao="Não há escalas aguardando sua assinatura no momento."
						/>
					{/if}
				</div>
			{:else}
				<div
					class="grid grid-cols-1 gap-6 w-full {podeAssinar && escalasParaAssinar.length > 0
						? 'sm:grid-cols-2 lg:grid-cols-4 max-w-5xl'
						: 'sm:grid-cols-2 lg:grid-cols-3 max-w-4xl'}"
				>
					<CardNavegacao
						titulo="Nova Escala"
						descricao="Criar uma nova escala de plantão, expediente ou final de semana"
						destacado
						onclick={() => (dialogNovaEscalaAberto = true)}
					>
						{#snippet icone()}
							<Plus
								class="h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400"
								aria-hidden="true"
							/>
						{/snippet}
					</CardNavegacao>
					<CardNavegacao
						titulo="Escalas aguardando ass"
						descricao="Em preenchimento ou com assinatura pendente"
						realce="warning"
						onclick={() => abrirLista('aguardando')}
					>
						{#snippet icone()}
							<Clock
								class="h-5 w-5 shrink-0 text-warning-600 dark:text-warning-400"
								aria-hidden="true"
							/>
						{/snippet}
					</CardNavegacao>
					<CardNavegacao
						titulo="Escalas criadas (arquivo)"
						descricao="Assinadas e enviadas"
						onclick={() => abrirLista('arquivada')}
					>
						{#snippet icone()}
							<Archive
								class="h-5 w-5 shrink-0 text-surface-600 dark:text-surface-400"
								aria-hidden="true"
							/>
						{/snippet}
					</CardNavegacao>
					{#if podeAssinar && escalasParaAssinar.length > 0}
						<CardNavegacao
							titulo="Assinaturas Pendentes"
							descricao="Escalas prontas para assinar com sua assinatura digital"
							contador={escalasParaAssinar.length}
							realce="tertiary"
							onclick={() => {
								visao = 'assinaturas';
								goto('/escalas?v=assinaturas', { replaceState: true, noScroll: true });
							}}
						/>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{:else if visao === 'lista'}
	<div class="mb-6 space-y-3">
		<BotaoVoltar
			onclick={() => {
				filtroStatus = '';
				visao = 'home';
				goto('/escalas', { replaceState: true, noScroll: true });
			}}
		/>
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
			<h1 class="h1 text-2xl font-bold">{tituloLista}</h1>
			<div class="flex gap-2 justify-end w-full sm:w-auto">
				<BotaoLimparFiltros {temFiltros} onclick={limparFiltros} />
			</div>
		</div>
	</div>

	<ModalShell
		bind:open={dialogOpen}
		title="Excluir Escala?"
		largura="sm"
		pending={pendingExcluir}
		cancelLabel="Cancelar"
	>
		{#snippet description()}
			Tem certeza que deseja excluir a escala "{escalaParaExcluir?.titulo}"? Esta ação não pode ser
			desfeita.
		{/snippet}

		{#snippet footer()}
			<form method="POST" action="?/excluir" use:enhance={handleExcluir} class="contents">
				<input type="hidden" name="escala_id" value={escalaParaExcluir?.id} />
				<button
					type="submit"
					class="btn preset-filled-error-500 flex items-center gap-2 transition-all"
					disabled={pendingExcluir}
				>
					{pendingExcluir ? 'Excluindo...' : 'Excluir'}
				</button>
			</form>
		{/snippet}
	</ModalShell>

	<ModalShell
		bind:open={dialogRevogarOpen}
		title="Editar Escala Assinada?"
		largura="md"
		pending={pendingRevogar}
		cancelLabel="Voltar"
	>
		{#snippet description()}
			<div class="space-y-4">
				<p class="text-surface-600 dark:text-surface-400">
					Esta escala já possui uma <strong>assinatura digital</strong> válida. Ao editá-la, a
					assinatura atual será
					<span class="text-error-500 font-bold underline">revogada</span> (removida).
				</p>
				<p class="text-surface-600 dark:text-surface-400 text-sm">
					Se você deseja apenas visualizar a escala oficial, utilize a opção <strong
						>Exportar</strong
					> ou clique no título da escala.
				</p>
			</div>
		{/snippet}

		{#snippet footer()}
			<button
				type="button"
				class="btn preset-filled-error-500 flex items-center gap-2 transition-all"
				onclick={confirmarRevogacao}
				disabled={pendingRevogar}
			>
				{pendingRevogar ? 'Revogando...' : 'Revogar e Editar'}
			</button>
		{/snippet}
	</ModalShell>

	<div class="card-glass p-4 rounded-3xl overflow-hidden mt-4">
		<div class="{CLASSE_CAIXA_FILTRO} mb-6 grid grid-cols-12 gap-3 sm:gap-4 items-end">
			{#if isAdmin}
				<div class="flex flex-col gap-1.5 col-span-12 lg:col-span-3">
					<span class={CLASSE_ROTULO_FILTRO}>Seccional</span>
					<SearchableSelect
						options={seccionaisOptions}
						bind:value={filtroSeccional}
						ariaLabel="Filtrar por seccional"
						placeholder="Todas as Seccionais"
						class={CLASSE_INPUT_SEARCHABLE}
					/>
				</div>
				<div class="flex flex-col gap-1.5 col-span-12 lg:col-span-3">
					<span class={CLASSE_ROTULO_FILTRO}>Unidade de Lotação</span>
					<SearchableSelect
						options={unidadesOptions}
						bind:value={filtroLotacao}
						ariaLabel="Filtrar por unidade de lotação"
						placeholder="Selecione uma unidade..."
						class={CLASSE_INPUT_SEARCHABLE}
					/>
				</div>
			{:else if isAdminSeccional}
				<div class="flex flex-col gap-1.5 col-span-12 lg:col-span-6">
					<span class={CLASSE_ROTULO_FILTRO}>Unidade de Lotação</span>
					<SearchableSelect
						options={unidadesDaSeccionalOptions}
						bind:value={filtroLotacao}
						ariaLabel="Filtrar por unidade de lotação"
						placeholder="Todas as unidades"
						class={CLASSE_INPUT_SEARCHABLE}
					/>
				</div>
			{/if}

			<div
				class="flex flex-col gap-1.5 col-span-12 {isAdmin || isAdminSeccional
					? 'lg:col-span-2'
					: 'lg:col-span-6'}"
			>
				<span class={CLASSE_ROTULO_FILTRO}>Tipo</span>
				<SearchableSelect
					options={tiposOptions}
					bind:value={filtroTipo}
					ariaLabel="Filtrar por tipo de escala"
					placeholder="Todos"
					class={CLASSE_INPUT_SEARCHABLE}
				/>
			</div>

			<div
				class="flex flex-col gap-1.5 col-span-12 xs:col-span-6 {isAdmin || isAdminSeccional
					? 'lg:col-span-2'
					: 'lg:col-span-4'}"
			>
				<span class={CLASSE_ROTULO_FILTRO}>Mês</span>
				<SearchableSelect
					options={mesesOptions}
					bind:value={filtroMes}
					ariaLabel="Filtrar por mês"
					placeholder="Todos"
					class={CLASSE_INPUT_SEARCHABLE}
				/>
			</div>

			<div class="flex flex-col gap-1.5 col-span-12 xs:col-span-6 lg:col-span-2">
				<span class={CLASSE_ROTULO_FILTRO}>Ano</span>
				<SearchableSelect
					options={anosOptions}
					bind:value={filtroAno}
					ariaLabel="Filtrar por ano"
					placeholder="Todos"
					class={CLASSE_INPUT_SEARCHABLE}
				/>
			</div>
		</div>

		<TabelaEscalas
			escalas={escalasVisiveis}
			{podeOIPSolicitar}
			{solicitacoesMap}
			{paginaAtual}
			{totalPaginas}
			onSolicitarEdicao={solicitarEdicao}
			onSolicitarExclusao={solicitarExclusao}
			onAbrirDialogSolicitar={abrirDialogSolicitar}
			onCancelarSolicitacao={cancelarSolicitacao}
			onNovaEscala={() => (dialogNovaEscalaAberto = true)}
			onPageChange={filtros.irParaPagina}
		/>
	</div>
{:else if visao === 'assinaturas'}
	<SecaoAssinaturas
		{escalasParaAssinar}
		{assinaturaTelaBloqueada}
		{isMobile}
		onIniciarAssinaturaTela={iniciarAssinaturaTela}
		onIniciarAssinaturaToken={iniciarAssinaturaToken}
		onVoltar={() => {
			visao = 'home';
			goto('/escalas', { replaceState: true, noScroll: true });
		}}
	/>
{/if}

<div class="sr-only" aria-hidden="true">
	<PainelAssinaturaToken
		bind:control={painelTokenRapidoControl}
		signerName={usuarioLogado?.nome ?? ''}
		signerCpf={usuarioLogado?.cpf ?? ''}
		prepararUrl="/api/escalas/{escalaAssinandoId}/preparar-assinatura"
		finalizarUrl="/api/escalas/{escalaAssinandoId}/finalizar-assinatura"
		nomeArquivo="escala_assinada.pdf"
		onSuccess={async () => {
			escalaAssinandoId = null;
			await invalidateShared('app:escalas');
		}}
	/>
</div>

<ModalShell
	bind:open={dialogRevogarSolicitacaoOpen}
	title="Cancelar solicitação?"
	largura="sm"
	pending={loading.active}
	onOpenChange={(open) => {
		if (!open) {
			escalaAbrirComSolicitacao = null;
		}
	}}
>
	{#snippet description()}
		<span class="text-sm">
			Esta escala possui uma solicitação de assinatura pendente. Ao abri-la para edição, a
			solicitação será cancelada automaticamente.
		</span>
	{/snippet}

	<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
		<button
			type="button"
			class="btn preset-outlined-surface-500"
			onclick={() => {
				dialogRevogarSolicitacaoOpen = false;
				escalaAbrirComSolicitacao = null;
			}}>Voltar</button
		>
		<button
			type="button"
			class="btn preset-filled-warning-500 font-bold transition-all"
			onclick={async () => {
				const id = escalaAbrirComSolicitacao!;
				dialogRevogarSolicitacaoOpen = false;
				escalaAbrirComSolicitacao = null;
				await cancelarSolicitacao(id);
				goto(`/escalas/${id}`);
			}}>Cancelar e Abrir</button
		>
	</div>
</ModalShell>

<DialogSolicitarAssinatura
	bind:open={dialogSolicitar}
	escalaId={escalaSolicitandoId}
	onConfirmado={async () => {
		escalaSolicitandoId = null;
		// Invalidação segmentada: refaz só o load da listagem (depends em
		// /escalas/+page.server.ts), não o layout inteiro.
		await invalidateShared('app:escalas');
	}}
/>

<ModalAssinaturaAvancada
	bind:open={dialogAssinaturaTela}
	message="Assinatura do Organizador"
	descricaoAssinatura="Confirme para assinar este documento."
	exigirFoto={page.data.exigirFotoAssinatura ?? true}
	exigirGps={page.data.exigirGpsAssinatura ?? true}
	exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
	cpfUsuario={usuarioLogado?.cpf ?? null}
	onConfirm={async (p: SignaturePadConfirmPayload) => {
		await assinaturaRapida.assinarSimples(
			p.lat,
			p.lng,
			p.selfie,
			p.codigoEmail,
			p.desafioId,
			p.liveness,
			p.reauthId
		);
	}}
	onCancel={() => (dialogAssinaturaTela = false)}
	onAssinarToken={avancadaDesktopDisponivel ? assinarComTokenNoModal : null}
	tokenDisabled={assinaturaRapida.assinandoSimples}
	pending={assinaturaRapida.assinandoSimples}
	largura="lg"
	camada="base"
	familia="escalas"
	padding="padrao"
/>

<ModalNovaEscala
	bind:open={dialogNovaEscalaAberto}
	{isAdmin}
	{lotacaoUsuario}
	{unidades}
	escalasExistentes={data.escalasExistentes}
	oncriado={(id) => goto(`/escalas/${id}`)}
	onfechar={() => {}}
/>

<FloatingRefresh chaves="app:escalas" />
