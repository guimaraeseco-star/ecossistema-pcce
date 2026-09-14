<script lang="ts">
	/**
	 * Slot NUIP OIP (SEINT) do quadro de supervisão — um dos dois papéis
	 * idênticos parametrizados por `papel`. Inclui marcador de rodagem e
	 * edição inline (Admin Geral).
	 *
	 * `papel` é o único prop: diz QUAL das duas instâncias é esta. Todo o resto
	 * vem do contexto do quadro.
	 */
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import MarcadorPresenca from '../MarcadorPresenca.svelte';
	import Users from '@lucide/svelte/icons/users';
	import BotoesSalvarCancelar from './BotoesSalvarCancelar.svelte';
	import BotoesEdicaoPapel from './BotoesEdicaoPapel.svelte';
	import { marcadorRodagem, presencaDe } from './rodagem';
	import { quadroSupervisao } from './quadro-supervisao-estado.svelte';

	const { papel }: { papel: 'seint1' | 'seint2' } = $props();

	const quadro = quadroSupervisao();

	/** Valor persistido (nome e marcador vêm da GISE salva, não do formulário). */
	const idPersistido = $derived(papel === 'seint1' ? quadro.gise.seint1_id : quadro.gise.seint2_id);
	const emEdicao = $derived(quadro.editandoPapel === papel);
	const podeGerenciar = $derived(
		quadro.isAdminGeral && quadro.podeEditar && quadro.modoEdicaoGeral
	);
</script>

<div
	class="flex items-center justify-between gap-2 p-2.5 px-3 rounded-xl bg-white dark:bg-surface-900 border border-secondary-500/20 dark:border-secondary-500/35 shadow-sm hover:shadow transition-all duration-200"
>
	<div class="flex items-center gap-2.5 min-w-0 flex-1">
		<div class="text-secondary-600/70 dark:text-secondary-400/70 shrink-0">
			<Users size={14} />
		</div>
		<div class="overflow-hidden min-w-0 flex-1">
			<!-- Rótulo + indicador de presença na MESMA linha: fica fora do espaço do
			     nome do escalado (que abaixo pode truncar). -->
			<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
				<span class="text-3xs uppercase font-bold text-secondary-500/80 dark:text-secondary-400/80"
					>NUIP OIP</span
				>
				{#if idPersistido}
					{@const pr = presencaDe(quadro.presencasGise, idPersistido)}
					<MarcadorPresenca
						entrada={pr.entrada}
						saida={pr.saida}
						faltaRelatorio={marcadorRodagem(
							'seint',
							idPersistido,
							quadro.presencasGise,
							quadro.seintRelatorioSet
						) === 'falta_relatorio'}
					/>
				{/if}
			</div>
			{#if emEdicao}
				<div class="flex flex-col sm:flex-row sm:items-center gap-2 mt-1 w-full">
					<div class="flex-1 min-w-0">
						<SearchableSelect
							id="{papel}Id"
							bind:value={quadro.ids[papel]}
							loadOptions={quadro.buscarOips}
							ariaLabel="Selecionar NUIP OIP"
							selectedOption={quadro.opcaoSelecionada(quadro.ids[papel])}
							placeholder="Pesquisar NUIP OIP..."
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
				<div class="flex items-center gap-2">
					<p class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate">
						{idPersistido ? (quadro.nomeDe(idPersistido) ?? 'Carregando...') : 'Não definido'}
					</p>
					{#if podeGerenciar}
						<BotoesEdicaoPapel
							rotulo={papel === 'seint1' ? 'NUIP OIP 1' : 'NUIP OIP 2'}
							temId={!!idPersistido}
							removendo={quadro.removendoPapel === papel}
							pending={quadro.pendingCrud}
							onEditar={() => quadro.iniciarEdicao(papel)}
							onRemover={() => quadro.solicitarRemocao(papel)}
						/>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
