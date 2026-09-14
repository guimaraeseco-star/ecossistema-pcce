<script lang="ts">
	/**
	 * As ações do plano, um campo por linha — o que o documento imprime no item 2b.
	 *
	 * **Usado pelas DUAS rotas da família `/operacoes/planos`:** a criação
	 * (`novo/+page.svelte`) e o editor (`[id]/+page.svelte`). Editar aqui mexe nas
	 * duas — declaração exigida pela regra de "pasta de família" do `CLAUDE.md`.
	 *
	 * O servidor e o PDF ainda leem UM texto com quebras de linha (`acoes`). Este
	 * componente é só a apresentação: cada linha vira um `<input>`, o POST leva o
	 * mesmo `name="acoes"` concatenado. Sem isso, criação e editor divergiriam na
	 * primeira vez que alguém acrescentasse um campo só de um lado.
	 *
	 * Linhas em branco não viajam — o gerador do PDF já as ignora, e gravá-las
	 * faria um campo vazio parecer "ação vazia" no próximo load.
	 */
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	const {
		valor = '',
		rotulo = true
	}: {
		valor?: string;
		/** `false` quando o quadro da criação já traz o título da seção. */
		rotulo?: boolean;
	} = $props();

	let proximoId = 1;

	function partir(texto: string): { id: number; texto: string }[] {
		const partes = texto.split('\n');
		const fonte = partes.length > 0 ? partes : [''];
		return fonte.map((t) => ({ id: proximoId++, texto: t }));
	}

	// Captura intencional: depois da primeira renderização as linhas são do
	// usuário. Re-derivá-las de `valor` apagaria uma ação em curso.
	// svelte-ignore state_referenced_locally
	let linhas = $state(partir(valor));

	const enviado = $derived(
		linhas
			.map((l) => l.texto.trim())
			.filter((t) => t.length > 0)
			.join('\n')
	);

	function acrescentar() {
		linhas.push({ id: proximoId++, texto: '' });
	}

	function remover(id: number) {
		if (linhas.length <= 1) return;
		linhas = linhas.filter((l) => l.id !== id);
	}
</script>

<div class="space-y-2">
	{#if rotulo}
		<span class="block text-sm font-medium text-surface-700 dark:text-surface-200">
			Ações a serem realizadas
		</span>
	{/if}

	<ul class="grid grid-cols-1 gap-2 md:grid-cols-2">
		{#each linhas as linha, i (linha.id)}
			<li class="flex items-center gap-2">
				<input
					type="text"
					bind:value={linha.texto}
					maxlength="200"
					class="input min-w-0 flex-1"
					aria-label="Ação {i + 1}"
				/>
				{#if linhas.length > 1}
					<button
						type="button"
						class="btn btn-sm preset-outlined-surface-500 px-2 py-1.5 rounded-xl shrink-0"
						title="Remover esta ação"
						onclick={() => remover(linha.id)}
					>
						<Trash2 class="w-3.5 h-3.5" />
					</button>
				{/if}
			</li>
		{/each}
	</ul>

	<button
		type="button"
		class="btn preset-outlined-surface-500 py-2 px-3 rounded-xl text-sm w-full sm:w-auto justify-center"
		onclick={acrescentar}
	>
		<Plus class="w-4 h-4" />
		Acrescentar ação
	</button>

	<input type="hidden" name="acoes" value={enviado} />
</div>
