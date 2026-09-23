<script lang="ts">
	/**
	 * Quem administra o quê (E65) — a tela do Super Admin.
	 *
	 * Uma linha por conta administrativa, com o NÓ que ela administra em
	 * destaque: é o dado que decide o alcance de tudo o que ela faz. Conta sem
	 * nó aparece marcada, porque "não opera" é resposta, não falta de dado — e
	 * é o que explica um administrador que não consegue entrar.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import { invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { buscarPoliciaisOptions } from '$lib/busca-policiais';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';

	const { data }: PageProps = $props();

	let policialId = $state<number | null>(null);
	let noNovo = $state('');
	let enviando = $state(false);

	const buscarServidores = buscarPoliciaisOptions({ cargo: '', valorNumerico: true });

	/** Só o nó do DPI SUL existe hoje; a lista já aceita mais de um. */
	const nos = $derived(data.nos);

	function aoEnviar(mensagem: string) {
		enviando = true;
		return async ({ result }: { result: ActionResult }) => {
			enviando = false;
			if (result.type === 'success') {
				toaster.create({ title: mensagem, type: 'success' });
				policialId = null;
				noNovo = '';
				await invalidateAll();
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error ?? 'Não foi possível concluir'), type: 'error' });
			}
		};
	}
</script>

<svelte:head><title>Administradores · Ecossistema PCCE</title></svelte:head>

<div class="mb-4">
	<BotaoVoltar />
	<p class="text-2xs font-bold tracking-[0.18em] text-primary-600 uppercase dark:text-primary-400">
		Ecossistema PCCE
	</p>
	<h1 class="h1 mt-0.5 text-2xl font-bold">Administradores</h1>
	<p class="mt-1 text-sm text-surface-600 dark:text-surface-400">
		Cada conta administra um <b>nó da árvore</b> e tudo o que está abaixo dele. Conta sem nó não opera
		— entra no sistema e não alcança unidade nenhuma.
	</p>
</div>

<section class="card-elevated mb-4 rounded-2xl p-5" aria-labelledby="promover">
	<h2 id="promover" class="mb-3 text-base font-semibold text-surface-900 dark:text-surface-50">
		Promover um servidor
	</h2>
	<form method="POST" action="?/promover" use:enhance={() => aoEnviar('Administrador promovido')}>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<label class="label">
				<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Servidor</span>
				<SearchableSelect
					name="policial_id"
					bind:value={policialId}
					loadOptions={buscarServidores}
					placeholder="Digite para buscar..."
					class="h-9 w-full"
				/>
			</label>
			<label class="label">
				<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">
					Nó que ele administra
				</span>
				<select class="select px-3 py-1 text-sm" name="unidade_id" bind:value={noNovo} required>
					<option value="" disabled>— Escolha —</option>
					{#each nos as n (n.id)}
						<option value={n.id}>{n.nome} ({n.tipoRotulo})</option>
					{/each}
				</select>
			</label>
		</div>
		<div class="mt-3 flex justify-end">
			<button
				type="submit"
				class="btn btn-sm preset-filled-primary-500 disabled:opacity-40"
				disabled={enviando || !policialId || !noNovo}
			>
				{enviando ? 'Enviando...' : 'Promover'}
			</button>
		</div>
	</form>
</section>

<section class="card-elevated rounded-2xl p-5" aria-labelledby="contas">
	<div class="mb-3 flex items-baseline justify-between gap-3">
		<h2 id="contas" class="text-base font-semibold text-surface-900 dark:text-surface-50">
			Contas
		</h2>
		<span class="text-xs text-surface-500">{data.contas.length}</span>
	</div>
	<div class="table-wrap">
		<table class="table">
			<thead>
				<tr class="text-2xs">
					<th>Nome</th>
					<th>Login</th>
					<th>Administra</th>
					<th>Módulos</th>
					<th class="text-right">Ações</th>
				</tr>
			</thead>
			<tbody>
				{#each data.contas as c (c.id)}
					<tr>
						<td class="font-medium">
							{c.nome}
							{#if c.policial_id}
								<a
									href="/servidores/{c.policial_id}"
									class="block text-2xs text-surface-500 no-underline hover:underline"
									>ver a ficha</a
								>
							{:else}
								<span class="block text-2xs text-surface-500">conta sem servidor vinculado</span>
							{/if}
						</td>
						<td class="font-mono text-xs">{c.login}</td>
						<td class="text-sm">
							<form
								method="POST"
								action="?/definirNo"
								use:enhance={() => aoEnviar('Nó atualizado')}
								class="flex items-center gap-2"
							>
								<input type="hidden" name="admin_id" value={c.id} />
								<select
									class="select px-2 py-1 text-xs"
									name="unidade_id"
									value={c.unidade_id ?? ''}
									onchange={(e) => e.currentTarget.form?.requestSubmit()}
								>
									<option value="">— não opera —</option>
									{#each nos as n (n.id)}
										<option value={n.id}>{n.nome}</option>
									{/each}
								</select>
							</form>
							{#if c.unidade_id == null}
								<span
									class="mt-0.5 block text-2xs font-semibold text-warning-700 dark:text-warning-400"
									>Esta conta não alcança unidade nenhuma.</span
								>
							{/if}
						</td>
						<td class="text-xs">
							{[c.modulo_escalas && 'Escalas', c.modulo_gise && 'GISE']
								.filter(Boolean)
								.join(' · ') || '—'}
						</td>
						<td class="text-right">
							{#if c.policial_id}
								<form
									method="POST"
									action="?/rebaixar"
									use:enhance={() => aoEnviar('Acesso removido')}
								>
									<input type="hidden" name="policial_id" value={c.policial_id} />
									<button
										type="submit"
										class="text-2xs font-semibold text-error-600 dark:text-error-400"
										>Remover acesso</button
									>
								</form>
							{:else}
								<span class="text-2xs text-surface-400">conta de sistema</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
