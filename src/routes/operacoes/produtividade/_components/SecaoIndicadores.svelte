<script lang="ts">
	/**
	 * "Indicadores e metas" — o bloco que responde "a operação está chegando onde
	 * prometeu?", por unidade.
	 *
	 * ## A forma escolhida, e por que não outra
	 *
	 * Um gráfico de barras horizontais por indicador, com DUAS séries por unidade
	 * (linha de base e realizado) e a meta como MARCA de referência, não como uma
	 * terceira barra. A meta não é um dado medido: é o limiar contra o qual se lê
	 * o realizado. Desenhá-la como barra a colocaria competindo com os dados e
	 * faria o gráfico parecer ter três medições onde há duas.
	 *
	 * Horizontal, e não vertical, porque o rótulo é nome de delegacia — em barras
	 * verticais nomes longos viram texto inclinado ou truncado.
	 *
	 * Um eixo só. Base, realizado e meta estão todos na mesma unidade de medida do
	 * indicador (procedimentos, dias, ocorrências), então compartilham escala; é o
	 * que torna a comparação visual legítima.
	 *
	 * ## Cores
	 *
	 * Duas séries, dois canais categóricos fixos (azul e laranja), validados
	 * contra as duas superfícies reais desta aplicação — `#ffffff` no claro e o
	 * `surface-900` no escuro — nas seis checagens de contraste e de visão de
	 * cores. Os passos do escuro são ESCOLHIDOS para o fundo escuro, não uma
	 * inversão automática do claro.
	 *
	 * A cor segue a série, nunca a posição: filtrar unidades não repinta nada.
	 *
	 * ## Nada depende só de cor
	 *
	 * A legenda está sempre presente, o valor de cada barra aparece no tooltip e
	 * a tabela ao pé do card repete tudo em texto. O selo de meta atingida leva
	 * ícone e palavra, não só o verde.
	 */
	import type { PainelIndicador } from '$lib/produtividade/metas';
	import { formatarValorIndicador, formatarPercentual } from '$lib/produtividade/metas';
	import { tituloNoPainel } from '$lib/produtividade/apresentacao';
	import Check from '@lucide/svelte/icons/check';
	import Clock from '@lucide/svelte/icons/clock';
	import TrendingDown from '@lucide/svelte/icons/trending-down';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import PieChart from '@lucide/svelte/icons/pie-chart';
	import Table from '@lucide/svelte/icons/table';
	import CardOrdenavel from './CardOrdenavel.svelte';
	import type { OrganizacaoPainel } from './useOrganizacaoPainel.svelte';
	import type { Chart as ChartJs, TooltipItem } from 'chart.js';

	// Mesmos apelidos de `$lib/composables/useCharts` — o construtor vem de lá,
	// carregado por import dinâmico no painel.
	type ChartCtor = typeof ChartJs;
	type ChartInstance = InstanceType<ChartCtor>;

	const {
		paineis,
		Chart,
		organizacao
	}: {
		paineis: PainelIndicador[];
		/** Chart.js já carregado pelo painel (import dinâmico); `null` antes disso. */
		Chart: ChartCtor | null;
		/** Estado do modo "Organizar"; `ativo` falso deixa a faixa como sempre foi. */
		organizacao: OrganizacaoPainel;
	} = $props();

	/**
	 * Paleta do bloco. Os pares claro/escuro saíram do validador com as
	 * superfícies desta aplicação — não trocar um hex isolado sem revalidar o
	 * conjunto.
	 */
	const CORES = {
		claro: {
			base: '#2a78d6',
			realizado: '#eb6834',
			meta: '#52514e',
			grade: '#e1e0d9',
			eixo: '#898781'
		},
		escuro: {
			base: '#3987e5',
			realizado: '#d95926',
			meta: '#c3c2b7',
			grade: '#2c2c2a',
			eixo: '#898781'
		}
	} as const;

	let temaEscuro = $state(false);
	const cores = $derived(temaEscuro ? CORES.escuro : CORES.claro);

	/**
	 * O tema é uma classe em `<html>`, trocada pelo botão do layout. Sem observar
	 * a troca, o gráfico ficaria com a tinta do tema anterior até um reload — e o
	 * modo escuro aqui é escolhido, não uma inversão automática.
	 */
	$effect(() => {
		if (typeof document === 'undefined') return;
		const raiz = document.documentElement;
		const ler = () => (temaEscuro = raiz.classList.contains('dark'));
		ler();
		const observador = new MutationObserver(ler);
		observador.observe(raiz, { attributes: true, attributeFilter: ['class'] });
		return () => observador.disconnect();
	});

	const canvases = $state<Record<string, HTMLCanvasElement>>({});
	let instancias: ChartInstance[] = [];

	/** Altura que cabe as barras E a faixa do eixo — card com scroll interno é sintoma de altura fixa. */
	function alturaDoGrafico(unidades: number): number {
		return Math.max(180, unidades * 58 + 56);
	}

	$effect(() => {
		// Dependências explícitas: recria ao trocar de operação, de filtro ou de tema.
		const listaPaineis = paineis;
		const ctor = Chart;
		const paleta = cores;

		for (const i of instancias) i.destroy();
		instancias = [];
		if (!ctor) return;

		for (const painel of listaPaineis) {
			const canvas = canvases[painel.indicador.key];
			if (!canvas) continue;

			const rotulos = painel.linhas.map((l) => l.unidadeNome);
			const unidadeMedida = painel.indicador.config.unidadeMedida ?? '';
			const cobertura = painel.indicador.config.metaTipo === 'proporcao';
			const alvo = painel.indicador.config.metaValor;

			// Em cobertura tudo no eixo é porcentagem; nos demais, a unidade de
			// medida do indicador. É a mesma escala em cada gráfico — o que muda
			// entre os dois é O QUE está sendo medido, não quantos eixos há.
			const formatar = cobertura ? formatarPercentual : formatarValorIndicador;
			const sufixo = cobertura ? '' : unidadeMedida ? ` ${unidadeMedida}` : '';

			const datasets = cobertura
				? [
						{
							label: 'Cobertura',
							data: painel.linhas.map((l) => l.cobertura),
							backgroundColor: paleta.realizado,
							borderRadius: 4,
							barPercentage: 0.86,
							categoryPercentage: 0.66
						},
						{
							// Limiar CONSTANTE: a mesma meta para todas as unidades. Repetir o
							// tique em cada linha é o que o mantém legível sem plugin de
							// anotação — e ele some onde não há cobertura a comparar.
							type: 'line' as const,
							label: `Meta (${alvo}%)`,
							data: painel.linhas.map((l) => (l.cobertura == null ? null : alvo)),
							showLine: false,
							pointStyle: 'line' as const,
							pointRotation: 90,
							pointRadius: 16,
							pointBorderWidth: 2,
							pointBorderColor: paleta.meta,
							pointBackgroundColor: paleta.meta
						}
					]
				: [
						{
							label: 'Linha de base',
							data: painel.linhas.map((l) => l.base),
							backgroundColor: paleta.base,
							borderRadius: 4,
							// Barras finas com folga entre elas: o respiro é o separador,
							// no lugar de uma borda desenhada em volta de cada marca.
							barPercentage: 0.86,
							categoryPercentage: 0.66
						},
						{
							label: 'Realizado',
							data: painel.linhas.map((l) => l.realizado),
							backgroundColor: paleta.realizado,
							borderRadius: 4,
							barPercentage: 0.86,
							categoryPercentage: 0.66
						},
						{
							// A meta é LIMIAR, não medição: entra como marca de referência
							// (um traço vertical na posição do alvo), sem linha ligando os
							// pontos e sem preenchimento.
							type: 'line' as const,
							label: `Meta${unidadeMedida ? ` (${unidadeMedida})` : ''}`,
							data: painel.linhas.map((l) => l.meta),
							showLine: false,
							// `pointRotation`, e não `rotation`: num dataset de linha o
							// giro do marcador é propriedade do PONTO. O traço de
							// `pointStyle: 'line'` nasce horizontal; 90° o põe de pé,
							// virando um tique vertical sobre a posição do alvo.
							pointStyle: 'line' as const,
							pointRotation: 90,
							pointRadius: 16,
							pointBorderWidth: 2,
							pointBorderColor: paleta.meta,
							pointBackgroundColor: paleta.meta
						}
					];

			instancias.push(
				new ctor(canvas, {
					type: 'bar',
					data: { labels: rotulos, datasets },
					options: {
						indexAxis: 'y',
						responsive: true,
						maintainAspectRatio: false,
						interaction: { mode: 'index', intersect: false },
						layout: { padding: { top: 4, right: 12, bottom: 4, left: 0 } },
						plugins: {
							legend: {
								position: 'top',
								align: 'end',
								labels: {
									boxWidth: 10,
									boxHeight: 10,
									usePointStyle: true,
									color: paleta.eixo,
									font: { size: 11 }
								}
							},
							tooltip: {
								callbacks: {
									label: (ctx: TooltipItem<'bar' | 'line'>) =>
										`${ctx.dataset.label}: ${formatar(ctx.parsed.x)}${sufixo}`
								}
							}
						},
						scales: {
							x: {
								beginAtZero: true,
								// Sem isto, um painel em que todo mundo cobriu 40% desenharia o
								// eixo até 40 e a meta de 100% ficaria fora do gráfico.
								suggestedMax: cobertura ? Math.max(100, alvo) : undefined,
								// Hairline sólida: tracejado lê como projeção ou limiar, e aqui
								// é só grade.
								grid: { color: paleta.grade },
								border: { display: false },
								ticks: {
									color: paleta.eixo,
									font: { size: 11 },
									// Sem isto o eixo sai com o separador de milhar do inglês
									// ("1,000") num sistema inteiramente em português.
									callback: (v: string | number) => formatar(Number(v))
								}
							},
							y: {
								grid: { display: false },
								ticks: { color: paleta.eixo, font: { size: 11 }, autoSkip: false }
							}
						}
					}
				})
			);
		}

		return () => {
			for (const i of instancias) i.destroy();
			instancias = [];
		};
	});

	/** Sinal do objetivo, em texto — o selo não depende de cor nem de seta sozinha. */
	function rotuloMeta(p: PainelIndicador): string {
		const c = p.indicador.config;
		// Cobertura não tem direção: "aumentar 100%" seria falso, o alvo é cobrir o
		// total, não elevar um número.
		if (c.metaTipo === 'proporcao') {
			return `cobrir ${c.metaValor}% do total${c.unidadeMedida ? ` de ${c.unidadeMedida}` : ''}`;
		}
		const direcao = c.objetivo === 'diminuir' ? 'reduzir' : 'aumentar';
		return c.metaTipo === 'percentual'
			? `${direcao} ${c.metaValor}%`
			: `${direcao} para ${c.metaValor}${c.unidadeMedida ? ` ${c.unidadeMedida}` : ''}`;
	}

	/** O indicador mede cobertura? Decide a forma do gráfico E as colunas da tabela. */
	function ehCobertura(p: PainelIndicador): boolean {
		return p.indicador.config.metaTipo === 'proporcao';
	}

	const tabelaAberta = $state<Record<string, boolean>>({});
</script>

{#if paineis.length > 0}
	<!-- O card em si, sem a moldura de arraste — um snippet só para os dois ramos
	     do modo "Organizar", senão a versão organizável e a normal divergem. -->
	{#snippet cardIndicador(painel: PainelIndicador)}
		<article
			class="card-elevated rounded-2xl border border-surface-200 p-4 sm:p-6 dark:border-surface-800"
		>
			<header class="flex flex-wrap items-start justify-between gap-3">
				<div class="min-w-0">
					<h3 class="text-base font-semibold">{tituloNoPainel(painel.indicador)}</h3>
					<p
						class="mt-1 inline-flex items-center gap-1.5 text-2xs font-semibold text-surface-600 dark:text-surface-400"
					>
						<!-- `metaTipo` inline, e não `ehCobertura()`: só a comparação
							     direta estreita a união e libera `objetivo` no ramo de baixo. -->
						{#if painel.indicador.config.metaTipo === 'proporcao'}
							<PieChart class="h-3.5 w-3.5" aria-hidden="true" />
						{:else if painel.indicador.config.objetivo === 'diminuir'}
							<TrendingDown class="h-3.5 w-3.5" aria-hidden="true" />
						{:else}
							<TrendingUp class="h-3.5 w-3.5" aria-hidden="true" />
						{/if}
						Meta: {rotuloMeta(painel)}
					</p>
				</div>

				<!-- O número é a manchete do card: "quantas unidades chegaram lá".
					     Fica em tile, não em gráfico — um gráfico de uma fração só é
					     mais desenho do que informação. -->
				<div class="shrink-0 text-right">
					<p class="text-2xl font-bold leading-none">
						{painel.unidadesAtingiram}<span
							class="text-base font-semibold text-surface-600 dark:text-surface-400"
							>/{painel.unidadesComMeta}</span
						>
					</p>
					<p class="mt-1 text-3xs uppercase tracking-widest text-surface-600 dark:text-surface-400">
						unidades na meta
					</p>
				</div>
			</header>

			{#if painel.basesPendentes > 0}
				<p
					class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-warning-500/10 px-2.5 py-1.5 text-2xs text-warning-700 dark:text-warning-400"
				>
					<Clock class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					{painel.basesPendentes === 1
						? '1 unidade ainda não informou a linha de base — sem ela a meta dela não é calculável.'
						: `${painel.basesPendentes} unidades ainda não informaram a linha de base — sem ela a meta delas não é calculável.`}
				</p>
			{/if}

			<div class="mt-4 w-full" style="height: {alturaDoGrafico(painel.linhas.length)}px">
				<canvas
					bind:this={canvases[painel.indicador.key]}
					aria-label={ehCobertura(painel)
						? `Cobertura e meta por unidade — ${tituloNoPainel(painel.indicador)}`
						: `Linha de base, realizado e meta por unidade — ${tituloNoPainel(painel.indicador)}`}
				></canvas>
			</div>

			<!-- O gêmeo em texto do gráfico. Não é extra: é como o valor exato fica
				     acessível sem depender de passar o mouse. -->
			<button
				type="button"
				class="mt-3 inline-flex items-center gap-1.5 text-2xs font-semibold text-surface-600 hover:text-primary-600 dark:text-surface-400"
				onclick={() => (tabelaAberta[painel.indicador.key] = !tabelaAberta[painel.indicador.key])}
				aria-expanded={!!tabelaAberta[painel.indicador.key]}
			>
				<Table class="h-3.5 w-3.5" aria-hidden="true" />
				{tabelaAberta[painel.indicador.key] ? 'Ocultar tabela' : 'Ver como tabela'}
			</button>

			{#if tabelaAberta[painel.indicador.key]}
				<div class="table-wrap mt-3">
					<table class="table text-sm">
						<thead>
							<tr>
								<th class="text-left">Unidade</th>
								{#if ehCobertura(painel)}
									<!-- O total só aparece aqui: ele não cabe no eixo do gráfico
										     (é contagem, não porcentagem), mas é o denominador que
										     torna a cobertura conferível. -->
									<th class="text-right">Total</th>
									<th class="text-right">Atendidas</th>
									<th class="text-right">Cobertura</th>
								{:else}
									<th class="text-right">Linha de base</th>
									<th class="text-right">Realizado</th>
									<th class="text-right">Meta</th>
								{/if}
								<th class="text-right">Atingimento</th>
							</tr>
						</thead>
						<tbody>
							{#each painel.linhas as linha (linha.unidadeId)}
								<tr>
									<td class="text-left">{linha.unidadeNome}</td>
									{#if ehCobertura(painel)}
										<td class="text-right tabular-nums">
											{formatarValorIndicador(linha.total)}
										</td>
										<td class="text-right tabular-nums">
											{formatarValorIndicador(linha.realizado)}
										</td>
										<td class="text-right tabular-nums">
											{#if linha.cobertura == null}
												<span class="text-surface-600 dark:text-surface-400">sem ocorrências</span>
											{:else}
												{formatarPercentual(linha.cobertura)}
											{/if}
										</td>
									{:else}
										<td class="text-right tabular-nums">
											{#if linha.basePendente}
												<span class="text-warning-700 dark:text-warning-400">não informada</span>
											{:else}
												{formatarValorIndicador(linha.base)}
											{/if}
										</td>
										<td class="text-right tabular-nums">
											{formatarValorIndicador(linha.realizado)}
										</td>
										<td class="text-right tabular-nums">{formatarValorIndicador(linha.meta)}</td>
									{/if}
									<td class="text-right tabular-nums">
										{#if linha.atingimento == null}
											—
										{:else}
											<span class="inline-flex items-center justify-end gap-1">
												{#if linha.atingida}
													<Check
														class="h-3.5 w-3.5 text-success-600 dark:text-success-400"
														aria-hidden="true"
													/>
												{/if}
												{Math.round(linha.atingimento)}%
											</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</article>
	{/snippet}

	<section class="space-y-6">
		<div>
			<h2 class="text-lg font-bold">Indicadores e metas</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
				Linha de base, realizado no período e meta — por unidade participante da operação.
			</p>
		</div>

		<div class="space-y-6" role={organizacao.ativo ? 'list' : undefined}>
			{#each paineis as painel, indice (painel.indicador.key)}
				{#if organizacao.ativo}
					<CardOrdenavel
						{organizacao}
						secao="indicadores"
						{indice}
						total={paineis.length}
						rotulo={tituloNoPainel(painel.indicador)}
					>
						{@render cardIndicador(painel)}
					</CardOrdenavel>
				{:else}
					{@render cardIndicador(painel)}
				{/if}
			{/each}
		</div>
	</section>
{/if}
