<script lang="ts">
	/**
	 * O cartão FÉRIAS da ficha do servidor — as frações programadas no Guardião,
	 * o assistente de reprogramação à COGEP e o abono.
	 *
	 * O que este cartão precisa fazer bem, e a razão de existir: dizer ao chefe
	 * imediato se o pedido é SUSTAÇÃO ou SUSPENSÃO antes de ele escrever o NUP.
	 * A classificação sai dos fatos (`classificarReprogramacao`), aparece em
	 * linguagem clara com o motivo, e o ofício sai pronto com o instituto certo.
	 * A action refaz tudo no envio; aqui é a prévia, para o usuário ver o que vai
	 * mandar.
	 *
	 * Quem vê o quê: qualquer perfil que abre a ficha lança fração, reprograma,
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
	import type { FracaoCompleta } from '$lib/db';
	import {
		classificarReprogramacao,
		conferirNovoPeriodo,
		criteriosDaSuspensao,
		diasDaFracao,
		periodoAquisitivo,
		ROTULO_STATUS_FRACAO,
		ROTULO_TIPO_REPROGRAMACAO,
		statusPelaData,
		temErro,
		type Checagem,
		type Classificacao,
		type Fracao
	} from '$lib/servidores/ferias';

	let {
		ferias = $bindable(),
		feriados,
		dataPosse,
		isAdmin,
		podeDarCiencia
	}: {
		ferias: FracaoCompleta[];
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
		status: f.status
	});

	/** Por exercício, mais recente primeiro; dentro, pela ordem e pelo id. */
	const porExercicio = $derived.by(() => {
		// Map local ao derived, montado e devolvido — não é estado vivo.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const mapa = new Map<number, FracaoCompleta[]>();
		for (const f of ferias) mapa.set(f.exercicio, [...(mapa.get(f.exercicio) ?? []), f]);
		return [...mapa.entries()].sort((a, b) => b[0] - a[0]);
	});

	const pendentesDe = (f: FracaoCompleta) =>
		f.reprogramacoes.filter((r) => r.status === 'pendente');

	const COR_STATUS: Record<string, string> = {
		programada: 'text-primary-700 dark:text-primary-400',
		em_gozo: 'text-warning-600 dark:text-warning-400',
		gozada: 'text-surface-500',
		sustada: 'text-surface-400 line-through',
		suspensa: 'text-surface-400 line-through'
	};

	/* ── formulários abertos ─────────────────────────────────────────────── */
	let lancando = $state(false);
	let reprogramando = $state<FracaoCompleta | null>(null);
	let abonando = $state<FracaoCompleta | null>(null);
	let enviando = $state(false);
	/** O ofício devolvido pela action, para copiar no NUP. */
	let oficioGerado = $state('');

	/* ── lançar fração ───────────────────────────────────────────────────── */
	let novoExercicio = $state(new Date().getFullYear());
	let novaOrdem = $state<1 | 2 | 3>(1);
	let novoInicio = $state('');
	let novoFim = $state('');
	const diasNovaFracao = $derived(
		novoInicio && novoFim ? diasDaFracao({ data_inicio: novoInicio, data_fim: novoFim }) : 0
	);
	const aquisitivo = $derived(dataPosse ? periodoAquisitivo(dataPosse, novoExercicio) : null);

	/* ── reprogramar: a prévia do que a action vai conferir ───────────────── */
	let rInicio = $state('');
	let rFim = $state('');
	let rSuspensao = $state('');
	let rJustificativa = $state('');

	const classificacao = $derived.by((): Classificacao | { erro: string } | null => {
		if (!reprogramando) return null;
		const doExercicio = ferias
			.filter((f) => f.exercicio === reprogramando!.exercicio)
			.map(comoFracao);
		try {
			return classificarReprogramacao(comoFracao(reprogramando), hoje, doExercicio);
		} catch (e) {
			return { erro: e instanceof Error ? e.message : 'Não reprogramável.' };
		}
	});
	const ehSuspensao = $derived(
		classificacao && !('erro' in classificacao) && classificacao.tipo === 'suspensao'
	);

	const checagens = $derived.by((): Checagem[] => {
		if (!reprogramando || !rInicio || !rFim) return [];
		const lista = conferirNovoPeriodo({
			fracaoOriginal: comoFracao(reprogramando),
			novoInicio: rInicio,
			novoFim: rFim,
			feriados
		});
		if (ehSuspensao && rSuspensao) {
			lista.push(...criteriosDaSuspensao(reprogramando, rSuspensao, rInicio));
		}
		return lista;
	});
	const podeEnviarReprogramacao = $derived(
		!!reprogramando &&
			!!rInicio &&
			!!rFim &&
			!temErro(checagens) &&
			(!ehSuspensao || (!!rSuspensao && rJustificativa.trim().length > 0))
	);

	/* ── abono ───────────────────────────────────────────────────────────── */
	let aPosicao = $state<'iniciais' | 'finais'>('finais');
	let aStatus = $state<'deferido' | 'indeferido'>('deferido');

	function fecharTudo() {
		lancando = false;
		reprogramando = null;
		abonando = null;
		rInicio = rFim = rSuspensao = rJustificativa = '';
		novoInicio = novoFim = '';
	}

	function aoResponder(mensagemOk: string) {
		enviando = true;
		return async ({ result }: { result: ActionResult }) => {
			enviando = false;
			if (result.type === 'success') {
				const d = result.data as { ferias?: FracaoCompleta[]; texto?: string; avisos?: string[] };
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
</script>

<div class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6">
	<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
		<div>
			<h2 class="text-base font-bold text-surface-700 dark:text-surface-300">Férias</h2>
			<p class="text-xs text-surface-600 dark:text-surface-400">
				Programação homologada no Guardião, lançada pela unidade. Reprogramações vão à COGEP por NUP
				— o sistema diz se é sustação ou suspensão e monta o ofício.
			</p>
		</div>
		<button
			type="button"
			class="btn btn-sm preset-outlined-surface-500"
			onclick={() => {
				fecharTudo();
				lancando = true;
			}}>Lançar fração</button
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

	<!-- Lançar fração -->
	{#if lancando}
		<form
			method="POST"
			action="?/registrarFracao"
			use:enhance={() => aoResponder('Fração lançada')}
			class="mb-4 space-y-3 rounded-xl border border-surface-200 p-3 dark:border-white/10"
		>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Fração</span>
					<select class="select px-3 py-1 text-sm" name="ordem" bind:value={novaOrdem}>
						<option value={1}>1ª</option>
						<option value={2}>2ª</option>
						<option value={3}>3ª</option>
					</select>
				</label>
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Início</span>
					<input
						class="input px-3 py-1 text-sm"
						type="date"
						name="data_inicio"
						bind:value={novoInicio}
						required
					/>
				</label>
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Fim</span>
					<input
						class="input px-3 py-1 text-sm"
						type="date"
						name="data_fim"
						bind:value={novoFim}
						required
					/>
				</label>
			</div>
			<p class="text-2xs text-surface-500">
				{#if aquisitivo}
					Período aquisitivo do exercício {novoExercicio}: {formatarData(aquisitivo.inicio)} a {formatarData(
						aquisitivo.fim
					)} (posse em {formatarData(dataPosse ?? '')}).
				{:else}
					Sem data de posse no cadastro — o período aquisitivo não pode ser calculado.
				{/if}
				{#if diasNovaFracao > 0}
					· {diasNovaFracao} dia{diasNovaFracao === 1 ? '' : 's'}
					{#if diasNovaFracao < 10}
						<span class="text-warning-600"> — fração menor que 10 dias</span>
					{/if}
				{/if}
			</p>
			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-sm preset-outlined-surface-500" onclick={fecharTudo}
					>Cancelar</button
				>
				<button
					type="submit"
					class="btn btn-sm preset-filled-primary-500 disabled:opacity-40"
					disabled={enviando || !novoInicio || !novoFim}>Lançar</button
				>
			</div>
		</form>
	{/if}

	<!-- As frações -->
	{#if ferias.length === 0}
		<p class="text-sm text-surface-500">Nenhuma fração lançada.</p>
	{:else}
		{#each porExercicio as [exercicio, fracoes] (exercicio)}
			{@const aq = dataPosse ? periodoAquisitivo(dataPosse, exercicio) : null}
			<div class="mb-4">
				<p class="mb-1 text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase">
					Exercício {exercicio}{#if aq}
						· aquisitivo {formatarData(aq.inicio)} – {formatarData(aq.fim)}{/if}
				</p>
				<ul class="space-y-2">
					{#each fracoes as f (f.id)}
						{@const status = statusPelaData(comoFracao(f), hoje)}
						{@const pend = pendentesDe(f)}
						<li class="rounded-xl border border-surface-200 p-3 text-sm dark:border-white/10">
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
								{#if f.status === 'programada' && status !== 'gozada'}
									<div class="flex gap-1">
										{#if pend.length === 0}
											<button
												type="button"
												class="btn btn-sm preset-outlined-surface-500"
												onclick={() => {
													fecharTudo();
													reprogramando = f;
												}}>Reprogramar</button
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
										{#if pend.length === 0 && !f.abono}
											<form
												method="POST"
												action="?/excluirFracao"
												use:enhance={() => aoResponder('Fração excluída')}
											>
												<input type="hidden" name="fracao_id" value={f.id} />
												<button
													type="submit"
													class="btn btn-sm preset-outlined-error-500"
													title="Lançada errada? Some com o afastamento junto"
													disabled={enviando}>Excluir</button
												>
											</form>
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

							<!-- Pedidos à COGEP -->
							{#each f.reprogramacoes as r (r.id)}
								<div
									class="mt-2 rounded-lg p-2 text-xs {r.status === 'pendente'
										? 'bg-warning-500/10'
										: 'bg-surface-100 dark:bg-surface-800/60'}"
								>
									<span class="font-semibold">{ROTULO_TIPO_REPROGRAMACAO[r.tipo]}</span>
									→ {formatarData(r.novo_inicio)} – {formatarData(r.novo_fim)}
									{#if r.nup}
										· NUP {formatarNUP(r.nup)}{/if}
									{#if r.status === 'pendente'}
										<span class="ml-1 font-semibold text-warning-700 dark:text-warning-400"
											>· aguardando a COGEP</span
										>
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
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	{/if}

	<!-- O assistente de reprogramação -->
	{#if reprogramando}
		{@const c = classificacao}
		<form
			method="POST"
			action="?/reprogramar"
			use:enhance={() => aoResponder('Pedido registrado')}
			class="mt-4 space-y-3 rounded-xl border border-primary-500/30 bg-primary-500/5 p-4"
		>
			<input type="hidden" name="fracao_id" value={reprogramando.id} />
			<h3 class="text-sm font-bold">
				Reprogramar a {reprogramando.ordem}ª fração de {reprogramando.exercicio}
				<span class="font-normal text-surface-500">
					({formatarData(reprogramando.data_inicio)} – {formatarData(reprogramando.data_fim)})</span
				>
			</h3>

			{#if c && 'erro' in c}
				<p class="text-sm text-error-600">{c.erro}</p>
			{:else if c}
				<!-- O nome do caso, decidido pelos fatos — é isto que evita o NUP errado. -->
				<div class="rounded-lg bg-white/70 p-3 text-sm dark:bg-surface-900/60">
					<p class="text-lg font-bold text-primary-700 dark:text-primary-400">
						{ROTULO_TIPO_REPROGRAMACAO[c.tipo].toUpperCase()}
					</p>
					<p class="text-surface-700 dark:text-surface-300">{c.motivo}</p>
					<p class="mt-1 text-2xs text-surface-500">{c.base}</p>
					{#if c.admiteSuspensaoPeloParagrafo13}
						<p class="mt-1 text-2xs text-surface-600 dark:text-surface-400">
							A 1ª fração já foi gozada: pelo § 13 a COGEP também admite SUSPENSÃO desta, se o
							motivo for necessidade do serviço.
						</p>
					{/if}
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					{#if c.tipo === 'suspensao'}
						<label class="label">
							<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70"
								>Retorno ao serviço</span
							>
							<input
								class="input px-3 py-1 text-sm"
								type="date"
								name="data_suspensao"
								bind:value={rSuspensao}
								required
							/>
						</label>
					{/if}
					<label class="label">
						<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Novo início</span>
						<input
							class="input px-3 py-1 text-sm"
							type="date"
							name="novo_inicio"
							bind:value={rInicio}
							required
						/>
					</label>
					<label class="label">
						<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Novo fim</span>
						<input
							class="input px-3 py-1 text-sm"
							type="date"
							name="novo_fim"
							bind:value={rFim}
							required
						/>
					</label>
				</div>

				{#if checagens.length > 0}
					<ul class="space-y-0.5 text-xs">
						{#each checagens as ch (ch.texto)}
							<li
								class={ch.ok
									? 'text-success-700 dark:text-success-400'
									: ch.nivel === 'erro'
										? 'text-error-600'
										: 'text-warning-600 dark:text-warning-400'}
							>
								{ch.ok ? '✔' : ch.nivel === 'erro' ? '✖' : '⚠'}
								{ch.texto}
							</li>
						{/each}
						<li class="text-surface-500">
							O teto de 15 % da unidade é conferido no envio (só avisa, só no 1º período).
						</li>
					</ul>
				{/if}

				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">
						{c.tipo === 'suspensao' ? 'Imperiosa necessidade do serviço' : 'Observação (opcional)'}
					</span>
					<textarea
						class="textarea px-3 py-1 text-sm"
						name="justificativa"
						bind:value={rJustificativa}
						rows="2"
						maxlength={MAX_JUSTIFICATIVA}
						required={c.tipo === 'suspensao'}
						placeholder={c.tipo === 'suspensao'
							? 'Ex.: operação de grande porte na região, sem efetivo para substituição'
							: ''}></textarea>
				</label>
			{/if}

			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-sm preset-outlined-surface-500" onclick={fecharTudo}
					>Cancelar</button
				>
				<button
					type="submit"
					class="btn btn-sm preset-filled-primary-500 disabled:opacity-40"
					disabled={enviando || !podeEnviarReprogramacao}>Gerar ofício e registrar pedido</button
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
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Requerido em</span>
					<input class="input px-3 py-1 text-sm" type="date" name="data_requerimento" />
				</label>
				<label class="label">
					<span class="label-text ml-1 text-2xs font-bold uppercase opacity-70">Decidido em</span>
					<input class="input px-3 py-1 text-sm" type="date" name="decidido_em" />
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
