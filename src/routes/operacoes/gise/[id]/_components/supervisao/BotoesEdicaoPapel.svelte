<script lang="ts">
	/**
	 * Par Editar/Remover (Admin Geral) de um papel do quadro de supervisão —
	 * mesma marcação nos quatro slots. `compacto=false` só no supervisor
	 * (ícones 14px em vez de 12px). A checagem `podeGerenciar` fica no
	 * chamador: este componente só desenha os botões.
	 *
	 * `rotulo` existe para o NOME ACESSÍVEL, não para a tela: os quatro pares
	 * são visualmente distintos pela posição, mas para um leitor de tela eram
	 * quatro botões "Editar" e quatro "Remover" idênticos, sem dizer o quê. Com
	 * ele viram "Editar DPC de supervisão", "Remover assessor" e assim por
	 * diante. É também o que dá ao e2e um seletor por papel — antes só dava
	 * para alcançá-los por índice no DOM.
	 */
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Spinner from '$lib/components/Spinner.svelte';

	const {
		rotulo,
		temId,
		compacto = true,
		removendo,
		pending,
		onEditar,
		onRemover
	}: {
		/** O papel, como entra na frase: "Editar {rotulo}" / "Remover {rotulo}". */
		rotulo: string;
		temId: boolean;
		compacto?: boolean;
		removendo: boolean;
		pending: boolean;
		onEditar: () => void;
		onRemover: () => void;
	} = $props();
</script>

<div class="flex items-center gap-1 shrink-0">
	<button
		type="button"
		class="btn btn-xs preset-outlined-surface-500 rounded p-1"
		title="Editar {rotulo}"
		aria-label="Editar {rotulo}"
		onclick={onEditar}
	>
		<PenLine size={compacto ? 12 : 14} />
	</button>
	{#if temId}
		<button
			type="button"
			class="btn btn-xs preset-outlined-error-500 rounded p-1"
			title="Remover {rotulo}"
			aria-label="Remover {rotulo}"
			onclick={onRemover}
			disabled={pending}
		>
			{#if pending && removendo}
				<Spinner size="xs" />
			{:else}
				<Trash2 size={compacto ? 12 : 14} />
			{/if}
		</button>
	{/if}
</div>
