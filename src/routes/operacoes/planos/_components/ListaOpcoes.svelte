<script lang="ts">
	/**
	 * A LISTA de opções de um tipo, com a padrão marcada por estrela.
	 *
	 * Só a apresentação. Quem grava é quem usa, e as duas telas gravam de formas
	 * incompatíveis:
	 *
	 * - no EDITOR (`[id]/_components/EditorOpcoes.svelte`) cada mexida é uma form
	 *   action, porque o plano existe e a opção tem `id` no banco;
	 * - na CRIAÇÃO (`novo/+page.svelte`) o plano ainda não existe, então a lista
	 *   é estado local e viaja como array no `FormData` do "Criar plano".
	 *
	 * Extrair só o desenho é o meio-termo que o `CLAUDE.md` pede: o visual não
	 * pode divergir entre as duas telas (é a mesma lista, com a mesma estrela e o
	 * mesmo aviso), e forçar um mecanismo único de gravação exigiria ou criar o
	 * plano antes da hora, ou fazer a opção do editor esperar por um "salvar"
	 * que ela não tem hoje.
	 *
	 * As AÇÕES de cada linha vêm por snippet justamente por isso: o editor passa
	 * dois `<form>`, a criação passa dois `<button>`.
	 *
	 * Sem quadro próprio: o contorno é o da seção (o mesmo de Comando e demanda).
	 *
	 * ## Dois modos, porque origem/destino e briefing são coisas diferentes
	 *
	 * `modo="cidade"` (origem e destino): a opção **é** um município. Só o seletor
	 * — o rótulo é o nome oficial da cidade, e digitá-lo à mão é o que trazia
	 * "Juazeiro" e "JUAZEIRO DO N." para a mesma lista.
	 *
	 * `modo="local"` (briefing): a opção é um PRÉDIO ("Sede da 4ª Seccional do
	 * Interior Sul"), então o texto continua livre — mas ganha ao lado a cidade
	 * ONDE ELE FICA, porque o trajeto da equipe passa por ela e é isso que mede a
	 * distância (ver `$lib/planos/distancia`).
	 *
	 * O seletor oferece os 184 municípios do Ceará. Local fora do estado não entra
	 * pela lista: a matriz cobre o Ceará, e sem município a distância volta a ser
	 * digitada — que é como era antes dela existir.
	 */
	import type { Snippet } from 'svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import Star from '@lucide/svelte/icons/star';
	import MapPin from '@lucide/svelte/icons/map-pin';

	/** O mínimo que a lista precisa de cada opção para desenhá-la. */
	export type OpcaoNaLista = {
		/** Identificador estável para a `{#each}` — o `id` do banco ou o próprio valor. */
		chave: string | number;
		valor: string;
		padrao: boolean;
		/** Município da opção; `null` quando ninguém o informou ainda. */
		municipio?: string | null;
	};

	/** Um município no seletor. */
	export type MunicipioOpcao = { ibge: string; nome: string };

	const {
		rotulo,
		descricao,
		exemplo,
		modo = 'local',
		opcoes,
		municipios = [],
		acoes,
		aoAcrescentar,
		ocupado = false
	}: {
		rotulo: string;
		descricao: string;
		/** Placeholder do campo — um exemplo real, não "digite aqui". */
		exemplo: string;
		modo?: 'cidade' | 'local';
		opcoes: OpcaoNaLista[];
		municipios?: MunicipioOpcao[];
		/** Os botões de cada linha: `<form>` no editor, `<button>` na criação. */
		acoes: Snippet<[OpcaoNaLista]>;
		/** O `municipioIbge` é `null` quando a opção não resolve um município. */
		aoAcrescentar: (valor: string, municipioIbge: string | null) => void;
		ocupado?: boolean;
	} = $props();

	let novo = $state('');
	let municipioEscolhido = $state<unknown>(null);

	const opcoesMunicipio = $derived(municipios.map((m) => ({ value: m.ibge, label: m.nome })));
	/** O nome do município escolhido — no modo cidade, ele É o rótulo da opção. */
	const nomeEscolhido = $derived(municipios.find((m) => m.ibge === municipioEscolhido)?.nome ?? '');
	const podeAcrescentar = $derived(modo === 'cidade' ? nomeEscolhido !== '' : novo.trim() !== '');

	/**
	 * Lista COM opções e SEM nenhuma padrão.
	 *
	 * Precisa estar escrito: sem estrela nenhuma a equipe nova nasce com o campo
	 * em branco, e a lista cheia logo acima sugere exatamente o contrário.
	 */
	const semPadrao = $derived(opcoes.length > 0 && !opcoes.some((o) => o.padrao));

	/** Opções sem município: a distância delas não pode ser medida. */
	const semMunicipio = $derived(opcoes.filter((o) => !o.municipio).length);

	function acrescentar() {
		const ibge = typeof municipioEscolhido === 'string' ? municipioEscolhido : null;
		const texto = modo === 'cidade' ? nomeEscolhido : novo.trim();
		if (!texto) return;
		aoAcrescentar(texto, ibge);
		novo = '';
		municipioEscolhido = null;
	}
</script>

<div class="space-y-2">
	<div>
		<span class="block text-sm font-medium text-surface-700 dark:text-surface-200">{rotulo}</span>
		<span class="block text-xs text-surface-600 dark:text-surface-400">{descricao}</span>
	</div>

	{#if opcoes.length > 0}
		<ul class="space-y-1.5">
			{#each opcoes as o (o.chave)}
				<li
					class="flex flex-wrap items-center gap-2 rounded-lg border p-2 {o.padrao
						? 'border-primary-500/40 bg-primary-500/5'
						: 'border-surface-200/70 dark:border-white/10'}"
				>
					{#if o.padrao}
						<Star
							class="w-3.5 h-3.5 shrink-0 text-warning-600 dark:text-warning-400"
							aria-label="Opção padrão"
						/>
					{/if}
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm text-surface-900 dark:text-white">{o.valor}</span>
						<!-- No modo cidade o rótulo JÁ é o município: repeti-lo abaixo seria
						     ruído. No modo local ele é a informação nova — e a ausência dele
						     é o que impede medir o trajeto, então precisa aparecer. -->
						{#if modo === 'local'}
							<span
								class="flex items-center gap-1 text-2xs {o.municipio
									? 'text-surface-600 dark:text-surface-400'
									: 'text-warning-700 dark:text-warning-400'}"
							>
								<MapPin class="w-3 h-3 shrink-0" aria-hidden="true" />
								{o.municipio ?? 'sem cidade — a distância não passa por aqui'}
							</span>
						{/if}
					</span>

					<div class="flex w-full justify-end gap-1.5 sm:w-auto sm:shrink-0">
						{@render acoes(o)}
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-xs text-surface-600 dark:text-surface-400">
			Nenhuma opção cadastrada — as equipes nascem com este campo em branco.
		</p>
	{/if}

	{#if semPadrao}
		<p class="text-xs text-warning-700 dark:text-warning-400">
			Nenhuma marcada como padrão — as equipes novas continuam nascendo com este campo em branco.
			Use o botão <strong>Padrão</strong> em uma delas.
		</p>
	{/if}

	{#if modo === 'local' && semMunicipio > 0}
		<p class="text-xs text-warning-700 dark:text-warning-400">
			{semMunicipio}
			{semMunicipio === 1 ? 'opção sem cidade' : 'opções sem cidade'}: a distância da equipe é
			medida de ponta a ponta, sem a parada do briefing.
		</p>
	{/if}

	<!-- `type="button"`: na criação este bloco vive DENTRO do formulário que cria
	     o plano, e um submit aqui enviaria o plano pela metade ao acrescentar uma
	     cidade. O Enter no campo é interceptado pelo mesmo motivo. -->
	<!-- No modo LOCAL são dois campos (o nome do prédio e a cidade dele) e eles
	     empilham: lado a lado numa coluna de um terço, cada um ficaria com ~90px e
	     nenhum dos dois legível. -->
	<div class="space-y-1.5">
		{#if modo === 'local'}
			<input
				bind:value={novo}
				maxlength="200"
				placeholder={exemplo}
				class="input w-full"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						acrescentar();
					}
				}}
			/>
		{/if}
		<div class="flex min-w-0 flex-col gap-2 xs:flex-row">
			<div class="min-w-0 flex-1">
				<SearchableSelect
					options={opcoesMunicipio}
					bind:value={municipioEscolhido}
					placeholder={modo === 'cidade' ? exemplo : 'Cidade onde fica'}
				/>
			</div>
			<button
				type="button"
				class="btn preset-outlined-surface-500 py-2 px-3 rounded-xl text-sm w-full xs:w-auto justify-center shrink-0"
				disabled={ocupado || !podeAcrescentar}
				onclick={acrescentar}
				aria-label="Acrescentar"
				title="Acrescentar"
			>
				+
			</button>
		</div>
	</div>
</div>
