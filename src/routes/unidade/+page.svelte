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
	import { COR_SITUACAO } from '$lib/servidores/afastamentos';
	import ModalEfetivo, { type PedidoEfetivo } from './_components/ModalEfetivo.svelte';
	import CartaoUnidade from './_components/CartaoUnidade.svelte';

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
	/**
	 * Fundo opaco dos th fixos: o mesmo do card, senão as linhas passam por trás.
	 * `sm:sticky` — no celular o cabeçalho da página ocupa meia tela, e o
	 * deslocamento calculado a partir dele jogava a linha de colunas para o MEIO
	 * da tabela (visto em 16/09/2026). Abaixo de `sm` nada gruda.
	 */
	const TH_FIXO = 'sm:sticky z-10 bg-white dark:bg-surface-900';

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

	// O painel "quem são" — abre ao clicar num número (pedido de 15/09/2026).
	let painelAberto = $state(false);
	let pedido = $state<PedidoEfetivo | null>(null);
	function abrirPainel(
		u: LinhaUnidade,
		situacao: PedidoEfetivo['situacao'],
		cargo: PedidoEfetivo['cargo'],
		subarvore: boolean
	) {
		pedido = {
			unidadeId: u.id,
			unidadeNome: u.nome,
			unidadeRotulo: u.sigla || u.nome,
			situacao,
			cargo,
			subarvore
		};
		painelAberto = true;
	}
	/** Número clicável; férias em dourado, afastados em vermelho; zero fica apagado. */
	const CLASSE_BOTAO =
		'inline-block min-w-6 cursor-pointer rounded px-1 font-semibold hover:bg-surface-500/10';
	const corDe = (situacao: PedidoEfetivo['situacao'], n: number) =>
		n === 0
			? 'text-surface-400'
			: situacao === 'ativos'
				? COR_SITUACAO.ativo
				: situacao === 'ferias'
					? COR_SITUACAO.ferias
					: COR_SITUACAO.afastado;
	const fmt = new Intl.NumberFormat('pt-BR');
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
	class="sm:sticky sm:top-14 z-20 -mx-2 mb-4 flex flex-col gap-3 border-b border-surface-200 bg-page-canvas px-2 pt-2 pb-3 sm:-mx-4 sm:flex-row sm:items-end sm:justify-between sm:px-4 dark:border-white/10 dark:bg-surface-950"
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
			{#if data.raiz.populacao > 0}
				· {fmt.format(data.raiz.populacao)} habitantes{/if}
			{#if data.raiz.habPorPolicial != null}
				· 1 policial para {fmt.format(data.raiz.habPorPolicial)} hab.{/if}
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

<!-- Um número clicável: abre o painel com QUEM está naquela situação. -->
{#snippet numero(
	u: LinhaUnidade,
	situacao: PedidoEfetivo['situacao'],
	cargo: PedidoEfetivo['cargo'],
	n: number,
	subarvore: boolean
)}
	<td class={CELULA_NUM}>
		<button
			type="button"
			class="{CLASSE_BOTAO} {corDe(situacao, n)}"
			title="{situacao === 'ativos'
				? 'Ativos'
				: situacao === 'ferias'
					? 'De férias'
					: 'Afastados'}{cargo ? ` (${cargo})` : ''} em {u.nome}{subarvore ? ' e vinculadas' : ''}"
			disabled={n === 0}
			onclick={() => abrirPainel(u, situacao, cargo, subarvore)}>{n}</button
		>
	</td>
{/snippet}

<!-- Por cargo: ativos · férias · afastados, da própria lotação. -->
{#snippet celulasCargo(u: LinhaUnidade, cargo: 'dpc' | 'oip')}
	{@const c = u.efetivo[cargo]}
	{@const sigla = cargo === 'dpc' ? 'DPC' : 'OIP'}
	{@render numero(u, 'ativos', sigla, c.ativos, false)}
	{@render numero(u, 'ferias', sigla, c.ferias, false)}
	{@render numero(u, 'afastados', sigla, c.afastados, false)}
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
	<td class={CELULA_NUM}>
		{#if u.populacao > 0}{fmt.format(u.populacao)}{:else}<span class="text-surface-400">—</span
			>{/if}
	</td>
	<td class="{CELULA_NUM} font-semibold">
		{#if u.habPorPolicial != null}{fmt.format(u.habPorPolicial)}{:else}<span
				class="text-surface-400">—</span
			>{/if}
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
				>· {u.vinculadas} vinculada{u.vinculadas === 1 ? '' : 's'}{#if u.id === data.raiz.id}
					· esta linha é só a lotação do departamento{/if}</span
			>
		{/if}
	</td>
{/snippet}

<!-- O card não pode cortar (overflow-hidden) nem rolar (table-wrap): sticky só
     funciona contra a rolagem da PÁGINA. Em tela estreita volta o scroll
     horizontal, e aí o cabeçalho de colunas deixa de fixar — escolha consciente. -->
<div class="card-elevated hidden rounded-2xl p-4 shadow-sm sm:p-6 md:block">
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
					<th rowspan="2" class="{TH_FIXO} text-right align-bottom" style:top={topoLinha1}
						>População</th
					>
					<th rowspan="2" class="{TH_FIXO} text-right align-bottom" style:top={topoLinha1}
						>Hab./policial</th
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
				<!-- A raiz, fixa: a PRÓPRIA lotação (o total com vinculadas fecha a tabela). -->
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
								{@const sigla = cargo === 'dpc' ? 'DPC' : 'OIP'}
								{@render numero(
									bloco.unidade,
									'ativos',
									sigla,
									bloco.unidade.subtotal[cargo].ativos,
									true
								)}
								{@render numero(
									bloco.unidade,
									'ferias',
									sigla,
									bloco.unidade.subtotal[cargo].ferias,
									true
								)}
								{@render numero(
									bloco.unidade,
									'afastados',
									sigla,
									bloco.unidade.subtotal[cargo].afastados,
									true
								)}
							{/each}
							<td class="{CELULA_NUM} font-semibold">{bloco.unidade.subtotal.total}</td>
							<td class={CELULA_NUM}>—</td>
							<td class={CELULA_NUM}>—</td>
							<td class={CELULA_NUM}>{bloco.unidade.municipiosSubtotal}</td>
							<td class={CELULA_NUM}>{fmt.format(bloco.unidade.populacao)}</td>
							<td class="{CELULA_NUM} font-semibold"
								>{bloco.unidade.habPorPolicial != null
									? fmt.format(bloco.unidade.habPorPolicial)
									: '—'}</td
							>
						</tr>
					{/if}
				{/each}
				<!-- Total do departamento com tudo abaixo — é o que o cabeçalho soma. -->
				{#if !busca.trim()}
					<tr
						class="border-t-2 border-surface-300 bg-primary-500/5 text-xs font-semibold dark:border-white/20"
					>
						<td>Total de {data.raiz.sigla || data.raiz.nome} com vinculadas</td>
						{#each ['dpc', 'oip'] as const as cargo (cargo)}
							{@const sigla = cargo === 'dpc' ? 'DPC' : 'OIP'}
							{@render numero(data.raiz, 'ativos', sigla, data.raiz.subtotal[cargo].ativos, true)}
							{@render numero(data.raiz, 'ferias', sigla, data.raiz.subtotal[cargo].ferias, true)}
							{@render numero(
								data.raiz,
								'afastados',
								sigla,
								data.raiz.subtotal[cargo].afastados,
								true
							)}
						{/each}
						<td class={CELULA_NUM}>{data.raiz.subtotal.total}</td>
						<td class={CELULA_NUM}>—</td>
						<td class={CELULA_NUM}>—</td>
						<td class={CELULA_NUM}>{data.raiz.municipiosSubtotal}</td>
						<td class={CELULA_NUM}>{fmt.format(data.raiz.populacao)}</td>
						<td class={CELULA_NUM}
							>{data.raiz.habPorPolicial != null ? fmt.format(data.raiz.habPorPolicial) : '—'}</td
						>
					</tr>
				{/if}
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

<!-- Celular: cartões em vez das doze colunas (mesmo padrão de /servidores).
     Os números continuam clicáveis e abrem o mesmo painel. -->
<div class="space-y-3 md:hidden">
	<CartaoUnidade unidade={data.raiz} destaque aoAbrirPainel={abrirPainel} />
	{#each blocosFiltrados as bloco (bloco.unidade.id)}
		<CartaoUnidade unidade={bloco.unidade} aoAbrirPainel={abrirPainel} />
		{#each bloco.filhas as filha (filha.id)}
			<CartaoUnidade unidade={filha} recuo aoAbrirPainel={abrirPainel} />
		{/each}
		{#if bloco.filhas.length}
			<CartaoUnidade
				unidade={bloco.unidade}
				subarvore
				recuo
				rotulo="Total de {bloco.unidade.sigla || bloco.unidade.nome} com vinculadas"
				aoAbrirPainel={abrirPainel}
			/>
		{/if}
	{/each}
	{#if !busca.trim()}
		<CartaoUnidade
			unidade={data.raiz}
			subarvore
			destaque
			rotulo="Total de {data.raiz.sigla || data.raiz.nome} com vinculadas"
			aoAbrirPainel={abrirPainel}
		/>
	{/if}
	{#if busca && blocosFiltrados.length === 0}
		<p class="py-6 text-center text-sm text-surface-500">Nenhuma unidade encontrada.</p>
	{/if}
</div>

<ModalEfetivo bind:open={painelAberto} {pedido} />
