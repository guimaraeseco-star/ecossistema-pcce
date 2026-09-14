<script lang="ts">
	/**
	 * Criação do plano operacional — os parâmetros gerais.
	 *
	 * Rota, e não modal (README §10): são dezoito campos mais o calendário. O
	 * agrupamento segue a ordem do documento — identificação, finalidade, ações,
	 * opções das equipes, calendário ao lado de estrutura/comando/signatário.
	 *
	 * ## Diagramação: `card-quadro`, não `card-elevated` e não um fluxo único
	 *
	 * O `+layout.svelte` já entrega a página dentro de uma FOLHA (`max-w-6xl` com
	 * borda e fundo branco em `xl`). Empilhar `card-elevated` aqui dentro desenha
	 * cartão sobre cartão. Separar só por título e uma linha, porém, deixa os
	 * dezoito campos no mesmo peso — identificação, calendário, listas e
	 * estrutura viram um bloco só.
	 *
	 * `card-quadro` é o contorno que o editor já usa nos quatro blocos do plano:
	 * separa o vizinho (borda 2px), não a página. Sem `hover:shadow-md` — estes
	 * quadros não abrem ao clique. O formulário ocupa a largura da folha; só
	 * campo intrinsecamente curto (hora, quantidade) ganha teto.
	 *
	 * Tudo aqui é EDITÁVEL depois no editor. O que se pede na criação é só o que
	 * o plano precisa para existir com um número e uma data; obrigar o
	 * preenchimento completo antes de criar transformaria a tela num muro.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import { HORA_FIM_PADRAO, HORA_INICIO_PADRAO } from '$lib/planos/padroes';
	import CampoNup from '../_components/CampoNup.svelte';
	import CamposAcoes from '../_components/CamposAcoes.svelte';
	import CamposComando from '../_components/CamposComando.svelte';
	import CamposDataExecucao from '../_components/CamposDataExecucao.svelte';
	import CamposSignatario from '../_components/CamposSignatario.svelte';
	import ListaOpcoes from '../_components/ListaOpcoes.svelte';
	import TituloSecao from '../_components/TituloSecao.svelte';
	import {
		acrescentarNaLista,
		definirPadraoNaLista,
		removerDaLista,
		padraoDaLista,
		type OpcaoEmLista
	} from '$lib/planos/opcoes';
	import Star from '@lucide/svelte/icons/star';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	const { data, form }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let dataInicio = $state(data.hoje);
	let feriado = $state(false);
	let horaInicio = $state(HORA_INICIO_PADRAO);
	let horaFim = $state(HORA_FIM_PADRAO);
	let dataFim = $state('');
	let nome = $state('');
	let nup = $state('');
	// svelte-ignore state_referenced_locally
	let finalidade = $state(data.finalidadePadrao);
	/**
	 * As três listas de opções, montadas ANTES de o plano existir.
	 *
	 * Ficam em memória e viajam como arrays de campos ocultos no mesmo POST que
	 * cria o plano — não há `plano_id` para gravá-las contra. As regras (primeira
	 * nasce padrão, sem repetir valor, removida a padrão a próxima assume) vêm de
	 * `$lib/planos/opcoes`, as MESMAS que o editor aplica depois contra o banco.
	 */
	let listaBriefing = $state<OpcaoEmLista[]>([]);
	let listaOrigem = $state<OpcaoEmLista[]>([]);
	let listaDestino = $state<OpcaoEmLista[]>([]);

	let qtdEquipes = $state(3);
	let oipPorEquipe = $state(4);
	let temSeint = $state(false);

	let coordenadorId = $state<unknown>(null);
	let demandanteId = $state<unknown>(null);
	let diretorId = $state<unknown>(null);
	// svelte-ignore state_referenced_locally
	let diretorCargo = $state(data.cargos[0]);

	/** Nome do município por código — a lista exibe o nome, o POST manda o código. */
	const nomePorIbge = $derived(new Map(data.municipios.map((m) => [m.ibge, m.nome])));
	const nomeDoMunicipio = (ibge: string | null) => (ibge ? (nomePorIbge.get(ibge) ?? null) : null);

	const podeCriar = $derived(nome.trim().length > 0 && dataInicio !== '');
</script>

<svelte:head><title>Novo plano operacional | Ecossistema PCCE</title></svelte:head>

<div class="min-w-0 space-y-6">
	<div>
		<BotaoVoltar href="/operacoes/planos" />
		<h1 class="h1 text-2xl font-bold mt-2">Novo plano operacional</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
			Os parâmetros gerais da operação. Tudo pode ser ajustado depois — viaturas, destinos, efetivo
			e custos são preenchidos por equipe no editor.
		</p>
	</div>

	<!-- Os botões de cada linha das três listas. Um snippet só porque são os
	     mesmos três em cada uma — e `type="button"`, porque este bloco vive dentro
	     do formulário que cria o plano: um submit aqui enviaria o plano pela
	     metade ao marcar uma estrela. -->
	{#snippet botoes(
		o: { chave: string | number; padrao: boolean },
		aoPadrao: () => void,
		aoRemover: () => void
	)}
		{#if !o.padrao}
			<button
				type="button"
				class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-2xs"
				title="Usar como padrão nas equipes criadas"
				onclick={aoPadrao}
			>
				<Star class="w-3.5 h-3.5" />
				Padrão
			</button>
		{/if}
		<button
			type="button"
			class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-2xs"
			title="Remover da lista"
			onclick={aoRemover}
		>
			<Trash2 class="w-3.5 h-3.5" />
		</button>
	{/snippet}

	{#if !data.temValores}
		<p
			class="flex gap-2 rounded-xl border border-warning-500/30 bg-warning-500/10 p-3 text-sm text-warning-700 dark:text-warning-300"
		>
			<TriangleAlert class="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
			<span>
				Ainda não há tabela de valores gravada. O plano pode ser criado, mas o Anexo II sairia
				zerado — peça ao Super Administrador para preencher <strong>Valores de custo</strong> antes de
				emitir o documento.
			</span>
		</p>
	{/if}

	<form
		method="POST"
		action="?/criar"
		use:enhance={() => {
			loading.show('Criando o plano…');
			return async ({ result, update }) => {
				loading.hide();
				if (result.type === 'failure') {
					toaster.error({ title: String(result.data?.error ?? 'Não foi possível criar') });
				}
				await update({ reset: false });
			};
		}}
		class="space-y-6"
	>
		<!-- ---- Identificação ---- -->
		<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
			<TituloSecao texto="Identificação" />

			<!-- Nome, NUP e departamento na mesma linha a partir de `md`. NUP a 60%
			     da fatia que tinha (40% menor); o que sobra vai para o nome. -->
			<div class="grid grid-cols-1 gap-4 md:grid-cols-[4.6fr_2.4fr_3fr]">
				<label class="block min-w-0 space-y-1">
					<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
						>Nome da operação</span
					>
					<input
						name="nome"
						bind:value={nome}
						maxlength="160"
						required
						placeholder="Ex.: Operação Gladius"
						class="input w-full"
					/>
				</label>
				<CampoNup bind:valor={nup} opcional />
				<label class="block min-w-0 space-y-1">
					<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
						>Departamento</span
					>
					<input
						name="departamento"
						value={data.departamentoSigla}
						maxlength="60"
						class="input w-full"
					/>
				</label>
			</div>
		</section>

		<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
			<TituloSecao texto="Finalidade" />
			<textarea
				name="finalidade"
				bind:value={finalidade}
				rows="4"
				maxlength="2000"
				class="textarea w-full min-w-0"
				aria-label="Finalidade"></textarea>
		</section>

		<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
			<TituloSecao texto="Ações a serem realizadas" />
			<CamposAcoes valor={data.acoesPadrao} rotulo={false} />
		</section>

		<!-- ---- Opções das equipes ---- -->
		<!-- Montadas AQUI, e não só no editor: a operação que sai para três cidades
		     declara as três antes de criar o plano. Cada lista vira campos ocultos
		     no POST; o servidor as grava depois de o plano existir. -->
		<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
			<TituloSecao
				texto="Opções das equipes"
				apoio="O que os seletores de cada equipe vão oferecer. A marcada com estrela vem pré-preenchida nas equipes criadas — e todas continuam editáveis no plano."
			/>

			<div class="grid gap-4 md:grid-cols-3">
				<ListaOpcoes
					rotulo="Cidades de origem"
					descricao="De onde as equipes saem — mede a distância."
					exemplo="Jucás"
					opcoes={listaOrigem.map((o) => ({ chave: o.valor, ...o }))}
					modo="cidade"
					municipios={data.municipios}
					aoAcrescentar={(v, m) => (listaOrigem = acrescentarNaLista(listaOrigem, v, m))}
				>
					{#snippet acoes(o)}
						{@render botoes(
							o,
							() => (listaOrigem = definirPadraoNaLista(listaOrigem, String(o.chave))),
							() => (listaOrigem = removerDaLista(listaOrigem, String(o.chave)))
						)}
					{/snippet}
				</ListaOpcoes>

				<ListaOpcoes
					rotulo="Locais de briefing"
					descricao="Onde as equipes se apresentam."
					exemplo="Sede da 4ª Seccional do Interior Sul"
					opcoes={listaBriefing.map((o) => ({
						chave: o.valor,
						...o,
						municipio: nomeDoMunicipio(o.municipio)
					}))}
					modo="local"
					municipios={data.municipios}
					aoAcrescentar={(v, m) => (listaBriefing = acrescentarNaLista(listaBriefing, v, m))}
				>
					{#snippet acoes(o)}
						{@render botoes(
							o,
							() => (listaBriefing = definirPadraoNaLista(listaBriefing, String(o.chave))),
							() => (listaBriefing = removerDaLista(listaBriefing, String(o.chave)))
						)}
					{/snippet}
				</ListaOpcoes>

				<ListaOpcoes
					rotulo="Cidades de destino"
					descricao="Para onde as equipes se deslocam."
					exemplo="Acopiara"
					opcoes={listaDestino.map((o) => ({ chave: o.valor, ...o }))}
					modo="cidade"
					municipios={data.municipios}
					aoAcrescentar={(v, m) => (listaDestino = acrescentarNaLista(listaDestino, v, m))}
				>
					{#snippet acoes(o)}
						{@render botoes(
							o,
							() => (listaDestino = definirPadraoNaLista(listaDestino, String(o.chave))),
							() => (listaDestino = removerDaLista(listaDestino, String(o.chave)))
						)}
					{/snippet}
				</ListaOpcoes>
			</div>

			<!-- O que de fato viaja no POST. Um campo por opção, mais o valor da
			     padrão de cada tipo — o servidor recria a lista na ordem e marca a
			     estrela depois de inserir todas. -->
			{#each listaBriefing as o (o.valor)}
				<input type="hidden" name="opcao_briefing" value={o.valor} />
				<input type="hidden" name="municipio_briefing" value={o.municipio ?? ''} />
			{/each}
			{#each listaOrigem as o (o.valor)}
				<input type="hidden" name="opcao_origem" value={o.valor} />
				<input type="hidden" name="municipio_origem" value={o.municipio ?? ''} />
			{/each}
			{#each listaDestino as o (o.valor)}
				<input type="hidden" name="opcao_destino" value={o.valor} />
				<input type="hidden" name="municipio_destino" value={o.municipio ?? ''} />
			{/each}
			<input type="hidden" name="padrao_briefing" value={padraoDaLista(listaBriefing)} />
			<input type="hidden" name="padrao_origem" value={padraoDaLista(listaOrigem)} />
			<input type="hidden" name="padrao_destino" value={padraoDaLista(listaDestino)} />
		</section>

		<!-- ---- Calendário ---- -->
		<!-- Calendário (40%) à esquerda; estrutura, comando e signatário
		     empilhados à direita. Horários ficam ABAIXO do calendário. Em tela
		     estreita os quadros empilham. Sem `hover:shadow`: nenhum abre ao clique. -->
		<div class="grid gap-6 md:grid-cols-[2fr_3fr] md:items-start">
			<CamposDataExecucao
				bind:dataInicio
				bind:feriado
				bind:horaInicio
				bind:horaFim
				bind:dataFim
				apoioTermino="(opcional)"
				notaRodape="Sem previsão de término, o sistema não sugere a quantidade de horas — ela é digitada por equipe no editor."
				placeholderHoraInicio={HORA_INICIO_PADRAO}
				placeholderHoraFim={HORA_FIM_PADRAO}
			/>

			<div class="min-w-0 space-y-6">
				<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
					<TituloSecao
						texto="Estrutura inicial"
						apoio="As equipes nascem como “Equipe 01”, “Equipe 02”… e podem ser renomeadas, acrescentadas ou removidas no editor."
					/>

					<div class="flex flex-wrap items-start gap-4">
						<label class="block min-w-0 w-full space-y-1 xs:w-auto">
							<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
								>Qtd. de equipes</span
							>
							<input
								type="number"
								name="qtd_equipes"
								bind:value={qtdEquipes}
								min="0"
								max="50"
								class="input w-full xs:w-28"
							/>
						</label>
						<label class="block min-w-0 w-full space-y-1 xs:w-auto">
							<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
								>OIPs por equipe</span
							>
							<input
								type="number"
								name="oip_por_equipe"
								bind:value={oipPorEquipe}
								min="0"
								max="99"
								class="input w-full xs:w-28"
							/>
						</label>
						<label class="flex min-w-0 w-full items-start gap-3 cursor-pointer xs:flex-1">
							<input
								type="checkbox"
								name="tem_seint"
								bind:checked={temSeint}
								class="checkbox mt-0.5"
							/>
							<span class="space-y-0.5">
								<span class="block text-sm font-medium text-surface-900 dark:text-white"
									>Incluir equipe SEINT</span
								>
								<span class="block text-xs text-surface-600 dark:text-surface-400">
									Uma só, atendendo todas as operacionais.
								</span>
							</span>
						</label>
					</div>
				</section>

				<CamposComando bind:coordenadorId bind:demandanteId />

				<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
					<TituloSecao
						texto="Signatário do plano"
						apoio="Quem assina o documento. Varia por operação — o Titular assina umas, o Adjunto outras."
					/>

					<CamposSignatario bind:diretorId bind:cargo={diretorCargo} cargos={data.cargos} />
				</section>
			</div>
		</div>

		{#if form?.error}
			<p
				class="rounded-xl border border-error-500/30 bg-error-500/10 p-3 text-sm text-error-700 dark:text-error-300"
			>
				{form.error}
			</p>
		{/if}

		<div
			class="flex flex-col-reverse gap-2 pt-4 pb-4 border-t border-surface-200/70 dark:border-white/10 xs:flex-row xs:justify-end"
		>
			<a
				href="/operacoes/planos"
				class="btn preset-outlined-surface-500 py-2.5 px-4 rounded-xl text-sm w-full xs:w-auto justify-center"
			>
				Cancelar
			</a>
			<button
				type="submit"
				class="btn preset-filled-primary-500 py-2.5 px-4 rounded-xl text-sm w-full xs:w-auto justify-center"
				disabled={loading.active || !podeCriar}
			>
				Criar plano
			</button>
		</div>
	</form>
</div>
