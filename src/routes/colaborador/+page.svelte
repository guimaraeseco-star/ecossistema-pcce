<script lang="ts">
	/**
	 * A área do colaborador. Com lotação e chaves liberadas pela unidade (E61)
	 * mostra os atalhos do que ele pode; sem elas, diz isso em vez de mostrar
	 * uma grade vazia. Nada aqui decide acesso — a lista é a mesma que o portão
	 * de rotas confere.
	 */
	import type { PageProps } from './$types';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);
	const liberados = $derived(data.acessos.filter((a) => a.liberado));

	/** Para onde cada chave leva. */
	const ATALHO: Record<string, string> = {
		'servidores.ver': '/servidores',
		'servidores.cadastro': '/servidores',
		'servidores.afastamento': '/servidores',
		'servidores.ferias': '/servidores',
		'escalas.ver': '/colaborador/escalas',
		'avisos.ler': '/avisos'
	};
</script>

<svelte:head>
	<title>Colaborador | Ecossistema PCCE</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho
		modulo="Área do colaborador"
		{usuario}
		descricao={data.unidade
			? `Lotado(a) na ${data.unidade.nome}${usuario.vinculo ? ` · ${usuario.vinculo}` : ''}. O que você pode fazer aqui é definido pela unidade.`
			: `${usuario.vinculo ? `Conta vinculada a ${usuario.vinculo}. ` : ''}Você ainda não está lotado(a) em uma unidade — o Administrador Geral faz esse vínculo.`}
		accent="primary"
	/>

	{#if data.unidade && liberados.length > 0}
		<div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
			{#each liberados as a (a.chave)}
				<a
					href={ATALHO[a.chave]}
					class="rounded-2xl border border-surface-200 bg-surface-100/50 p-4 transition-colors hover:bg-surface-200/60 dark:border-white/10 dark:bg-surface-800/50 dark:hover:bg-surface-800"
				>
					<p class="font-semibold">{a.rotulo}</p>
					<p class="mt-1 text-xs text-surface-600 dark:text-surface-400">{a.descricao}</p>
				</a>
			{/each}
		</div>
	{:else}
		<div
			class="mt-6 p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-100/50 dark:bg-surface-800/50 text-sm text-surface-600 dark:text-surface-400"
		>
			{#if data.unidade}
				A {data.unidade.nome} ainda não liberou nenhuma ação para esta conta. Quando o admin da unidade
				marcar o que você pode fazer, os atalhos aparecem aqui.
			{:else}
				Nenhuma ação liberada para esta conta ainda. Quando você for lotado(a) em uma unidade e ela
				liberar o que você pode fazer, os atalhos aparecem aqui.
			{/if}
		</div>
	{/if}
</BemVindoPagina>
