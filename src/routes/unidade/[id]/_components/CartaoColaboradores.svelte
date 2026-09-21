<script lang="ts">
	/**
	 * Os colaboradores lotados na unidade e o que ela liberou a cada um (E61):
	 * uma caixa por chave do catálogo. Quem vê este cartão é quem administra a
	 * unidade (o load só o manda para eles); "Salvar" substitui o conjunto
	 * inteiro pelo marcado. O catálogo é o mesmo que o portão de rotas lê —
	 * marcar aqui é o único jeito de o colaborador alcançar algo.
	 */
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { ActionResult } from '@sveltejs/kit';
	import { toaster } from '$lib/toast';
	import { ACESSOS_DO_COLABORADOR } from '$lib/colaboradores/acessos';

	interface ColaboradorDaUnidade {
		id: number;
		nome: string;
		vinculo: string;
		ativo: boolean;
		acessos: string[];
	}

	const { colaboradores }: { colaboradores: ColaboradorDaUnidade[] } = $props();

	let aberto = $state<number | null>(null);
	let enviando = $state(false);

	function aoResponder() {
		enviando = true;
		return async ({ result }: { result: ActionResult }) => {
			enviando = false;
			if (result.type === 'success') {
				toaster.create({ title: 'Acessos salvos', type: 'success' });
				aberto = null;
				await invalidateAll();
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error ?? 'Não foi possível salvar'), type: 'error' });
			}
		};
	}
</script>

<section class="card-elevated rounded-2xl p-5" aria-labelledby="colaboradores">
	<div class="mb-3 flex items-baseline justify-between gap-3">
		<h2 id="colaboradores" class="text-base font-semibold text-surface-900 dark:text-surface-50">
			Colaboradores
		</h2>
		<span class="text-xs text-surface-500">{colaboradores.length}</span>
	</div>
	<p class="mb-3 text-xs text-surface-600 dark:text-surface-400">
		Terceirizados lotados aqui. A unidade define o que cada um pode fazer; eles só propõem — quem
		decide continua sendo o DPI SUL. No fim do dia, o admin da unidade recebe por e-mail o que cada
		um fez.
	</p>

	{#if colaboradores.length === 0}
		<p class="text-sm text-surface-500">
			Nenhum colaborador lotado nesta unidade. O Administrador Geral faz o vínculo em Colaboradores.
		</p>
	{/if}

	<ul class="divide-y divide-surface-200 dark:divide-white/10">
		{#each colaboradores as c (c.id)}
			<li class="py-2">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<div>
						<span class="text-sm font-semibold {c.ativo ? '' : 'line-through opacity-60'}"
							>{c.nome}</span
						>
						{#if c.vinculo}<span class="ml-1 text-xs italic text-surface-500">{c.vinculo}</span
							>{/if}
						{#if !c.ativo}<span class="badge preset-filled-warning-500 ml-1 text-2xs"
								>Desativado</span
							>{/if}
					</div>
					<button
						type="button"
						class="text-xs font-semibold text-primary-700 dark:text-primary-400"
						onclick={() => (aberto = aberto === c.id ? null : c.id)}
					>
						{aberto === c.id ? 'Cancelar' : 'Definir acessos'}
					</button>
				</div>
				{#if aberto !== c.id}
					<p class="mt-1 text-xs text-surface-600 dark:text-surface-400">
						{#if c.acessos.length === 0}
							Nada liberado — só a tela de boas-vindas.
						{:else}
							{ACESSOS_DO_COLABORADOR.filter((a) => c.acessos.includes(a.chave))
								.map((a) => a.rotulo)
								.join(' · ')}
						{/if}
					</p>
				{:else}
					<form
						method="POST"
						action="?/definirAcessosColaborador"
						use:enhance={aoResponder}
						class="mt-2 space-y-2 rounded-xl border border-primary-500/30 bg-primary-500/5 p-3"
					>
						<input type="hidden" name="colaborador_id" value={c.id} />
						{#each ACESSOS_DO_COLABORADOR as a (a.chave)}
							<label class="flex items-start gap-2 text-sm">
								<input
									type="checkbox"
									class="checkbox mt-0.5"
									name="acesso"
									value={a.chave}
									checked={c.acessos.includes(a.chave)}
								/>
								<span>
									<span class="font-medium">{a.rotulo}</span>
									<span class="block text-xs text-surface-600 dark:text-surface-400"
										>{a.descricao}</span
									>
								</span>
							</label>
						{/each}
						<div class="flex justify-end gap-2 pt-1">
							<button type="submit" class="btn btn-sm preset-filled-primary-500" disabled={enviando}
								>{enviando ? 'Salvando...' : 'Salvar acessos'}</button
							>
						</div>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
</section>
