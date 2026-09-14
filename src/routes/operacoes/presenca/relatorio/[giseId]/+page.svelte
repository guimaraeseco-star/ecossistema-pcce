<script lang="ts">
	/**
	 * Wizard do relatório de produtividade. Uma ETAPA por tela, na divisão que o
	 * Admin Geral fez no editor (`agruparPorEtapa` é a regra, compartilhada com
	 * ele — o admin vê exatamente o agrupamento que sai aqui).
	 *
	 * As perguntas em si continuam sendo do `RelatorioProdutividade`: este arquivo
	 * só decide QUAIS mostrar de cada vez. As respostas vivem num blob único no
	 * nível da página, então trocar de etapa não desmonta nada de valor — o que
	 * some da tela continua no `respostas`.
	 *
	 * ## Rascunho local
	 *
	 * O preenchimento é longo e o policial costuma estar no celular, em serviço.
	 * Perder tudo por um toque errado ou por a aba morrer em segundo plano é o
	 * pior caso desta tela, então o blob vai para o `localStorage` a cada pausa
	 * de digitação.
	 *
	 * A regra de restauração evita a única forma de o autosave causar dano —
	 * sobrescrever silenciosamente o que a equipe já entregou:
	 *
	 * - **sem resposta no servidor** → o rascunho é o único dado que existe;
	 *   restaura sozinho e avisa;
	 * - **com resposta no servidor** → o servidor manda, e o rascunho vira uma
	 *   OFERTA (banner com botão). O relatório é da equipe: o rascunho pode ser de
	 *   antes de um colega ter enviado a versão boa.
	 *
	 * Repare que a decisão não compara relógios. Seria natural "restaurar se o
	 * rascunho for mais novo", mas os carimbos do servidor são hora local gravada
	 * como texto (`datetime('now','-3 hours')`) e o do navegador é do relógio do
	 * aparelho — comparar os dois é a troca local↔UTC que este projeto já pagou
	 * caro em outros lugares.
	 */
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { agruparPorEtapa, type EtapaFormulario } from '$lib/gise/etapas-formulario';
	import { fmtDate } from '$lib/gise/formatters';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import Spinner from '$lib/components/Spinner.svelte';
	import RodapeAcoes from '$lib/components/RodapeAcoes.svelte';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import RelatorioProdutividade from './_components/RelatorioProdutividade.svelte';
	import type { PageProps } from './$types';
	import type { ActionResult } from '@sveltejs/kit';

	const { data }: PageProps = $props();

	/**
	 * Retorno para a tela de presença, com a aba de filtro de onde o policial
	 * veio. O `voltarUrl` do servidor sempre traz ao menos `?giseId=`, então o
	 * `&` é seguro.
	 */
	const voltarUrl = $derived.by(() => {
		const status = page.url.searchParams.get('status');
		return status ? `${data.voltarUrl}&status=${status}` : data.voltarUrl;
	});

	/**
	 * `action={acaoSalvar}` SUBSTITUI a query string inteira — o `equipeId`
	 * da URL não chega ao POST sozinho. Vai aqui de novo, e do valor que o
	 * servidor resolveu (não do que veio na URL), que é quem desempata policial em
	 * duas equipes da mesma GISE.
	 */
	const acaoSalvar = $derived(
		`?/salvarResposta${data.equipeId ? `&equipeId=${data.equipeId}` : ''}`
	);

	const etapas = $derived(agruparPorEtapa(data.modelo));
	let indiceEtapa = $state(0);

	/**
	 * Valores iniciais que a UNIDADE ainda não informou (o servidor resolve quais
	 * — ver `basesPendentes` no `load`).
	 *
	 * O caminho normal é a aba **Dados base**, preenchida pelo admin da unidade.
	 * Este campo é o escape de quando isso não aconteceu: sem o valor inicial, o
	 * indicador percentual fica sem denominador e a meta daquela unidade não pode
	 * ser calculada.
	 */
	const linhasBase = $state<Record<string, string>>({});
	const linhasBaseJson = $derived(JSON.stringify(linhasBase));

	/** Todas as `key` de uma etapa, filhos inclusive — o indicador pode ser um "se Sim, quantos?". */
	function chavesDaEtapa(etapa: EtapaFormulario): string[] {
		const chaves: string[] = [];
		function andar(lista: typeof etapa.perguntas) {
			for (const p of lista) {
				chaves.push(p.key);
				if (p.filhos?.length) andar(p.filhos);
			}
		}
		andar(etapa.perguntas);
		return chaves;
	}

	/**
	 * As bases pendentes que pertencem à etapa exibida — é o "no campo da
	 * pergunta" do pedido, cada valor inicial junto da pergunta que o usa.
	 *
	 * As órfãs (indicador cuja pergunta não está em etapa nenhuma visível, caso de
	 * modelo editado entre uma visita e outra) caem na ÚLTIMA etapa, para não
	 * sumirem sem serem pedidas.
	 */
	const basesDaEtapa = $derived.by(() => {
		const etapa = etapas[Math.min(indiceEtapa, Math.max(0, etapas.length - 1))];
		if (!etapa) return [];
		const chaves = chavesDaEtapa(etapa);
		const daEtapa = data.basesPendentes.filter((b) => chaves.includes(b.key));
		if (indiceEtapa < etapas.length - 1) return daEtapa;

		const cobertas = etapas.flatMap((e) => chavesDaEtapa(e));
		const orfas = data.basesPendentes.filter((b) => !cobertas.includes(b.key));
		return [...daEtapa, ...orfas];
	});
	/** Clamp, e não índice cru: o modelo pode encolher entre navegações. */
	const etapaAtual = $derived(etapas[Math.min(indiceEtapa, Math.max(0, etapas.length - 1))]);
	const naUltima = $derived(indiceEtapa >= etapas.length - 1);
	const jaEntregue = $derived(!!data.respostaEnviadaEm);

	/**
	 * Cópia local do blob: é este objeto que o formulário edita e que é enviado.
	 *
	 * Os dois `state_referenced_locally` abaixo são de propósito — queremos o
	 * INSTANTÂNEO da entrada, não uma cópia que se refaz a cada `invalidate`.
	 * Reagir ao `data` aqui apagaria o que o policial acabou de digitar.
	 */
	// svelte-ignore state_referenced_locally
	let respostas = $state<Record<string, unknown>>(structuredClone(data.respostas ?? {}));
	const respostasJson = $derived(JSON.stringify(respostas));
	/** Estado do blob como veio do servidor — referência para "houve mudança?". */
	// svelte-ignore state_referenced_locally
	const jsonDoServidor = JSON.stringify(data.respostas ?? {});

	/**
	 * Uma chave por (escala, equipe, policial): aparelho compartilhado não mistura
	 * rascunho de gente diferente, e o mesmo policial em duas GISEs não sobrescreve
	 * um com o outro.
	 */
	const chaveRascunho = $derived(
		`gise-relatorio:${data.giseId}:${data.equipeId ?? 0}:${page.data.usuario?.id ?? 0}`
	);

	type Rascunho = { salvoEm: string; respostas: Record<string, unknown> };

	/** "14:32" do último autosave, ou `null` enquanto nada foi gravado. */
	let rascunhoSalvoEm = $state<string | null>(null);
	/** Rascunho encontrado que NÃO foi aplicado — vira a oferta do banner. */
	let rascunhoOferecido = $state<Rascunho | null>(null);
	/** Guarda o autosave até a tentativa de restauração terminar. */
	let restauracaoResolvida = $state(false);
	/**
	 * Trava o autosave depois da entrega. Sem isto, quem digita e clica em enviar
	 * dentro dos 800ms do debounce deixa um timer pendente que REGRAVA o rascunho
	 * logo depois de ele ser apagado — e a visita seguinte oferece uma versão
	 * velha de algo que já foi entregue. Marcar aqui reexecuta o efeito, e é a
	 * limpeza dele que cancela o timer.
	 */
	let entregue = $state(false);
	let enviando = $state(false);

	function lerRascunho(): Rascunho | null {
		try {
			const bruto = localStorage.getItem(chaveRascunho);
			if (!bruto) return null;
			const r = JSON.parse(bruto) as Rascunho;
			return r && typeof r === 'object' && r.respostas ? r : null;
		} catch {
			return null;
		}
	}

	function descartarRascunho() {
		try {
			localStorage.removeItem(chaveRascunho);
		} catch {
			// Sem localStorage não há rascunho para descartar.
		}
		rascunhoOferecido = null;
		rascunhoSalvoEm = null;
	}

	// Restauração — uma vez, na entrada da tela (ver o cabeçalho para a regra).
	$effect(() => {
		if (restauracaoResolvida) return;
		const rascunho = lerRascunho();
		if (rascunho) {
			if (jaEntregue) {
				rascunhoOferecido = rascunho;
			} else {
				respostas = rascunho.respostas;
				rascunhoSalvoEm = rascunho.salvoEm;
				toaster.success({
					title: 'Rascunho restaurado',
					description: `Recuperamos o que você preencheu às ${rascunho.salvoEm}.`
				});
			}
		}
		restauracaoResolvida = true;
	});

	// Autosave com pausa de 800ms — grava quando a digitação para, não a cada tecla.
	$effect(() => {
		const json = respostasJson;
		if (!restauracaoResolvida || entregue) return;
		if (json === jsonDoServidor) return;
		const timer = setTimeout(() => {
			const salvoEm = new Date().toLocaleTimeString('pt-BR', {
				hour: '2-digit',
				minute: '2-digit'
			});
			try {
				localStorage.setItem(
					chaveRascunho,
					JSON.stringify({ salvoEm, respostas: JSON.parse(json) })
				);
				rascunhoSalvoEm = salvoEm;
			} catch {
				// Cota estourada ou modo privado: o autosave é conveniência e não pode
				// derrubar o preenchimento em andamento.
			}
		}, 800);
		return () => clearTimeout(timer);
	});

	function aplicarRascunhoOferecido() {
		if (!rascunhoOferecido) return;
		respostas = rascunhoOferecido.respostas;
		rascunhoSalvoEm = rascunhoOferecido.salvoEm;
		rascunhoOferecido = null;
	}

	function irPara(i: number) {
		indiceEtapa = Math.max(0, Math.min(i, etapas.length - 1));
		// A etapa nova começa do topo — sem isto o usuário cai no meio dela, na
		// altura de rolagem em que estava na anterior.
		if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	/** Etapa com ao menos uma resposta preenchida — o ✓ do navegador de etapas. */
	function etapaPreenchida(etapa: EtapaFormulario): boolean {
		return etapa.perguntas.some((p) => {
			const v = respostas[p.key];
			return v !== undefined && v !== null && v !== '';
		});
	}

	function handleEnviar() {
		enviando = true;
		loading.show('Enviando relatório de produtividade...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			enviando = false;
			if (result.type === 'success') {
				// Entregue: o rascunho já cumpriu o papel dele e sair com ele no disco
				// faria a próxima visita oferecer uma versão velha.
				entregue = true;
				descartarRascunho();
				toaster.success({ title: 'Relatório enviado com sucesso' });
				await goto(voltarUrl, { invalidateAll: true });
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.error({ title: String(d?.error || 'Erro ao enviar relatório') });
			}
		};
	}
</script>

<svelte:head>
	<title>Relatório de Produtividade · {fmtDate(data.dataInicio)}</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0 space-y-3">
			<BotaoVoltar href={voltarUrl} />
			<div>
				<h1 class="text-xl font-black uppercase tracking-tight sm:text-2xl">
					Relatório de Produtividade
				</h1>
				<p class="text-sm text-surface-600 dark:text-surface-400">
					{data.seccionalNome} · plantão de {fmtDate(data.dataInicio)}
				</p>
			</div>
		</div>
		{#if jaEntregue}
			<span class="badge preset-filled-success-500 text-3xs font-black uppercase tracking-wider">
				Entregue
			</span>
		{/if}
	</div>

	{#if rascunhoOferecido}
		<!-- Só aparece quando já existe resposta no servidor: aí a escolha é do
		     policial, não nossa (ver o cabeçalho). -->
		<div
			class="flex flex-col gap-3 rounded-2xl border border-warning-500/30 bg-warning-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<p class="text-sm text-surface-700 dark:text-surface-200">
				Há um <strong>rascunho salvo neste aparelho</strong> às {rascunhoOferecido.salvoEm}. A tela
				mostra o relatório já entregue pela equipe.
			</p>
			<div class="flex shrink-0 flex-col gap-2 xs:flex-row">
				<button
					type="button"
					class="btn btn-sm preset-outlined-surface-500 w-full xs:w-auto"
					onclick={descartarRascunho}
				>
					Descartar
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-warning-500 w-full xs:w-auto"
					onclick={aplicarRascunhoOferecido}
				>
					Usar rascunho
				</button>
			</div>
		</div>
	{/if}

	<!--
		Navegador de etapas. Uma lista só, que vira coluna no desktop (`lg:`) e,
		no celular, mostra APENAS a etapa anterior (à esquerda) e a atual (à
		direita) — duas marcações fariam duas coisas para manter iguais.
		No desktop fica `sticky`, então a divisão do formulário está sempre à
		vista enquanto se responde.

		No celular as demais são escondidas com `hidden`, e não removidas do
		`{#each}`: assim a lista continua sendo a mesma nos dois tamanhos, e o
		`irPara` de qualquer etapa segue existindo para quem tem tela grande.
		Era uma faixa rolável com todas — no celular, uma barra que rola dentro
		de uma página que também rola é fácil de não perceber que existe.

		`justify-end` (e não `justify-between`) é o que segura a etapa atual
		SEMPRE encostada à direita, inclusive na primeira, quando não há anterior
		e ela é o único item visível. Se a posição da atual mudasse entre a 1ª e a
		2ª etapa, o olho teria de reencontrá-la a cada avanço.
	-->
	<div class="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
		<nav aria-label="Etapas do relatório" class="mb-5 lg:mb-0">
			<ol class="flex justify-end gap-2 lg:sticky lg:top-6 lg:flex-col lg:justify-start lg:gap-1">
				{#each etapas as etapa, i (etapa.chave)}
					{@const atual = i === indiceEtapa}
					{@const anterior = i === indiceEtapa - 1}
					{@const preenchida = etapaPreenchida(etapa)}
					<li
						class="min-w-0 {atual || anterior ? '' : 'hidden lg:block'} {anterior
							? 'mr-auto lg:mr-0'
							: ''}"
					>
						<button
							type="button"
							onclick={() => irPara(i)}
							aria-current={atual ? 'step' : undefined}
							class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors {atual
								? 'bg-primary-500/10 text-primary-700 dark:text-primary-300'
								: 'text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800'}"
						>
							<span
								class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-3xs font-black {preenchida
									? 'bg-success-500 text-white'
									: atual
										? 'bg-primary-500 text-white'
										: 'bg-surface-200 text-surface-600 dark:bg-surface-800 dark:text-surface-400'}"
							>
								{#if preenchida}✓{:else}{i + 1}{/if}
							</span>
							<!-- `truncate` no celular: com dois nomes longos lado a lado, sem
							     teto, a barra voltaria a empurrar a página para os lados. -->
							<span class="truncate text-xs font-bold lg:overflow-visible lg:whitespace-normal">
								{etapa.titulo}
							</span>
						</button>
					</li>
				{/each}
			</ol>
		</nav>

		<div class="min-w-0 space-y-5">
			{#if etapaAtual}
				<div
					class="flex items-baseline justify-between gap-3 border-b border-surface-200 pb-3 dark:border-surface-800"
				>
					<h2 class="min-w-0 text-lg font-bold">{etapaAtual.titulo}</h2>
					<span
						class="shrink-0 whitespace-nowrap text-3xs font-bold uppercase tracking-widest text-surface-600 dark:text-surface-400"
					>
						Etapa {indiceEtapa + 1} de {etapas.length}
					</span>
				</div>

				<!-- `max-w-3xl`: largura de LEITURA. O formulário é uma coluna de
				     perguntas curtas — mais largo que isso e sobra vazio à direita de
				     cada campo, que foi exatamente a queixa do layout anterior. -->
				<div class="max-w-3xl">
					<RelatorioProdutividade modelo={etapaAtual.perguntas} bind:respostas />
				</div>

				{#if basesDaEtapa.length > 0}
					<!-- Valor inicial pedido AQUI porque a unidade não informou em Dados
					     base. É o denominador da meta — sem ele o indicador não tem o que
					     comparar. -->
					<div
						class="max-w-3xl mt-6 rounded-2xl border border-dashed border-warning-500/50 bg-warning-500/5 p-4 sm:p-5 space-y-4"
					>
						<div class="flex items-start gap-2">
							<TriangleAlert
								class="mt-0.5 h-4 w-4 shrink-0 text-warning-600 dark:text-warning-400"
								aria-hidden="true"
							/>
							<div class="min-w-0">
								<p class="text-sm font-bold">Valores iniciais para comparação de metas</p>
								<p class="text-2xs text-surface-600 dark:text-surface-400 mt-0.5">
									A sua unidade ainda não registrou o ponto de partida destes indicadores. Informe o
									valor de ANTES da operação — é com ele que o resultado será comparado.
								</p>
							</div>
						</div>

						{#each basesDaEtapa as base (base.key)}
							<div class="space-y-1">
								<label for="base-{base.key}" class="block text-sm font-medium">
									{base.rotulo}
								</label>
								<div class="flex items-center gap-2">
									<input
										id="base-{base.key}"
										type="number"
										min="0"
										step="any"
										inputmode="decimal"
										bind:value={linhasBase[base.key]}
										class="w-full min-w-0 rounded-xl border border-surface-300 bg-white px-3 py-2 text-sm dark:border-surface-600 dark:bg-surface-900"
									/>
									{#if base.unidade}
										<span
											class="shrink-0 whitespace-nowrap text-2xs text-surface-600 dark:text-surface-400"
										>
											{base.unidade}
										</span>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{:else}
				<p class="text-sm text-surface-600 dark:text-surface-400">
					Nenhuma pergunta configurada para este formulário.
				</p>
			{/if}
		</div>
	</div>
</div>

<!--
	Rodapé fixo: com o formulário fatiado, avançar/voltar é a ação mais frequente
	da tela e não pode depender de rolar até o fim da etapa.
-->
<RodapeAcoes>
	{#snippet status()}
		{#if rascunhoSalvoEm}
			Rascunho salvo às {rascunhoSalvoEm} neste aparelho
		{:else}
			O preenchimento é salvo neste aparelho enquanto você responde
		{/if}
	{/snippet}

	{#snippet acoes()}
		<!-- "Anterior", e não "Voltar": o `BotaoVoltar` do topo já é o Voltar
		     desta tela, e dois botões com a mesma palavra fazendo coisas
		     diferentes na mesma tela é troca garantida. -->
		<button
			type="button"
			class="btn btn-sm preset-outlined-surface-500"
			disabled={indiceEtapa === 0 || enviando}
			onclick={() => irPara(indiceEtapa - 1)}
		>
			Anterior
		</button>

		{#if !naUltima}
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 px-6"
				onclick={() => irPara(indiceEtapa + 1)}
			>
				Avançar
			</button>
		{/if}

		<!-- Fora da última etapa o botão de gravar só aparece na RETIFICAÇÃO:
			     quem já entregou costuma vir corrigir um campo só, e obrigá-lo a
			     percorrer o resto do formulário para achar o "salvar" seria uma
			     armadilha. Na primeira entrega ele fecha o fluxo, no fim. -->
		{#if naUltima || jaEntregue}
			<form method="POST" action={acaoSalvar} use:enhance={handleEnviar} class="contents">
				<input type="hidden" name="respostas" value={respostasJson} />
				<!-- O servidor decide de QUAL unidade é esta base e ignora chave que não
				     seja indicador do modelo — aqui vai só o que foi digitado. -->
				<input type="hidden" name="linhasBase" value={linhasBaseJson} />
				<button
					type="submit"
					class="btn btn-sm px-6 {naUltima
						? 'preset-filled-primary-500'
						: 'preset-outlined-surface-500'}"
					disabled={enviando}
				>
					{#if enviando}
						<Spinner size="sm" />
					{/if}
					{jaEntregue ? 'Salvar alterações' : 'Finalizar entrega'}
				</button>
			</form>
		{/if}
	{/snippet}
</RodapeAcoes>
