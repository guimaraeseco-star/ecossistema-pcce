<script lang="ts">
	/**
	 * Formulário de PRODUTIVIDADE da GISE — renderiza o modelo de perguntas
	 * (árvore, vinda do banco) e escreve as respostas no blob `respostas`.
	 *
	 * É o componente com mais ramificação da UI porque cada `tipo` de pergunta é
	 * um widget diferente: sim/não, número, texto, drogas com peso e unidade,
	 * armas por tipo, e os "complexos" que abrem uma LISTA de itens (mandados,
	 * celulares, operações…).
	 *
	 * As tabelas que evitam a cadeia de `if` por tipo moram em
	 * `$lib/gise/tipos-pergunta` — `chavesLista` (onde cada tipo grava no blob) e
	 * `ITEM_PADRAO` (a forma de um item vazio). Ficam LÁ, e não aqui, porque a
	 * expansão do relatório em `db/gise/respostas.ts` precisa das mesmas
	 * respostas: escrever numa chave e ler de outra faz o detalhe sumir do PDF
	 * assinado sem erro nenhum.
	 *
	 * Responder "Sim" já cria o primeiro item da lista (`handleSimNao`), porque
	 * "sim, houve" sem nenhum item nunca é a resposta final — e o policial que
	 * marcou Sim e não preencheu nada teria de descobrir sozinho que faltava
	 * clicar em "adicionar".
	 *
	 * Trocar para "Não" NÃO apaga o que já foi digitado: o dado fica no blob e é
	 * a leitura que o ignora (detalhe só expande sob um "Sim"). Assim, marcar
	 * "Não" por engano e voltar atrás não custa o preenchimento.
	 */
	import type { GiseModeloPerguntaConfig } from '$lib/types';
	import {
		ITEM_PADRAO,
		TIPOS_COM_FILHOS,
		TIPOS_COM_LISTA,
		TIPO_LISTA_REUTILIZAVEL,
		TIPO_PROPORCAO,
		chavesLista,
		chavesListaComFallback,
		chavesProporcao
	} from '$lib/gise/tipos-pergunta';

	/** Número para exibição; `null` quando o campo está vazio ou não é numérico. */
	function num(v: unknown): number | null {
		if (v === '' || v == null) return null;
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}

	let { respostas = $bindable(), modelo = [] } = $props<{
		respostas: Record<string, unknown>;
		modelo: GiseModeloPerguntaConfig[];
	}>();

	function handleSimNao(key: string, val: string, q: GiseModeloPerguntaConfig) {
		respostas[key] = val;
		// Inicializações automáticas para tipos sistêmicos
		if (val === 'Sim') {
			const chaves = chavesLista(q);
			if (chaves && !respostas[chaves.qtd]) {
				respostas[chaves.qtd] = 1;
				respostas[chaves.lista] = [{ ...ITEM_PADRAO[q.tipo] }];
			}
			if (
				q.tipo === 'armas_complex' &&
				(!respostas.armas_selecionadas || respostas.armas_selecionadas.length === 0)
			) {
				respostas.armas_selecionadas = [];
				respostas.armas_detalhe = {};
			}
			if (
				q.tipo === 'drogas_complex' &&
				(!respostas.drogas_selecionadas || respostas.drogas_selecionadas.length === 0)
			) {
				respostas.drogas_selecionadas = [];
				respostas.drogas_detalhe = {};
			}
		}
	}

	// Inicialização Automática para tipos "Pura"
	$effect(() => {
		function explore(qs: GiseModeloPerguntaConfig[]) {
			qs.forEach((q) => {
				if (q.tipo === 'operacoes_seint_pura') {
					if (respostas.operacoes_seint_qtd === undefined) {
						respostas.operacoes_seint_qtd = 1;
						if (!respostas.operacoes_seint_lista)
							respostas.operacoes_seint_lista = [{ nome: '', delegacia: '' }];
					}
				}
				if (q.filhos) explore(q.filhos);
			});
		}
		explore(modelo);
	});
</script>

<div>
	<!--
		Par de botões Sim/Não — repetia-se em 4 tipos de pergunta.

		`.btn` + presets do tema em vez do botão desenhado à mão que havia aqui
		(`border-2`, `font-black`, sombra própria): entra na escala de botão do
		projeto e herda de graça o feedback tátil global de `.btn` (README §10).
		`max-w-xs` porque os dois são `flex-1` — sem teto viravam dois retângulos
		de ~500px cada no desktop.
	-->
	{#snippet botoesSimNao(q: GiseModeloPerguntaConfig)}
		<div class="flex gap-2 sm:gap-3 w-full max-w-xs">
			{#each ['Sim', 'Não'] as opt (opt)}
				<button
					type="button"
					class="btn flex-1 font-bold {respostas[q.key] === opt
						? 'preset-filled-primary-500'
						: 'preset-outlined-surface-500'}"
					aria-pressed={respostas[q.key] === opt}
					onclick={() => handleSimNao(q.key, opt, q)}
				>
					{opt}
				</button>
			{/each}
		</div>
	{/snippet}

	<!-- Célula "label + input texto" das listagens detalhadas (~18 ocorrências) -->
	{#snippet campoTexto(
		id: string,
		rotulo: string,
		placeholder: string,
		item: Record<string, string>,
		campo: string
	)}
		<div class="space-y-1">
			<label class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase" for={id}
				>{rotulo}</label
			>
			<input {id} type="text" {placeholder} class="input text-xs" bind:value={item[campo]} />
		</div>
	{/snippet}

	<!--
		Um widget por `tipo` de pergunta, e o `{:else}` final é a rede: tipo
		DESCONHECIDO (modelo mais novo que este código, ou digitado à mão) vira
		campo de texto livre gravando na própria `key` da pergunta. Degrada em vez
		de sumir — a resposta continua sendo coletada e guardada no lugar certo.

		`renderCampo` chama a si mesmo para os `filhos`, então a profundidade é a
		do modelo, não fixa aqui; `level` controla só o recuo. Os filhos só são
		renderizados sob um "Sim" (exceto `operacoes_seint_pura`, que não tem pai
		sim/não) — a MESMA regra que a leitura aplica em `db/gise/respostas.ts`,
		e as duas precisam continuar iguais.
	-->
	{#snippet renderCampo(q: GiseModeloPerguntaConfig, level = 0)}
		{@const chavesTipo = chavesListaComFallback(q)}
		{@const resKey = chavesTipo.lista}
		{@const resQtdKey = chavesTipo.qtd}

		<div
			class="nested-card card p-3 sm:p-4 md:p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm space-y-4 animate-in fade-in slide-in-from-top-4 duration-500"
			style="--level: {level}"
		>
			<div class="space-y-1">
				<label
					for="q-{q.id}"
					class="block text-base font-semibold leading-snug text-surface-900 dark:text-surface-50"
				>
					{q.texto}
				</label>
			</div>

			<div class="mt-2">
				{#if q.tipo === 'vtr_placa'}
					<input
						id="q-{q.id}"
						type="text"
						placeholder="Ex: XXX-0000"
						class="input w-full md:w-64 text-sm font-bold uppercase tracking-widest"
						bind:value={respostas[q.key]}
					/>
				{:else if q.tipo === 'numero'}
					<input
						id="q-{q.id}"
						type="number"
						placeholder="0"
						class="input w-full md:w-48 text-sm font-bold"
						bind:value={respostas[q.key]}
					/>
				{:else if q.tipo === TIPO_PROPORCAO}
					<!-- Cobertura: dois números e a razão entre eles, calculada na tela.
					     A porcentagem NÃO é gravada — ela é derivada, e guardar um
					     derivado no blob criaria uma segunda verdade que envelhece
					     assim que um dos dois campos for corrigido. -->
					{@const chavesP = chavesProporcao(q)!}
					{@const total = num(respostas[chavesP.total])}
					{@const parte = num(respostas[chavesP.parte])}
					<div class="space-y-3">
						<div class="flex flex-wrap items-end gap-4">
							<label class="block">
								<span
									class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block"
									>{q.subtexto_total || 'Total existente'}</span
								>
								<input
									id="q-{q.id}"
									type="number"
									min="0"
									placeholder="0"
									class="input w-32 text-sm font-bold"
									bind:value={respostas[chavesP.total]}
								/>
							</label>
							<label class="block">
								<span
									class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block"
									>{q.subtexto_parte || 'Atendidas'}</span
								>
								<input
									type="number"
									min="0"
									placeholder="0"
									class="input w-32 text-sm font-bold"
									bind:value={respostas[chavesP.parte]}
								/>
							</label>
						</div>

						{#if total != null && parte != null}
							{#if total <= 0}
								<p class="text-2xs text-surface-600 dark:text-surface-400">
									Sem ocorrências no período — não há cobertura a calcular.
								</p>
							{:else}
								<p class="text-sm font-bold">
									Cobertura:
									<span class="text-primary-600 dark:text-primary-400">
										{((parte / total) * 100).toLocaleString('pt-BR', {
											maximumFractionDigits: 1
										})}%
									</span>
									<span class="font-normal text-surface-600 dark:text-surface-400">
										({parte} de {total})
									</span>
								</p>
								{#if parte > total}
									<p class="text-2xs font-semibold text-warning-700 dark:text-warning-400">
										A parte atendida está maior que o total — confira os dois números.
									</p>
								{/if}
							{/if}
						{/if}
					</div>
				{:else if q.tipo === 'select_99'}
					<select
						id="q-{q.id}"
						class="select w-full md:w-48 text-sm font-bold"
						bind:value={respostas[q.key]}
					>
						<option value="">Selecione</option>
						{#each Array(100) as _, i (i)}
							<option value={i}>{i}</option>
						{/each}
					</select>
				{:else if q.tipo === 'sim_nao'}
					{@render botoesSimNao(q)}
				{:else if q.tipo === 'textarea'}
					<textarea
						id="q-{q.id}"
						rows="4"
						placeholder="Descreva detalhadamente..."
						class="textarea text-sm"
						bind:value={respostas[q.key]}></textarea>
				{:else if TIPOS_COM_LISTA.includes(q.tipo)}
					{@const isPura = q.tipo === 'operacoes_seint_pura'}
					<div class="space-y-4">
						{#if !isPura}
							{@render botoesSimNao(q)}
						{/if}

						{#if respostas[q.key] === 'Sim' || (isPura && (respostas[resQtdKey] !== undefined || true))}
							<div
								class="p-3 sm:p-4 md:p-6 bg-surface-50 dark:bg-surface-950/40 rounded-3xl border border-surface-200 dark:border-surface-800 space-y-6 animate-in fade-in zoom-in-95 duration-500"
							>
								<div class="flex items-center gap-4">
									<label class="block">
										<span
											class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block"
											>{q.subtexto_qtd || 'Quantidade:'}</span
										>
										<select
											class="select w-24 text-sm font-bold"
											bind:value={respostas[resQtdKey]}
											onchange={(e) => {
												const n = Number((e.currentTarget as HTMLSelectElement).value);
												if (!respostas[resKey]) respostas[resKey] = [];
												const defaultItem = ITEM_PADRAO[q.tipo] ?? { nome: '', mandado: '' };
												respostas[resKey] = Array(n)
													.fill(0)
													.map((_, idx) => (respostas[resKey] || [])[idx] || { ...defaultItem });
											}}
										>
											{#each Array(99)
												.fill(0)
												.map((_, idx) => idx + 1) as n (n)}
												<option value={n}>{n}</option>
											{/each}
										</select>
									</label>
								</div>

								<div class="space-y-3">
									<span
										class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block"
										>{q.subtexto_lista || 'Listagem Detalhada:'}</span
									>
									{#each respostas[resKey] || [] as item, i (i)}
										{#if q.tipo === 'celulares_complex'}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-3 md:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`mod-${q.id}-${i}`,
													'Modelo',
													'Ex: iPhone 13',
													item,
													'modelo'
												)}
												{@render campoTexto(
													`proc-${q.id}-${i}`,
													'Nº proc',
													'Número',
													item,
													'n_proc'
												)}
												{@render campoTexto(
													`del-${q.id}-${i}`,
													'Delegacia',
													'Ex: 2ª DP',
													item,
													'delegacia'
												)}
												{@render campoTexto(
													`sit-${q.id}-${i}`,
													'Situação',
													'Pendente/Ok',
													item,
													'situacao'
												)}
											</div>
										{:else if q.tipo === 'analise_complex'}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`tam-${q.id}-${i}`,
													'Tam. Arquivo',
													'Ex: 256GB',
													item,
													'tamanho'
												)}
												{@render campoTexto(
													`mod-${q.id}-${i}`,
													'Modelo',
													'Ex: iPhone 13',
													item,
													'modelo'
												)}
												{@render campoTexto(
													`proc-${q.id}-${i}`,
													'Nº proc',
													'Número',
													item,
													'n_proc'
												)}
												{@render campoTexto(
													`del-${q.id}-${i}`,
													'Delegacia',
													'Ex: 2ª DP',
													item,
													'delegacia'
												)}
											</div>
										{:else if q.tipo === 'relatorios_seint_complex'}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`nrel-${q.id}-${i}`,
													'Nº Relatório',
													'Ex: 001/2026',
													item,
													'n_relat'
												)}
												<div class="space-y-1">
													<label
														class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
														for="qal-{q.id}-{i}">Qtd Alvos</label
													>
													<input
														id="qal-{q.id}-{i}"
														type="number"
														placeholder="0"
														class="input text-xs"
														bind:value={item.q_alvos}
													/>
												</div>
												{@render campoTexto(
													`proc-${q.id}-${i}`,
													'Procedimento',
													'Número',
													item,
													'proc_vinc'
												)}
												{@render campoTexto(
													`del-${q.id}-${i}`,
													'Delegacia',
													'Ex: 2ª DP',
													item,
													'delegacia'
												)}
											</div>
										{:else if q.tipo === 'foragidos_complex'}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`nom-${q.id}-${i}`,
													'Nome do Alvo',
													'Nome Completo',
													item,
													'nome'
												)}
												{@render campoTexto(
													`proc-${q.id}-${i}`,
													'Procedimento',
													'Número',
													item,
													'proc_vinc'
												)}
												{@render campoTexto(
													`del-${q.id}-${i}`,
													'Delegacia',
													'Ex: 2ª DP',
													item,
													'delegacia'
												)}
												<div class="space-y-1">
													<label
														class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
														for="res-{q.id}-{i}">Resultado</label
													>
													<select
														id="res-{q.id}-{i}"
														class="input text-xs font-bold"
														bind:value={item.resultado}
													>
														<option value="">Selecione</option>
														<option value="Positivo">Positivo</option>
														<option value="Negativo">Negativo</option>
													</select>
												</div>
											</div>
										{:else if q.tipo === 'operacoes_seint_complex' || q.tipo === 'operacoes_seint_pura'}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`nom-${q.id}-${i}`,
													'Nome da Operação',
													'Nome',
													item,
													'nome'
												)}
												{@render campoTexto(
													`del-${q.id}-${i}`,
													'Delegacia',
													'Ex: 2ª DP',
													item,
													'delegacia'
												)}
											</div>
										{:else}
											<div
												class="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30"
											>
												{@render campoTexto(
													`n-${q.id}-${i}`,
													'Nome',
													'Nome Completo',
													item,
													'nome'
												)}
												{@render campoTexto(
													`m-${q.id}-${i}`,
													q.tipo === 'prisoes_maiores' || q.tipo === TIPO_LISTA_REUTILIZAVEL
														? 'Procedimento'
														: 'Mandado/Processo',
													'Número',
													item,
													'mandado'
												)}
											</div>
										{/if}
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{:else if q.tipo === 'drogas_complex'}
					<div class="space-y-4">
						{@render botoesSimNao(q)}

						{#if respostas[q.key] === 'Sim'}
							<div
								class="p-3 sm:p-4 md:p-6 bg-surface-50 dark:bg-surface-950/40 rounded-3xl border border-surface-200 dark:border-surface-800 space-y-6 animate-in fade-in zoom-in-95 duration-500"
							>
								<div class="space-y-3">
									<span
										class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block"
										>{q.subtexto_tipo || 'Tipos de Droga Apreendidos:'}</span
									>
									<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
										{#each ['Maconha', 'Cocaína', 'Crack', 'Extase', 'LSD', 'Haxixe', 'Skunk', 'Outros'] as d (d)}
											<button
												type="button"
												class="btn btn-sm font-bold {(respostas.drogas_selecionadas || []).includes(
													d
												)
													? 'preset-filled-primary-500'
													: 'preset-outlined-surface-500'}"
												onclick={() => {
													const current = respostas.drogas_selecionadas || [];
													if (current.includes(d)) {
														respostas.drogas_selecionadas = current.filter((x: string) => x !== d);
													} else {
														respostas.drogas_selecionadas = [...current, d];
													}
												}}>{d}</button
											>
										{/each}
									</div>
								</div>

								{#if (respostas.drogas_selecionadas || []).length > 0}
									<div
										class="space-y-4 pt-2 border-t border-surface-100 dark:border-surface-800 transition-all"
									>
										<span
											class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block"
											>{q.subtexto_detalhe || 'Indique o Peso Aproximado e a Unidade:'}</span
										>
										{#each respostas.drogas_selecionadas as d (d)}
											<div
												class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 md:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm animate-in slide-in-from-left-2 duration-300"
											>
												<span
													class="text-xs font-black w-auto sm:w-24 text-surface-600 dark:text-surface-400 uppercase tracking-tight shrink-0"
													>{d}:</span
												>

												<div class="flex items-center gap-2 sm:gap-3 w-full sm:flex-1 min-w-0">
													<div class="relative w-full min-w-0 sm:flex-1 sm:max-w-[150px]">
														<input
															type="number"
															step="0.001"
															placeholder="0.000"
															class="input text-xs font-bold"
															bind:value={respostas.drogas_detalhe[d]}
														/>
													</div>

													<div
														class="flex p-1 bg-surface-100 dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700"
													>
														{#each ['g', 'kg'] as u (u)}
															<button
																type="button"
																class="px-3 py-1.5 rounded-lg text-3xs font-black uppercase transition-all {(respostas.drogas_unidade &&
																	respostas.drogas_unidade[d] === u) ||
																(!respostas.drogas_unidade?.[d] && u === 'g')
																	? 'bg-white dark:bg-surface-700 text-primary-600 shadow-sm'
																	: 'text-surface-400 hover:text-surface-600'}"
																onclick={() =>
																	((respostas.drogas_unidade = respostas.drogas_unidade || {})[d] =
																		u)}
															>
																{u}
															</button>
														{/each}
													</div>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{:else if q.tipo === 'armas_complex'}
					<div class="space-y-4">
						{@render botoesSimNao(q)}

						{#if respostas[q.key] === 'Sim'}
							<div
								class="p-3 sm:p-4 md:p-6 bg-surface-50 dark:bg-surface-950/40 rounded-3xl border border-surface-200 dark:border-surface-800 space-y-6 animate-in fade-in zoom-in-95 duration-500"
							>
								<div class="space-y-3">
									<span
										class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block"
										>{q.subtexto_tipo || 'Tipos de Armas/Munições:'}</span
									>
									<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
										{#each ['Revolver', 'Pistola', 'Arma Longa', 'Arma Branca', 'Munição', 'Outros'] as a (a)}
											<button
												type="button"
												class="btn btn-sm font-bold {(respostas.armas_selecionadas || []).includes(
													a
												)
													? 'preset-filled-primary-500'
													: 'preset-outlined-surface-500'}"
												onclick={() => {
													const current = respostas.armas_selecionadas || [];
													if (current.includes(a)) {
														respostas.armas_selecionadas = current.filter((x: string) => x !== a);
													} else {
														respostas.armas_selecionadas = [...current, a];
														if (!respostas.armas_detalhe) respostas.armas_detalhe = {};
														if (!respostas.armas_detalhe[a]) respostas.armas_detalhe[a] = 1;
													}
												}}>{a}</button
											>
										{/each}
									</div>
								</div>

								{#if (respostas.armas_selecionadas || []).length > 0}
									<div
										class="space-y-4 pt-2 border-t border-surface-100 dark:border-surface-800 transition-all"
									>
										<span
											class="text-3xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-widest block"
											>{q.subtexto_detalhe || 'Indique a Quantidade:'}</span
										>
										{#each respostas.armas_selecionadas as a (a)}
											<div
												class="flex items-center flex-wrap gap-2 sm:gap-3 p-3 md:p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm animate-in slide-in-from-left-2 duration-300"
											>
												<span
													class="text-xs font-black w-auto min-w-[4.5rem] text-surface-600 dark:text-surface-400 uppercase tracking-tight shrink-0"
													>{a}:</span
												>

												<select
													class="select flex-1 min-w-0 sm:flex-none sm:w-32 text-xs font-bold"
													bind:value={respostas.armas_detalhe[a]}
												>
													{#each Array(100) as _, i (i)}
														<option value={i}>{i}</option>
													{/each}
												</select>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{:else}
					<input
						id="q-{q.id}"
						type="text"
						placeholder="Digite aqui..."
						class="input text-sm"
						bind:value={respostas[q.key]}
					/>
				{/if}
			</div>

			<!-- RECURSIVIDADE PARA FILHOS -->
			{#if TIPOS_COM_FILHOS.includes(q.tipo) && (respostas[q.key] === 'Sim' || q.tipo === 'operacoes_seint_pura') && q.filhos && q.filhos.length > 0}
				<div class="mt-6 space-y-6 pt-6 border-l-4 border-primary-500/20">
					{#each q.filhos as filho (filho.id)}
						{@render renderCampo(filho, level + 1)}
					{/each}
				</div>
			{/if}
		</div>
	{/snippet}

	<!-- Uma pergunta por linha: o modal é estreito de propósito (largura de
	     leitura), então não há grade de colunas para gerir. -->
	<div class="space-y-4">
		{#each modelo as q (q.id)}
			{@render renderCampo(q)}
		{/each}
	</div>
</div>

<style>
	.nested-card {
		margin-left: 0;
	}
	@media (min-width: 640px) {
		.nested-card {
			margin-left: calc(var(--level, 0) * 0.5rem);
		}
	}
	@media (min-width: 768px) {
		.nested-card {
			margin-left: calc(var(--level, 0) * 0.75rem);
		}
	}
</style>
