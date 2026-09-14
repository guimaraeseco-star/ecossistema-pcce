<script lang="ts">
	/**
	 * O campo de NUP do plano operacional, com a máscara oficial.
	 *
	 * **Usado pelas DUAS rotas da família `/operacoes/planos`:** a criação
	 * (`novo/+page.svelte`) e o editor (`[id]/+page.svelte`). Editar aqui mexe nas
	 * duas — é o que a regra de "pasta de família" do `CLAUDE.md` exige que esteja
	 * escrito no cabeçalho, porque pasta de família sem essa declaração parece
	 * privada e não é.
	 *
	 * Existe porque o `guard:duplicacao` pegou as duas cópias, e ele está certo: a
	 * máscara, o `maxlength` e o `placeholder` andam juntos. Uma cópia que
	 * esquecesse o `oninput` viraria um campo de texto livre com cara de campo
	 * mascarado — e o NUP sai impresso no documento.
	 *
	 * `formatarNUP` é a mesma função dos pedidos administrativos da ficha do
	 * servidor: `00000.000000/0000-00`, preenchendo os separadores conforme se
	 * digita.
	 */
	import { formatarNUP } from '$lib/utils/formato';

	let {
		valor = $bindable(''),
		/** "(opcional)" na criação; no editor o rótulo é seco. */
		opcional = false
	}: { valor: string; opcional?: boolean } = $props();
</script>

<label class="block min-w-0 space-y-1">
	<span class="text-sm font-medium text-surface-700 dark:text-surface-200">
		Nº do NUP
		{#if opcional}<span class="text-surface-600 dark:text-surface-400">(opcional)</span>{/if}
	</span>
	<input
		name="nup"
		value={valor}
		oninput={(e) => (valor = formatarNUP(e.currentTarget.value))}
		placeholder="00000.000000/0000-00"
		maxlength="20"
		class="input w-full font-mono"
	/>
</label>
