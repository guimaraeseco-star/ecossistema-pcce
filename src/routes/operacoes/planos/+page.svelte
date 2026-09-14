<script lang="ts">
	/**
	 * Lista dos planos operacionais (Admin Geral).
	 *
	 * Tela de aba: sem botão "voltar" no topo, pela mesma regra de
	 * `/operacoes/gise/operacoes` — voltar existe em tela de DETALHE, alcançada de dentro
	 * de outra.
	 *
	 * A linha mostra número/ano, nome, data e quantas equipes o plano tem. O
	 * número é o que o documento carrega na capa ("PLANO OPERACIONAL 123/2026"),
	 * então é por ele que alguém com o PDF na mão encontra o registro.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import EstadoVazio from '$lib/components/EstadoVazio.svelte';
	import { useConfirmationDialog } from '$lib/composables';
	import { fmtDate } from '$lib/gise/formatters';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import FileText from '@lucide/svelte/icons/file-text';

	const { data }: PageProps = $props();

	const confirmExcluir = useConfirmationDialog<{ id: number; rotulo: string }>();

	function enviar(mensagemOk: string, aoConcluir?: () => void) {
		return () => {
			loading.show('A gravar…');
			return async ({ result }: { result: { type: string; data?: unknown } }) => {
				loading.hide();
				if (result.type === 'success') {
					toaster.success({ title: mensagemOk });
					await invalidate('app:planos');
					aoConcluir?.();
				} else if (result.type === 'failure') {
					const err = (result.data as { error?: string } | undefined)?.error;
					toaster.error({ title: err || 'Não foi possível gravar' });
				}
			};
		};
	}
</script>

<svelte:head><title>Planos operacionais | Ecossistema PCCE</title></svelte:head>

<div class="min-w-0 space-y-6 px-1">
	<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
		<div class="min-w-0">
			<h1 class="h1 text-2xl font-bold">Planos operacionais</h1>
			<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
				Operações com deslocamento de equipes. Cada plano gera o documento com Anexo I (equipes) e
				Anexo II (custos).
			</p>
		</div>
		<a
			href="/operacoes/planos/novo"
			class="btn btn-sm preset-filled-primary-500 px-3.5 py-2 rounded-xl font-semibold shrink-0 w-full sm:w-auto"
		>
			<Plus class="w-4 h-4" />
			Novo plano
		</a>
	</div>

	<!-- Sem `card-elevated`: a folha do layout já é o cartão da página, e cada
	     plano da lista já é um cartão com contorno. Envolver a lista num terceiro
	     desenha cartão dentro de cartão dentro de cartão. -->
	<section class="min-w-0 space-y-3">
		{#if data.planos.length === 0}
			<EstadoVazio
				mensagem="Nenhum plano operacional"
				descricao="Cada plano criado aparece aqui com o número que sai impresso na capa do documento."
			/>
		{:else}
			<ul class="grid grid-cols-1 gap-3 lg:grid-cols-2">
				{#each data.planos as p (p.id)}
					<li class="card-quadro min-w-0 h-full rounded-2xl p-4 sm:p-5">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<h2 class="font-semibold text-surface-900 dark:text-white truncate">
										{p.nome}
									</h2>
									<span
										class="rounded-full bg-primary-500/15 px-2 py-0.5 font-mono text-2xs font-semibold text-primary-700 dark:text-primary-300"
									>
										{p.numero}/{p.ano}
									</span>
									{#if p.status === 'concluido'}
										<span
											class="rounded-full bg-success-500/15 px-2 py-0.5 text-2xs font-medium text-success-700 dark:text-success-400"
											>concluído</span
										>
									{:else}
										<span
											class="rounded-full bg-warning-500/15 px-2 py-0.5 text-2xs font-medium text-warning-700 dark:text-warning-400"
											>rascunho</span
										>
									{/if}
								</div>
								<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
									{fmtDate(p.data_inicio)} às {p.hora_inicio}
									{#if p.nup}· NUP {p.nup}{/if}
									· {p.equipes}
									{p.equipes === 1 ? 'equipe' : 'equipes'}
								</p>
							</div>

							<div
								class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end"
							>
								<a
									href="/operacoes/planos/{p.id}"
									class="btn btn-sm preset-outlined-surface-500 px-2.5 py-1.5 rounded-xl text-xs whitespace-nowrap w-full min-w-0 justify-center sm:w-auto"
								>
									<FileText class="w-3.5 h-3.5" />
									Abrir
								</a>
								<button
									type="button"
									class="btn btn-sm preset-filled-error-500 px-2.5 py-1.5 rounded-xl text-xs whitespace-nowrap w-full min-w-0 justify-center sm:w-auto"
									onclick={() =>
										confirmExcluir.openDialog({ id: p.id, rotulo: `${p.numero}/${p.ano}` })}
								>
									<Trash2 class="w-3.5 h-3.5" />
									Excluir
								</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<ModalShell
	bind:open={confirmExcluir.isOpen}
	title="Excluir plano operacional?"
	largura="sm"
	pending={loading.active}
	cancelLabel="Cancelar"
>
	{#snippet description()}
		O plano <strong>{confirmExcluir.currentItem?.rotulo}</strong>, as equipes e o efetivo alocado
		serão apagados, e não há como desfazer. O número
		<strong>não</strong> volta a ser usado — se o documento já circulou impresso, dois planos com o mesmo
		número seriam indistinguíveis.
	{/snippet}

	{#snippet footer()}
		<form
			method="POST"
			action="?/excluir"
			use:enhance={enviar('Plano excluído', () => confirmExcluir.closeDialog())}
			class="contents"
		>
			<input type="hidden" name="id" value={confirmExcluir.currentItem?.id} />
			<button
				type="submit"
				class="btn btn-sm preset-filled-error-500 flex items-center gap-2"
				disabled={loading.active}
			>
				<Trash2 class="w-4 h-4" />
				Excluir plano
			</button>
		</form>
	{/snippet}
</ModalShell>
