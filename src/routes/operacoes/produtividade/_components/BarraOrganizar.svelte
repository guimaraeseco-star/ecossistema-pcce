<script lang="ts">
	/**
	 * A barra do modo "Organizar" do painel — o que o Admin Geral vê enquanto
	 * arrasta os cards de `/operacoes/produtividade`.
	 *
	 * Fica `sticky` no topo porque o painel é alto: com a barra no fim da página,
	 * arrastar o último gráfico deixaria o botão "Salvar" a três telas de
	 * distância. O offset é `top-16` (não `top-0`/`top-2`) para ficar abaixo da
	 * `BarraTopo` fixa (`h-14`, `z-40`); `z-30` fica abaixo do cromo. Some do
	 * papel (`print:hidden`) como todo o cromo da tela.
	 *
	 * Precisa ser filho da página alta (não do wrapper curto dos filtros):
	 * `sticky` só permanece enquanto o ancestral cabe na rolagem — dentro do
	 * bloco dos filtros a barra sumia junto com ele.
	 *
	 * Layout vertical de propósito: o texto de instrução em cima, os botões em
	 * fila abaixo. Em `lg:flex-row` os botões iam ao lado do texto e apertavam
	 * a instrução — quem organiza pela primeira vez precisa ler as três regras
	 * abaixo na largura inteira.
	 *
	 * O texto não é enfeite. Três coisas surpreendem quem organiza pela primeira
	 * vez, e as três estão escritas aqui em vez de descobertas por tentativa:
	 *
	 * - **há dois níveis.** A barra escura move o BLOCO inteiro; a clara, o card
	 *   dentro dele. Sem dizer isso, quem quer levar os gráficos para o topo tenta
	 *   arrastar um card de cada vez e conclui que não dá;
	 * - **o card se move dentro do bloco dele.** As três faixas do painel têm
	 *   formatos diferentes (indicador e colunas ocupam a largura inteira, ranking
	 *   e detalhamento vão dois por linha), e não há para onde levar um card de
	 *   colunas na grade dos rankings;
	 * - **a ordem é desta operação E deste tipo de equipe.** Os cards de indicador
	 *   aparecem nas duas abas, e arrumá-los em "Operacional" não arruma
	 *   "Inteligência" — são dois relatórios, para públicos diferentes.
	 */
	import Spinner from '$lib/components/Spinner.svelte';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	const {
		tipoEquipe,
		alterada,
		salvando,
		temOrdemPropria,
		onSalvar,
		onDescartar,
		onRestaurarPadrao,
		onCancelar
	}: {
		tipoEquipe: string;
		/** Há arraste ainda não gravado? Decide o texto e o estado dos botões. */
		alterada: boolean;
		salvando: boolean;
		/** O painel já tem ordem própria gravada ou em rascunho? */
		temOrdemPropria: boolean;
		onSalvar: () => void;
		onDescartar: () => void;
		onRestaurarPadrao: () => void;
		onCancelar: () => void;
	} = $props();

	const BOTAO = 'btn btn-sm font-semibold';
</script>

<div
	class="sticky top-16 z-30 rounded-2xl border-2 border-primary-500/50 bg-white/95 p-3 shadow-xl backdrop-blur dark:bg-surface-900/95 print:hidden sm:p-4"
>
	<div class="flex flex-col gap-3">
		<div class="min-w-0 space-y-1">
			<p class="flex items-center gap-1.5 text-sm font-bold">
				<GripVertical class="h-4 w-4 text-primary-500" aria-hidden="true" />
				Organizando o painel — {tipoEquipe}
			</p>
			<p class="text-2xs text-surface-600 dark:text-surface-400">
				Arraste, ou use as setas ↑/↓. A barra <strong>escura</strong> move o bloco inteiro; a clara
				move um card <strong>dentro</strong> do bloco dele — indicadores, rankings e gráficos de colunas
				têm formatos diferentes e não se misturam. A ordem vale para esta operação e este tipo de equipe,
				e é a mesma que todos veem.
			</p>
		</div>

		<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
			<!-- Desabilitado quando não há ordem própria: o painel JÁ está na ordem do
			     formulário, e um botão que não muda nada só faz duvidar do estado. -->
			<button
				type="button"
				class="{BOTAO} preset-outlined-surface-500"
				disabled={!temOrdemPropria || salvando}
				title="Volta os cards à ordem em que as perguntas estão no formulário"
				onclick={onRestaurarPadrao}
			>
				<RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
				Ordem do formulário
			</button>

			<button
				type="button"
				class="{BOTAO} preset-outlined-surface-500"
				disabled={!alterada || salvando}
				onclick={onDescartar}
			>
				Desfazer
			</button>

			<button
				type="button"
				class="{BOTAO} preset-outlined-surface-500"
				disabled={salvando}
				onclick={onCancelar}
			>
				Sair sem salvar
			</button>

			<button
				type="button"
				class="{BOTAO} preset-filled-primary-500"
				disabled={!alterada || salvando}
				onclick={onSalvar}
			>
				{#if salvando}
					<Spinner size="sm" />
					Salvando...
				{:else}
					Salvar ordem
				{/if}
			</button>
		</div>
	</div>
</div>
