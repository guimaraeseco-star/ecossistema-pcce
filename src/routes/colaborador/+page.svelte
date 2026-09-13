<script lang="ts">
	/**
	 * A área do colaborador. Sem quadros de acesso rápido de propósito: a
	 * identidade não alcança nada até uma função ser designada no módulo de
	 * diárias, e a tela diz isso em vez de mostrar uma grade vazia.
	 */
	import type { PageProps } from './$types';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);
</script>

<svelte:head>
	<title>Colaborador | Ecossistema PCCE</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho
		modulo="Área do colaborador"
		{usuario}
		descricao={usuario.vinculo
			? `Conta vinculada a ${usuario.vinculo}. As funções que você pode exercer são designadas pelo Super Administrador.`
			: 'As funções que você pode exercer são designadas pelo Super Administrador.'}
		accent="primary"
	/>

	<div
		class="mt-6 p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-100/50 dark:bg-surface-800/50 text-sm text-surface-600 dark:text-surface-400"
	>
		Nenhuma função designada para esta conta ainda. Quando o módulo de diárias designar uma função
		(Protocolo ou Análise), as telas correspondentes aparecem aqui.
	</div>
</BemVindoPagina>
