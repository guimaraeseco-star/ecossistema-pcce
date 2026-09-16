<script lang="ts">
	/**
	 * Um município em CARTÃO — o que o celular mostra no lugar das nove colunas
	 * (mesmo padrão de `/servidores` e da Gestão de unidade). Os mesmos dados da
	 * tabela, na ordem em que interessam a quem abre no telefone: quem atende,
	 * plantão de hoje, e só então população e proporção.
	 */
	import { rotuloTipoPlantao } from '$lib/unidades/plantao';
	import { nomeCurtoDeUnidade } from '$lib/unidades/nome';
	import type { MunicipioDaTela } from './carregar';

	const {
		municipio,
		/** Habitantes por policial já calculado pelo `load`. */
		habPorPolicial,
		efetivo
	}: {
		municipio: MunicipioDaTela;
		habPorPolicial: number | null;
		efetivo: number;
	} = $props();

	const fmt = new Intl.NumberFormat('pt-BR');
	const plantao = (p: MunicipioDaTela['semana']) => {
		if (!p) return '—';
		const propria = municipio.unidades.some((u) => u.id === p.plantonistaId);
		return `${rotuloTipoPlantao(p.tipo)}${p.plantonista && !propria ? ` · ${nomeCurtoDeUnidade(p.plantonista)}` : ''}`;
	};
</script>

<div class="card-elevated-2 rounded-2xl p-4">
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<a
			href="/municipios/{municipio.ibge}"
			class="text-sm font-semibold text-surface-900 no-underline dark:text-surface-50"
			>{municipio.nome}</a
		>
		<span class="text-3xs font-bold tracking-wide text-surface-500 uppercase"
			>{municipio.ais || '—'}</span
		>
	</div>
	<p class="text-xs text-surface-600 dark:text-surface-400">
		{#each municipio.unidades as un, i (un.id)}
			{#if i > 0}
				·
			{/if}<a href="/unidade/{un.id}" class="no-underline" title={un.nome}
				>{nomeCurtoDeUnidade(un.nome)}</a
			>
		{:else}
			Sem unidade responsável
		{/each}
	</p>
	<dl
		class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-surface-200 pt-2 text-xs dark:border-white/10"
	>
		<!-- Plantão ocupa a linha inteira: em duas colunas "Virtual · DP de Brejo
		     Santo" quebrava em três linhas na tela de 390 px. -->
		<div class="col-span-2 flex justify-between gap-3">
			<dt class="shrink-0 text-surface-600 dark:text-surface-400">Plantão na semana</dt>
			<dd class="text-right">{plantao(municipio.semana)}</dd>
		</div>
		<div class="col-span-2 flex justify-between gap-3">
			<dt class="shrink-0 text-surface-600 dark:text-surface-400">No fim de semana</dt>
			<dd class="text-right">{plantao(municipio.fds)}</dd>
		</div>
		<div class="flex justify-between gap-2">
			<dt class="text-surface-600 dark:text-surface-400">População</dt>
			<dd class="tabular-nums">
				{municipio.populacao != null ? fmt.format(municipio.populacao) : '—'}
			</dd>
		</div>
		<div class="flex justify-between gap-2">
			<dt class="text-surface-600 dark:text-surface-400">Hab./policial</dt>
			<dd class="font-semibold tabular-nums">
				{habPorPolicial != null ? fmt.format(habPorPolicial) : '—'}{#if efetivo > 0}
					<span class="ml-1 font-normal text-surface-500">({efetivo} pol.)</span>{/if}
			</dd>
		</div>
	</dl>
</div>
