<script lang="ts">
	import FaixaDesfalques from '$lib/components/FaixaDesfalques.svelte';
	/**
	 * Tela de UMA ESCALA — cabeçalho, servidores escalados e o painel de
	 * assinatura. A composição da lista muda com o tipo:
	 *
	 * - `fds` → `ListaFds`, agrupada por DIA;
	 * - `plantao` → `TabelaPlantao`, uma linha por policial com os dias em que
	 *   ele serve;
	 * - `expediente` → `TabelaServidores`, sem datas (expediente não tem dia de
	 *   plantão, só regime).
	 *
	 * Lista vazia tem estado próprio antes dessa escolha — escala recém-criada é
	 * o caso comum, não erro.
	 *
	 * Vários estados são DERIVADOS GRAVÁVEIS (`finalizadaEm`,
	 * `documentoAssinadoInfo`, `solicitacaoAtual`, `policiaisEscalaLocal`):
	 * espelham o `load` e voltam a espelhá-lo no próximo invalidate, mas aceitam
	 * atualização otimista no meio. Finalizar, solicitar assinatura e editar uma
	 * linha precisam de resposta imediata — esperar o round-trip para repintar
	 * fazia a tela parecer travada em conexão de campo.
	 *
	 * O estado que trava a edição é `documentoAssinadoExiste` + `finalizadaEm`:
	 * escala assinada é documento, e alterá-la invalidaria a assinatura já
	 * gravada no PDF.
	 */
	import type { PageProps } from './$types';
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { mostrarErroDeResultado } from '$lib/enhance-handler';
	import { intervaloDeDatas } from '$lib/utils/datas';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { apiFetch } from '$lib/api-fetch';
	import type { ActionResult } from '@sveltejs/kit';
	import type { EscalaPolicialComDados } from '$lib/types';
	import PainelAssinaturaEscala from '$lib/components/PainelAssinaturaEscala.svelte';
	import EstadoVazio from '$lib/components/EstadoVazio.svelte';
	import { useConfirmationDialog, useInvalidateOnFocus } from '$lib/composables';
	import { fetchSyncEstado } from '$lib/sync-estado';
	import ModalConfirmar from './_components/ModalConfirmar.svelte';
	import EscalaCabecalho from './_components/EscalaCabecalho.svelte';
	import FormAdicionarServidores from './_components/FormAdicionarServidores.svelte';
	import ToolbarSelecao from './_components/ToolbarSelecao.svelte';
	import ListaFds from './_components/ListaFds.svelte';
	import TabelaServidores from './_components/TabelaServidores.svelte';
	import TabelaPlantao from './_components/TabelaPlantao.svelte';
	import { mensagemDeErro } from '$lib/utils/erro';

	const { data }: PageProps = $props();

	const confirmDialog = useConfirmationDialog<{ itemId: number | number[]; nome: string }>();

	const escala = $derived(data.escala);
	// Id estável nesta instância de rota (não muda sem remount).
	const escalaIdPagina = untrack(() => data.escalaId);

	// Derivados graváveis: espelham o load, mas admitem as atualizações
	// otimistas locais (finalizar/solicitar) até o próximo invalidate.
	let finalizadaEm: string | null = $derived(data.escala?.finalizada_em ?? null);
	const emailEnvioInicial = $derived(data.escala?.email_envio ?? null);
	let solicitacaoAtual: { tipo: string; destinatario_id?: number } | null = $derived(
		data.solicitacaoAtual ?? null
	);
	let documentoAssinadoInfo = $derived(
		data.documentoAssinadoInfo
			? {
					existe: data.documentoAssinadoInfo.existe,
					assinante_nome: data.documentoAssinadoInfo.assinante_nome,
					assinante_cpf: data.documentoAssinadoInfo.assinante_cpf ?? undefined,
					data: data.documentoAssinadoInfo.data ?? undefined
				}
			: null
	);

	useInvalidateOnFocus(`escala:${escalaIdPagina}`, {
		isHot: () => !documentoAssinadoInfo?.existe && !finalizadaEm,
		probe: async () => {
			try {
				const e = await fetchSyncEstado({ escalaId: escalaIdPagina });
				return e.escala?.stamp ?? null;
			} catch {
				return null;
			}
		}
	});

	// Derivado gravável: espelha o load, mas admite a remoção otimista local.
	let policiaisEscalaLocal: EscalaPolicialComDados[] = $derived(
		data.policiaisEscala as EscalaPolicialComDados[]
	);

	const isFDS = $derived(escala?.tipo === 'fds');
	const isExpediente = $derived(escala?.tipo === 'expediente');

	// Permissão de EDIÇÃO da escala (mutar servidores/finalizar), vinda do load —
	// e é a MESMA que as actions aplicam (`podeMexerNaEscala`). Admin Geral em
	// qualquer escala, ou o policial COM papel administrativo na sua lotação. Um
	// admin_seccional que apenas VISUALIZA a escala de uma unidade não vê os
	// controles de edição — mas continua podendo ASSINAR (o painel de assinatura
	// tem regra própria).
	//
	// Havia aqui um segundo `podeEditar`, mais estrito, que recalculava a regra e
	// era usado em UM dos sete pontos de edição; os outros seis recebiam a flag
	// larga. A regra estava certa e escrita — o que faltava era ser a mesma nos
	// sete lugares e no servidor (FLW-ESC-001). Agora desce pronta do load, e não
	// há segunda versão para divergir.
	const podeEditarEscala = $derived(data.podeEditarEscala);

	// Viewers (sem permissão de edição) começam fora do modo de edição.
	// Captura só o valor inicial do load (o toggle é mutável a partir daí).
	let modoEdicao = $state(untrack(() => data.podeEditarEscala));

	// diasEscalaLocal para FormAdicionarServidores (non-FDS pages — sem ModalEditarDias)
	const diasEscalaLocal = $derived.by(() => {
		if (!escala) return [];
		return intervaloDeDatas(escala.data_inicio, escala.data_fim);
	});

	function solicitarRemocao(itemId: number | number[], nome: string) {
		confirmDialog.openDialog({ itemId, nome });
	}

	function handleRemover() {
		const itemNome = confirmDialog.currentItem?.nome;
		const itemId = confirmDialog.currentItem?.itemId;
		const backup = [...policiaisEscalaLocal];
		if (Array.isArray(itemId)) {
			policiaisEscalaLocal = policiaisEscalaLocal.filter((p) => !itemId.includes(p.id));
		} else {
			policiaisEscalaLocal = policiaisEscalaLocal.filter((p) => p.id !== itemId);
		}
		confirmDialog.closeDialog();
		return async ({ result }: { result: ActionResult }) => {
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data?.policiais;
				toaster.create({ title: `${itemNome} removido da escala`, type: 'success' });
			} else {
				policiaisEscalaLocal = backup;
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
		};
	}

	let confirmFinalizarEdicaoOpen = $state(false);
	let enviandoSolicitacao = $state(false);

	async function confirmarFinalizarEdicao() {
		if (enviandoSolicitacao) return;
		enviandoSolicitacao = true;
		try {
			await apiFetch(`/api/escalas/${data.escalaId}/solicitar-assinatura`, {
				method: 'POST',
				body: JSON.stringify({ tipo: 'unidade' })
			});
			toaster.create({ title: 'Edição finalizada e solicitação enviada!', type: 'success' });
			solicitacaoAtual = { tipo: 'unidade' };
			modoEdicao = false;
			confirmFinalizarEdicaoOpen = false;
			await invalidateShared(`escala:${escalaIdPagina}`, 'app:escalas');
		} catch (e: unknown) {
			toaster.create({
				title: mensagemDeErro(e, 'Erro ao solicitar assinatura'),
				type: 'error'
			});
		} finally {
			enviandoSolicitacao = false;
		}
	}

	function handleConfirmarFinalizacao() {
		if (page.data.usuario?.cargo === 'DPC') {
			modoEdicao = false;
			confirmFinalizarEdicaoOpen = false;
		} else {
			confirmarFinalizarEdicao();
		}
	}

	let modoSelecao = $state(false);
	// eslint-disable-next-line svelte/no-unnecessary-state-wrap
	let selecionados = $state(new SvelteSet<number>());
	let pendingRemoverTodos = $state(false);
	let pendingRemoverSelecionados = $state(false);
	let confirmRemoverTodosOpen = $state(false);
	let confirmRemoverSelecionadosOpen = $state(false);

	const selecionadosJson = $derived(JSON.stringify(Array.from(selecionados)));
	const totalSelecionados = $derived(selecionados.size);

	function toggleSelecionar(id: number) {
		if (selecionados.has(id)) selecionados.delete(id);
		else selecionados.add(id);
	}

	function cancelarSelecao() {
		modoSelecao = false;
		selecionados.clear();
	}

	function handleRemoverTodos() {
		pendingRemoverTodos = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingRemoverTodos = false;
			confirmRemoverTodosOpen = false;
			if (result.type === 'success') {
				policiaisEscalaLocal = [];
				toaster.create({ title: 'Todos os servidores removidos da escala', type: 'success' });
			} else {
				mostrarErroDeResultado(result, 'Erro ao remover');
			}
		};
	}

	function handleRemoverSelecionados() {
		pendingRemoverSelecionados = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingRemoverSelecionados = false;
			confirmRemoverSelecionadosOpen = false;
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data?.policiais;
				selecionados.clear();
				modoSelecao = false;
				const removidos = result.data?.removidos ?? 0;
				toaster.create({
					title: `${removidos} servidor(es) removido(s) da escala`,
					type: 'success'
				});
			} else {
				mostrarErroDeResultado(result, 'Erro ao remover');
			}
		};
	}
</script>

<svelte:head>
	<title>Escala | Ecossistema PCCE</title>
</svelte:head>

{#if !escala}
	<EstadoVazio mensagem="Escala não encontrada." />
{:else}
	<EscalaCabecalho
		{escala}
		{isFDS}
		{isExpediente}
		podeEditar={podeEditarEscala}
		documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
		{finalizadaEm}
		{solicitacaoAtual}
		bind:modoEdicao
		onFinalizarEdicao={() => (confirmFinalizarEdicaoOpen = true)}
	/>

	<FaixaDesfalques desfalques={data.desfalques} />

	<PainelAssinaturaEscala
		escalaId={String(data.escalaId)}
		{isFDS}
		policiaisCount={policiaisEscalaLocal.length}
		usuario={page.data.usuario}
		{podeEditarEscala}
		bind:documentoAssinadoInfo
		bind:finalizadaEm
		{emailEnvioInicial}
		podeOIPSolicitar={data.podeOIPSolicitar}
		{solicitacaoAtual}
		onSolicitacaoEnviada={() => {
			solicitacaoAtual = { tipo: 'unidade' };
			modoEdicao = false;
		}}
	/>

	<ModalConfirmar bind:open={confirmDialog.isOpen} title="Remover Policial?">
		{#snippet description()}
			Tem certeza que deseja remover o policial "{confirmDialog.currentItem?.nome}" desta escala?
		{/snippet}
		{#snippet actions()}
			{#if Array.isArray(confirmDialog.currentItem?.itemId)}
				<form
					method="POST"
					action="?/removerSelecionados"
					use:enhance={handleRemover}
					class="contents"
				>
					<input
						type="hidden"
						name="ids"
						value={JSON.stringify(confirmDialog.currentItem?.itemId)}
					/>
					<button type="submit" class="btn preset-filled-error-500 transition-all">
						Remover
					</button>
				</form>
			{:else}
				<form method="POST" action="?/remover" use:enhance={handleRemover} class="contents">
					<input type="hidden" name="item_id" value={confirmDialog.currentItem?.itemId} />
					<button type="submit" class="btn preset-filled-error-500 transition-all">
						Remover
					</button>
				</form>
			{/if}
		{/snippet}
	</ModalConfirmar>

	<ModalConfirmar bind:open={confirmRemoverTodosOpen} title="Remover Todos?">
		{#snippet description()}
			Tem certeza que deseja remover <strong
				>todos os {policiaisEscalaLocal.length} servidores</strong
			>
			desta escala? Esta ação não pode ser desfeita.
		{/snippet}
		{#snippet actions()}
			<form method="POST" action="?/removerTodos" use:enhance={handleRemoverTodos} class="contents">
				<button
					type="submit"
					class="btn preset-filled-error-500 transition-all"
					disabled={pendingRemoverTodos}
				>
					{pendingRemoverTodos ? 'Removendo...' : 'Remover Todos'}
				</button>
			</form>
		{/snippet}
	</ModalConfirmar>

	<ModalConfirmar bind:open={confirmRemoverSelecionadosOpen} title="Remover Selecionados?">
		{#snippet description()}
			Tem certeza que deseja remover os <strong
				>{totalSelecionados} servidor(es) selecionado(s)</strong
			>
			desta escala?
		{/snippet}
		{#snippet actions()}
			<form
				method="POST"
				action="?/removerSelecionados"
				use:enhance={handleRemoverSelecionados}
				class="contents"
			>
				<input type="hidden" name="ids" value={selecionadosJson} />
				<button
					type="submit"
					class="btn preset-filled-error-500 transition-all"
					disabled={pendingRemoverSelecionados}
				>
					{pendingRemoverSelecionados ? 'Removendo...' : `Remover (${totalSelecionados})`}
				</button>
			</form>
		{/snippet}
	</ModalConfirmar>

	<ModalConfirmar bind:open={confirmFinalizarEdicaoOpen} title="Finalizar Edição?">
		{#snippet description()}
			{#if page.data.usuario?.cargo === 'DPC'}
				Tem certeza que deseja finalizar a edição desta escala?
			{:else}
				Tem certeza que deseja finalizar a edição desta escala? A assinatura do delegado seccional
				(DPC) será solicitada automaticamente.
			{/if}
		{/snippet}
		{#snippet actions()}
			<button
				type="button"
				class="btn preset-filled-primary-500 transition-all"
				onclick={handleConfirmarFinalizacao}
				disabled={enviandoSolicitacao}
			>
				{enviandoSolicitacao ? 'Enviando...' : 'Confirmar'}
			</button>
		{/snippet}
	</ModalConfirmar>

	<FormAdicionarServidores
		{escala}
		{isExpediente}
		{diasEscalaLocal}
		{modoEdicao}
		{podeEditarEscala}
		documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
		{finalizadaEm}
		{solicitacaoAtual}
		{policiaisEscalaLocal}
		onPoliciaisAtualizados={(p) => (policiaisEscalaLocal = p)}
	/>

	<div class="flex items-center gap-3 my-6">
		<hr class="flex-1 border-surface-200 dark:border-white/10" />
		<span
			class="text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider"
			>Servidores na Escala</span
		>
		<hr class="flex-1 border-surface-200 dark:border-white/10" />
	</div>

	{#if policiaisEscalaLocal.length > 0 && !documentoAssinadoInfo?.existe && !finalizadaEm && podeEditarEscala}
		<ToolbarSelecao
			{totalSelecionados}
			{modoSelecao}
			{pendingRemoverSelecionados}
			onSelecionarTodos={() => {
				selecionados.clear();
				for (const p of policiaisEscalaLocal) selecionados.add(p.id);
			}}
			onRemoverSelecionados={() => (confirmRemoverSelecionadosOpen = true)}
			onRemoverTodos={() => (confirmRemoverTodosOpen = true)}
			onIniciarSelecao={() => (modoSelecao = true)}
			onCancelarSelecao={cancelarSelecao}
		/>
	{/if}

	{#if isFDS}
		<ListaFds
			bind:policiaisEscalaLocal
			{modoEdicao}
			{podeEditarEscala}
			documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
			{finalizadaEm}
			{solicitacaoAtual}
			{modoSelecao}
			bind:selecionados
			{escala}
			onToggleSelecionar={toggleSelecionar}
			onSolicitarRemocao={solicitarRemocao}
		/>
	{:else if policiaisEscalaLocal.length === 0}
		<EstadoVazio mensagem="Nenhum policial nesta escala ainda." />
	{:else if !isExpediente && !isFDS}
		<TabelaPlantao
			bind:policiaisEscalaLocal
			{podeEditarEscala}
			documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
			{finalizadaEm}
			{modoSelecao}
			bind:selecionados
			{escala}
			onSolicitarRemocao={solicitarRemocao}
		/>
	{:else}
		<TabelaServidores
			bind:policiaisEscalaLocal
			{isExpediente}
			{isFDS}
			{podeEditarEscala}
			documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
			{finalizadaEm}
			{modoSelecao}
			bind:selecionados
			{escala}
			onSolicitarRemocao={solicitarRemocao}
			onToggleSelecionar={toggleSelecionar}
		/>
	{/if}
{/if}
