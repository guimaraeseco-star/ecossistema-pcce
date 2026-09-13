<script lang="ts">
	/**
	 * A escolha da operação, ANTES dos campos.
	 *
	 * Só é vista por quem tem mais de uma operação pendente — com uma só o
	 * servidor redireciona. É deliberado que a escolha seja uma NAVEGAÇÃO e não um
	 * seletor dentro da tela de preenchimento: ali ela conviveria com os campos, e
	 * trocá-la sem perceber grava o acervo de uma delegacia sob a operação errada.
	 */
	import type { PageProps } from './$types';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	const { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Dados base | Ecossistema PCCE</title>
</svelte:head>

<div class="min-w-0 max-w-3xl space-y-6">
	<div class="min-w-0">
		<h1 class="h1 text-2xl font-bold">Dados base</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
			Valores iniciais de cada indicador — o parâmetro de comparação das metas.
		</p>
	</div>

	{#if data.pendentes.length === 0}
		<section class="card-elevated rounded-2xl p-5 sm:p-6 space-y-2">
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Nenhuma operação ativa pede dados base das suas unidades no momento.
			</p>
			<!-- As duas condições, ditas: sem elas a tela vazia parece defeito. -->
			<p class="text-2xs text-surface-600 dark:text-surface-400">
				Aparece aqui a operação que tenha indicador com <strong>meta percentual</strong> — só ela
				precisa de um valor de partida — <strong>e</strong> em que alguma unidade sua esteja escalada.
			</p>
		</section>
	{:else}
		<section class="card-elevated rounded-2xl p-5 sm:p-6 space-y-3">
			<h2 class="text-base font-semibold">Escolha a operação</h2>
			<p class="text-2xs text-surface-600 dark:text-surface-400">
				Cada operação tem os seus indicadores e a sua linha de base — os valores não se misturam.
			</p>

			<ul class="space-y-2">
				{#each data.pendentes as op (op.id)}
					<li>
						<a
							href={`/dados-base/${op.id}`}
							class="flex items-center justify-between gap-3 rounded-xl border border-surface-200/70 dark:border-white/10 p-4 transition-colors hover:border-primary-400/50 hover:bg-primary-500/5"
						>
							<span class="flex min-w-0 items-center gap-3">
								<ClipboardCheck class="h-4 w-4 shrink-0 text-primary-500" aria-hidden="true" />
								<span class="min-w-0 font-semibold">{op.nome}</span>
							</span>
							<ChevronRight class="h-4 w-4 shrink-0 text-surface-400" aria-hidden="true" />
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
