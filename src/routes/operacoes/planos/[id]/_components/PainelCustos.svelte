<script lang="ts">
	/**
	 * O Anexo II na tela, antes de virar PDF.
	 *
	 * Recolhido, só o TOTAL GERAL permanece visível — conferir o consolidado
	 * sem empurrar o Documento para fora da tela. Aberto, os dois blocos por
	 * categoria (DRO e diárias) e as listas de pendência/aviso.
	 * mesma chamada que o gerador do PDF usa: recalcular aqui abriria a porta
	 * para a tela dizer um total e o documento outro.
	 *
	 * As duas listas de problema têm pesos diferentes e por isso aparecem
	 * separadas:
	 *
	 * - **pendências** impedem a emissão (servidor sem classe em equipe COM
	 *   custo). É bloqueio, e o botão do PDF fica desabilitado;
	 * - **avisos** não impedem nada hoje (o mesmo problema em equipe SEM custo),
	 *   mas impediriam no instante em que a equipe mudasse de tipo de custo. É
	 *   "corrija agora, ainda dá tempo".
	 */
	import { formatarBRL } from '$lib/planos/rotulos';
	import { ROTULO_CATEGORIA } from '$lib/planos/faixa-custo';
	import { TITULO_DRO, TITULO_DIARIAS } from '$lib/planos/rotulos';
	import type { CustoPlano } from '$lib/planos/custo';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Info from '@lucide/svelte/icons/info';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	const {
		custo,
		versaoValores
	}: {
		custo: CustoPlano;
		/** A versão de valores aplicada — o que torna o total auditável. */
		versaoValores: { id: number; vigente_desde: string } | null;
	} = $props();

	/** Recolhido: o total continua visível — é o que o cabeçalho da página já
	 *  mostra, e o que alguém conferindo as equipes precisa sem abrir o Anexo. */
	let aberto = $state(false);
</script>

<!-- `card-quadro` com `hover:shadow-md`: este painel ABRE ao clique, como as
     equipes. Recolhido, o TOTAL GERAL fica visível — conferir o consolidado
     sem empurrar o Documento para fora da tela. -->
<section
	class="card-quadro min-w-0 rounded-2xl overflow-hidden hover:shadow-md transition-shadow duration-300"
>
	<button
		type="button"
		class="w-full flex items-start sm:items-center justify-between gap-3 p-4 sm:p-5 text-left"
		onclick={() => (aberto = !aberto)}
		aria-expanded={aberto}
	>
		<span class="min-w-0">
			<span class="block text-base font-semibold text-surface-900 dark:text-white">
				Anexo II — consolidado financeiro
			</span>
			<span class="block text-xs text-surface-600 dark:text-surface-400">
				{#if custo.pendencias.length > 0}
					<span class="text-error-600 dark:text-error-400 font-medium">
						{custo.pendencias.length}
						{custo.pendencias.length === 1 ? 'servidor impede' : 'servidores impedem'} a emissão
					</span>
				{:else}
					É o que o documento imprime. Confira antes de emitir.
				{/if}
			</span>
		</span>
		<ChevronDown
			class="w-5 h-5 shrink-0 transition-transform {aberto ? 'rotate-180' : ''}"
			aria-hidden="true"
		/>
	</button>

	<div class="px-4 pb-4 sm:px-5 sm:pb-5 space-y-4">
		{#if aberto}
			{#if custo.pendencias.length > 0}
				<div
					class="rounded-xl border border-error-500/40 bg-error-500/10 p-3 space-y-1.5 text-sm text-error-700 dark:text-error-300"
				>
					<p class="flex gap-2 font-medium">
						<TriangleAlert class="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
						<span>
							{custo.pendencias.length}
							{custo.pendencias.length === 1 ? 'servidor impede' : 'servidores impedem'} a emissão
						</span>
					</p>
					<ul class="space-y-0.5 pl-6 text-xs">
						{#each custo.pendencias as p (p.policial_id)}
							<li><strong>{p.nome}</strong> ({p.equipe}) — {p.motivo}</li>
						{/each}
					</ul>
					<p class="pl-6 text-xs">
						Corrija a classe no cadastro do servidor e use <strong
							>Reaplicar cargo/classe do cadastro</strong
						> acima. O total abaixo está parcial.
					</p>
				</div>
			{/if}

			{#if custo.avisos.length > 0}
				<div
					class="rounded-xl border border-warning-500/30 bg-warning-500/10 p-3 space-y-1.5 text-sm text-warning-700 dark:text-warning-300"
				>
					<p class="flex gap-2 font-medium">
						<Info class="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
						<span>{custo.avisos.length} servidor(es) sem classe em equipe sem custo</span>
					</p>
					<ul class="space-y-0.5 pl-6 text-xs">
						{#each custo.avisos as a (a.policial_id)}
							<li><strong>{a.nome}</strong> ({a.equipe}) — {a.motivo}</li>
						{/each}
					</ul>
					<p class="pl-6 text-xs">
						Não bloqueia hoje. Mas se essa equipe passar a ter custo — a operação escorregar para um
						sábado, por exemplo —, passa a bloquear.
					</p>
				</div>
			{/if}

			<div class="space-y-2">
				<h3
					class="text-xs font-semibold uppercase tracking-wide text-surface-700 dark:text-surface-200"
				>
					{TITULO_DRO}
				</h3>
				{#if custo.consolidado.dro.length === 0}
					<p class="text-xs text-surface-600 dark:text-surface-400">
						Nenhuma equipe em hora extra.
					</p>
				{:else}
					<div class="hidden md:block table-wrap">
						<table class="table">
							<thead>
								<tr>
									<th>Categoria</th>
									<th class="text-right">Quantidade</th>
									<th class="text-right">Custo total</th>
								</tr>
							</thead>
							<tbody>
								{#each custo.consolidado.dro as l (l.categoria)}
									<tr>
										<td>{ROTULO_CATEGORIA[l.categoria]}</td>
										<td class="text-right">{l.quantidade}</td>
										<td class="text-right">{formatarBRL(l.total)}</td>
									</tr>
								{/each}
								<tr class="font-semibold">
									<td>TOTAL</td>
									<td class="text-right"
										>{custo.consolidado.dro.reduce((s, l) => s + l.quantidade, 0)}</td
									>
									<td class="text-right">{formatarBRL(custo.consolidado.droTotal)}</td>
								</tr>
							</tbody>
						</table>
					</div>
					<ul class="md:hidden space-y-2">
						{#each custo.consolidado.dro as l (l.categoria)}
							<li
								class="flex items-baseline justify-between gap-3 rounded-xl border border-surface-200 dark:border-white/10 p-3"
							>
								<span class="min-w-0 text-sm text-surface-800 dark:text-surface-100"
									>{ROTULO_CATEGORIA[l.categoria]}</span
								>
								<span class="shrink-0 text-sm tabular-nums text-surface-700 dark:text-surface-200">
									{l.quantidade} · {formatarBRL(l.total)}
								</span>
							</li>
						{/each}
						<li
							class="flex items-baseline justify-between gap-3 rounded-xl border border-surface-200 dark:border-white/10 p-3 font-semibold"
						>
							<span class="text-sm">TOTAL</span>
							<span class="shrink-0 text-sm tabular-nums">
								{custo.consolidado.dro.reduce((s, l) => s + l.quantidade, 0)} · {formatarBRL(
									custo.consolidado.droTotal
								)}
							</span>
						</li>
					</ul>
				{/if}
			</div>

			<!-- ---- Diárias ---- -->
			<div class="space-y-2">
				<h3
					class="text-xs font-semibold uppercase tracking-wide text-surface-700 dark:text-surface-200"
				>
					{TITULO_DIARIAS}
				</h3>
				{#if custo.consolidado.diarias.length === 0}
					<p class="text-xs text-surface-600 dark:text-surface-400">Nenhuma equipe em diária.</p>
				{:else}
					<div class="hidden md:block table-wrap">
						<table class="table">
							<thead>
								<tr>
									<th>Categoria</th>
									<th class="text-right">Quantidade</th>
									<th class="text-right">Custo total</th>
								</tr>
							</thead>
							<tbody>
								{#each custo.consolidado.diarias as l (l.categoria)}
									<tr>
										<td>{ROTULO_CATEGORIA[l.categoria]}</td>
										<td class="text-right">{l.quantidade}</td>
										<td class="text-right">{formatarBRL(l.total)}</td>
									</tr>
								{/each}
								<tr class="font-semibold">
									<td>TOTAL</td>
									<td class="text-right"
										>{custo.consolidado.diarias.reduce((s, l) => s + l.quantidade, 0)}</td
									>
									<td class="text-right">{formatarBRL(custo.consolidado.diariasTotal)}</td>
								</tr>
							</tbody>
						</table>
					</div>
					<ul class="md:hidden space-y-2">
						{#each custo.consolidado.diarias as l (l.categoria)}
							<li
								class="flex items-baseline justify-between gap-3 rounded-xl border border-surface-200 dark:border-white/10 p-3"
							>
								<span class="min-w-0 text-sm text-surface-800 dark:text-surface-100"
									>{ROTULO_CATEGORIA[l.categoria]}</span
								>
								<span class="shrink-0 text-sm tabular-nums text-surface-700 dark:text-surface-200">
									{l.quantidade} · {formatarBRL(l.total)}
								</span>
							</li>
						{/each}
						<li
							class="flex items-baseline justify-between gap-3 rounded-xl border border-surface-200 dark:border-white/10 p-3 font-semibold"
						>
							<span class="text-sm">TOTAL</span>
							<span class="shrink-0 text-sm tabular-nums">
								{custo.consolidado.diarias.reduce((s, l) => s + l.quantidade, 0)} · {formatarBRL(
									custo.consolidado.diariasTotal
								)}
							</span>
						</li>
					</ul>
				{/if}
			</div>
		{/if}

		<div
			class="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-surface-200 dark:border-white/10 p-3"
		>
			<span class="text-sm font-semibold text-surface-800 dark:text-surface-100">TOTAL GERAL</span>
			<span class="text-lg font-bold text-surface-900 dark:text-white">
				{formatarBRL(custo.consolidado.totalGeral)}
			</span>
		</div>

		{#if aberto}
			<p class="text-xs text-surface-600 dark:text-surface-400">
				* Valores estimados.
				{#if versaoValores}
					Tabela de valores #{versaoValores.id}, vigente desde {versaoValores.vigente_desde}.
				{:else}
					<strong class="text-warning-700 dark:text-warning-400"
						>Nenhuma tabela de valores gravada — os totais saem zerados.</strong
					>
				{/if}
			</p>
		{/if}
	</div>
</section>
