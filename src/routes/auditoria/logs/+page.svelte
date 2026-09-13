<script lang="ts">
	/**
	 * Console de logs TÉCNICOS (`app_log`) — warn/error do logger de servidor.
	 * Vizinho de `/auditoria`, mesmo gate de Super Admin, mas registro de
	 * natureza oposta: aqui é diagnóstico, não prova. Some em 90 dias e não
	 * entra em cadeia de hash.
	 *
	 * O que liga os dois é o `request_id`, que correlaciona uma linha daqui com
	 * o evento forense e com o `errorId` que o usuário vê na tela de erro 5xx —
	 * é por ele que se parte de "o servidor me deu um código" até o stack real.
	 *
	 * Tela puramente de leitura, sem estado próprio além do acordeão: os
	 * filtros vêm da query string via `load`.
	 */
	import type { PageProps } from './$types';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import KpiCard from '../_components/KpiCard.svelte';
	import ChipNivel from '../_components/ChipNivel.svelte';
	import FiltrosToggle from '../_components/FiltrosToggle.svelte';
	import Paginacao from '../_components/Paginacao.svelte';
	import CardExpansivel from '../_components/CardExpansivel.svelte';
	import { parseJson } from '../_components/parse-json';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import CampoFiltroGet from '../_components/CampoFiltroGet.svelte';
	import { CLASSE_FORM_FILTRO_GET } from '$lib/gise/filtro-historico-ui';

	const { data }: PageProps = $props();

	// ---- Formatação ----
	function fmtData(s: string | null): string {
		if (!s) return '—';
		const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
		return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-BR');
	}

	// ---- Query string para paginação preservando filtros ----
	function queryString(extra: Record<string, string | number | undefined> = {}): string {
		const f = data.filtros;
		const campos: Record<string, string | number | undefined> = {
			level: f.level,
			busca: f.busca,
			request_id: f.request_id,
			de: f.de,
			ate: f.ate,
			...extra
		};
		return Object.entries(campos)
			.filter(([, v]) => v !== undefined && v !== '' && v !== null)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
			.join('&');
	}

	let expandido = $state<number | null>(null);

	const filtrosAtivos = $derived(
		[
			data.filtros.level,
			data.filtros.busca,
			data.filtros.request_id,
			data.filtros.de,
			data.filtros.ate
		].filter(Boolean).length
	);

	// Captura única e intencional: nasce expandido quando a URL já traz filtros
	// (SSR renderiza igual ao cliente — sem flash pós-hidratação). Depois disso,
	// só o usuário controla via toggle.
	// svelte-ignore state_referenced_locally
	let filtrosExpandidos = $state(filtrosAtivos > 0);
</script>

<svelte:head><title>Logs técnicos | Ecossistema PCCE</title></svelte:head>

<div class="space-y-6">
	<header>
		<BotaoVoltar href="/auditoria" />
		<h1 class="h1 text-2xl font-bold mt-2">Logs técnicos</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400">
			Avisos e erros do servidor, correlacionáveis com a auditoria pelo Request ID. O mesmo Request
			ID é o "código do erro" exibido ao usuário em falhas internas.
		</p>
	</header>

	<!-- KPIs -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
		<KpiCard rotulo="Total de registros" valor={data.resumo.total.toLocaleString('pt-BR')} />
		<KpiCard rotulo="Erros (24h)" valor={data.resumo.erros24h} destaque />
		<KpiCard rotulo="Avisos (24h)" valor={data.resumo.avisos24h} />
		<KpiCard rotulo="Último registro" valor={fmtData(data.resumo.ultimoRegistro)} />
	</div>

	<!-- Filtros (GET → URL) -->
	<div class="space-y-3">
		<FiltrosToggle ativos={filtrosAtivos} bind:expandidos={filtrosExpandidos} />

		<form
			method="GET"
			class="{CLASSE_FORM_FILTRO_GET} {filtrosExpandidos ? 'grid' : 'hidden lg:grid'}"
		>
			<CampoFiltroGet label="Nível" name="level">
				<option value="" selected={!data.filtros.level}>Todos</option>
				<option value="warn" selected={data.filtros.level === 'warn'}>Aviso</option>
				<option value="error" selected={data.filtros.level === 'error'}>Erro</option>
			</CampoFiltroGet>
			<CampoFiltroGet
				label="Busca (mensagem / contexto / rota)"
				name="busca"
				value={data.filtros.busca ?? ''}
				placeholder="texto livre"
			/>
			<CampoFiltroGet
				label="Request ID"
				name="request_id"
				value={data.filtros.request_id ?? ''}
				placeholder="ex.: 3fa1b2c4"
				inputClass="font-mono"
			/>
			<div class="grid grid-cols-2 gap-3">
				<CampoFiltroGet label="De" name="de" type="date" value={data.filtros.de ?? ''} />
				<CampoFiltroGet label="Até" name="ate" type="date" value={data.filtros.ate ?? ''} />
			</div>
			<div class="flex items-end gap-2 pt-2 lg:pt-0 col-span-1 sm:col-span-2 lg:col-span-4">
				<button
					type="submit"
					class="btn preset-filled-primary-500 text-sm flex-1 sm:flex-none justify-center"
				>
					Filtrar
				</button>
				{#if filtrosAtivos > 0}
					<a
						href="/auditoria/logs"
						class="btn preset-outlined-surface-500 text-sm flex-1 sm:flex-none justify-center"
					>
						Limpar
					</a>
				{/if}
			</div>
		</form>
	</div>

	<div class="flex justify-end -mb-2 text-sm text-surface-600 dark:text-surface-400">
		{data.total.toLocaleString('pt-BR')} resultado(s)
	</div>

	{#if data.logs.length > 0}
		<!-- Tabela (Desktop) -->
		<div class="hidden md:block table-wrap card-elevated rounded-2xl shadow-sm overflow-hidden">
			<table class="table w-full text-sm">
				<thead
					class="text-left text-xs uppercase tracking-wide text-surface-600 dark:text-surface-400 border-b border-surface-200 dark:border-white/10"
				>
					<tr>
						<th class="px-3 py-2">Data/hora</th>
						<th class="px-3 py-2">Nível</th>
						<th class="px-3 py-2">Mensagem</th>
						<th class="px-3 py-2">Rota</th>
						<th class="px-3 py-2">Request ID</th>
					</tr>
				</thead>
				<tbody>
					{#each data.logs as log (log.id)}
						{@const ctx = parseJson(log.contexto)}
						<tr
							class="border-b border-surface-200/60 dark:border-white/5 hover:bg-surface-100/60 dark:hover:bg-surface-800/40 cursor-pointer"
							onclick={() => (expandido = expandido === log.id ? null : log.id)}
						>
							<td class="px-3 py-2 whitespace-nowrap text-surface-700 dark:text-surface-200">
								{fmtData(log.created_at)}
							</td>
							<td class="px-3 py-2">
								<ChipNivel nivel={log.level} fallback="warn" />
							</td>
							<td class="px-3 py-2 font-medium text-surface-900 dark:text-white max-w-md truncate">
								{log.message}
							</td>
							<td
								class="px-3 py-2 text-surface-600 dark:text-surface-300 max-w-[200px] truncate font-mono text-xs"
							>
								{log.rota ?? '—'}
							</td>
							<td class="px-3 py-2 font-mono text-xs text-surface-600 dark:text-surface-300">
								{log.request_id ?? '—'}
							</td>
						</tr>
						{#if expandido === log.id}
							<tr class="bg-surface-100/50 dark:bg-surface-800/30">
								<td colspan="5" class="px-4 py-3">
									<div class="space-y-3 text-sm">
										<p class="text-surface-800 dark:text-surface-100 break-words">{log.message}</p>
										<dl
											class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-surface-600 dark:text-surface-300"
										>
											<dt class="font-medium">Rota</dt>
											<dd class="font-mono">{log.rota ?? '—'}</dd>
											<dt class="font-medium">Request ID</dt>
											<dd class="font-mono">{log.request_id ?? '—'}</dd>
											<dt class="font-medium">Usuário (id)</dt>
											<dd>{log.usuario_id ?? 'anônimo'}</dd>
										</dl>
										{#if ctx}
											<div>
												<div
													class="text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1"
												>
													Contexto
												</div>
												<pre
													class="text-xs bg-surface-200/50 dark:bg-surface-950/50 rounded p-2 overflow-x-auto">{JSON.stringify(
														ctx,
														null,
														2
													)}</pre>
											</div>
										{:else if log.contexto}
											<div>
												<div
													class="text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1"
												>
													Contexto (truncado)
												</div>
												<pre
													class="text-xs bg-surface-200/50 dark:bg-surface-950/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{log.contexto}</pre>
											</div>
										{/if}
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Lista de Cards (Mobile) -->
		<div class="block md:hidden space-y-3">
			{#each data.logs as log (log.id)}
				{@const ctx = parseJson(log.contexto)}

				<CardExpansivel
					aberto={expandido === log.id}
					onalternar={() => (expandido = expandido === log.id ? null : log.id)}
				>
					<div class="flex items-center justify-between gap-2">
						<ChipNivel nivel={log.level} fallback="warn" />
						<span class="text-xs text-surface-600 dark:text-surface-400"
							>{fmtData(log.created_at)}</span
						>
					</div>

					<h3 class="text-sm font-semibold text-surface-900 dark:text-white break-words">
						{log.message}
					</h3>

					<div
						class="flex items-center justify-between border-t border-surface-200/50 dark:border-white/5 pt-2 text-xs text-surface-600 dark:text-surface-400"
					>
						<span class="font-mono truncate max-w-[60%]">{log.rota ?? '—'}</span>
						<span class="flex items-center gap-0.5 text-primary-500 font-medium">
							{expandido === log.id ? 'Recolher' : 'Detalhes'}
							{#if expandido === log.id}
								<ChevronUp class="w-3.5 h-3.5" />
							{:else}
								<ChevronDown class="w-3.5 h-3.5" />
							{/if}
						</span>
					</div>

					{#if expandido === log.id}
						<!-- Barreira de propagação apenas (sem interação própria): impede que
						     cliques em texto/seleção dentro dos detalhes recolham o card. -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="border-t border-surface-200/60 dark:border-white/10 pt-3 space-y-3 text-xs"
							onclick={(e) => e.stopPropagation()}
						>
							<div class="bg-surface-100/50 dark:bg-surface-800/40 rounded-lg p-3">
								<dl
									class="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1.5 text-surface-600 dark:text-surface-300"
								>
									<dt class="font-semibold text-surface-600 dark:text-surface-400">Rota</dt>
									<dd class="font-mono break-all text-surface-800 dark:text-surface-200">
										{log.rota ?? '—'}
									</dd>
									<dt class="font-semibold text-surface-600 dark:text-surface-400">Request ID</dt>
									<dd class="font-mono text-surface-800 dark:text-surface-200">
										{log.request_id ?? '—'}
									</dd>
									<dt class="font-semibold text-surface-600 dark:text-surface-400">Usuário (id)</dt>
									<dd class="text-surface-800 dark:text-surface-200">
										{log.usuario_id ?? 'anônimo'}
									</dd>
								</dl>
							</div>
							{#if ctx}
								<div class="space-y-1">
									<div class="font-semibold text-surface-600 dark:text-surface-400">Contexto</div>
									<pre
										class="text-xs bg-surface-200/50 dark:bg-surface-950/50 rounded-lg p-2.5 overflow-x-auto text-surface-800 dark:text-surface-200 font-mono">{JSON.stringify(
											ctx,
											null,
											2
										)}</pre>
								</div>
							{:else if log.contexto}
								<div class="space-y-1">
									<div class="font-semibold text-surface-600 dark:text-surface-400">
										Contexto (truncado)
									</div>
									<pre
										class="text-xs bg-surface-200/50 dark:bg-surface-950/50 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-all text-surface-800 dark:text-surface-200 font-mono">{log.contexto}</pre>
								</div>
							{/if}
						</div>
					{/if}
				</CardExpansivel>
			{/each}
		</div>
	{:else}
		<div
			class="card-elevated rounded-2xl shadow-sm p-10 text-center text-surface-600 dark:text-surface-400 text-sm"
		>
			Nenhum log encontrado para os filtros atuais.
		</div>
	{/if}

	<!-- Paginação -->
	<Paginacao
		page={data.page}
		totalPages={data.totalPages}
		href={(p) => `?${queryString({ page: p })}`}
	/>
</div>
