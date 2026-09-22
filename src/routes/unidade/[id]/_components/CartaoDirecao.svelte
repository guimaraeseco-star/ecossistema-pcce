<script lang="ts">
	/**
	 * A DIREÇÃO da unidade, na ficha dela — quem dirige hoje, desde quando, e a
	 * sucessão de quem dirigiu antes.
	 *
	 * Duas figuras, e a tela precisa distingui-las porque significam coisas
	 * diferentes para quem lê: **titular** é o delegado designado para esta
	 * unidade; **respondente** é o delegado de OUTRA unidade que responde por
	 * ela enquanto está sem titular — por isso a lotação dele aparece ao lado do
	 * nome, e só nesse caso.
	 *
	 * "Sem titular" é estado LEGÍTIMO, não falta de dado: das unidades do DPI
	 * Sul, várias estão assim de propósito (unidades de atendimento, em regra,
	 * não têm titular). Por isso o vazio é informativo e não alarmante.
	 *
	 * Quem registra é SÓ o Admin Geral (E67): a direção é indicação do DPI SUL,
	 * e a proposta pela seccional deixou de existir. Para os demais o cartão é
	 * de leitura — some o botão, não a informação. Esconder o formulário não é
	 * autorização: quem recusa o POST é a action.
	 */
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { buscarPoliciaisOptions } from '$lib/busca-policiais';
	import { toaster } from '$lib/toast';
	import { invalidateAll } from '$app/navigation';
	import { formatarData } from '$lib/utils/datas';
	import { formatarNUP } from '$lib/utils/formato';
	import { MAX_JUSTIFICATIVA } from '$lib/cadastro-campos';

	interface Ausencia {
		unidade_id: number;
		titular_id: number;
		titular_nome: string;
		evento_id: number;
		subtipo: string;
		data_inicio: string;
		data_fim: string | null;
	}

	interface Sugestao {
		policial_id: number;
		nome: string;
		matricula: string;
		designacao: string;
	}

	interface Responsavel {
		id: number;
		policial_id: number;
		policial_nome: string;
		policial_matricula: string;
		policial_lotacao: string;
		designacao: string | null;
		papel: 'titular' | 'respondente';
		carater: 'permanente' | 'temporaria';
		data_inicio: string;
		data_fim: string | null;
		nup: string;
		observacao: string;
		registrado_por_nome: string;
	}

	const {
		unidadeNome,
		direcao,
		sucessao,
		modo,
		respondencia
	}: {
		unidadeNome: string;
		direcao: Responsavel | null;
		sucessao: Responsavel[];
		modo: 'direto' | 'leitura';
		/** A respondência temporária (E68): a ausência em aberto e a indicação. */
		respondencia: {
			modo: 'direto' | 'indicacao' | 'leitura';
			ausencia: Ausencia | null;
			sugestao: Sugestao | null;
		};
	} = $props();

	const podeEscrever = $derived(modo === 'direto');

	let formAberto = $state(false);
	let formRespondencia = $state(false);
	let respondenteId = $state<number | null>(null);
	let respInicio = $state('');
	let respFim = $state('');
	let respNup = $state('');
	let respJustificativa = $state('');
	let enviandoResp = $state(false);
	let papel = $state<'titular' | 'respondente'>('titular');
	let policialId = $state<number | null>(null);
	let dataInicio = $state('');
	let nup = $state('');
	let observacao = $state('');
	let enviando = $state(false);

	/** Só delegado dirige unidade (decisão de 14/09/2026) — a busca já filtra. */
	const buscarDelegados = buscarPoliciaisOptions({ cargo: 'DPC', valorNumerico: true });

	/** A unidade indica quando tem adjunto/auxiliar; sem ele, quem indica é a seccional. */
	const podeResponder = $derived(respondencia.modo !== 'leitura' && !!respondencia.ausencia);
	const registrandoResp = $derived(respondencia.modo === 'direto');
	const rotuloAusencia = $derived(
		respondencia.ausencia?.subtipo === 'ferias' ? 'entra de férias' : 'se afasta'
	);

	/**
	 * Abrir o formulário já preenchido com o que o sistema sabe: o período é o
	 * do afastamento e o nome é o do adjunto (ou auxiliar). Quem confirma é a
	 * pessoa — a sugestão poupa digitação, não decide.
	 */
	function abrirRespondencia() {
		formRespondencia = !formRespondencia;
		if (!formRespondencia || !respondencia.ausencia) return;
		respInicio = respondencia.ausencia.data_inicio;
		respFim = respondencia.ausencia.data_fim ?? '';
		respondenteId = respondencia.sugestao?.policial_id ?? null;
	}

	function handleRespondencia() {
		enviandoResp = true;
		return async ({ result }: { result: ActionResult }) => {
			enviandoResp = false;
			if (result.type === 'success') {
				const indicacao = (result.data as Record<string, unknown> | undefined)?.indicacao;
				toaster.create({
					title: indicacao ? 'Indicação enviada' : 'Respondência registrada',
					description: indicacao ? 'Aguarda a homologação do DPI SUL.' : undefined,
					type: 'success'
				});
				formRespondencia = false;
				await invalidateAll();
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error ?? 'Não foi possível registrar'), type: 'error' });
			}
		};
	}

	/** A sucessão exclui quem está vigente: ele já aparece no topo do cartão. */
	const anteriores = $derived(sucessao.filter((s) => s.data_fim !== null));

	const rotuloPapel = (p: 'titular' | 'respondente') =>
		p === 'titular' ? 'Titular' : 'Respondente';

	function limpar() {
		policialId = null;
		dataInicio = '';
		nup = '';
		observacao = '';
		papel = 'titular';
	}

	function handleEnvio() {
		enviando = true;
		return async ({ result }: { result: ActionResult }) => {
			enviando = false;
			if (result.type === 'success') {
				toaster.create({ title: 'Direção registrada', type: 'success' });
				formAberto = false;
				limpar();
				await invalidateAll();
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error ?? 'Não foi possível registrar'), type: 'error' });
			}
		};
	}
</script>

<section class="card-elevated rounded-2xl p-5" aria-labelledby="direcao">
	<div class="mb-3 flex items-baseline justify-between gap-3">
		<h2 id="direcao" class="text-base font-semibold text-surface-900 dark:text-surface-50">
			Direção
		</h2>
		{#if podeEscrever}
			<button
				type="button"
				class="text-xs font-semibold text-primary-700 dark:text-primary-400"
				onclick={() => (formAberto = !formAberto)}
			>
				{formAberto ? 'Cancelar' : 'Registrar direção'}
			</button>
		{/if}
	</div>

	{#if direcao}
		<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
			<span
				class="badge text-2xs {direcao.papel === 'titular'
					? 'preset-filled-primary-500'
					: 'preset-filled-warning-500'}">{rotuloPapel(direcao.papel)}</span
			>
			<a
				href="/servidores/{direcao.policial_id}"
				class="text-sm font-semibold text-surface-900 no-underline dark:text-surface-50"
				>{direcao.policial_nome}</a
			>
			<span class="font-mono text-xs tabular-nums text-surface-500"
				>{direcao.policial_matricula}</span
			>
		</div>
		<!-- Cobertura temporária (E68): a tela tem de dizer que é substituição, e
		     até quando, senão parece troca de titular. -->
		{#if direcao.carater === 'temporaria'}
			<p class="mt-0.5 text-xs font-semibold text-warning-700 dark:text-warning-400">
				Respondendo temporariamente{direcao.data_fim
					? ` até ${formatarData(direcao.data_fim)}`
					: ''} — o titular continua sendo o mesmo e volta ao fim do período.
			</p>
		{/if}
		<!-- A lotação só interessa no respondente: no titular ela é esta unidade. -->
		{#if direcao.papel === 'respondente' && direcao.policial_lotacao}
			<p class="mt-0.5 text-xs text-surface-600 dark:text-surface-400">
				Lotado em {direcao.policial_lotacao}
			</p>
		{/if}
		<dl class="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
			<dt class="text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase sm:pt-0.5">
				Desde
			</dt>
			<dd class="text-surface-700 dark:text-surface-300">{formatarData(direcao.data_inicio)}</dd>
			{#if direcao.designacao}
				<dt class="text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase sm:pt-0.5">
					Designação
				</dt>
				<dd class="text-surface-700 dark:text-surface-300">{direcao.designacao}</dd>
			{/if}
			{#if direcao.nup}
				<dt class="text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase sm:pt-0.5">
					NUP
				</dt>
				<dd class="font-mono text-surface-700 tabular-nums dark:text-surface-300">
					{formatarNUP(direcao.nup)}
				</dd>
			{/if}
		</dl>
	{:else}
		<p class="text-sm text-surface-600 dark:text-surface-400">
			Sem titular cadastrado.
			<span class="block text-xs">
				Unidade de atendimento, em regra, não tem titular; delegacia sem titular costuma ter um
				delegado respondendo por ela.
			</span>
		</p>
	{/if}

	<!-- Titular ausente sem quem responda (E68): a mesma pendência que a caixa
	     de avisos cobra, no lugar onde ela se resolve. -->
	{#if respondencia.ausencia}
		<div
			class="mt-4 rounded-xl border border-warning-300 bg-warning-50 p-3 dark:border-warning-500/40 dark:bg-warning-500/10"
		>
			<p class="text-sm font-semibold text-warning-900 dark:text-warning-200">
				{respondencia.ausencia.titular_nome}
				{rotuloAusencia} em {formatarData(respondencia.ausencia.data_inicio)}{respondencia.ausencia
					.data_fim
					? ` e volta em ${formatarData(respondencia.ausencia.data_fim)}`
					: ''} — ninguém responde pela unidade nesse período.
			</p>
			<p class="mt-1 text-xs text-warning-800 dark:text-warning-300">
				{#if respondencia.sugestao}
					A unidade tem {respondencia.sugestao.designacao}: em regra é quem responde, mas precisa de
					confirmação.
				{:else}
					A unidade não tem Delegado Adjunto nem Auxiliar: a indicação é da seccional.
				{/if}
				{#if respondencia.modo === 'indicacao'}
					O DPI SUL homologa.
				{/if}
			</p>
			{#if podeResponder}
				<button
					type="button"
					class="mt-2 text-xs font-semibold text-primary-700 dark:text-primary-400"
					onclick={abrirRespondencia}
				>
					{formRespondencia
						? 'Cancelar'
						: registrandoResp
							? 'Registrar respondência'
							: 'Indicar quem responde'}
				</button>
			{/if}
			{#if formRespondencia && respondencia.ausencia}
				<form
					method="POST"
					action="?/{registrandoResp ? 'registrarRespondencia' : 'indicarRespondencia'}"
					use:enhance={handleRespondencia}
					class="mt-3 space-y-3 border-t border-warning-300 pt-3 dark:border-warning-500/40"
				>
					<input type="hidden" name="evento_id" value={respondencia.ausencia.evento_id} />
					<input
						type="hidden"
						name="inicio_afastamento"
						value={respondencia.ausencia.data_inicio}
					/>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<label class="label">
							<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70"
								>Quem responde (DPC)</span
							>
							<SearchableSelect
								name="policial_id"
								bind:value={respondenteId}
								loadOptions={buscarDelegados}
								placeholder={respondencia.sugestao?.nome ?? 'Digite para buscar...'}
								class="h-9 w-full"
							/>
						</label>
						<label class="label">
							<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">
								NUP <span class="font-normal normal-case opacity-70">— do processo</span>
							</span>
							<input
								class="input px-3 py-1 text-sm"
								type="text"
								name="nup"
								bind:value={respNup}
								maxlength="40"
								placeholder="00000.000000/0000-00"
								required
							/>
						</label>
						<label class="label">
							<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70"
								>Primeiro dia</span
							>
							<input
								class="input px-3 py-1 text-sm"
								type="date"
								name="data_inicio"
								bind:value={respInicio}
								required
							/>
						</label>
						<label class="label">
							<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">
								Último dia <span class="font-normal normal-case opacity-70"
									>— em branco: sem fim previsto</span
								>
							</span>
							<input
								class="input px-3 py-1 text-sm"
								type="date"
								name="data_fim"
								bind:value={respFim}
							/>
						</label>
					</div>
					<label class="label">
						<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">
							{registrandoResp ? 'Observação' : 'Justificativa'}
						</span>
						<textarea
							class="textarea px-3 py-1 text-sm"
							name="observacao"
							bind:value={respJustificativa}
							rows="2"
							maxlength={MAX_JUSTIFICATIVA}
							required={!registrandoResp}
							placeholder={registrandoResp
								? 'Opcional'
								: 'Ex.: o adjunto responde durante as férias do titular'}></textarea>
					</label>
					<div class="flex justify-end">
						<button
							type="submit"
							class="btn btn-sm preset-filled-primary-500 disabled:opacity-40"
							disabled={enviandoResp || !respondenteId || !respNup.trim() || !respInicio}
						>
							{enviandoResp ? 'Enviando...' : registrandoResp ? 'Registrar' : 'Enviar indicação'}
						</button>
					</div>
				</form>
			{/if}
		</div>
	{/if}

	{#if formAberto}
		<form
			method="POST"
			action="?/registrarDirecao"
			use:enhance={handleEnvio}
			class="mt-4 space-y-3 border-t border-surface-200 pt-4 dark:border-white/10"
		>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Papel</span>
					<select class="select px-3 py-1 text-sm" name="papel" bind:value={papel}>
						<option value="titular">Titular — designado para {unidadeNome}</option>
						<option value="respondente">Respondente — dirige sem ser lotado aqui</option>
					</select>
				</label>
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Delegado (DPC)</span
					>
					<SearchableSelect
						name="policial_id"
						bind:value={policialId}
						loadOptions={buscarDelegados}
						placeholder="Digite para buscar..."
						class="h-9 w-full"
					/>
				</label>
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Início</span>
					<input
						class="input px-3 py-1 text-sm"
						type="date"
						name="data_inicio"
						bind:value={dataInicio}
						required
					/>
				</label>
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">
						NUP <span class="font-normal normal-case opacity-70">— do processo que pede</span>
					</span>
					<input
						class="input px-3 py-1 text-sm"
						type="text"
						name="nup"
						bind:value={nup}
						maxlength="40"
						placeholder="00000.000000/0000-00"
						required
					/>
				</label>
			</div>
			<label class="label">
				<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Observação</span>
				<textarea
					class="textarea px-3 py-1 text-sm"
					name="observacao"
					bind:value={observacao}
					rows="2"
					maxlength={MAX_JUSTIFICATIVA}
					placeholder="Opcional"></textarea>
			</label>
			<div class="flex justify-end gap-2">
				<button
					type="submit"
					class="btn btn-sm preset-filled-primary-500 disabled:opacity-40"
					disabled={enviando || !policialId || !nup.trim()}
				>
					{enviando ? 'Enviando...' : 'Registrar'}
				</button>
			</div>
		</form>
	{/if}

	{#if anteriores.length > 0}
		<details class="mt-4 border-t border-surface-200 pt-3 dark:border-white/10">
			<summary class="cursor-pointer text-xs font-semibold text-surface-600 dark:text-surface-400">
				Quem dirigiu antes ({anteriores.length})
			</summary>
			<ul class="mt-2 space-y-2">
				{#each anteriores as a (a.id)}
					<li class="text-xs text-surface-600 dark:text-surface-400">
						<a href="/servidores/{a.policial_id}" class="font-medium">{a.policial_nome}</a>
						<span class="text-surface-500">
							· {rotuloPapel(a.papel)} · {formatarData(a.data_inicio)} a {formatarData(
								a.data_fim ?? ''
							)}
						</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>
