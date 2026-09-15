<script lang="ts">
	/**
	 * O painel que abre ao clicar num número da Gestão de unidade — LISTA
	 * (`/unidade`) e FICHA (`/unidade/[id]`), a família de rotas: quem são os
	 * ativos, os de férias ou os afastados daquele número (fase 2-C, pedido do
	 * responsável em 15/09/2026).
	 *
	 * Os dados vêm sob demanda de `/api/unidades/[id]/efetivo` (mesma régua de
	 * escopo da tela); a página não carrega 700 servidores à toa. Para
	 * departamento e seccional (`subarvore`) a lista vem agrupada por unidade.
	 * Férias em dourado e afastados em vermelho, como em toda parte
	 * (`COR_SITUACAO`).
	 */
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { apiFetch } from '$lib/api-fetch';
	import { formatarData, diffDiasInclusivo } from '$lib/utils/datas';
	import {
		COR_SITUACAO,
		AFASTAMENTOS,
		rotuloAfastamento,
		type SubtipoAfastamento
	} from '$lib/servidores/afastamentos';
	import type { ServidorSituado } from '$lib/db/efetivo';

	export interface PedidoEfetivo {
		unidadeId: number;
		/** O NOME completo — é a lotação do servidor, e o link para Servidores filtra por ele. */
		unidadeNome: string;
		/** O que o título mostra (sigla quando há). */
		unidadeRotulo: string;
		situacao: 'ativos' | 'ferias' | 'afastados';
		cargo?: 'DPC' | 'OIP';
		subarvore: boolean;
	}

	let {
		open = $bindable(false),
		pedido
	}: {
		open: boolean;
		pedido: PedidoEfetivo | null;
	} = $props();

	let carregando = $state(false);
	let erro = $state('');
	let servidores = $state<ServidorSituado[]>([]);
	let hoje = $state('');

	$effect(() => {
		if (!open || !pedido) return;
		const p = pedido;
		carregando = true;
		erro = '';
		servidores = [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const q = new URLSearchParams({ situacao: p.situacao });
		if (p.cargo) q.set('cargo', p.cargo);
		if (p.subarvore) q.set('subarvore', '1');
		apiFetch<{ hoje: string; servidores: ServidorSituado[] }>(
			`/api/unidades/${p.unidadeId}/efetivo?${q}`
		)
			.then((r) => {
				servidores = r.servidores;
				hoje = r.hoje;
			})
			.catch((e: Error) => (erro = e.message))
			.finally(() => (carregando = false));
	});

	const titulo = $derived.by(() => {
		if (!pedido) return '';
		const s =
			pedido.situacao === 'ativos'
				? 'Ativos hoje'
				: pedido.situacao === 'ferias'
					? 'De férias hoje'
					: 'Afastados hoje';
		return `${s}${pedido.cargo ? ` · ${pedido.cargo}` : ''} — ${pedido.unidadeRotulo}`;
	});

	/** Agrupa por lotação quando o pedido abrange a subárvore. */
	const grupos = $derived.by(() => {
		if (!pedido?.subarvore) return [{ lotacao: '', itens: servidores }];
		// Local ao derivado, devolvido pronto — não é estado.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const mapa = new Map<string, ServidorSituado[]>();
		for (const s of servidores) {
			const lista = mapa.get(s.lotacao) ?? [];
			lista.push(s);
			mapa.set(s.lotacao, lista);
		}
		return [...mapa.entries()].map(([lotacao, itens]) => ({ lotacao, itens }));
	});

	const diasRestantes = (fim: string | null) => (fim && hoje ? diffDiasInclusivo(hoje, fim) : null);
	const hrefServidores = $derived(
		pedido && !pedido.subarvore
			? `/servidores?lotacao=${encodeURIComponent(pedido.unidadeNome)}${pedido.cargo ? `&cargo=${pedido.cargo}` : ''}&situacao=${pedido.situacao}`
			: null
	);
	const mostraAfastamento = $derived(pedido?.situacao !== 'ativos');
	const corTitulo = $derived(
		pedido?.situacao === 'ferias'
			? COR_SITUACAO.ferias
			: pedido?.situacao === 'afastados'
				? COR_SITUACAO.afastado
				: ''
	);
</script>

<!-- 5xl: a tabela tem sete colunas e nomes compostos — em 2xl ficava espremida. -->
<ModalShell bind:open title={titulo} largura="5xl" cancelLabel="Fechar">
	{#if carregando}
		<p class="text-sm text-surface-500">Carregando…</p>
	{:else if erro}
		<p class="text-sm text-error-600">{erro}</p>
	{:else if servidores.length === 0}
		<p class="text-sm text-surface-500">Ninguém nesta situação hoje.</p>
	{:else}
		<p class="mb-2 text-xs text-surface-500">
			<span class="font-semibold {corTitulo}">{servidores.length}</span>
			servidor{servidores.length === 1 ? '' : 'es'}{#if hoje}
				<span>&nbsp;· situação em {formatarData(hoje)}</span>{/if}
		</p>
		<div class="table-wrap max-h-[60vh] overflow-y-auto">
			<table class="table">
				<thead>
					<tr class="text-2xs">
						<th>Servidor</th>
						<th>Matrícula</th>
						<th>Cargo</th>
						{#if mostraAfastamento}
							<th>Afastamento</th>
							<th>Início</th>
							<th>Fim</th>
							<th class="text-right">Dias</th>
						{:else}
							<th>Designação</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each grupos as g (g.lotacao)}
						{#if g.lotacao}
							<tr>
								<td
									colspan={mostraAfastamento ? 7 : 4}
									class="bg-surface-100 text-xs font-semibold text-surface-700 dark:bg-surface-800 dark:text-surface-200"
									>{g.lotacao} · {g.itens.length}</td
								>
							</tr>
						{/if}
						{#each g.itens as s (s.id)}
							<tr>
								<td>
									<a href="/servidores/{s.id}" class="font-medium no-underline hover:underline"
										>{s.nome}</a
									>
								</td>
								<td class="font-mono text-xs tabular-nums">{s.matricula}</td>
								<td class="text-xs">{s.cargo}</td>
								{#if mostraAfastamento}
									<td class="text-xs {COR_SITUACAO[s.situacao]}">
										<span class="font-semibold"
											>{rotuloAfastamento(s.afastamento?.subtipo ?? '')}</span
										>
										{#if AFASTAMENTOS[s.afastamento?.subtipo as SubtipoAfastamento]?.base}
											<span class="block text-3xs text-surface-500"
												>{AFASTAMENTOS[s.afastamento?.subtipo as SubtipoAfastamento].base}</span
											>
										{/if}
									</td>
									<td class="text-xs tabular-nums"
										>{formatarData(s.afastamento?.data_inicio ?? '')}</td
									>
									<td class="text-xs tabular-nums"
										>{s.afastamento?.data_fim
											? formatarData(s.afastamento.data_fim)
											: 'em aberto'}</td
									>
									<td class="text-right text-xs tabular-nums"
										>{diasRestantes(s.afastamento?.data_fim ?? null) ?? '—'}</td
									>
								{:else}
									<td class="text-xs">{s.designacao || '—'}</td>
								{/if}
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#snippet footer()}
		{#if hrefServidores}
			<a href={hrefServidores} class="btn btn-sm preset-outlined-surface-500">Ver em Servidores</a>
		{/if}
	{/snippet}
</ModalShell>
