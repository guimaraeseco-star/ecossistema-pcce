<script lang="ts">
	/**
	 * Diálogo genérico de aviso da lista GISE: um título, bullets de explicação e
	 * até duas ações opcionais.
	 *
	 * É o modal usado quando o clique do usuário não pôde ser atendido ("faltam
	 * assinaturas", "escala ainda em preenchimento") e às vezes oferece o caminho
	 * alternativo — por isso a aparência muda conforme haja ação: com ação vira um
	 * convite (ícone de lápis, tertiary); sem ação, um alerta (warning).
	 */
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import SquarePen from '@lucide/svelte/icons/square-pen';

	type AcaoDialog = { label: string; fn: () => void };

	type DialogInfo = {
		titulo: string;
		linhas: string[];
		/** Ação principal; sua presença é o que troca o modal de "alerta" para "convite". */
		acao?: AcaoDialog;
		/** Alternativa (ex.: baixar sem manifesto × com manifesto); exige `acao`. */
		acaoSecundaria?: AcaoDialog;
	};

	const {
		dialogInfo,
		onClose
	}: {
		dialogInfo: DialogInfo | null;
		onClose: () => void;
	} = $props();
</script>

<!--
	Exceção deliberada ao ModalShell: este diálogo global z-[100] alterna entre
	alerta informativo e convite com duas ações equivalentes, portanto não usa
	o título/descrição/rodapé canônicos de confirmação.
-->
<Dialog
	open={dialogInfo !== null}
	onOpenChange={(e) => {
		if (!e.open) onClose();
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-[100] flex items-center justify-center bg-surface-950/80 p-4 backdrop-blur-sm"
	>
		{#if dialogInfo}
			<div class="w-full max-w-sm rounded-2xl card-elevated p-6 shadow-xl space-y-4">
				<div class="flex items-start gap-3">
					<div
						class="mt-0.5 shrink-0 rounded-lg p-2 {dialogInfo.acao
							? 'bg-tertiary-500/10'
							: 'bg-warning-500/10'}"
					>
						{#if dialogInfo.acao}
							<SquarePen class="w-5 h-5 text-tertiary-500" aria-hidden="true" />
						{:else}
							<svg
								class="w-5 h-5 text-warning-500"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<Dialog.Title class="text-base font-bold text-surface-900 dark:text-surface-50">
							{dialogInfo.titulo}
						</Dialog.Title>
					</div>
				</div>

				<ul class="space-y-1.5 pl-1">
					{#each dialogInfo.linhas as linha (linha)}
						<li class="flex items-start gap-2 text-sm text-surface-600 dark:text-surface-300">
							<span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-surface-400"></span>
							{linha}
						</li>
					{/each}
				</ul>

				<!-- Duas ações empilham (lado a lado + Cancelar embaixo); uma só fica na
				     linha do rodapé, no padrão dos demais modais. -->
				<div class="flex flex-col gap-2 pt-1">
					{#if dialogInfo.acao && dialogInfo.acaoSecundaria}
						<!-- `@const` locais: o TypeScript não estreita `dialogInfo.acao` dentro
						     dos handlers, então guardamos a referência já verificada. -->
						{@const acao = dialogInfo.acao}
						{@const acaoSec = dialogInfo.acaoSecundaria}
						<div class="flex gap-2">
							<button
								type="button"
								class="btn flex-1 preset-filled-primary-500 rounded-xl px-3 py-2 text-sm font-semibold"
								onclick={acao.fn}
							>
								{acao.label}
							</button>
							<button
								type="button"
								class="btn flex-1 preset-outlined-surface-500 rounded-xl px-3 py-2 text-sm font-semibold"
								onclick={acaoSec.fn}
							>
								{acaoSec.label}
							</button>
						</div>
						<button
							type="button"
							class="btn preset-outlined-surface-500 rounded-xl px-4 py-2 text-sm font-semibold w-full"
							onclick={onClose}
						>
							Cancelar
						</button>
					{:else}
						<div class="flex justify-end gap-3">
							<button
								type="button"
								class="btn preset-outlined-surface-500 rounded-xl px-4 py-2 text-sm font-semibold"
								onclick={onClose}
							>
								{dialogInfo.acao ? 'Cancelar' : 'Entendi'}
							</button>
							{#if dialogInfo.acao}
								{@const acao = dialogInfo.acao}
								<button
									type="button"
									class="btn preset-filled-primary-500 rounded-xl px-4 py-2 text-sm font-semibold"
									onclick={acao.fn}
								>
									{acao.label}
								</button>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog>
