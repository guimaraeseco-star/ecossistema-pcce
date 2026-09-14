<script lang="ts">
	/**
	 * Campo GET da barra de filtros de `/auditoria` e `/auditoria/logs`.
	 *
	 * As duas telas serializam o recorte na query string (`<form method="GET">`),
	 * então o controle é nativo (`name` + `value`/`selected`), não bind. O cromo
	 * é o da caixa de `/operacoes/produtividade`. Sem este envelope, o par De/Até copiado
	 * nas duas páginas era o bloco que o guard de duplicação pegou.
	 */
	import type { Snippet } from 'svelte';
	import { CLASSE_INPUT_FILTRO, CLASSE_ROTULO_FILTRO } from '$lib/gise/filtro-historico-ui';

	const {
		label,
		name,
		value = '',
		type = 'text',
		placeholder = '',
		class: className = '',
		inputClass = '',
		children
	}: {
		label: string;
		name: string;
		value?: string;
		type?: 'text' | 'date';
		placeholder?: string;
		class?: string;
		inputClass?: string;
		children?: Snippet;
	} = $props();
</script>

<label class={['flex flex-col gap-1.5', className]}>
	<span class={CLASSE_ROTULO_FILTRO}>{label}</span>
	{#if children}
		<select {name} class="{CLASSE_INPUT_FILTRO} w-full {inputClass}">
			{@render children()}
		</select>
	{:else}
		<input {type} {name} {value} {placeholder} class="{CLASSE_INPUT_FILTRO} w-full {inputClass}" />
	{/if}
</label>
