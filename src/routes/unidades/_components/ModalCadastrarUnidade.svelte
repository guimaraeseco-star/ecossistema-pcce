<script lang="ts">
	/**
	 * Cadastro de unidade (`/unidades`, Admin Geral).
	 *
	 * O nome NÃO é digitado livremente: é montado por partes
	 * (prefixo ordinal + fórmula fixa + local) e mostrado no preview antes de
	 * salvar. A padronização importa porque o nome da unidade é a chave que
	 * amarra lotação do policial, escala e cabeçalho dos PDFs — variações como
	 * "1a DP de Iguatu" quebravam esse casamento.
	 */
	import { SegmentedControl, Switch } from '@skeletonlabs/skeleton-svelte';
	import { enhance } from '$app/forms';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { toaster } from '$lib/toast';
	import { CIDADES_CEARA } from '$lib/constants/cidades';
	import type { Unidade } from '$lib/types';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import type { ActionResult } from '@sveltejs/kit';
	import { TIPOS_UNIDADE, podeSerPaiDe, type TipoUnidade } from '$lib/unidades/tipos';

	let {
		open = $bindable(false),
		seccionais,
		unidades = []
	}: {
		open: boolean;
		seccionais: Unidade[];
		/** Todas as unidades — os pais possíveis de uma subunidade (E66). */
		unidades?: Unidade[];
	} = $props();

	const cadastroFormId = $props.id();

	let tipoUnidade = $state<'delegacia' | 'seccional' | 'subunidade'>('delegacia');
	/**
	 * Subunidade (E66): posto de atendimento, núcleo, seção — o que existe
	 * fisicamente dentro de uma delegacia ou do departamento e não é órgão da
	 * estrutura. O tipo concreto e o pai são escolhidos aqui; a régua de quem
	 * pode ser pai de quem é a do catálogo (`podeSerPaiDe`), conferida no
	 * servidor.
	 */
	let subTipo = $state<TipoUnidade>('unidade');
	let subPaiId = $state<number | null>(null);

	const TIPOS_DE_SUBUNIDADE = TIPOS_UNIDADE.filter((t) =>
		['unidade', 'nucleo', 'secao', 'celula'].includes(t.valor)
	);
	/** Pais possíveis de uma subunidade: tudo o que está ACIMA dela na precedência. */
	const paisPossiveis = $derived(
		unidades
			.filter((u) => podeSerPaiDe(u.tipo, subTipo))
			.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
	);
	let delegaciaPrefixo = $state('');
	let delegaciaSufixo = $state('');
	let seccionalPrefixo = $state('');
	let seccionalSufixo = $state('Interior Sul');
	let novoSeccionalId = $state<number | null>(null);
	let novoTemPlantao = $state(false);
	let novoTemExpediente = $state(false);
	let novoTemFds = $state(false);
	let buscaCidade = $state<string | null>('');
	let pending = $state(false);

	const cidadesOptions = CIDADES_CEARA.map((c) => ({ value: c, label: c }));
	/** Prefixos ordinais ("1ª"…"99ª") usados por delegacias e seccionais. */
	const ORDINAIS = Array.from({ length: 99 }, (_, i) => `${i + 1}ª`);

	/** Nome final, na fórmula oficial de cada tipo de unidade. */
	const novoNome = $derived(
		tipoUnidade === 'delegacia'
			? `${delegaciaPrefixo ? delegaciaPrefixo + ' ' : ''}Delegacia de Polícia Civil de ${delegaciaSufixo}`.trim()
			: `${seccionalPrefixo ? seccionalPrefixo + ' ' : ''}Seccional do ${seccionalSufixo}`.trim()
	);

	function reset() {
		delegaciaPrefixo = '';
		delegaciaSufixo = '';
		seccionalPrefixo = '';
		seccionalSufixo = 'Interior Sul';
		novoSeccionalId = null;
		novoTemPlantao = false;
		novoTemExpediente = false;
		novoTemFds = false;
		buscaCidade = '';
	}

	function handleCadastro() {
		pending = true;
		return async ({ result }: { result: ActionResult }) => {
			pending = false;
			if (result.type === 'success') {
				await invalidateShared('app:unidades');
				toaster.create({ title: 'Unidade cadastrada com sucesso!', type: 'success' });
				reset();
				open = false;
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao cadastrar'), type: 'error' });
			}
		};
	}
</script>

<ModalShell
	bind:open
	title="Cadastrar Nova Unidade"
	largura="md"
	{pending}
	cancelLabel="Cancelar"
	onOpenChange={(aberto) => {
		if (!aberto) reset();
	}}
>
	<form
		id={cadastroFormId}
		method="POST"
		action="?/criar"
		use:enhance={handleCadastro}
		class="flex flex-col gap-4"
	>
		<!-- Campos ocultos: os controles do Skeleton (SegmentedControl/Switch) e o
				     nome derivado não têm input nativo com `name`, então o POST leva estas
				     cópias. `cidade` é exceção — o SearchableSelect já emite a sua. -->
		<input type="hidden" name="nome" value={novoNome} />
		<input type="hidden" name="tipo" value={tipoUnidade === 'subunidade' ? subTipo : tipoUnidade} />
		<input
			type="hidden"
			name="seccional_id"
			value={(tipoUnidade === 'subunidade' ? subPaiId : novoSeccionalId) ?? ''}
		/>
		<input type="hidden" name="tem_plantao" value={novoTemPlantao ? 'on' : ''} />
		<input type="hidden" name="tem_expediente" value={novoTemExpediente ? 'on' : ''} />
		<input type="hidden" name="tem_fds" value={novoTemFds ? 'on' : ''} />

		<div
			class="flex flex-col gap-2 p-4 bg-surface-200/30 dark:bg-surface-800/20 rounded-xl border border-surface-200 dark:border-white/5"
		>
			<SegmentedControl
				value={tipoUnidade}
				onValueChange={(e) => (tipoUnidade = e.value as 'delegacia' | 'seccional')}
				class="w-full"
			>
				<SegmentedControl.Label
					class="text-sm font-semibold text-surface-600 dark:text-surface-400"
				>
					Tipo de Unidade
				</SegmentedControl.Label>
				<SegmentedControl.Control class="w-full">
					<SegmentedControl.Indicator />
					<SegmentedControl.Item value="seccional" class="flex-1">
						<SegmentedControl.ItemText>Seccional</SegmentedControl.ItemText>
						<SegmentedControl.ItemHiddenInput />
					</SegmentedControl.Item>
					<SegmentedControl.Item value="delegacia" class="flex-1">
						<SegmentedControl.ItemText>Delegacia</SegmentedControl.ItemText>
						<SegmentedControl.ItemHiddenInput />
					</SegmentedControl.Item>
					<SegmentedControl.Item value="subunidade" class="flex-1">
						<SegmentedControl.ItemText>Subunidade</SegmentedControl.ItemText>
						<SegmentedControl.ItemHiddenInput />
					</SegmentedControl.Item>
				</SegmentedControl.Control>
			</SegmentedControl>
		</div>

		<div class="flex flex-col gap-1">
			<span class="label-text font-semibold text-sm">Cidade no Ceará</span>
			<SearchableSelect
				name="cidade"
				options={cidadesOptions}
				bind:value={buscaCidade}
				ariaLabel="Selecionar cidade no Ceará"
				placeholder="Buscar e selecionar cidade..."
			/>
		</div>

		{#if tipoUnidade === 'subunidade'}
			<!-- Subunidade (E66): posto, núcleo, seção — pendurada na unidade a que
			     pertence, que pode ser uma delegacia ou o próprio departamento. -->
			<div class="flex flex-col gap-3 animate-in fade-in duration-300">
				<label class="label">
					<span class="label-text">O que é</span>
					<select class="select" bind:value={subTipo}>
						{#each TIPOS_DE_SUBUNIDADE as t (t.valor)}
							<option value={t.valor}>{t.rotulo}</option>
						{/each}
					</select>
				</label>
				<label class="label">
					<span class="label-text">Pertence a</span>
					<select class="select" bind:value={subPaiId}>
						<option value={null}>Selecione a unidade...</option>
						{#each paisPossiveis as u (u.id)}
							<option value={u.id}>{u.nome}</option>
						{/each}
					</select>
					<span class="text-xs text-surface-600 dark:text-surface-400">
						Ninguém é lotado numa subunidade: a lotação continua sendo a unidade, e quem trabalha
						aqui é indicado na ficha do servidor ("Trabalha em").
					</span>
				</label>
			</div>
		{/if}

		{#if tipoUnidade === 'delegacia'}
			<div class="flex flex-col gap-3 animate-in fade-in duration-300">
				<label class="label">
					<span class="label-text">Seccional Vinculada</span>
					<select class="select" bind:value={novoSeccionalId}>
						<option value={null}>Selecione uma Seccional...</option>
						{#each seccionais as sec (sec.id)}
							<option value={sec.id}>{sec.nome}</option>
						{/each}
					</select>
				</label>
				<div class="grid grid-cols-[6rem_1fr] gap-2">
					<label class="label">
						<span class="label-text">Prefixo</span>
						<select class="select" bind:value={delegaciaPrefixo}>
							<option value="">—</option>
							{#each ORDINAIS as ord (ord)}
								<option value={ord}>{ord}</option>
							{/each}
						</select>
					</label>
					<label class="label">
						<span class="label-text">Local (cidade / nome)</span>
						<input class="input" type="text" bind:value={delegaciaSufixo} placeholder="Iguatu" />
					</label>
				</div>
			</div>
		{:else}
			<div class="flex flex-col gap-3 animate-in fade-in duration-300">
				<div class="grid grid-cols-[6rem_1fr] gap-2">
					<label class="label">
						<span class="label-text">Prefixo</span>
						<select class="select" bind:value={seccionalPrefixo}>
							<option value="">—</option>
							{#each ORDINAIS as ord (ord)}
								<option value={ord}>{ord}</option>
							{/each}
						</select>
					</label>
					<label class="label">
						<span class="label-text">Local</span>
						<input
							class="input"
							type="text"
							bind:value={seccionalSufixo}
							placeholder="Interior Sul"
						/>
					</label>
				</div>
			</div>
		{/if}

		<div class="p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
			<p class="text-3xs uppercase font-bold text-primary-600 dark:text-primary-400 mb-1">
				Preview do Nome:
			</p>
			<p class="text-sm font-semibold truncate">{novoNome || 'Preencha os campos...'}</p>
		</div>

		<div
			class="flex flex-col gap-2 p-3 bg-surface-200/50 dark:bg-surface-800/50 rounded-xl border border-surface-300 dark:border-white/5"
		>
			<p class="text-sm font-medium text-surface-600 dark:text-surface-400">Regimes de Escala:</p>
			<div class="flex flex-col gap-2.5 sm:flex-row sm:gap-4 mt-1">
				<Switch checked={novoTemPlantao} onCheckedChange={(e) => (novoTemPlantao = e.checked)}>
					<Switch.Control>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.Label>Plantão</Switch.Label>
					<Switch.HiddenInput />
				</Switch>
				<Switch
					checked={novoTemExpediente}
					onCheckedChange={(e) => (novoTemExpediente = e.checked)}
				>
					<Switch.Control>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.Label>Exped.</Switch.Label>
					<Switch.HiddenInput />
				</Switch>
				<Switch checked={novoTemFds} onCheckedChange={(e) => (novoTemFds = e.checked)}>
					<Switch.Control>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.Label>Fim de Semana</Switch.Label>
					<Switch.HiddenInput />
				</Switch>
			</div>
		</div>
	</form>

	{#snippet footer()}
		<button
			type="submit"
			form={cadastroFormId}
			class="btn preset-filled-primary-500 flex items-center gap-2 transition-all"
			disabled={pending ||
				!novoNome.trim() ||
				!buscaCidade?.trim() ||
				(tipoUnidade === 'delegacia' && !novoSeccionalId) ||
				(tipoUnidade === 'subunidade' && !subPaiId)}
		>
			{pending ? 'Cadastrando...' : 'Cadastrar'}
		</button>
	{/snippet}
</ModalShell>
