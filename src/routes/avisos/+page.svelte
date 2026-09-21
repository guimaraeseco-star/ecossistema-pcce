<script lang="ts">
	/**
	 * A caixa de avisos (E59): pendências em cima (dourado, com o botão do lugar
	 * onde se resolvem), notícias embaixo (não lidas em destaque, lidas
	 * recolhidas). "Marcar todas como lidas" e o "✓" por linha vão à action e
	 * invalidam `app:avisos`, que é o que refaz os badges do layout.
	 */
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { PageProps } from './$types';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import { formatarData } from '$lib/utils/datas';

	const { data }: PageProps = $props();

	const naoLidos = $derived(data.avisos.filter((a) => !a.lido_em));
	const lidos = $derived(data.avisos.filter((a) => !!a.lido_em));

	/** `created_at` vem em horário local ("YYYY-MM-DD HH:MM:SS") ou ISO UTC. */
	function fmtDataHora(ts: string): string {
		return new Date(ts + (ts.includes('T') ? '' : 'Z')).toLocaleString('pt-BR', {
			dateStyle: 'short',
			timeStyle: 'short'
		});
	}

	const aoMarcar = () => {
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			await invalidate('app:avisos');
		};
	};
</script>

<svelte:head>
	<title>Avisos | Ecossistema PCCE</title>
</svelte:head>

<BemVindoPagina>
	<BotaoVoltar href="/" />
	<header class="mt-2 flex flex-wrap items-end justify-between gap-3">
		<div>
			<p
				class="text-2xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-400"
			>
				Ecossistema PCCE
			</p>
			<h1 class="h1 mt-0.5 text-2xl font-bold">Avisos</h1>
			<p class="mt-2 text-sm text-surface-600 dark:text-surface-400">
				O que depende de você e o que mudou. As pendências somem quando você resolve no lugar
				indicado; as notícias, quando você as marca como lidas.
			</p>
		</div>
		{#if naoLidos.length > 0}
			<form method="POST" action="?/marcarLidos" use:enhance={aoMarcar}>
				<input type="hidden" name="todos" value="1" />
				<button type="submit" class="btn btn-sm preset-outlined-surface-500"
					>Marcar todas como lidas</button
				>
			</form>
		{/if}
	</header>

	<!-- Pendências -->
	<section class="mt-6">
		<h2 class="text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase">
			Pendências · {data.pendencias.length}
		</h2>
		{#if data.pendencias.length === 0}
			<p class="mt-2 text-sm text-surface-500">Nada depende de você agora.</p>
		{:else}
			<ul class="mt-2 space-y-2">
				{#each data.pendencias as p (p.tipo)}
					<li
						class="flex flex-wrap items-center justify-between gap-3 rounded-xl border-l-4 border-warning-500 bg-warning-500/10 px-4 py-3"
					>
						<span class="text-sm font-semibold text-warning-800 dark:text-warning-300"
							>⚠ {p.titulo}</span
						>
						<a href={p.link} class="btn btn-sm preset-filled-warning-500">Resolver →</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Notícias -->
	<section class="mt-8">
		<h2 class="text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase">
			Notícias · {naoLidos.length} não lida{naoLidos.length === 1 ? '' : 's'}
		</h2>
		{#if naoLidos.length === 0}
			<p class="mt-2 text-sm text-surface-500">Nenhuma notícia nova.</p>
		{:else}
			<ul class="mt-2 space-y-2">
				{#each naoLidos as a (a.id)}
					<li
						class="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-primary-500/30 bg-primary-500/5 px-4 py-3"
					>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-semibold">{a.titulo}</p>
							{#if a.texto}
								<p class="mt-0.5 text-xs text-surface-700 dark:text-surface-300">{a.texto}</p>
							{/if}
							<p class="mt-1 text-2xs text-surface-500">
								{a.autor_nome || '—'} · {fmtDataHora(a.created_at)}
							</p>
						</div>
						<div class="flex gap-1">
							{#if a.link}
								<a href={a.link} class="btn btn-sm preset-outlined-surface-500">Ver onde →</a>
							{/if}
							<form method="POST" action="?/marcarLidos" use:enhance={aoMarcar}>
								<input type="hidden" name="id" value={a.id} />
								<button
									type="submit"
									class="btn btn-sm preset-filled-primary-500"
									title="Marcar como lida">✓ Lida</button
								>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if lidos.length > 0}
			<details class="mt-4">
				<summary class="cursor-pointer text-xs font-semibold text-surface-500"
					>Já lidas ({lidos.length})</summary
				>
				<ul class="mt-2 space-y-1">
					{#each lidos as a (a.id)}
						<li class="flex flex-wrap items-baseline justify-between gap-2 px-2 py-1 text-xs">
							<span class="text-surface-600 dark:text-surface-400">
								{a.titulo}{#if a.link}
									· <a href={a.link} class="underline">ver</a>{/if}
							</span>
							<span class="text-2xs text-surface-500">
								lida por {a.lido_por_nome || '—'} em {formatarData((a.lido_em ?? '').slice(0, 10))}
							</span>
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</section>
</BemVindoPagina>
