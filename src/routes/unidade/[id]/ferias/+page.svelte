<script lang="ts">
	/**
	 * As férias da unidade no ano, mês a mês — a visão do gestor local.
	 *
	 * Cada mês mostra quem está de férias em algum dia dele e o percentual da
	 * unidade que isso representa. O teto de 15 % (Dec. 32.907, art. 6º I) só
	 * AVISA: a decisão é do gestor e o decreto tem exceções. Para seccional e
	 * departamento a conta é por unidade, não pelo total — é assim que a COGEP
	 * aplica.
	 */
	import type { PageProps } from './$types';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import { formatarData, MESES_PT } from '$lib/utils/datas';
	import { nomeCurtoDeUnidade } from '$lib/unidades/nome';
	import { percentualEmFerias, TETO_PERCENTUAL_EM_FERIAS } from '$lib/servidores/ferias';

	const { data }: PageProps = $props();

	const mesISO = (m: number) => `${data.ano}-${String(m + 1).padStart(2, '0')}`;

	/** As férias que tocam o mês (qualquer dia dele). */
	const noMes = (m: number) => {
		const ini = `${mesISO(m)}-01`;
		const fim = `${mesISO(m)}-31`;
		return data.ferias.filter((f) => f.data_inicio <= fim && f.data_fim >= ini);
	};

	/** Pessoas distintas por lotação no mês — duas frações de alguém contam uma. */
	const porLotacaoNoMes = (m: number) => {
		// Estruturas locais à função, montadas e devolvidas — não são estado vivo.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const mapa = new Map<string, Set<number>>();
		for (const f of noMes(m)) {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const s = mapa.get(f.lotacao) ?? new Set<number>();
			s.add(f.policial_id);
			mapa.set(f.lotacao, s);
		}
		return mapa;
	};

	const varias = $derived(data.lotacoes.length > 1);
	const totalPend = $derived(
		Object.values(data.pendencias).reduce(
			(acc, p) => ({
				r: acc.r + p.reprogramacoesPendentes,
				a: acc.a + p.abonosSemCiencia
			}),
			{ r: 0, a: 0 }
		)
	);
</script>

<svelte:head>
	<title>Férias {data.ano} · {data.unidade.sigla || data.unidade.nome} | Ecossistema PCCE</title>
</svelte:head>

<BotaoVoltar href="/unidade/{data.unidade.id}" />

<div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
	<div>
		<p
			class="text-2xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-400"
		>
			Férias · {data.unidade.sigla || data.unidade.nome}
		</p>
		<h1 class="h1 mt-0.5 text-2xl font-bold">Programação de {data.ano}</h1>
		<p class="mt-1 text-sm text-surface-600 dark:text-surface-400">
			Quem está de férias em cada mês e quanto da unidade isso representa. O teto de
			{TETO_PERCENTUAL_EM_FERIAS} % só avisa — a COGEP confere no 1º período.
		</p>
	</div>
	<div class="flex items-center gap-2">
		<a href="?ano={data.ano - 1}" class="btn btn-sm preset-outlined-surface-500">← {data.ano - 1}</a
		>
		<a href="?ano={data.ano + 1}" class="btn btn-sm preset-outlined-surface-500">{data.ano + 1} →</a
		>
	</div>
</div>

{#if totalPend.r > 0 || totalPend.a > 0}
	<div
		class="mb-4 rounded-xl border border-warning-500/40 bg-warning-500/10 p-3 text-sm text-warning-800 dark:text-warning-300"
		role="alert"
	>
		<span class="font-semibold">⚠ Pendências:</span>
		{[
			totalPend.r > 0 && `${totalPend.r} pedido${totalPend.r === 1 ? '' : 's'} aguardando a COGEP`,
			totalPend.a > 0 && `${totalPend.a} abono${totalPend.a === 1 ? '' : 's'} sem ciência`
		]
			.filter(Boolean)
			.join(' · ')}. Resolva na ficha do servidor.
	</div>
{/if}

<div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
	{#each MESES_PT as nome, m (m)}
		{@const lista = noMes(m)}
		{@const porLot = porLotacaoNoMes(m)}
		<section class="card-elevated rounded-2xl p-4" aria-label="{nome} de {data.ano}">
			<div class="mb-2 flex items-baseline justify-between gap-2">
				<h2 class="text-sm font-bold text-surface-900 dark:text-surface-50">{nome}</h2>
				<span class="text-xs text-surface-500">{lista.length === 0 ? '—' : `${lista.length}`}</span>
			</div>

			<!-- O percentual, por unidade: é assim que o teto se aplica. -->
			{#each [...porLot.entries()] as [lotacao, pessoas] (lotacao)}
				{@const efetivo = data.efetivos[lotacao] ?? 0}
				{@const pct = percentualEmFerias(pessoas.size, efetivo)}
				{@const prefixo = varias ? nomeCurtoDeUnidade(lotacao) + ': ' : ''}
				{@const aviso = pct > TETO_PERCENTUAL_EM_FERIAS ? ' ⚠ acima do teto' : ''}
				<p
					class="text-2xs {pct > TETO_PERCENTUAL_EM_FERIAS
						? 'font-semibold text-warning-700 dark:text-warning-400'
						: 'text-surface-500'}"
				>
					{prefixo}{pessoas.size} de {efetivo} · {pct} %{aviso}
				</p>
			{/each}

			<!-- Numa unidade só, os nomes já aparecem abertos. Numa seccional ou no
			     departamento, o que o gestor olha primeiro é o percentual de cada
			     unidade; os nomes ficam a um clique, para o mês não virar uma lista
			     de sessenta linhas. -->
			{#if lista.length > 0}
				<details class="mt-2" open={!varias}>
					<summary
						class="cursor-pointer text-2xs font-semibold text-surface-600 dark:text-surface-400"
					>
						{varias
							? lista.length === 1
								? 'Ver o nome'
								: `Ver os ${lista.length} nomes`
							: 'Nomes'}
					</summary>
					<ul class="mt-1 space-y-1 text-xs">
						{#each lista as f (f.policial_id + f.data_inicio)}
							<li class="flex flex-wrap items-baseline justify-between gap-x-2">
								<a href="/servidores/{f.policial_id}" class="font-medium no-underline">{f.nome}</a>
								<span class="tabular-nums text-surface-500">
									{#if varias}<span class="text-surface-400"
											>{nomeCurtoDeUnidade(f.lotacao)} ·
										</span>{/if}{formatarData(f.data_inicio)} – {formatarData(
										f.data_fim
									)}{#if f.ordem}
										· {f.ordem}ª{/if}
								</span>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		</section>
	{/each}
</div>
