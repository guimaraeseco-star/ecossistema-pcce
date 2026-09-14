<script lang="ts">
	/**
	 * Coordenador da operação e unidade demandante.
	 *
	 * **Usado pelas DUAS rotas da família `/operacoes/planos`:** a criação
	 * (`novo/+page.svelte`) e o editor (`[id]/+page.svelte`). Editar aqui mexe nas
	 * duas — declaração exigida pela regra de "pasta de família" do `CLAUDE.md`.
	 *
	 * O editor passa `coordenadorSelecionado` / `demandanteSelecionado` para o
	 * campo não abrir vazio num plano que já tem gente; a criação não tem o que
	 * pré-mostrar.
	 */
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { buscarCoordenadores, buscarUnidades, MIN_BUSCA } from './buscas';
	import TituloSecao from './TituloSecao.svelte';

	let {
		coordenadorId = $bindable(),
		demandanteId = $bindable(),
		coordenadorSelecionado = null,
		demandanteSelecionado = null
	}: {
		coordenadorId: unknown;
		demandanteId: unknown;
		coordenadorSelecionado?: { value: unknown; label: string } | null;
		demandanteSelecionado?: { value: unknown; label: string } | null;
	} = $props();
</script>

<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
	<TituloSecao texto="Comando e demanda" />

	<div class="space-y-4">
		<div class="space-y-1">
			<label
				for="coordenador"
				class="block text-sm font-medium text-surface-700 dark:text-surface-200"
			>
				DPC coordenador da operação
			</label>
			<SearchableSelect
				id="coordenador"
				name="coordenador_id"
				bind:value={coordenadorId}
				selectedOption={coordenadorSelecionado}
				loadOptions={buscarCoordenadores}
				minSearchChars={MIN_BUSCA}
				placeholder="Busque por nome ou matrícula"
			/>
		</div>

		<div class="space-y-1">
			<label
				for="demandante"
				class="block text-sm font-medium text-surface-700 dark:text-surface-200"
			>
				Delegacia / seccional demandante
			</label>
			<SearchableSelect
				id="demandante"
				name="demandante_unidade_id"
				bind:value={demandanteId}
				selectedOption={demandanteSelecionado}
				loadOptions={buscarUnidades}
				minSearchChars={MIN_BUSCA}
				placeholder="Busque a unidade"
			/>
		</div>
	</div>
</section>
