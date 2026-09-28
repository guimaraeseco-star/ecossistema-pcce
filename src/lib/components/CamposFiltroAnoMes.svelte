<script lang="ts">
	/**
	 * O par Ano + Mês das barras de filtro do painel de conformidade e dos
	 * recebidos — a mesma marcação nas duas telas, que o guard de duplicação
	 * pegou quando as duas viraram caixas de busca (E76, etapa 2). As OPÇÕES
	 * continuam de cada tela: o painel trafega texto ('todos', '2026') e os
	 * recebidos, número (0 = todos).
	 */
	import CampoFiltroSelect from './CampoFiltroSelect.svelte';

	type Option = { value: unknown; label: string };

	let {
		ano = $bindable<unknown>(null),
		mes = $bindable<unknown>(null),
		anos,
		meses
	}: {
		ano: unknown;
		mes: unknown;
		anos: Option[];
		meses: Option[];
	} = $props();
</script>

<CampoFiltroSelect
	label="Ano"
	width="lg:w-28"
	options={anos}
	bind:value={ano}
	ariaLabel="Filtrar por ano"
	numerica
/>

<CampoFiltroSelect
	label="Mês"
	width="lg:w-36"
	options={meses}
	bind:value={mes}
	ariaLabel="Filtrar por mês"
/>
