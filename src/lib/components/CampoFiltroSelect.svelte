<script lang="ts">
	/**
	 * Campo de filtro rotulado (label + `SearchableSelect`) — o mesmo par
	 * repetido em toda barra de filtros com dropdown de busca (painel,
	 * recebidos: Seccional/Unidade/Ano/Mês).
	 *
	 * Rótulo e tamanho do input seguem a caixa de `/operacoes/produtividade` (`text-3xs` /
	 * `text-xs`), via tokens em `$lib/gise/filtro-historico-ui`.
	 *
	 * `opcaoVazia` é o "Todas" do filtro como PRIMEIRA opção da lista (E76,
	 * etapa 2) — antes ele era só o texto de fundo do campo vazio, e voltar a
	 * ver tudo exigia achar o X.
	 */
	import SearchableSelect from './SearchableSelect.svelte';
	import { CLASSE_INPUT_SEARCHABLE, CLASSE_ROTULO_FILTRO } from '$lib/gise/filtro-historico-ui';

	type Option = { value: unknown; label: string; detalhe?: string };

	let {
		label,
		width = '',
		options,
		value = $bindable<unknown>(null),
		ariaLabel,
		placeholder = undefined,
		opcaoVazia = undefined,
		numerica = false
	}: {
		label: string;
		/** Classe(s) de largura no breakpoint lg, ex.: "lg:w-36". */
		width?: string;
		options: Option[];
		value: unknown;
		ariaLabel: string;
		placeholder?: string;
		/** O "Todas"/"Todos" do filtro, como primeira opção da lista. */
		opcaoVazia?: string;
		/** Lista de números (o ano): o aviso pede o número. */
		numerica?: boolean;
	} = $props();
</script>

<div class="flex flex-col gap-1.5 w-full {width}">
	<span class={CLASSE_ROTULO_FILTRO}>{label}</span>
	<SearchableSelect
		{options}
		bind:value
		{ariaLabel}
		{placeholder}
		{opcaoVazia}
		{numerica}
		class={CLASSE_INPUT_SEARCHABLE}
	/>
</div>
