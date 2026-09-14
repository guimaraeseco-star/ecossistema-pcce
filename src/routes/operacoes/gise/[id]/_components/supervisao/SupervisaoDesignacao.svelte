<script lang="ts">
	/**
	 * DESIGNAÇÃO do quadro de supervisão — supervisor (DPC), assessor e os dois
	 * SEINT. Form `?/salvarSupervisores`, edição POR PAPEL e ModalShell de
	 * confirmação ao remover designação.
	 *
	 * Sem props: o estado do formulário vive em `quadro-supervisao-estado`. O que
	 * fica aqui é o que depende do DOM — o `<form>`, os inputs hidden e o modal
	 * de confirmação, que precisa submeter o formulário depois de limpar o id.
	 *
	 * Marcadores de entrada/saída vêm de `rodagem.ts`; os slots SEINT moram em
	 * `SupervisaoPapelSeint.svelte`.
	 */
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import MarcadorPresenca from '../MarcadorPresenca.svelte';
	import UserRound from '@lucide/svelte/icons/user-round';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import SupervisaoPapelAssessor from './SupervisaoPapelAssessor.svelte';
	import SupervisaoPapelSeint from './SupervisaoPapelSeint.svelte';
	import BotoesSalvarCancelar from './BotoesSalvarCancelar.svelte';
	import BotoesEdicaoPapel from './BotoesEdicaoPapel.svelte';
	import { presencaDe } from './rodagem';
	import { quadroSupervisao } from './quadro-supervisao-estado.svelte';

	const quadro = quadroSupervisao();

	let formEl = $state<HTMLFormElement | null>(null);

	const podeGerenciar = $derived(
		quadro.isAdminGeral && quadro.podeEditar && quadro.modoEdicaoGeral
	);

	$effect(() => {
		if (!quadro.pendingCrud) {
			quadro.removendoPapel = null;
		}
	});

	/**
	 * Remoção é "limpar o id e salvar" — por isso mora aqui, junto do `<form>`:
	 * o estado sai do quadro, o submit sai deste componente.
	 */
	function confirmarRemocao() {
		const papel = quadro.papelParaRemover;
		if (!papel) return;

		quadro.confirmarRemocaoOpen = false;
		quadro.papelParaRemover = null;

		quadro.removendoPapel = papel;
		quadro.ids[papel] = null;
		if (papel === 'assessor') {
			quadro.assessorEmailNotificacao = '';
		}

		// Garante que o estado seja atualizado nos inputs hidden antes de submeter
		// (tick() é determinístico; setTimeout(50) era uma corrida com o DOM).
		void tick().then(() => {
			if (formEl) {
				formEl.requestSubmit();
			}
		});
	}
</script>

<form
	bind:this={formEl}
	method="POST"
	action="?/salvarSupervisores"
	use:enhance={quadro.onSubmitDesignacao}
	class="contents"
>
	<div
		class="p-3 sm:p-4 md:p-5 rounded-2xl bg-white dark:bg-surface-950 border border-surface-200 dark:border-surface-800 shadow-sm"
	>
		<div class="space-y-2.5 sm:space-y-4">
			<div class="flex items-start gap-2.5 sm:gap-4">
				<div
					class="mt-1 flex-shrink-0 w-10 h-10 rounded-full bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-sm"
				>
					<UserRound size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-0.5">
						<span
							class="text-3xs uppercase tracking-wider font-bold text-surface-600 dark:text-surface-400"
							>DPC Supervisão</span
						>
						{#if quadro.gise.supervisor_id}
							{@const pr = presencaDe(quadro.presencasGise, quadro.gise.supervisor_id)}
							<MarcadorPresenca entrada={pr.entrada} saida={pr.saida} />
						{/if}
					</div>
					{#if quadro.editandoPapel === 'supervisor'}
						<div class="flex flex-col sm:flex-row sm:items-center gap-2 mt-1 w-full">
							<div class="flex-1 min-w-0 sm:max-w-md">
								<SearchableSelect
									id="supId"
									bind:value={quadro.ids.supervisor}
									loadOptions={quadro.buscarDpcs}
									ariaLabel="Selecionar DPC de supervisão"
									selectedOption={quadro.opcaoSelecionada(quadro.ids.supervisor)}
									placeholder="Pesquisar DPC..."
									minSearchChars={2}
									showTrigger={false}
									class="w-full"
								/>
							</div>
							<BotoesSalvarCancelar
								pending={quadro.pendingCrud}
								onCancelar={() => quadro.cancelarEdicao()}
							/>
						</div>
					{:else}
						<div class="flex min-w-0 items-center gap-3">
							<p
								class="min-w-0 shrink font-bold text-lg leading-tight text-surface-900 dark:text-white truncate"
							>
								{quadro.gise.supervisor_nome ?? 'Não definido'}
							</p>

							{#if podeGerenciar}
								<BotoesEdicaoPapel
									rotulo="DPC de supervisão"
									temId={!!quadro.gise.supervisor_id}
									compacto={false}
									removendo={quadro.removendoPapel === 'supervisor'}
									pending={quadro.pendingCrud}
									onEditar={() => quadro.iniciarEdicao('supervisor')}
									onRemover={() => quadro.solicitarRemocao('supervisor')}
								/>
							{/if}
						</div>
					{/if}
				</div>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 pt-1.5 sm:pt-2">
				<SupervisaoPapelAssessor />

				<!-- NUIP OIP 1 e 2 — mesmo card, parametrizado pelo papel -->
				<SupervisaoPapelSeint papel="seint1" />
				<SupervisaoPapelSeint papel="seint2" />
			</div>
		</div>
	</div>

	<input type="hidden" name="supervisor_id" value={quadro.ids.supervisor ?? ''} />
	<input type="hidden" name="assessor_id" value={quadro.ids.assessor ?? ''} />
	<input type="hidden" name="seint1_id" value={quadro.ids.seint1 ?? ''} />
	<input type="hidden" name="seint2_id" value={quadro.ids.seint2 ?? ''} />
	{#if quadro.editandoPapel !== 'assessor'}
		<input
			type="hidden"
			name="assessor_email_notificacao"
			value={quadro.assessorEmailNotificacao ?? ''}
		/>
		{#if quadro.ids.assessor != null}
			<input type="hidden" name="confirmar_email_assessor" value="1" />
		{/if}
	{/if}
</form>

<ModalShell
	bind:open={quadro.confirmarRemocaoOpen}
	title="Remover designação?"
	familia="gise"
	largura="sm"
	pending={quadro.pendingCrud}
	cancelLabel="Cancelar"
	onOpenChange={(isOpen) => {
		if (!isOpen) quadro.papelParaRemover = null;
	}}
>
	{#snippet description()}
		Deseja realmente remover esta designação?
	{/snippet}

	{#snippet footer()}
		<button
			type="button"
			class="btn preset-filled-error-500"
			onclick={confirmarRemocao}
			disabled={quadro.pendingCrud}
		>
			Remover
		</button>
	{/snippet}
</ModalShell>
