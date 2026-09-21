<script lang="ts">
	/**
	 * A área do colaborador. Com lotação e chaves liberadas pela unidade (E61)
	 * mostra os atalhos do que ele pode; sem elas, diz isso em vez de mostrar
	 * uma grade vazia. Nada aqui decide acesso — a lista é a mesma que o portão
	 * de rotas confere.
	 *
	 * Um cartão por DESTINO, não por chave (pedido dele, 21/09): as três
	 * chaves de servidores acontecem na mesma ficha, então viram uma linha
	 * miúda dentro do cartão "Servidores"; férias tem destino próprio (o
	 * panorama da unidade). Borda cinza; contorno dourado ao passar o mouse.
	 */
	import type { PageProps } from './$types';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);
	const tem = (chave: string) => data.acessos.some((a) => a.chave === chave && a.liberado);

	/** O que ele pode fazer na ficha do servidor — a linha miúda do cartão. */
	const naFicha = $derived(
		[
			tem('servidores.ver') ? 'ver a ficha' : null,
			tem('servidores.cadastro') ? 'propor alteração de cadastro' : null,
			tem('servidores.afastamento') ? 'propor afastamento e retorno antecipado' : null,
			tem('servidores.ferias') ? 'lançar e reprogramar férias' : null
		].filter((x): x is string => !!x)
	);

	const cartoes = $derived(
		[
			tem('servidores.ver')
				? {
						href: '/servidores',
						titulo: 'Servidores da unidade',
						descricao: `Lista e ficha dos servidores lotados na unidade. Você pode: ${naFicha.join(' · ')}.`
					}
				: null,
			tem('servidores.ferias') && data.unidade
				? {
						href: `/unidade/${data.unidade.id}/ferias`,
						titulo: 'Férias da unidade',
						descricao:
							'Quem está de férias, o que está pendente na COGEP e o teto de 15 % do efetivo.'
					}
				: null,
			tem('escalas.ver')
				? {
						href: '/colaborador/escalas',
						titulo: 'Escalas',
						descricao: 'Só leitura das escalas ordinárias da unidade — não monta nem altera.'
					}
				: null,
			tem('avisos.ler')
				? {
						href: '/avisos',
						titulo: 'Avisos da unidade',
						descricao: 'A caixa de avisos e pendências da unidade; pode marcar como lido.'
					}
				: null
		].filter((c): c is NonNullable<typeof c> => !!c)
	);
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

	{#if data.unidade && cartoes.length > 0}
		<div class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
			{#each cartoes as c (c.href)}
				<a
					href={c.href}
					class="rounded-2xl border border-surface-400/60 bg-surface-100/50 p-4 no-underline transition-colors hover:border-warning-500 hover:ring-1 hover:ring-warning-500 dark:border-surface-500/60 dark:bg-surface-800/50"
				>
					<p class="font-semibold text-surface-900 dark:text-surface-50">{c.titulo}</p>
					<p class="mt-1 text-xs text-surface-600 dark:text-surface-400">{c.descricao}</p>
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
