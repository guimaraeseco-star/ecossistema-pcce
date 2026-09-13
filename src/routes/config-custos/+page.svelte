<script lang="ts">
	/**
	 * Tela de VALORES do plano operacional — Super Admin.
	 *
	 * Dois formulários independentes e uma tabela de histórico. Estão na mesma
	 * página porque respondem à mesma pergunta ("o que o plano operacional
	 * assume por padrão?"), mas gravam em lugares diferentes: os valores
	 * VERSIONAM (`custo_parametros`), o signatário não (`configuracoes`). O
	 * cabeçalho do `+page.server.ts` explica por quê.
	 *
	 * Os quatro campos "plus" nascem preenchidos com `normal × 1,3` e ficam
	 * EDITÁVEIS. Preencher sozinho e travar seria pior nos dois sentidos: a
	 * alíquota é regra da corporação, não do código, e um valor calculado que
	 * não se pode corrigir vira motivo para não usar a tela.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { formatarBRL, lerBRL } from '$lib/planos/rotulos';
	import { sugerirPlus } from '$lib/planos/custo';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	const { data, form }: PageProps = $props();

	/** Os quatro pares (normal → plus) que o acréscimo de 30% liga. */
	const PARES = [
		{ normal: 'oip_cd_normal', plus: 'oip_cd_plus', rotulo: 'OIP — classes D e C' },
		{ normal: 'oip_ab_normal', plus: 'oip_ab_plus', rotulo: 'OIP — classes B e A' },
		{ normal: 'dpc_12_normal', plus: 'dpc_12_plus', rotulo: 'DPC — 1ª e 2ª classe' },
		{ normal: 'dpc_3e_normal', plus: 'dpc_3e_plus', rotulo: 'DPC — 3ª classe e especial' }
	] as const;

	type ChaveValor =
		| (typeof PARES)[number]['normal']
		| (typeof PARES)[number]['plus']
		| 'diaria_estadual'
		| 'diaria_interestadual';

	/** Centavos da versão vigente → texto do campo. Vazio quando não há versão. */
	function inicial(chave: ChaveValor): string {
		const v = data.vigente?.[chave];
		return typeof v === 'number' ? formatarBRL(v).replace('R$ ', '') : '';
	}

	const campos = $state<Record<string, string>>(
		Object.fromEntries(
			(
				[
					...PARES.flatMap((p) => [p.normal, p.plus]),
					'diaria_estadual',
					'diaria_interestadual'
				] as ChaveValor[]
			).map((c) => [c, inicial(c)])
		)
	);

	/**
	 * O limite de km fica FORA de `campos`: aquele objeto é percorrido por
	 * `invalido()`, que valida moeda. Um "120" ali seria lido como R$ 1,20 e
	 * marcaria o campo de vermelho.
	 */
	// svelte-ignore state_referenced_locally
	let distanciaMinima = $state(String(data.vigente?.distancia_minima_diaria_km ?? 100));

	const kmInvalido = $derived.by(() => {
		const n = Number(distanciaMinima.trim().replace(',', '.'));
		return distanciaMinima.trim() === '' || !Number.isInteger(n) || n < 1 || n > 2000;
	});

	// Captura intencional do valor inicial: a data de vigência é sugerida como
	// "hoje" e passa a ser do usuário — recalcular a cada navegação apagaria uma
	// data que ele digitou.
	// svelte-ignore state_referenced_locally
	let vigenteDesde = $state(data.hoje);
	let salvandoValores = $state(false);

	/** O campo tem conteúdo que `lerBRL` não entende? */
	function invalido(v: string): boolean {
		return v.trim() !== '' && lerBRL(v) === null;
	}

	const algumInvalido = $derived(Object.values(campos).some(invalido));

	/** Aplica `normal × 1,3` no par correspondente — só quando o normal é legível. */
	function aplicarSugestao(normal: string, plus: string) {
		const centavos = lerBRL(campos[normal] ?? '');
		if (centavos === null) return;
		campos[plus] = formatarBRL(sugerirPlus(centavos)).replace('R$ ', '');
	}

	/** Preenche os quatro plus de uma vez. */
	function sugerirTodos() {
		for (const p of PARES) aplicarSugestao(p.normal, p.plus);
	}
</script>

<svelte:head><title>Valores de custo | Ecossistema PCCE</title></svelte:head>

<div class="space-y-6">
	<header>
		<h1 class="h1 text-2xl font-bold">Valores de custo</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400">
			Hora extra por faixa de classe e diárias. É o que o plano operacional usa para calcular o
			Anexo II. Alterações ficam registradas na auditoria.
		</p>
	</header>

	{#if !data.vigente}
		<p
			class="flex gap-2 rounded-xl border border-warning-500/30 bg-warning-500/10 p-3 text-sm text-warning-700 dark:text-warning-300"
		>
			<TriangleAlert class="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
			<span>
				Nenhum valor gravado ainda. Enquanto esta tela não for preenchida, o plano operacional não
				consegue calcular custo — o Anexo II sairia zerado.
			</span>
		</p>
	{/if}

	<!-- ---- Valores ---- -->
	<section class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
		<div>
			<h2 class="text-lg font-semibold text-surface-900 dark:text-white">Tabela de valores</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Salvar cria uma <strong>versão nova</strong>. Os planos já criados continuam com a versão
				que aplicaram — é o que faz um PDF reemitido depois de um reajuste sair com os mesmos
				totais.
			</p>
		</div>

		<form
			method="POST"
			action="?/salvarValores"
			use:enhance={() => {
				salvandoValores = true;
				return async ({ result, update }) => {
					salvandoValores = false;
					if (result.type === 'success') {
						toaster.success({ title: 'Nova versão de valores gravada' });
					} else if (result.type === 'failure') {
						toaster.error({
							title: 'Não foi possível salvar',
							description: String(result.data?.error ?? '')
						});
					}
					await update({ reset: false });
				};
			}}
			class="space-y-5"
		>
			<div class="space-y-3">
				<div class="flex items-center justify-between gap-3">
					<h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">
						Hora extra normal
					</h3>
					<span class="text-xs text-surface-600 dark:text-surface-400">valor por hora</span>
				</div>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each PARES as par (par.normal)}
						<label class="block space-y-1">
							<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
								>{par.rotulo}</span
							>
							<span class="flex items-center gap-2">
								<span class="text-sm text-surface-600 dark:text-surface-400">R$</span>
								<input
									name={par.normal}
									bind:value={campos[par.normal]}
									onblur={() => {
										if (!campos[par.plus]) aplicarSugestao(par.normal, par.plus);
									}}
									inputmode="decimal"
									placeholder="0,00"
									required
									class="input flex-1 {invalido(campos[par.normal])
										? 'border-2 border-error-500'
										: ''}"
								/>
							</span>
						</label>
					{/each}
				</div>
			</div>

			<div class="space-y-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">
						Hora extra plus
					</h3>
					<button
						type="button"
						class="btn btn-sm preset-outlined-surface-500 py-1.5 px-3 rounded-lg text-2xs"
						onclick={sugerirTodos}
					>
						Aplicar +30% nos quatro
					</button>
				</div>
				<p
					class="flex gap-2 rounded-lg border border-surface-200 dark:border-white/10 p-2.5 text-2xs text-surface-600 dark:text-surface-400"
				>
					<Info class="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
					<span>
						Madrugada (00:00–05:59) em dia útil, e qualquer horário em fim de semana ou feriado. A
						sugestão é o normal acrescido de 30%, mas o valor gravado é o que estiver no campo.
					</span>
				</p>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each PARES as par (par.plus)}
						<label class="block space-y-1">
							<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
								>{par.rotulo}</span
							>
							<span class="flex items-center gap-2">
								<span class="text-sm text-surface-600 dark:text-surface-400">R$</span>
								<input
									name={par.plus}
									bind:value={campos[par.plus]}
									inputmode="decimal"
									placeholder="0,00"
									required
									class="input flex-1 {invalido(campos[par.plus])
										? 'border-2 border-error-500'
										: ''}"
								/>
							</span>
						</label>
					{/each}
				</div>
			</div>

			<div class="space-y-3">
				<h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">Diárias</h3>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					Valor único para todos os servidores — a diária não varia por classe.
				</p>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each [['diaria_estadual', 'Estadual'], ['diaria_interestadual', 'Interestadual']] as [chave, rotulo] (chave)}
						<label class="block space-y-1">
							<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
								>{rotulo}</span
							>
							<span class="flex items-center gap-2">
								<span class="text-sm text-surface-600 dark:text-surface-400">R$</span>
								<input
									name={chave}
									bind:value={campos[chave]}
									inputmode="decimal"
									placeholder="0,00"
									required
									class="input flex-1 {invalido(campos[chave]) ? 'border-2 border-error-500' : ''}"
								/>
							</span>
						</label>
					{/each}
				</div>
			</div>

			<div class="space-y-3">
				<h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">
					Quando a diária se aplica
				</h3>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					Deslocamento igual ou acima desta distância é pago em diária; abaixo dela, o horário
					decide entre hora extra e sem custo. Vale só para operação de <strong
						>4 horas ou mais</strong
					> — abaixo disso o percurso não alcança a jornada de 8 horas que o decreto exige.
				</p>
				<label class="block max-w-xs space-y-1">
					<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
						>Distância mínima para diária</span
					>
					<span class="flex items-center gap-2">
						<input
							name="distancia_minima_diaria_km"
							bind:value={distanciaMinima}
							inputmode="numeric"
							placeholder="100"
							required
							class="input flex-1 {kmInvalido ? 'border-2 border-error-500' : ''}"
						/>
						<span class="text-sm text-surface-600 dark:text-surface-400">km</span>
					</span>
				</label>
				{#if kmInvalido}
					<p class="text-2xs text-error-600 dark:text-error-400">
						Use um número inteiro de 1 a 2000.
					</p>
				{/if}
			</div>

			<div class="flex flex-wrap items-end gap-3 pt-1">
				<label class="block space-y-1">
					<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
						>Vigente desde</span
					>
					<input type="date" name="vigente_desde" bind:value={vigenteDesde} class="input" />
				</label>
				<button
					type="submit"
					class="btn preset-filled-primary-500 py-2.5 px-4 rounded-xl text-sm"
					disabled={salvandoValores || algumInvalido || kmInvalido}
				>
					{salvandoValores ? 'Salvando…' : 'Gravar nova versão'}
				</button>
			</div>

			{#if algumInvalido}
				<p class="text-2xs text-error-600 dark:text-error-400">
					Há valor em formato não reconhecido. Use <code>27,30</code>.
				</p>
			{/if}
			{#if form?.error}
				<p class="text-2xs text-error-600 dark:text-error-400">{form.error}</p>
			{/if}
		</form>
	</section>

	<!-- ---- Signatário ---- -->

	<!-- ---- Histórico ---- -->
	{#if data.historico.length > 0}
		<section class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6 space-y-3 overflow-hidden">
			<div>
				<h2 class="text-lg font-semibold text-surface-900 dark:text-white">Versões gravadas</h2>
				<p class="text-sm text-surface-600 dark:text-surface-400">
					Cada plano guarda a versão que aplicou. É por aqui que se explica um total antigo.
				</p>
			</div>

			<div class="hidden md:block table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Versão</th>
							<th>Vigente desde</th>
							<th>OIP D/C</th>
							<th>DPC 1ª/2ª</th>
							<th>Diária est.</th>
							<th>Diária a partir de</th>
							<th>Gravada por</th>
						</tr>
					</thead>
					<tbody>
						{#each data.historico as v, i (v.id)}
							<tr>
								<td class="font-mono text-xs">
									#{v.id}
									{#if i === 0}
										<span
											class="ml-1 rounded-full bg-success-500/15 px-2 py-0.5 text-2xs font-medium text-success-700 dark:text-success-400"
											>vigente</span
										>
									{/if}
								</td>
								<td>{v.vigente_desde}</td>
								<td>{formatarBRL(v.oip_cd_normal)}</td>
								<td>{formatarBRL(v.dpc_12_normal)}</td>
								<td>{formatarBRL(v.diaria_estadual)}</td>
								<td>{v.distancia_minima_diaria_km} km</td>
								<td class="text-xs text-surface-600 dark:text-surface-400"
									>{v.criado_por_nome || '—'}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<ul class="md:hidden space-y-2">
				{#each data.historico as v, i (v.id)}
					<li class="rounded-xl border border-surface-200 dark:border-white/10 p-3 space-y-1">
						<div class="flex items-center justify-between gap-2">
							<span class="font-mono text-xs">#{v.id}</span>
							{#if i === 0}
								<span
									class="rounded-full bg-success-500/15 px-2 py-0.5 text-2xs font-medium text-success-700 dark:text-success-400"
									>vigente</span
								>
							{/if}
						</div>
						<p class="text-xs text-surface-600 dark:text-surface-400">
							Vigente desde {v.vigente_desde} · {v.criado_por_nome || '—'}
						</p>
						<p class="text-xs">
							OIP D/C {formatarBRL(v.oip_cd_normal)} · DPC 1ª/2ª {formatarBRL(v.dpc_12_normal)} · Diária
							{formatarBRL(v.diaria_estadual)} a partir de {v.distancia_minima_diaria_km} km
						</p>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
