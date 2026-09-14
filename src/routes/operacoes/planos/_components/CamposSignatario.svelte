<script lang="ts">
	/**
	 * Quem assina o plano: o DPC (pesquisável) e o cargo (lista fechada).
	 *
	 * **Usado pelas DUAS rotas da família `/operacoes/planos`:** a criação
	 * (`novo/+page.svelte`) e o editor (`[id]/+page.svelte`). Editar aqui mexe nas
	 * duas — declaração exigida pela regra de "pasta de família" do `CLAUDE.md`,
	 * porque pasta de família sem ela parece privada e não é.
	 *
	 * ## Por que é campo do PLANO, e não configuração global
	 *
	 * O signatário varia por operação: o Titular assina umas, o Adjunto outras.
	 * Antes existia só o padrão em `/valores`, então trocar quem assina UM
	 * plano exigia mudar o padrão de TODOS os seguintes. O padrão continua lá,
	 * mas agora só pré-preenche.
	 *
	 * ## Nome pesquisado, cargo em lista fechada
	 *
	 * O nome sai do cadastro (mesma busca do coordenador) e vai CONGELADO no
	 * plano — renomear o servidor depois não altera documento emitido. O cargo é
	 * `<select>` porque vai impresso sob a assinatura: campo livre coloca um erro
	 * de digitação no papel, e ninguém revisa o rodapé de um PDF.
	 */
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { buscarCoordenadores, MIN_BUSCA } from './buscas';

	let {
		diretorId = $bindable(),
		cargo = $bindable(''),
		/** Os cargos aceitos — vêm do servidor, gerados do departamento (`cargosSignatario`). */
		cargos,
		/** O que o campo mostra ao abrir, sem ir ao servidor. */
		selecionado = null,
		/** Nome que o documento usa hoje quando ninguém foi escolhido aqui. */
		nomePadrao = ''
	}: {
		diretorId: unknown;
		cargo: string;
		cargos: readonly string[];
		selecionado?: { value: unknown; label: string } | null;
		nomePadrao?: string;
	} = $props();
</script>

<div class="space-y-4">
	<div class="space-y-1">
		<label for="diretor" class="block text-sm font-medium text-surface-700 dark:text-surface-200">
			Nome do DPC
		</label>
		<SearchableSelect
			id="diretor"
			name="diretor_id"
			bind:value={diretorId}
			selectedOption={selecionado}
			loadOptions={buscarCoordenadores}
			minSearchChars={MIN_BUSCA}
			placeholder="Busque por nome ou matrícula"
		/>
		{#if nomePadrao}
			<span class="block text-xs text-surface-600 dark:text-surface-400">
				Em branco, o documento sai com <strong>{nomePadrao}</strong>.
			</span>
		{/if}
	</div>

	<label class="block space-y-1">
		<span class="text-sm font-medium text-surface-700 dark:text-surface-200">Cargo</span>
		<select name="diretor_cargo" bind:value={cargo} class="select w-full">
			{#each cargos as opcao (opcao)}
				<option value={opcao}>{opcao}</option>
			{/each}
		</select>
	</label>
</div>
