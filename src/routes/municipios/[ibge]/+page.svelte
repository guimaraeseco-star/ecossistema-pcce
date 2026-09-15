<script lang="ts">
	/**
	 * Municípios — a FICHA de um município (fase 2-B, decisão E32): quem atende
	 * (com a seccional), o plantão da semana e do fim de semana, e a cobertura
	 * das outras forças e órgãos que a planilha traz — núcleo de custódia,
	 * RISP, comando e batalhão da PM, batalhão e companhia do BM, PEFOCE —,
	 * mais área e população. Só leitura (E6).
	 */
	import type { PageProps } from './$types';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import { rotuloTipoPlantao } from '$lib/unidades/plantao';

	const { data }: PageProps = $props();
	const m = $derived(data.municipio);

	const fmt = new Intl.NumberFormat('pt-BR');
	const plantao = (
		p: { tipo: string; plantonistaId: number | null; plantonista: string } | null
	) => (p ? `${rotuloTipoPlantao(p.tipo)}${p.plantonista ? ` · ${p.plantonista}` : ''}` : '—');

	const ROTULO = 'text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase';
	const VALOR = 'mt-1 text-sm text-surface-900 dark:text-surface-50';

	/** Os campos da cobertura, na ordem da planilha; vazio vira "—". */
	const cobertura = $derived([
		['AIS', m.ais],
		['Macrorregião', m.macrorregiao],
		['Núcleo de custódia', m.nucleoCustodia],
		['RISP', m.risp],
		['Comando da PM', m.comandoPm],
		['Batalhão da PM', m.batalhaoPm],
		['Batalhão do BM', m.batalhaoBm],
		['Companhia do BM', m.companhiaBm],
		['PEFOCE', m.pefoce]
	]);
</script>

<svelte:head>
	<title>{m.nome} | Ecossistema PCCE</title>
</svelte:head>

<BotaoVoltar href="/municipios" />

<div class="mb-6">
	<p
		class="text-2xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-400"
	>
		Município · {data.departamento.sigla || data.departamento.nome}{#if m.ais}
			· {m.ais}{/if}
	</p>
	<h1 class="h1 mt-0.5 text-2xl font-bold">{m.nome}</h1>
	<p class="mt-1 text-sm text-surface-600 dark:text-surface-400">
		IBGE {m.ibge}
		{#if m.populacao != null}
			· {fmt.format(m.populacao)} habitantes ({m.populacaoFonte}){/if}
		{#if m.populacaoCenso != null && m.populacaoFonte !== 'Censo 2022'}
			· Censo 2022: {fmt.format(m.populacaoCenso)}{/if}
		{#if m.areaKm2 != null}
			· {fmt.format(Math.round(m.areaKm2))} km²{/if}
		·
		<a
			href="https://www.google.com/maps?q={m.lat},{m.lon}"
			target="_blank"
			rel="noopener noreferrer">ver no mapa</a
		>
	</p>
</div>

<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
	<section class="card-elevated rounded-2xl p-5 lg:col-span-2" aria-labelledby="atendimento">
		<h2 id="atendimento" class="mb-4 text-base font-semibold text-surface-900 dark:text-surface-50">
			Atendimento
		</h2>
		{#if m.unidades.length > 0}
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr class="text-2xs">
							<th>Unidade que atende</th>
							<th>Seccional</th>
							<th class="text-right">Efetivo</th>
						</tr>
					</thead>
					<tbody>
						{#each m.unidades as un (un.id)}
							<tr>
								<td>
									<a href="/unidade/{un.id}" class="font-medium no-underline hover:underline"
										>{un.nome}</a
									>
								</td>
								<td class="text-sm">{un.seccional || '—'}</td>
								<td class="text-right text-sm tabular-nums">{un.efetivo > 0 ? un.efetivo : '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-sm text-surface-500">Nenhuma unidade atende este município.</p>
		{/if}
		<dl class="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
			<div>
				<dt class={ROTULO}>Plantão na semana</dt>
				<dd class={VALOR}>{plantao(m.semana)}</dd>
			</div>
			<div>
				<dt class={ROTULO}>Plantão no fim de semana</dt>
				<dd class={VALOR}>{plantao(m.fds)}</dd>
			</div>
			<div>
				<dt class={ROTULO}>Efetivo lotado</dt>
				<dd class={VALOR}>{m.efetivo > 0 ? m.efetivo : '—'}</dd>
			</div>
			<div>
				<dt class={ROTULO}>Habitantes por policial</dt>
				<dd class={VALOR}>
					{#if m.habPorPolicial != null}
						1 policial para {fmt.format(m.habPorPolicial)} hab.
					{:else}
						—
					{/if}
				</dd>
			</div>
		</dl>
	</section>

	<section class="card-elevated rounded-2xl p-5" aria-labelledby="cobertura">
		<h2 id="cobertura" class="mb-4 text-base font-semibold text-surface-900 dark:text-surface-50">
			Cobertura
		</h2>
		<dl class="grid grid-cols-1 gap-3">
			{#each cobertura as [rotulo, valor] (rotulo)}
				<div>
					<dt class={ROTULO}>{rotulo}</dt>
					<dd class={VALOR}>{valor || '—'}</dd>
				</div>
			{/each}
		</dl>
	</section>
</div>
