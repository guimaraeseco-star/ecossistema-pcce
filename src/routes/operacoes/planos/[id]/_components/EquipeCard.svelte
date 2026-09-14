<script lang="ts">
	/**
	 * Uma equipe do plano: os dados que vão ao Anexo I, o custo dela e o efetivo.
	 *
	 * Os campos gravam num formulário só ("Salvar equipe") em vez de a cada
	 * tecla: são doze campos e o custo depende de três deles em conjunto (tipo,
	 * horas, diárias). Salvar campo a campo produziria estados intermediários
	 * inválidos no banco — `tipo_custo = 'diaria'` com zero diárias, por exemplo —
	 * que o Anexo II teria de exibir.
	 *
	 * Os membros são a exceção: entram e saem na hora, porque cada um é uma
	 * gravação completa em si e a lista precisa refletir o efetivo real
	 * imediatamente (é ela que alimenta o painel de custo).
	 *
	 * A SUGESTÃO de horas vem pronta do servidor (`sugestaoHoras`), calculada
	 * sobre a mesma cascata de horário que o PDF usa. O botão só copia os números
	 * para os campos — quem decide continua sendo o admin.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { buscarServidores, MIN_BUSCA } from '../../_components/buscas';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { useConfirmationDialog } from '$lib/composables';
	import { loading } from '$lib/loading.svelte';
	import type { PlanoOpcao, PlanoEquipe } from '$lib/server/schema';
	import { escolhasDaEquipe } from '$lib/planos/opcoes';
	import { sugerirCusteio, DURACAO_MINIMA_DIARIA_HORAS } from '$lib/planos/custeio';
	import type { Parecer } from '$lib/diarias/parecer';
	import { distanciaDoTrajeto } from '$lib/planos/distancia';
	import { formatarBRL, resumoHoras, rotuloCustoDaEquipe } from '$lib/planos/rotulos';
	import { formatarDiarias, MIN_MEIAS, MAX_MEIAS } from '$lib/planos/meias-diarias';
	import type { HorasClassificadas } from '$lib/planos/horas-extras';
	import type { MembroDoPlano } from '$lib/db/planos';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Star from '@lucide/svelte/icons/star';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Wand from '@lucide/svelte/icons/wand-sparkles';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	/** SearchableSelect limpa com `null`; o campo vazio herda o padrão do plano. */
	function textoDoSeletor(v: unknown): string {
		return typeof v === 'string' ? v : '';
	}

	function opcoesDoSeletor(valores: string[]): { value: string; label: string }[] {
		return valores.map((valor) => ({ value: valor, label: valor }));
	}

	function opcaoDoSeletor(v: unknown): { value: string; label: string } | null {
		const texto = textoDoSeletor(v);
		return texto ? { value: texto, label: texto } : null;
	}

	/**
	 * A equipe como esta tela a recebe: as COLUNAS da tabela mais o que o `load`
	 * calculou.
	 *
	 * As colunas vêm de `PlanoEquipe` por `Pick`, e não relistadas à mão. Relistar
	 * dava uma segunda declaração das mesmas quinze colunas, que o compilador não
	 * ligava à primeira: acrescentar `distancia_km` ao schema deixava este arquivo
	 * silenciosamente desatualizado, e o campo novo só falhava na hora de ler
	 * `equipe.distancia_km`. `import type` é apagado na compilação, então nada do
	 * servidor entra no bundle.
	 */
	type EquipeNaTela = Pick<
		PlanoEquipe,
		| 'id'
		| 'nome'
		| 'tipo'
		| 'viatura_modelo'
		| 'viatura_placa'
		| 'hora_inicio'
		| 'hora_fim'
		| 'cidade_origem'
		| 'cidade_destino'
		| 'distancia_km'
		| 'local_briefing'
		| 'tipo_custo'
		| 'horas_normais'
		| 'horas_plus'
		| 'diaria_tipo'
		| 'diarias_meias'
	> & {
		membros: MembroDoPlano[];
		/** Janela EFETIVA já resolvida pela cascata equipe → plano (vem do servidor). */
		janela: { horaInicio: string; horaFim?: string | null };
		/** Destino já resolvido pela cascata equipe → plano — o que o Anexo I imprime. */
		destinoEfetivo: string;
		/** O trajeto medido pelo servidor na abertura — `null` quando não dá para medir. */
		distanciaMedida: { km: number; via: 'briefing' | 'direto' } | null;
		sugestaoHoras: HorasClassificadas;
		/** O parecer de diária, calculado no servidor — ver `$lib/diarias/parecer`. */
		parecer: Parecer;
		custo: number;
	};

	const {
		equipe,
		indice,
		enviar,
		pendentes,
		opcoesBriefing,
		opcoesOrigem,
		opcoesDestino,
		matriz,
		medicao,
		limiteKm,
		briefingPadrao,
		origemPadrao,
		destinoPadrao
	}: {
		equipe: EquipeNaTela;
		/** Ordem na lista (1-based) — a marca do quadro, não o id. */
		indice: number;
		/** `use:enhance` comum, vindo da página. */
		enviar: (msg: string, aoConcluir?: () => void) => SubmitFunction;
		/** `policial_id` dos membros que bloqueiam a emissão (classe não resolvida). */
		pendentes: Set<number>;
		/** As listas que o plano declara — ver `EditorOpcoes`. */
		opcoesBriefing: PlanoOpcao[];
		opcoesOrigem: PlanoOpcao[];
		opcoesDestino: PlanoOpcao[];
		/** Pares de distância entre os municípios DESTE plano — ver `matrizDoPlano`. */
		matriz: ReadonlyMap<string, number>;
		/** Quando a matriz foi medida, para a tela dizer a idade do número. */
		medicao: { fonte: string; medido_em: string } | null;
		/**
		 * O limite de km CONGELADO na versão de valores deste plano.
		 *
		 * Vem do servidor, e não da constante do módulo: o Super Admin pode ter
		 * mudado o limite depois, e a tela precisa dizer o número que ESTE plano
		 * aplica — senão ela explica a rubrica com um valor que não é o dela.
		 */
		limiteKm: number;
		/**
		 * O valor da opção PADRÃO de cada tipo — o que a equipe passa a usar se o
		 * campo dela ficar vazio.
		 *
		 * Vem separado de `equipe.destinoEfetivo` de propósito: o efetivo é o
		 * RESULTADO da cascata, e numa equipe que tem valor próprio ele É o valor
		 * próprio. Rotular a opção vazia com o efetivo dizia "padrão: X" exibindo
		 * justamente o que se perderia ao escolhê-la.
		 */
		briefingPadrao: string;
		origemPadrao: string;
		destinoPadrao: string;
	} = $props();

	// As escolhas do seletor saem de `escolhasDaEquipe` — a regra (e o motivo de
	// o valor próprio da equipe entrar na lista) mora em `$lib/planos/opcoes`,
	// com teste.
	const escolhasBriefing = $derived(escolhasDaEquipe(opcoesBriefing, equipe.local_briefing));
	const escolhasOrigem = $derived(escolhasDaEquipe(opcoesOrigem, equipe.cidade_origem));
	const escolhasDestino = $derived(escolhasDaEquipe(opcoesDestino, equipe.cidade_destino));
	const opcoesOrigemSelect = $derived(opcoesDoSeletor(escolhasOrigem));
	const opcoesBriefingSelect = $derived(opcoesDoSeletor(escolhasBriefing));
	const opcoesDestinoSelect = $derived(opcoesDoSeletor(escolhasDestino));

	// Estado local do formulário. Reinicia quando a equipe muda de identidade —
	// a `key` no pai garante isso; aqui a captura inicial é intencional.
	// svelte-ignore state_referenced_locally
	let tipoCusto = $state(equipe.tipo_custo);
	// svelte-ignore state_referenced_locally
	let horasNormais = $state(equipe.horas_normais);
	// svelte-ignore state_referenced_locally
	let horasPlus = $state(equipe.horas_plus);
	// svelte-ignore state_referenced_locally
	let diariaTipo = $state(equipe.diaria_tipo ?? 'estadual');
	// svelte-ignore state_referenced_locally
	let diariasMeias = $state(equipe.diarias_meias || 2);

	let novoPolicial = $state<unknown>(null);
	let aberto = $state(false);

	function abrirEdicao() {
		aberto = true;
	}
	// APARADOS, como as escolhas do seletor: o valor próprio entra na lista via
	// `escolhasDaEquipe`. Sem isso o combobox não oferece o que a equipe já tem,
	// e salvar sem tocar no campo perderia o texto do Anexo I.
	// svelte-ignore state_referenced_locally
	let briefing = $state<unknown>((equipe.local_briefing ?? '').trim() || null);
	// svelte-ignore state_referenced_locally
	let destino = $state<unknown>(equipe.cidade_destino.trim() || null);
	// svelte-ignore state_referenced_locally
	let origem = $state<unknown>(equipe.cidade_origem.trim() || null);
	/**
	 * Vazio é "não informada" — ver `distancia_km` no schema: zero é uma medida.
	 *
	 * `number | undefined`, e não string: `bind:value` num `<input type="number">`
	 * entrega NÚMERO (e `undefined` com o campo vazio). Guardar string aqui fazia
	 * o `.trim()` do derivado estourar no primeiro dígito digitado.
	 */
	// svelte-ignore state_referenced_locally
	let distancia = $state<number | undefined>(equipe.distancia_km ?? undefined);

	/**
	 * O valor gravado é uma CORREÇÃO à mão, e não a medida?
	 *
	 * Deduzido da comparação com o que o servidor mediu — não há coluna para isso,
	 * e não precisa haver: se o número gravado é o medido, ele veio da medição.
	 * A distinção importa porque decide se reabrir o editor pode sobrescrever o
	 * campo. Sem ela, uma correção feita por quem conhece um desvio real seria
	 * apagada na próxima abertura da tela, em silêncio.
	 */
	// svelte-ignore state_referenced_locally
	let manual = $state(
		equipe.distancia_km !== null && equipe.distancia_km !== (equipe.distanciaMedida?.km ?? null)
	);

	const confirmExcluir = useConfirmationDialog<{ nome: string }>();

	/** `id` do formulário dos dados — o rodapé o alcança por `form=`. */
	const idForm = $derived(`equipe-${equipe.id}`);

	/**
	 * A distância como número, ou `null` quando o campo está vazio ou ilegível.
	 *
	 * Lida do ESTADO do campo, e não da coluna: quem acabou de digitar 150 km
	 * espera que "Sugerir custeio" já use 150, sem ter de salvar antes.
	 */
	/**
	 * Código IBGE por valor de opção — o caminho de volta do texto ao município.
	 *
	 * As três listas entram no mesmo mapa: um mesmo nome de cidade pode estar em
	 * origem e destino, e o município dele é o mesmo nos dois.
	 */
	const ibgePorValor = $derived(
		new Map(
			[...opcoesBriefing, ...opcoesOrigem, ...opcoesDestino]
				.filter((o) => o.municipio_ibge)
				.map((o) => [o.valor, o.municipio_ibge as string])
		)
	);

	/**
	 * O trajeto medido para o que está NOS SELETORES agora.
	 *
	 * Recalculado a cada troca, sem ida ao servidor: a matriz do plano já subiu no
	 * `load` (algumas dezenas de pares). É por isso que trocar o briefing muda o
	 * número na hora, antes de salvar.
	 */
	const trajeto = $derived(
		distanciaDoTrajeto(
			{
				origem: ibgePorValor.get(textoDoSeletor(origem) || origemPadrao) ?? null,
				briefing: ibgePorValor.get(textoDoSeletor(briefing) || briefingPadrao) ?? null,
				destino: ibgePorValor.get(textoDoSeletor(destino) || destinoPadrao) ?? null
			},
			matriz
		)
	);

	/**
	 * Enquanto o campo não foi corrigido à mão, ele SEGUE a medida.
	 *
	 * É o que faz o número mudar ao trocar a cidade. Assim que alguém digita,
	 * `manual` trava e o efeito para de escrever — a correção é de quem conhece o
	 * desvio, e a tela não a desfaz.
	 */
	$effect(() => {
		if (!manual && trajeto) distancia = trajeto.km;
	});

	/** "Jucás → Iguatu → Acopiara, 72 km" — o caminho que o número mediu. */
	const rotuloDoTrajeto = $derived.by(() => {
		if (!trajeto) return '';
		const pontas =
			trajeto.via === 'briefing'
				? [
						textoDoSeletor(origem) || origemPadrao,
						textoDoSeletor(briefing) || briefingPadrao,
						textoDoSeletor(destino) || destinoPadrao
					]
				: [textoDoSeletor(origem) || origemPadrao, textoDoSeletor(destino) || destinoPadrao];
		return `${pontas.filter(Boolean).join(' → ')}, ${trajeto.km} km`;
	});

	const distanciaKm = $derived(
		typeof distancia === 'number' && Number.isFinite(distancia) && distancia >= 0 ? distancia : null
	);

	const sugestao = $derived(
		sugerirCusteio({
			distanciaKm,
			horas: equipe.sugestaoHoras,
			limiteKm,
			parecer: equipe.parecer
		})
	);

	const CHIP =
		'inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-2xs font-medium bg-surface-200/80 text-surface-700 dark:bg-surface-800 dark:text-surface-300';
	const CHIP_AVISO =
		'inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-2xs font-medium bg-warning-500/15 text-warning-800 dark:text-warning-300';
	const CHIP_SEINT =
		'inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-2xs font-medium bg-secondary-500/15 text-secondary-700 dark:text-secondary-300';

	const nServidores = $derived(equipe.membros.length);
	const rotuloServidores = $derived(
		`${nServidores} ${nServidores === 1 ? 'servidor' : 'servidores'}`
	);
	const rotuloCusto = $derived(rotuloCustoDaEquipe(equipe.tipo_custo, equipe.diaria_tipo));
	const detalheCusto = $derived(
		equipe.tipo_custo === 'hora_extra'
			? resumoHoras(equipe.horas_normais, equipe.horas_plus)
			: equipe.tipo_custo === 'diaria'
				? formatarDiarias(equipe.diarias_meias)
				: ''
	);
	/** Só faz sentido oferecer o botão quando há algo que decida a rubrica. */
	const temSugestao = $derived(
		distanciaKm !== null ||
			equipe.sugestaoHoras.normais + equipe.sugestaoHoras.plus + equipe.sugestaoHoras.semCusto > 0
	);

	function aplicarSugestao() {
		tipoCusto = sugestao.tipo_custo;
		horasNormais = sugestao.horas.normais;
		horasPlus = sugestao.horas.plus;
		// A quantidade vem do PARECER, com o piso de 1,5 diária que a corporação
		// fixou para o plano operacional (ver `MEIAS_MINIMAS_PLANO`). Continua
		// editável: quem sabe quantas noites a equipe dorme fora é quem monta.
		if (sugestao.tipo_custo === 'diaria') diariasMeias = sugestao.meias;
	}
</script>

<!-- `card-quadro` (o mesmo de Comando e demanda): a ficha ABRE o modal de
     preenchimento ao clique — a borda 1px sumia na folha. O `hover:shadow-md`
     fica porque a sombra reage ao ponteiro. -->
<li
	class="card-quadro min-w-0 h-full rounded-2xl overflow-hidden hover:shadow-md transition-shadow duration-300"
>
	<!-- Cabeçalho: ficha da equipe — marca, fatos em chips, custo, ações.
	     No telefone empilha (título, depois custo + Editar/Excluir na mesma
	     faixa). `shrink-0` + `ml-auto` na faixa de ações era o que furava a
	     ficha em ~360px: custo e os dois botões não cabiam ao lado do nome. -->
	<div class="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
		<button
			type="button"
			class="flex min-w-0 w-full flex-1 items-start gap-3 text-left"
			onclick={abrirEdicao}
			aria-haspopup="dialog"
			aria-expanded={aberto}
		>
			<span
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-heading text-sm font-bold tabular-nums {equipe.tipo ===
				'seint'
					? 'bg-secondary-500/15 text-secondary-700 dark:text-secondary-300'
					: 'bg-primary-500/10 text-primary-800 dark:text-primary-200'}"
			>
				{String(indice).padStart(2, '0')}
			</span>
			<span class="min-w-0 flex-1">
				<span class="flex flex-wrap items-center gap-2">
					<span class="min-w-0 break-words font-semibold text-surface-900 dark:text-white"
						>{equipe.nome}</span
					>
					{#if equipe.tipo === 'seint'}
						<span class={CHIP_SEINT}>SEINT</span>
					{/if}
				</span>
				<span class="mt-1.5 flex flex-wrap gap-1.5">
					<span class={nServidores === 0 ? CHIP_AVISO : CHIP}>{rotuloServidores}</span>
					<!-- O destino EFETIVO, não a coluna: equipe com o campo vazio sai no
					     Anexo I com o padrão do plano, e o resumo tem de dizer o mesmo. -->
					<span class={CHIP}>{equipe.destinoEfetivo || 'sem destino'}</span>
					{#if equipe.viatura_placa}
						<span class={CHIP}>VTR {equipe.viatura_placa}</span>
					{/if}
					<span class={CHIP}
						>{rotuloCusto}{detalheCusto && detalheCusto !== '—' ? ` · ${detalheCusto}` : ''}</span
					>
				</span>
			</span>
		</button>

		<div class="flex min-w-0 w-full items-center gap-2 sm:ml-auto sm:w-auto sm:shrink-0">
			<div class="flex min-w-0 flex-1 flex-col sm:flex-none sm:items-end">
				<span
					class="text-3xs font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400"
					>Custo</span
				>
				<span class="font-heading text-sm font-bold tabular-nums text-surface-900 dark:text-white">
					{formatarBRL(equipe.custo)}
				</span>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				<button
					type="button"
					class="btn btn-sm preset-outlined-surface-500 px-2.5 py-1.5 rounded-xl text-xs"
					onclick={abrirEdicao}
				>
					Editar
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-error-500 px-2.5 py-1.5 rounded-xl text-xs"
					onclick={() => confirmExcluir.openDialog({ nome: equipe.nome })}
				>
					Excluir
				</button>
			</div>
		</div>
	</div>

	<!-- O preenchimento saiu do acordeão e foi para o modal: a lista de fichas
     continua só o resumo, e a grade de campos é a mesma de antes. `5xl`
     existe no ModalShell por causa dessa grade (`lg:` cinco colunas) — em
     `2xl` o desktop cairia no empilhamento do telefone. `portal` porque o
     `li` tem `overflow-hidden` (o raio da ficha) e o overlay não pode ficar
     preso nele. -->
	<ModalShell
		bind:open={aberto}
		title="Editar {equipe.nome}"
		largura="5xl"
		padding="compacto"
		familia="gise"
		portal={true}
		pending={loading.active}
		cancelLabel="Fechar"
	>
		<div class="space-y-6">
			<!-- ---- Dados da equipe ---- -->
			<form
				id={idForm}
				method="POST"
				action="?/salvarEquipe"
				use:enhance={enviar('Alterações salvas', () => (aberto = false))}
				class="space-y-4"
			>
				<input type="hidden" name="equipe_id" value={equipe.id} />
				<input type="hidden" name="tipo" value={equipe.tipo} />

				<!-- No telefone empilha; a partir de `sm` nome|modelo, placa
				     sozinha, início|término; em `lg` os cinco na mesma linha. -->
				<div
					class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_7rem_7rem]"
				>
					<label class="block min-w-0 space-y-1">
						<span class="text-sm font-medium text-surface-700 dark:text-surface-200">Nome</span>
						<input name="nome" value={equipe.nome} maxlength="80" required class="input w-full" />
					</label>
					<label class="block min-w-0 space-y-1">
						<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
							>Modelo da viatura</span
						>
						<input
							name="viatura_modelo"
							value={equipe.viatura_modelo}
							maxlength="60"
							class="input w-full"
						/>
					</label>
					<label class="block min-w-0 space-y-1 sm:col-span-2 lg:col-span-1">
						<span class="text-sm font-medium text-surface-700 dark:text-surface-200">Placa</span>
						<input
							name="viatura_placa"
							value={equipe.viatura_placa}
							maxlength="20"
							class="input w-full"
						/>
					</label>
					<label class="block min-w-0 space-y-1">
						<span class="text-sm font-medium text-surface-700 dark:text-surface-200">Início</span>
						<input
							name="hora_inicio"
							value={equipe.hora_inicio ?? ''}
							placeholder={equipe.janela.horaInicio}
							class="input w-full"
						/>
					</label>
					<label class="block min-w-0 space-y-1">
						<span class="text-sm font-medium text-surface-700 dark:text-surface-200">Término</span>
						<input
							name="hora_fim"
							value={equipe.hora_fim ?? ''}
							placeholder={equipe.janela.horaFim ?? 'sem término'}
							class="input w-full"
						/>
					</label>
				</div>

				<div class="space-y-1.5">
					<!-- Origem → briefing → destino, e o km do trajeto: é essa afirmação
					     que decide entre diária e hora extra. O briefing no meio é a
					     parada que a medida usa (ou ignora, se faltar na lista). -->
					<div
						class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)_8rem]"
					>
						<div class="min-w-0 space-y-1">
							<label
								for="equipe-{equipe.id}-origem"
								class="block text-sm font-medium text-surface-700 dark:text-surface-200"
								>Cidade de origem</label
							>
							<SearchableSelect
								id="equipe-{equipe.id}-origem"
								name="cidade_origem"
								options={opcoesOrigemSelect}
								bind:value={origem}
								selectedOption={opcaoDoSeletor(origem)}
								placeholder={origemPadrao ? `— padrão: ${origemPadrao} —` : '— sem origem —'}
							/>
						</div>
						<div class="min-w-0 space-y-1">
							<label
								for="equipe-{equipe.id}-briefing"
								class="block text-sm font-medium text-surface-700 dark:text-surface-200"
							>
								Local de briefing
							</label>
							<SearchableSelect
								id="equipe-{equipe.id}-briefing"
								name="local_briefing"
								options={opcoesBriefingSelect}
								bind:value={briefing}
								selectedOption={opcaoDoSeletor(briefing)}
								placeholder={briefingPadrao ? `— padrão: ${briefingPadrao} —` : '— sem local —'}
							/>
						</div>
						<div class="min-w-0 space-y-1">
							<label
								for="equipe-{equipe.id}-destino"
								class="block text-sm font-medium text-surface-700 dark:text-surface-200"
								>Cidade destino</label
							>
							<!-- Seletor, e não campo livre: o destino redigitado em oito equipes
						     vira dois destinos no Anexo I à primeira diferença de acento. As
						     opções são as do plano (Parâmetros gerais). -->
							<SearchableSelect
								id="equipe-{equipe.id}-destino"
								name="cidade_destino"
								options={opcoesDestinoSelect}
								bind:value={destino}
								selectedOption={opcaoDoSeletor(destino)}
								placeholder={destinoPadrao ? `— padrão: ${destinoPadrao} —` : '— sem destino —'}
							/>
						</div>
						<label class="block min-w-0 space-y-1">
							<span class="text-sm font-medium text-surface-700 dark:text-surface-200"
								>Distância (km)</span
							>
							<input
								type="number"
								name="distancia_km"
								bind:value={distancia}
								min="0"
								max="9999"
								step="1"
								placeholder="—"
								class="input w-full"
								oninput={() => (manual = true)}
							/>
						</label>
					</div>

					<!-- De ONDE veio o número. Um campo preenchido sozinho sem dizer por quem
				     é pior do que um campo vazio: quem confere não sabe se pode confiar,
				     e quem corrige não sabe o que está sobrescrevendo. -->
					{#if trajeto && !manual}
						<p class="text-xs text-surface-600 dark:text-surface-400">
							Medida automática: <strong>{rotuloDoTrajeto}</strong>.
							{#if trajeto.via === 'direto'}
								<span class="text-warning-700 dark:text-warning-400">
									A parada do briefing não entrou — falta a cidade dela nos Parâmetros gerais.
								</span>
							{/if}
							{#if medicao}
								<span class="text-2xs">Medido em {medicao.medido_em}.</span>
							{/if}
						</p>
					{:else if trajeto && manual}
						<p class="flex flex-wrap items-center gap-2 text-xs">
							<span class="text-surface-600 dark:text-surface-400">
								Informada à mão. A medida do trajeto é <strong>{trajeto.km} km</strong>.
							</span>
							<button
								type="button"
								class="btn btn-sm preset-outlined-surface-500 rounded-lg px-2 py-1 text-2xs"
								onclick={() => {
									manual = false;
									distancia = trajeto?.km;
								}}
							>
								Usar a medida
							</button>
						</p>
					{:else if distanciaKm === null}
						<p class="text-xs text-warning-700 dark:text-warning-400">
							Sem a distância, a rubrica é decidida só pelo horário — e um deslocamento de {limiteKm}
							km ou mais é pago em diária mesmo dentro do expediente. Escolha origem e destino nas listas
							do plano para a medida sair sozinha.
						</p>
					{/if}
				</div>
			</form>

			<!-- ---- Efetivo ---- -->
			<div class="space-y-3">
				<h4
					class="text-sm font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400"
				>
					Efetivo ({equipe.membros.length})
				</h4>

				<!-- A busca fica acima da lista: quem aloca começa pelo campo, e a
				     lista cresce abaixo sem empurrar o input para fora da vista. -->
				<form
					method="POST"
					action="?/adicionarMembro"
					use:enhance={enviar('Servidor alocado', () => (novoPolicial = null))}
					class="flex flex-col gap-2 xs:flex-row xs:flex-wrap xs:items-end"
				>
					<input type="hidden" name="equipe_id" value={equipe.id} />
					<div class="min-w-0 flex-1">
						<SearchableSelect
							name="policial_id"
							bind:value={novoPolicial}
							loadOptions={buscarServidores}
							minSearchChars={MIN_BUSCA}
							placeholder="Buscar por nome ou matrícula"
						/>
					</div>
					<button
						type="submit"
						class="btn preset-outlined-surface-500 py-2 px-3 rounded-xl text-xs shrink-0 w-full xs:w-auto justify-center"
						disabled={!novoPolicial}
					>
						<UserPlus class="w-3.5 h-3.5" />
						Adicionar
					</button>
				</form>

				{#if equipe.membros.length > 0}
					<ul class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
						{#each equipe.membros as m (m.id)}
							{@const pendente = pendentes.has(m.policial_id)}
							<li
								class="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border p-2.5 {pendente
									? 'border-error-500/40 bg-error-500/5'
									: 'border-surface-200/70 dark:border-white/10'}"
							>
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium text-surface-900 dark:text-white truncate">
										{#if m.chefe}
											<Star
												class="inline w-3.5 h-3.5 -mt-0.5 text-warning-600 dark:text-warning-400"
												aria-label="Chefe da equipe"
											/>
										{/if}
										{m.nome}
									</p>
									<!-- Cargo, classe e matrícula saem no Anexo I; aqui só lotação e
									     telefone, para a linha caber em duas colunas. -->
									{#if m.lotacao || m.telefone}
										<p class="text-xs text-surface-600 dark:text-surface-400 truncate">
											{[m.lotacao, m.telefone].filter(Boolean).join(' · ')}
										</p>
									{/if}
									{#if pendente}
										<p class="text-xs text-error-600 dark:text-error-400 mt-0.5">
											<TriangleAlert class="inline w-3 h-3 -mt-0.5" aria-hidden="true" />
											Sem classe resolvida — impede a emissão do PDF.
										</p>
									{/if}
								</div>

								<div class="flex shrink-0 gap-1.5 ml-auto">
									{#if !m.chefe}
										<form
											method="POST"
											action="?/definirChefe"
											use:enhance={enviar('Chefe definido')}
											class="contents"
										>
											<input type="hidden" name="membro_id" value={m.id} />
											<button
												type="submit"
												class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-2xs"
												title="Definir como chefe da equipe"
											>
												<Star class="w-3 h-3" />
												Chefe
											</button>
										</form>
									{/if}
									<form
										method="POST"
										action="?/removerMembro"
										use:enhance={enviar('Servidor removido')}
										class="contents"
									>
										<input type="hidden" name="membro_id" value={m.id} />
										<button
											type="submit"
											class="btn btn-sm preset-outlined-surface-500 px-2 py-1 rounded-lg text-2xs"
											title="Remover do efetivo"
										>
											<Trash2 class="w-3 h-3" />
										</button>
									</form>
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-xs text-surface-600 dark:text-surface-400">
						Nenhum servidor alocado nesta equipe.
					</p>
				{/if}
			</div>

			<!-- ---- Custo ---- -->
			<div
				class="rounded-xl border border-surface-200/70 dark:border-white/10 p-4 sm:p-5 space-y-4"
			>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<span
						class="text-sm font-semibold uppercase tracking-wider text-surface-600 dark:text-surface-400"
						>Custo da equipe</span
					>
					{#if temSugestao}
						<button
							type="button"
							class="btn btn-sm preset-outlined-surface-500 rounded-lg px-3 py-1.5 text-xs"
							onclick={aplicarSugestao}
						>
							<Wand class="h-3.5 w-3.5" />
							Sugerir custeio
						</button>
					{/if}
				</div>

				<!-- O texto diz QUAL regra decidiu, não só os números. São quatro
				     recusas diferentes ("não mediram", "operação curta", "sem janela",
				     "o parecer negou") e todas levam à hora extra: colapsá-las faria a
				     tela afirmar o motivo errado, e a diária não sugerida é a que não é
				     paga. -->
				{#if sugestao.motivo === 'distancia'}
					<p class="text-xs text-surface-600 dark:text-surface-400">
						Deslocamento de <strong>{distanciaKm} km</strong> — a partir de {limiteKm} km, e com operação
						de {DURACAO_MINIMA_DIARIA_HORAS} horas ou mais, o pagamento é em
						<strong>diária</strong>. A quantidade nasce em
						<strong>{formatarDiarias(sugestao.meias)}</strong>, o mínimo da corporação, e continua
						sua para ajustar.
					</p>
				{:else if sugestao.motivo === 'duracao_curta'}
					<p class="text-xs text-surface-600 dark:text-surface-400">
						Deslocamento de <strong>{distanciaKm} km</strong>, mas a operação tem menos de
						{DURACAO_MINIMA_DIARIA_HORAS} horas — o percurso não alcança a jornada de 8 horas que a diária
						exige. Vale o horário.
					</p>
				{:else if sugestao.motivo === 'sem_janela'}
					<p class="text-xs text-warning-700 dark:text-warning-400">
						Deslocamento de <strong>{distanciaKm} km</strong>, mas esta equipe não tem hora de
						término — sem a janela fechada não há como aferir as 4 horas que a diária exige.
						Preencha o término para a sugestão sair.
					</p>
				{:else if sugestao.motivo === 'parecer'}
					<p class="text-xs text-warning-700 dark:text-warning-400">
						Distância e duração bastariam, mas a diária não é devida:
						<strong>{equipe.parecer.fundamentos[0]?.texto}</strong>
						({equipe.parecer.fundamentos[0]?.dispositivo}). Vale o horário.
					</p>
				{:else if temSugestao}
					<p class="text-xs text-surface-600 dark:text-surface-400">
						{#if distanciaKm !== null}
							Deslocamento de <strong>{distanciaKm} km</strong>, abaixo do limite de {limiteKm} km — vale
							o horário:
						{:else}
							Pelo horário desta equipe:
						{/if}
						<strong
							>{equipe.sugestaoHoras.normais}h normais · {equipe.sugestaoHoras.plus}h plus · {equipe
								.sugestaoHoras.semCusto}h sem custo</strong
						>. A quantidade gravada é a que estiver nos campos.
					</p>
				{:else}
					<p class="text-xs text-surface-600 dark:text-surface-400">
						Sem distância informada e sem previsão de término no plano, não há o que sugerir —
						informe a rubrica à mão.
					</p>
				{/if}

				<!-- Os alertas do decreto NÃO impedem a concessão: eles pedem
				     conferência. Ver `alertasDaViagem` — a vedação de região
				     metropolitana tem três condições, e a terceira é de relógio. -->
				{#each equipe.parecer.alertas as alerta (alerta)}
					{@const f = equipe.parecer.fundamentos.find((x) =>
						alerta === 'teto_mensal'
							? x.dispositivo === 'art. 13'
							: alerta === 'mesma_regiao_metropolitana'
								? x.dispositivo === 'art. 4º, §1º, II'
								: x.texto.startsWith('Origem e destino')
					)}
					{#if f}
						<p class="flex items-start gap-1.5 text-xs text-warning-700 dark:text-warning-400">
							<TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
							<span>{f.texto} <em class="not-italic opacity-70">({f.dispositivo})</em></span>
						</p>
					{/if}
				{/each}

				<!-- Rubrica e quantidade na MESMA linha: os três botões escolhem
				     COMO paga; os campos ao lado dizem QUANTO. Separar em duas
				     faixas fazia a quantidade parecer outro assunto. -->
				<div class="flex flex-wrap items-end gap-x-3 gap-y-3">
					<div class="flex flex-wrap gap-2">
						{#each [['sem_custo', 'Sem custo'], ['hora_extra', 'Hora extra'], ['diaria', 'Diária']] as [valor, rotulo] (valor)}
							<label
								class="cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition-colors {tipoCusto ===
								valor
									? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
									: 'border-surface-200 dark:border-white/10 text-surface-700 dark:text-surface-300'}"
							>
								<input
									type="radio"
									name="tipo_custo"
									value={valor}
									bind:group={tipoCusto}
									form={idForm}
									class="sr-only"
								/>
								{rotulo}
							</label>
						{/each}
					</div>

					{#if tipoCusto === 'hora_extra'}
						<label class="block min-w-0 w-full space-y-1 xs:w-auto xs:max-w-full">
							<span class="block text-xs font-medium text-surface-700 dark:text-surface-200"
								>Horas normais</span
							>
							<input
								type="number"
								name="horas_normais"
								bind:value={horasNormais}
								min="0"
								max="744"
								form={idForm}
								class="input w-full xs:w-28"
							/>
						</label>
						<label class="block min-w-0 w-full space-y-1 xs:w-auto xs:max-w-full">
							<span class="block text-xs font-medium text-surface-700 dark:text-surface-200">
								Horas plus <span class="text-surface-600 dark:text-surface-400">(+30%)</span>
							</span>
							<input
								type="number"
								name="horas_plus"
								bind:value={horasPlus}
								min="0"
								max="744"
								form={idForm}
								class="input w-full xs:w-28"
							/>
						</label>
					{:else if tipoCusto === 'diaria'}
						<label class="block min-w-0 w-full space-y-1 xs:w-40">
							<span class="text-xs font-medium text-surface-700 dark:text-surface-200"
								>Tipo de diária</span
							>
							<select
								name="diaria_tipo"
								bind:value={diariaTipo}
								form={idForm}
								class="select w-full"
							>
								<option value="estadual">Estadual</option>
								<option value="interestadual">Interestadual</option>
							</select>
						</label>
						<label class="block min-w-[8rem] flex-1 space-y-1">
							<span class="text-xs font-medium text-surface-700 dark:text-surface-200">
								Quantidade <span class="text-surface-600 dark:text-surface-400"
									>({formatarDiarias(diariasMeias)})</span
								>
							</span>
							<!-- Em MEIAS diárias: o passo é meio, e o inteiro evita float no
								     caminho do dinheiro. O rótulo acima mostra o valor em diárias. -->
							<input
								type="range"
								name="diarias_meias"
								bind:value={diariasMeias}
								min={MIN_MEIAS}
								max={MAX_MEIAS}
								step="1"
								form={idForm}
								class="w-full"
							/>
						</label>
					{/if}
				</div>
			</div>

			<!-- O "Salvar" vive FORA do formulário dos dados e o alcança por
			     `form={idForm}` — é o atributo que o HTML tem para isso, e evita
			     duplicar o form ou mover o efetivo para dentro dele. Excluir
			     fica na ficha, ao lado de Editar: um clique errado no vermelho
			     ao lado de Salvar custaria remontar a equipe. -->
		</div>

		{#snippet footer()}
			<button
				type="submit"
				form={idForm}
				class="btn preset-filled-primary-500 py-2.5 px-4 rounded-xl text-sm w-full sm:w-auto justify-center"
				disabled={loading.active}
			>
				Salvar Alterações
			</button>
		{/snippet}
	</ModalShell>

	<!-- Confirmação da exclusão, no padrão do projeto (`ModalShell` +
     `useConfirmationDialog`, como em `/operacoes/planos`). A equipe leva o efetivo
     alocado junto, e o botão vermelho no cabeçalho (ao lado de Editar, não de
     Salvar) ainda pede esta confirmação antes de apagar. -->
	<ModalShell
		bind:open={confirmExcluir.isOpen}
		title="Excluir equipe?"
		largura="sm"
		portal={true}
		pending={loading.active}
		cancelLabel="Cancelar"
	>
		{#snippet description()}
			A equipe <strong>{confirmExcluir.currentItem?.nome}</strong> e os
			{equipe.membros.length}
			{equipe.membros.length === 1 ? 'servidor alocado' : 'servidores alocados'} nela serão apagados.
			As demais equipes são renumeradas.
		{/snippet}

		{#snippet footer()}
			<form
				method="POST"
				action="?/excluirEquipe"
				use:enhance={enviar('Equipe excluída', () => confirmExcluir.closeDialog())}
				class="contents"
			>
				<input type="hidden" name="equipe_id" value={equipe.id} />
				<button
					type="submit"
					class="btn btn-sm preset-filled-error-500 flex items-center gap-2"
					disabled={loading.active}
				>
					<Trash2 class="w-4 h-4" />
					Excluir equipe
				</button>
			</form>
		{/snippet}
	</ModalShell>
</li>
