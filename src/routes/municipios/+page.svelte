<script lang="ts">
	/**
	 * Municípios — a LISTA do departamento (fase 2-B, decisão E32): um
	 * município por linha, com quem o atende, a AIS, a macrorregião e o plantão
	 * da semana e do fim de semana, a população e a proporção habitantes por
	 * policial lotado. O nome abre a ficha (`/municipios/[ibge]`); a unidade
	 * que atende abre a ficha dela (`/unidade/[id]`).
	 *
	 * "Atualizar população (IBGE)" baixa Censo e estimativa para a cobertura
	 * inteira (action do servidor); a fonte mostrada no cabeçalho diz qual das
	 * duas está na tela.
	 *
	 * A busca é do CLIENTE e casa com qualquer parte do nome do município, da
	 * unidade, da AIS ou da macrorregião — são dezenas de linhas, todas já
	 * carregadas. Cabeçalho e linha de colunas ficam fixos ao rolar, como na
	 * Gestão de unidade.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import Search from '@lucide/svelte/icons/search';
	import { toaster } from '$lib/toast';
	import { CLASSE_INPUT_FILTRO } from '$lib/gise/filtro-historico-ui';
	import { rotuloTipoPlantao } from '$lib/unidades/plantao';

	const { data }: PageProps = $props();

	let busca = $state('');
	let alturaCabecalho = $state(0);
	const topoColunas = $derived(`calc(3.5rem + ${alturaCabecalho}px)`);
	const TH_FIXO = 'sticky z-10 bg-white dark:bg-surface-900';

	type Municipio = (typeof data.municipios)[number];

	const filtrados = $derived.by((): Municipio[] => {
		const termo = busca.trim().toLowerCase();
		if (!termo) return data.municipios;
		return data.municipios.filter((m) =>
			[m.nome, m.ais, m.macrorregiao, ...m.unidades.map((u) => u.nome)].some((s) =>
				s.toLowerCase().includes(termo)
			)
		);
	});

	/** "Físico · DP de Icó" — ou só o tipo quando o plantonista é a própria unidade. */
	const plantao = (m: Municipio, p: Municipio['semana']) => {
		if (!p) return '—';
		const propria = m.unidades.some((u) => u.id === p.plantonistaId);
		return `${rotuloTipoPlantao(p.tipo)}${p.plantonista && !propria ? ` · ${p.plantonista}` : ''}`;
	};

	const populacaoTotal = $derived(data.municipios.reduce((n, m) => n + (m.populacao ?? 0), 0));
	const efetivoTotal = $derived(data.departamento.efetivo);
	/** A fonte mais frequente entre os municípios ("estimativa 2026" / "Censo 2022"). */
	const fonte = $derived.by(() => {
		const contagem: Record<string, number> = {};
		for (const m of data.municipios)
			if (m.populacaoFonte) contagem[m.populacaoFonte] = (contagem[m.populacaoFonte] ?? 0) + 1;
		return Object.entries(contagem).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
	});
	const fmt = new Intl.NumberFormat('pt-BR');
	let atualizando = $state(false);
</script>

<svelte:head>
	<title>Municípios | Ecossistema PCCE</title>
</svelte:head>

<div
	bind:clientHeight={alturaCabecalho}
	class="sticky top-14 z-20 -mx-2 mb-4 flex flex-col gap-3 border-b border-surface-200 bg-page-canvas px-2 pt-2 pb-3 sm:-mx-4 sm:flex-row sm:items-end sm:justify-between sm:px-4 dark:border-white/10 dark:bg-surface-950"
>
	<div>
		<p
			class="text-2xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-400"
		>
			Municípios
		</p>
		<h1 class="h1 mt-0.5 text-2xl font-bold">
			{data.departamento.sigla || data.departamento.nome}
		</h1>
		<p class="mt-1 text-sm text-surface-600 dark:text-surface-400">
			{data.municipios.length} município{data.municipios.length === 1 ? '' : 's'} atendido{data
				.municipios.length === 1
				? ''
				: 's'}
			{#if populacaoTotal > 0}
				· {fmt.format(populacaoTotal)} habitantes ({fonte}){/if}
			{#if efetivoTotal > 0 && populacaoTotal > 0}
				· 1 policial para {fmt.format(Math.round(populacaoTotal / efetivoTotal))} hab.{/if}
		</p>
	</div>
	<div class="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
		<div class="flex gap-2">
			<a href="/municipios/mapa" class="btn btn-sm preset-outlined-surface-500">Ver no mapa</a>
			{#if data.usuario?.tipo === 'admin'}
				<form
					method="POST"
					action="?/atualizarPopulacao"
					use:enhance={() => {
						atualizando = true;
						return async ({ result, update }) => {
							atualizando = false;
							if (result.type === 'success') {
								const d = result.data as { atualizados?: number; anoEstimativa?: number | null };
								toaster.success({
									title: `População atualizada: ${d.atualizados ?? 0} municípios`,
									description: d.anoEstimativa ? `Estimativa do IBGE para ${d.anoEstimativa}` : ''
								});
							} else if (result.type === 'failure') {
								toaster.error({
									title: String(result.data?.error ?? 'Não foi possível atualizar')
								});
							}
							await update({ reset: false });
						};
					}}
				>
					<button
						type="submit"
						class="btn btn-sm preset-outlined-surface-500 self-start sm:self-auto"
						disabled={atualizando}
					>
						{atualizando ? 'Consultando o IBGE…' : 'Atualizar população (IBGE)'}
					</button>
				</form>
			{/if}
		</div>
		<div class="relative w-full sm:w-80">
			<input
				type="search"
				class="{CLASSE_INPUT_FILTRO} w-full pl-10"
				bind:value={busca}
				placeholder="Buscar município…"
				aria-label="Buscar município (qualquer parte do nome, da unidade, da AIS ou da macrorregião)"
			/>
			<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center opacity-50">
				<Search class="h-4 w-4" />
			</div>
		</div>
	</div>
</div>

<!-- Sem overflow-hidden no card e sem rolagem no wrap: sticky só funciona
     contra a rolagem da PÁGINA (mesma escolha da Gestão de unidade). -->
<div class="card-elevated rounded-2xl p-4 shadow-sm sm:p-6">
	<div class="table-wrap lg:overflow-visible">
		<table class="table">
			<thead>
				<tr class="text-2xs">
					<th class={TH_FIXO} style:top={topoColunas}>Município</th>
					<th class={TH_FIXO} style:top={topoColunas}>Atendido por</th>
					<th class={TH_FIXO} style:top={topoColunas}>AIS</th>
					<th class={TH_FIXO} style:top={topoColunas}>Macrorregião</th>
					<th class={TH_FIXO} style:top={topoColunas}>Plantão na semana</th>
					<th class={TH_FIXO} style:top={topoColunas}>Plantão no fim de semana</th>
					<th class="{TH_FIXO} text-right" style:top={topoColunas}>População</th>
					<th class="{TH_FIXO} text-right" style:top={topoColunas}>Efetivo</th>
					<th class="{TH_FIXO} text-right" style:top={topoColunas}>Hab./policial</th>
				</tr>
			</thead>
			<tbody>
				{#each filtrados as m (m.ibge)}
					<tr>
						<td>
							<a
								href="/municipios/{m.ibge}"
								class="font-medium text-surface-900 no-underline hover:text-primary-700 dark:text-surface-50 dark:hover:text-primary-400"
							>
								{m.nome}
							</a>
						</td>
						<td class="text-sm">
							{#each m.unidades as un, i (un.id)}
								{#if i > 0}<br />{/if}
								<a href="/unidade/{un.id}" class="no-underline hover:underline">{un.nome}</a>
							{:else}
								<span class="text-surface-400">—</span>
							{/each}
						</td>
						<td class="text-sm whitespace-nowrap">{m.ais || '—'}</td>
						<td class="text-sm">{m.macrorregiao || '—'}</td>
						<td class="text-sm">{plantao(m, m.semana)}</td>
						<td class="text-sm">{plantao(m, m.fds)}</td>
						<td class="text-right text-sm tabular-nums">
							{m.populacao != null ? fmt.format(m.populacao) : '—'}
						</td>
						<td class="text-right text-sm tabular-nums">{m.efetivo > 0 ? m.efetivo : '—'}</td>
						<td class="text-right text-sm font-semibold tabular-nums">
							{m.habPorPolicial != null ? fmt.format(m.habPorPolicial) : '—'}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="9" class="py-6 text-center text-sm text-surface-500">
							Nenhum município corresponde à busca.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if busca.trim()}
		<p class="mt-3 text-xs text-surface-500">
			{filtrados.length} de {data.municipios.length} município{data.municipios.length === 1
				? ''
				: 's'}
		</p>
	{/if}
</div>
