<script lang="ts">
	/**
	 * Uma unidade da Gestão de unidade em CARTÃO — o que o celular mostra no
	 * lugar da tabela de doze colunas (pedido do responsável em 16/09/2026:
	 * "pense sempre na experiência do usuário nas telas"). É o mesmo padrão da
	 * lista de Servidores: `hidden md:block` para a tabela, `md:hidden` para os
	 * cartões, com os MESMOS dados e as mesmas ações — nada é exclusivo de um
	 * tamanho de tela.
	 *
	 * Os números continuam clicáveis e coloridos (férias dourado, afastados
	 * vermelho) e abrem o painel "quem são"; quem decide o que abrir é a página,
	 * que passa `aoAbrirPainel`.
	 */
	import { COR_SITUACAO } from '$lib/servidores/afastamentos';
	import type { LinhaUnidade } from '../+page.server';
	import type { PedidoEfetivo } from './ModalEfetivo.svelte';

	const {
		unidade,
		recuo = false,
		destaque = false,
		/** Subárvore: o cartão de total (departamento/seccional) abre o painel com as vinculadas. */
		subarvore = false,
		rotulo = '',
		aoAbrirPainel
	}: {
		unidade: LinhaUnidade;
		recuo?: boolean;
		destaque?: boolean;
		subarvore?: boolean;
		/** Substitui o nome no topo do cartão ("Total de … com vinculadas"). */
		rotulo?: string;
		aoAbrirPainel: (
			u: LinhaUnidade,
			situacao: PedidoEfetivo['situacao'],
			cargo: PedidoEfetivo['cargo'],
			subarvore: boolean
		) => void;
	} = $props();

	const fmt = new Intl.NumberFormat('pt-BR');
	const efetivo = $derived(subarvore ? unidade.subtotal : unidade.efetivo);
	const municipios = $derived(
		subarvore ? unidade.municipiosSubtotal : unidade.municipios || unidade.municipiosSubtotal
	);

	const corDe = (situacao: PedidoEfetivo['situacao'], n: number) =>
		n === 0
			? 'text-surface-400'
			: situacao === 'ativos'
				? COR_SITUACAO.ativo
				: situacao === 'ferias'
					? COR_SITUACAO.ferias
					: COR_SITUACAO.afastado;
</script>

{#snippet numero(situacao: PedidoEfetivo['situacao'], cargo: 'DPC' | 'OIP', n: number)}
	<button
		type="button"
		class="min-w-7 rounded px-1 py-0.5 text-sm font-semibold tabular-nums {corDe(
			situacao,
			n
		)} disabled:cursor-default"
		disabled={n === 0}
		onclick={() => aoAbrirPainel(unidade, situacao, cargo, subarvore)}>{n}</button
	>
{/snippet}

{#snippet linhaCargo(cargo: 'dpc' | 'oip', titulo: string)}
	{@const c = efetivo[cargo]}
	{@const sigla = cargo === 'dpc' ? 'DPC' : 'OIP'}
	<div class="flex items-center justify-between gap-2 text-sm">
		<span class="text-surface-600 dark:text-surface-400">{titulo}</span>
		<span class="flex items-center gap-1">
			{@render numero('ativos', sigla, c.ativos)}
			<span class="text-2xs text-surface-400">·</span>
			{@render numero('ferias', sigla, c.ferias)}
			<span class="text-2xs text-surface-400">·</span>
			{@render numero('afastados', sigla, c.afastados)}
		</span>
	</div>
{/snippet}

<div
	class="card-elevated-2 rounded-2xl p-4 {recuo ? 'ml-3' : ''} {destaque
		? 'border-primary-500/40 bg-primary-500/5'
		: ''}"
>
	<div class="mb-2">
		{#if rotulo}
			<span class="text-sm font-semibold text-surface-900 dark:text-surface-50">{rotulo}</span>
		{:else}
			<a
				href="/unidade/{unidade.id}"
				class="text-sm font-semibold text-surface-900 no-underline dark:text-surface-50"
				>{unidade.nome}</a
			>
			<span class="mt-0.5 block text-3xs font-bold tracking-wide text-surface-500 uppercase">
				{unidade.tipoRotulo}{#if unidade.vinculadas > 0}
					· {unidade.vinculadas} vinculada{unidade.vinculadas === 1 ? '' : 's'}{/if}
			</span>
		{/if}
	</div>

	<!-- Ativos · Férias · Afastados, na mesma ordem e cores da tabela. -->
	<p class="mb-1 text-3xs tracking-wide text-surface-500 uppercase">Ativos · Férias · Afastados</p>
	<div class="space-y-1">
		{@render linhaCargo('dpc', 'Delegados (DPC)')}
		{@render linhaCargo('oip', 'Oficiais (OIP)')}
	</div>

	<dl
		class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-surface-200 pt-2 text-xs dark:border-white/10"
	>
		<div class="flex justify-between">
			<dt class="text-surface-600 dark:text-surface-400">Lotados</dt>
			<dd class="font-semibold tabular-nums">{efetivo.total}</dd>
		</div>
		<div class="flex justify-between">
			<dt class="text-surface-600 dark:text-surface-400">Municípios</dt>
			<dd class="tabular-nums">{municipios || '—'}</dd>
		</div>
		<div class="flex justify-between">
			<dt class="text-surface-600 dark:text-surface-400">População</dt>
			<dd class="tabular-nums">{unidade.populacao > 0 ? fmt.format(unidade.populacao) : '—'}</dd>
		</div>
		<div class="flex justify-between">
			<dt class="text-surface-600 dark:text-surface-400">Hab./policial</dt>
			<dd class="font-semibold tabular-nums">
				{unidade.habPorPolicial != null ? fmt.format(unidade.habPorPolicial) : '—'}
			</dd>
		</div>
	</dl>
</div>
