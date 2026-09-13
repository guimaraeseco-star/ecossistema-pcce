<script lang="ts">
	/**
	 * Onde a unidade informa a linha de base de cada indicador de UMA operação.
	 *
	 * Um card por unidade administrada, com um campo por indicador. A leitura que
	 * a tela precisa entregar de imediato é "o que ainda falta": indicador sem
	 * base fica marcado como pendente, porque enquanto ele estiver assim o
	 * gráfico daquela unidade não tem meta a mostrar.
	 *
	 * Campo em branco significa "ainda não sei", nunca zero — e o servidor
	 * também o ignora. Zerar um acervo por engano faria a meta de redução
	 * parecer cumprida.
	 *
	 * **Não há seletor de operação aqui**, e é deliberado: ela vem do caminho da
	 * rota. Um `<select>` ao lado dos campos é o convite a digitar o acervo de uma
	 * delegacia sob a operação errada — e este valor é o denominador de um
	 * percentual divulgado. A escolha, quando existe, acontece no índice
	 * (`/dados-base`), antes de qualquer campo.
	 *
	 * O destino do "Voltar" vem do `load` (`data.voltar`), e pode ser `null`. Não
	 * é fixo porque o índice redireciona para cá quando há uma pendência só — o
	 * `href="/dados-base"` que esta tela tinha devolvia a pessoa a ela mesma.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import { invalidate } from '$app/navigation';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import Check from '@lucide/svelte/icons/check';
	import Clock from '@lucide/svelte/icons/clock';
	import TrendingDown from '@lucide/svelte/icons/trending-down';
	import TrendingUp from '@lucide/svelte/icons/trending-up';

	const { data }: PageProps = $props();

	const CLASSE_CAMPO =
		'w-full min-w-0 px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm';

	/** Quantos indicadores desta unidade ainda estão sem base. */
	function pendentes(unidadeId: number): number {
		const doUnidade = data.valores[unidadeId] ?? {};
		return data.indicadores.filter((i) => doUnidade[i.key] === undefined).length;
	}

	function valorDe(unidadeId: number, key: string): string {
		const v = data.valores[unidadeId]?.[key];
		return v === undefined ? '' : String(v.valor);
	}

	function obsDe(unidadeId: number, key: string): string {
		return data.valores[unidadeId]?.[key]?.observacao ?? '';
	}

	function informadoPor(unidadeId: number, key: string): string {
		const v = data.valores[unidadeId]?.[key];
		if (!v) return '';
		return v.informadoPor ? `${v.informadoPor} · ${v.em}` : v.em;
	}
</script>

<svelte:head>
	<title>Dados base · {data.operacao.nome} | Ecossistema PCCE</title>
</svelte:head>

<div class="min-w-0 space-y-6">
	{#if data.voltar}
		<BotaoVoltar href={data.voltar.href} rotulo={data.voltar.rotulo} />
	{/if}

	<div class="min-w-0">
		<h1 class="h1 text-2xl font-bold">Dados base</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
			<strong>{data.operacao.nome}</strong> — valores iniciais de cada indicador, o parâmetro de comparação
			das metas desta operação.
		</p>
	</div>

	{#if data.indicadores.length === 0}
		<section class="card-elevated rounded-2xl p-5 sm:p-6">
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Esta operação ainda não tem indicadores com meta percentual. Indicadores são definidos no
				formulário de produtividade da operação, marcando uma pergunta como
				<strong>indicador de meta</strong>.
			</p>
		</section>
	{:else if data.unidades.length === 0}
		<section class="card-elevated rounded-2xl p-5 sm:p-6">
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Nenhuma unidade sob sua administração participa desta operação. Assim que uma escala extra
				incluir a sua unidade, os campos aparecem aqui.
			</p>
		</section>
	{:else}
		{#each data.unidades as unidade (unidade.id)}
			{@const faltam = pendentes(unidade.id)}
			<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-4">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<h2 class="text-base font-semibold">{unidade.nome}</h2>
					<span
						class="inline-flex items-center gap-1.5 text-2xs font-semibold text-surface-600 dark:text-surface-400"
					>
						{#if faltam === 0}
							<span
								class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success-500 text-white"
							>
								<Check class="h-3 w-3" />
							</span>
							Todos informados
						{:else}
							<span
								class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-warning-500 text-white"
							>
								<Clock class="h-3 w-3" />
							</span>
							{faltam === 1 ? '1 indicador pendente' : `${faltam} indicadores pendentes`}
						{/if}
					</span>
				</div>

				<form
					method="POST"
					action="?/salvar"
					class="space-y-4"
					use:enhance={() => {
						loading.show('A gravar…');
						return async ({ result }) => {
							loading.hide();
							if (result.type === 'success') {
								toaster.success({ title: `Dados base de ${unidade.nome} salvos` });
								await invalidate('app:dados-base');
							} else if (result.type === 'failure') {
								const err = (result.data as { error?: string } | undefined)?.error;
								toaster.error({ title: err || 'Não foi possível gravar' });
							}
						};
					}}
				>
					<input type="hidden" name="operacaoId" value={data.operacao.id} />
					<input type="hidden" name="unidadeId" value={unidade.id} />

					<div class="grid gap-4 lg:grid-cols-2">
						{#each data.indicadores as ind (ind.key)}
							{@const preenchido = data.valores[unidade.id]?.[ind.key] !== undefined}
							<div
								class="rounded-xl border border-surface-200/70 bg-surface-50 dark:border-white/10 dark:bg-surface-800/40 p-4 space-y-2"
							>
								<div class="flex items-start justify-between gap-2">
									<label
										for={`v_${unidade.id}_${ind.key}`}
										class="block text-sm font-medium min-w-0"
									>
										{ind.rotulo}
									</label>
									<span
										class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-3xs font-semibold"
										class:bg-error-500={false}
										class:bg-primary-500={true}
										style="background-color: color-mix(in oklch, var(--color-primary-500) 12%, transparent)"
									>
										{#if ind.objetivo === 'diminuir'}
											<TrendingDown class="h-3 w-3" />
											−{ind.metaValor}%
										{:else}
											<TrendingUp class="h-3 w-3" />
											+{ind.metaValor}%
										{/if}
									</span>
								</div>

								<div class="flex items-center gap-2">
									<input
										id={`v_${unidade.id}_${ind.key}`}
										name={`valor__${ind.key}`}
										type="number"
										min="0"
										step="any"
										inputmode="decimal"
										placeholder="Ainda não informado"
										value={valorDe(unidade.id, ind.key)}
										class={CLASSE_CAMPO}
									/>
									{#if ind.unidadeMedida}
										<span
											class="shrink-0 text-2xs text-surface-600 dark:text-surface-400 whitespace-nowrap"
										>
											{ind.unidadeMedida}
										</span>
									{/if}
								</div>

								<input
									name={`obs__${ind.key}`}
									type="text"
									maxlength="500"
									placeholder="Observação (opcional)"
									value={obsDe(unidade.id, ind.key)}
									class={`${CLASSE_CAMPO} text-2xs`}
								/>

								{#if preenchido}
									<p class="text-3xs text-surface-600 dark:text-surface-400">
										Informado por {informadoPor(unidade.id, ind.key)}
									</p>
								{:else}
									<p class="text-3xs text-warning-700 dark:text-warning-400">
										Sem este valor, a meta desta unidade não pode ser calculada.
									</p>
								{/if}
							</div>
						{/each}
					</div>

					<div class="flex justify-end">
						<button
							type="submit"
							class="btn preset-filled-primary-500 w-full sm:w-auto px-6 py-2.5 rounded-xl font-semibold"
							disabled={loading.active}
						>
							Salvar {unidade.nome}
						</button>
					</div>
				</form>
			</section>
		{/each}
	{/if}
</div>
