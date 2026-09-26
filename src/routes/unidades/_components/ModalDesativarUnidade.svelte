<script lang="ts">
	/**
	 * Confirmação de DESATIVAR ou REATIVAR uma unidade.
	 *
	 * Não existe modal de excluir porque não existe exclusão de unidade: a linha
	 * é referenciada por `gise_assinaturas_relatorios` e apagá-la destruiria o
	 * registro de um documento já assinado. Desativar é o equivalente seguro — e
	 * o texto abaixo diz exatamente o que acontece, para o Super Admin não achar
	 * que "desativar" é um eufemismo para apagar.
	 */
	import { enhance } from '$app/forms';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { toaster } from '$lib/toast';
	import type { ActionResult } from '@sveltejs/kit';
	import RecusaDaEstrutura from './RecusaDaEstrutura.svelte';

	let {
		open = $bindable(false),
		unidade
	}: {
		open: boolean;
		unidade: { id: number; nome: string; ativo: boolean } | null;
	} = $props();

	let pending = $state(false);
	/** A recusa da trava (E73), com os passos — some ao fechar a janela. */
	let recusa = $state<string | null>(null);
	$effect(() => {
		if (!open) recusa = null;
	});

	/** Reativar quando está desativada; desativar quando está ativa. */
	const reativando = $derived(unidade ? !unidade.ativo : false);

	function handleSubmit() {
		pending = true;
		recusa = null;
		return async ({ result }: { result: ActionResult }) => {
			pending = false;
			if (result.type === 'success') {
				await invalidateShared('app:unidades');
				toaster.create({
					title: reativando
						? `Unidade "${unidade?.nome}" reativada`
						: `Unidade "${unidade?.nome}" desativada`,
					description: reativando
						? 'Voltou a aparecer nas listas de escolha.'
						: 'Some das listas de escolha; os registros existentes seguem intactos.',
					type: 'success'
				});
				open = false;
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				recusa = String(d?.error || 'Erro ao alterar a unidade');
			}
		};
	}
</script>

<ModalShell
	bind:open
	title={reativando ? 'Reativar unidade?' : 'Desativar unidade?'}
	largura="md"
	{pending}
	cancelLabel="Cancelar"
>
	{#snippet description()}
		{#if reativando}
			"{unidade?.nome}" volta a aparecer nas listas de escolha (nova escala, lotação de servidor,
			seccional de GISE).
		{:else}
			"{unidade?.nome}" deixa de aparecer nas listas de escolha — não será mais possível criar
			escala, lotar servidor ou montar GISE nela.
		{/if}
	{/snippet}

	{#if recusa}
		<RecusaDaEstrutura texto={recusa} />
	{/if}

	{#if !reativando}
		<div
			class="rounded-xl bg-surface-200/50 dark:bg-surface-700/30 border border-surface-300 dark:border-surface-600 p-3 mb-6 text-xs text-surface-700 dark:text-surface-300 space-y-1.5"
		>
			<p class="font-semibold">Nada é apagado.</p>
			<p>
				Escalas e assinaturas já existentes continuam valendo, e a unidade pode ser reativada a
				qualquer momento.
			</p>
			<p>
				Mas só se desativa uma unidade <strong>sem ninguém dependendo dela</strong>: sem servidor
				lotado ou trabalhando nela, e sem unidade ativa abaixo dela. Se houver, o sistema recusa e
				diz o que fazer antes.
			</p>
			<p>
				Unidade <strong>nunca é excluída</strong> do sistema: a linha é referenciada pelos registros de
				assinatura dos relatórios de GISE, e apagá-la destruiria a prova desses documentos.
			</p>
		</div>
	{/if}

	{#snippet footer()}
		<form method="POST" action="?/definirAtivo" use:enhance={handleSubmit} class="contents">
			<input type="hidden" name="unidade_id" value={unidade?.id} />
			<input type="hidden" name="ativo" value={reativando ? 'true' : 'false'} />
			<button
				type="submit"
				class="btn {reativando
					? 'preset-filled-success-500'
					: 'preset-filled-warning-500'} flex items-center gap-2 transition-all"
				disabled={pending}
			>
				{#if pending}
					{reativando ? 'Reativando...' : 'Desativando...'}
				{:else}
					{reativando ? 'Reativar' : 'Desativar'}
				{/if}
			</button>
		</form>
	{/snippet}
</ModalShell>
