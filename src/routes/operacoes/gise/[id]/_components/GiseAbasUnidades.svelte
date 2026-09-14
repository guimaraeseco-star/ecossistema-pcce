<script lang="ts">
	/**
	 * A barra de ABAS das unidades participantes de uma seccional.
	 *
	 * A aba é a UNIDADE; o painel abaixo (`GiseSlotUnidade`) mostra as equipes da
	 * aba aberta. Antes cada unidade era uma caixa empilhada com o nome e o
	 * "Remover DP" numa faixa própria — três linhas de moldura por delegacia,
	 * espremendo justamente os quadros de equipe.
	 *
	 * A troca dessa escolha é real: **só uma unidade aparece por vez**. É por isso
	 * que a aba carrega `resumoDoSlot` — contador de equipes e o ponto de vaga em
	 * aberto. Sem ele, "falta gente na Icó" só apareceria para quem clicasse na
	 * Icó.
	 *
	 * Detalhes que a barra precisa acertar:
	 * - `overflow-y-hidden` acompanha o `overflow-x-auto` DE PROPÓSITO. Deixar o
	 *   eixo Y no automático fazia o navegador reservar uma barra de rolagem
	 *   vertical dentro da faixa das abas;
	 * - a linha de base é a soma das bordas de baixo das abas mais a do
	 *   preenchedor à direita — não uma borda do container. É o que permite a aba
	 *   ativa "abrir" no painel sem margem negativa transbordando o container;
	 * - `+ Unidades` é a última aba, e não um botão no rodapé: é o lugar onde a
	 *   próxima aba vai nascer. Ele fica solto da linha de base (arredondado, sem
	 *   conexão com o painel) para não ser confundido com a aba aberta.
	 */
	import type { GiseUnidadeSlot } from '$lib/db/gise';
	import { resumoDoSlot, rotuloCurtoUnidade } from '$lib/gise/page-helpers';

	const {
		slots,
		secId,
		abaAtiva,
		onSelecionar,
		podeAdicionar,
		onAdicionar
	}: {
		slots: GiseUnidadeSlot[];
		/**
		 * Id da seccional, usado nos ids de aba/painel. Entra na chave porque
		 * equipe legada (sem slot) vira um slot sintético de id 0 — duas
		 * seccionais nessa situação colidiriam num id de elemento repetido.
		 */
		secId: number;
		/** Id do slot aberto — quem resolve o padrão é `GiseSeccional`. */
		abaAtiva: number | null;
		onSelecionar: (slotId: number) => void;
		podeAdicionar: boolean;
		onAdicionar: () => void;
	} = $props();

	/** Borda comum às abas: é a soma delas que desenha a linha de base. */
	const LINHA = 'border-b border-surface-300 dark:border-surface-700';

	/**
	 * Setas ← → andam entre as abas, que é o que `role="tablist"` promete a quem
	 * navega por teclado. Sem isto o papel ARIA anunciaria um padrão de navegação
	 * que a barra não cumpre.
	 */
	function aoTeclar(e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		const atual = slots.findIndex((u) => u.id === abaAtiva);
		if (atual < 0) return;
		const passo = e.key === 'ArrowRight' ? 1 : -1;
		const alvo = slots[(atual + passo + slots.length) % slots.length];
		e.preventDefault();
		onSelecionar(alvo.id);
		document.getElementById(`aba-un-${secId}-${alvo.id}`)?.focus();
	}
</script>

<div
	role="tablist"
	aria-label="Unidades participantes"
	class="flex items-stretch gap-1 overflow-x-auto overflow-y-hidden"
>
	{#each slots as slot (slot.id)}
		{@const resumo = resumoDoSlot(slot)}
		{@const ativa = slot.id === abaAtiva}
		<button
			type="button"
			role="tab"
			id="aba-un-{secId}-{slot.id}"
			aria-selected={ativa}
			aria-controls="painel-un-{secId}-{slot.id}"
			tabindex={ativa ? 0 : -1}
			title={slot.nome ?? 'Unidade ainda não definida'}
			class="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-semibold transition-colors {ativa
				? 'border-x border-t border-surface-300 border-b-transparent bg-white dark:border-surface-700 dark:bg-surface-950'
				: `${LINHA} border-x border-t border-x-transparent border-t-transparent text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800/60`}"
			onclick={() => onSelecionar(slot.id)}
			onkeydown={aoTeclar}
		>
			{#if slot.nome}
				{rotuloCurtoUnidade(slot.nome)}
			{:else}
				<em class="font-medium text-surface-500 dark:text-surface-400">Unidade não definida</em>
			{/if}

			<!-- O que a aba diz sem ser aberta. O contador só some com zero equipe,
			     onde ele não informa nada que a aba vazia já não diga. -->
			{#if resumo.equipes > 0}
				<span
					class="rounded-full bg-surface-100 px-1.5 text-xs font-bold tabular-nums text-surface-600 dark:bg-surface-800 dark:text-surface-300"
					>{resumo.equipes}</span
				>
			{/if}
			{#if resumo.vagasAbertas > 0}
				<span
					class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-500"
					title="{resumo.vagasAbertas} vaga(s) sem policial nesta unidade"
				></span>
			{/if}
		</button>
	{/each}

	{#if podeAdicionar}
		<button
			type="button"
			class="my-1 ml-2 flex shrink-0 items-center gap-1.5 self-center whitespace-nowrap rounded-lg border border-dashed border-primary-500/50 px-3 py-1.5 text-sm font-semibold text-primary-600 transition-colors hover:bg-primary-500/5 dark:text-primary-400"
			onclick={onAdicionar}
		>
			+ Unidades
		</button>
	{/if}

	<!-- Preenchedor: continua a linha de base até a margem direita. -->
	<span class="min-w-2 flex-1 {LINHA}" aria-hidden="true"></span>
</div>
