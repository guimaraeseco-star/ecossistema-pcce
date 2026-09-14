<script lang="ts">
	/**
	 * Slot Assessor do quadro de supervisão — designação + e-mail de avisos GISE
	 * (com checkbox de confirmação) e marcador de rodagem.
	 *
	 * Sem props: tudo vem do contexto do quadro.
	 */
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import MarcadorPresenca from '../MarcadorPresenca.svelte';
	import Users from '@lucide/svelte/icons/users';
	import BotoesSalvarCancelar from './BotoesSalvarCancelar.svelte';
	import BotoesEdicaoPapel from './BotoesEdicaoPapel.svelte';
	import { presencaDe } from './rodagem';
	import { quadroSupervisao } from './quadro-supervisao-estado.svelte';

	const quadro = quadroSupervisao();

	const emEdicao = $derived(quadro.editandoPapel === 'assessor');
	const podeGerenciar = $derived(
		quadro.isAdminGeral && quadro.podeEditar && quadro.modoEdicaoGeral
	);
</script>

<div
	class="flex flex-col gap-2 p-2.5 px-3 rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 shadow-sm hover:shadow transition-all duration-200 {emEdicao
		? 'col-span-full'
		: ''}"
>
	{#if emEdicao}
		<div class="flex flex-col gap-1.5 w-full">
			<div class="flex items-center gap-2">
				<div class="text-surface-400 dark:text-surface-500 shrink-0">
					<Users size={14} />
				</div>
				<span class="block text-3xs uppercase font-bold text-surface-400 dark:text-surface-500">
					Assessor
				</span>
			</div>
			<div class="flex flex-wrap lg:flex-nowrap items-end gap-3 w-full">
				<div class="flex-1 min-w-0 w-full">
					<span class="block text-3xs font-semibold text-surface-600 dark:text-surface-400 mb-1">
						Nome do Assessor
					</span>
					<SearchableSelect
						id="assessorId"
						bind:value={quadro.ids.assessor}
						loadOptions={quadro.buscarOips}
						ariaLabel="Selecionar assessor"
						selectedOption={quadro.opcaoSelecionada(quadro.ids.assessor)}
						placeholder="Pesquisar Assessor..."
						minSearchChars={2}
						showTrigger={false}
						class="w-full"
					/>
				</div>

				{#if quadro.ids.assessor != null}
					<div class="flex-1 min-w-0 w-full">
						<label
							for="assessorEmailNotif"
							class="block text-3xs font-semibold text-surface-600 dark:text-surface-400 mb-1"
						>
							E-mail (avisos GISE)
						</label>
						<input
							id="assessorEmailNotif"
							type="email"
							name="assessor_email_notificacao"
							autocomplete="email"
							bind:value={quadro.assessorEmailNotificacao}
							class="w-full px-3 py-1.5 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30 focus:outline-none transition-colors text-surface-900 dark:text-surface-50 h-[38px]"
							placeholder="nome@provedor.com"
						/>
					</div>

					<div class="flex items-center h-[38px] shrink-0">
						<label class="flex items-center gap-1.5 cursor-pointer">
							<input
								type="checkbox"
								name="confirmar_email_assessor"
								value="1"
								class="rounded border-surface-400 w-3.5 h-3.5"
								required
							/>
							<span
								class="text-2xs text-surface-600 dark:text-surface-400 leading-none select-none"
							>
								Confirmo e-mail.
							</span>
						</label>
					</div>
				{/if}

				<BotoesSalvarCancelar
					pending={quadro.pendingCrud}
					onCancelar={() => quadro.cancelarEdicao()}
					class="h-[38px]"
				/>
			</div>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-2.5 min-w-0 flex-1">
				<div class="text-surface-400 dark:text-surface-500 shrink-0">
					<Users size={14} />
				</div>
				<div class="overflow-hidden min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
						<span class="text-3xs uppercase font-bold text-surface-400 dark:text-surface-500"
							>Assessor</span
						>
						{#if quadro.gise.assessor_id}
							{@const pr = presencaDe(quadro.presencasGise, quadro.gise.assessor_id)}
							<MarcadorPresenca entrada={pr.entrada} saida={pr.saida} />
						{/if}
					</div>
					<div class="flex items-center gap-2">
						<p class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate">
							{quadro.gise.assessor_id
								? (quadro.nomeDe(quadro.gise.assessor_id) ?? 'Carregando...')
								: 'Não definido'}
						</p>
						{#if podeGerenciar}
							<BotoesEdicaoPapel
								rotulo="assessor"
								temId={!!quadro.gise.assessor_id}
								removendo={quadro.removendoPapel === 'assessor'}
								pending={quadro.pendingCrud}
								onEditar={() => quadro.iniciarEdicao('assessor')}
								onRemover={() => quadro.solicitarRemocao('assessor')}
							/>
						{/if}
					</div>
					{#if quadro.gise.assessor_email_notificacao}
						<p
							class="text-3xs text-surface-600 dark:text-surface-400 truncate mt-0.5"
							title="E-mail para avisos de seccionais"
						>
							Avisos: {quadro.gise.assessor_email_notificacao}
						</p>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
