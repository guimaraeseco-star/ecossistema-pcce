<script lang="ts">
	/**
	 * A recusa de uma trava da estrutura (E73), com os passos, DENTRO da janela.
	 *
	 * Não é toast de propósito: a trava existe para dizer o que fazer antes — os
	 * passos, na ordem, e os nomes das pessoas envolvidas —, e um aviso que some
	 * em segundos não dá tempo de ler. Fica até a pessoa fechar a janela ou
	 * tentar de novo. As quebras de linha vêm do servidor, uma por passo.
	 *
	 * Quando a recusa é de uma TRAVA (E73), `guia` leva ao guia passo a passo
	 * daquele ato, que mostra o mesmo conteúdo como caminho: cada pessoa com o
	 * link da ficha, cada passo com o seu estado.
	 */
	const { texto, guia }: { texto: string; guia?: string | null } = $props();
</script>

<div
	role="alert"
	class="rounded-xl border border-warning-400 dark:border-warning-700 bg-warning-50 dark:bg-warning-950/40 p-3 mb-4 text-sm text-warning-900 dark:text-warning-200 whitespace-pre-line"
>
	{texto}
	{#if guia}
		<p class="mt-3">
			<a href={guia} class="font-semibold underline underline-offset-2">
				Abrir o guia passo a passo →
			</a>
		</p>
	{/if}
</div>
