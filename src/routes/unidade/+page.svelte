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
	import {
		CLASSE_CAIXA_FILTRO,
		CLASSE_INPUT_FILTRO,
		CLASSE_ROTULO_FILTRO
	} from '$lib/gise/filtro-historico-ui';

	const { data }: PageProps = $props();

	let busca = $state('');

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

<div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
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
	<a
		href="/unidade/{data.raiz.id}"
		class="btn btn-sm preset-outlined-surface-500 self-start sm:self-auto"
	>
		Ficha de {data.raiz.sigla || data.raiz.nome}
	</a>
</div>

<div class="{CLASSE_CAIXA_FILTRO} mb-6">
	<label class="flex flex-col gap-1.5">
		<span class={CLASSE_ROTULO_FILTRO}>Buscar unidade</span>
		<div class="relative">
			<input
				type="search"
				class="{CLASSE_INPUT_FILTRO} w-full pl-10"
				bind:value={busca}
				placeholder="Qualquer parte do nome, da sigla ou do tipo…"
				aria-label="Buscar unidade"
			/>
			<div class="pointer-events-none absolute inset-y-0 left-3 flex items-center opacity-50">
				<Search class="h-4 w-4" />
			</div>
		</div>
	</label>
</div>

{#snippet celulasEfetivo(u: LinhaUnidade)}
	<td class={CELULA_NUM}>
		<a href={hrefServidores(u)} class={LINK_NUM} title="Ver servidores de {u.nome}"
			>{u.efetivo.dpc}</a
		>
	</td>
	<td class={CELULA_NUM}>
		<a href={hrefServidores(u)} class={LINK_NUM} title="Ver servidores de {u.nome}"
			>{u.efetivo.oip}</a
		>
	</td>
	<td class={CELULA_NUM}>
		<a href={hrefServidores(u)} class={LINK_NUM} title="Ver servidores de {u.nome}"
			>{u.efetivo.afastados}</a
		>
	</td>
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

<div class="card-elevated overflow-hidden rounded-2xl p-4 shadow-sm sm:p-6">
	<div class="table-wrap">
		<table class="table">
			<thead>
				<tr>
					<th>Unidade</th>
					<th class="text-right">DPC</th>
					<th class="text-right">OIP</th>
					<th class="text-right">Afastados</th>
					<th class="text-right">Servidores</th>
					<th class="text-right">Veículos</th>
					<th class="text-right">Armas</th>
					<th class="text-right">Municípios</th>
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
							<td class={CELULA_NUM}>{bloco.unidade.subtotal.dpc}</td>
							<td class={CELULA_NUM}>{bloco.unidade.subtotal.oip}</td>
							<td class={CELULA_NUM}>{bloco.unidade.subtotal.afastados}</td>
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
