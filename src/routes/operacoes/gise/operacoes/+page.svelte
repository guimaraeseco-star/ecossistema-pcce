<script lang="ts">
	/**
	 * Cadastro das operações extraordinárias (Admin Geral).
	 *
	 * ## Duas telas, um slide
	 *
	 * A lista e o formulário são painéis do MESMO slider horizontal — o mesmo
	 * desenho do fluxo de presença em `/operacoes/presenca`. Antes o formulário de criação
	 * abria empurrando a lista para baixo, e o de edição abria dentro da linha:
	 * três coisas competindo pela mesma tela, e um formulário longo espremido
	 * entre elas.
	 *
	 * O painel aberto vive na URL (`?form=nova` ou `?form=<id>`), não num `$state`
	 * local. É o que faz o botão "voltar" do navegador desfazer a abertura, o que
	 * mantém o link de edição compartilhável e o que permite
	 * `/operacoes/gise/operacoes/[id]/config` redirecionar para o painel certo.
	 *
	 * O botão **Dados base** aparece só na linha da operação que tem indicador
	 * PERCENTUAL — é o único tipo de meta que pede um valor inicial à delegacia.
	 * Ele leva a `/operacoes/dados-base/<id>`, com a operação no caminho: a tela de
	 * preenchimento não tem seletor, e não há como digitar o acervo de uma
	 * delegacia sob a operação errada.
	 *
	 * ## Excluir × desativar
	 *
	 * Operação COM escala não se exclui — escala histórica e PDF assinado
	 * continuam apontando para ela. Para essas existe **Desativar**, e a contagem
	 * de escalas ao lado do nome é o que torna a diferença compreensível na hora.
	 * A operação que nunca recebeu escala nenhuma (a criada por engano, a de
	 * teste) não é história de nada, e ganha **Excluir**. Quem recusa de verdade é
	 * `excluirOperacao`, que reconta no servidor.
	 *
	 * ## Sem "voltar" no topo
	 *
	 * Operações tem entrada própria na barra lateral, e tela de aba não leva botão
	 * de voltar — ele existe nas telas de DETALHE, alcançadas de dentro de outra.
	 * O único voltar aqui é o do painel do formulário, que fecha o painel.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { goto, invalidate } from '$app/navigation';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { useConfirmationDialog } from '$lib/composables';
	import FormularioOperacao from './_components/FormularioOperacao.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Power from '@lucide/svelte/icons/power';
	import SquarePen from '@lucide/svelte/icons/square-pen';
	import FileText from '@lucide/svelte/icons/file-text';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	const { data }: PageProps = $props();

	/**
	 * Qual painel está aberto, lido da URL.
	 *
	 * `'nova'` cria; um número edita aquela operação; `null` mostra a lista. Um id
	 * que não existe mais (operação removida noutra aba, link velho) cai em `null`
	 * em vez de abrir um formulário vazio — a lista é o estado sempre válido.
	 */
	const paramForm = $derived(page.url.searchParams.get('form'));
	const criando = $derived(paramForm === 'nova');
	const emEdicao = $derived(
		paramForm && paramForm !== 'nova'
			? (data.operacoes.find((o) => o.id === Number(paramForm)) ?? null)
			: null
	);
	const painelAberto = $derived(criando || emEdicao !== null);

	function abrir(alvo: string) {
		goto(`?form=${alvo}`, { keepFocus: true, noScroll: true });
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	/**
	 * A escolha entre os DOIS tipos de cadastro que começam neste botão.
	 *
	 * "Operação" é o que esta tela sempre fez: o catálogo do qual as escalas
	 * extras pendem (GISE, CRAJUBAR), com formulário de produtividade e
	 * indicadores. "Plano operacional" é outra coisa — a operação COM
	 * deslocamento, evento único, com equipes, viaturas e custo próprios; mora em
	 * `/operacoes/planos` e não recebe escala nenhuma.
	 *
	 * A pergunta vem ANTES do formulário porque os dois divergem já no primeiro
	 * campo. Um seletor de tipo dentro de um formulário só teria de esconder
	 * metade dele conforme a escolha, e as duas metades não compartilham nada
	 * além do nome.
	 */
	let escolhendoTipo = $state(false);

	function voltarParaLista() {
		goto(page.url.pathname, { keepFocus: true, noScroll: true });
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	/** Rótulo dos tipos de equipe da operação, para a coluna da lista. */
	function rotuloTipos(op: { usa_equipe_operacional: boolean; usa_equipe_seint: boolean }): string {
		const t: string[] = [];
		if (op.usa_equipe_operacional) t.push('Operacional');
		if (op.usa_equipe_seint) t.push('Inteligência (SEINT)');
		return t.join(' · ');
	}

	/**
	 * Os botões da linha, na faixa de NAVEGAÇÃO do README §10 (`py-1.5`, ~34px).
	 * Tamanho numa constante só: cinco cópias divergem na primeira vez que alguém
	 * ajusta uma delas, e é assim que a fileira deixa de ficar alinhada. O
	 * preenchimento (`outlined` vs `filled-error`) é o que muda entre ações.
	 * `w-full` no celular preenche a célula da grade 2×N; de `sm:` para cima
	 * volta à largura do rótulo.
	 */
	const TAMANHO_BOTAO_LINHA =
		'btn btn-sm px-2.5 py-1.5 rounded-xl text-xs whitespace-nowrap w-full min-w-0 justify-center sm:w-auto';
	const BOTAO_LINHA = `${TAMANHO_BOTAO_LINHA} preset-outlined-surface-500`;
	const BOTAO_EXCLUIR = `${TAMANHO_BOTAO_LINHA} preset-filled-error-500`;

	/** A operação que o admin pediu para excluir — `null` com o modal fechado. */
	const confirmExcluir = useConfirmationDialog<{ id: number; nome: string }>();

	/** `use:enhance` comum às actions: toast do erro do servidor e revalidação. */
	function enviar(mensagemOk: string, aoConcluir?: () => void) {
		return () => {
			loading.show('A gravar…');
			return async ({ result }: { result: { type: string; data?: unknown } }) => {
				loading.hide();
				if (result.type === 'success') {
					toaster.success({ title: mensagemOk });
					await invalidate('app:operacoes');
					aoConcluir?.();
				} else if (result.type === 'failure') {
					const err = (result.data as { error?: string } | undefined)?.error;
					toaster.error({ title: err || 'Não foi possível gravar' });
				}
			};
		};
	}
</script>

<svelte:head>
	<title>Operações | Ecossistema PCCE</title>
</svelte:head>

<!-- Slide lateral: o container esconde o painel que está fora de tela. -->
<div class="min-w-0 overflow-hidden">
	<div
		class="flex transition-transform duration-300 ease-in-out"
		style="transform: translateX({painelAberto ? '-50%' : '0%'}); width: 200%;"
	>
		<!-- Painel 1: a lista -->
		<div class="min-w-0 space-y-6 px-1" style="width: 50%;">
			<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
				<div class="min-w-0">
					<h1 class="h1 text-2xl font-bold">Operações</h1>
					<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
						Cada operação tem o seu formulário de produtividade e os seus indicadores.
					</p>
				</div>
				<!-- `py-2`, e não `py-2.5`: a faixa de CTA de modal/formulário do
				     README §10 dá um bloco alto demais para um botão de cabeçalho. -->
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500 px-3.5 py-2 rounded-xl font-semibold shrink-0 w-full sm:w-auto"
					onclick={() => (escolhendoTipo = true)}
				>
					<Plus class="w-4 h-4" />
					Nova operação
				</button>
			</div>

			<!-- Sem `card-elevated`: a folha do layout já é o cartão da página, e
			     cada operação da lista já é um cartão com contorno. Envolver a
			     lista num terceiro desenha cartão dentro de cartão. -->
			<section class="min-w-0 space-y-3">
				{#if data.operacoes.length === 0}
					<p class="text-sm text-surface-600 dark:text-surface-400">Nenhuma operação cadastrada.</p>
				{:else}
					<ul class="space-y-3">
						{#each data.operacoes as op (op.id)}
							<li
								class="rounded-xl border border-surface-200/70 dark:border-white/10 p-4"
								class:opacity-60={!op.ativo}
							>
								<!-- No celular a linha EMPILHA: texto em cima, fileira de botões
							     embaixo. Lado a lado sobrava para o texto menos que uma palavra —
							     o nome quebrava em "4a"/"Seccional" e o ciclo saía uma palavra por
							     linha, enquanto o grupo de botões estourava a viewport e era
							     CORTADO pelo `overflow-hidden` do slider (botão inalcançável).
							     De `sm:` para cima vale a decisão original: o texto encolhe
							     (`min-w-0 flex-1`) e o grupo fica ancorado no topo à direita, sem
							     `flex-wrap` no CONTAINER — quando o grupo não cabia, o container
							     quebrava e o grupo inteiro descia, e era por isso que a linha com
							     4 botões ficava diferente das de 3. -->
								<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-2">
											<span class="font-semibold">{op.nome}</span>
											{#if op.sigla}
												<span
													class="rounded-full bg-primary-500/10 text-primary-700 dark:text-primary-300 px-2 py-0.5 text-2xs font-semibold"
												>
													{op.sigla}
												</span>
											{/if}
											{#if !op.ativo}
												<span
													class="rounded-full bg-surface-500/15 px-2 py-0.5 text-2xs font-semibold text-surface-600 dark:text-surface-400"
												>
													Desativada
												</span>
											{/if}
										</div>
										<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
											{rotuloTipos(op)}
											·
											{op.escalas === 1 ? '1 escala' : `${op.escalas} escalas`}
											{#if op.data_inicio || op.data_fim}
												· ciclo {op.data_inicio ?? '…'} a {op.data_fim ?? '…'}
											{/if}
										</p>
										{#if op.descricao}
											<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
												{op.descricao}
											</p>
										{/if}
									</div>

									<!-- "Configurações" virou parte de "Editar" — as duas metades
									     descrevem a mesma operação. `sm:justify-end` mantém os botões
									     terminando na mesma margem em todas as linhas, com ou sem
									     "Dados base" e "Excluir". No celular `flex-wrap` deixava
									     fileiras irregulares (um botão numa linha, dois na outra);
									     a grade 2×N alinha as larguras. De `sm:` para cima a
									     fileira compacta à direita volta a valer. -->
									<div
										class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end"
									>
										<a href={`/operacoes/presenca?operacaoId=${op.id}`} class={BOTAO_LINHA}>
											<FileText class="w-3.5 h-3.5" />
											Formulário
										</a>
										<!-- Só na operação que PEDE base: das três cadastradas, só a
										     que tem indicador percentual tem o que perguntar às
										     delegacias. Um botão no cabeçalho sugeria que era trabalho
										     de todas. O link leva à operação, não à tela genérica. -->
										{#if op.pedeLinhaBase}
											<a href={`/operacoes/dados-base/${op.id}`} class={BOTAO_LINHA}>
												<ClipboardCheck class="w-3.5 h-3.5" />
												Dados base
											</a>
										{/if}
										<button type="button" class={BOTAO_LINHA} onclick={() => abrir(String(op.id))}>
											<SquarePen class="w-3.5 h-3.5" />
											Editar
										</button>
										<form
											class="w-full min-w-0 odd:last:col-span-2 sm:w-auto sm:col-auto"
											method="POST"
											action="?/alternarAtivo"
											use:enhance={enviar(op.ativo ? 'Operação desativada' : 'Operação reativada')}
										>
											<input type="hidden" name="id" value={op.id} />
											<button type="submit" class={BOTAO_LINHA} disabled={loading.active}>
												<Power class="w-3.5 h-3.5" />
												{op.ativo ? 'Desativar' : 'Reativar'}
											</button>
										</form>
										<!-- Excluir só existe sem escala nenhuma: com escala, o que
										     resta é desativar (o histórico e o PDF assinado continuam
										     apontando para a operação). Quem recusa de verdade é a
										     action, que reconta no servidor. Fica por último: é a
										     ação destrutiva. -->
										{#if op.escalas === 0}
											<button
												type="button"
												class="{BOTAO_EXCLUIR} odd:last:col-span-2 sm:col-auto"
												onclick={() => confirmExcluir.openDialog({ id: op.id, nome: op.nome })}
											>
												<Trash2 class="w-3.5 h-3.5" />
												Excluir
											</button>
										{/if}
									</div>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<!-- Painel 2: o formulário, sozinho na tela.

		     `{#key}` remonta o componente ao trocar de operação: os campos são
		     `value=` não-controlado (para o navegador poder restaurar o que o admin
		     digitou), então sem a remontagem passar de uma linha a outra manteria o
		     texto da anterior. -->
		<div class="min-w-0 px-1" style="width: 50%;">
			{#if painelAberto}
				{#key paramForm}
					<FormularioOperacao
						operacao={emEdicao}
						herdado={data.herdado}
						baseaveis={data.operacoes}
						aoVoltar={voltarParaLista}
						{enviar}
					/>
				{/key}
			{/if}
		</div>
	</div>
</div>

<!-- Fora do slider: dentro dele o modal deslizaria junto com o painel. -->
<ModalShell
	bind:open={escolhendoTipo}
	title="O que você vai cadastrar?"
	largura="lg"
	familia="gise"
	cancelLabel="Cancelar"
>
	{#snippet description()}
		São dois cadastros diferentes, e a escolha não se desfaz depois: cada um tem tela, dados e
		documento próprios.
	{/snippet}

	<div class="grid gap-3 sm:grid-cols-2">
		<button
			type="button"
			class="rounded-xl border border-surface-200 dark:border-white/10 p-4 text-left space-y-1.5 transition-colors hover:border-primary-500/60 hover:bg-primary-500/5 focus-visible:ring-2 focus-visible:ring-primary-500"
			onclick={() => {
				escolhendoTipo = false;
				abrir('nova');
			}}
		>
			<span class="flex items-center gap-2 font-semibold text-surface-900 dark:text-white">
				<ClipboardCheck class="w-4 h-4 text-primary-600 dark:text-primary-400" />
				Operação
			</span>
			<span class="block text-xs text-surface-600 dark:text-surface-400">
				O catálogo de que as escalas extras dependem — GISE, CRAJUBAR. Tem formulário de
				produtividade, indicadores e recebe escala por dia.
			</span>
		</button>

		<button
			type="button"
			class="rounded-xl border border-surface-200 dark:border-white/10 p-4 text-left space-y-1.5 transition-colors hover:border-primary-500/60 hover:bg-primary-500/5 focus-visible:ring-2 focus-visible:ring-primary-500"
			onclick={() => {
				escolhendoTipo = false;
				goto('/operacoes/planos/novo');
			}}
		>
			<span class="flex items-center gap-2 font-semibold text-surface-900 dark:text-white">
				<FileText class="w-4 h-4 text-primary-600 dark:text-primary-400" />
				Plano operacional
			</span>
			<span class="block text-xs text-surface-600 dark:text-surface-400">
				Operação com deslocamento de equipes para cumprimento de mandados. Tem viatura, destino e
				custo por equipe, e gera o PDF do plano.
			</span>
		</button>
	</div>
</ModalShell>

<ModalShell
	bind:open={confirmExcluir.isOpen}
	title="Excluir operação?"
	largura="sm"
	pending={loading.active}
	cancelLabel="Cancelar"
>
	{#snippet description()}
		A operação <strong>{confirmExcluir.currentItem?.nome}</strong> e o formulário de produtividade dela
		serão apagados. Ela não tem escala nenhuma, então nenhum relatório ou PDF assinado aponta para ela
		— mas o formulário, com as perguntas e os indicadores configurados, vai junto e não há como desfazer.
	{/snippet}

	{#snippet footer()}
		<form
			method="POST"
			action="?/excluir"
			use:enhance={enviar('Operação excluída', () => confirmExcluir.closeDialog())}
			class="contents"
		>
			<input type="hidden" name="id" value={confirmExcluir.currentItem?.id} />
			<button
				type="submit"
				class="btn btn-sm preset-filled-error-500 flex items-center gap-2"
				disabled={loading.active}
			>
				<Trash2 class="w-4 h-4" />
				Excluir operação
			</button>
		</form>
	{/snippet}
</ModalShell>
