<script lang="ts">
	/**
	 * Editor do plano operacional.
	 *
	 * Três blocos, na ordem em que o documento é montado: os parâmetros gerais
	 * (o corpo), as equipes (Anexo I) e o consolidado financeiro (Anexo II).
	 *
	 * O cabeçalho abre RECOLHIDO. Depois da criação ele já está preenchido, e o
	 * trabalho do dia a dia é nas equipes — deixá-lo expandido empurraria a
	 * primeira equipe para fora da tela em todo acesso. Aberto, o mesmo quadro
	 * permanece (o contorno não some) e os blocos internos usam o mesmo
	 * `card-quadro` da criação (`novo/+page.svelte`): identificação, finalidade,
	 * ações, opções, calendário ao lado de estrutura/comando/signatário.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { invalidate } from '$app/navigation';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import { fmtDate } from '$lib/gise/formatters';
	import { formatarBRL } from '$lib/planos/rotulos';
	import { cargoSignatarioValido } from '$lib/planos/padroes';
	import CampoNup from '../_components/CampoNup.svelte';
	import CamposAcoes from '../_components/CamposAcoes.svelte';
	import CamposComando from '../_components/CamposComando.svelte';
	import CamposDataExecucao from '../_components/CamposDataExecucao.svelte';
	import CamposSignatario from '../_components/CamposSignatario.svelte';
	import TituloSecao from '../_components/TituloSecao.svelte';
	import EditorOpcoes from './_components/EditorOpcoes.svelte';
	import { formatarNUP } from '$lib/utils/formato';
	import EquipeCard from './_components/EquipeCard.svelte';
	import PainelCustos from './_components/PainelCustos.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	const { data, form }: PageProps = $props();

	let cabecalhoAberto = $state(false);

	// svelte-ignore state_referenced_locally
	let dataInicio = $state(data.plano.data_inicio);
	// svelte-ignore state_referenced_locally
	let feriado = $state(data.plano.feriado);
	// svelte-ignore state_referenced_locally
	let horaInicio = $state(data.plano.hora_inicio);
	// svelte-ignore state_referenced_locally
	let horaFim = $state(data.plano.hora_fim ?? '');
	// svelte-ignore state_referenced_locally
	let dataFim = $state(data.plano.data_fim ?? '');

	// Captura intencional: os dois selects passam a ser do usuário depois da
	// primeira renderização, e re-derivá-los apagaria uma escolha em curso.
	// svelte-ignore state_referenced_locally
	let coordenadorId = $state<unknown>(data.plano.coordenador_id);
	// svelte-ignore state_referenced_locally
	let demandanteId = $state<unknown>(data.plano.demandante_unidade_id);
	// svelte-ignore state_referenced_locally
	let diretorId = $state<unknown>(data.plano.diretor_id);
	// svelte-ignore state_referenced_locally
	let diretorCargo = $state(cargoSignatarioValido(data.plano.diretor_cargo, data.cargos));
	// svelte-ignore state_referenced_locally
	let nup = $state(formatarNUP(data.plano.nup ?? ''));

	/**
	 * O que os `SearchableSelect` mostram ao abrir a tela, sem ir ao servidor.
	 *
	 * Sem isto o campo abre VAZIO num plano que tem coordenador — parece que
	 * ninguém foi designado, e salvar por cima apagaria a designação.
	 */
	const opcaoCoordenador = $derived(
		data.coordenadorNome && data.plano.coordenador_id
			? { value: data.plano.coordenador_id, label: data.coordenadorNome }
			: null
	);
	const opcaoDiretor = $derived(
		data.plano.diretor_id && data.plano.diretor_nome
			? { value: data.plano.diretor_id, label: data.plano.diretor_nome }
			: null
	);
	const opcaoDemandante = $derived(
		data.demandanteNome && data.plano.demandante_unidade_id
			? { value: data.plano.demandante_unidade_id, label: data.demandanteNome }
			: null
	);

	/** `policial_id` de quem impede a emissão — o card marca esses membros. */
	const pendentes = $derived(new Set(data.custo.pendencias.map((p) => p.policial_id)));

	const efetivoTotal = $derived(data.equipes.reduce((s, e) => s + e.membros.length, 0));
	/** Quantidade operacional — a mesma conta do campo na criação; SEINT é à parte. */
	const qtdOperacionais = $derived(data.equipes.filter((e) => e.tipo !== 'seint').length);
	const temSeint = $derived(data.equipes.some((e) => e.tipo === 'seint'));

	/** `use:enhance` comum: toast do erro do servidor e revalidação da página. */
	function enviar(mensagemOk: string, aoConcluir?: () => void): SubmitFunction {
		return () => {
			loading.show('A gravar…');
			return async ({ result }: { result: { type: string; data?: unknown } }) => {
				loading.hide();
				if (result.type === 'success') {
					toaster.success({ title: mensagemOk });
					await invalidate('planos:detalhe');
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
	<title>Plano {data.plano.numero}/{data.plano.ano} | Ecossistema PCCE</title>
</svelte:head>

<div class="min-w-0 space-y-6">
	<div>
		<BotaoVoltar href="/gise/planos" />
		<div class="flex min-w-0 flex-wrap items-center gap-2 mt-2">
			<h1 class="h1 text-2xl font-bold min-w-0 break-words">{data.plano.nome}</h1>
			<span
				class="rounded-full bg-primary-500/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-primary-700 dark:text-primary-300"
			>
				{data.plano.numero}/{data.plano.ano}
			</span>
		</div>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-0.5 break-words">
			{fmtDate(data.plano.data_inicio)} às {data.plano.hora_inicio}
			{#if data.plano.feriado}
				<span class="text-error-600 dark:text-error-400 font-medium">· feriado</span>
			{/if}
			· {data.equipes.length}
			{data.equipes.length === 1 ? 'equipe' : 'equipes'} · {efetivoTotal} servidor(es) ·
			<strong class="text-surface-800 dark:text-surface-100"
				>{formatarBRL(data.custo.consolidado.totalGeral)}</strong
			>
		</p>
	</div>

	<!-- ---- Parâmetros gerais ---- -->
	<!-- Quadro permanente: o contorno não some ao abrir. Aberto, cada bloco
	     interno é `card-quadro rounded-2xl` — o mesmo de Comando e demanda em
	     `/gise/planos/novo`. `hover:shadow` só recolhido. -->
	<section
		class="card-quadro min-w-0 rounded-2xl {cabecalhoAberto
			? ''
			: 'hover:shadow-md transition-shadow duration-300'}"
	>
		<button
			type="button"
			class="w-full flex items-start sm:items-center justify-between gap-3 p-4 sm:p-5 text-left"
			onclick={() => (cabecalhoAberto = !cabecalhoAberto)}
			aria-expanded={cabecalhoAberto}
		>
			<span class="min-w-0">
				<span class="block text-base font-semibold text-surface-900 dark:text-white"
					>Parâmetros gerais</span
				>
				<span class="block text-xs text-surface-600 dark:text-surface-400">
					Finalidade, calendário, coordenador e demandante — o corpo do documento.
				</span>
			</span>
			<ChevronDown
				class="w-5 h-5 shrink-0 transition-transform {cabecalhoAberto ? 'rotate-180' : ''}"
				aria-hidden="true"
			/>
		</button>

		{#if cabecalhoAberto}
			<!-- `contents` no form: as opções têm form próprio e NÃO podem viver
			     dentro deste. Sem `contents` elas só caberiam depois do Salvar;
			     com ele o `order` as encaixa depois das ações, como na criação. -->
			<div class="flex min-w-0 flex-col gap-6 px-4 pb-4 sm:px-6 sm:pb-6">
				<form
					method="POST"
					action="?/salvarPlano"
					use:enhance={enviar('Plano salvo')}
					class="contents"
				>
					<section class="card-quadro order-1 min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
						<TituloSecao texto="Identificação" />
						<div class="grid grid-cols-1 gap-4 md:grid-cols-[4.6fr_2.4fr_3fr]">
							<label class="block min-w-0 space-y-1">
								<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
									>Nome da operação</span
								>
								<input
									name="nome"
									value={data.plano.nome}
									maxlength="160"
									required
									class="input w-full"
								/>
							</label>
							<CampoNup bind:valor={nup} />
							<label class="block min-w-0 space-y-1">
								<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
									>Departamento</span
								>
								<input
									name="departamento"
									value={data.plano.departamento}
									maxlength="60"
									class="input w-full"
								/>
							</label>
						</div>
					</section>

					<section class="card-quadro order-2 min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
						<TituloSecao texto="Finalidade" />
						<textarea
							name="finalidade"
							value={data.plano.finalidade}
							rows="4"
							maxlength="2000"
							class="textarea w-full min-w-0"
							aria-label="Finalidade"></textarea>
					</section>

					<section class="card-quadro order-3 min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
						<TituloSecao texto="Ações a serem realizadas" />
						<CamposAcoes valor={data.plano.acoes} rotulo={false} />
					</section>

					<div class="grid order-5 min-w-0 gap-6 md:grid-cols-[2fr_3fr] md:items-start">
						<CamposDataExecucao
							bind:dataInicio
							bind:feriado
							bind:horaInicio
							bind:horaFim
							bind:dataFim
							apoioTermino="(liga a sugestão)"
							notaRodape="Sem previsão de término, o sistema não sugere a quantidade de horas — ela é digitada por equipe."
						/>

						<div class="min-w-0 space-y-6">
							<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
								<TituloSecao
									texto="Estrutura"
									apoio="Quantidade e SEINT mudam pelos botões do Anexo I."
								/>
								<div class="flex flex-wrap items-start gap-4">
									<label class="block min-w-0 w-full space-y-1 xs:w-auto">
										<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
											>Qtd. de equipes</span
										>
										<input
											type="number"
											value={qtdOperacionais}
											disabled
											title="Altere no Anexo I"
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
											value={data.plano.oip_por_equipe_padrao}
											min="0"
											max="99"
											class="input w-full xs:w-28"
										/>
									</label>
									<div
										class="flex min-w-0 w-full items-start gap-3 opacity-70 xs:flex-1"
										title="Altere no Anexo I"
									>
										<input
											type="checkbox"
											checked={temSeint}
											disabled
											class="checkbox mt-0.5"
											aria-label="Incluir equipe SEINT"
										/>
										<span class="space-y-0.5">
											<span class="block text-sm font-medium text-surface-900 dark:text-white"
												>Incluir equipe SEINT</span
											>
											<span class="block text-xs text-surface-600 dark:text-surface-400">
												Uma só, atendendo todas as operacionais.
											</span>
										</span>
									</div>
								</div>
							</section>

							<CamposComando
								bind:coordenadorId
								bind:demandanteId
								coordenadorSelecionado={opcaoCoordenador}
								demandanteSelecionado={opcaoDemandante}
							/>

							<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
								<TituloSecao
									texto="Signatário do plano"
									apoio="Quem assina o documento. Varia por operação — o Titular assina umas, o Adjunto outras."
								/>
								<CamposSignatario
									bind:diretorId
									bind:cargo={diretorCargo}
									cargos={data.cargos}
									selecionado={opcaoDiretor}
									nomePadrao={data.plano.diretor_id ? '' : data.plano.diretor_nome}
								/>
							</section>
						</div>
					</div>

					{#if form?.error}
						<p
							class="order-6 rounded-xl border border-error-500/30 bg-error-500/10 p-3 text-sm text-error-700 dark:text-error-300"
						>
							{form.error}
						</p>
					{/if}

					<div
						class="order-7 flex justify-stretch sm:justify-end gap-2 pt-4 pb-4 border-t border-surface-200/70 dark:border-white/10"
					>
						<button
							type="submit"
							class="btn preset-filled-primary-500 py-2.5 px-4 rounded-xl text-sm w-full sm:w-auto justify-center"
							disabled={loading.active}
						>
							Salvar parâmetros
						</button>
					</div>
				</form>

				<section class="card-quadro order-4 min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
					<TituloSecao
						texto="Opções das equipes"
						apoio="O que os seletores de cada equipe oferecem. A marcada com estrela vem pré-preenchida nas equipes novas."
					/>
					<div class="grid gap-4 md:grid-cols-3">
						<EditorOpcoes
							tipo="origem"
							modo="cidade"
							municipios={data.municipios}
							rotulo="Cidades de origem"
							descricao="De onde as equipes saem — mede a distância."
							exemplo="Jucás"
							opcoes={data.opcoes.origem}
							{enviar}
						/>
						<EditorOpcoes
							tipo="briefing"
							modo="local"
							municipios={data.municipios}
							rotulo="Locais de briefing"
							descricao="Onde as equipes se apresentam."
							exemplo="Sede da 4ª Seccional do Interior Sul"
							opcoes={data.opcoes.briefing}
							{enviar}
						/>
						<EditorOpcoes
							tipo="destino"
							modo="cidade"
							municipios={data.municipios}
							rotulo="Cidades de destino"
							descricao="Para onde as equipes se deslocam."
							exemplo="Acopiara"
							opcoes={data.opcoes.destino}
							{enviar}
						/>
					</div>
				</section>
			</div>
		{/if}
	</section>

	<!-- ---- Equipes (Anexo I) ---- -->
	<!-- Quadro estático, como o Documento: agrupa o anexo. Sem `hover:shadow` —
	     quem abre ao clique é cada equipe, não este contorno. -->
	<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-6 space-y-4">
		<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
			<div>
				<h2 class="text-base font-semibold text-surface-900 dark:text-white">
					Anexo I — equipes e efetivo
				</h2>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					Viatura, destino, briefing e custo de cada equipe.
				</p>
			</div>
			<div class="flex gap-2">
				<form
					method="POST"
					action="?/adicionarEquipe"
					use:enhance={enviar('Equipe acrescentada')}
					class="min-w-0 flex-1 sm:flex-none"
				>
					<input type="hidden" name="tipo" value="operacional" />
					<button
						type="submit"
						class="btn btn-sm preset-outlined-surface-500 px-3 py-1.5 rounded-xl text-xs w-full justify-center"
					>
						<Plus class="w-3.5 h-3.5" />
						Equipe
					</button>
				</form>
				<form
					method="POST"
					action="?/adicionarEquipe"
					use:enhance={enviar('Equipe SEINT criada')}
					class="min-w-0 flex-1 sm:flex-none"
				>
					<input type="hidden" name="tipo" value="seint" />
					<button
						type="submit"
						class="btn btn-sm preset-outlined-surface-500 px-3 py-1.5 rounded-xl text-xs w-full justify-center"
					>
						<Plus class="w-3.5 h-3.5" />
						SEINT
					</button>
				</form>
			</div>
		</div>

		{#if data.equipes.length === 0}
			<p
				class="rounded-2xl border border-dashed border-surface-300 dark:border-white/10 p-6 text-center text-sm text-surface-600 dark:text-surface-400"
			>
				Nenhuma equipe. Use os botões acima para acrescentar.
			</p>
		{:else}
			<ul class="grid grid-cols-1 gap-3 lg:grid-cols-2">
				{#each data.equipes as eq, i (eq.id)}
					{#key `${eq.id}-${eq.tipo_custo}-${eq.horas_normais}-${eq.horas_plus}-${eq.diarias_meias}`}
						<EquipeCard
							equipe={eq}
							indice={i + 1}
							{enviar}
							{pendentes}
							opcoesBriefing={data.opcoes.briefing}
							opcoesOrigem={data.opcoes.origem}
							opcoesDestino={data.opcoes.destino}
							matriz={new Map(Object.entries(data.matrizDistancias))}
							medicao={data.medicao}
							limiteKm={data.limiteKm}
							briefingPadrao={data.briefingPadrao}
							origemPadrao={data.origemPadrao}
							destinoPadrao={data.destinoPadrao}
						/>
					{/key}
				{/each}
			</ul>
		{/if}
	</section>

	<!-- ---- Custos (Anexo II) ---- -->
	<PainelCustos custo={data.custo} versaoValores={data.versaoValores} />

	<!-- ---- Ações do documento ---- -->
	<!-- Quadro estático: leva o contorno, mas NÃO o `hover:shadow-md` dos blocos
	     que abrem (parâmetros, equipes, Anexo II) — aqui não há disclosure, e
	     sombra reagindo ao ponteiro prometeria um clique que a seção não tem. -->
	<section class="card-quadro min-w-0 rounded-2xl p-4 sm:p-5 space-y-3">
		<h2 class="text-base font-semibold text-surface-900 dark:text-white">Documento</h2>

		<div class="flex flex-col gap-2 xs:flex-row xs:flex-wrap">
			<a
				href="/api/planos/{data.plano.id}/download"
				class="btn preset-filled-primary-500 py-2.5 px-4 rounded-xl text-sm w-full xs:w-auto justify-center {data.podeEmitir
					? ''
					: 'pointer-events-none opacity-50'}"
				aria-disabled={!data.podeEmitir}
			>
				Baixar plano operacional (PDF)
			</a>

			<form
				method="POST"
				action="?/ressincronizarCadastro"
				use:enhance={enviar('Cargo/classe reaplicados do cadastro')}
			>
				<button
					type="submit"
					class="btn preset-outlined-surface-500 py-2.5 px-4 rounded-xl text-sm w-full xs:w-auto justify-center"
					title="Reaplica cargo e classe atuais do cadastro aos membros já alocados"
				>
					<RefreshCw class="w-4 h-4" />
					Reaplicar cargo/classe do cadastro
				</button>
			</form>

			<form method="POST" action="?/alternarStatus" use:enhance={enviar('Status alterado')}>
				<button
					type="submit"
					class="btn preset-outlined-surface-500 py-2.5 px-4 rounded-xl text-sm w-full xs:w-auto justify-center"
				>
					{data.plano.status === 'concluido' ? 'Reabrir como rascunho' : 'Marcar como concluído'}
				</button>
			</form>
		</div>

		{#if !data.podeEmitir}
			<p class="text-xs text-error-600 dark:text-error-400">
				O PDF fica bloqueado enquanto houver servidor sem classe resolvida em equipe com custo —
				emitir assim produziria um documento orçado a menor.
			</p>
		{/if}
	</section>
</div>
