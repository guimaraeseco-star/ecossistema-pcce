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
	import { ROTULO_CAMPO } from '$lib/cadastro-campos';
	import StatusSolicitacao from '$lib/components/StatusSolicitacao.svelte';
	import DetalheSolicitacaoAcao from '$lib/components/DetalheSolicitacaoAcao.svelte';
	import type { CadastroSolicitacao, PolicialAcaoSolicitacao } from '$lib/types';

	const ROTULO_TIPO_ACAO: Record<string, string> = {
		movimentacao: 'Movimentação',
		afastamento: 'Afastamento',
		desvinculacao: 'Desvinculação'
	};

	const { campos, acoes }: { campos: CadastroSolicitacao[]; acoes: PolicialAcaoSolicitacao[] } =
		$props();

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

		{#if campos.length > 0}
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
						{#each campos as s (s.id)}
							<tr class="border-t border-surface-200 dark:border-white/5 align-top">
								<td class="py-2 font-medium whitespace-nowrap">{ROTULO_CAMPO[s.campo]}</td>
								<td class="py-2 text-surface-600 dark:text-surface-400">{s.valor_atual || '—'}</td>
								<td class="py-2 font-semibold">{s.valor_novo}</td>
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
				{#each campos as s (s.id)}
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
									{s.valor_atual || '—'}
								</dd>
							</div>
							<div>
								<dt class="text-2xs font-semibold uppercase text-surface-600 dark:text-surface-400">
									Para
								</dt>
								<dd class="font-semibold break-words">{s.valor_novo}</dd>
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

		{#if acoes.length > 0}
			<div class="space-y-3 {campos.length > 0 ? 'mt-4' : ''}">
				{#each acoes as s (s.id)}
					<div class="rounded-xl border border-surface-200 dark:border-white/10 p-3">
						<div class="flex items-center justify-between gap-2 mb-2">
							<span class="font-semibold text-sm">
								{ROTULO_TIPO_ACAO[s.tipo] ?? s.tipo}
							</span>
							<StatusSolicitacao status={s.status} />
						</div>
						<DetalheSolicitacaoAcao solicitacao={s} compacto />
						<p class="text-2xs text-surface-600 dark:text-surface-400 mt-2">
							Solicitado por {s.solicitante_nome || '—'}
						</p>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
