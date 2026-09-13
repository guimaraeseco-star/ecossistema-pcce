<script lang="ts">
	/**
	 * Console da trilha forense (`audit_log`) — a tela do SUPER ADMIN, não do
	 * Admin Geral. Tudo que se vê aqui é somente leitura: o log é
	 * tamper-evident, e nenhum caminho da UI edita ou apaga evento.
	 *
	 * Os filtros vivem na QUERY STRING, não em `$state`: o `+page.server.ts`
	 * refaz a consulta a cada navegação, e em troca a busca vira link
	 * compartilhável e sobrevive a reload — o que importa quando alguém está
	 * documentando um incidente.
	 *
	 * A verificação de integridade é server action (`form?.integridade`) porque
	 * recalcular a cadeia de hash é trabalho de servidor; o cliente só exibe o
	 * veredito.
	 *
	 * O export não usa navegação: `baixar()` faz fetch + blob de propósito. Um
	 * `<a download>` deixaria o router em "carregando" eterno e engoliria o 400
	 * do limite de janela (1 ano no CSV, 1 mês no PDF), que aqui vira toast.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { apiFetchResponse } from '$lib/api-fetch';
	import { baixarBlob, nomeArquivoContentDisposition } from '$lib/utils/download';
	import { toaster } from '$lib/toast';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import SearchX from '@lucide/svelte/icons/search-x';
	import EstadoVazio from '$lib/components/EstadoVazio.svelte';
	import KpiCard from './_components/KpiCard.svelte';
	import ChipNivel from './_components/ChipNivel.svelte';
	import CampoFiltroGet from './_components/CampoFiltroGet.svelte';
	import FiltrosToggle from './_components/FiltrosToggle.svelte';
	import Paginacao from './_components/Paginacao.svelte';
	import CardExpansivel from './_components/CardExpansivel.svelte';
	import { parseJson } from './_components/parse-json';
	import { mensagemDeErro } from '$lib/utils/erro';
	import { CLASSE_FORM_FILTRO_GET } from '$lib/gise/filtro-historico-ui';

	const { data, form }: PageProps = $props();

	// ---- Rótulos e cores ----
	const RESULTADO: Record<string, { label: string; cls: string }> = {
		sucesso: { label: 'Sucesso', cls: 'text-success-700 dark:text-success-400' },
		falha: { label: 'Falha', cls: 'text-error-700 dark:text-error-400' },
		negado: { label: 'Negado', cls: 'text-warning-700 dark:text-warning-400' }
	};
	const CATEGORIA: Record<string, string> = {
		autenticacao: 'Autenticação',
		escala: 'Escala',
		gise: 'GISE',
		policial: 'Policial',
		unidade: 'Unidade',
		operacao: 'Operação',
		configuracao: 'Configuração',
		documento: 'Documento',
		lgpd: 'LGPD',
		sistema: 'Sistema'
	};
	const ACTOR: Record<string, string> = {
		policial: 'Policial',
		admin: 'Admin',
		sistema: 'Sistema',
		webhook: 'Webhook'
	};

	const acaoLabel = $derived(
		new Map<string, string>(data.facetas.acoes.map((a) => [a.valor, a.label]))
	);
	function rotuloAcao(a: string): string {
		return acaoLabel.get(a) ?? a;
	}

	// ---- Formatação ----
	function fmtData(s: string | null): string {
		if (!s) return '—';
		const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
		return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-BR');
	}
	/** Campos alterados entre dois snapshots, para o diff. */
	function diff(antes: string | null, depois: string | null) {
		const a = parseJson(antes) ?? {};
		const b = parseJson(depois) ?? {};
		const chaves = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
		return chaves
			.map((k) => ({ campo: k, de: a[k], para: b[k] }))
			.filter((r) => JSON.stringify(r.de) !== JSON.stringify(r.para));
	}
	function val(v: unknown): string {
		if (v === null || v === undefined || v === '') return '∅';
		if (typeof v === 'object') return JSON.stringify(v);
		return String(v);
	}

	// ---- Query string para paginação / export preservando filtros ----
	function queryString(extra: Record<string, string | number | undefined> = {}): string {
		const f = data.filtros;
		const campos: Record<string, string | number | undefined> = {
			categoria: f.categoria,
			acao: f.acao,
			severidade: f.severidade,
			resultado: f.resultado,
			actor_tipo: f.actor_tipo,
			busca: f.busca,
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
	let verificando = $state(false);
	let baixando = $state(false);
	const integridade = $derived(form?.integridade);

	/**
	 * Baixa um export (CSV/PDF) via fetch + blob — evita o "carregando" eterno do
	 * router e permite tratar o limite de janela (HTTP 400) com um toast claro.
	 */
	async function baixar(format: 'csv' | 'pdf', extra: Record<string, string | number> = {}) {
		if (baixando) return;
		baixando = true;
		try {
			const resp = await apiFetchResponse(`/auditoria/export?${queryString({ format, ...extra })}`);
			const nome = nomeArquivoContentDisposition(
				resp.headers.get('content-disposition'),
				`auditoria.${format}`
			);
			baixarBlob(await resp.blob(), nome);
		} catch (e: unknown) {
			toaster.error({
				title: 'Exportação',
				description: mensagemDeErro(e, 'Não foi possível gerar o arquivo.')
			});
		} finally {
			baixando = false;
		}
	}

	const filtrosAtivos = $derived(
		[
			data.filtros.categoria,
			data.filtros.acao,
			data.filtros.severidade,
			data.filtros.resultado,
			data.filtros.actor_tipo,
			data.filtros.busca,
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

<svelte:head><title>Auditoria | Ecossistema PCCE</title></svelte:head>

<div class="space-y-6">
	<header class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="h1 text-2xl font-bold">Trilha de Auditoria</h1>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Registro forense de ações do sistema — cadeia de hash verificável.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2 w-full sm:w-auto">
			<a
				href="/auditoria/logs"
				class="btn preset-outlined-surface-500 text-sm flex-1 sm:flex-none justify-center"
			>
				Logs técnicos
			</a>
			<button
				type="button"
				onclick={() => baixar('csv')}
				disabled={baixando}
				class="btn preset-outlined-surface-500 text-sm flex-1 sm:flex-none justify-center"
			>
				Exportar CSV
			</button>
			<button
				type="button"
				onclick={() => baixar('pdf')}
				disabled={baixando}
				class="btn preset-outlined-surface-500 text-sm flex-1 sm:flex-none justify-center"
			>
				Exportar PDF
			</button>
			<form
				method="POST"
				action="?/verificar"
				class="w-full sm:w-auto flex"
				use:enhance={() => {
					verificando = true;
					return async ({ update }) => {
						await update({ reset: false });
						verificando = false;
					};
				}}
			>
				<button
					type="submit"
					class="btn preset-filled-primary-500 text-sm w-full justify-center"
					disabled={verificando}
				>
					{verificando ? 'Verificando…' : 'Verificar integridade'}
				</button>
			</form>
		</div>
	</header>

	{#if integridade}
		<div
			class="rounded-xl border p-4 text-sm {integridade.ok
				? 'border-success-500/30 bg-success-500/10 text-success-800 dark:text-success-300'
				: 'border-error-500/30 bg-error-500/10 text-error-800 dark:text-error-300'}"
		>
			{#if integridade.ok}
				<p>
					<CheckCircle2 class="inline w-4 h-4 -mt-0.5" aria-hidden="true" /> Cadeia íntegra — {integridade.verificados}
					registro(s) encadeado(s) verificado(s) sem adulteração.
				</p>
				{#if integridade.ultimoHash}
					<p class="mt-1 text-xs font-mono break-all opacity-80">
						Âncora atual: seq {integridade.ultimoSeq} · {integridade.ultimoHash}
					</p>
					<p class="mt-1 text-xs opacity-70">
						Registre esta âncora externamente — se o log for adulterado depois, este valor não bate
						mais.
					</p>
				{/if}
			{:else}
				<AlertTriangle class="inline w-4 h-4 -mt-0.5" aria-hidden="true" /> Inconsistência detectada{integridade.primeiroProblemaSeq
					? ` (seq ${integridade.primeiroProblemaSeq})`
					: ''}: {integridade.problema}
			{/if}

			<!--
				A FORÇA do encadeamento, em todo resultado — íntegro ou não.
				"Cadeia íntegra" sem isto diz a verdade sobre o elo e cala sobre o
				valor da garantia: sem `AUDIT_CHAIN_KEY` a cadeia é SHA-256 puro, e
				quem tem escrita no banco reescreve a cauda inteira produzindo uma
				cadeia que fecha. O modo vivia implícito no prefixo `h:`/`s:` do hash
				da âncora — legível só por quem soubesse procurar.
			-->
			{#if integridade.modoCadeia === 'sha256'}
				<p class="mt-2 text-xs border-t border-current/20 pt-2">
					<strong>Encadeamento SHA-256 puro</strong> — `AUDIT_CHAIN_KEY` não está configurada. A trilha
					detecta adulteração acidental, mas quem tem escrita no banco consegue reescrever a cauda e produzir
					uma cadeia que fecha. Defina a chave para elevar a HMAC-SHA256.
				</p>
			{:else if integridade.modoCadeia === 'misto'}
				<p class="mt-2 text-xs border-t border-current/20 pt-2">
					<strong>Encadeamento misto</strong> — {integridade.encadeamento?.hmac} registro(s) em HMAC e
					{integridade.encadeamento?.sha256} em SHA-256 puro. A chave foi adotada no meio da vida do log;
					as linhas anteriores a ela seguem forjáveis por quem escreve no banco.
				</p>
			{:else if integridade.modoCadeia === 'hmac'}
				<p class="mt-2 text-xs opacity-70 border-t border-current/20 pt-2">
					Encadeamento HMAC-SHA256 ({integridade.encadeamento?.hmac} registro(s)): forjar a continuação
					exige a `AUDIT_CHAIN_KEY`, que não está no banco.
				</p>
			{/if}
		</div>
	{/if}

	<!-- KPIs -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
		<KpiCard rotulo="Total de eventos" valor={data.resumo.total.toLocaleString('pt-BR')} />
		<KpiCard rotulo="Falhas de login (24h)" valor={data.resumo.falhasLogin24h} destaque />
		<KpiCard rotulo="Eventos críticos (7d)" valor={data.resumo.criticos7d} destaque />
		<KpiCard rotulo="Último evento" valor={fmtData(data.resumo.ultimoEvento)} />
	</div>

	<!-- Destaques de segurança -->
	{#if data.criticosRecentes.length > 0}
		<div class="rounded-xl border border-error-500/30 bg-error-500/5 p-4">
			<div
				class="text-xs font-semibold uppercase tracking-wide text-error-700 dark:text-error-400 mb-2"
			>
				Destaques de segurança · eventos críticos recentes
			</div>
			<ul class="space-y-1 text-sm">
				{#each data.criticosRecentes as ev (ev.id)}
					<li class="flex flex-wrap items-baseline gap-x-2">
						<span class="text-surface-600 dark:text-surface-400 text-xs whitespace-nowrap"
							>{fmtData(ev.created_at)}</span
						>
						<span class="font-medium text-surface-900 dark:text-white">{rotuloAcao(ev.acao)}</span>
						<span class="text-surface-600 dark:text-surface-300">— {ev.usuario_nome || '—'}</span>
						{#if ev.detalhes}
							<span class="text-surface-600 dark:text-surface-400 text-xs">· {ev.detalhes}</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Filtros (GET → URL) -->
	<div class="space-y-3">
		<FiltrosToggle ativos={filtrosAtivos} bind:expandidos={filtrosExpandidos} />

		<form
			method="GET"
			class="{CLASSE_FORM_FILTRO_GET} {filtrosExpandidos ? 'grid' : 'hidden lg:grid'}"
		>
			<CampoFiltroGet label="Categoria" name="categoria">
				<option value="" selected={!data.filtros.categoria}>Todas</option>
				{#each data.facetas.categorias as c (c)}
					<option value={c} selected={data.filtros.categoria === c}>{CATEGORIA[c] ?? c}</option>
				{/each}
			</CampoFiltroGet>
			<CampoFiltroGet label="Ação" name="acao">
				<option value="" selected={!data.filtros.acao}>Todas</option>
				{#each data.facetas.acoes as a (a.valor)}
					<option value={a.valor} selected={data.filtros.acao === a.valor}>{a.label}</option>
				{/each}
			</CampoFiltroGet>
			<CampoFiltroGet label="Severidade" name="severidade">
				<option value="" selected={!data.filtros.severidade}>Todas</option>
				<option value="info" selected={data.filtros.severidade === 'info'}>Info</option>
				<option value="aviso" selected={data.filtros.severidade === 'aviso'}>Aviso</option>
				<option value="critico" selected={data.filtros.severidade === 'critico'}>Crítico</option>
			</CampoFiltroGet>
			<CampoFiltroGet label="Resultado" name="resultado">
				<option value="" selected={!data.filtros.resultado}>Todos</option>
				<option value="sucesso" selected={data.filtros.resultado === 'sucesso'}>Sucesso</option>
				<option value="falha" selected={data.filtros.resultado === 'falha'}>Falha</option>
				<option value="negado" selected={data.filtros.resultado === 'negado'}>Negado</option>
			</CampoFiltroGet>
			<CampoFiltroGet
				label="Busca (ator / detalhes / alvo)"
				name="busca"
				value={data.filtros.busca ?? ''}
				placeholder="texto livre"
				class="col-span-1 sm:col-span-2 lg:col-span-1"
			/>
			<CampoFiltroGet label="De" name="de" type="date" value={data.filtros.de ?? ''} />
			<CampoFiltroGet label="Até" name="ate" type="date" value={data.filtros.ate ?? ''} />
			<div class="flex items-end gap-2 pt-2 lg:pt-0 col-span-1 sm:col-span-2 lg:col-span-1">
				<button type="submit" class="btn preset-filled-primary-500 text-sm flex-1 justify-center"
					>Filtrar</button
				>
				{#if filtrosAtivos > 0}
					<a href="/auditoria" class="btn preset-outlined-surface-500 text-sm flex-1 justify-center"
						>Limpar</a
					>
				{/if}
			</div>
		</form>
	</div>

	<div class="flex justify-end -mb-2 text-sm text-surface-600 dark:text-surface-400">
		{data.total.toLocaleString('pt-BR')} resultado(s)
	</div>

	<!-- Logs List Section -->
	{#if data.logs.length > 0}
		<!-- Tabela (Desktop) -->
		<div class="hidden md:block table-wrap card-elevated rounded-2xl shadow-sm overflow-hidden">
			<table class="table w-full text-sm">
				<thead
					class="text-left text-xs uppercase tracking-wide text-surface-600 dark:text-surface-400 border-b border-surface-200 dark:border-white/10"
				>
					<tr>
						<th class="px-3 py-2">Data/hora</th>
						<th class="px-3 py-2">Severidade</th>
						<th class="px-3 py-2">Categoria</th>
						<th class="px-3 py-2">Ação</th>
						<th class="px-3 py-2">Ator</th>
						<th class="px-3 py-2">Alvo</th>
						<th class="px-3 py-2">Resultado</th>
					</tr>
				</thead>
				<tbody>
					{#each data.logs as log (log.id)}
						{@const res = RESULTADO[log.resultado ?? 'sucesso'] ?? RESULTADO.sucesso}
						{@const mudancas = diff(log.dados_antes, log.dados_depois)}
						<tr
							class="border-b border-surface-200/60 dark:border-white/5 hover:bg-surface-100/60 dark:hover:bg-surface-800/40 cursor-pointer"
							onclick={() => (expandido = expandido === log.id ? null : log.id)}
						>
							<td class="px-3 py-2 whitespace-nowrap text-surface-700 dark:text-surface-200">
								{fmtData(log.created_at)}
							</td>
							<td class="px-3 py-2">
								<ChipNivel nivel={log.severidade ?? 'info'} />
							</td>
							<td class="px-3 py-2 text-surface-600 dark:text-surface-300">
								{CATEGORIA[log.categoria ?? ''] ?? log.categoria ?? '—'}
							</td>
							<td class="px-3 py-2 font-medium text-surface-900 dark:text-white">
								{rotuloAcao(log.acao)}
							</td>
							<td class="px-3 py-2 text-surface-700 dark:text-surface-200">
								{log.usuario_nome || '—'}
								<span class="text-xs text-surface-600 dark:text-surface-400">
									{log.actor_tipo ? `· ${ACTOR[log.actor_tipo] ?? log.actor_tipo}` : ''}
								</span>
							</td>
							<td class="px-3 py-2 text-surface-600 dark:text-surface-300">
								{log.alvo_nome ?? (log.alvo_id ? `#${log.alvo_id}` : '—')}
							</td>
							<td class="px-3 py-2 font-medium {res.cls}">{res.label}</td>
						</tr>
						{#if expandido === log.id}
							<tr class="bg-surface-100/50 dark:bg-surface-800/30">
								<td colspan="7" class="px-4 py-3">
									<div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
										<div class="space-y-1">
											{#if log.detalhes}
												<p class="text-surface-800 dark:text-surface-100">{log.detalhes}</p>
											{/if}
											<dl
												class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-surface-600 dark:text-surface-300"
											>
												<dt class="font-medium">Entidade</dt>
												<dd>{log.entidade}{log.entidade_id ? ` #${log.entidade_id}` : ''}</dd>
												<dt class="font-medium">IP</dt>
												<dd>{log.ip ?? '—'}{log.ip_cifrado ? ' (completo cifrado)' : ''}</dd>
												<dt class="font-medium">Rota</dt>
												<dd>{log.metodo ?? ''} {log.rota ?? '—'}</dd>
												<dt class="font-medium">Request ID</dt>
												<dd class="font-mono">
													{#if log.request_id}
														<a
															href="/auditoria/logs?request_id={encodeURIComponent(log.request_id)}"
															class="text-primary-600 dark:text-primary-400 hover:underline"
															title="Ver logs técnicos desta request"
														>
															{log.request_id}
														</a>
													{:else}
														—
													{/if}
												</dd>
												<dt class="font-medium">Seq / Hash</dt>
												<dd class="font-mono break-all">
													{log.seq ?? '—'} · {log.hash_registro?.slice(0, 18) ?? '—'}…
												</dd>
												{#if log.user_agent}
													<dt class="font-medium">User-Agent</dt>
													<dd class="break-all">{log.user_agent}</dd>
												{/if}
											</dl>
										</div>
										<div class="space-y-2">
											{#if mudancas.length > 0}
												<div>
													<div
														class="text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1"
													>
														Alterações
													</div>
													<div
														class="table-wrap rounded border border-surface-200 dark:border-white/10"
													>
														<table class="table w-full text-xs">
															<thead class="text-surface-600 dark:text-surface-400">
																<tr>
																	<th class="px-2 py-1 text-left">Campo</th>
																	<th class="px-2 py-1 text-left">De</th>
																	<th class="px-2 py-1 text-left">Para</th>
																</tr>
															</thead>
															<tbody>
																{#each mudancas as m (m.campo)}
																	<tr class="border-t border-surface-200/60 dark:border-white/5">
																		<td class="px-2 py-1 font-medium">{m.campo}</td>
																		<td class="px-2 py-1 text-error-600 dark:text-error-400"
																			>{val(m.de)}</td
																		>
																		<td class="px-2 py-1 text-success-700 dark:text-success-400"
																			>{val(m.para)}</td
																		>
																	</tr>
																{/each}
															</tbody>
														</table>
													</div>
												</div>
											{/if}
											{#if parseJson(log.metadados)}
												<div>
													<div
														class="text-xs font-semibold text-surface-600 dark:text-surface-400 mb-1"
													>
														Metadados
													</div>
													<pre
														class="text-xs bg-surface-200/50 dark:bg-surface-950/50 rounded p-2 overflow-x-auto">{JSON.stringify(
															parseJson(log.metadados),
															null,
															2
														)}</pre>
												</div>
											{/if}
										</div>
									</div>
									<div class="mt-3 flex justify-end">
										<button
											type="button"
											onclick={() => baixar('pdf', { id: log.id })}
											disabled={baixando}
											class="btn preset-outlined-surface-500 text-xs"
										>
											Exportar este evento (PDF)
										</button>
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
				{@const res = RESULTADO[log.resultado ?? 'sucesso'] ?? RESULTADO.sucesso}
				{@const mudancas = diff(log.dados_antes, log.dados_depois)}

				<CardExpansivel
					aberto={expandido === log.id}
					onalternar={() => (expandido = expandido === log.id ? null : log.id)}
				>
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-1.5">
							<ChipNivel nivel={log.severidade ?? 'info'} />
							<span class="text-xs font-medium text-surface-600 dark:text-surface-400">
								{CATEGORIA[log.categoria ?? ''] ?? log.categoria ?? '—'}
							</span>
						</div>
						<span class="text-xs font-semibold {res.cls}">
							{res.label}
						</span>
					</div>

					<div>
						<h3 class="text-sm font-semibold text-surface-900 dark:text-white">
							{rotuloAcao(log.acao)}
						</h3>
					</div>

					<div class="grid grid-cols-2 gap-2 text-xs text-surface-600 dark:text-surface-300">
						<div>
							<span class="text-surface-600 dark:text-surface-400 block mb-0.5">Ator</span>
							<span class="font-medium text-surface-700 dark:text-surface-200">
								{log.usuario_nome || '—'}
								{#if log.actor_tipo}
									<span class="text-3xs text-surface-600 dark:text-surface-400 block">
										({ACTOR[log.actor_tipo] ?? log.actor_tipo})
									</span>
								{/if}
							</span>
						</div>
						<div>
							<span class="text-surface-600 dark:text-surface-400 block mb-0.5">Alvo</span>
							<span class="font-medium text-surface-700 dark:text-surface-200">
								{log.alvo_nome ?? (log.alvo_id ? `#${log.alvo_id}` : '—')}
							</span>
						</div>
					</div>

					<div
						class="flex items-center justify-between border-t border-surface-200/50 dark:border-white/5 pt-2 text-xs text-surface-600 dark:text-surface-400"
					>
						<span>{fmtData(log.created_at)}</span>
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
							class="border-t border-surface-200/60 dark:border-white/10 pt-3 mt-3 space-y-4 text-xs"
							onclick={(e) => e.stopPropagation()}
						>
							<div class="space-y-2">
								{#if log.detalhes}
									<p class="text-sm text-surface-800 dark:text-surface-100 font-medium">
										{log.detalhes}
									</p>
								{/if}

								<div class="bg-surface-100/50 dark:bg-surface-800/40 rounded-lg p-3">
									<dl
										class="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1.5 text-surface-600 dark:text-surface-300"
									>
										<dt class="font-semibold text-surface-600 dark:text-surface-400">Entidade</dt>
										<dd class="text-surface-800 dark:text-surface-200">
											{log.entidade}{log.entidade_id ? ` #${log.entidade_id}` : ''}
										</dd>

										<dt class="font-semibold text-surface-600 dark:text-surface-400">IP</dt>
										<dd class="text-surface-800 dark:text-surface-200">
											{log.ip ?? '—'}{log.ip_cifrado ? ' (completo cifrado)' : ''}
										</dd>

										<dt class="font-semibold text-surface-600 dark:text-surface-400">Rota</dt>
										<dd class="text-surface-800 dark:text-surface-200">
											{log.metodo ?? ''}
											{log.rota ?? '—'}
										</dd>

										<dt class="font-semibold text-surface-600 dark:text-surface-400">Request ID</dt>
										<dd class="font-mono text-surface-700 dark:text-surface-300 break-all">
											{#if log.request_id}
												<a
													href="/auditoria/logs?request_id={encodeURIComponent(log.request_id)}"
													class="text-primary-600 dark:text-primary-400 hover:underline"
												>
													{log.request_id}
												</a>
											{:else}
												—
											{/if}
										</dd>

										<dt class="font-semibold text-surface-600 dark:text-surface-400">Seq / Hash</dt>
										<dd class="font-mono text-surface-700 dark:text-surface-300 break-all">
											{log.seq ?? '—'} · {log.hash_registro?.slice(0, 18) ?? '—'}…
										</dd>

										{#if log.user_agent}
											<dt class="font-semibold text-surface-600 dark:text-surface-400">
												User-Agent
											</dt>
											<dd class="break-all text-surface-700 dark:text-surface-300">
												{log.user_agent}
											</dd>
										{/if}
									</dl>
								</div>
							</div>

							{#if mudancas.length > 0}
								<div class="space-y-1">
									<div class="font-semibold text-surface-600 dark:text-surface-400">Alterações</div>
									<!-- `table-wrap` já faz overflow-x:auto (VIS-3): valores de
									     "De"/"Para" podem ser longos (JSON, user agent) e a tabela
									     transborda dentro do log expandido. -->
									<div class="table-wrap border border-surface-200 dark:border-white/10 rounded-lg">
										<table class="table w-full text-xs">
											<thead
												class="bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400"
											>
												<tr>
													<th class="px-2 py-1.5 text-left font-medium">Campo</th>
													<th class="px-2 py-1.5 text-left font-medium">De</th>
													<th class="px-2 py-1.5 text-left font-medium">Para</th>
												</tr>
											</thead>
											<tbody
												class="divide-y divide-surface-200/60 dark:divide-white/5 bg-white dark:bg-surface-900"
											>
												{#each mudancas as m (m.campo)}
													<tr>
														<td
															class="px-2 py-1.5 font-medium text-surface-800 dark:text-surface-200"
															>{m.campo}</td
														>
														<td class="px-2 py-1.5 text-error-600 dark:text-error-400 break-all"
															>{val(m.de)}</td
														>
														<td class="px-2 py-1.5 text-success-700 dark:text-success-400 break-all"
															>{val(m.para)}</td
														>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								</div>
							{/if}

							{#if parseJson(log.metadados)}
								<div class="space-y-1">
									<div class="font-semibold text-surface-600 dark:text-surface-400">Metadados</div>
									<pre
										class="text-xs bg-surface-200/50 dark:bg-surface-950/50 rounded-lg p-2.5 overflow-x-auto text-surface-800 dark:text-surface-200 font-mono">{JSON.stringify(
											parseJson(log.metadados),
											null,
											2
										)}</pre>
								</div>
							{/if}

							<div class="pt-2 flex justify-end">
								<button
									type="button"
									onclick={() => baixar('pdf', { id: log.id })}
									disabled={baixando}
									class="btn preset-outlined-surface-500 text-xs w-full justify-center"
								>
									Exportar este evento (PDF)
								</button>
							</div>
						</div>
					{/if}
				</CardExpansivel>
			{/each}
		</div>
	{:else}
		<EstadoVazio
			class="py-20"
			mensagem="Nenhum evento encontrado"
			descricao="Tente ajustar os filtros acima para visualizar mais eventos."
		>
			{#snippet icone()}
				<SearchX class="w-10 h-10 text-surface-400" aria-hidden="true" />
			{/snippet}
		</EstadoVazio>
	{/if}

	<!-- Paginação -->
	<Paginacao
		page={data.page}
		totalPages={data.totalPages}
		href={(p) => `?${queryString({ page: p })}`}
	/>
</div>
