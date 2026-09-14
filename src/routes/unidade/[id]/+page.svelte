<script lang="ts">
	/**
	 * A ficha da unidade (decisão E39, item 3.1).
	 *
	 * Três blocos: identificação (com a posição na árvore), efetivo por cargo e
	 * situação (cada número leva à lista de servidores já filtrada) e as
	 * unidades vinculadas. O quarto bloco — "dados previstos" — lista o que a
	 * ficha vai mostrar quando as fases 2 e 4 trouxerem as tabelas (endereço,
	 * telefone, foto, AIS, municípios, veículos, armas), para quem abre hoje
	 * saber que a forma é esta e o que falta é dado, não tela.
	 */
	import type { PageProps } from './$types';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';

	const { data }: PageProps = $props();

	const u = $derived(data.unidade);
	const hrefServidores = $derived(`/servidores?lotacao=${encodeURIComponent(u.nome)}`);

	const regimes = $derived(
		[u.tem_plantao && 'Plantão', u.tem_expediente && 'Expediente', u.tem_fds && 'Fim de semana']
			.filter(Boolean)
			.join(' · ')
	);

	/** Quem administra uma unidade só não tem lista para voltar. */
	const voltarPara = $derived(data.ehRaizDoEscopo && data.filhas.length === 0 ? '/' : '/unidade');

	const PREVISTOS = [
		{ campo: 'Endereço e telefone', fase: 'fase 2' },
		{ campo: 'Foto da unidade', fase: 'fase 2' },
		{ campo: 'AIS', fase: 'fase 2' },
		{ campo: 'Municípios atendidos', fase: 'fase 2' },
		{ campo: 'Veículos', fase: 'fase 4 · Patrimônio' },
		{ campo: 'Armas e algemas', fase: 'fase 4 · Patrimônio' }
	];

	const NUM = 'text-2xl font-bold tabular-nums text-surface-900 dark:text-surface-50';
	const ROTULO = 'text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase';
</script>

<svelte:head>
	<title>{u.nome} | Ecossistema PCCE</title>
</svelte:head>

<BotaoVoltar href={voltarPara} />

<div class="mb-6">
	<p
		class="text-2xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-400"
	>
		{u.tipoRotulo}{#if u.sigla}
			· {u.sigla}{/if}
	</p>
	<h1 class="h1 mt-0.5 text-2xl font-bold">{u.nome}</h1>
	<p class="mt-1 text-sm text-surface-600 dark:text-surface-400">
		{#if u.cidade}{u.cidade} ·
		{/if}
		{#if data.pai}
			Vinculada a
			{#if data.pai.noEscopo}
				<a href="/unidade/{data.pai.id}" class="font-medium">{data.pai.nome}</a>
			{:else}
				<span class="font-medium">{data.pai.nome}</span>
			{/if}
			({data.pai.tipoRotulo})
		{:else}
			Sem unidade superior cadastrada
		{/if}
		{#if u.abrangencia === 'corporativa'}
			· abrangência corporativa{/if}
	</p>
</div>

<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
	<!-- Efetivo -->
	<section class="card-elevated rounded-2xl p-5 lg:col-span-2" aria-labelledby="efetivo">
		<div class="mb-4 flex items-baseline justify-between gap-3">
			<h2 id="efetivo" class="text-base font-semibold text-surface-900 dark:text-surface-50">
				Efetivo
			</h2>
			<a href={hrefServidores} class="text-xs font-semibold text-primary-700 dark:text-primary-400">
				Ver servidores →
			</a>
		</div>
		<dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
			<div>
				<dt class={ROTULO}>Delegados (DPC)</dt>
				<dd class="mt-1">
					<a href="{hrefServidores}&cargo=DPC" class="{NUM} no-underline">{data.efetivo.dpc}</a>
				</dd>
			</div>
			<div>
				<dt class={ROTULO}>Oficiais (OIP)</dt>
				<dd class="mt-1">
					<a href="{hrefServidores}&cargo=OIP" class="{NUM} no-underline">{data.efetivo.oip}</a>
				</dd>
			</div>
			<div>
				<dt class={ROTULO}>Afastados hoje</dt>
				<dd class="mt-1 {NUM}">{data.efetivo.afastados}</dd>
			</div>
			<div>
				<dt class={ROTULO}>Ativos</dt>
				<dd class="mt-1 {NUM}">{data.efetivo.total}</dd>
			</div>
		</dl>
		{#if data.totalVinculadas > 0}
			<p class="mt-4 text-xs text-surface-500">
				Com as {data.totalVinculadas} unidade{data.totalVinculadas === 1 ? '' : 's'} vinculada{data.totalVinculadas ===
				1
					? ''
					: 's'}: {data.subtotal.total} servidores ({data.subtotal.dpc} DPC, {data.subtotal.oip} OIP,
				{data.subtotal.afastados} afastados).
			</p>
		{/if}
		{#if regimes}
			<p class="mt-2 text-xs text-surface-500">Regimes de escala: {regimes}.</p>
		{/if}
	</section>

	<!-- Dados previstos -->
	<section class="card-elevated rounded-2xl p-5" aria-labelledby="previstos">
		<h2 id="previstos" class="mb-3 text-base font-semibold text-surface-900 dark:text-surface-50">
			Dados previstos
		</h2>
		<ul class="space-y-2">
			{#each PREVISTOS as p (p.campo)}
				<li class="flex items-baseline justify-between gap-3 text-sm">
					<span class="text-surface-600 dark:text-surface-400">{p.campo}</span>
					<span class="shrink-0 text-2xs text-surface-400 uppercase">{p.fase}</span>
				</li>
			{/each}
		</ul>
	</section>
</div>

{#if data.filhas.length > 0}
	<section class="card-elevated mt-4 rounded-2xl p-5" aria-labelledby="vinculadas">
		<h2 id="vinculadas" class="mb-3 text-base font-semibold text-surface-900 dark:text-surface-50">
			Unidades vinculadas
		</h2>
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Unidade</th>
						<th class="text-right">DPC</th>
						<th class="text-right">OIP</th>
						<th class="text-right">Afastados</th>
						<th class="text-right">Servidores</th>
					</tr>
				</thead>
				<tbody>
					{#each data.filhas as f (f.id)}
						<tr>
							<td>
								<a href="/unidade/{f.id}" class="font-medium no-underline hover:text-primary-700"
									>{f.nome}</a
								>
								<span class="ml-2 text-2xs text-surface-500 uppercase">{f.tipoRotulo}</span>
							</td>
							<td class="text-right tabular-nums">{f.efetivo.dpc}</td>
							<td class="text-right tabular-nums">{f.efetivo.oip}</td>
							<td class="text-right tabular-nums">{f.efetivo.afastados}</td>
							<td class="text-right font-semibold tabular-nums">{f.efetivo.total}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}
