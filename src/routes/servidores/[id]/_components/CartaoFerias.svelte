<script lang="ts">
	/**
	 * O cartão FÉRIAS da ficha do servidor — a programação homologada no
	 * Guardião, o assistente de reprogramação à COGEP e o abono.
	 *
	 * As férias são UM período, ainda que fracionado (decisão do responsável,
	 * 17/09/2026). É isso que dá a forma ao cartão:
	 *
	 *   - LANÇAR pergunta primeiro "quantos períodos?" e oferece as cinco formas
	 *     do decreto; depois só o 1º dia de cada fração — o último dia sai da
	 *     regra (`fimDaFracao`), e o 1º dia tem de ser útil (nem fim de semana,
	 *     nem feriado — o caso do 01/11/2026, domingo, que passou);
	 *   - SUSTAR alcança todas as frações ainda não iniciadas do exercício, de
	 *     uma vez, e pode redividi-las (30 sustados voltam como 10 + 20);
	 *   - SUSPENDER é a exceção: mira a fração em gozo, e o que resta dela volta
	 *     num período só.
	 *
	 * O que este cartão precisa fazer bem, e a razão de existir: dizer ao chefe
	 * imediato se o pedido é SUSTAÇÃO ou SUSPENSÃO antes de ele escrever o NUP.
	 * A resposta sai dos fatos (`situacaoDaReprogramacao`), em linguagem clara
	 * com o motivo, e o ofício sai pronto com o instituto certo. A action refaz
	 * tudo no envio; aqui é a prévia, para o usuário ver o que vai mandar.
	 *
	 * Quem vê o quê: qualquer perfil que abre a ficha lança, susta, suspende,
	 * anota o NUP e homologa a resposta; só o Admin Geral registra abono; a
	 * unidade dá ciência dele. Esconder o botão não é autorização — as actions
	 * recusam por conta própria.
	 */
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import { toaster } from '$lib/toast';
	import { formatarData, hojeLocalISO } from '$lib/utils/datas';
	import { formatarNUP } from '$lib/utils/formato';
	import { MAX_JUSTIFICATIVA } from '$lib/cadastro-campos';
	import type { FeriasDoPolicial, FracaoCompleta } from '$lib/db';
	import {
		criteriosDaSuspensao,
		diasAGozar,
		diasDaFracao,
		diasRestantesNaSuspensao,
		divisoesPossiveis,
		fimDaFracao,
		montarPeriodos,
		periodoAquisitivo,
		periodosDoPedido,
		ROTULO_STATUS_FRACAO,
		ROTULO_TIPO_REPROGRAMACAO,
		rotuloDaDivisao,
		situacaoDaReprogramacao,
		statusPelaData,
		temErro,
		type Checagem,
		type Fracao
	} from '$lib/servidores/ferias';

	let {
		ferias = $bindable(),
		feriados,
		dataPosse,
		isAdmin,
		podeDarCiencia
	}: {
		ferias: FeriasDoPolicial;
		feriados: string[];
		dataPosse: string | null;
		/** Admin Geral: registra abono. */
		isAdmin: boolean;
		/** Admin de unidade/seccional (e o Admin Geral): dá ciência do abono. */
		podeDarCiencia: boolean;
	} = $props();

	const hoje = hojeLocalISO();

	/** A fração do banco na forma que as regras leem. */
	const comoFracao = (f: FracaoCompleta): Fracao => ({
		ordem: f.ordem as 1 | 2 | 3,
		data_inicio: f.data_inicio,
		data_fim: f.data_fim,
		status: f.status,
		// Os dias vendidos (abono deferido) não se sustam: a regra desconta.
		diasAbonados:
			f.abono?.status === 'deferido'
				? diasDaFracao({ data_inicio: f.abono.abono_inicio, data_fim: f.abono.abono_fim })
				: 0
	});

	/** Por exercício, mais recente primeiro; dentro, pela ordem e pelo id. */
	const porExercicio = $derived.by(() => {
		// Map local ao derived, montado e devolvido — não é estado vivo.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const mapa = new Map<number, FracaoCompleta[]>();
		for (const f of ferias.fracoes) mapa.set(f.exercicio, [...(mapa.get(f.exercicio) ?? []), f]);
		return [...mapa.entries()].sort((a, b) => b[0] - a[0]);
	});

	const pedidosDe = (exercicio: number) => ferias.pedidos.filter((r) => r.exercicio === exercicio);
	const pendenteDe = (exercicio: number) =>
		pedidosDe(exercicio).find((r) => r.status === 'pendente') ?? null;
	const situacaoDe = (fracoes: FracaoCompleta[]) =>
		situacaoDaReprogramacao(fracoes.map(comoFracao), hoje);
	/** Programação intacta: tudo `programada`, sem pedido nem abono — dá para excluir. */
	const intacta = (exercicio: number, fracoes: FracaoCompleta[]) =>
		fracoes.every((f) => f.status === 'programada' && !f.abono) &&
		pedidosDe(exercicio).length === 0;

	const COR_STATUS: Record<string, string> = {
		programada: 'text-primary-700 dark:text-primary-400',
		em_gozo: 'text-warning-600 dark:text-warning-400',
		gozada: 'text-surface-500',
		sustada: 'text-surface-400 line-through',
		suspensa: 'text-surface-400 line-through'
	};

	/* ── formulários abertos ─────────────────────────────────────────────── */
	let lancando = $state(false);
	let sustando = $state<{ exercicio: number; fracoes: FracaoCompleta[] } | null>(null);
	let suspendendo = $state<FracaoCompleta | null>(null);
	let abonando = $state<FracaoCompleta | null>(null);
	let enviando = $state(false);
	/** O ofício devolvido pela action, para copiar no NUP. */
	let oficioGerado = $state('');

	/* ── a divisão e os primeiros dias — o mesmo motor para lançar e sustar ── */
	let qtdPeriodos = $state<1 | 2 | 3>(1);
	let divisaoEscolhida = $state<readonly number[]>([30]);
	let inicios = $state<string[]>(['', '', '']);

	/** As divisões admitidas no formulário aberto: as cinco ao lançar; ao sustar, as que somam o restante. */
	const divisoesAdmitidas = $derived.by((): readonly (readonly number[])[] => {
		if (sustando) {
			return situacaoDe(sustando.fracoes).sustacao?.divisoes ?? [];
		}
		return divisoesPossiveis(30);
	});
	const quantidadesPossiveis = $derived(
		[...new Set(divisoesAdmitidas.map((d) => d.length))].sort() as (1 | 2 | 3)[]
	);
	const divisoesDaQuantidade = $derived(divisoesAdmitidas.filter((d) => d.length === qtdPeriodos));

	const mesmaDivisao = (a: readonly number[], b: readonly number[]) => a.join('+') === b.join('+');

	function escolherQuantidade(n: 1 | 2 | 3) {
		qtdPeriodos = n;
		const primeira = divisoesAdmitidas.find((d) => d.length === n);
		if (primeira) divisaoEscolhida = primeira;
	}

	/** A prévia: os períodos montados e o que a regra diz de cada 1º dia. */
	const previa = $derived(montarPeriodos(divisaoEscolhida, inicios, feriados));
	const podeEnviarPeriodos = $derived(
		previa.periodos.length === divisaoEscolhida.length && !temErro(previa.checagens)
	);

	/* ── lançar ──────────────────────────────────────────────────────────── */
	let novoExercicio = $state(new Date().getFullYear());
	const aquisitivo = $derived(dataPosse ? periodoAquisitivo(dataPosse, novoExercicio) : null);

	/* ── suspender ───────────────────────────────────────────────────────── */
	let sSuspensao = $state('');
	let sInicio = $state('');
	let sJustificativa = $state('');
	const restoDaSuspensao = $derived(
		suspendendo && sSuspensao ? diasRestantesNaSuspensao(suspendendo, sSuspensao) : null
	);
	const checagensSuspensao = $derived.by((): Checagem[] => {
		if (!suspendendo || !sSuspensao) return [];
		const lista: Checagem[] = [];
		if (sInicio) {
			lista.push(...criteriosDaSuspensao(suspendendo, sSuspensao, sInicio));
			if (restoDaSuspensao && restoDaSuspensao.restantes > 0) {
				lista.push(...montarPeriodos([restoDaSuspensao.restantes], [sInicio], feriados).checagens);
			}
		}
		return lista;
	});
	const podeEnviarSuspensao = $derived(
		!!suspendendo &&
			!!sSuspensao &&
			!!sInicio &&
			(restoDaSuspensao?.restantes ?? 0) > 0 &&
			!temErro(checagensSuspensao) &&
			sJustificativa.trim().length > 0
	);

	/* ── abono ───────────────────────────────────────────────────────────── */
	let aPosicao = $state<'iniciais' | 'finais'>('finais');
	let aStatus = $state<'deferido' | 'indeferido'>('deferido');

	function fecharTudo() {
		lancando = false;
		sustando = null;
		suspendendo = null;
		abonando = null;
		inicios = ['', '', ''];
		sSuspensao = sInicio = sJustificativa = '';
	}

	function abrirLancar() {
		fecharTudo();
		lancando = true;
		escolherQuantidade(1);
	}

	function abrirSustar(exercicio: number, fracoes: FracaoCompleta[]) {
		fecharTudo();
		sustando = { exercicio, fracoes };
		// A divisão atual vem primeiro na lista — é a escolha padrão.
		const atual = divisoesAdmitidas[0];
		if (atual) {
			qtdPeriodos = atual.length as 1 | 2 | 3;
			divisaoEscolhida = atual;
		}
	}

	function aoResponder(mensagemOk: string) {
		enviando = true;
		return async ({ result }: { result: ActionResult }) => {
			enviando = false;
			if (result.type === 'success') {
				const d = result.data as {
					ferias?: FeriasDoPolicial;
					texto?: string;
					avisos?: string[];
				};
				if (d?.ferias) ferias = d.ferias;
				if (d?.texto) oficioGerado = d.texto;
				toaster.create({
					title: mensagemOk,
					description: d?.avisos?.length ? d.avisos.join(' ') : undefined,
					type: 'success'
				});
				fecharTudo();
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error ?? 'Não foi possível concluir'), type: 'error' });
			}
		};
	}

	async function copiarOficio() {
		try {
			await navigator.clipboard.writeText(oficioGerado);
			toaster.create({ title: 'Ofício copiado', type: 'success' });
		} catch {
			toaster.create({ title: 'Selecione o texto e copie manualmente', type: 'info' });
		}
	}

	const classeChecagem = (ch: Checagem) =>
		ch.ok
			? 'text-success-700 dark:text-success-400'
			: ch.nivel === 'erro'
				? 'text-error-600'
				: 'text-warning-600 dark:text-warning-400';
	const marcaChecagem = (ch: Checagem) => (ch.ok ? '✔' : ch.nivel === 'erro' ? '✖' : '⚠');
</script>

<!-- O dourado é a cor de "de férias" no sistema inteiro (COR_SITUACAO.ferias);
     o cartão a veste para ser achado de longe — pedido dele, 17/09. -->
<div
	class="card-elevated rounded-2xl border-2 border-warning-500/60 bg-warning-500/5 p-4 shadow-sm sm:p-6"
>
	<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
		<div>
			<h2 class="text-base font-bold text-warning-700 dark:text-warning-400">☀ Férias</h2>
			<p class="text-xs text-surface-600 dark:text-surface-400">
				Programação homologada no Guardião, lançada pela unidade. Reprogramações vão à COGEP por NUP
				— o sistema diz se é sustação ou suspensão e monta o ofício.
			</p>
		</div>
		<button type="button" class="btn btn-sm preset-filled-warning-500" onclick={abrirLancar}
			>Lançar programação</button
		>
	</div>

	{#if oficioGerado}
		<div
			class="mb-4 rounded-xl border border-success-500/30 bg-success-500/5 p-3 text-xs"
			role="status"
		>
			<div class="mb-1 flex items-center justify-between gap-2">
				<span class="font-semibold text-success-700 dark:text-success-400"
					>Pedido registrado — ofício pronto para o NUP</span
				>
				<div class="flex gap-1">
					<button type="button" class="btn btn-sm preset-filled-primary-500" onclick={copiarOficio}
						>Copiar</button
					>
					<button
						type="button"
						class="btn btn-sm preset-outlined-surface-500"
						onclick={() => (oficioGerado = '')}>Fechar</button
					>
				</div>
			</div>
			<pre
				class="whitespace-pre-wrap font-sans text-surface-700 dark:text-surface-300">{oficioGerado}</pre>
		</div>
	{/if}

	<!-- Lançar a programação de um exercício -->
	{#if lancando}
		<form
			method="POST"
			action="?/registrarProgramacao"
			use:enhance={() => aoResponder('Programação lançada')}
			class="mb-4 space-y-3 rounded-xl border border-surface-200 bg-white/70 p-3 dark:border-white/10 dark:bg-surface-900/60"
		>
			<h3 class="text-sm font-bold">Lançar a programação</h3>
			<!-- Uma vez por período aquisitivo: o que entra aqui é a programação
			     homologada no Guardião; depois, as datas só mudam por sustação ou
			     suspensão (pedido dele, 17/09). -->
			<p
				class="rounded-lg border border-warning-500/40 bg-warning-500/10 p-2 text-xs text-warning-800 dark:text-warning-300"
				role="note"
			>
				<strong>Atenção:</strong> este lançamento só pode ser feito <strong>uma vez</strong> dentro
				do período aquisitivo — é a programação homologada no Guardião. Depois de lançada, as datas
				só mudam por <strong>alteração</strong> (sustação ou suspensão), com pedido à COGEP.
			</p>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Exercício</span>
					<input
						class="input px-3 py-1 text-sm"
						type="number"
						name="exercicio"
						bind:value={novoExercicio}
						min="2000"
						max="2100"
						required
					/>
				</label>
				<p class="self-end pb-1 text-2xs text-surface-500">
					{#if aquisitivo}
						Aquisitivo do exercício {novoExercicio}: {formatarData(aquisitivo.inicio)} a {formatarData(
							aquisitivo.fim
						)} (posse em {formatarData(dataPosse ?? '')}).
					{:else}
						Sem data de posse no cadastro — o período aquisitivo não pode ser calculado.
					{/if}
				</p>
			</div>
			{@render escolhaDePeriodos()}
			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-sm preset-outlined-surface-500" onclick={fecharTudo}
					>Cancelar</button
				>
				<button
					type="submit"
					class="btn btn-sm preset-filled-primary-500 disabled:opacity-40"
					disabled={enviando || !podeEnviarPeriodos}>Lançar</button
				>
			</div>
		</form>
	{/if}

	<!-- Os exercícios -->
	{#if ferias.fracoes.length === 0}
		<p class="text-sm text-surface-500">Nenhuma programação lançada.</p>
	{:else}
		{#each porExercicio as [exercicio, fracoes] (exercicio)}
			{@const aq = dataPosse ? periodoAquisitivo(dataPosse, exercicio) : null}
			{@const situacao = situacaoDe(fracoes)}
			{@const pendente = pendenteDe(exercicio)}
			<div class="mb-4">
				<div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<p class="text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase">
						Exercício {exercicio}{#if aq}
							· aquisitivo {formatarData(aq.inicio)} – {formatarData(aq.fim)}{/if}
					</p>
					{#if !pendente}
						<div class="flex gap-1">
							{#if situacao.sustacao}
								<button
									type="button"
									class="btn btn-sm preset-outlined-surface-500"
									onclick={() => abrirSustar(exercicio, fracoes)}
									>Sustar {situacao.sustacao.fracoes.length === 1
										? 'a fração'
										: `as ${situacao.sustacao.fracoes.length} frações`}</button
								>
							{/if}
							{#if intacta(exercicio, fracoes)}
								<form
									method="POST"
									action="?/excluirProgramacao"
									use:enhance={() => aoResponder('Programação excluída')}
								>
									<input type="hidden" name="exercicio" value={exercicio} />
									<button
										type="submit"
										class="btn btn-sm preset-outlined-error-500"
										title="Lançada errada? Some com os afastamentos junto"
										disabled={enviando}>Excluir</button
									>
								</form>
							{/if}
						</div>
					{/if}
				</div>

				<ul class="space-y-2">
					{#each fracoes as f (f.id)}
						{@const status = statusPelaData(comoFracao(f), hoje)}
						<li
							class="rounded-xl border border-surface-200 bg-white/60 p-3 text-sm dark:border-white/10 dark:bg-surface-900/40"
						>
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<div class="flex flex-wrap items-baseline gap-x-2">
									<span class="font-semibold">{f.ordem}ª fração</span>
									<span class="tabular-nums {COR_STATUS[status]}"
										>{formatarData(f.data_inicio)} – {formatarData(f.data_fim)}</span
									>
									<span class="text-xs text-surface-500">{diasDaFracao(f)} dias</span>
									<span class="text-xs font-semibold {COR_STATUS[status]}"
										>{ROTULO_STATUS_FRACAO[status]}</span
									>
									{#if f.origem === 'reprogramacao'}
										<span class="text-2xs text-surface-500">(reprogramada)</span>
									{/if}
								</div>
								{#if f.status === 'programada' && status !== 'gozada' && !pendente}
									<div class="flex gap-1">
										{#if status === 'em_gozo'}
											<button
												type="button"
												class="btn btn-sm preset-outlined-surface-500"
												onclick={() => {
													fecharTudo();
													suspendendo = f;
												}}>Suspender</button
											>
										{/if}
										{#if isAdmin && !f.abono}
											<button
												type="button"
												class="btn btn-sm preset-outlined-surface-500"
												onclick={() => {
													fecharTudo();
													abonando = f;
												}}>Registrar abono</button
											>
										{/if}
									</div>
								{/if}
							</div>

							<!-- Abono -->
							{#if f.abono}
								<div class="mt-2 rounded-lg bg-surface-100 p-2 text-xs dark:bg-surface-800/60">
									<span class="font-semibold"
										>Abono {f.abono.status}: 10 dias {f.abono.posicao}</span
									>
									· {formatarData(f.abono.abono_inicio)} – {formatarData(f.abono.abono_fim)}
									{#if f.abono.nup}
										· NUP {formatarNUP(f.abono.nup)}{/if}
									{#if f.abono.status === 'deferido'}
										{#if f.abono.ciencia_unidade_em}
											<span class="text-surface-500">
												· ciência da unidade em {formatarData(f.abono.ciencia_unidade_em)}</span
											>
										{:else}
											<span class="ml-1 font-semibold text-warning-600 dark:text-warning-400"
												>· aguardando ciência da unidade — nesses dias o servidor TRABALHA</span
											>
											{#if podeDarCiencia}
												<form
													method="POST"
													action="?/cienciaAbono"
													use:enhance={() => aoResponder('Ciência registrada')}
													class="mt-1"
												>
													<input type="hidden" name="abono_id" value={f.abono.id} />
													<button
														type="submit"
														class="btn btn-sm preset-filled-warning-500"
														disabled={enviando}>Estou ciente</button
													>
												</form>
											{/if}
										{/if}
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				<!-- Os pedidos do exercício à COGEP -->
				{#each pedidosDe(exercicio) as r (r.id)}
					{@const periodos = periodosDoPedido(r)}
					<div
						class="mt-2 rounded-lg p-2 text-xs {r.status === 'pendente'
							? 'bg-warning-500/15'
							: 'bg-surface-100 dark:bg-surface-800/60'}"
					>
						<span class="font-semibold">{ROTULO_TIPO_REPROGRAMACAO[r.tipo]}</span>
						{#if r.data_suspensao}
							· retorno em {formatarData(r.data_suspensao)}{/if}
						→ {periodos
							.map((p) => `${formatarData(p.inicio)} – ${formatarData(p.fim)}`)
							.join(' · ')}
						{#if r.nup}
							· NUP {formatarNUP(r.nup)}{/if}
						{#if r.status === 'pendente'}
							<span class="ml-1 font-semibold text-warning-700 dark:text-warning-400"
								>· aguardando a COGEP</span
							>
							<!-- O passo a passo, porque o pedido nasce aqui antes de o processo existir
							     (pedido dele, 20/09): sem isto, "Anotar" não diz o que é. -->
							<ol
								class="mt-2 list-decimal space-y-0.5 pl-5 text-2xs text-surface-700 dark:text-surface-300"
							>
								<li>
									O pedido já está registrado aqui e o <b>ofício</b> foi gerado (botão Copiar acima, ao
									registrar).
								</li>
								<li>
									Abra o processo à COGEP com o ofício e, quando tiver o número, <b>anote o NUP</b>
									abaixo — é o que liga este pedido ao processo.
								</li>
								<li>
									Quando a resposta da COGEP chegar, clique <b>COGEP deferiu</b> ou
									<b>Indeferiu</b>: deferido, as frações mudam sozinhas; indeferido, tudo fica como
									estava. Até lá o pedido é pendência da unidade.
								</li>
							</ol>
							<div class="mt-2 flex flex-wrap items-end gap-2">
								{#if !r.nup}
									<form
										method="POST"
										action="?/anotarNup"
										use:enhance={() => aoResponder('NUP anotado')}
										class="flex items-end gap-1"
									>
										<input type="hidden" name="reprogramacao_id" value={r.id} />
										<label class="label">
											<span class="label-text text-2xs font-bold uppercase opacity-70"
												>NUP do processo</span
											>
											<input
												class="input w-52 px-2 py-1 text-xs"
												name="nup"
												maxlength="40"
												placeholder="00000.000000/0000-00"
											/>
										</label>
										<button
											type="submit"
											class="btn btn-sm preset-outlined-surface-500"
											disabled={enviando}>Anotar</button
										>
									</form>
								{/if}
								<form
									method="POST"
									action="?/decidirReprogramacao"
									use:enhance={() => aoResponder('Resposta da COGEP homologada')}
									class="flex gap-1"
								>
									<input type="hidden" name="reprogramacao_id" value={r.id} />
									<button
										type="submit"
										name="decisao"
										value="deferida"
										class="btn btn-sm preset-filled-success-500"
										disabled={enviando}>COGEP deferiu</button
									>
									<button
										type="submit"
										name="decisao"
										value="indeferida"
										class="btn btn-sm preset-outlined-error-500"
										disabled={enviando}>Indeferiu</button
									>
								</form>
							</div>
						{:else}
							<span class="text-surface-500">
								· {r.status} em {formatarData(r.decidida_em ?? '')}</span
							>
						{/if}
					</div>
				{/each}
			</div>
		{/each}
	{/if}

	<!-- SUSTAÇÃO: todas as frações por começar, de uma vez, redivididas ou não -->
	{#if sustando}
		{@const s = situacaoDe(sustando.fracoes).sustacao}
		<form
			method="POST"
			action="?/sustar"
			use:enhance={() => aoResponder('Pedido registrado')}
			class="mt-4 space-y-3 rounded-xl border border-primary-500/30 bg-primary-500/5 p-4"
		>
			<input type="hidden" name="exercicio" value={sustando.exercicio} />
			<h3 class="text-sm font-bold">Sustar as férias do exercício {sustando.exercicio}</h3>
			{#if s}
				<!-- O nome do caso, decidido pelos fatos — é isto que evita o NUP errado. -->
				<div class="rounded-lg bg-white/70 p-3 text-sm dark:bg-surface-900/60">
					<p class="text-lg font-bold text-primary-700 dark:text-primary-400">SUSTAÇÃO</p>
					<p class="text-surface-700 dark:text-surface-300">{s.motivo}</p>
					<ul class="mt-1 text-xs text-surface-600 dark:text-surface-400">
						{#each s.fracoes as f (f.ordem + f.data_inicio)}
							<li>
								{f.ordem}ª fração: {formatarData(f.data_inicio)} – {formatarData(f.data_fim)} ({diasDaFracao(
									f
								)} dias{#if f.diasAbonados}, {f.diasAbonados} vendidos — restam {diasAGozar(
										f
									)}{/if})
							</li>
						{/each}
					</ul>
				</div>
				{@render escolhaDePeriodos()}
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70"
						>Observação (opcional)</span
					>
					<textarea
						class="textarea px-3 py-1 text-sm"
						name="justificativa"
						rows="2"
						maxlength={MAX_JUSTIFICATIVA}></textarea>
				</label>
			{:else}
				<p class="text-sm text-error-600">Não há fração por começar neste exercício.</p>
			{/if}
			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-sm preset-outlined-surface-500" onclick={fecharTudo}
					>Cancelar</button
				>
				<button
					type="submit"
					class="btn btn-sm preset-filled-primary-500 disabled:opacity-40"
					disabled={enviando || !s || !podeEnviarPeriodos}>Gerar ofício e registrar pedido</button
				>
			</div>
		</form>
	{/if}

	<!-- SUSPENSÃO: a fração em gozo é interrompida; o que resta volta num período só -->
	{#if suspendendo}
		<form
			method="POST"
			action="?/suspender"
			use:enhance={() => aoResponder('Pedido registrado')}
			class="mt-4 space-y-3 rounded-xl border border-primary-500/30 bg-primary-500/5 p-4"
		>
			<input type="hidden" name="fracao_id" value={suspendendo.id} />
			<h3 class="text-sm font-bold">
				Suspender a {suspendendo.ordem}ª fração de {suspendendo.exercicio}
				<span class="font-normal text-surface-500">
					({formatarData(suspendendo.data_inicio)} – {formatarData(suspendendo.data_fim)}, {diasDaFracao(
						suspendendo
					)} dias)</span
				>
			</h3>
			<div class="rounded-lg bg-white/70 p-3 text-sm dark:bg-surface-900/60">
				<p class="text-lg font-bold text-primary-700 dark:text-primary-400">SUSPENSÃO</p>
				<p class="text-surface-700 dark:text-surface-300">
					A fração está em gozo: só cabe suspensão, por imperiosa necessidade do serviço. Os dias já
					gozados ficam; os que restam voltam num período novo. As frações seguintes não mudam.
				</p>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70"
						>Retorno ao serviço</span
					>
					<input
						class="input px-3 py-1 text-sm"
						type="date"
						name="data_suspensao"
						bind:value={sSuspensao}
						min={suspendendo.data_inicio}
						max={suspendendo.data_fim}
						required
					/>
					{#if restoDaSuspensao}
						<span class="ml-1 text-2xs text-surface-500"
							>{restoDaSuspensao.gozados} gozados · restam {restoDaSuspensao.restantes} dias</span
						>
					{/if}
				</label>
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70"
						>1º dia do período que resta</span
					>
					<input
						class="input px-3 py-1 text-sm"
						type="date"
						name="novo_inicio"
						bind:value={sInicio}
						min={sSuspensao || undefined}
						required
					/>
					{#if sInicio && restoDaSuspensao && restoDaSuspensao.restantes > 0}
						<span class="ml-1 text-2xs text-surface-500"
							>até {formatarData(fimDaFracao(sInicio, restoDaSuspensao.restantes))}</span
						>
					{/if}
				</label>
			</div>
			{#if checagensSuspensao.length > 0}
				<ul class="space-y-0.5 text-xs">
					{#each checagensSuspensao as ch (ch.texto)}
						<li class={classeChecagem(ch)}>{marcaChecagem(ch)} {ch.texto}</li>
					{/each}
				</ul>
			{/if}
			<label class="label">
				<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70"
					>Imperiosa necessidade do serviço</span
				>
				<textarea
					class="textarea px-3 py-1 text-sm"
					name="justificativa"
					bind:value={sJustificativa}
					rows="2"
					maxlength={MAX_JUSTIFICATIVA}
					required
					placeholder="Ex.: operação de grande porte na região, sem efetivo para substituição"
				></textarea>
			</label>
			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-sm preset-outlined-surface-500" onclick={fecharTudo}
					>Cancelar</button
				>
				<button
					type="submit"
					class="btn btn-sm preset-filled-primary-500 disabled:opacity-40"
					disabled={enviando || !podeEnviarSuspensao}>Gerar ofício e registrar pedido</button
				>
			</div>
		</form>
	{/if}

	<!-- Abono (Admin Geral) -->
	{#if abonando}
		<form
			method="POST"
			action="?/registrarAbono"
			use:enhance={() => aoResponder('Abono registrado')}
			class="mt-4 space-y-3 rounded-xl border border-surface-200 p-4 dark:border-white/10"
		>
			<input type="hidden" name="fracao_id" value={abonando.id} />
			<h3 class="text-sm font-bold">
				Abono pecuniário — {abonando.ordem}ª fração de {abonando.exercicio}
				<span class="font-normal text-surface-500">
					({formatarData(abonando.data_inicio)} – {formatarData(abonando.data_fim)}, {diasDaFracao(
						abonando
					)} dias)</span
				>
			</h3>
			<p class="text-xs text-surface-600 dark:text-surface-400">
				Decisão do Delegado-Geral, chegada ao DPI SUL. Deferido, nos 10 dias convertidos o servidor
				TRABALHA — a unidade recebe o alerta e precisa dar ciência.
			</p>
			<div class="grid grid-cols-2 gap-3">
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70"
						>Dias convertidos</span
					>
					<select class="select px-3 py-1 text-sm" name="posicao" bind:value={aPosicao}>
						<option value="iniciais">10 iniciais</option>
						<option value="finais">10 finais</option>
					</select>
				</label>
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Decisão</span>
					<select class="select px-3 py-1 text-sm" name="status" bind:value={aStatus}>
						<option value="deferido">Deferido</option>
						<option value="indeferido">Indeferido</option>
					</select>
				</label>
			</div>
			<label class="label">
				<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70"
					>NUP do requerimento</span
				>
				<input
					class="input px-3 py-1 text-sm"
					name="nup"
					maxlength="40"
					placeholder="00000.000000/0000-00"
				/>
			</label>
			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-sm preset-outlined-surface-500" onclick={fecharTudo}
					>Cancelar</button
				>
				<button
					type="submit"
					class="btn btn-sm preset-filled-primary-500 disabled:opacity-40"
					disabled={enviando}>Registrar</button
				>
			</div>
		</form>
	{/if}
</div>

<!-- "Quantos períodos?" → a forma → o 1º dia de cada fração. O último dia sai
     da regra; o 1º dia tem de ser útil. Serve ao lançamento e à sustação, que
     só diferem na lista de divisões admitidas. -->
{#snippet escolhaDePeriodos()}
	<fieldset class="space-y-2">
		<legend class="ml-1 text-2xs font-bold uppercase opacity-70">Quantos períodos?</legend>
		<div class="flex flex-wrap gap-2">
			{#each quantidadesPossiveis as n (n)}
				<button
					type="button"
					class="btn btn-sm {qtdPeriodos === n
						? 'preset-filled-primary-500'
						: 'preset-outlined-surface-500'}"
					onclick={() => escolherQuantidade(n)}>{n} {n === 1 ? 'período' : 'períodos'}</button
				>
			{/each}
		</div>
		{#if divisoesDaQuantidade.length > 1}
			<div class="flex flex-wrap gap-2">
				{#each divisoesDaQuantidade as d (rotuloDaDivisao(d))}
					<label
						class="flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-xs {mesmaDivisao(
							divisaoEscolhida,
							d
						)
							? 'border-primary-500 bg-primary-500/10 font-semibold'
							: 'border-surface-300 dark:border-white/10'}"
					>
						<input
							type="radio"
							class="radio"
							value={d}
							checked={mesmaDivisao(divisaoEscolhida, d)}
							onchange={() => (divisaoEscolhida = d)}
						/>
						{rotuloDaDivisao(d)} dias
					</label>
				{/each}
			</div>
		{/if}
		<input type="hidden" name="divisao" value={divisaoEscolhida.join('+')} />
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
			{#each divisaoEscolhida as dias, k (k)}
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70"
						>1º dia da {k + 1}ª fração ({dias} dias)</span
					>
					<input
						class="input px-3 py-1 text-sm"
						type="date"
						name="inicio_{k + 1}"
						bind:value={inicios[k]}
						required
					/>
					{#if inicios[k]}
						<span class="ml-1 text-2xs text-surface-500"
							>até {formatarData(fimDaFracao(inicios[k], dias))}</span
						>
					{/if}
				</label>
			{/each}
		</div>
		{#if previa.checagens.length > 0}
			<ul class="space-y-0.5 text-xs">
				{#each previa.checagens as ch (ch.texto)}
					<li class={classeChecagem(ch)}>{marcaChecagem(ch)} {ch.texto}</li>
				{/each}
				<li class="text-surface-500">
					O teto de 15 % da unidade é conferido no envio (só avisa, só no 1º período).
				</li>
			</ul>
		{/if}
	</fieldset>
{/snippet}
