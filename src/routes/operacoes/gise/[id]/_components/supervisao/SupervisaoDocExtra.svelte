<script lang="ts">
	/**
	 * Card do relatório de extra do quadro de supervisão (unidade sintética) —
	 * downloads, conferência e botões Tela/Token do supervisor.
	 *
	 * Sem props: tudo vem do contexto do quadro.
	 *
	 * Os três predicados abaixo NÃO são o mesmo: `downloadExtraSupHabilitado`
	 * exige presenças completas e permissão de baixar (é o PDF assinado);
	 * `downloadExtraSupConferenciaHabilitado` é a via de conferência, aberta a
	 * Admin Geral e supervisor mesmo sem as presenças; `assinaturaExtraHabilitada`
	 * é o gate dos botões Tela/Token. Estados de presença diferentes precisam
	 * habilitar coisas diferentes.
	 */
	import { page } from '$app/state';
	import SupervisaoDocumentoCard from './SupervisaoDocumentoCard.svelte';
	import FileDown from '@lucide/svelte/icons/file-down';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import {
		supervisaoExtraPresencasCompletas,
		faltantesSupervisaoExtra,
		FALTANTE_PRESENCA_SUPER_PREFIX
	} from '$lib/gise/supervisao-extra';
	import { podeBaixarComManifesto } from '$lib/manifesto';
	import { montarNomesSupervisao } from './rodagem';
	import { quadroSupervisao } from './quadro-supervisao-estado.svelte';

	const quadro = quadroSupervisao();

	const gise = $derived(quadro.gise);
	const supervisaoExtraUnidadeId = $derived(quadro.supervisaoExtraUnidadeId);

	const nomesSupervisaoPorId = $derived(montarNomesSupervisao(gise, quadro.policiais));
	const extraSupervisaoConfigurado = $derived(supervisaoExtraUnidadeId != null);

	const assRelSup = $derived(
		supervisaoExtraUnidadeId == null
			? undefined
			: quadro.assinaturasRelatorios?.find(
					(a) => a.seccional_id === supervisaoExtraUnidadeId && a.tipo === 'extraordinario'
				)
	);
	const presSupOk = $derived(supervisaoExtraPresencasCompletas(gise, quadro.presencasGise ?? []));
	const faltSup = $derived(
		faltantesSupervisaoExtra(gise, quadro.presencasGise ?? [], nomesSupervisaoPorId)
	);

	const downloadExtraSupHabilitado = $derived(
		extraSupervisaoConfigurado &&
			!!quadro.podeDownload &&
			presSupOk &&
			(assRelSup || quadro.isAdminGeral || quadro.isSeccional || quadro.isSupervisor)
	);
	const downloadExtraSupConferenciaHabilitado = $derived(
		extraSupervisaoConfigurado && (quadro.isAdminGeral || quadro.isSupervisor)
	);
	const assinaturaExtraHabilitada = $derived(!!presSupOk && !!extraSupervisaoConfigurado);

	const urlDownloadExtra = $derived(
		`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${supervisaoExtraUnidadeId}`
	);
	const urlDownloadExtraManifesto = $derived(
		`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${supervisaoExtraUnidadeId}&manifesto=true`
	);

	let expandirExtra = $state(false);
</script>

{#snippet iconeCaneta()}
	<PenLine class="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
{/snippet}

{#snippet detalhesExtra(_mobile: boolean)}
	{#if assRelSup}
		<p class="text-xs font-bold text-surface-800 dark:text-surface-100 break-words">
			{assRelSup.assinante_nome}
		</p>
	{:else if !presSupOk}
		<p class="text-2xs leading-snug text-surface-600 dark:text-surface-400">
			{#if faltSup?.startsWith(FALTANTE_PRESENCA_SUPER_PREFIX)}
				<span class="text-error-600 dark:text-error-400 font-medium">Faltando confirmação de:</span
				>{faltSup.slice(FALTANTE_PRESENCA_SUPER_PREFIX.length)}
			{:else}
				{faltSup ?? 'Aguardando confirmações do quadro de supervisão.'}
			{/if}
		</p>
	{:else}
		<p class="text-2xs leading-snug text-surface-600 dark:text-surface-400">
			Disponível para conferência. Aguardando assinatura.
		</p>
	{/if}
{/snippet}

{#snippet acoesExtra(mobile: boolean)}
	{#if assRelSup}
		{@const podeManifesto = podeBaixarComManifesto(page.data.usuario, assRelSup.assinante_id)}
		<a
			href={urlDownloadExtra}
			target="_blank"
			class="btn btn-xs preset-filled-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg no-underline flex items-center gap-1 {mobile
				? ''
				: 'hover:scale-[1.02] transition-all'} {!downloadExtraSupHabilitado
				? 'pointer-events-none opacity-60'
				: ''}"
			title={podeManifesto ? 'Baixar sem manifesto (para impressão)' : 'Baixar PDF assinado'}
		>
			<FileDown size={13} class="shrink-0" />
			{podeManifesto ? 'S/ manifesto' : 'Baixar PDF'}
		</a>
		{#if podeManifesto}
			<a
				href={urlDownloadExtraManifesto}
				target="_blank"
				class="btn btn-xs preset-outlined-surface-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg no-underline flex items-center gap-1 {mobile
					? ''
					: 'hover:scale-[1.02] transition-all'} {!downloadExtraSupHabilitado
					? 'pointer-events-none opacity-60'
					: ''}"
				title="Baixar com manifesto (folha de auditoria)"
			>
				<FileDown size={13} class="shrink-0" />
				C/ manifesto
			</a>
		{/if}
	{:else}
		<a
			class="btn btn-xs text-3xs px-2.5 py-1.5 rounded-lg font-semibold no-underline flex items-center gap-1 {mobile
				? ''
				: 'hover:scale-[1.02] transition-all'} {downloadExtraSupConferenciaHabilitado
				? 'preset-outlined-surface-500'
				: 'preset-outlined-surface-500 opacity-50 pointer-events-none'}"
			href={urlDownloadExtra}
			target="_blank"
		>
			{@render iconeCaneta()}
			Conferência
		</a>
		{#if quadro.isSupervisor && extraSupervisaoConfigurado}
			{#if mobile}
				<button
					type="button"
					class="btn btn-xs preset-filled-warning-500 border border-warning-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-warning-600 disabled:opacity-40 flex items-center gap-1"
					disabled={!assinaturaExtraHabilitada}
					onclick={() => quadro.assinarExtraManual()}
				>
					{@render iconeCaneta()}
					Tela
				</button>
			{:else}
				<button
					type="button"
					class="btn btn-xs preset-filled-warning-500 px-2.5 py-1.5 text-3xs font-semibold rounded-lg disabled:opacity-40 flex items-center gap-1"
					disabled={!assinaturaExtraHabilitada}
					onclick={() => quadro.assinarExtraDigital()}
				>
					{@render iconeCaneta()}
					Token
				</button>
			{/if}
		{/if}
	{/if}
{/snippet}

<div class="flex flex-col gap-1.5 w-full animate-fade">
	{#if !extraSupervisaoConfigurado}
		<p class="text-3xs font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500">
			Relatório de extra (supervisão)
		</p>
		<div
			class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 p-3.5"
		>
			<p
				class="text-xs text-warning-700 dark:text-warning-400 bg-warning-500/10 border border-warning-500/20 rounded-lg px-3 py-2"
			>
				O relatório de extra do quadro ainda não está disponível. Peça ao administrador para
				executar as migrações.
			</p>
		</div>
	{:else}
		<SupervisaoDocumentoCard
			titulo="Relatório de extra (supervisão)"
			textoInfo="O supervisor poderá assinar o relatório de extra do quadro de supervisão quando todos os integrantes confirmarem sua saída."
			badgeEstado={assRelSup ? 'sucesso' : presSupOk ? 'alerta' : 'neutro'}
			badgeLabel={assRelSup
				? 'Assinado'
				: presSupOk
					? 'pronto para assinar'
					: 'Aguardando confirmações'}
			bind:expandido={expandirExtra}
			detalhes={detalhesExtra}
			acoes={acoesExtra}
		/>
	{/if}
</div>
