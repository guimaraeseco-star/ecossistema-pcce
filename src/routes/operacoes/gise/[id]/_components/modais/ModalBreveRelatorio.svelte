<script lang="ts">
	/**
	 * Edição do breve relatório da GISE — o texto que vai para dentro do PDF.
	 *
	 * Os `maxlength` daqui usam as MESMAS constantes que a action grava
	 * (`MAX_BREVE_TITULO`, `MAX_BREVE_PARAGRAFO`, de `$lib/gise/breve-relatorio`)
	 * e que `/operacoes/gise/operacoes` já aplicava nos campos equivalentes. Este modal não
	 * tinha limite nenhum: a mesma coluna era limitada numa tela e livre na
	 * outra, e o texto entra em documento ASSINADO.
	 *
	 * O `maxlength` continua sendo dica de digitação — quem impõe é o servidor.
	 * Importar a constante, em vez de repetir o número, é o que impede a tela de
	 * prometer um limite e o banco guardar outro.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { BreveRelatorioEnv } from '$lib/gise/breve-relatorio';
	import {
		DEFAULT_BREVE_RELATORIO_TITULO,
		DEFAULT_BREVE_RELATORIO_TEXTO_SECCIONAL,
		DEFAULT_BREVE_RELATORIO_TEXTO_SUPERVISAO,
		resolveBreveRelatorioTitulo,
		resolveBreveRelatorioConteudoSeccional,
		resolveBreveRelatorioConteudoSupervisao,
		// Os MESMOS limites que a action grava e que `/operacoes/gise/operacoes` já usava
		// nos campos equivalentes. Este modal não tinha `maxlength` nenhum.
		MAX_BREVE_TITULO,
		MAX_BREVE_PARAGRAFO
	} from '$lib/gise/breve-relatorio';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';

	interface GiseBreve {
		breve_relatorio_titulo: string | null;
		breve_relatorio_texto_seccional: string | null;
		breve_relatorio_texto_supervisao: string | null;
	}

	interface Props {
		open: boolean;
		gise: GiseBreve;
		/** Texto herdado (operação → global) + as colunas desta GISE = texto no PDF. */
		global: BreveRelatorioEnv | null | undefined;
		pendingCrud: boolean;
		onClose: () => void;
		onSubmit: SubmitFunction;
	}

	const { open, gise, global, pendingCrud, onClose, onSubmit }: Props = $props();

	let titulo = $state('');
	let textoSeccional = $state('');
	let textoSupervisao = $state('');

	let wasOpen = $state(false);
	$effect(() => {
		if (open && !wasOpen) {
			titulo = resolveBreveRelatorioTitulo(gise, global);
			textoSeccional = resolveBreveRelatorioConteudoSeccional(gise, global);
			textoSupervisao = resolveBreveRelatorioConteudoSupervisao(gise, global);
		}
		wasOpen = open;
	});
</script>

<!--
	Exceção deliberada ao ModalShell: o editor precisa de altura limitada a
	720px e layout flex com textarea rolável e rodapé preso ao painel. O contrato
	canônico de conteúdo rolável inteiro quebraria essa composição.
-->
<Dialog
	{open}
	onOpenChange={(e) => {
		if (!pendingCrud && !e.open) onClose();
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card-elevated rounded-2xl shadow-2xl w-full max-w-2xl max-h-[min(calc(100dvh-1.5rem),720px)] flex flex-col p-4 sm:p-6"
		>
			<Dialog.Title class="text-lg font-bold text-surface-900 dark:text-surface-50 shrink-0 mb-1">
				Texto "Breve relatório" (PDFs de extra)
			</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-600 dark:text-surface-400 mb-4 shrink-0">
				Aqui você pode personalisar o texto do <strong>Relatório de Extra</strong>
				desta escala GISE.
			</Dialog.Description>

			<form
				method="POST"
				action="?/salvarBreveRelatorio"
				use:enhance={onSubmit}
				class="flex flex-col gap-3 min-h-0 flex-1 overflow-y-auto"
			>
				<div>
					<label class="block text-sm font-medium mb-1" for="br_modal_tit">Título (rótulo)</label>
					<input
						id="br_modal_tit"
						name="breve_relatorio_titulo"
						type="text"
						maxlength={MAX_BREVE_TITULO}
						bind:value={titulo}
						class="w-full px-2 py-1.5 text-sm rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900"
						placeholder={DEFAULT_BREVE_RELATORIO_TITULO}
					/>
				</div>
				<div>
					<label class="block text-sm font-medium mb-1" for="br_modal_sec"
						>Parágrafo — extra das <strong>seccional</strong></label
					>
					<textarea
						id="br_modal_sec"
						name="breve_relatorio_texto_seccional"
						rows="3"
						maxlength={MAX_BREVE_PARAGRAFO}
						bind:value={textoSeccional}
						class="w-full px-2 py-1.5 text-sm rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900"
						placeholder={DEFAULT_BREVE_RELATORIO_TEXTO_SECCIONAL}></textarea>
				</div>
				<div>
					<label class="block text-sm font-medium mb-1" for="br_modal_sup"
						>Parágrafo — extra de <strong>supervisão/apoio</strong></label
					>
					<textarea
						id="br_modal_sup"
						name="breve_relatorio_texto_supervisao"
						rows="3"
						maxlength={MAX_BREVE_PARAGRAFO}
						bind:value={textoSupervisao}
						class="w-full px-2 py-1.5 text-sm rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900"
						placeholder={DEFAULT_BREVE_RELATORIO_TEXTO_SUPERVISAO}></textarea>
				</div>
				<div
					class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2 border-t border-surface-200 dark:border-surface-700 shrink-0"
				>
					<button
						type="button"
						class="btn preset-outlined-surface-500 text-sm px-4 py-2 rounded-xl"
						onclick={onClose}
						disabled={pendingCrud}
					>
						Cancelar
					</button>
					<button
						type="submit"
						class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl"
						disabled={pendingCrud}
					>
						{pendingCrud ? 'Salvando...' : 'Salvar textos'}
					</button>
				</div>
			</form>
		</div>
	</Dialog.Content>
</Dialog>
