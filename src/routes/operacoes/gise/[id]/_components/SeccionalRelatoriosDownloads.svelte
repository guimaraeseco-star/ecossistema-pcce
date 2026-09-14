<script lang="ts">
	/**
	 * Bloco de downloads e assinatura de relatórios da seccional (produtividade
	 * por tipo de equipe + relatório extraordinário). Extraído do antigo snippet
	 * `seccionalRelatoriosDownloads` de GiseSeccional; `compact` alterna o layout
	 * empilhado (accordion mobile) e o inline (barra desktop).
	 *
	 * **BAIXAR e ASSINAR têm portões diferentes, e a diferença é o ponto.** O
	 * bloco de download abre para `isAdminGeral || isSeccional || isSupervisor`;
	 * os botões que ASSINAM o relatório extraordinário exigem `isSupervisor`
	 * sozinho. Um Admin Geral vê "Rel. Extra (conferência)" e não vê "Ass. tela"
	 * nem "Token".
	 *
	 * Isto NÃO é divergência: desde ago/2026 as cinco rotas de servidor do
	 * relatório extra também exigem o supervisor designado. Antes elas aceitavam
	 * `u.tipo === 'admin'` e admitiam por POST direto o que esta tela nunca
	 * ofereceu; o porquê da remoção está no cabeçalho de
	 * `api/gise/[id]/relatorios/[seccionalId]/preparar-assinatura-avancada`.
	 * Quem afrouxar o `isSupervisor` daqui está afrouxando só a tela — o
	 * servidor continua recusando.
	 */
	import { page } from '$app/state';
	import type { GiseDetalhado } from '$lib/db/gise';
	import type { GiseAssinaturaRelatorio } from '$lib/server/schema';
	import { podeBaixarComManifesto } from '$lib/manifesto';
	import { avancadaEmTelaDoLayout } from '$lib/chave-assinatura-ui';
	import ConviteChaveAssinatura from '$lib/components/ConviteChaveAssinatura.svelte';
	import {
		checkAllSigned,
		getFaltandoPresenca,
		tiposEquipeNaSeccional
	} from '$lib/gise/page-helpers';
	import GiseActionButton from './GiseActionButton.svelte';
	import Download from '@lucide/svelte/icons/download';
	import PenLine from '@lucide/svelte/icons/pen-line';

	type Seccional = GiseDetalhado['seccionais'][number];

	const {
		compact,
		sec,
		gise,
		assinaturasRelatorios,
		podeDownload,
		isAdminGeral,
		isSeccional,
		isSupervisor,
		isMobile,
		restringirSmartphone,
		pendingCrud,
		onAssinarRelatorioManual,
		onAssinarRelatorioDigital
	}: {
		compact: boolean;
		sec: Seccional;
		gise: GiseDetalhado;
		assinaturasRelatorios: GiseAssinaturaRelatorio[] | undefined;
		podeDownload: boolean;
		isAdminGeral: boolean;
		isSeccional: boolean;
		isSupervisor: boolean;
		isMobile: boolean;
		restringirSmartphone: boolean;
		pendingCrud: boolean;
		onAssinarRelatorioManual: (seccionalId: number) => void;
		onAssinarRelatorioDigital: (
			seccionalId: number,
			tipo: 'extraordinario',
			seccionalNome: string
		) => void;
	} = $props();

	const avancadaDisponivel = $derived(avancadaEmTelaDoLayout(page.data));
</script>

{#if podeDownload}
	{@const assRel = assinaturasRelatorios?.find(
		(a: GiseAssinaturaRelatorio) =>
			(a.seccional_id === sec.seccional_id || a.seccional_id === sec.id) &&
			a.tipo === 'extraordinario'
	)}
	{@const tiposProd = tiposEquipeNaSeccional(sec)}
	<div
		class={compact
			? 'flex w-full min-w-0 flex-col gap-2'
			: 'flex w-full min-w-0 flex-row flex-wrap items-center justify-start gap-2 sm:gap-2.5 lg:flex-1'}
	>
		{#each tiposProd as tipo (tipo)}
			{@const hrefProd = `/api/gise/${gise.id}/download?format=produtividade&seccionalId=${sec.seccional_id}&equipeType=${tipo}`}
			{@const rótuloProd = tipo === 'seint' ? 'Prod. SEINT' : 'Prod. Op.'}
			{#if sec.temRespostas}
				<a
					class="btn text-xs font-semibold px-3 py-2 rounded-xl max-w-full justify-center no-underline inline-flex items-center gap-1.5 preset-outlined-surface-500 {compact
						? 'w-full'
						: 'w-auto'}"
					href={hrefProd}
					target="_blank"
					rel="noopener noreferrer"
					title="Baixar {rótuloProd === 'Prod. SEINT'
						? 'produtividade SEINT'
						: 'produtividade operacional'}"
				>
					<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
						/></svg
					>
					<span class="shrink-0">{rótuloProd}</span>
				</a>
			{:else}
				<button
					type="button"
					class="btn text-xs font-semibold px-3 py-2 rounded-xl max-w-full inline-flex items-center justify-center gap-1.5 preset-outlined-surface-500 opacity-50 {compact
						? 'w-full'
						: 'w-full xs:w-auto sm:w-auto'}"
					disabled
					title="Aguardando preenchimento do formulário de produtividade desta seccional"
				>
					<svg
						class="w-4 h-4 shrink-0 opacity-90"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
						/></svg
					>
					<span class="shrink-0">{rótuloProd}</span>
					<span class="text-3xs font-medium italic">(aguardando)</span>
				</button>
			{/if}
		{/each}

		<div
			class={compact
				? 'flex w-full flex-col gap-2'
				: 'flex w-full xs:w-auto xs:max-w-full xs:shrink-0 flex-col xs:flex-row xs:flex-wrap xs:items-center gap-2'}
		>
			{#if assRel}
				<!-- "C/ manifesto" só aparece para quem o servidor de fato atende com o
				     blob forense (Admin Geral/Super ou o DPC assinante) — os demais
				     receberiam a cópia de conferência de qualquer forma, então veem um
				     único botão "Rel. Extra". -->
				{@const podeManifesto = podeBaixarComManifesto(page.data.usuario, assRel.assinante_id)}
				<div class="flex gap-2 {compact ? 'w-full' : 'w-full xs:w-auto'}">
					<a
						class="btn flex-1 text-xs font-semibold px-2 py-2 rounded-xl no-underline flex items-center justify-center gap-1.5 preset-filled-success-500"
						href={`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${sec.seccional_id}`}
						target="_blank"
						rel="noopener noreferrer"
						title={`Relatório de extra${podeManifesto ? ' sem manifesto' : ''} — assinado por ${assRel.assinante_nome}`}
					>
						<Download class="w-3 h-3 shrink-0" aria-hidden="true" />
						<span class="whitespace-nowrap"
							>{podeManifesto ? 'Rel. Extra S/ manifesto' : 'Rel. Extra'}</span
						>
					</a>
					{#if podeManifesto}
						<a
							class="btn flex-1 text-xs font-semibold px-2 py-2 rounded-xl no-underline flex items-center justify-center gap-1.5 preset-outlined-surface-500"
							href={`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${sec.seccional_id}&manifesto=true`}
							target="_blank"
							rel="noopener noreferrer"
							title="Relatório de extra com manifesto — inclui folha de auditoria"
						>
							<Download class="w-3 h-3 shrink-0" aria-hidden="true" />
							<span class="whitespace-nowrap">Rel. Extra C/ manifesto</span>
						</a>
					{/if}
				</div>
			{:else}
				<a
					class="btn text-xs font-semibold px-3 py-2 rounded-xl flex items-center justify-center gap-2 preset-outlined-surface-500 {!(
						checkAllSigned(sec) &&
						(isAdminGeral || isSeccional || isSupervisor)
					)
						? 'pointer-events-none opacity-60'
						: 'no-underline'} {compact ? 'w-full' : 'w-full xs:w-auto'}"
					href={`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${sec.seccional_id}`}
					target="_blank"
					rel="noopener noreferrer"
					title={!checkAllSigned(sec)
						? getFaltandoPresenca(sec)
						: 'Aguardando assinatura do supervisor (escala)'}
				>
					<PenLine class="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
					<span class="whitespace-nowrap">Rel. Extra</span>
					<span class="text-3xs opacity-100 dark:opacity-80 font-normal italic ml-1"
						>({!checkAllSigned(sec) ? 'não concluído' : 'conferência'})</span
					>
				</a>
			{/if}
			{#if isSupervisor && !assRel && checkAllSigned(sec)}
				<div
					class={compact
						? 'flex w-full flex-col gap-2'
						: 'flex w-full xs:w-auto flex-col xs:flex-row items-stretch xs:items-center gap-2'}
				>
					{#if (isMobile || !restringirSmartphone) && avancadaDisponivel}
						<GiseActionButton
							label={isMobile ? 'Ass. tela' : 'Assinar'}
							iconPath="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
							variant="warning"
							type="filled"
							onclick={() => onAssinarRelatorioManual(sec.seccional_id)}
							classes={compact
								? 'text-3xs py-2 font-semibold w-full min-h-11 touch-manipulation shrink-0'
								: 'text-3xs py-1.5 sm:py-1 font-semibold w-full xs:w-auto min-h-11 sm:min-h-0 touch-manipulation shrink-0'}
							size="xs"
							{pendingCrud}
						/>
					{:else if (isMobile || !restringirSmartphone) && !avancadaDisponivel}
						<ConviteChaveAssinatura {isMobile} compact />
					{/if}

					{#if !isMobile && (restringirSmartphone || !avancadaDisponivel)}
						<GiseActionButton
							label="Ass. token"
							iconPath="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
							variant="warning"
							type="filled"
							onclick={() =>
								onAssinarRelatorioDigital(sec.seccional_id, 'extraordinario', sec.seccional_nome)}
							classes={compact
								? 'text-3xs py-2 font-semibold w-full min-h-11 touch-manipulation shrink-0'
								: 'text-3xs py-1.5 sm:py-1 font-semibold w-full xs:w-auto min-h-11 sm:min-h-0 touch-manipulation shrink-0'}
							size="xs"
							{pendingCrud}
						/>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}
