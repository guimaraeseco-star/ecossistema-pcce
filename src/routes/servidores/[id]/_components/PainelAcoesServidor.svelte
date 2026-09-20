<script lang="ts">
	/**
	 * Os três atos de RH sobre um servidor: movimentar (trocar de lotação),
	 * afastar (férias/licença) e desvincular (baixa). Um modal cada, três form
	 * actions do `+page.server.ts` (`?/registrarMovimentacao`,
	 * `?/registrarAfastamento`, `?/registrarDesvinculacao`).
	 *
	 * **O mesmo painel tem dois desfechos**, decididos por `modo` (que vem do
	 * portão da ficha, não da tela):
	 *
	 *  - `direto` — Admin Geral: o ato acontece na hora e vira linha na timeline;
	 *  - `solicitacao` — admin de seccional/unidade: o ato vira PEDIDO, com
	 *    justificativa obrigatória, e só acontece se o Admin Geral aprovar. Neste
	 *    modo só existe o AFASTAMENTO: movimentação e desvinculação são do Admin
	 *    Geral (decisão dele, 20/09) e nem aparecem — a action recusa também.
	 *
	 * Férias não estão na lista de afastamentos: entram pelo cartão Férias.
	 *
	 * O PDF anexo sobe nos DOIS modos, e é isso que permite ao Admin Geral baixar
	 * a portaria antes de decidir. O texto dos botões muda junto: um painel que
	 * diz "Salvar" e apenas envia um pedido é a forma mais barata de alguém
	 * acreditar que transferiu um servidor que continua onde estava.
	 *
	 * Nenhum dos três é só um registro: no modo direto cada um grava uma linha
	 * APPEND-ONLY em `policial_historico`, que é a visão de RH do servidor e não
	 * se apaga pela interface. Daí o `invalidateShared` no sucesso — a timeline
	 * logo abaixo (`HistoricoServidor`) precisa refletir o que acabou de ser
	 * gravado, e no modo solicitação é o quadro de pedidos que precisa.
	 *
	 * No afastamento, "Qtd de dias" e "Data final" são o MESMO dado por dois
	 * caminhos, e cada campo recalcula o outro. A contagem é INCLUSIVA (um
	 * afastamento de 1 dia começa e termina no mesmo dia), daí o `q - 1` em
	 * `adicionarDias` — tratar como exclusiva desloca todo afastamento em um dia.
	 *
	 * O modal de afastamento segue a tabela do responsável (20/09/2026, adotada
	 * do sistema anterior): tipos por categoria, caixa com a base legal e a
	 * observação, prazo FIXO travado (casamento 8, luto 8/2, paternidade 20,
	 * maternidade 120 + 60 a pedido, adotante 180), sem prazo onde não há
	 * (estudante, dispensa de ponto), CID na LTS — e CID-F abre a caixa
	 * vermelha da Portaria 39/2026 (recolher o armamento), que avisa quem
	 * cadastra na hora e o DPI SUL na fila/ficha. NUP obrigatório, 17 dígitos.
	 * A action reaplica tudo.
	 */
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { enhance } from '$app/forms';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { toaster } from '$lib/toast';
	import { loading } from '$lib/loading.svelte';
	import { adicionarDias, diffDiasInclusivo } from '$lib/utils/datas';
	import { formatarNUP } from '$lib/utils/formato';
	import { MAX_JUSTIFICATIVA } from '$lib/cadastro-campos';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import CalendarOff from '@lucide/svelte/icons/calendar-off';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import type { ActionResult } from '@sveltejs/kit';
	import {
		AFASTAMENTOS,
		conferirNup,
		PORTARIA_39,
		regraDePrazo,
		subtiposPorCategoria,
		type SubtipoAfastamento
	} from '$lib/servidores/afastamentos';

	interface Props {
		policial: { id: number; nome: string; matricula: string; lotacao: string };
		lotacoes: string[];
		/** `direto` executa; `solicitacao` envia para aprovação do Admin Geral. */
		modo: 'direto' | 'solicitacao';
	}

	const { policial, lotacoes, modo }: Props = $props();

	const solicitando = $derived(modo === 'solicitacao');

	type Modal = 'movimentacao' | 'afastamento' | 'desvinculacao' | null;
	let modal = $state<Modal>(null);
	let enviando = $state(false);

	// ---- Campos controlados (resetados ao fechar) ----
	let unidadeDestino = $state('');
	/** Os tipos que ESTE perfil pode lançar, por categoria (disciplinares só no modo direto). */
	const grupos = $derived(subtiposPorCategoria(!solicitando));
	const primeiroSubtipo = $derived(grupos[0]?.subtipos[0] ?? 'outros');
	let subtipo = $state<SubtipoAfastamento>('casamento');
	let tipoCid = $state<'CID-Outras' | 'CID-F'>('CID-Outras');
	let adicional = $state(false);
	const meta = $derived(AFASTAMENTOS[subtipo]);
	const regra = $derived(regraDePrazo(subtipo, adicional));
	let descricao = $state('');
	let dataInicio = $state('');
	let qtdDias = $state('');
	let dataFim = $state('');
	let destino = $state('');
	let dataEvento = $state('');
	let nup = $state('');
	let justificativa = $state('');
	const nupConferido = $derived(conferirNup(nup, modal === 'afastamento'));

	/** No modo solicitação, nada é enviado sem motivo escrito; no afastamento, sem NUP válido. */
	const bloqueado = $derived(
		enviando ||
			(solicitando && justificativa.trim().length === 0) ||
			(modal === 'afastamento' && !nupConferido.ok)
	);

	function resetCampos() {
		unidadeDestino = '';
		subtipo = primeiroSubtipo;
		tipoCid = 'CID-Outras';
		adicional = false;
		descricao = '';
		dataInicio = '';
		qtdDias = '';
		dataFim = '';
		destino = '';
		dataEvento = '';
		nup = '';
		justificativa = '';
	}

	function abrir(m: Modal) {
		resetCampos();
		modal = m;
	}

	function fechar() {
		modal = null;
		resetCampos();
	}

	// ---- Afastamento: sincroniza Qtd de dias ⇄ Data final ----
	function recalcularDataFim() {
		const q = parseInt(qtdDias, 10);
		if (dataInicio && q > 0) dataFim = adicionarDias(dataInicio, q - 1);
		else if (!q) dataFim = '';
	}
	function recalcularQtd() {
		const dias = diffDiasInclusivo(dataInicio, dataFim);
		if (dias > 0) qtdDias = String(dias);
	}
	/** Ao trocar o tipo (ou o adicional): prazo fixo entra travado; sem prazo limpa o fim. */
	function aoMudarTipo() {
		if (regra.diasFixos != null) {
			qtdDias = String(regra.diasFixos);
			recalcularDataFim();
		} else if (regra.semPrazo) {
			qtdDias = '';
			dataFim = '';
		}
	}

	function handleSubmit() {
		enviando = true;
		loading.show(solicitando ? 'Enviando solicitação...' : 'Registrando...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			enviando = false;
			if (result.type === 'success') {
				toaster.create({
					title: solicitando ? 'Solicitação enviada' : 'Registro salvo com sucesso!',
					description: solicitando
						? 'O ato só acontece após a aprovação do Administrador Geral.'
						: undefined,
					type: 'success'
				});
				fechar();
				await invalidateShared(`policial:${policial.id}`, 'app:policiais');
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao registrar'), type: 'error' });
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro inesperado ao registrar', type: 'error' });
			}
		};
	}
</script>

<div class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6 mt-4">
	<h2 class="text-base font-bold mb-1 text-surface-700 dark:text-surface-300">
		Afastar / Movimentar Servidor
	</h2>
	<p class="text-xs text-surface-600 dark:text-surface-400 mb-3">
		{#if solicitando}
			O afastamento é <b>enviado para aprovação</b> do Administrador Geral, com justificativa. Movimentação
			e desvinculação são feitas pelo DPI SUL. Férias entram pelo cartão Férias.
		{:else}
			Toda movimentação, afastamento ou desvinculação fica registrada no histórico do servidor.
		{/if}
	</p>
	<div class="grid grid-cols-1 gap-2 {solicitando ? '' : 'sm:grid-cols-3'}">
		{#if !solicitando}
			<button
				type="button"
				class="btn preset-outlined-surface-500 flex items-center justify-center gap-2"
				onclick={() => abrir('movimentacao')}
			>
				<ArrowRightLeft size={16} /> Movimentação
			</button>
		{/if}
		<button
			type="button"
			class="btn preset-outlined-surface-500 flex items-center justify-center gap-2"
			onclick={() => abrir('afastamento')}
		>
			<CalendarOff size={16} /> Afastamento
		</button>
		{#if !solicitando}
			<button
				type="button"
				class="btn preset-outlined-error-500 flex items-center justify-center gap-2"
				onclick={() => abrir('desvinculacao')}
			>
				<UserMinus size={16} /> Desvinculação
			</button>
		{/if}
	</div>
</div>

{#snippet servidorBanner()}
	<div
		class="mb-4 rounded-lg bg-surface-500/10 border-l-4 border-primary-500 px-3 py-2 text-sm text-surface-700 dark:text-surface-200"
	>
		Servidor: <b>{policial.nome}</b> | Matrícula: <b>{policial.matricula}</b>
	</div>
{/snippet}

<!-- Campo NUP — mesma marcação nos três modais (movimentação, afastamento,
     desvinculação), ligado ao mesmo estado `nup`. -->
{#snippet campoNup()}
	<label class="label">
		<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">NUP</span>
		<input
			class="input py-1 px-3 text-sm font-mono"
			type="text"
			name="nup"
			value={nup}
			oninput={(e) => (nup = formatarNUP(e.currentTarget.value))}
			placeholder="00000.000000/0000-00"
			maxlength="20"
		/>
	</label>
{/snippet}

<!-- Justificativa — só no modo solicitação, e obrigatória ali. No modo direto
     não há a quem justificar: o ato JÁ é a decisão de quem tem poder para
     tomá-la, e quem o tomou fica na trilha de auditoria. -->
{#snippet campoJustificativa()}
	{#if solicitando}
		<label class="label">
			<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
				>Justificativa do pedido</span
			>
			<textarea
				class="textarea py-1 px-3 text-sm"
				name="justificativa"
				bind:value={justificativa}
				rows="2"
				maxlength={MAX_JUSTIFICATIVA}
				required
				placeholder="Motivo do pedido, para o Administrador Geral decidir"></textarea>
			<span class="text-2xs opacity-60 ml-1 self-end tabular-nums">
				{justificativa.length}/{MAX_JUSTIFICATIVA}
			</span>
		</label>
	{/if}
{/snippet}

<!-- Rodapé dos três modais: o verbo segue o MODO, porque um botão "Salvar" que
     apenas envia um pedido faz o administrador acreditar que transferiu quem
     continua onde estava. -->
{#snippet rodapeAcao(classePreset: string, rotuloDireto: string, andamentoDireto: string)}
	<div
		class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2 border-t border-surface-200 dark:border-white/5"
	>
		<button
			type="button"
			class="btn preset-outlined-surface-500"
			onclick={fechar}
			disabled={enviando}>Cancelar</button
		>
		<button type="submit" class="btn {classePreset} disabled:opacity-40" disabled={bloqueado}>
			{#if enviando}
				{solicitando ? 'Enviando...' : andamentoDireto}
			{:else}
				{solicitando ? 'Solicitar' : rotuloDireto}
			{/if}
		</button>
	</div>
{/snippet}

<!--
	Exceção deliberada ao ModalShell: os três diálogos formam uma única máquina
	de ações de RH, com banners, formulários e rodapés distintos por operação.
	Separar apenas as molduras aumentaria props sem compartilhar comportamento.
-->
<!-- ============ MOVIMENTAÇÃO ============ -->
<Dialog open={modal === 'movimentacao'} onOpenChange={(e) => (e.open ? null : fechar())}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="acoes-modal card p-4 sm:p-5 max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl"
		>
			<Dialog.Title class="h3 font-bold mb-4 flex items-center gap-2">
				<ArrowRightLeft size={20} class="text-primary-500" /> Nova Movimentação
			</Dialog.Title>
			{@render servidorBanner()}
			<form
				method="POST"
				action="?/registrarMovimentacao"
				enctype="multipart/form-data"
				use:enhance={handleSubmit}
				class="space-y-3"
			>
				<div class="grid grid-cols-1 gap-2">
					<label class="label">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>Unidade Atual</span
						>
						<input
							class="input py-1 px-3 text-sm bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75"
							type="text"
							value={policial.lotacao || '— Sem lotação —'}
							readonly
						/>
					</label>
					<label class="label">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>Unidade Destino</span
						>
						<select
							class="select py-1 px-3 text-sm"
							name="unidade_destino"
							bind:value={unidadeDestino}
							required
						>
							<option value="" disabled>Selecione...</option>
							{#each lotacoes as u (u)}
								<option value={u}>{u}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
					<label class="label">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>Data Movimentação</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="date"
							name="data_evento"
							bind:value={dataEvento}
							required
						/>
					</label>
					{@render campoNup()}
				</div>
				<label class="label">
					<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Portaria (PDF)</span
					>
					<input
						class="input py-1 px-2 text-sm"
						type="file"
						name="documento"
						accept="application/pdf"
					/>
				</label>
				{@render campoJustificativa()}
				{@render rodapeAcao('preset-filled-primary-500', 'Salvar', 'Salvando...')}
			</form>
		</div>
	</Dialog.Content>
</Dialog>

<!-- ============ AFASTAMENTO ============ -->
<Dialog open={modal === 'afastamento'} onOpenChange={(e) => (e.open ? null : fechar())}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="acoes-modal card p-4 sm:p-5 max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl"
		>
			<Dialog.Title class="h3 font-bold mb-4 flex items-center gap-2">
				<CalendarOff size={20} class="text-warning-500" /> Registrar Afastamento
			</Dialog.Title>
			{@render servidorBanner()}
			<form
				method="POST"
				action="?/registrarAfastamento"
				enctype="multipart/form-data"
				use:enhance={handleSubmit}
				class="space-y-3"
			>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
					<label class="label">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>Tipo de Afastamento</span
						>
						<!-- Por categoria, como na tabela do responsável; as medidas disciplinares
						     só aparecem para o Admin Geral. Férias não estão aqui (cartão Férias). -->
						<select
							class="select py-1 px-3 text-sm"
							name="subtipo"
							bind:value={subtipo}
							onchange={aoMudarTipo}
							required
						>
							{#each grupos as g (g.categoria)}
								<optgroup label={g.rotulo}>
									{#each g.subtipos as s (s)}
										<option value={s}>{AFASTAMENTOS[s].rotulo}</option>
									{/each}
								</optgroup>
							{/each}
						</select>
					</label>
					<label class="label">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>Descrição/Motivo</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="text"
							name="descricao"
							bind:value={descricao}
							maxlength="500"
						/>
					</label>
				</div>

				<!-- A base legal e a observação do tipo escolhido — o que a tela antiga
				     mostrava e que evita o tipo errado. -->
				{#if meta.base || meta.obs}
					<div
						class="rounded-lg border border-primary-500/30 bg-primary-500/10 px-3 py-2 text-xs leading-relaxed"
					>
						{#if meta.base}
							<p class="font-semibold text-primary-700 dark:text-primary-400">
								Base legal: {meta.base}
							</p>
						{/if}
						{#if meta.obs}<p class="text-surface-700 dark:text-surface-300">{meta.obs}</p>{/if}
					</div>
				{/if}

				<!-- LTS: a classificação do CID. CID-F dispara a Portaria 39/2026. -->
				{#if regra.exigeCid}
					<fieldset
						class="rounded-lg border border-warning-500/40 bg-warning-500/10 px-3 py-2 text-xs space-y-1"
					>
						<legend class="px-1 text-2xs font-bold uppercase opacity-70"
							>Classificação do diagnóstico (CID)</legend
						>
						<div class="flex flex-wrap gap-x-4 gap-y-1">
							<label class="flex items-center gap-1.5 cursor-pointer">
								<input
									type="radio"
									class="radio"
									name="tipo_cid"
									value="CID-Outras"
									bind:group={tipoCid}
								/>
								CID-Outras (clínica geral, ortopedia, cirurgias…)
							</label>
							<label
								class="flex items-center gap-1.5 cursor-pointer font-semibold text-error-600 dark:text-error-400"
							>
								<input
									type="radio"
									class="radio"
									name="tipo_cid"
									value="CID-F"
									bind:group={tipoCid}
								/>
								CID-F (transtornos mentais e comportamentais)
							</label>
						</div>
						{#if tipoCid === 'CID-F'}
							<div
								class="mt-1 rounded-md border border-error-500/40 bg-error-500/10 px-3 py-2 text-error-700 dark:text-error-300"
								role="alert"
							>
								<p class="font-bold">⚠ {PORTARIA_39.titulo}</p>
								<ul class="mt-1 list-disc pl-4 space-y-0.5">
									{#each PORTARIA_39.providencias as prov (prov)}
										<li>{prov}</li>
									{/each}
								</ul>
								<p class="mt-1 text-2xs opacity-80">O DPI SUL é avisado deste afastamento.</p>
							</div>
						{/if}
					</fieldset>
				{/if}

				<!-- Maternidade: 120 dias, mais 60 se a servidora pediu a prorrogação. -->
				{#if meta.adicional}
					<label class="flex items-center gap-2 text-sm cursor-pointer">
						<input
							type="checkbox"
							class="checkbox"
							name="adicional"
							bind:checked={adicional}
							onchange={aoMudarTipo}
						/>
						A servidora pediu a prorrogação de {meta.adicional} dias (total {(meta.dias ?? 0) +
							meta.adicional})
					</label>
				{/if}

				<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
					<label class="label">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Data Início</span>
						<input
							class="input py-1 px-3 text-sm"
							type="date"
							name="data_inicio"
							bind:value={dataInicio}
							oninput={recalcularDataFim}
							required
						/>
					</label>
					<label class="label">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>Qtd Dias{#if regra.diasFixos != null}
								<span class="normal-case font-normal opacity-70"> · fixo</span>{/if}</span
						>
						<input
							class="input py-1 px-3 text-sm {regra.diasFixos != null
								? 'opacity-70 cursor-not-allowed'
								: ''}"
							type="number"
							name="qtd_dias"
							min="1"
							bind:value={qtdDias}
							oninput={recalcularDataFim}
							readonly={regra.diasFixos != null}
						/>
					</label>
					<label class="label">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>Data Final{#if regra.semPrazo}
								<span class="normal-case font-normal opacity-70"> · opcional</span>{/if}</span
						>
						<input
							class="input py-1 px-3 text-sm {regra.diasFixos != null
								? 'opacity-70 cursor-not-allowed'
								: ''}"
							type="date"
							name="data_fim"
							bind:value={dataFim}
							oninput={recalcularQtd}
							readonly={regra.diasFixos != null}
							required={!regra.semPrazo}
						/>
					</label>
				</div>
				{#if regra.semPrazo}
					<p class="text-2xs text-warning-700 dark:text-warning-400">
						Este afastamento não tem prazo definido: sem data final, o servidor consta como afastado
						até o registro do retorno.
					</p>
				{/if}

				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
					<label class="label">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>NUP do processo <span class="text-error-500">*</span></span
						>
						<input
							class="input py-1 px-3 text-sm font-mono"
							type="text"
							name="nup"
							value={nup}
							oninput={(e) => (nup = formatarNUP(e.currentTarget.value))}
							placeholder="00000.000000/0000-00"
							maxlength="20"
							required
						/>
						{#if nup && !nupConferido.ok}
							<span class="text-2xs text-error-600 ml-1">{nupConferido.erro}</span>
						{/if}
					</label>
					<label class="label">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>Documento (PDF)</span
						>
						<input
							class="input py-1 px-2 text-sm"
							type="file"
							name="documento"
							accept="application/pdf"
						/>
					</label>
				</div>
				{@render campoJustificativa()}
				{@render rodapeAcao('preset-filled-warning-500', 'Salvar', 'Salvando...')}
			</form>
		</div>
	</Dialog.Content>
</Dialog>

<!-- ============ DESVINCULAÇÃO ============ -->
<Dialog open={modal === 'desvinculacao'} onOpenChange={(e) => (e.open ? null : fechar())}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="acoes-modal card p-4 sm:p-5 max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl"
		>
			<Dialog.Title
				class="h3 font-bold mb-2 flex items-center gap-2 text-error-600 dark:text-error-400"
			>
				<UserMinus size={20} /> Confirmar Desvinculação
			</Dialog.Title>
			<p class="text-xs text-surface-600 dark:text-surface-400 mb-3">
				A desvinculação <b>inativa</b> o servidor (sai das listas e escalas). O registro fica
				preservado no histórico.
				{#if solicitando}
					Aqui o pedido é <b>enviado para aprovação</b> — o servidor continua ativo até o Administrador
					Geral decidir.
				{/if}
			</p>
			{@render servidorBanner()}
			<form
				method="POST"
				action="?/registrarDesvinculacao"
				enctype="multipart/form-data"
				use:enhance={handleSubmit}
				class="space-y-3"
			>
				<label class="label">
					<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
						>Destino do Policial</span
					>
					<input
						class="input py-1 px-3 text-sm"
						type="text"
						name="destino"
						bind:value={destino}
						maxlength="200"
						required
					/>
				</label>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
					<label class="label">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
							>Data Desvinculação</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="date"
							name="data_evento"
							bind:value={dataEvento}
							required
						/>
					</label>
					{@render campoNup()}
				</div>
				<label class="label">
					<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
						>Documentação (PDF)</span
					>
					<input
						class="input py-1 px-2 text-sm"
						type="file"
						name="documento"
						accept="application/pdf"
					/>
				</label>
				{@render campoJustificativa()}
				{@render rodapeAcao('preset-filled-error-500', 'Confirmar Baixa', 'Confirmando...')}
			</form>
		</div>
	</Dialog.Content>
</Dialog>

<style>
	:global(.acoes-modal .input),
	:global(.acoes-modal .select) {
		background-color: var(--color-surface-50);
	}
	:global(.dark .acoes-modal .input),
	:global(.dark .acoes-modal .select) {
		background-color: var(--color-surface-800);
	}
</style>
