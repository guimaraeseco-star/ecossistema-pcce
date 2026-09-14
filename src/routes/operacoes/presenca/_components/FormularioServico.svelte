<script lang="ts">
	/**
	 * O card de UMA ESCALA GISE na tela do policial (`/operacoes/presenca`) — onde ele faz
	 * as três coisas que lhe cabem, na ordem em que o serviço acontece:
	 *
	 *   confirmar ENTRADA → enviar o RELATÓRIO de produtividade → confirmar SAÍDA
	 *
	 * Cada passo só libera quando o anterior está cumprido, e as duas presenças são
	 * assinatura avançada: exigem confirmação em tela e, conforme as flags, foto, GPS e código
	 * por e-mail. A tela esconde o que não cabe, mas quem valida é o servidor —
	 * cada action revalida participação e horário por conta própria.
	 *
	 * O estado e as chamadas vivem em `usePresencaGise`; este componente é a
	 * apresentação de um item da lista.
	 *
	 * A produtividade é a exceção entre os três passos: em vez de abrir um modal,
	 * o botão NAVEGA para `/operacoes/presenca/relatorio/[giseId]`. O modelo operacional tem
	 * 19 perguntas de nível 0 e os filhos condicionais — cabia num modal só como
	 * rolagem infinita. Lá o formulário é um wizard por etapas, com rascunho
	 * automático; entrada e saída continuam aqui porque são um botão cada.
	 */
	import Check from '@lucide/svelte/icons/check';
	import Clock from '@lucide/svelte/icons/clock';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import { actionButton, btnIcon } from './BotoesAcao.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import type { Snippet } from 'svelte';
	import { fmtDate } from '$lib/gise/formatters';
	import { avancadaEmTelaDoLayout } from '$lib/chave-assinatura-ui';
	import ConviteChaveAssinatura from '$lib/components/ConviteChaveAssinatura.svelte';
	import type { usePresencaGise } from './usePresencaGise.svelte';

	type PresencaGise = ReturnType<typeof usePresencaGise>;

	let {
		presenca,
		isAdminGeral,
		isMobile,
		restringirSmartphone,
		voltarParaLista,
		painelA3Entrada = $bindable(null),
		painelA3Saida = $bindable(null)
	}: {
		presenca: PresencaGise;
		isAdminGeral: boolean;
		isMobile: boolean;
		restringirSmartphone: boolean;
		voltarParaLista: () => void;
		/** Controles A3 expostos ao modal de assinatura do `+page` (rodapé Certificado Digital). */
		painelA3Entrada?: { assinarComSerpro: () => Promise<void> } | null;
		painelA3Saida?: { assinarComSerpro: () => Promise<void> } | null;
	} = $props();

	const usuario = $derived(page.data.usuario);
	const giseId = $derived(presenca.escalaSelecionada?.id ?? null);
	const esc = $derived(presenca.escalaSelecionada);
	const avancadaDisponivel = $derived(avancadaEmTelaDoLayout(page.data));

	/**
	 * Rota do wizard do relatório. Dois parâmetros, ambos opcionais:
	 * `equipeId` só vai quando existe (no quadro de supervisão ele é `0`, e a
	 * resposta do SEINT lá é individual), e `status` viaja de ida e volta para o
	 * retorno cair na MESMA aba de filtro — sem ele, quem retifica um relatório
	 * de escala finalizada volta para "Ativas" e não acha a própria escala.
	 */
	const urlRelatorio = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams();
		if (esc?.equipe_id) params.set('equipeId', String(esc.equipe_id));
		const status = page.url.searchParams.get('status');
		if (status) params.set('status', status);
		const qs = params.toString();
		return `/operacoes/presenca/relatorio/${giseId}${qs ? `?${qs}` : ''}`;
	});

	/**
	 * Estado das três tarefas, num lugar só. O template lia estas mesmas
	 * condições em oito pontos diferentes (`presenca?.entrada_timestamp` seis
	 * vezes), e cada leitura era uma chance de divergir das outras.
	 *
	 * `temProdutividade`: supervisor e assessor não devem relatório — o servidor
	 * já lhes dá `equipeRespondida: true` de saída (`+page.server.ts`, "quem deve
	 * o relatório muda por papel"). Para eles o passo não existe, em vez de
	 * aparecer eternamente concluído.
	 */
	const temProdutividade = $derived(
		!!esc && esc.equipe_tipo !== 'assessor' && esc.equipe_tipo !== 'supervisor'
	);
	const entradaOk = $derived(!!esc?.presenca?.entrada_timestamp);
	const relatorioOk = $derived(!!esc?.equipeRespondida);
	const saidaOk = $derived(!!esc?.presenca?.saida_timestamp);
	const horarioEntradaLiberado = $derived(!!esc && presenca.isHorarioLiberado(esc, isAdminGeral));
	const horarioSaidaLiberado = $derived(!!esc && presenca.isSaidaLiberada(esc, isAdminGeral));

	/** Qual modal de PRESENÇA está aberto (o relatório é rota, não modal). */
	let modalPresenca = $state<'entrada' | 'saida' | null>(null);

	/** Fecha o modal da tarefa assim que ela é cumprida (inclusive pelo A3, que
	 *  confirma pela API e volta pelo `sincronizarPresencaAtual`). */
	$effect(() => {
		if (modalPresenca === 'entrada' && entradaOk) modalPresenca = null;
		if (modalPresenca === 'saida' && saidaOk) modalPresenca = null;
	});

	/** "2026-07-18 20:42:55" (horário local, -3h) → "18/07/2026 às 20:42". */
	function fmtDataHora(ts: string | null | undefined): string {
		if (!ts) return '';
		const [data, hora] = ts.split(/[ T]/);
		const [ano, mes, dia] = data.split('-');
		if (!ano || !mes || !dia) return ts;
		return `${dia}/${mes}/${ano}${hora ? ' às ' + hora.slice(0, 5) : ''}`;
	}
	// Só mostra "última atualização" quando difere do envio (houve retificação).
	const houveRetificacao = $derived(
		!!presenca.respostaAtualizadaEm &&
			!!presenca.respostaEnviadaEm &&
			presenca.respostaAtualizadaEm !== presenca.respostaEnviadaEm
	);

	// Controles A3: `$bindable` no pai (modal de assinatura) e aqui nos painéis
	// ocultos — um por tipo, para não misturar o payload `tipo` entrada/saída.

	async function confirmarPresencaA3(tipo: 'entrada' | 'saida') {
		const ctrl = tipo === 'entrada' ? painelA3Entrada : painelA3Saida;
		if (!ctrl) {
			toaster.error({
				title: 'Painel de assinatura não inicializado',
				description: 'Recarregue a página (F5) e tente novamente.'
			});
			return;
		}
		await ctrl.assinarComSerpro();
	}
</script>

{#snippet btnDownloadEtapa(rotulo: string, aoClicar: () => void, carregando: boolean)}
	<button
		type="button"
		class="btn btn-sm inline-flex items-center gap-1.5 rounded-lg preset-tonal-surface-500 px-3 py-1.5 text-3xs font-bold tracking-wide uppercase"
		onclick={aoClicar}
		disabled={loading.active || carregando}
	>
		{#if carregando}
			<Spinner size="sm" />
		{:else}
			{@render btnIcon('M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4')}
		{/if}
		{rotulo}
	</button>
{/snippet}

<!-- Downloads de cada etapa (rótulo curto — só o ícone + "Comprovante"/"Relatório"):
     comprovante (termo de presença) da entrada/saída e o PDF do relatório. São
     compactos e o rodapé do card os alinha à direita. -->
{#snippet comprovanteEntrada()}
	{@render btnDownloadEtapa(
		'Comprovante',
		() => presenca.baixarTermoPresenca('entrada'),
		presenca.baixandoTermo === 'entrada'
	)}
{/snippet}
{#snippet comprovanteSaida()}
	{@render btnDownloadEtapa(
		'Comprovante',
		() => presenca.baixarTermoPresenca('saida'),
		presenca.baixandoTermo === 'saida'
	)}
{/snippet}
{#snippet baixarProdutividade()}
	{#if esc && relatorioOk && esc.seccional_id !== 0}
		{@render btnDownloadEtapa(
			'Relatório',
			() => esc && presenca.baixarRelatorio(esc),
			presenca.baixandoProdutividade === esc.id
		)}
	{/if}
{/snippet}

{#snippet blocoRestritoDesktop(tipo: 'entrada' | 'saida')}
	{@const rotulo = tipo === 'entrada' ? 'entrada' : 'saída'}
	<div class="flex flex-col gap-3 max-w-sm mx-auto">
		<div class="bg-tertiary-500/5 border border-tertiary-500/25 p-4 rounded-2xl space-y-3">
			<div class="flex items-center gap-2">
				<ShieldCheck class="w-5 h-5 text-tertiary-500 shrink-0" aria-hidden="true" />
				<p class="text-sm font-bold text-surface-700 dark:text-surface-200 leading-tight">
					Assinar com Certificado Digital
				</p>
			</div>

			<button
				type="button"
				class="btn btn-sm preset-filled-warning-500 rounded-xl py-2.5 text-sm font-semibold w-full"
				disabled={loading.active}
				onclick={() => confirmarPresencaA3(tipo)}
			>
				Confirmar {rotulo}
			</button>
			<p class="text-3xs text-surface-600 dark:text-surface-400 italic leading-snug">
				Caso não possua TOKEN, você pode confirmar acessando pelo celular.
			</p>
		</div>
	</div>
{/snippet}

<!-- Painéis ocultos de assinatura A3 da presença (um por tipo) -->
{#if giseId != null}
	<div class="sr-only" aria-hidden="true">
		<PainelAssinaturaToken
			bind:control={painelA3Entrada}
			signerName={usuario?.nome ?? undefined}
			signerCpf={usuario?.cpf ?? undefined}
			signerEmail={usuario?.email ?? undefined}
			prepararUrl={`/api/gise/${giseId}/presenca/preparar-assinatura`}
			finalizarUrl={`/api/gise/${giseId}/presenca/finalizar-assinatura`}
			nomeArquivo="termo_presenca_entrada.pdf"
			extraPayload={{ tipo: 'entrada' }}
			disabled={loading.active}
			baixarAutomatico={false}
			tituloSucesso="Entrada confirmada com certificado digital."
			onSuccess={async () => {
				await presenca.sincronizarPresencaAtual('entrada');
			}}
		/>
		<PainelAssinaturaToken
			bind:control={painelA3Saida}
			signerName={usuario?.nome ?? undefined}
			signerCpf={usuario?.cpf ?? undefined}
			signerEmail={usuario?.email ?? undefined}
			prepararUrl={`/api/gise/${giseId}/presenca/preparar-assinatura`}
			finalizarUrl={`/api/gise/${giseId}/presenca/finalizar-assinatura`}
			nomeArquivo="termo_presenca_saida.pdf"
			extraPayload={{ tipo: 'saida' }}
			disabled={loading.active}
			baixarAutomatico={false}
			tituloSucesso="Saída confirmada com certificado digital."
			onSuccess={async () => {
				await presenca.sincronizarPresencaAtual('saida');
			}}
		/>
	</div>
{/if}

<!--
	Card de UMA etapa. Funde o que antes eram dois blocos separados que diziam a
	mesma coisa — a barra de progresso (marcador + rótulo + botão) e o quadro de
	resultado (marcador + status + download). Agora cada passo é UM card, na
	ordem de execução, com tudo dele: marcador de estado no topo, rótulo, a linha
	de status/pendência e o rodapé de ações (a ação primária do passo mais os
	downloads via `extras`).

	Marcador (README §10): ✓ em círculo `success` cumprido, número em `primary`
	quando é o passo ATIVO (o que fazer agora), número `surface` esmaecido quando
	ainda depende de um passo anterior. O relógio `warning` da linha de status é
	que carrega o "pendente" — o mesmo par Check/Clock dos quadros antigos.
-->
{#snippet etapaCard(
	indice: number,
	rotulo: string,
	concluido: boolean,
	ativo: boolean,
	statusTexto: string,
	primaria: { label: string; onclick: () => void; disabled: boolean; titulo?: string } | null,
	extras?: Snippet
)}
	<div
		class="relative flex h-full flex-col items-center gap-2 rounded-2xl border p-4 text-center transition-colors {concluido
			? 'border-success-500/30 bg-success-500/10'
			: ativo
				? 'border-primary-500/40 bg-primary-500/5'
				: 'border-surface-200 bg-surface-50 dark:border-surface-800 dark:bg-surface-950/40'}"
	>
		<div
			class="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-colors {concluido
				? 'bg-success-500 text-white'
				: ativo
					? 'bg-primary-500 text-white shadow-lg shadow-primary-500/30'
					: 'bg-surface-200 text-surface-600 dark:bg-surface-800 dark:text-surface-400'}"
		>
			{#if concluido}
				<Check class="h-4 w-4" strokeWidth={3} aria-hidden="true" />
			{:else}
				{indice}
			{/if}
		</div>
		<p
			class="text-sm font-bold {concluido
				? 'text-success-700 dark:text-success-400'
				: ativo
					? 'text-primary-700 dark:text-primary-400'
					: 'text-surface-700 dark:text-surface-200'}"
		>
			{rotulo}
		</p>
		<div class="flex min-h-8 items-start justify-center gap-1.5">
			{#if concluido}
				<Check
					class="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-500"
					strokeWidth={3}
					aria-hidden="true"
				/>
			{:else}
				<Clock
					class="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-500"
					strokeWidth={2.5}
					aria-hidden="true"
				/>
			{/if}
			<p class="text-3xs leading-tight tabular-nums text-surface-600 dark:text-surface-400">
				{statusTexto}
			</p>
		</div>
		{#if concluido}
			{#if primaria || extras}
				<!-- Concluído: ações numa linha só — a ação (Retificar dados) à
				     ESQUERDA e o download à DIREITA — para o card não ganhar altura. -->
				<div class="mt-auto flex w-full items-center justify-end gap-2 pt-1">
					{#if primaria}
						<button
							type="button"
							class="btn btn-sm mr-auto rounded-lg px-3 py-1.5 text-3xs font-black tracking-wide uppercase {primaria.disabled
								? 'preset-outlined-surface-500 cursor-not-allowed opacity-45'
								: 'preset-outlined-surface-500'}"
							disabled={primaria.disabled || loading.active}
							title={primaria.titulo}
							onclick={primaria.onclick}
						>
							{primaria.label}
						</button>
					{/if}
					{@render extras?.()}
				</div>
			{/if}
		{:else if primaria}
			<!-- Pendente: CTA principal do passo, em largura cheia. -->
			<div class="mt-auto w-full pt-1">
				<button
					type="button"
					class="btn btn-sm w-full rounded-xl py-2 text-3xs font-black tracking-wide whitespace-normal uppercase {primaria.disabled
						? 'preset-outlined-surface-500 cursor-not-allowed opacity-45'
						: 'preset-filled-primary-500 shadow-md shadow-primary-500/20'}"
					disabled={primaria.disabled || loading.active}
					title={primaria.titulo}
					onclick={primaria.onclick}
				>
					{primaria.label}
				</button>
			</div>
		{/if}
	</div>
{/snippet}

{#if presenca.escalaSelecionada}
	{@const escala = presenca.escalaSelecionada}
	{@const passoAtivo = !entradaOk ? 1 : temProdutividade && !relatorioOk ? 2 : !saidaOk ? 3 : 0}

	<div class="space-y-6">
		<div class="border-b border-surface-200 dark:border-surface-800 pb-4">
			<h2 class="text-xl font-bold">Relatório de Serviço</h2>
			<p class="text-xs text-primary-500 font-medium">
				Data: {fmtDate(escala.data_inicio)}
			</p>
		</div>

		<!--
			Etapas do serviço em cards, na ordem de execução (entrada → produtividade
			→ saída). Cada card É o passo inteiro: marcador de estado, rótulo, a linha
			de status/pendência e o rodapé de ações (a ação primária do passo mais os
			downloads). Antes isso eram DOIS blocos — a barra de progresso e um quadro
			de resultado por tarefa — que repetiam marcador e rótulo; aqui viram um só.
			No celular os cards empilham; no desktop ficam lado a lado (2 ou 3 colunas).
		-->
		<div class="grid grid-cols-1 gap-3 {temProdutividade ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}">
			{@render etapaCard(
				1,
				'Entrada',
				entradaOk,
				passoAtivo === 1,
				entradaOk && escala.presenca?.entrada_timestamp
					? new Date(escala.presenca.entrada_timestamp).toLocaleString('pt-BR', {
							timeZone: 'America/Sao_Paulo'
						})
					: horarioEntradaLiberado
						? 'Aguardando confirmação'
						: `Disponível às ${escala.horarioPrevisto?.inicio ?? '—'}`,
				entradaOk
					? null
					: {
							label: horarioEntradaLiberado ? 'Confirmar entrada' : 'Aguardando horário',
							onclick: () => (modalPresenca = 'entrada'),
							disabled: !horarioEntradaLiberado,
							titulo: horarioEntradaLiberado
								? undefined
								: `Liberado às ${escala.horarioPrevisto?.inicio ?? '—'}`
						},
				entradaOk ? comprovanteEntrada : undefined
			)}

			{#if temProdutividade}
				{@render etapaCard(
					2,
					'Produtividade',
					relatorioOk,
					passoAtivo === 2,
					relatorioOk
						? presenca.respostaEnviadaEm
							? `Enviado em ${fmtDataHora(presenca.respostaEnviadaEm)}${
									houveRetificacao
										? ` · retificado em ${fmtDataHora(presenca.respostaAtualizadaEm)}`
										: ''
								}`
							: 'Registrado'
						: entradaOk
							? 'Aguardando envio'
							: 'Confirme a entrada primeiro',
					{
						label: relatorioOk ? 'Retificar dados' : 'Preencher relatório',
						onclick: () => goto(urlRelatorio),
						disabled: !entradaOk,
						titulo: entradaOk ? undefined : 'Confirme a entrada primeiro'
					},
					baixarProdutividade
				)}
			{/if}

			{@render etapaCard(
				temProdutividade ? 3 : 2,
				'Saída',
				saidaOk,
				passoAtivo === 3,
				saidaOk && escala.presenca?.saida_timestamp
					? new Date(escala.presenca.saida_timestamp).toLocaleString('pt-BR', {
							timeZone: 'America/Sao_Paulo'
						})
					: !horarioSaidaLiberado
						? `Disponível às ${escala.horarioPrevisto?.fim ?? '—'}`
						: !relatorioOk
							? 'Depende do relatório'
							: 'Aguardando confirmação',
				saidaOk
					? null
					: {
							label: !horarioSaidaLiberado
								? 'Aguardando horário'
								: !relatorioOk
									? 'Relatório pendente'
									: 'Confirmar saída',
							onclick: () => (modalPresenca = 'saida'),
							disabled: !entradaOk || !horarioSaidaLiberado || !relatorioOk,
							titulo: !horarioSaidaLiberado
								? `Liberado às ${escala.horarioPrevisto?.fim ?? '—'}`
								: !relatorioOk
									? 'Envie o relatório de produtividade antes'
									: undefined
						},
				saidaOk ? comprovanteSaida : undefined
			)}
		</div>

		<div class="pt-2">
			<button
				type="button"
				class="btn btn-sm text-surface-600 hover:text-primary-500 transition-colors w-full"
				onclick={voltarParaLista}
			>
				← Voltar para lista de escalas
			</button>
		</div>
	</div>

	<!--
		Modais das três tarefas.

		O `portal={true}` do `ModalShell` NÃO É OPCIONAL aqui, e a razão não é
		óbvia: este componente vive dentro do painel 2 do slider de `+page.svelte`,
		cujo trilho tem `transform: translateX(-50%)`. Um `transform` diferente de
		`none` faz o elemento virar CONTAINING BLOCK dos descendentes
		`position: fixed` — então o `inset-0` do shell passaria a se referir ao
		trilho (200% de largura, deslocado meia tela) e não à viewport, e o
		`overflow-hidden` do wrapper ainda recortaria o que sobrasse. Medido em
		Chromium: um `fixed inset-0` ali dentro rende `left:-648 · 2304×18px` num
		viewport de 1920×900. O portal monta o conteúdo em `document.body`, fora
		do trilho, preservando o contexto do Svelte (é assim que o `IconTooltip` e
		o popover da `TabelaEscalas` já fazem).

		A mesma armadilha existe com `contain: layout` (que `container-type`
		implica) — por isso este arquivo também não usa `@container`.

		`z-50` é o degrau de modal da escala do README; o pad de assinatura (no
		`+page.svelte`) é `z-[60]` e abre POR CIMA destes — empilhamento correto,
		já que a cerimônia de assinatura é o passo seguinte de
		dentro da confirmação.

		Não foram extraídos para componentes: os três dependem de `presenca`,
		`isMobile`, `restringirSmartphone`, dos painéis A3 e do
		snippet `blocoRestritoDesktop` — a extração custaria mais props do que
		poupa marcação (corolário do CLAUDE.md sobre quando NÃO extrair).
	-->
	<ModalShell
		open={modalPresenca === 'entrada'}
		title="Confirmação de Entrada"
		description="Confirme sua entrada para liberar o formulário de produtividade."
		largura="sm"
		camada="base"
		familia="gise"
		portal={true}
		pending={loading.active}
		onOpenChange={(novoOpen) => {
			if (!novoOpen && !loading.active) modalPresenca = null;
		}}
	>
		{#if avancadaDisponivel && (isMobile || !restringirSmartphone)}
			{@render actionButton(
				'Confirmar Entrada',
				undefined,
				'primary',
				'filled',
				() => (presenca.capturandoAssinatura = true),
				false,
				false,
				'w-full py-2.5 text-sm shadow-sm'
			)}
		{:else if !avancadaDisponivel}
			<div class="p-3 rounded-xl bg-warning-500/5 border border-warning-500/20">
				<ConviteChaveAssinatura {isMobile} />
			</div>
		{:else}
			{@render blocoRestritoDesktop('entrada')}
		{/if}

		<div class="flex justify-end">
			{@render actionButton(
				'Fechar',
				undefined,
				'surface',
				'outlined',
				() => (modalPresenca = null),
				false,
				false,
				'px-6'
			)}
		</div>
	</ModalShell>

	<ModalShell
		open={modalPresenca === 'saida'}
		title="Término do Plantão"
		description="Confirme sua saída do serviço."
		largura="sm"
		camada="base"
		familia="gise"
		portal={true}
		pending={loading.active}
		onOpenChange={(novoOpen) => {
			if (!novoOpen && !loading.active) modalPresenca = null;
		}}
	>
		{#if !relatorioOk}
			<div
				class="p-3 bg-warning-500/10 border border-warning-500/20 rounded-xl flex items-start gap-3"
			>
				{@render btnIcon(
					'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
				)}
				<p class="text-3xs text-warning-700 dark:text-warning-400">
					Você deve preencher e enviar o <strong>Relatório de Produtividade</strong> (resultados do serviço)
					antes de confirmar a saída.
				</p>
			</div>
		{:else if avancadaDisponivel && (isMobile || !restringirSmartphone)}
			{@render actionButton(
				'Confirmar Saída',
				undefined,
				'primary',
				'filled',
				() => (presenca.capturandoAssinatura = true),
				false,
				false,
				'w-full py-2.5 text-sm shadow-sm'
			)}
		{:else if !avancadaDisponivel}
			<div class="p-3 rounded-xl bg-warning-500/5 border border-warning-500/20">
				<ConviteChaveAssinatura {isMobile} />
			</div>
		{:else}
			{@render blocoRestritoDesktop('saida')}
		{/if}

		<div class="flex justify-end">
			{@render actionButton(
				'Fechar',
				undefined,
				'surface',
				'outlined',
				() => (modalPresenca = null),
				false,
				false,
				'px-6'
			)}
		</div>
	</ModalShell>
{/if}
