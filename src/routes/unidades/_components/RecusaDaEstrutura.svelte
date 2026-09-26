<script lang="ts">
	/**
	 * A recusa de uma trava da estrutura (E73), com os passos, DENTRO da janela.
	 *
	 * Não é toast de propósito: a trava existe para dizer o que fazer antes — os
	 * passos, na ordem, e os nomes das pessoas envolvidas —, e um aviso que some
	 * em segundos não dá tempo de ler. Fica até a pessoa fechar a janela ou
	 * tentar de novo. As quebras de linha vêm do servidor, uma por passo.
	 *
	 * Desde "tudo no Guia" (E73) ela só aparece DENTRO do guia — já não há
	 * janela de onde levar a ele, e por isso não há mais link.
	 */
	const { texto }: { texto: string } = $props();
</script>

<div
	role="alert"
	class="rounded-xl border border-warning-400 dark:border-warning-700 bg-warning-50 dark:bg-warning-950/40 p-3 mb-4 text-sm text-warning-900 dark:text-warning-200 whitespace-pre-line"
>
	{texto}
</div>
