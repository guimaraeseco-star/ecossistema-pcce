<script lang="ts">
	/**
	 * Assinatura INDIVIDUAL do relatório de extraordinário de uma seccional.
	 *
	 * O irmão é `GiseLoteAssinaturas`, que assina todas de uma vez. Os dois
	 * exibem o mesmo aviso jurídico antes de assinar, e isso não é redundância:
	 * o lote já assinou sem ele uma vez — o mesmo ato com duas cerimônias
	 * diferentes. Ao mexer no texto de um, mexa no outro.
	 *
	 * Aqui ficam os downloads por seccional (conferência e manifesto); o card de
	 * lote não os oferece porque lá o recorte é a GISE inteira.
	 */
	import ModalShell from '$lib/components/ModalShell.svelte';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';

	interface Props {
		open: boolean;
		giseId: number;
		seccionalId: number;
		seccionalNome: string;
		signerEmail?: string;
		disabled: boolean;
		control: { assinarComSerpro: () => Promise<void> } | null;
		signerName: string;
		signerCpf: string;
		onSuccess: () => Promise<void>;
		onClose: () => void;
	}

	let {
		open,
		giseId,
		seccionalId,
		seccionalNome,
		signerEmail,
		disabled,
		control = $bindable(),
		signerName = $bindable(),
		signerCpf = $bindable(),
		onSuccess,
		onClose
	}: Props = $props();
</script>

{#snippet descricaoAssinatura()}
	Você está assinando o Relatório Extraordinário da seccional: <br />
	<strong class="text-surface-900 dark:text-surface-50">{seccionalNome}</strong>
{/snippet}

<ModalShell
	{open}
	title="Assinatura Digital Individual"
	description={descricaoAssinatura}
	largura="lg"
	camada="empilhado"
	padding="compacto"
	familia="assinatura"
	pending={disabled}
	onOpenChange={(novoOpen) => {
		if (!disabled && !novoOpen) onClose();
	}}
>
	<PainelAssinaturaToken
		bind:control
		bind:signerName
		bind:signerCpf
		{signerEmail}
		prepararUrl="/api/gise/{giseId}/relatorios/{seccionalId}/preparar-assinatura"
		finalizarUrl="/api/gise/{giseId}/relatorios/{seccionalId}/finalizar-assinatura"
		nomeArquivo="relatorio_extraordinario_{seccionalNome}.pdf"
		{disabled}
		{onSuccess}
	/>

	<button
		type="button"
		class="w-full btn preset-outlined-surface-500 py-3 rounded-2xl text-sm"
		onclick={onClose}
		{disabled}
	>
		Cancelar e fechar
	</button>
</ModalShell>
