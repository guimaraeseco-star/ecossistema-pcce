<script lang="ts">
	/**
	 * O formulário de uma operação — o MESMO na criação e na edição.
	 *
	 * Existe como componente porque as duas telas pedem exatamente os mesmos
	 * campos, e mantê-las separadas foi o que produziu o estado anterior: criar
	 * uma operação preenchia metade dela (identidade), e a outra metade (vagas,
	 * horários, textos do PDF) só aparecia depois, atrás de um segundo botão, sem
	 * nada na tela dizendo que faltava.
	 *
	 * Duas diferenças entre os modos, e só duas:
	 *
	 * - **"basear o formulário em"** só existe ao criar. Reclonar na edição
	 *   sobrescreveria em silêncio um formulário já em uso, e as respostas
	 *   gravadas continuariam com as `key` antigas;
	 * - o **`id`** vai num campo escondido só ao editar.
	 *
	 * ## Vazio herda
	 *
	 * Todo campo de configuração aceita ficar em branco, e branco grava `NULL` =
	 * "usa o padrão do sistema". O `placeholder` mostra o valor herdado, senão um
	 * campo vazio parece "zero" ou "sem texto" — que são coisas diferentes. `0` é
	 * uma escolha legítima (equipe sem aquela vaga) e por isso NÃO é o mesmo que
	 * vazio.
	 */
	import { enhance } from '$app/forms';
	import { loading } from '$lib/loading.svelte';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	// Os limites dos campos de breve relatório: MESMA constante que a action
	// grava e que o modal de `/operacoes/gise/[id]` usa nos campos equivalentes.
	import { MAX_BREVE_TITULO, MAX_BREVE_PARAGRAFO } from '$lib/gise/breve-relatorio';

	type Operacao = {
		id: number;
		nome: string;
		sigla: string;
		descricao: string;
		usa_equipe_operacional: boolean;
		usa_equipe_seint: boolean;
		data_inicio: string | null;
		data_fim: string | null;
		vagas_operacional_dpc: number | null;
		vagas_operacional_oip: number | null;
		vagas_seint_dpc: number | null;
		vagas_seint_oip: number | null;
		hora_entrada_padrao: string | null;
		hora_saida_padrao: string | null;
		breve_relatorio_titulo: string | null;
		breve_relatorio_texto_seccional: string | null;
		breve_relatorio_texto_supervisao: string | null;
	};

	const {
		operacao = null,
		herdado,
		baseaveis = [],
		aoVoltar,
		enviar
	}: {
		/** `null` cria; preenchida edita. É o que discrimina os dois modos. */
		operacao?: Operacao | null;
		herdado: {
			vagas: { operacional: { dpc: number; oip: number }; seint: { dpc: number; oip: number } };
			horaEntrada: string;
			horaSaida: string;
			breveTitulo: string;
			breveTextoSeccional: string;
			breveTextoSupervisao: string;
		};
		/** Operações que podem servir de base para o formulário da nova. */
		baseaveis?: Array<{ id: number; nome: string }>;
		aoVoltar: () => void;
		enviar: (mensagemOk: string, aoConcluir?: () => void) => SubmitFunction;
	} = $props();

	const editando = $derived(operacao !== null);

	/**
	 * Os tipos de equipe são estado local, e não só `checked` do HTML, porque as
	 * vagas padrão de cada tipo só fazem sentido se aquele tipo existir — o bloco
	 * some junto quando o admin desmarca, na criação e na edição.
	 */
	let usaOperacional = $state(true);
	let usaSeint = $state(true);

	// Reagir à operação, e não ao primeiro render: trocar de linha na lista
	// remonta o formulário com outra operação, e sem isto os dois checkboxes
	// ficariam com o valor da anterior.
	$effect(() => {
		usaOperacional = operacao?.usa_equipe_operacional ?? true;
		usaSeint = operacao?.usa_equipe_seint ?? true;
	});

	const CAMPO =
		'w-full min-w-0 px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm';
	const CAMPO_NUM =
		'w-20 px-2 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm';
	const BLOCO =
		'rounded-xl border border-surface-200/70 bg-surface-50 dark:border-white/10 dark:bg-surface-800/40 p-4 space-y-3';

	/** `null` vira `''` — é o que faz o campo aparecer vazio e, assim, herdar. */
	function ouVazio(v: number | string | null | undefined): string {
		return v === null || v === undefined ? '' : String(v);
	}
</script>

<div class="min-w-0 space-y-4">
	<BotaoVoltar onclick={aoVoltar} rotulo="Voltar às operações" />

	<div class="min-w-0">
		<h2 class="text-xl font-bold">
			{editando ? operacao?.nome : 'Nova operação'}
		</h2>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
			{editando
				? 'Identificação, tipos de equipe e a configuração de escala desta operação.'
				: 'Tudo o que a operação precisa para começar a receber escalas.'}
		</p>
	</div>

	<form
		method="POST"
		action={editando ? '?/editar' : '?/criar'}
		class="min-w-0 space-y-5"
		use:enhance={enviar(editando ? 'Operação salva' : 'Operação criada', aoVoltar)}
	>
		{#if editando && operacao}
			<input type="hidden" name="id" value={operacao.id} />
		{/if}

		<!-- 1. Identificação -->
		<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-4">
			<h3 class="text-base font-semibold">Identificação</h3>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="min-w-0">
					<label for="f_nome" class="block text-sm font-medium mb-1">Nome *</label>
					<input
						id="f_nome"
						name="nome"
						type="text"
						required
						maxlength="120"
						placeholder="OPERAÇÃO CRAJUBAR"
						value={operacao?.nome ?? ''}
						class={CAMPO}
					/>
				</div>
				<div class="min-w-0">
					<label for="f_sigla" class="block text-sm font-medium mb-1">Sigla</label>
					<input
						id="f_sigla"
						name="sigla"
						type="text"
						maxlength="30"
						placeholder="CRAJUBAR"
						value={operacao?.sigla ?? ''}
						class={CAMPO}
					/>
					<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
						Aparece nos filtros e no selo das escalas.
					</p>
				</div>
			</div>

			<div class="min-w-0">
				<label for="f_desc" class="block text-sm font-medium mb-1">Descrição</label>
				<input
					id="f_desc"
					name="descricao"
					type="text"
					maxlength="500"
					value={operacao?.descricao ?? ''}
					class={CAMPO}
				/>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="min-w-0">
					<label for="f_ini" class="block text-sm font-medium mb-1">Início do ciclo</label>
					<input
						id="f_ini"
						name="data_inicio"
						type="date"
						value={operacao?.data_inicio ?? ''}
						class={CAMPO}
					/>
				</div>
				<div class="min-w-0">
					<label for="f_fim" class="block text-sm font-medium mb-1">Fim do ciclo</label>
					<input
						id="f_fim"
						name="data_fim"
						type="date"
						value={operacao?.data_fim ?? ''}
						class={CAMPO}
					/>
				</div>
			</div>
		</section>

		<!-- 2. Tipos de equipe (governa o que aparece nas vagas, abaixo) -->
		<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-3">
			<h3 class="text-base font-semibold">Tipos de equipe</h3>
			<p class="text-2xs text-surface-600 dark:text-surface-400">
				A operação só oferece os tipos marcados, e terá um formulário de produtividade para cada um.
			</p>
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="usa_operacional"
					bind:checked={usaOperacional}
					class="checkbox"
				/>
				Operacional
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" name="usa_seint" bind:checked={usaSeint} class="checkbox" />
				Inteligência (SEINT)
			</label>
			{#if editando}
				<p class="text-2xs text-surface-600 dark:text-surface-400">
					Desmarcar um tipo não mexe nas escalas já montadas — só impede novas equipes daquele tipo.
				</p>
			{/if}

			{#if !editando}
				<div class="min-w-0 pt-2 border-t border-surface-200/70 dark:border-white/10">
					<label for="f_base" class="block text-sm font-medium mb-1 mt-3">
						Basear o formulário em
					</label>
					<select id="f_base" name="basear_em" class={CAMPO}>
						<option value="">Começar em branco (formulário padrão)</option>
						{#each baseaveis as op (op.id)}
							<option value={op.id}>{op.nome}</option>
						{/each}
					</select>
					<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
						Copia as perguntas da operação escolhida para editar a partir delas, em vez de montar o
						formulário do zero. Só os tipos de equipe marcados acima são copiados.
					</p>
				</div>
			{/if}
		</section>

		<!-- 3. Configuração de escala -->
		<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-4">
			<div>
				<h3 class="text-base font-semibold">Configuração de escala</h3>
				<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
					Vagas e horários valem para o que for criado <strong>depois</strong> — não redimensiona escala
					em andamento.
				</p>
			</div>

			<div
				class="rounded-xl border border-primary-500/25 bg-primary-500/5 dark:bg-primary-500/10 p-3 text-2xs text-surface-700 dark:text-surface-300"
			>
				<strong>Campo vazio herda o padrão do sistema.</strong> O valor cinza dentro do campo é o
				que vale se você não escrever nada. Zero não é vazio: <code>0</code> significa “esta equipe não
				tem essa vaga”.
			</div>

			{#if usaOperacional}
				<div class={BLOCO}>
					<p class="text-sm font-semibold">Vagas padrão — equipe operacional</p>
					<div class="flex flex-wrap items-center gap-3 sm:gap-4">
						<div class="flex items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400 w-8" for="op_dpc"
								>DPC</label
							>
							<input
								id="op_dpc"
								name="op_dpc"
								type="number"
								min="0"
								max="999"
								placeholder={String(herdado.vagas.operacional.dpc)}
								value={ouVazio(operacao?.vagas_operacional_dpc)}
								class={CAMPO_NUM}
							/>
						</div>
						<div class="flex items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400 w-8" for="op_oip"
								>OIP</label
							>
							<input
								id="op_oip"
								name="op_oip"
								type="number"
								min="0"
								max="999"
								placeholder={String(herdado.vagas.operacional.oip)}
								value={ouVazio(operacao?.vagas_operacional_oip)}
								class={CAMPO_NUM}
							/>
						</div>
					</div>
				</div>
			{/if}

			{#if usaSeint}
				<div class={BLOCO}>
					<p class="text-sm font-semibold">Vagas padrão — equipe de inteligência (SEINT)</p>
					<div class="flex flex-wrap items-center gap-3 sm:gap-4">
						<div class="flex items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400 w-8" for="seint_dpc"
								>DPC</label
							>
							<input
								id="seint_dpc"
								name="seint_dpc"
								type="number"
								min="0"
								max="999"
								placeholder={String(herdado.vagas.seint.dpc)}
								value={ouVazio(operacao?.vagas_seint_dpc)}
								class={CAMPO_NUM}
							/>
						</div>
						<div class="flex items-center gap-2">
							<label class="text-sm text-surface-600 dark:text-surface-400 w-8" for="seint_oip"
								>OIP</label
							>
							<input
								id="seint_oip"
								name="seint_oip"
								type="number"
								min="0"
								max="999"
								placeholder={String(herdado.vagas.seint.oip)}
								value={ouVazio(operacao?.vagas_seint_oip)}
								class={CAMPO_NUM}
							/>
						</div>
					</div>
				</div>
			{/if}

			<div class={BLOCO}>
				<p class="text-sm font-semibold">Horário padrão das escalas</p>
				<div class="flex flex-wrap items-center gap-3 sm:gap-4">
					<div class="flex min-w-0 items-center gap-2">
						<label
							class="shrink-0 text-sm text-surface-600 dark:text-surface-400"
							for="hora_entrada">Entrada</label
						>
						<input
							id="hora_entrada"
							name="hora_entrada"
							type="text"
							placeholder={herdado.horaEntrada}
							value={ouVazio(operacao?.hora_entrada_padrao)}
							class={CAMPO_NUM}
						/>
					</div>
					<div class="flex min-w-0 items-center gap-2">
						<label class="shrink-0 text-sm text-surface-600 dark:text-surface-400" for="hora_saida"
							>Saída</label
						>
						<input
							id="hora_saida"
							name="hora_saida"
							type="text"
							placeholder={herdado.horaSaida}
							value={ouVazio(operacao?.hora_saida_padrao)}
							class={CAMPO_NUM}
						/>
					</div>
				</div>
			</div>
		</section>

		<!-- 4. Textos do PDF de extra -->
		<section class="card-elevated min-w-0 rounded-2xl p-5 sm:p-6 space-y-4">
			<div>
				<h3 class="text-base font-semibold">Texto “Breve relatório”</h3>
				<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
					Vai nos PDFs de extra desta operação. Diferente das vagas, este texto é lido na hora de
					gerar o PDF — vale também para escalas já criadas que ainda não foram assinadas.
				</p>
			</div>

			<div class="min-w-0">
				<label for="breve_tit" class="block text-sm font-medium mb-1">Título (rótulo)</label>
				<input
					id="breve_tit"
					name="breve_titulo"
					type="text"
					maxlength={MAX_BREVE_TITULO}
					placeholder={herdado.breveTitulo}
					value={ouVazio(operacao?.breve_relatorio_titulo)}
					class={CAMPO}
				/>
			</div>

			<div class="min-w-0">
				<label for="breve_sec" class="block text-sm font-medium mb-1">
					Parágrafo — extra por <strong>seccional</strong>
				</label>
				<textarea
					id="breve_sec"
					name="breve_texto_seccional"
					rows="4"
					maxlength={MAX_BREVE_PARAGRAFO}
					placeholder={herdado.breveTextoSeccional}
					class="{CAMPO} min-h-[110px] resize-y break-words"
					>{ouVazio(operacao?.breve_relatorio_texto_seccional)}</textarea
				>
			</div>

			<div class="min-w-0">
				<label for="breve_sup" class="block text-sm font-medium mb-1">
					Parágrafo — extra de <strong>supervisão</strong>
				</label>
				<textarea
					id="breve_sup"
					name="breve_texto_supervisao"
					rows="4"
					maxlength={MAX_BREVE_PARAGRAFO}
					placeholder={herdado.breveTextoSupervisao}
					class="{CAMPO} min-h-[110px] resize-y break-words"
					>{ouVazio(operacao?.breve_relatorio_texto_supervisao)}</textarea
				>
			</div>
		</section>

		<div class="flex justify-end gap-2 pb-2">
			<button
				type="button"
				class="btn preset-outlined-surface-500 px-4 py-2.5 rounded-xl"
				onclick={aoVoltar}
			>
				Cancelar
			</button>
			<button
				type="submit"
				class="btn preset-filled-primary-500 px-6 py-2.5 rounded-xl font-semibold"
				disabled={loading.active}
			>
				{editando ? 'Salvar operação' : 'Criar operação'}
			</button>
		</div>
	</form>
</div>
