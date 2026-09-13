<script lang="ts">
	/**
	 * O INÍCIO do Ecossistema PCCE — o que o Admin Geral, o admin de seccional
	 * e o admin de unidade veem ao entrar (decisão E39): os quatro cartões
	 * grandes, dois por linha, como no desenho do responsável. Cada um leva à
	 * tela do grupo (`/grupo/[id]`), onde estão os cartões detalhados.
	 *
	 * Os grupos vêm de `_components/home-modulos.ts`, derivados das MESMAS
	 * flags que montam a navegação lateral. Esta página cuida só da
	 * apresentação.
	 */
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import { gruposHomeDaPagina } from './_components/home-modulos';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);

	const grupos = $derived(gruposHomeDaPagina(usuario, page.data));

	const descricao = $derived.by(() => {
		if (usuario?.tipo === 'admin') {
			return 'Você está na visão do departamento. Escolha a área de gestão para abrir os seus módulos.';
		}
		if (usuario?.papel === 'admin_seccional') {
			return 'Você está na visão da sua seccional. Escolha a área de gestão para abrir os seus módulos.';
		}
		return 'Você está na visão da sua unidade. Escolha a área de gestão para abrir os seus módulos.';
	});
</script>

<svelte:head>
	<title>Início | Ecossistema PCCE</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho modulo="Ecossistema PCCE" {usuario} {descricao} accent="primary" />

	<!--
		Cartão grande: a cor de gestão (#104862, token `gestao`), título na mesma
		tipografia dos demais títulos do sistema e o nome de todos os módulos do
		grupo. A altura é
		calculada para as DUAS linhas caberem na tela sem rolar — metade do que
		sobra abaixo do cabeçalho —, com piso e teto para telefone e monitor
		grande; em coluna única (telefone) a altura é livre.
	-->
	<nav
		class="mt-6 grid grid-cols-1 gap-4 sm:mt-8 sm:grid-cols-2 sm:gap-5"
		aria-label="Áreas de gestão"
	>
		{#each grupos as grupo (grupo.id)}
			<a
				href={grupo.href}
				data-sveltekit-preload-data="hover"
				class="group flex min-h-36 flex-col items-center justify-center rounded-[2rem] bg-gestao px-6 py-6 text-center text-white no-underline shadow-lg shadow-black/20 transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gestao sm:h-[clamp(8rem,calc((100dvh-25.5rem)/2),16rem)]"
			>
				<h2 class="h2 text-xl font-bold text-white sm:text-2xl">{grupo.titulo}</h2>
				<p class="mt-3 max-w-md text-sm leading-relaxed text-white/85">{grupo.descricao}</p>
			</a>
		{/each}
	</nav>
</BemVindoPagina>
