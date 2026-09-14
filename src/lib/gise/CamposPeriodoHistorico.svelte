<script lang="ts">
	/**
	 * Recorte temporal da busca detalhada (ciclo × mês × data).
	 *
	 * `/operacoes/gise/finalizadas` e `/operacoes/presenca?status=finalizadas` montavam estes três
	 * campos cada um. Uma cópia recebia o teto de largura do ciclo e a outra
	 * não — o guard de duplicação pegou o bloco de classes copiado. O recorte
	 * mora aqui; cada tela só escolhe o modo e devolve o valor.
	 */
	import { CICLOS } from './ciclos';
	import {
		CLASSE_CAMPO_CICLO,
		CLASSE_CAMPO_FILTRO,
		CLASSE_ENVOLVE_SELECT_CICLO,
		CLASSE_INPUT_FILTRO,
		CLASSE_LINHA_CICLO,
		CLASSE_ROTULO_FILTRO,
		CLASSE_SELECT_ANO_CICLO,
		CLASSE_SELECT_NUMERO_CICLO
	} from './filtro-historico-ui';

	const uid = $props.id();
	const {
		modoPeriodo,
		anoCiclo,
		numeroCiclo,
		mesAno,
		data,
		anosCiclo,
		onAnoCiclo,
		onNumeroCiclo,
		onMesAno,
		onData
	}: {
		modoPeriodo: string;
		anoCiclo: string | number;
		numeroCiclo: string | number;
		mesAno: string;
		data: string;
		anosCiclo: Array<string | number>;
		onAnoCiclo: (valor: string) => void;
		onNumeroCiclo: (valor: string) => void;
		onMesAno: (valor: string) => void;
		onData: (valor: string) => void;
	} = $props();
</script>

{#if modoPeriodo === 'ciclo'}
	<div class={CLASSE_CAMPO_CICLO}>
		<span class={CLASSE_ROTULO_FILTRO}>Ciclo</span>
		<div class={CLASSE_LINHA_CICLO}>
			<label class="sr-only" for="{uid}-ano">Ano do ciclo</label>
			<select
				id="{uid}-ano"
				class={CLASSE_SELECT_ANO_CICLO}
				value={anoCiclo}
				onchange={(e) => onAnoCiclo(e.currentTarget.value)}
			>
				{#each anosCiclo as ano (ano)}
					<option value={ano}>{ano}</option>
				{/each}
			</select>
			<label class="sr-only" for="{uid}-numero">Número do ciclo</label>
			<div class={CLASSE_ENVOLVE_SELECT_CICLO}>
				<select
					id="{uid}-numero"
					class={CLASSE_SELECT_NUMERO_CICLO}
					value={numeroCiclo}
					onchange={(e) => onNumeroCiclo(e.currentTarget.value)}
				>
					{#each CICLOS as c (c.n)}
						<option value={c.n}>{c.label}</option>
					{/each}
				</select>
			</div>
		</div>
	</div>
{:else if modoPeriodo === 'mes'}
	<div class={CLASSE_CAMPO_FILTRO}>
		<label class={CLASSE_ROTULO_FILTRO} for="{uid}-mes">Mês</label>
		<input
			id="{uid}-mes"
			type="month"
			class="{CLASSE_INPUT_FILTRO} w-full sm:w-[12.5rem]"
			value={mesAno}
			oninput={(e) => onMesAno(e.currentTarget.value)}
		/>
	</div>
{:else}
	<div class={CLASSE_CAMPO_FILTRO}>
		<label class={CLASSE_ROTULO_FILTRO} for="{uid}-data">Data específica</label>
		<input
			id="{uid}-data"
			type="date"
			class="{CLASSE_INPUT_FILTRO} w-full sm:w-[12.5rem]"
			value={data}
			oninput={(e) => onData(e.currentTarget.value)}
		/>
	</div>
{/if}
