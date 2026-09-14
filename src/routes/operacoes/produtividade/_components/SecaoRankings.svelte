<script lang="ts">
	/**
	 * A faixa de cards de RANKING e DETALHAMENTO do painel.
	 *
	 * Duas origens, e a diferença importa:
	 *
	 * - o bloco de **prisões** é escrito no código. Ele soma três perguntas
	 *   (flagrantes, mandados e total de presos), e uma marca que vive numa
	 *   pergunta não descreve um card que atravessa três. Só aparece se o
	 *   formulário da operação tiver a pergunta que o alimenta — antes aparecia
	 *   sempre, zerado, em operação que nunca perguntou sobre flagrante;
	 * - os demais vêm do MODELO, um por pergunta marcada com a forma. Drogas e
	 *   armas eram blocos fixos como o de prisões e viraram isto na migração 0054:
	 *   a quebra por tipo de droga e por tipo de arma é da própria resposta, então
	 *   cabe numa marca — e assim o assessor pode desligar o que não quer.
	 *
	 * As duas origens chegam aqui na MESMA lista, já ordenada por
	 * `useProdutividade`. Prisões tinha uma `<section>` própria acima das outras, o
	 * que o pregava no topo: com a ordem do painel virando escolha do Admin Geral
	 * (migração 0064), um card pregado seria a única exceção sem motivo. O que
	 * sobrou de diferente nele é o ícone.
	 *
	 * Os cards fluem dois por linha. Ranking e detalhamento da mesma pergunta
	 * nascem lado a lado porque são vizinhos na lista, que é como o painel sempre
	 * mostrou drogas e armas — e só se separam se alguém arrastar um dos dois.
	 */
	import RankingCard from './RankingCard.svelte';
	import DetailCard from './DetailCard.svelte';
	import CardOrdenavel from './CardOrdenavel.svelte';
	import type { CardListagem } from './useProdutividade.svelte';
	import type { OrganizacaoPainel } from './useOrganizacaoPainel.svelte';

	const {
		cards,
		rotuloGrupo,
		selectedCharts,
		onToggle,
		organizacao
	}: {
		/** Rankings e detalhamentos (prisões incluído), já na ordem do painel. */
		cards: CardListagem[];
		/** "Seccional" ou "Delegacia" — o que cada linha do ranking é, no eixo atual. */
		rotuloGrupo: string;
		selectedCharts: (number | string)[];
		onToggle: (id: string | number) => void;
		/** Estado do modo "Organizar"; `ativo` falso deixa a faixa como sempre foi. */
		organizacao: OrganizacaoPainel;
	} = $props();
</script>

{#snippet iconPrison(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
		/></svg
	>
{/snippet}
{#snippet iconGrafico(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
		/></svg
	>
{/snippet}

<!-- O card em si, sem a moldura de arraste: um snippet só, chamado pelos dois
     ramos do modo. Duplicá-lo faria o card fora do modo e o card dentro dele
     divergirem — que é a armadilha catalogada no `CLAUDE.md`. -->
{#snippet cardDaLista(card: CardListagem)}
	{#if card.forma === 'ranking'}
		<RankingCard
			id={card.id}
			title={card.titulo}
			ranking={card.ranking}
			color={card.cor}
			icon={card.icone === 'prisoes' ? iconPrison : iconGrafico}
			labelUnit={card.unidade}
			{rotuloGrupo}
			selected={selectedCharts.includes(card.id)}
			{onToggle}
		/>
	{:else}
		<DetailCard
			id={card.id}
			title={card.titulo}
			details={card.linhas}
			total={card.total}
			color={card.cor}
			unit={card.unidade}
			selected={selectedCharts.includes(card.id)}
			{onToggle}
		/>
	{/if}
{/snippet}

{#if cards.length > 0}
	<div class="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
		<section
			class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6"
			role={organizacao.ativo ? 'list' : undefined}
		>
			{#each cards as card, indice (card.id)}
				{#if organizacao.ativo}
					<CardOrdenavel
						{organizacao}
						secao="listagem"
						{indice}
						total={cards.length}
						rotulo={card.titulo}
					>
						{@render cardDaLista(card)}
					</CardOrdenavel>
				{:else}
					{@render cardDaLista(card)}
				{/if}
			{/each}
		</section>
	</div>
{/if}
