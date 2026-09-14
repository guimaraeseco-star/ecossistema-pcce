<script lang="ts">
	/**
	 * Editor do MODELO do formulário de produtividade — a tela do Admin Geral em
	 * `/operacoes/presenca`. Um modelo por tipo de equipe (`operacional` e `seint`),
	 * gravado como JSON em `gise_modelo_formulario`.
	 *
	 * O que se edita é a estrutura das perguntas que TODO policial vai responder,
	 * então duas coisas precisam ficar claras para quem mexer aqui:
	 *
	 * - a `key` de cada pergunta é o que casa com a resposta gravada. Trocá-la
	 *   não migra nada: as respostas antigas continuam no banco com a chave velha
	 *   e simplesmente deixam de aparecer nos relatórios;
	 * - a `etapa` é o que fatia o formulário em passos para o policial. É editável
	 *   só no NÍVEL 0 porque os filhos aparecem sob o "Sim" do pai — separá-los
	 *   dele em outra etapa quebraria o gate;
	 * - "Restaurar anterior" traz de volta a versão salva ANTES da última
	 *   gravação (coluna `config_anterior`, migração 0039). Ele só CARREGA no
	 *   editor — nada é gravado até o admin clicar em Salvar, que é quando as
	 *   duas versões trocam de lugar. O `structuredClone` evita que editar
	 *   depois de restaurar mute o objeto vindo do `load`.
	 *
	 * ## A ordem dos blocos do card, que não é arbitrária
	 *
	 * Identidade da pergunta (etapa, texto, tipo) → rótulos dos campos → marcas de
	 * painel → título do card. Do que a pergunta É para o que ela VIRA: os rótulos
	 * ainda descrevem o formulário que o policial preenche, e as marcas já falam de
	 * outra tela.
	 *
	 * As marcas estavam no MEIO, entre o tipo e os rótulos, e empurravam para baixo
	 * o campo que quem monta o formulário usa toda vez, em favor de duas caixas que
	 * se marcam uma vez e não se olha mais.
	 */
	import { enhance } from '$app/forms';
	import { actionButton } from './BotoesAcao.svelte';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { loading } from '$lib/loading.svelte';
	import { agruparPorEtapa } from '$lib/gise/etapas-formulario';
	import {
		TIPOS_COM_FILHOS,
		TIPOS_COM_LISTA,
		TIPOS_LISTA_APOSENTADOS,
		TIPO_LISTA_REUTILIZAVEL,
		podeSerGrafico,
		podeDetalhar,
		exigeSimParaContar
	} from '$lib/gise/tipos-pergunta';
	import { podeSerIndicador, ehProporcao } from '$lib/gise/indicadores';
	import { formasDaMarca } from '$lib/produtividade';
	import { temAlgumaForma, tituloNoPainel } from '$lib/produtividade/apresentacao';
	import RodapeAcoes from '$lib/components/RodapeAcoes.svelte';
	import Target from '@lucide/svelte/icons/target';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import SquarePen from '@lucide/svelte/icons/square-pen';
	import { useEditorModelo } from './useEditorModelo.svelte';
	import type { GiseModeloPerguntaConfig, ResGisePageData } from '$lib/types';

	const {
		getData,
		aoSalvar,
		modeloAnteriorOperacional,
		modeloAnteriorSeint
	}: {
		getData: () => ResGisePageData;
		aoSalvar?: () => void;
		modeloAnteriorOperacional: GiseModeloPerguntaConfig[] | null;
		modeloAnteriorSeint: GiseModeloPerguntaConfig[] | null;
	} = $props();

	// O composable vive AQUI, e não na página: este componente só é renderizado
	// para o Admin Geral, então os efeitos do editor não rodam para o policial.
	//
	// As duas props entram embrulhadas em closure, e não por referência direta:
	// `{ getData, aoSalvar }` capturaria o valor do primeiro render e a troca de
	// prop não chegaria ao composable.
	const editor = useEditorModelo({
		getData: () => getData(),
		aoSalvar: () => aoSalvar?.()
	});

	/** Versão anterior do tipo em edição — `null` enquanto só houve a primeira
	 *  gravação, e é o que desabilita o botão. */
	const modeloAnterior = $derived(
		editor.configTipo === 'seint' ? modeloAnteriorSeint : modeloAnteriorOperacional
	);

	/**
	 * Prévia do fatiamento em etapas — pela MESMA função que o wizard do policial
	 * usa, então o que o admin vê aqui é o que o policial vai ver. Serve de
	 * resumo no topo e de fonte do `datalist`, que é o que evita "Viatura" e
	 * "viatura" virarem duas etapas por erro de digitação.
	 */
	const etapas = $derived(agruparPorEtapa(editor.perguntasConfig));

	/**
	 * Tipos com rótulos personalizáveis: os de lista (Quantidade + Legenda) mais
	 * drogas e armas (Lista de Tipos + Detalhamento). O de lista PURA fica de fora
	 * porque não tem par Sim/Não para rotular — `exigeSimParaContar` é quem sabe
	 * disso, e ele já responde a mesma pergunta para o painel.
	 */
	const TIPOS_COM_ROTULOS = [
		...TIPOS_COM_LISTA.filter(exigeSimParaContar),
		'drogas_complex',
		'armas_complex'
	];

	/**
	 * Arraste para reordenar (só NÍVEL 0 — filho pertence ao pai).
	 *
	 * `idArrastavel` existe por causa de um detalhe do HTML5 drag-and-drop: quem
	 * arrasta tem de ser o CARD inteiro, mas marcá-lo `draggable` fixo impede
	 * selecionar texto nos campos dentro dele. Então a alça liga o `draggable` no
	 * `mousedown` e o `dragend`/`mouseup` desliga.
	 *
	 * Arrastar sozinho não serve para toque nem para teclado, por isso as setas
	 * ↑/↓ ao lado da alça fazem a MESMA coisa e são o caminho acessível.
	 */
	let idArrastavel = $state<number | null>(null);
	let indiceArrastando = $state<number | null>(null);
	let indiceAlvo = $state<number | null>(null);

	function limparArraste() {
		idArrastavel = null;
		indiceArrastando = null;
		indiceAlvo = null;
	}

	function soltarEm(indice: number) {
		if (indiceArrastando !== null) editor.moverPergunta(indiceArrastando, indice);
		limparArraste();
	}

	let dialogRestaurarAberto = $state(false);

	function solicitarRestaurarAnterior() {
		if (!modeloAnterior) return;
		dialogRestaurarAberto = true;
	}

	function confirmarRestaurarAnterior() {
		dialogRestaurarAberto = false;
		if (!modeloAnterior) return;
		editor.perguntasConfig = structuredClone(modeloAnterior);
	}
</script>

<div class="space-y-6">
	<section class="card-elevated rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
		<!-- Título da página já diz o que é esta tela; aqui só o recorte (operação
		     + tipo) e as ações. Botões no canto superior direito do card. -->
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div class="min-w-0 space-y-3">
				<!-- Operação e tipo na mesma linha: o formulário é POR OPERAÇÃO, e
				     quais tipos aparecem depende do que ela habilita. -->
				<div class="flex flex-col gap-3 sm:flex-row sm:items-end">
					<div class="w-full sm:w-[14rem] sm:shrink-0">
						<label
							for="cfg-operacao"
							class="mb-1 block text-3xs font-semibold uppercase tracking-widest text-surface-600 dark:text-surface-400"
						>
							Operação
						</label>
						<select
							id="cfg-operacao"
							class="w-full rounded-xl border border-surface-300 bg-white px-3 py-2.5 text-sm font-bold dark:border-surface-700 dark:bg-surface-900"
							value={editor.operacaoSelecionadaId ?? ''}
							onchange={(e) => editor.trocarOperacao(Number(e.currentTarget.value))}
						>
							{#each editor.operacoes as op (op.id)}
								<option value={op.id}>{op.nome}</option>
							{/each}
						</select>
					</div>

					<div class="flex w-full gap-2 rounded-xl bg-surface-100 p-1 dark:bg-surface-800 sm:w-fit">
						{#each editor.tiposDisponiveis as tipo (tipo)}
							<button
								type="button"
								class="flex-1 rounded-lg px-4 py-2 text-xs font-bold transition-colors sm:flex-none {editor.configTipo ===
								tipo
									? 'bg-white text-primary-600 shadow dark:bg-surface-700'
									: 'text-surface-600 dark:text-surface-400'}"
								onclick={() => (editor.configTipo = tipo)}
							>
								{tipo === 'operacional' ? 'Operacional' : 'SEINT (Inteligência)'}
							</button>
						{/each}
					</div>
				</div>
				{#if editor.tiposDisponiveis.length === 1}
					<p class="text-2xs text-surface-600 dark:text-surface-400">
						Esta operação usa apenas equipe {editor.tiposDisponiveis[0] === 'seint'
							? 'de inteligência'
							: 'operacional'}. Para mudar isso, edite-a em
						<a href="/operacoes/gise/operacoes" class="anchor">Operações</a>.
					</p>
				{/if}
			</div>
			<div class="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
				<!-- Desabilitado enquanto não existe versão anterior (primeira gravação
				     do tipo, ou JSON corrompido) — o `title` explica, senão o botão
				     apagado vira mistério. -->
				<span
					class="w-full sm:w-auto"
					title={modeloAnterior
						? 'Carrega no editor a versão salva antes da última alteração'
						: 'Ainda não há versão anterior deste modelo'}
				>
					{@render actionButton(
						'Restaurar Anterior',
						'M3 10h10a4 4 0 110 8h-1m-9-8l4-4m-4 4l4 4',
						'surface',
						'outlined',
						solicitarRestaurarAnterior,
						!modeloAnterior,
						false,
						'w-full sm:w-auto sm:flex-none px-4 py-2.5 text-xs'
					)}
				</span>

				{@render actionButton(
					'Nova Pergunta',
					'M12 4v16m8-8H4',
					'primary',
					'filled',
					editor.adicionarPergunta,
					false,
					false,
					'w-full sm:w-auto sm:flex-none px-4 py-2.5 text-xs shadow-lg shadow-primary-500/30'
				)}
			</div>
		</div>
	</section>

	<!-- Prévia das etapas: o policial responde uma por tela, nesta ordem. -->
	<section class="card-elevated rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
		<p
			class="text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest"
		>
			Etapas do formulário ({etapas.length})
		</p>
		<div class="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center">
			{#each etapas as etapa, i (etapa.chave)}
				{#if i > 0}
					<span
						class="inline-block px-1 text-surface-400 dark:text-surface-600 rotate-90 sm:rotate-0"
						aria-hidden="true">→</span
					>
				{/if}
				<span
					class="badge {etapa.chave
						? 'preset-filled-primary-500'
						: 'preset-outlined-surface-500'} text-3xs font-bold uppercase"
				>
					{etapa.titulo}
					<span class="opacity-70">· {etapa.perguntas.length}</span>
				</span>
			{/each}
		</div>
		<p class="text-xs text-surface-600 dark:text-surface-400">
			O policial responde uma etapa por tela. A ordem segue a
			<strong>primeira pergunta</strong> de cada etapa, então mover a pergunta move a etapa. Perguntas
			sem etapa ficam juntas num grupo próprio; se nenhuma tiver etapa, o formulário vira página única.
		</p>
	</section>

	<!-- Autocompletar do campo "Etapa": só nomes já em uso, para não multiplicar
	     etapas por variação de digitação. Não restringe — o admin pode criar uma
	     nova digitando um nome que ainda não existe. -->
	<datalist id="etapas-em-uso">
		{#each etapas as etapa (etapa.chave)}
			{#if etapa.chave}
				<option value={etapa.chave}></option>
			{/if}
		{/each}
	</datalist>

	<!-- `role="list"`/`listitem`: além de exigido pelo a11y do arraste, é o que
	     descreve a tela — uma lista ORDENADA de perguntas, em que a posição é
	     informação (ver `renumerarPerguntas`). -->
	<div class="grid grid-cols-1 gap-4" role="list">
		{#snippet renderItem(p: GiseModeloPerguntaConfig, level = 0, indice = -1)}
			{@const arrastando = indiceArrastando === indice && indice >= 0}
			{@const alvo = indiceAlvo === indice && indiceArrastando !== null && !arrastando}
			<div
				class="group card-elevated rounded-2xl shadow-sm p-3 sm:p-5 transition-colors hover:border-primary-500/50 {alvo
					? 'border-primary-500 ring-2 ring-primary-500/40'
					: 'border-surface-200 dark:border-white/10'} {arrastando ? 'opacity-40' : ''}"
				style="margin-left: clamp(0px, {level * 1.5}vw, {level * 2}rem)"
				role="listitem"
				draggable={idArrastavel === p.id}
				ondragstart={() => (indiceArrastando = indice)}
				ondragover={(e) => {
					if (indiceArrastando !== null && indice >= 0) e.preventDefault();
				}}
				ondragenter={() => {
					if (indiceArrastando !== null && indice >= 0) indiceAlvo = indice;
				}}
				ondrop={(e) => {
					e.preventDefault();
					soltarEm(indice);
				}}
				ondragend={limparArraste}
			>
				<!-- Só no nível 0: o filho aparece sob o "Sim" do pai, então tem de
				     ficar na etapa dele. Ver `agruparPorEtapa`. -->
				{#if level === 0}
					<div
						class="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-dashed border-surface-300 dark:border-surface-700"
					>
						<!-- Alça de arraste + setas. As setas não são enfeite: são o único
						     caminho no celular e no teclado. -->
						<div class="flex items-center gap-0.5 shrink-0">
							<span
								class="flex cursor-grab items-center rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-200 active:cursor-grabbing dark:hover:bg-surface-800"
								title="Arraste para reordenar a pergunta"
								aria-hidden="true"
								onmousedown={() => (idArrastavel = p.id)}
								onmouseup={() => (idArrastavel = null)}
							>
								<GripVertical size={16} />
							</span>
							<button
								type="button"
								class="rounded-lg p-1 text-surface-400 transition-colors hover:bg-surface-200 disabled:opacity-30 dark:hover:bg-surface-800"
								title="Mover para cima"
								aria-label="Mover a pergunta {indice + 1} para cima"
								disabled={indice <= 0}
								onclick={() => editor.moverPergunta(indice, indice - 1)}
							>
								<ChevronUp size={16} />
							</button>
							<button
								type="button"
								class="rounded-lg p-1 text-surface-400 transition-colors hover:bg-surface-200 disabled:opacity-30 dark:hover:bg-surface-800"
								title="Mover para baixo"
								aria-label="Mover a pergunta {indice + 1} para baixo"
								disabled={indice < 0 || indice >= editor.perguntasConfig.length - 1}
								onclick={() => editor.moverPergunta(indice, indice + 1)}
							>
								<ChevronDown size={16} />
							</button>
						</div>
						<label
							for="p-et-{p.id}"
							class="text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest"
							>Etapa</label
						>
						<input
							id="p-et-{p.id}"
							type="text"
							list="etapas-em-uso"
							bind:value={p.etapa}
							placeholder="Sem etapa"
							class="flex-1 min-w-0 sm:max-w-xs px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
						/>
					</div>
				{/if}

				<div class="flex flex-col md:flex-row gap-3 sm:gap-5 items-start">
					<div
						class="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-200 dark:bg-surface-800 text-3xs font-bold text-surface-600 dark:text-surface-400 shrink-0"
					>
						{#if level > 0}↳{:else}{editor.perguntasConfig.indexOf(p) + 1}{/if}
					</div>

					<div class="space-y-1.5 flex-1 w-full min-w-0">
						<div class="flex items-center justify-between pl-1 gap-2 flex-wrap mb-1">
							<label
								for="qtxt-{p.id}"
								class="text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest"
								>Texto da Pergunta</label
							>
							{#if p.key?.startsWith('extra_')}
								<span
									class="badge preset-filled-secondary-500 text-3xs font-bold uppercase whitespace-nowrap"
									>CAMPO ADICIONAL</span
								>
							{:else}
								<span
									class="bg-surface-100 dark:bg-surface-800 text-3xs font-bold px-2 py-0.5 rounded-full text-surface-600 dark:text-surface-400 uppercase border border-surface-200 dark:border-surface-700 whitespace-nowrap"
									>Campo Sistema</span
								>
							{/if}
						</div>
						<textarea
							id="qtxt-{p.id}"
							bind:value={p.texto}
							rows="2"
							class="w-full px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-950 text-sm font-bold resize-none"
						></textarea>
					</div>

					<div class="w-full md:w-56 space-y-1.5 md:shrink-0">
						<label
							for="p-tp-{p.id}"
							class="text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest"
							>Tipo do Campo</label
						>
						<select
							id="p-tp-{p.id}"
							bind:value={p.tipo}
							class="w-full px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm font-bold focus:ring-2 focus:ring-primary-500 transition-colors shadow-sm"
						>
							<optgroup label="Campos Básicos">
								<option value="texto">Texto Curto</option>
								<option value="textarea">Texto Longo</option>
								<option value="numero">Número</option>
								<option value="sim_nao">Sim / Não (Condicional)</option>
								<option value="select_99">Quantitativo (0-99)</option>
								<!-- Dois campos numa pergunta só (total e parte). É o que
								     permite meta de COBERTURA: "atender 100% das ocorrências"
								     não se mede com um número solto. -->
								<option value="proporcao">Cobertura (total e atendidas)</option>
							</optgroup>
							<optgroup label="Campos Inteligentes (Sistemáticos)">
								<!-- Primeiro da lista por ser o ÚNICO que pode se repetir no
								     formulário: os demais gravam em chave fixa e só funcionam
								     uma vez (ver `$lib/gise/tipos-pergunta`). -->
								<option value="lista_detalhada"
									>Quantidade + Lista Nome/Procedimento (reutilizável)</option
								>
								<option value="vtr_placa">VTR e Placa (Inteligente)</option>
								<option value="drogas_complex">Drogas Detalhado (Auto-Listagem)</option>
								<option value="armas_complex">Armas Detalhado (Auto-Listagem)</option>
								<option value="celulares_complex">Extração Celular (Auto-Listagem)</option>
								<option value="analise_complex">Análise de Dados (Auto-Listagem)</option>
								<option value="relatorios_seint_complex">Relatórios SEINT (Auto-Listagem)</option>
								<option value="foragidos_complex">Alvos Foragidos (Auto-Listagem)</option>
								<option value="operacoes_seint_complex">Operações SEINT (Auto-Listagem)</option>
								<option value="operacoes_seint_pura">Operações SEINT (Lista Pura)</option>
							</optgroup>
							<!-- APOSENTADOS: só aparecem na pergunta que JÁ está com um deles.
							     Escondê-los sempre faria o `<select>` não achar o valor atual e
							     cair na primeira opção — a pergunta trocaria de tipo sozinha ao
							     ser salva, e trocar o tipo troca a chave da resposta.
							     Fazem o mesmo que "Quantidade + Lista", só que em chave fixa,
							     o que os limita a uma ocorrência por formulário. -->
							{#if TIPOS_LISTA_APOSENTADOS.includes(p.tipo)}
								<optgroup label="Aposentados — prefira Quantidade + Lista">
									{#if p.tipo === 'mandados_maiores'}
										<option value="mandados_maiores">Mandados Maiores (legado)</option>
									{:else if p.tipo === 'prisoes_maiores'}
										<option value="prisoes_maiores">Prisões Maiores (legado)</option>
									{:else}
										<option value="apreensoes_menores">Apreensões Menores (legado)</option>
									{/if}
								</optgroup>
							{/if}
						</select>
						{#if TIPOS_LISTA_APOSENTADOS.includes(p.tipo)}
							<p class="mt-1 text-3xs text-warning-700 dark:text-warning-400">
								Tipo aposentado. <strong>Quantidade + Lista Nome/Procedimento</strong> faz o mesmo e pode
								se repetir no formulário — mas trocar agora zera as respostas já gravadas nesta pergunta.
							</p>
						{/if}
					</div>

					<div class="flex gap-2 shrink-0 self-end md:self-start">
						{#if TIPOS_COM_FILHOS.includes(p.tipo)}
							<!-- `CornerDownRight` e não a seta reta de antes: ao lado das setas
							     de MOVER, uma seta para baixo virava "descer a pergunta". -->
							<button
								type="button"
								class="p-3 text-primary-500 hover:bg-primary-500/10 rounded-xl transition-colors"
								onclick={() => editor.adicionarSubPergunta(p)}
								title="Adicionar Sub-pergunta (se SIM)"
							>
								<CornerDownRight class="w-5 h-5" />
							</button>
						{/if}
						<button
							type="button"
							class="p-3 text-error-500 hover:bg-error-500/10 rounded-xl transition-colors"
							onclick={() => editor.removerPergunta(p.id)}
							aria-label="Remover Pergunta"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/></svg
							>
						</button>
					</div>
				</div>

				<!-- Rótulos dos dois campos da COBERTURA. Ficam aqui, e não em
				     `TIPOS_COM_ROTULOS`, porque aquele bloco fala de quantidade e
				     listagem — vocabulário dos tipos de auto-listagem, que a cobertura
				     não tem. -->
				{#if ehProporcao(p.tipo)}
					<div
						class="mt-4 p-4 bg-primary-500/5 dark:bg-primary-500/10 rounded-2xl border border-dashed border-primary-500/30 space-y-3"
					>
						<div class="flex items-center gap-2">
							<SquarePen class="w-4 h-4 text-primary-500" aria-hidden="true" />
							<span
								class="text-3xs font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-widest"
								>Rótulos dos dois campos</span
							>
						</div>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<div>
								<label
									for="p-total-{p.id}"
									class="block text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-1"
									>Total existente</label
								>
								<input
									id="p-total-{p.id}"
									type="text"
									placeholder="Ocorrências no período"
									bind:value={p.subtexto_total}
									class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm"
								/>
							</div>
							<div>
								<label
									for="p-parte-{p.id}"
									class="block text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-1"
									>Parte atendida</label
								>
								<input
									id="p-parte-{p.id}"
									type="text"
									placeholder="Ocorrências atendidas"
									bind:value={p.subtexto_parte}
									class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm"
								/>
							</div>
						</div>
					</div>
				{/if}

				<!-- Novos controles de sub-textos para QUALQUER pergunta que use os tipos inteligentes -->
				{#if TIPOS_COM_ROTULOS.includes(p.tipo)}
					<div
						class="mt-4 p-4 bg-primary-500/5 dark:bg-primary-500/10 rounded-2xl border border-dashed border-primary-500/30 space-y-4"
					>
						<div class="flex items-center gap-2 mb-2">
							<SquarePen class="w-4 h-4 text-primary-500" aria-hidden="true" />
							<span
								class="text-3xs font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-widest"
								>Personalizar Rótulos do Campo Inteligente</span
							>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							{#if TIPOS_COM_LISTA.includes(p.tipo)}
								<div class="space-y-1">
									<label
										for="subqtd-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
										>Quantidade:</label
									>
									<input
										id="subqtd-{p.id}"
										type="text"
										bind:value={p.subtexto_qtd}
										placeholder="Ex: 5.1 QUANTIDADE:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
								<div class="space-y-1 md:col-span-2">
									<label
										for="sublst-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-wider"
										>Legenda Lista (ex: 5.2)</label
									>
									<input
										id="sublst-{p.id}"
										type="text"
										bind:value={p.subtexto_lista}
										placeholder="Ex: 5.2 LISTAGEM:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
								<!-- Só no reutilizável: os tipos de chave fixa trazem o nome do
								     item embutido ("Mandado 1", "Procedimento 1"). É este campo
								     que permite ao genérico substituí-los sem perder o nome no
								     PDF assinado. -->
								{#if p.tipo === TIPO_LISTA_REUTILIZAVEL}
									<div class="space-y-1 md:col-span-2">
										<label
											for="subitem-{p.id}"
											class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-wider"
											>Nome de cada item no relatório</label
										>
										<input
											id="subitem-{p.id}"
											type="text"
											bind:value={p.subtexto_item}
											placeholder="Item"
											class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
										/>
										<p class="text-3xs text-surface-500 dark:text-surface-500">
											No PDF cada linha sai como <strong
												>"↳ {p.subtexto_item?.trim() || 'Item'} 1"</strong
											>. Ex.: Procedimento, Mandado, Apreensão.
										</p>
									</div>
								{/if}
							{:else if p.tipo === 'drogas_complex'}
								<div class="space-y-1">
									<label
										for="subtp-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
										>Lista de Tipos:</label
									>
									<input
										id="subtp-{p.id}"
										type="text"
										bind:value={p.subtexto_tipo}
										placeholder="Ex: 10.1 TIPO DE DROGA:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
								<div class="space-y-1">
									<label
										for="subdet-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
										>Detalhamento Pesos:</label
									>
									<input
										id="subdet-{p.id}"
										type="text"
										bind:value={p.subtexto_detalhe}
										placeholder="Ex: 10.1.1 PESOS:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
							{:else if p.tipo === 'armas_complex'}
								<div class="space-y-1">
									<label
										for="subtp-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
										>Lista de Tipos:</label
									>
									<input
										id="subtp-{p.id}"
										type="text"
										bind:value={p.subtexto_tipo}
										placeholder="Ex: 11.1 TIPO DE ARMA:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
								<div class="space-y-1">
									<label
										for="subdet-{p.id}"
										class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase"
										>Legenda Quantidade:</label
									>
									<input
										id="subdet-{p.id}"
										type="text"
										bind:value={p.subtexto_detalhe}
										placeholder="Ex: 11.1.1 QUANTIDADE:"
										class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold"
									/>
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- As FORMAS no painel de produtividade. Acumulam: a pergunta de armas
				     mostra ranking E detalhamento, que é como o painel sempre a
				     desenhou.

				     Existe porque antes NÃO existia: toda pergunta de tipo contável
				     virava barra sozinha, e a quilometragem da viatura ocupava um card
				     ao lado das prisões. Desmarcar aqui tira do painel sem tirar do
				     formulário — a coleta continua, só a leitura sai. -->
				{#if podeSerGrafico(p.tipo)}
					{@const formas = formasDaMarca(p.grafico)}
					{@const alguma = formas.colunas || formas.ranking || formas.detalhe}
					<div
						class="mt-4 rounded-2xl border border-dashed p-4 space-y-3 {alguma
							? 'bg-primary-500/5 dark:bg-primary-500/10 border-primary-500/40'
							: 'bg-surface-100/60 dark:bg-surface-800/40 border-surface-300 dark:border-surface-700'}"
					>
						<p class="flex items-center gap-1.5 text-sm font-bold">
							<ChartColumn class="w-4 h-4 text-primary-500" aria-hidden="true" />
							Mostrar na produtividade
						</p>

						<label class="flex items-start gap-2 cursor-pointer">
							<input
								type="checkbox"
								class="checkbox mt-0.5"
								checked={formas.colunas}
								onchange={() => editor.alternarFormaGrafico(p, 'colunas')}
							/>
							<span class="min-w-0">
								<span class="block text-sm font-semibold">Colunas por unidade</span>
								<span class="block text-2xs text-surface-600 dark:text-surface-400">
									Gráfico de barras comparando o total do período em cada unidade.
								</span>
							</span>
						</label>

						<label class="flex items-start gap-2 cursor-pointer">
							<input
								type="checkbox"
								class="checkbox mt-0.5"
								checked={formas.ranking}
								onchange={() => editor.alternarFormaGrafico(p, 'ranking')}
							/>
							<span class="min-w-0">
								<span class="block text-sm font-semibold">Ranking de unidades</span>
								<span class="block text-2xs text-surface-600 dark:text-surface-400">
									Os mesmos números em lista numerada, do primeiro ao último colocado.
								</span>
							</span>
						</label>

						<!-- Desabilitada, e não escondida: a caixa apagada diz que ESTE tipo
						     de pergunta não guarda quebra por categoria. Escondê-la faria o
						     bloco parecer diferente sem explicar por quê — mesma escolha do
						     tipo de meta "Cobertura". -->
						<label
							class="flex items-start gap-2 {podeDetalhar(p.tipo)
								? 'cursor-pointer'
								: 'opacity-50 cursor-not-allowed'}"
						>
							<input
								type="checkbox"
								class="checkbox mt-0.5"
								checked={formas.detalhe}
								disabled={!podeDetalhar(p.tipo)}
								onchange={() => editor.alternarFormaGrafico(p, 'detalhe')}
							/>
							<span class="min-w-0">
								<span class="block text-sm font-semibold">Detalhamento por tipo</span>
								<span class="block text-2xs text-surface-600 dark:text-surface-400">
									{#if podeDetalhar(p.tipo)}
										Quebra a resposta por categoria — quanto de cada tipo, e não por unidade.
									{:else}
										Só em perguntas que guardam quebra por categoria (apreensão de drogas e de
										armas). Uma pergunta de número tem um valor só, e não há o que quebrar.
									{/if}
								</span>
							</span>
						</label>
					</div>
				{/if}

				<!-- Indicador de meta: promove a pergunta de "campo do relatório" a série
				     acompanhada em gráfico, com meta e linha de base.

				     Só aparece em tipo CONTÁVEL (`TIPOS_INDICADORAVEIS`) — texto livre
				     não agrega, e `sim_nao` responde proporção, não volume. -->
				{#if podeSerIndicador(p.tipo)}
					<div
						class="mt-4 p-4 rounded-2xl border border-dashed space-y-3 {p.indicador
							? 'bg-tertiary-500/5 dark:bg-tertiary-500/10 border-tertiary-500/40'
							: 'bg-surface-100/60 dark:bg-surface-800/40 border-surface-300 dark:border-surface-700'}"
					>
						<label class="flex items-start gap-2 cursor-pointer">
							<input
								type="checkbox"
								class="checkbox mt-0.5"
								checked={!!p.indicador}
								onchange={() => editor.alternarIndicador(p)}
							/>
							<span class="min-w-0">
								<span class="flex items-center gap-1.5 text-sm font-bold">
									<Target class="w-4 h-4 text-tertiary-500" aria-hidden="true" />
									Usar como indicador de meta
								</span>
								<span class="block text-2xs text-surface-600 dark:text-surface-400 mt-0.5">
									A resposta vira série no painel de produtividade, comparada com a meta e com o
									valor inicial informado pela unidade.
								</span>
							</span>
						</label>

						{#if p.indicador}
							{@const meta = p.indicador}
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
								<!-- Proporção não tem objetivo: cobrir 100% de um total não é
								     aumentar nem diminuir um número. O campo SOME em vez de ficar
								     desabilitado — desabilitado ainda afirma que existe uma
								     direção a escolher. -->
								{#if meta.metaTipo !== 'proporcao'}
									<div>
										<label
											for="ind-obj-{p.id}"
											class="block text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-1"
											>Objetivo</label
										>
										<select
											id="ind-obj-{p.id}"
											bind:value={meta.objetivo}
											class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm"
										>
											<option value="diminuir">Diminuir (reduzir o número)</option>
											<option value="aumentar">Aumentar (elevar o número)</option>
										</select>
									</div>
								{/if}

								<div>
									<label
										for="ind-tipo-{p.id}"
										class="block text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-1"
										>Tipo de meta</label
									>
									<!-- `onchange` e não `bind:value`: trocar o tipo RECONSTRÓI o
									     objeto, porque cada variante tem campos diferentes. -->
									<select
										id="ind-tipo-{p.id}"
										value={meta.metaTipo}
										onchange={(e) => editor.definirMetaTipoIndicador(p, e.currentTarget.value)}
										class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm"
									>
										<option value="percentual">Percentual sobre o valor inicial</option>
										<option value="absoluto">Número fixo (sem valor inicial)</option>
										<option value="proporcao" disabled={!ehProporcao(p.tipo)}>
											Cobertura — % do total atendido
										</option>
									</select>
									{#if !ehProporcao(p.tipo)}
										<p class="mt-1 text-3xs text-surface-500 dark:text-surface-500">
											Cobertura exige o tipo de campo <strong>Cobertura (total e atendidas)</strong
											>.
										</p>
									{/if}
								</div>

								<div>
									<label
										for="ind-meta-{p.id}"
										class="block text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-1"
									>
										{meta.metaTipo === 'absoluto' ? 'Meta (valor)' : 'Meta (%)'}
									</label>
									<input
										id="ind-meta-{p.id}"
										type="number"
										min="0"
										step="any"
										bind:value={meta.metaValor}
										class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm"
									/>
								</div>

								<div>
									<label
										for="ind-un-{p.id}"
										class="block text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-1"
										>Unidade de medida</label
									>
									<input
										id="ind-un-{p.id}"
										type="text"
										placeholder="procedimentos, dias, ocorrências…"
										bind:value={meta.unidadeMedida}
										class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm"
									/>
								</div>

								{#if meta.metaTipo === 'percentual'}
									<div class="sm:col-span-2">
										<label
											for="ind-base-{p.id}"
											class="block text-3xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-1"
											>Rótulo do valor inicial</label
										>
										<input
											id="ind-base-{p.id}"
											type="text"
											placeholder="Como pedir o valor inicial à unidade (usa o texto da pergunta se vazio)"
											bind:value={meta.rotuloBase}
											class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm"
										/>
									</div>
								{/if}
							</div>

							<p class="text-2xs text-surface-600 dark:text-surface-400">
								{#if meta.metaTipo === 'percentual'}
									A unidade informa o valor inicial em <strong>Dados base</strong>. Se não informar,
									ele é pedido dentro do próprio formulário de produtividade.
								{:else if meta.metaTipo === 'proporcao'}
									O total e a parte atendida vêm da própria pergunta, a cada relatório — nada é
									pedido em <strong>Dados base</strong>.
								{:else}
									Meta de número fixo não usa valor inicial — nada é pedido à unidade.
								{/if}
							</p>
						{/if}
					</div>
				{/if}

				<!-- O título do card no painel.

				     UM campo para as duas marcas, e não um em cada bloco: o valor é o
				     mesmo `rotulo_painel`, e uma pergunta pode ser gráfico E indicador ao
				     mesmo tempo. Dois campos editando um valor só é a duplicação do
				     `CLAUDE.md` em forma de tela — quem preenchesse um veria o outro
				     mudar sozinho.

				     Aparece só depois de marcada porque antes disso não há card nenhum
				     para intitular. -->
				{#if temAlgumaForma(p.grafico) || p.indicador}
					<!-- Sem `rotulo_painel`: é o título que sairia se o campo ficasse em
					     branco, e é ele que vira placeholder. -->
					{@const padrao = tituloNoPainel({ tipo: p.tipo, texto: p.texto })}
					<div
						class="mt-4 p-4 bg-primary-500/5 dark:bg-primary-500/10 rounded-2xl border border-dashed border-primary-500/30 space-y-1"
					>
						<label
							for="rot-painel-{p.id}"
							class="flex items-center gap-2 text-3xs font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-widest"
						>
							<SquarePen class="w-4 h-4 text-primary-500" aria-hidden="true" />
							Título no painel de produtividade
						</label>
						<input
							id="rot-painel-{p.id}"
							type="text"
							bind:value={p.rotulo_painel}
							placeholder={padrao}
							class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm"
						/>
						<p class="text-3xs text-surface-500 dark:text-surface-500">
							Curto, e substantivo: o card é lido por quem acompanha, não por quem preenche. Em
							branco, sai como <strong>"{padrao}"</strong>. Não muda o relatório assinado.
						</p>
					</div>
				{/if}

				{#if p.filhos && p.filhos.length > 0}
					<div class="mt-6 space-y-6 pt-2 border-l-4 border-primary-500/20" role="list">
						{#each p.filhos as filho (filho.id)}
							{@render renderItem(filho, level + 1)}
						{/each}
					</div>
				{/if}
			</div>
		{/snippet}

		{#each editor.perguntasConfig as p, i (p.id)}
			{@render renderItem(p, 0, i)}
		{/each}
	</div>

	<!-- Salvar vive no RODAPÉ FIXO: o modelo tem dezenove perguntas de nível 0
	     mais os filhos, e antes disto gravar exigia rolar a página inteira toda
	     vez. Mesmo desenho do wizard do relatório, pelo mesmo motivo. -->
	<form
		method="POST"
		action="?/salvarModelo"
		use:enhance={editor.handleSalvarModelo}
		class="contents"
	>
		<input type="hidden" name="config" value={editor.configJson} />
		<input type="hidden" name="tipo" value={editor.configTipo} />
		<input type="hidden" name="operacaoId" value={editor.operacaoSelecionadaId ?? ''} />

		<RodapeAcoes>
			{#snippet status()}
				<span class="flex items-center gap-2">
					<!-- Três estados, e o do meio é o que a barra existe para dizer.
					     Até ago/2026 eram dois — "Salvando…", que dura o tempo da
					     requisição, e "Pronto para salvar", que era o `else` e dizia a
					     mesma coisa tendo-se mexido em algo ou não. -->
					<span
						class="w-2 h-2 rounded-full shrink-0 {loading.active
							? 'bg-warning-500 animate-pulse'
							: editor.alteracoesNaoSalvas
								? 'bg-warning-500'
								: 'bg-success-500'}"
					></span>
					<span class="font-bold text-surface-900 dark:text-surface-100">
						{#if loading.active}
							Salvando alterações…
						{:else if editor.alteracoesNaoSalvas}
							Alterações não salvas
						{:else}
							Tudo salvo
						{/if}
					</span>
				</span>
			{/snippet}

			{#snippet acoes()}
				<!-- O 9º argumento (`btnType`) é obrigatório aqui: sem ele o
				     `actionButton` cai no default `type="button"`, e um botão desse tipo
				     dentro de um `<form>` NÃO submete. Como também não há `onclick`, o
				     clique não fazia absolutamente nada — o modelo nunca era salvo. -->
				{@render actionButton(
					loading.active
						? 'Salvando...'
						: `Salvar Modelo ${editor.configTipo === 'seint' ? 'SEINT' : 'Operacional'}`,
					undefined,
					'primary',
					'filled',
					undefined,
					loading.active,
					false,
					'w-full sm:w-auto py-2.5 text-sm shadow-lg shadow-primary-500/20',
					'submit'
				)}
			{/snippet}
		</RodapeAcoes>
	</form>
</div>

<ModalShell
	bind:open={dialogRestaurarAberto}
	title="Restaurar versão anterior?"
	largura="sm"
	cancelLabel="Cancelar"
>
	{#snippet description()}
		As perguntas do modelo <strong>{editor.configTipo}</strong> voltam a ser as da versão salva
		antes da última alteração. As edições que estiverem na tela agora são descartadas.
		<br /><br />
		Nada é gravado ainda: revise e clique em <strong>Salvar</strong> para efetivar.
	{/snippet}

	{#snippet footer()}
		<button
			type="button"
			class="btn preset-filled-warning-500"
			onclick={confirmarRestaurarAnterior}
		>
			Restaurar
		</button>
	{/snippet}
</ModalShell>
