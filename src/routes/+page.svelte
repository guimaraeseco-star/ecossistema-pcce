<script lang="ts">
	/**
	 * A HOME DE MÓDULOS do Ecossistema PCCE — o que o Admin Geral, o admin de
	 * seccional e o admin de unidade veem ao entrar (decisão E39).
	 *
	 * Os grupos e cartões vêm de `_components/home-modulos.ts`, derivados das
	 * MESMAS flags que montam a navegação lateral. Esta página cuida só da
	 * apresentação: cabeçalho, uma seção por grupo e a grade de cartões.
	 */
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import HomeCartaoModulo from './_components/HomeCartaoModulo.svelte';
	import { gruposHomeDaPagina } from './_components/home-modulos';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);

	const grupos = $derived(gruposHomeDaPagina(usuario, page.data));

	/**
	 * A frase de entrada diz de onde a pessoa olha — é o que muda entre os três
	 * perfis; o que cada um alcança já está nos cartões.
	 */
	const descricao = $derived.by(() => {
		if (usuario?.tipo === 'admin') {
			return 'Você está na visão do departamento. Os módulos abaixo estão organizados por área de gestão; o que ainda não existe aparece marcado como "Em breve".';
		}
		if (usuario?.papel === 'admin_seccional') {
			return 'Você está na visão da sua seccional: as delegacias vinculadas, os servidores delas e as escalas. O que ainda não existe aparece marcado como "Em breve".';
		}
		return 'Você está na visão da sua unidade: os servidores, as escalas e os dados da delegacia. O que ainda não existe aparece marcado como "Em breve".';
	});
</script>

<svelte:head>
	<title>Início | Ecossistema PCCE</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho modulo="Ecossistema PCCE" {usuario} {descricao} accent="primary" />

	{#each grupos as grupo (grupo.id)}
		<section class="mt-8" aria-labelledby="grupo-{grupo.id}">
			<div class="mb-4 flex items-baseline gap-3">
				<h2
					id="grupo-{grupo.id}"
					class="text-2xs font-semibold tracking-[0.18em] text-surface-600 uppercase dark:text-surface-400"
				>
					{grupo.titulo}
				</h2>
				<p class="hidden text-xs text-surface-500 sm:block dark:text-surface-500">
					{grupo.descricao}
				</p>
			</div>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each grupo.cartoes as cartao (cartao.id)}
					<HomeCartaoModulo {cartao} />
				{/each}
			</div>
		</section>
	{/each}
</BemVindoPagina>
