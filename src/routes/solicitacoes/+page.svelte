<script lang="ts">
	/**
	 * A fila de decisão do Admin Geral (`/solicitacoes`): o que os administradores
	 * de seccional e de unidade pediram sobre os servidores deles.
	 *
	 * Duas listas, porque são duas consequências diferentes de um mesmo clique:
	 *
	 *  - **dados cadastrais** — tabela no desktop, cards abaixo de `md`, uma linha
	 *    por campo. Aprovar grava o valor no cadastro na hora;
	 *  - **ações de RH** — cartões, um por pedido, com o conteúdo INTEIRO à vista
	 *    (datas, NUP, origem/destino, justificativa) e o botão que baixa a portaria
	 *    anexada. Aprovar aqui movimenta, afasta ou INATIVA um servidor — decisão
	 *    que ninguém deve tomar por um resumo de uma linha.
	 *
	 * As duas actions devolvem a lista já sem o item decidido; usar essa resposta
	 * evita um `invalidateAll()` (e o piscar da tela) a cada decisão.
	 */
	import Check from '@lucide/svelte/icons/check';
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { mostrarErroDeResultado } from '$lib/enhance-handler';
	import { ROTULO_CAMPO, textoDoValorSolicitado } from '$lib/cadastro-campos';
	import DetalheSolicitacaoAcao from '$lib/components/DetalheSolicitacaoAcao.svelte';
	import type { ActionResult } from '@sveltejs/kit';

	const { data }: PageProps = $props();

	/** O valor como se lê: `designacao_id` vira o nome da função (E50). */
	const texto = (campo: string, valor: string | null) =>
		textoDoValorSolicitado(
			campo as Parameters<typeof textoDoValorSolicitado>[0],
			valor,
			data.designacoes
		);

	// Derivados graváveis: espelham o load, mas admitem a atualização local.
	let pendentes = $derived(data.pendentes);
	let acoesPendentes = $derived(data.acoesPendentes);

	let decidindoId = $state<number | null>(null);
	let decidindoAcaoId = $state<number | null>(null);

	const ROTULO_TIPO_ACAO: Record<string, string> = {
		movimentacao: 'Movimentação',
		afastamento: 'Afastamento',
		desvinculacao: 'Desvinculação',
		// Ato sobre a UNIDADE, não sobre o servidor: aprovar grava a sucessão da
		// unidade e não toca na linha do tempo funcional dele (E54).
		direcao: 'Direção de unidade'
	};

	const vazio = $derived(pendentes.length === 0 && acoesPendentes.length === 0);

	function handleDecidir(id: number, decisao: 'aprovar' | 'rejeitar') {
		decidindoId = id;
		return async ({ result }: { result: ActionResult }) => {
			decidindoId = null;
			if (result.type === 'success') {
				pendentes = (result.data?.pendentes as typeof pendentes) ?? pendentes;
				toaster.create({
					title: decisao === 'aprovar' ? 'Alteração aprovada e aplicada' : 'Solicitação rejeitada',
					type: decisao === 'aprovar' ? 'success' : 'info'
				});
			} else {
				mostrarErroDeResultado(result, 'Erro ao decidir');
			}
		};
	}

	function handleDecidirAcao(id: number, decisao: 'aprovar' | 'rejeitar', rotulo: string) {
		decidindoAcaoId = id;
		return async ({ result }: { result: ActionResult }) => {
			decidindoAcaoId = null;
			if (result.type === 'success') {
				acoesPendentes = (result.data?.acoesPendentes as typeof acoesPendentes) ?? acoesPendentes;
				toaster.create({
					title: decisao === 'aprovar' ? `${rotulo} aprovada e aplicada` : `${rotulo} rejeitada`,
					type: decisao === 'aprovar' ? 'success' : 'info'
				});
			} else {
				mostrarErroDeResultado(result, 'Erro ao decidir');
			}
		};
	}

	/** `created_at` vem em horário local ("YYYY-MM-DD HH:MM:SS") ou ISO UTC. */
	function fmtDataHora(ts: string): string {
		return new Date(ts + (ts.includes('T') ? '' : 'Z')).toLocaleString('pt-BR', {
			dateStyle: 'short',
			timeStyle: 'short'
		});
	}
</script>

<svelte:head><title>Solicitações</title></svelte:head>

<div class="max-w-5xl mx-auto space-y-6">
	<div>
		<h1 class="h1 text-2xl font-bold">Solicitações</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
			Pedidos enviados pelos administradores de seccional e de unidade sobre os servidores do escopo
			deles. Aprovar aplica o pedido imediatamente.
		</p>
	</div>

	{#if vazio}
		<div class="card-glass p-10 rounded-3xl text-center text-surface-600 dark:text-surface-400">
			<p class="font-semibold">Nenhuma solicitação pendente.</p>
			<p class="text-xs mt-1">
				Quando um administrador pedir alteração de cadastro, movimentação, afastamento ou
				desvinculação, o pedido aparecerá aqui.
			</p>
		</div>
	{/if}

	{#if pendentes.length > 0}
		<section class="space-y-3">
			<h2
				class="font-semibold text-sm uppercase tracking-wider text-surface-600 dark:text-surface-400"
			>
				Dados cadastrais
				<span
					class="ml-1 text-3xs font-bold px-2 py-0.5 rounded-full bg-warning-500/15 text-warning-700 dark:text-warning-400"
				>
					{pendentes.length}
				</span>
			</h2>
			<div class="card-glass rounded-3xl overflow-hidden">
				<div class="hidden md:block table-wrap">
					<table class="table w-full text-sm">
						<thead>
							<tr
								class="text-left text-xs uppercase text-surface-600 dark:text-surface-400 border-b border-surface-200 dark:border-white/10"
							>
								<th class="py-3 px-4">Servidor</th>
								<th class="py-3 px-4">Campo</th>
								<th class="py-3 px-4">De</th>
								<th class="py-3 px-4">Para</th>
								<th class="py-3 px-4">Justificativa</th>
								<th class="py-3 px-4">Solicitada em</th>
								<th class="py-3 px-4 text-right">Ações</th>
							</tr>
						</thead>
						<tbody>
							{#each pendentes as s (s.id)}
								<tr
									class="border-b border-surface-100 dark:border-white/5 hover:bg-surface-100/50 dark:hover:bg-surface-800/30 transition-colors align-top"
								>
									<td class="py-3 px-4">
										<p class="font-semibold leading-tight">{s.policial_nome}</p>
										<p class="text-xs text-surface-600 dark:text-surface-400">
											{s.policial_matricula} · {s.policial_cargo} · {s.policial_lotacao}
										</p>
									</td>
									<td class="py-3 px-4 font-medium whitespace-nowrap">{ROTULO_CAMPO[s.campo]}</td>
									<td class="py-3 px-4 text-surface-600 dark:text-surface-400"
										>{texto(s.campo, s.valor_atual) || '—'}</td
									>
									<td class="py-3 px-4 font-semibold">{texto(s.campo, s.valor_novo)}</td>
									<td class="py-3 px-4 text-surface-600 dark:text-surface-400 max-w-xs break-words">
										<p>{s.justificativa || '—'}</p>
										{#if s.solicitante_nome}
											<p class="text-2xs mt-1 opacity-70">por {s.solicitante_nome}</p>
										{/if}
									</td>
									<td
										class="py-3 px-4 text-xs text-surface-600 dark:text-surface-400 whitespace-nowrap"
									>
										{fmtDataHora(s.created_at)}
									</td>
									<td class="py-3 px-4">
										<div class="flex items-center gap-1.5 justify-end">
											<form
												method="POST"
												action="?/decidir"
												use:enhance={() => handleDecidir(s.id, 'aprovar')}
											>
												<input type="hidden" name="id" value={s.id} />
												<input type="hidden" name="decisao" value="aprovar" />
												<button
													type="submit"
													class="btn-icon btn-sm preset-filled-success-500 disabled:opacity-40"
													title="Aprovar e aplicar"
													aria-label="Aprovar solicitação de {s.policial_nome}"
													disabled={decidindoId === s.id}
												>
													<Check class="w-5 h-5" strokeWidth={2.5} aria-hidden="true" />
												</button>
											</form>
											<form
												method="POST"
												action="?/decidir"
												use:enhance={() => handleDecidir(s.id, 'rejeitar')}
											>
												<input type="hidden" name="id" value={s.id} />
												<input type="hidden" name="decisao" value="rejeitar" />
												<button
													type="submit"
													class="btn-icon btn-sm preset-outlined-error-500 disabled:opacity-40"
													title="Rejeitar"
													aria-label="Rejeitar solicitação de {s.policial_nome}"
													disabled={decidindoId === s.id}
												>
													<svg
														class="w-5 h-5"
														fill="none"
														viewBox="0 0 24 24"
														stroke="currentColor"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2.5"
															d="M6 18L18 6M6 6l12 12"
														/>
													</svg>
												</button>
											</form>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<ul class="md:hidden divide-y divide-surface-200 dark:divide-white/10">
					{#each pendentes as s (s.id)}
						<li class="p-4 space-y-3">
							<div class="min-w-0">
								<p class="font-semibold leading-tight break-words">{s.policial_nome}</p>
								<p class="text-xs text-surface-600 dark:text-surface-400 break-words">
									{s.policial_matricula} · {s.policial_cargo} · {s.policial_lotacao}
								</p>
							</div>
							<dl class="grid grid-cols-1 gap-2 text-sm">
								<div>
									<dt
										class="text-2xs font-semibold uppercase text-surface-600 dark:text-surface-400"
									>
										Campo
									</dt>
									<dd class="font-medium">{ROTULO_CAMPO[s.campo]}</dd>
								</div>
								<div>
									<dt
										class="text-2xs font-semibold uppercase text-surface-600 dark:text-surface-400"
									>
										De
									</dt>
									<dd class="text-surface-600 dark:text-surface-400 break-words">
										{texto(s.campo, s.valor_atual) || '—'}
									</dd>
								</div>
								<div>
									<dt
										class="text-2xs font-semibold uppercase text-surface-600 dark:text-surface-400"
									>
										Para
									</dt>
									<dd class="font-semibold break-words">{texto(s.campo, s.valor_novo)}</dd>
								</div>
								<div>
									<dt
										class="text-2xs font-semibold uppercase text-surface-600 dark:text-surface-400"
									>
										Justificativa
									</dt>
									<dd class="text-surface-600 dark:text-surface-400 break-words">
										{s.justificativa || '—'}
										{#if s.solicitante_nome}
											<span class="block text-2xs mt-1 opacity-70">por {s.solicitante_nome}</span>
										{/if}
									</dd>
								</div>
								<div>
									<dt
										class="text-2xs font-semibold uppercase text-surface-600 dark:text-surface-400"
									>
										Solicitada em
									</dt>
									<dd class="text-xs text-surface-600 dark:text-surface-400">
										{fmtDataHora(s.created_at)}
									</dd>
								</div>
							</dl>
							<div class="grid grid-cols-2 gap-2 pt-1">
								<form
									method="POST"
									action="?/decidir"
									use:enhance={() => handleDecidir(s.id, 'rejeitar')}
								>
									<input type="hidden" name="id" value={s.id} />
									<input type="hidden" name="decisao" value="rejeitar" />
									<button
										type="submit"
										class="btn btn-sm preset-outlined-error-500 w-full justify-center disabled:opacity-40"
										aria-label="Rejeitar solicitação de {s.policial_nome}"
										disabled={decidindoId === s.id}
									>
										Rejeitar
									</button>
								</form>
								<form
									method="POST"
									action="?/decidir"
									use:enhance={() => handleDecidir(s.id, 'aprovar')}
								>
									<input type="hidden" name="id" value={s.id} />
									<input type="hidden" name="decisao" value="aprovar" />
									<button
										type="submit"
										class="btn btn-sm preset-filled-success-500 w-full justify-center disabled:opacity-40"
										aria-label="Aprovar solicitação de {s.policial_nome}"
										disabled={decidindoId === s.id}
									>
										Aprovar
									</button>
								</form>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		</section>
	{/if}

	{#if acoesPendentes.length > 0}
		<section class="space-y-3">
			<h2
				class="font-semibold text-sm uppercase tracking-wider text-surface-600 dark:text-surface-400"
			>
				Movimentação, afastamento e desvinculação
				<span
					class="ml-1 text-3xs font-bold px-2 py-0.5 rounded-full bg-warning-500/15 text-warning-700 dark:text-warning-400"
				>
					{acoesPendentes.length}
				</span>
			</h2>

			{#each acoesPendentes as s (s.id)}
				{@const rotulo = ROTULO_TIPO_ACAO[s.tipo] ?? s.tipo}
				<div class="card-glass rounded-3xl p-4 sm:p-6 space-y-4">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p class="font-semibold leading-tight">
								{rotulo} · {s.policial_nome}
							</p>
							<p class="text-xs text-surface-600 dark:text-surface-400">
								{s.policial_matricula} · {s.policial_cargo} · {s.policial_lotacao}
							</p>
						</div>
						<p class="text-xs text-surface-600 dark:text-surface-400 whitespace-nowrap">
							Pedida por {s.solicitante_nome || '—'} em {fmtDataHora(s.created_at)}
						</p>
					</div>

					<DetalheSolicitacaoAcao solicitacao={s} />

					<div
						class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-surface-200 dark:border-white/10"
					>
						<form
							method="POST"
							action="?/decidirAcao"
							use:enhance={() => handleDecidirAcao(s.id, 'rejeitar', rotulo)}
						>
							<input type="hidden" name="id" value={s.id} />
							<input type="hidden" name="decisao" value="rejeitar" />
							<button
								type="submit"
								class="btn btn-sm preset-outlined-error-500 w-full sm:w-auto disabled:opacity-40"
								aria-label="Rejeitar {rotulo.toLowerCase()} de {s.policial_nome}"
								disabled={decidindoAcaoId === s.id}
							>
								Rejeitar
							</button>
						</form>
						<form
							method="POST"
							action="?/decidirAcao"
							use:enhance={() => handleDecidirAcao(s.id, 'aprovar', rotulo)}
						>
							<input type="hidden" name="id" value={s.id} />
							<input type="hidden" name="decisao" value="aprovar" />
							<button
								type="submit"
								class="btn btn-sm preset-filled-success-500 w-full sm:w-auto disabled:opacity-40"
								aria-label="Aprovar {rotulo.toLowerCase()} de {s.policial_nome}"
								disabled={decidindoAcaoId === s.id}
							>
								Aprovar e aplicar
							</button>
						</form>
					</div>
				</div>
			{/each}
		</section>
	{/if}
</div>
