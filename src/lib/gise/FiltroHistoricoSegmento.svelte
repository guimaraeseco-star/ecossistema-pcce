<script lang="ts">
	/**
	 * Segmento rotulado da busca detalhada do histórico GISE.
	 *
	 * Consumido por `/operacoes/gise/finalizadas` (admin) e `/operacoes/presenca?status=finalizadas` (policial).
	 * O admin só acrescenta o seletor de seccional ao lado; o controle em si
	 * é o mesmo — extrair evita o drift que o guard de duplicação pegou quando
	 * o snippet e as classes do SegmentedControl estavam copiados nas duas telas.
	 */
	import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';
	import {
		CLASSE_CAMPO_FILTRO,
		CLASSE_CONTROLE_SEGMENTO,
		CLASSE_ITEM_SEGMENTO,
		CLASSE_ROTULO_FILTRO,
		CLASSE_SELETOR_SEGMENTO,
		OPCOES_PERIODO,
		OPCOES_TIPO_EQUIPE,
		ROTULO_PERIODO_DATA_MOBILE
	} from './filtro-historico-ui';

	const {
		kind,
		value,
		onValueChange
	}: {
		kind: 'tipo' | 'periodo';
		value: string;
		onValueChange: (value: string) => void;
	} = $props();

	const rotulo = $derived(kind === 'tipo' ? 'Tipo de equipe' : 'Período/Ciclo');
	const opcoes = $derived(kind === 'tipo' ? OPCOES_TIPO_EQUIPE : OPCOES_PERIODO);

	function rotuloCurto(val: string): string | undefined {
		return kind === 'periodo' && val === 'data' ? ROTULO_PERIODO_DATA_MOBILE : undefined;
	}
</script>

<div class={CLASSE_CAMPO_FILTRO}>
	<span class={CLASSE_ROTULO_FILTRO}>{rotulo}</span>
	<SegmentedControl
		{value}
		onValueChange={(e) => onValueChange(e.value ?? '')}
		class={CLASSE_SELETOR_SEGMENTO}
	>
		<SegmentedControl.Control class={CLASSE_CONTROLE_SEGMENTO}>
			{#each opcoes as [val, label] (val)}
				{@const curto = rotuloCurto(val)}
				<SegmentedControl.Item value={val} class={CLASSE_ITEM_SEGMENTO}>
					<SegmentedControl.ItemText>
						{#if curto}
							<span class="sm:hidden">{curto}</span>
							<span class="hidden sm:inline">{label}</span>
						{:else}
							{label}
						{/if}
					</SegmentedControl.ItemText>
					<SegmentedControl.ItemHiddenInput />
				</SegmentedControl.Item>
			{/each}
		</SegmentedControl.Control>
	</SegmentedControl>
</div>
