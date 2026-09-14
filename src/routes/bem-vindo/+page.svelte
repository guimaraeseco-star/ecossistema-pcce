<script lang="ts">
	/**
	 * Boas-vindas do policial sem papel administrativo.
	 *
	 * Os quadros vêm de `cardsBemVindoDaPagina` — as MESMAS flags que montam a
	 * navegação lateral (ver `_components/bem-vindo-cards.ts`). Esta página
	 * cuida só da apresentação: cabeçalho, aviso de convocação e grade.
	 */
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import BemVindoGradeAcoes from '$lib/components/bem-vindo/BemVindoGradeAcoes.svelte';
	import { cardsBemVindoDaPagina } from '../_components/bem-vindo-cards';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);

	const acoes = $derived(cardsBemVindoDaPagina(usuario, page.data));

	/**
	 * "Nenhuma convocação ativa" fala de VÍNCULO com escala extra, não do total de
	 * cards: "Meu perfil" existe para todo mundo e o histórico é de GISE já
	 * encerrada — nenhum dos dois desmente o aviso.
	 */
	const semConvocacao = $derived(
		!acoes.some((a) => a.href === '/operacoes/gise' || a.href === '/operacoes/presenca')
	);

	/**
	 * O cabeçalho não pode prometer plantão, presença e relatório para quem só
	 * tem "Meu perfil" na tela — era o texto anterior, e ele aparecia logo acima
	 * do aviso de que não há convocação nenhuma.
	 */
	const descricao = $derived(
		semConvocacao
			? 'Este é o seu espaço no Ecossistema PCCE. Quando você for convocado para uma escala extra, ela aparece aqui com o que houver a fazer.'
			: 'Acompanhe suas escalas extras, confirme sua presença e assine o que for da sua responsabilidade.'
	);
</script>

<svelte:head>
	<title>Bem-vindo | Ecossistema PCCE</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho modulo="Ecossistema PCCE" {usuario} {descricao} accent="secondary" />

	<BemVindoGradeAcoes {acoes} accent="secondary">
		{#snippet aviso()}
			{#if semConvocacao}
				<div class="card-elevated mb-4 rounded-xl p-5">
					<p class="text-sm font-semibold text-surface-900 dark:text-surface-50">
						Nenhuma convocação ativa
					</p>
					<p class="mt-1 text-xs leading-relaxed text-surface-600 dark:text-surface-400">
						No momento você não está convocado para nenhuma escala extra. Em caso de dúvida, procure
						a chefia da sua unidade.
					</p>
				</div>
			{/if}
		{/snippet}
	</BemVindoGradeAcoes>
</BemVindoPagina>
