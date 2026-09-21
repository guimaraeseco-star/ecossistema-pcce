<script lang="ts">
	/**
	 * O que já foi PEDIDO sobre este servidor e o que o Admin Geral decidiu.
	 *
	 * Responde à pergunta que a ficha, sozinha, deixava sem resposta: "já pedi
	 * isso?". Sem o quadro, o administrador que pede a correção do telefone hoje
	 * não tem como saber, amanhã, se o pedido está na fila ou foi recusado — e o
	 * caminho natural passa a ser pedir de novo.
	 *
	 * Aparece para os dois modos da ficha, com leituras diferentes: quem pede
	 * acompanha o próprio pedido; o Admin Geral vê, ao abrir a ficha, que existe
	 * decisão pendente sobre aquele servidor antes de editar o cadastro por cima
	 * dela.
	 */
	import { ROTULO_CAMPO, textoDoValorSolicitado } from '$lib/cadastro-campos';
	import StatusSolicitacao from '$lib/components/StatusSolicitacao.svelte';
	import DetalheSolicitacaoAcao from '$lib/components/DetalheSolicitacaoAcao.svelte';
	import type { CadastroSolicitacao, PolicialAcaoSolicitacao } from '$lib/types';
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { toaster } from '$lib/toast';
	import { formatarNUP } from '$lib/utils/formato';
	import { adicionarDias, formatarData, hojeLocalISO } from '$lib/utils/datas';

	const ROTULO_TIPO_ACAO: Record<string, string> = {
		movimentacao: 'Movimentação',
		afastamento: 'Afastamento',
		desvinculacao: 'Desvinculação',
		// Ato sobre a UNIDADE, não sobre o servidor: aprovar grava a sucessão da
		// unidade e não toca na linha do tempo funcional dele (E54).
		direcao: 'Direção de unidade',
		retorno_antecipado: 'Retorno antecipado'
	};

	const {
		campos,
		acoes,
		/** Catálogo para resolver `designacao_id` — sem ele a fila mostraria "11". */
		designacoes = [],
		policialId,
		podePedirRetorno = true
	}: {
		campos: CadastroSolicitacao[];
		acoes: PolicialAcaoSolicitacao[];
		designacoes?: { id: number; nome: string }[];
		/** O servidor da ficha, para o `invalidateShared` depois do retorno antecipado. */
		policialId: number;
		/** Colaborador sem `servidores.afastamento` (E61) só acompanha: sem o botão de retorno. */
		podePedirRetorno?: boolean;
	} = $props();

	/* ── retorno antecipado (decisão dele, 20/09): no pedido de afastamento
	     APROVADO e ainda em curso — a unidade e o DPI SUL registram direto a
	     data do retorno e o NUP; o afastamento encurta até a véspera. ── */
	const hoje = hojeLocalISO();
	/**
	 * O pedido de retorno antecipado mais recente deste afastamento (mesmo
	 * subtipo e 1º dia). É informação DO CARD do afastamento — não um card à
	 * parte: pendente avisa, aprovado muda o término, rejeitado libera o botão.
	 */
	const retornoDo = (s: PolicialAcaoSolicitacao) =>
		acoes
			.filter(
				(r) =>
					r.tipo === 'retorno_antecipado' &&
					r.subtipo === s.subtipo &&
					r.data_inicio === s.data_inicio
			)
			.sort((a, b) => b.id - a.id)[0] ?? null;
	/** O fim que valeu: a véspera do retorno aprovado, ou o previsto. */
	const fimEfetivoDe = (s: PolicialAcaoSolicitacao) => {
		const r = retornoDo(s);
		return r?.status === 'aprovada' && r.data_evento ? adicionarDias(r.data_evento, -1) : null;
	};
	/** Já há retorno pedido (pendente) ou aprovado? Então o botão some; volta se rejeitado. */
	const retornoJaPedido = (s: PolicialAcaoSolicitacao) => {
		const r = retornoDo(s);
		return !!r && r.status !== 'rejeitada';
	};
	/** Os pedidos de retorno não aparecem como cards: moram no card do afastamento. */
	const acoesVisiveis = $derived(acoes.filter((a) => a.tipo !== 'retorno_antecipado'));
	const admiteRetorno = (s: PolicialAcaoSolicitacao) =>
		podePedirRetorno &&
		s.tipo === 'afastamento' &&
		s.status === 'aprovada' &&
		s.subtipo !== 'ferias' &&
		!!s.data_inicio &&
		s.data_inicio <= hoje &&
		(!s.data_fim || s.data_fim >= hoje) &&
		!retornoJaPedido(s);
	const fmtDecisao = (iso: string | null) => (iso ? formatarData(iso.slice(0, 10)) : '');
	let retornoDe = $state<number | null>(null);

	/** Aberto = pendente, ou afastamento aprovado ainda em curso. */
	const acaoAberta = (a: PolicialAcaoSolicitacao) =>
		a.status === 'pendente' ||
		(a.status === 'aprovada' &&
			a.tipo === 'afastamento' &&
			!!a.data_inicio &&
			(fimEfetivoDe(a) ?? a.data_fim ?? '9999-12-31') >= hoje);
	const camposAbertos = $derived(campos.filter((c) => c.status === 'pendente'));
	const camposAnteriores = $derived(campos.filter((c) => c.status !== 'pendente'));
	const acoesAbertas = $derived(acoesVisiveis.filter(acaoAberta));
	const acoesAnteriores = $derived(acoesVisiveis.filter((a) => !acaoAberta(a)));
	let enviando = $state(false);
	function aoResponder() {
		enviando = true;
		return async ({ result }: { result: ActionResult }) => {
			enviando = false;
			if (result.type === 'success') {
				const d = result.data as { solicitacoesAcao?: unknown } | undefined;
				toaster.create({
					title: d?.solicitacoesAcao
						? 'Pedido de retorno antecipado enviado ao Admin Geral'
						: 'Retorno antecipado registrado',
					type: 'success'
				});
				retornoDe = null;
				await invalidateShared(`policial:${policialId}`, 'app:policiais');
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error ?? 'Não foi possível concluir'), type: 'error' });
			}
		};
	}

	const texto = (campo: string, valor: string | null) =>
		textoDoValorSolicitado(
			campo as Parameters<typeof textoDoValorSolicitado>[0],
			valor,
			designacoes
		);

	const pendentes = $derived(
		campos.filter((s) => s.status === 'pendente').length +
			acoes.filter((s) => s.status === 'pendente').length
	);
</script>

{#if campos.length > 0 || acoes.length > 0}
	<div class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6 mt-4">
		<h2 class="text-base font-bold mb-1 text-surface-700 dark:text-surface-300">
			Solicitações deste servidor
			{#if pendentes > 0}
				<span
					class="ml-2 text-3xs font-bold px-2 py-0.5 rounded-full bg-warning-500/15 text-warning-700 dark:text-warning-400"
				>
					{pendentes} pendente{pendentes > 1 ? 's' : ''}
				</span>
			{/if}
		</h2>
		<p class="text-xs text-surface-600 dark:text-surface-400 mb-3">
			Pedidos enviados ao Administrador Geral. Só entram no cadastro depois de aprovados.
		</p>

		<!-- O que ainda importa fica aberto: pendentes e afastamentos aprovados em
		     curso. O resto (rejeitado, ou aprovado e já passado) vai para
		     "anteriores", recolhido — o histórico já o registra (decisão dele,
		     20/09). -->
		{@render quadro(camposAbertos, acoesAbertas)}
		{#if camposAbertos.length === 0 && acoesAbertas.length === 0}
			<p class="text-sm text-surface-500">Nenhum pedido em aberto.</p>
		{/if}
		{#if camposAnteriores.length > 0 || acoesAnteriores.length > 0}
			<details class="mt-4">
				<summary class="cursor-pointer text-xs font-semibold text-surface-500"
					>Ver anteriores ({camposAnteriores.length + acoesAnteriores.length})</summary
				>
				<div class="mt-3 opacity-80">
					{@render quadro(camposAnteriores, acoesAnteriores)}
				</div>
			</details>
		{/if}
	</div>
{/if}

{#snippet quadro(lc: CadastroSolicitacao[], la: PolicialAcaoSolicitacao[])}
	{#if lc.length > 0}
		<div class="hidden md:block table-wrap">
			<table class="table w-full text-sm">
				<thead>
					<tr class="text-left text-xs uppercase text-surface-600 dark:text-surface-400">
						<th class="py-2">Campo</th>
						<th class="py-2">De</th>
						<th class="py-2">Para</th>
						<th class="py-2">Justificativa</th>
						<th class="py-2">Solicitante</th>
						<th class="py-2">Status</th>
					</tr>
				</thead>
				<tbody>
					{#each lc as s (s.id)}
						<tr class="border-t border-surface-200 dark:border-white/5 align-top">
							<td class="py-2 font-medium whitespace-nowrap">{ROTULO_CAMPO[s.campo]}</td>
							<td class="py-2 text-surface-600 dark:text-surface-400"
								>{texto(s.campo, s.valor_atual) || '—'}</td
							>
							<td class="py-2 font-semibold">{texto(s.campo, s.valor_novo)}</td>
							<td class="py-2 text-surface-600 dark:text-surface-400 max-w-xs break-words">
								{s.justificativa || '—'}
							</td>
							<td class="py-2 text-surface-600 dark:text-surface-400">
								{s.solicitante_nome || '—'}
							</td>
							<td class="py-2"><StatusSolicitacao status={s.status} /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<ul class="md:hidden space-y-3">
			{#each lc as s (s.id)}
				<li class="rounded-xl border border-surface-200 dark:border-white/10 p-3 space-y-2">
					<div class="flex items-start justify-between gap-2">
						<p class="min-w-0 font-medium text-sm break-words">{ROTULO_CAMPO[s.campo]}</p>
						<div class="shrink-0"><StatusSolicitacao status={s.status} /></div>
					</div>
					<dl class="grid grid-cols-1 gap-1.5 text-sm">
						<div>
							<dt class="text-2xs font-semibold uppercase text-surface-600 dark:text-surface-400">
								De
							</dt>
							<dd class="text-surface-600 dark:text-surface-400 break-words">
								{texto(s.campo, s.valor_atual) || '—'}
							</dd>
						</div>
						<div>
							<dt class="text-2xs font-semibold uppercase text-surface-600 dark:text-surface-400">
								Para
							</dt>
							<dd class="font-semibold break-words">{texto(s.campo, s.valor_novo)}</dd>
						</div>
						<div>
							<dt class="text-2xs font-semibold uppercase text-surface-600 dark:text-surface-400">
								Justificativa
							</dt>
							<dd class="text-surface-600 dark:text-surface-400 break-words">
								{s.justificativa || '—'}
							</dd>
						</div>
						<p class="text-2xs text-surface-600 dark:text-surface-400">
							Solicitado por {s.solicitante_nome || '—'}
						</p>
					</dl>
				</li>
			{/each}
		</ul>
	{/if}

	{#if la.length > 0}
		<div class="space-y-3 {lc.length > 0 ? 'mt-4' : ''}">
			{#each la as s (s.id)}
				<div class="rounded-xl border border-surface-200 dark:border-white/10 p-3">
					<div class="flex items-center justify-between gap-2 mb-2">
						<span class="font-semibold text-sm">
							{ROTULO_TIPO_ACAO[s.tipo] ?? s.tipo}
						</span>
						<StatusSolicitacao status={s.status} />
					</div>
					<DetalheSolicitacaoAcao solicitacao={s} compacto fimEfetivo={fimEfetivoDe(s)} />
					<p class="text-2xs text-surface-600 dark:text-surface-400 mt-2">
						Solicitado por {s.solicitante_nome || '—'}
					</p>
					<!-- O retorno antecipado deste afastamento: dois processos, dois NUPs —
					     o do afastamento acima, o do retorno aqui. -->
					{#if s.tipo === 'afastamento' && retornoDo(s)}
						{@const r = retornoDo(s)!}
						<p
							class="mt-2 rounded-md px-3 py-1.5 text-xs font-semibold {r.status === 'pendente'
								? 'border-l-4 border-warning-500 bg-warning-500/10 text-warning-800 dark:text-warning-300'
								: r.status === 'aprovada'
									? 'border-l-4 border-success-500 bg-success-500/10 text-success-800 dark:text-success-300'
									: 'border-l-4 border-error-500 bg-error-500/10 text-error-700 dark:text-error-300'}"
						>
							{#if r.status === 'pendente'}
								⏳ Retorno antecipado pedido: volta ao serviço em {formatarData(
									r.data_evento ?? ''
								)}{#if r.nup}
									· NUP do retorno {r.nup}{/if} — aguardando o Admin Geral
							{:else if r.status === 'aprovada'}
								✔ Retorno antecipado em {formatarData(r.data_evento ?? '')}{#if r.nup}
									· NUP do retorno {r.nup}{/if} — aprovado em {fmtDecisao(r.decidido_em)}
							{:else}
								✖ Retorno antecipado de {formatarData(r.data_evento ?? '')} rejeitado em {fmtDecisao(
									r.decidido_em
								)}
							{/if}
						</p>
					{/if}
					{#if admiteRetorno(s)}
						{#if retornoDe === s.id}
							<form
								method="POST"
								action="?/retornoAntecipado"
								use:enhance={aoResponder}
								class="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-primary-500/30 bg-primary-500/5 p-2"
							>
								<input type="hidden" name="solicitacao_id" value={s.id} />
								<label class="label">
									<span class="label-text text-2xs font-bold uppercase opacity-70"
										>Retorno ao serviço</span
									>
									<input
										class="input px-2 py-1 text-xs"
										type="date"
										name="data_retorno"
										min={s.data_inicio ?? undefined}
										max={s.data_fim ?? undefined}
										required
									/>
								</label>
								<label class="label">
									<span class="label-text text-2xs font-bold uppercase opacity-70"
										>NUP do retorno</span
									>
									<input
										class="input w-48 px-2 py-1 text-xs font-mono"
										name="nup"
										maxlength="20"
										placeholder="00000.000000/0000-00"
										oninput={(e) => (e.currentTarget.value = formatarNUP(e.currentTarget.value))}
									/>
								</label>
								<button
									type="submit"
									class="btn btn-sm preset-filled-primary-500"
									disabled={enviando}>Registrar retorno</button
								>
								<button
									type="button"
									class="btn btn-sm preset-outlined-surface-500"
									onclick={() => (retornoDe = null)}>Cancelar</button
								>
							</form>
						{:else}
							<button
								type="button"
								class="btn btn-sm preset-outlined-surface-500 mt-2"
								onclick={() => (retornoDe = s.id)}>Retorno antecipado</button
							>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
{/snippet}
