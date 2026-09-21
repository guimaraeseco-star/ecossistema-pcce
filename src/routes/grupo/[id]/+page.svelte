<script lang="ts">
	/**
	 * A tela de um grupo da home: cabeçalho com o nome do grupo e a grade dos
	 * cartões detalhados (`HomeCartaoModulo`). Grupo sem cartão para este
	 * perfil (o servidor só validou o id) mostra o aviso e o caminho de volta,
	 * em vez de uma grade vazia.
	 */
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import HomeCartaoModulo from '../../_components/HomeCartaoModulo.svelte';
	import { gruposHomeDaPagina } from '../../_components/home-modulos';

	const { data }: PageProps = $props();

	const grupo = $derived(
		gruposHomeDaPagina(data.usuario, page.data).find((g) => g.id === data.grupoId) ?? null
	);
	const porCartao = $derived((page.data.avisosResumo?.porCartao ?? {}) as Record<string, number>);
</script>

<svelte:head>
	<title>{grupo?.titulo ?? 'Área de gestão'} | Ecossistema PCCE</title>
</svelte:head>

<BemVindoPagina>
	<BotaoVoltar href="/" />

	{#if grupo}
		<header class="mt-2">
			<p
				class="text-2xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-400"
			>
				Ecossistema PCCE
			</p>
			<h1 class="h1 mt-0.5 text-2xl font-bold">{grupo.titulo}</h1>
			<p class="mt-2 text-sm text-surface-600 dark:text-surface-400">{grupo.descricao}</p>
		</header>

		<div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each grupo.cartoes as cartao (cartao.id)}
				<HomeCartaoModulo {cartao} avisos={porCartao[cartao.id] ?? 0} />
			{/each}
		</div>
	{:else}
		<div class="card-elevated mt-4 rounded-xl p-6">
			<p class="text-sm font-semibold text-surface-900 dark:text-surface-50">
				Esta área de gestão não tem módulos para o seu perfil.
			</p>
			<p class="mt-1 text-xs text-surface-600 dark:text-surface-400">
				Volte ao Início para ver as áreas que você alcança.
			</p>
		</div>
	{/if}
</BemVindoPagina>
