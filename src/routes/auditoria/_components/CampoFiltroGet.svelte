<script lang="ts">
	/**
	 * Campo GET da barra de filtros de `/auditoria` e `/auditoria/logs`.
	 *
	 * As duas telas serializam o recorte na query string (`<form method="GET">`),
	 * então o controle vai pelo `name`, não bind. O cromo é o da caixa de
	 * `/operacoes/produtividade`. Sem este envelope, o par De/Até copiado nas
	 * duas páginas era o bloco que o guard de duplicação pegou.
	 *
	 * Com `opcoes`, é a caixa de busca de toda lista do sistema (E76, etapa 2):
	 * o campo escondido dela leva o `name` no envio do formulário, e o "Todas"
	 * (`opcaoVazia`) é a primeira opção — escolhê-lo envia vazio, sem filtro.
	 */
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import {
		CLASSE_INPUT_FILTRO,
		CLASSE_INPUT_SEARCHABLE,
		CLASSE_ROTULO_FILTRO
	} from '$lib/gise/filtro-historico-ui';

	const {
		label,
		name,
		value = '',
		type = 'text',
		placeholder = '',
		class: className = '',
		inputClass = '',
		opcoes,
		opcaoVazia
	}: {
		label: string;
		name: string;
		value?: string;
		type?: 'text' | 'date';
		placeholder?: string;
		class?: string;
		inputClass?: string;
		/** Presente = lista de escolha (caixa de busca); ausente = campo de texto/data. */
		opcoes?: { value: string; label: string }[];
		/** O "sem filtro" da lista ("Todas", "Todos") — a primeira opção. */
		opcaoVazia?: string;
	} = $props();
</script>

{#if opcoes}
	<div class={['flex flex-col gap-1.5', className]}>
		<span class={CLASSE_ROTULO_FILTRO}>{label}</span>
		<SearchableSelect
			{name}
			ariaLabel={label}
			value={value || null}
			options={opcoes}
			{opcaoVazia}
			class={CLASSE_INPUT_SEARCHABLE}
		/>
	</div>
{:else}
	<label class={['flex flex-col gap-1.5', className]}>
		<span class={CLASSE_ROTULO_FILTRO}>{label}</span>
		<input {type} {name} {value} {placeholder} class="{CLASSE_INPUT_FILTRO} w-full {inputClass}" />
	</label>
{/if}
