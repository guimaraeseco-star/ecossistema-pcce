<script lang="ts">
	/**
	 * Select com busca — usado em todo lugar que escolhe policial ou unidade.
	 *
	 * Dois modos, e a diferença é de onde vêm as opções:
	 * - `options` fixo (unidades, alguns milhares no máximo, já carregados);
	 * - `loadOptions` assíncrono (policiais), com debounce e CANCELAMENTO da
	 *   busca anterior via `useBuscaDebounce`. Sem cancelar, respostas fora de
	 *   ordem faziam a lista piscar com o resultado de uma busca já abandonada.
	 *
	 * `selectedOption` existe além de `value` porque o rótulo do item escolhido
	 * pode não estar na lista atual: reabrir uma escala mostra "FULANO DE TAL"
	 * sem precisar rebuscar, e digitar outra coisa não apaga a seleção.
	 *
	 * O menu vai num `Portal` para escapar do `overflow` das tabelas e modais
	 * onde o componente costuma viver.
	 *
	 * Contorno e clear: o CSS do Skeleton (`[data-scope=combobox]`) aplica
	 * `@apply input` no Input e `btn preset-tonal` (+ hover error) no
	 * ClearTrigger SEM ícone. Sem neutralizar, o Control + Input geram borda
	 * dupla e o clear vira bolinha vermelha vazia. O item selecionado
	 * (`data-state=checked`) leva `preset-filled` — fundo preto com o texto
	 * do item por cima; a recusa mora no `app.css`, junto do `transform` do
	 * gatilho.
	 *
	 * O gatilho (chevron) é tirado do `position: absolute` do Skeleton com
	 * `!static !inset-auto` para entrar na fileira do Control. O `transform:
	 * translateY(-50%)` que sobra com isso é zerado no `app.css` — e não aqui
	 * com `translate-y-0`, que é propriedade diferente e só SOMA ao transform
	 * (era a causa do chevron vazando acima do campo). Ver o comentário lá.
	 *
	 * **Busca inteligente (E76)** — esta é a peça única de TODA lista de
	 * escolha do sistema (decisão dele em 26/09). O que ela garante:
	 * - O filtro é a busca por partes (`casaPorPartes`), a MESMA regra do
	 *   servidor: "jua nor" acha "2ª Delegacia de Polícia Civil de Juazeiro do
	 *   Norte". Antes era `label.includes(termo)`, que exigia digitar na ordem
	 *   e com acento.
	 * - O aviso "Digite um nome ou partes dele" aparece em toda caixa: a lupa
	 *   no campo, o texto do campo vazio e a primeira linha da lista aberta —
	 *   esta última continua lá quando o campo já mostra uma escolha.
	 * - `detalhe` (opcional) é o segundo texto da opção — o nome da mãe, numa
	 *   lista de unidades. Aparece embaixo do nome E entra na busca: "fortim
	 *   aracati" acha o posto de Fortim.
	 * - `opcaoVazia` é o vazio com sentido próprio ("Todas as seccionais", "—
	 *   sem lotação —"): vira a PRIMEIRA opção da lista, escolhível como as
	 *   outras, e o campo mostra esse texto quando nada está escolhido. Escolhê-
	 *   la devolve `value = null` (e o campo escondido vai vazio no formulário).
	 * - `onchange` avisa depois que a escolha já está no campo escondido, e
	 *   entrega o próprio campo — as telas que enviam o formulário ao escolher
	 *   fazem `campo.form?.requestSubmit()`, como faziam com o `<select>`.
	 */
	import { tick } from 'svelte';
	import {
		Combobox,
		Portal,
		useListCollection,
		type ComboboxRootProps
	} from '@skeletonlabs/skeleton-svelte';
	import X from '@lucide/svelte/icons/x';
	import Search from '@lucide/svelte/icons/search';
	import { useBuscaDebounce } from '$lib/composables/useBuscaDebounce.svelte';
	import { casaPorPartes } from '$lib/utils/busca-por-partes';
	import Spinner from './Spinner.svelte';

	type Option = { value: unknown; label: string; detalhe?: string };

	/** O aviso que toda caixa mostra (decisão dele em 26/09). */
	const AVISO_DE_BUSCA = 'Digite um nome ou partes dele';

	/**
	 * O valor interno da opção vazia. A lista do Skeleton trabalha com texto e
	 * não aceita escolher "nada" como item; este marcador nunca sai daqui —
	 * para fora, a opção vazia é `null`.
	 */
	const VALOR_DA_OPCAO_VAZIA = '__opcao_vazia__';

	let {
		options = [],
		loadOptions = undefined,
		selectedOption = undefined,
		debounceMs = 300,
		minSearchChars = 0,
		showTrigger = true,
		value = $bindable<unknown>(null),
		placeholder = AVISO_DE_BUSCA,
		opcaoVazia = undefined,
		onchange = undefined,
		id = '',
		ariaLabel = '',
		name = '',
		class: className = '',
		disabled = false
	}: {
		options?: Option[];
		loadOptions?: (query: string, signal: AbortSignal) => Promise<Option[]>;
		selectedOption?: Option | null;
		debounceMs?: number;
		minSearchChars?: number;
		showTrigger?: boolean;
		value: unknown;
		placeholder?: string;
		/** Rótulo do vazio com sentido próprio; vira a primeira opção da lista. */
		opcaoVazia?: string;
		/** Chamado depois que a pessoa escolhe, com o campo escondido já atualizado. */
		onchange?: (value: unknown, campo: HTMLInputElement) => void;
		id?: string;
		ariaLabel?: string;
		name?: string;
		class?: string;
		disabled?: boolean;
	} = $props();

	const isAsync = $derived(typeof loadOptions === 'function');

	function isValueEmpty(v: unknown): boolean {
		return v === null || v === undefined || v === '';
	}

	/** O que a pessoa digitou para filtrar — vazio ao abrir a lista e ao escolher. */
	let termo = $state('');
	let campoEscondido = $state<HTMLInputElement>();

	const syncItems = $derived(
		termo ? options.filter((o) => casaPorPartes([o.label, o.detalhe ?? ''], termo)) : options
	);

	// Async mode: debounce + abort + flags encapsulados no composable.
	// Getters preservam a reatividade das props (lidas a cada busca).
	const busca = useBuscaDebounce<Option>({
		debounceMs: () => debounceMs,
		minChars: () => minSearchChars,
		buscar: (termo, signal) => loadOptions!(termo, signal)
	});

	// For async: seed items with selectedOption so label shows for pre-selected values
	const effectiveAsyncItems = $derived.by(() => {
		if (busca.resultados.length > 0) return busca.resultados;
		if (!isValueEmpty(value)) {
			const hint = selectedOption ?? null;
			if (hint && String(hint.value) === String(value)) return [hint as Option];
		}
		return [];
	});

	/** A opção vazia, quando existe e casa com o que foi digitado ("todas" acha "Todas as seccionais"). */
	const itemVazio = $derived<Option[]>(
		opcaoVazia !== undefined && casaPorPartes(opcaoVazia, termo)
			? [{ value: VALOR_DA_OPCAO_VAZIA, label: opcaoVazia }]
			: []
	);

	const items = $derived([...itemVazio, ...(isAsync ? effectiveAsyncItems : syncItems)]);

	const collection = $derived(
		useListCollection({
			items,
			itemToString: (item) => item.label,
			itemToValue: (item) => String(item.value)
		})
	);

	// Combobox expects string[] for value. Sem escolha e com opção vazia, a
	// escolhida é ela — o campo mostra "Todas as seccionais", não fica em branco.
	const comboboxValue = $derived(
		!isValueEmpty(value) ? [String(value)] : opcaoVazia !== undefined ? [VALOR_DA_OPCAO_VAZIA] : []
	);

	const onValueChange: ComboboxRootProps['onValueChange'] = async (event) => {
		termo = '';
		const strVal = event.value?.[0];
		if (strVal === undefined || strVal === VALOR_DA_OPCAO_VAZIA) {
			value = null;
		} else {
			const option = items.find((o) => String(o.value) === strVal);
			// Preserve original type (e.g. number ids)
			value = option ? option.value : strVal;
		}
		if (onchange && campoEscondido) {
			// Espera o campo escondido receber o valor: quem envia o formulário
			// ao escolher enviaria o valor anterior.
			await tick();
			onchange(value, campoEscondido);
		}
	};

	const onOpenChange: ComboboxRootProps['onOpenChange'] = (event) => {
		busca.erro = '';
		// Ao abrir, a lista vem inteira — exceto quando quem abriu foi a própria
		// digitação, que já está filtrando.
		if (!event.open || event.reason !== 'input-change') termo = '';
	};

	const onInputValueChange: ComboboxRootProps['onInputValueChange'] = (event) => {
		const term = event.inputValue;
		// Só a digitação filtra. Escolher um item também escreve no campo (o
		// rótulo escolhido), e filtrar por ele deixaria só aquele item na lista.
		const digitou = !event.reason || event.reason === 'input-change';
		termo = digitou ? term : '';

		if (isAsync) busca.buscar(term);
	};

	/**
	 * Ao entrar no campo, o texto já escrito fica selecionado: a primeira tecla
	 * substitui a escolha atual e começa a busca, sem precisar apagar antes.
	 * No quadro seguinte, porque o clique do mouse desfaz uma seleção feita
	 * durante o próprio foco.
	 */
	function selecionarAoEntrar(e: FocusEvent) {
		const campo = e.currentTarget as HTMLInputElement;
		requestAnimationFrame(() => campo.select());
	}
</script>

<div class="relative w-full min-w-0 {className}">
	<input
		type="hidden"
		bind:this={campoEscondido}
		{name}
		value={isValueEmpty(value) ? '' : String(value)}
	/>
	<Combobox
		value={comboboxValue}
		{collection}
		{placeholder}
		{disabled}
		{onValueChange}
		{onOpenChange}
		{onInputValueChange}
		openOnClick
		class="w-full min-w-0"
	>
		<Combobox.Control
			class="flex items-center w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 focus-within:border-primary-400 focus-within:ring-1 focus-within:ring-primary-400/30 transition-colors overflow-hidden {disabled
				? 'opacity-60 cursor-not-allowed'
				: ''}"
		>
			<!-- A lupa diz, antes de qualquer clique, que aqui se digita para achar. -->
			<Search class="ml-2.5 h-3.5 w-3.5 shrink-0 text-surface-400" aria-hidden="true" />
			<Combobox.Input
				id={id || undefined}
				aria-label={ariaLabel || undefined}
				onfocus={selecionarAoEntrar}
				class="flex-1 min-w-0 !m-0 !min-h-0 !rounded-none !border-0 !bg-transparent !pl-2 !pr-3 !py-1.5 !shadow-none !ring-0 text-sm text-surface-900 dark:text-surface-50 placeholder:text-surface-400 focus:!outline-none focus:!ring-0 disabled:cursor-not-allowed"
			/>
			{#if !isValueEmpty(value)}
				<Combobox.ClearTrigger
					aria-label="Limpar seleção"
					class="flex !h-6 !w-6 !min-h-0 !min-w-0 shrink-0 items-center justify-center !rounded-full !border-0 !bg-transparent !p-0 !shadow-none text-surface-400 transition-colors hover:!bg-error-500/15 hover:!text-error-600 dark:hover:!text-error-400"
				>
					<X class="h-3.5 w-3.5" aria-hidden="true" />
				</Combobox.ClearTrigger>
			{/if}
			{#if showTrigger}
				<Combobox.Trigger
					class="!static !inset-auto mr-1 flex !h-6 !w-6 !min-h-0 !min-w-0 shrink-0 items-center justify-center !rounded-md !border-0 !bg-transparent !p-0 !shadow-none text-surface-400 transition-colors hover:text-surface-600 dark:hover:text-surface-300 [&_svg]:h-3.5 [&_svg]:w-3.5"
				/>
			{/if}
		</Combobox.Control>
		<Portal>
			<Combobox.Positioner>
				<Combobox.Content
					class="z-50 min-w-[12rem] rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 shadow-lg py-1 max-h-64 overflow-y-auto"
				>
					<!-- O aviso continua visível quando o campo já mostra uma escolha. -->
					<div
						class="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-2xs text-surface-500 dark:text-surface-400 border-b border-surface-100 dark:border-surface-700"
						aria-hidden="true"
					>
						<Search class="h-3 w-3 shrink-0" />
						{AVISO_DE_BUSCA}
					</div>
					{#if busca.buscando}
						<div
							class="px-3 py-2 text-sm text-surface-600 dark:text-surface-400 flex items-center gap-2"
						>
							<Spinner size="sm" class="text-primary-500" />
							Buscando...
						</div>
					{:else if busca.erro}
						<div class="px-3 py-2 text-sm text-error-600">{busca.erro}</div>
					{:else if isAsync && minSearchChars > 0 && !busca.buscou}
						<div class="px-3 py-2 text-sm text-surface-600 dark:text-surface-400">
							Digite ao menos {minSearchChars} caractere{minSearchChars > 1 ? 's' : ''} para buscar
						</div>
					{:else if isAsync && !busca.buscou && items.length === 0}
						<!-- Nada buscado ainda: o aviso acima já diz o que fazer. -->
					{:else if items.length === 0}
						<div class="px-3 py-2 text-sm text-surface-600 dark:text-surface-400">
							Nenhum resultado encontrado
						</div>
					{:else}
						{#each items as item (String(item.value))}
							<Combobox.Item
								{item}
								class="flex items-center justify-between gap-2 px-3 py-2 text-sm text-surface-800 dark:text-surface-100 cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-700 data-[highlighted]:bg-surface-100 dark:data-[highlighted]:bg-surface-700 data-[state=checked]:not-data-[highlighted]:bg-transparent"
							>
								<span class="flex min-w-0 flex-col">
									<Combobox.ItemText
										class={item.value === VALOR_DA_OPCAO_VAZIA
											? 'italic text-surface-600 dark:text-surface-300'
											: ''}>{item.label}</Combobox.ItemText
									>
									{#if item.detalhe}
										<span class="text-xs text-surface-500 dark:text-surface-400"
											>{item.detalhe}</span
										>
									{/if}
								</span>
								<Combobox.ItemIndicator />
							</Combobox.Item>
						{/each}
					{/if}
				</Combobox.Content>
			</Combobox.Positioner>
		</Portal>
	</Combobox>
</div>
