<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import ModalShell from '$lib/components/ModalShell.svelte';

	interface Props {
		open: boolean;
		pendingCrud: boolean;
		onClose: () => void;
		onSubmit: SubmitFunction;
	}

	const { open, pendingCrud, onClose, onSubmit }: Props = $props();
</script>

<ModalShell
	{open}
	onOpenChange={(isOpen) => {
		if (!isOpen) onClose();
	}}
	title="Reabrir Escala GISE"
	familia="gise"
	largura="sm"
	pending={pendingCrud}
	cancelLabel="Cancelar"
>
	{#snippet description()}
		A assinatura digital será <strong>revogada</strong> e será necessário que o supervisor assine novamente.
	{/snippet}

	{#snippet footer()}
		<form method="POST" action="?/reabrirEscala" use:enhance={onSubmit} class="contents">
			<button
				type="submit"
				class="btn preset-filled-warning-500 text-sm px-4 py-2 rounded-xl"
				disabled={pendingCrud}
			>
				{pendingCrud ? 'Reabrindo...' : 'Confirmar Reabertura'}
			</button>
		</form>
	{/snippet}
</ModalShell>
