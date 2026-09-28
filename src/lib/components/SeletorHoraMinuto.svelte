<!--
	Par de caixas hora/minuto (00–23 / 00–59) compartilhado pelas telas de
	escalas. Antes: `Array.from({ length: 24|60 })` + `{#each}` copiados em
	ModalNovaEscala, FormAdicionarServidores, ListaFds, TabelaServidores e
	ModalEditarPlantao — drift de rótulo (`{h}h` vs `{h}`) era latente.

	Desde a E76 (etapa 2) são caixas de busca, como toda lista de escolha:
	digitar "14" acha 14h. Vão no modo COMPACTO — sem lupa nem seta no campo —
	porque vivem em células de tabela de 3 cm; o aviso de busca aparece na
	primeira linha da lista aberta. E são obrigatórias: não existe hora vazia.
-->
<script lang="ts" module>
	/** Constantes únicas — importe daqui se precisar do array sem o componente. */
	export const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	export const MINUTOS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
</script>

<script lang="ts">
	import SearchableSelect from './SearchableSelect.svelte';

	let {
		hora = $bindable('08'),
		minuto = $bindable('00'),
		disabled = false,
		/** Sufixo no rótulo da hora (`08h`). */
		sufixoHora = 'h',
		/** Sufixo no rótulo do minuto (`00m`); string vazia omite. */
		sufixoMinuto = 'm',
		nameHora,
		nameMinuto,
		ariaLabelHora = 'Hora',
		ariaLabelMinuto = 'Minuto',
		selectClass = 'select text-sm flex-1'
	}: {
		hora?: string;
		minuto?: string;
		disabled?: boolean;
		sufixoHora?: string;
		sufixoMinuto?: string;
		nameHora?: string;
		nameMinuto?: string;
		ariaLabelHora?: string;
		ariaLabelMinuto?: string;
		selectClass?: string;
	} = $props();

	/**
	 * Do `selectClass` de antes (feito para o `<select>`: cromo, altura, borda)
	 * só a LARGURA vale para a caixa nova — o resto ela traz de si. Assim as
	 * telas que já passavam `w-12` ou `flex-1` continuam do mesmo tamanho.
	 */
	const largura = $derived(
		selectClass
			.split(/\s+/)
			.filter((c) => /^(flex-|w-|min-w-|max-w-|basis-)/.test(c))
			.join(' ') ||
			// Sem largura pedida, o `<select>` tinha a do próprio texto ("08h");
			// a caixa esticaria até empurrar a Saída para a linha de baixo.
			'w-16'
	);

	const opcoesHora = $derived(
		HORAS.map((h) => ({ value: h, label: sufixoHora ? `${h}${sufixoHora}` : h }))
	);
	const opcoesMinuto = $derived(
		MINUTOS.map((m) => ({ value: m, label: sufixoMinuto ? `${m}${sufixoMinuto}` : m }))
	);
</script>

<div class="flex gap-1 items-center min-w-0">
	<div class="min-w-0 {largura}">
		<SearchableSelect
			bind:value={() => hora, (v) => (hora = v == null ? hora : String(v))}
			options={opcoesHora}
			name={nameHora}
			ariaLabel={ariaLabelHora}
			{disabled}
			obrigatorio
			compacto
			numerica
		/>
	</div>
	<div class="min-w-0 {largura}">
		<SearchableSelect
			bind:value={() => minuto, (v) => (minuto = v == null ? minuto : String(v))}
			options={opcoesMinuto}
			name={nameMinuto}
			ariaLabel={ariaLabelMinuto}
			{disabled}
			obrigatorio
			compacto
			numerica
		/>
	</div>
</div>
