<script lang="ts">
	/**
	 * Gestão de unidade — a LISTA (decisão E39, itens 3.2 e 3.3).
	 *
	 * A raiz do escopo vai fixa no topo (a seccional para o admin de seccional,
	 * o departamento para o Admin Geral); abaixo, um bloco por unidade filha
	 * com as que respondem a ela. Todo número é link: o efetivo abre
	 * `/servidores` já filtrado pela lotação, e o nome abre a ficha
	 * (`/unidade/[id]`), que é onde a delegacia é vista por inteiro.
	 *
	 * A busca é do CLIENTE e casa com qualquer parte do nome, da sigla ou do
	 * tipo — são dezenas de linhas, todas já carregadas. Um bloco fica quando a
	 * própria unidade OU alguma filha casa, para a hierarquia não se perder no
	 * filtro.
	 *
	 * Veículos e armas: colunas presentes, valor "—", até a fase 4 trazer as
	 * tabelas — a organização da tela já é a definitiva.
	 */
	import type { PageProps } from './$types';
	import type { BlocoUnidade, LinhaUnidade } from './+page.server';
	import Search from '@lucide/svelte/icons/search';
	import { CLASSE_INPUT_FILTRO } from '$lib/gise/filtro-historico-ui';

	const { data }: PageProps = $props();

	let busca = $state('');

	/**
	 * Alturas medidas do cabeçalho fixo e da primeira linha do `thead`: os
	 * `th` são `position: sticky` e precisam saber onde parar — abaixo da barra
	 * do topo (h-14 = 3.5rem), do cabeçalho da página e, na segunda linha, da
	 * primeira. Medir (`bind:clientHeight`) em vez de fixar números é o que
	 * mantém as três camadas alinhadas quando o texto quebra em tela estreita.
	 */
	let alturaCabecalho = $state(0);
	let alturaLinha1 = $state(0);
	const topoLinha1 = $derived(`calc(3.5rem + ${alturaCabecalho}px)`);
	const topoLinha2 = $derived(`calc(3.5rem + ${alturaCabecalho + alturaLinha1}px)`);
	/** Fundo opaco dos th fixos: o mesmo do card, senão as linhas passam por trás. */
	const TH_FIXO = 'sticky z-10 bg-white dark:bg-surface-900';

	const casa = (u: LinhaUnidade, termo: string) =>
		!termo || [u.nome, u.sigla, u.tipoRotulo].some((s) => s.toLowerCase().includes(termo));

	const blocosFiltrados = $derived.by((): BlocoUnidade[] => {
		const termo = busca.trim().toLowerCase();
		if (!termo) return data.blocos;
		return data.blocos
			.map((b) => {
				const filhas = b.filhas.filter((f) => casa(f, termo));
				if (casa(b.unidade, termo)) return { unidade: b.unidade, filhas: b.filhas };
				return filhas.length ? { unidade: b.unidade, filhas } : null;
			})
			.filter((b): b is BlocoUnidade => b !== null);
	});

	const totalLinhas = $derived(1 + data.blocos.reduce((n, b) => n + 1 + b.filhas.length, 0));

	const titulo = $derived(data.usuario?.tipo === 'admin' ? 'Departamento' : 'Minha seccional');

	const hrefServidores = (u: LinhaUnidade) => `/servidores?lotacao=${encodeURIComponent(u.nome)}`;

	const CELULA_NUM = 'text-right tabular-nums';
	const LINK_NUM =
		'inline-block min-w-6 rounded px-1 font-semibold text-primary-700 no-underline hover:bg-primary-500/10 dark:text-primary-400';
</script>

<svelte:head>
	<title>{titulo} | Ecossistema PCCE</title>
</svelte:head>

<!--
	Cabeçalho FIXO (sticky, logo abaixo da barra do topo, que tem h-14): o título
	e a busca ficam visíveis enquanto a lista rola — pedido do responsável em
	15/09/2026. O fundo opaco é o que evita a tabela passar por trás do texto.
-->
<div
	bind:clientHeight={alturaCabecalho}
	class="sticky top-14 z-20 -mx-2 mb-4 flex flex-col gap-3 border-b border-surface-200 bg-page-canvas px-2 pt-2 pb-3 sm:-mx-4 sm:flex-row sm:items-end sm:justify-between sm:px-4 dark:border-white/10 dark:bg-surface-950"
>
	<div>
		<p
			class="text-2xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-400"
		>
			Gestão de unidade
		</p>
		<h1 class="h1 mt-0.5 text-2xl font-bold">{data.raiz.nome}</h1>
		<p class="mt-1 text-sm text-surface-600 dark:text-surface-400">
			{data.raiz.tipoRotulo}
			{#if data.raiz.sigla}· {data.raiz.sigla}{/if}
			· {data.raiz.vinculadas} unidade{data.raiz.vinculadas === 1 ? '' : 's'} vinculada{data.raiz
				.vinculadas === 1
				? ''
				: 's'}
			· {data.raiz.subtotal.total} servidor{data.raiz.subtotal.total === 1 ? '' : 'es'} no total · {data
				.raiz.municipiosSubtotal} município{data.raiz.municipiosSubtotal === 1 ? '' : 's'} atendido{data
				.raiz.municipiosSubtotal === 1
				? ''
				: 's'}
		</p>
	</div>
	<div class="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
		<a
			href="/unidade/{data.raiz.id}"
			class="btn btn-sm preset-outlined-surface-500 self-start sm:self-auto"
		>
			Ficha de {data.raiz.sigla || data.raiz.nome}
		</a>
		<div class="relative w-full sm:w-80">
			<input
				type="search"
				class="{CLASSE_INPUT_FILTRO} w-full pl-10"
				bind:value={busca}
				placeholder="Buscar unidade…"
				aria-label="Buscar unidade (qualquer parte do nome, da sigla ou do tipo)"
			/>
			<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center opacity-50">
				<Search class="h-4 w-4" />
			</div>
		</div>
	</div>
</div>

<!-- Por cargo: ativos · férias · afastados. O número é link para a lista de
     servidores já filtrada pela lotação e pelo cargo. -->
{#snippet celulasCargo(u: LinhaUnidade, cargo: 'dpc' | 'oip')}
	{@const c = u.efetivo[cargo]}
	{@const href = `${hrefServidores(u)}&cargo=${cargo.toUpperCase()}`}
	<td class={CELULA_NUM}>
		<a {href} class={LINK_NUM} title="{cargo.toUpperCase()} ativos em {u.nome}">{c.ativos}</a>
	</td>
	<td class="{CELULA_NUM} text-surface-500">{c.ferias}</td>
	<td class="{CELULA_NUM} text-surface-500">{c.afastados}</td>
{/snippet}

{#snippet celulasEfetivo(u: LinhaUnidade)}
	{@render celulasCargo(u, 'dpc')}
	{@render celulasCargo(u, 'oip')}
	<td class="{CELULA_NUM} font-semibold">
		<a href={hrefServidores(u)} class={LINK_NUM} title="Ver servidores de {u.nome}"
			>{u.efetivo.total}</a
		>
	</td>
	<td class="{CELULA_NUM} text-surface-400" aria-label="Sem dado ainda">—</td>
	<td class="{CELULA_NUM} text-surface-400" aria-label="Sem dado ainda">—</td>
	<td class={CELULA_NUM}>
		{#if u.municipios > 0}
			<a
				href="/unidade/{u.id}#municipios"
				class={LINK_NUM}
				title="Municípios atendidos por {u.nome}">{u.municipios}</a
			>
		{:else if u.municipiosSubtotal > 0}
			<!-- Unidade com vinculadas (departamento, seccional): a SOMA dos
			     municípios atendidos por elas — pedido do responsável em 15/09/2026. -->
			<span class="font-semibold" title="Soma dos municípios atendidos pelas unidades vinculadas"
				>{u.municipiosSubtotal}</span
			>
		{:else}
			<span class="text-surface-400">0</span>
		{/if}
	</td>
{/snippet}

{#snippet nomeUnidade(u: LinhaUnidade, destaque: boolean, recuo: boolean)}
	<td class={recuo ? 'pl-8' : ''}>
		<a
			href="/unidade/{u.id}"
			class="{destaque
				? 'font-bold'
				: 'font-medium'} text-surface-900 no-underline hover:text-primary-700 dark:text-surface-50 dark:hover:text-primary-400"
		>
			{u.nome}
		</a>
		<span class="ml-2 text-2xs text-surface-500 uppercase">{u.tipoRotulo}</span>
		{#if u.vinculadas > 0}
			<span class="ml-1 text-2xs text-surface-400"
				>· {u.vinculadas} vinculada{u.vinculadas === 1 ? '' : 's'}</span
			>
		{/if}
	</td>
{/snippet}

<!-- O card não pode cortar (overflow-hidden) nem rolar (table-wrap): sticky só
     funciona contra a rolagem da PÁGINA. Em tela estreita volta o scroll
     horizontal, e aí o cabeçalho de colunas deixa de fixar — escolha consciente. -->
<div class="card-elevated rounded-2xl p-4 shadow-sm sm:p-6">
	<div class="table-wrap lg:overflow-visible">
		<table class="table">
			<thead>
				<tr class="text-2xs" bind:clientHeight={alturaLinha1}>
					<th rowspan="2" class="{TH_FIXO} align-bottom" style:top={topoLinha1}>Unidade</th>
					<th
						colspan="3"
						class="{TH_FIXO} border-b border-surface-200 !text-center dark:border-white/10"
						style:top={topoLinha1}>DPC</th
					>
					<th
						colspan="3"
						class="{TH_FIXO} border-b border-surface-200 !text-center dark:border-white/10"
						style:top={topoLinha1}>OIP</th
					>
					<th rowspan="2" class="{TH_FIXO} text-right align-bottom" style:top={topoLinha1}>Total</th
					>
					<th rowspan="2" class="{TH_FIXO} text-right align-bottom" style:top={topoLinha1}
						>Veículos</th
					>
					<th rowspan="2" class="{TH_FIXO} text-right align-bottom" style:top={topoLinha1}>Armas</th
					>
					<th rowspan="2" class="{TH_FIXO} text-right align-bottom" style:top={topoLinha1}
						>Municípios</th
					>
				</tr>
				<tr class="text-2xs">
					<th class="{TH_FIXO} text-right" style:top={topoLinha2}>Ativos</th>
					<th class="{TH_FIXO} text-right font-normal" style:top={topoLinha2}>Férias</th>
					<th class="{TH_FIXO} text-right font-normal" style:top={topoLinha2}>Afast.</th>
					<th class="{TH_FIXO} text-right" style:top={topoLinha2}>Ativos</th>
					<th class="{TH_FIXO} text-right font-normal" style:top={topoLinha2}>Férias</th>
					<th class="{TH_FIXO} text-right font-normal" style:top={topoLinha2}>Afast.</th>
				</tr>
			</thead>
			<tbody>
				<!-- A raiz, fixa: própria lotação. -->
				<tr class="bg-primary-500/5">
					{@render nomeUnidade(data.raiz, true, false)}
					{@render celulasEfetivo(data.raiz)}
				</tr>
				{#each blocosFiltrados as bloco (bloco.unidade.id)}
					<tr
						class={bloco.filhas.length ? 'border-t-2 border-surface-200 dark:border-white/10' : ''}
					>
						{@render nomeUnidade(bloco.unidade, bloco.filhas.length > 0, false)}
						{@render celulasEfetivo(bloco.unidade)}
					</tr>
					{#each bloco.filhas as filha (filha.id)}
						<tr>
							{@render nomeUnidade(filha, false, true)}
							{@render celulasEfetivo(filha)}
						</tr>
					{/each}
					{#if bloco.filhas.length}
						<!-- Subtotal do bloco: a unidade com tudo abaixo dela. -->
						<tr class="text-2xs text-surface-500">
							<td class="pl-8 italic"
								>Total de {bloco.unidade.sigla || bloco.unidade.nome} com vinculadas</td
							>
							{#each ['dpc', 'oip'] as const as cargo (cargo)}
								<td class={CELULA_NUM}>{bloco.unidade.subtotal[cargo].ativos}</td>
								<td class={CELULA_NUM}>{bloco.unidade.subtotal[cargo].ferias}</td>
								<td class={CELULA_NUM}>{bloco.unidade.subtotal[cargo].afastados}</td>
							{/each}
							<td class="{CELULA_NUM} font-semibold">{bloco.unidade.subtotal.total}</td>
							<td class={CELULA_NUM}>—</td>
							<td class={CELULA_NUM}>—</td>
							<td class={CELULA_NUM}>{bloco.unidade.municipiosSubtotal}</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
	{#if busca && blocosFiltrados.length === 0}
		<p class="py-6 text-center text-sm text-surface-500">
			Nenhuma unidade vinculada casa com “{busca}”.
		</p>
	{/if}
	<p class="mt-4 text-2xs text-surface-500">
		{totalLinhas} unidades no escopo. Veículos e armas chegam com o módulo de Patrimônio.
	</p>
</div>
