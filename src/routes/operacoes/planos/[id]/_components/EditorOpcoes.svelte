<script lang="ts">
	/**
	 * A lista de opções de um tipo NO EDITOR, onde o plano já existe.
	 *
	 * O desenho vem de `ListaOpcoes` (compartilhado com a tela de criação); aqui
	 * mora só a gravação, que é por form action — cada opção grava sozinha, como
	 * os membros da equipe.
	 *
	 * ## As opções ficam FORA do formulário de parâmetros
	 *
	 * Se dependessem do "Salvar parâmetros", acrescentar um destino exigiria
	 * salvar o plano inteiro — e quem só queria a opção nova levaria junto
	 * qualquer edição pela metade que estivesse nos outros campos.
	 *
	 * ## Acrescentar passa por um formulário OCULTO
	 *
	 * O campo de texto vive dentro de `ListaOpcoes`, que não conhece actions. O
	 * valor é escrito direto no `input` oculto (`campoValor.value = …`) e o
	 * `requestSubmit()` dispara o `submit` que o `use:enhance` intercepta.
	 * Escrever no DOM, e não em `$state`, é o que torna a sequência SÍNCRONA: com
	 * estado reativo o `requestSubmit()` sairia antes de o Svelte propagar o
	 * valor, e o servidor receberia o campo vazio.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PlanoOpcao } from '$lib/server/schema';
	import type { TipoOpcao } from '$lib/db/planos/opcoes';
	import { loading } from '$lib/loading.svelte';
	import ListaOpcoes from '../../_components/ListaOpcoes.svelte';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	const {
		tipo,
		rotulo,
		descricao,
		exemplo,
		opcoes,
		municipios,
		modo = 'local',
		enviar
	}: {
		tipo: TipoOpcao;
		rotulo: string;
		descricao: string;
		exemplo: string;
		opcoes: PlanoOpcao[];
		/** Os 184 municípios, para o seletor da linha de acrescentar. */
		municipios: { ibge: string; nome: string }[];
		modo?: 'cidade' | 'local';
		/** `use:enhance` comum, vindo da página. */
		enviar: (msg: string, aoConcluir?: () => void) => SubmitFunction;
	} = $props();

	let formAcrescentar: HTMLFormElement;
	let campoValor: HTMLInputElement;
	let campoMunicipio: HTMLInputElement;

	/** Nome do município por código, para a linha da lista exibi-lo. */
	const nomePorIbge = $derived(new Map(municipios.map((m) => [m.ibge, m.nome])));

	const naLista = $derived(
		opcoes.map((o) => ({
			chave: o.id,
			valor: o.valor,
			padrao: o.padrao,
			municipio: o.municipio_ibge ? (nomePorIbge.get(o.municipio_ibge) ?? null) : null
		}))
	);

	function acrescentar(valor: string, municipioIbge: string | null) {
		campoValor.value = valor;
		campoMunicipio.value = municipioIbge ?? '';
		formAcrescentar.requestSubmit();
	}
</script>

<ListaOpcoes
	{rotulo}
	{descricao}
	{exemplo}
	{modo}
	{municipios}
	opcoes={naLista}
	aoAcrescentar={acrescentar}
	ocupado={loading.active}
>
	{#snippet acoes(o)}
		{#if !o.padrao}
			<form
				method="POST"
				action="?/definirOpcaoPadrao"
				use:enhance={enviar('Opção padrão definida')}
				class="contents"
			>
				<input type="hidden" name="opcao_id" value={o.chave} />
				<button
					type="submit"
					class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-2xs"
					title="Usar como padrão nas equipes novas"
					disabled={loading.active}
				>
					<Star class="w-3.5 h-3.5" />
					Padrão
				</button>
			</form>
		{/if}
		<form
			method="POST"
			action="?/removerOpcao"
			use:enhance={enviar('Opção removida')}
			class="contents"
		>
			<input type="hidden" name="opcao_id" value={o.chave} />
			<button
				type="submit"
				class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-2xs"
				title="Remover da lista"
				disabled={loading.active}
			>
				<Trash2 class="w-3.5 h-3.5" />
			</button>
		</form>
	{/snippet}
</ListaOpcoes>

<!-- O formulário que `acrescentar()` dispara. Fica fora da lista porque o campo
     de texto é dela; aqui só viaja o valor já escolhido. -->
<form
	bind:this={formAcrescentar}
	method="POST"
	action="?/adicionarOpcao"
	use:enhance={enviar('Opção acrescentada')}
	class="hidden"
>
	<input type="hidden" name="tipo" value={tipo} />
	<input bind:this={campoValor} type="hidden" name="valor" />
	<input bind:this={campoMunicipio} type="hidden" name="municipio_ibge" />
</form>
