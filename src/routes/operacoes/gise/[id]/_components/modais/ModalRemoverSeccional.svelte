<script lang="ts">
	import ModalShell from '$lib/components/ModalShell.svelte';

	interface Props {
		open: boolean;
		pending?: boolean;
		onOpenChange: (open: boolean) => void;
		onConfirm: () => void | Promise<void>;
	}

	const { open, pending = false, onOpenChange, onConfirm }: Props = $props();
</script>

<ModalShell
	{open}
	{onOpenChange}
	title="Remover seccional?"
	familia="gise"
	largura="sm"
	{pending}
	cancelLabel="Cancelar"
>
	{#snippet description()}
		Todos os policiais escalados nesta seccional serão removidos. Esta ação não pode ser desfeita.
	{/snippet}

	{#snippet footer()}
		<button
			type="button"
			class="btn preset-filled-error-500"
			onclick={onConfirm}
			disabled={pending}
		>
			{pending ? 'Removendo...' : 'Remover'}
		</button>
	{/snippet}
</ModalShell>
