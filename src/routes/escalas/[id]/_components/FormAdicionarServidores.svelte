<script lang="ts">
	/**
	 * Formulário de ADIÇÃO de servidores à escala mensal — o inverso das tabelas
	 * (`TabelaPlantao`, `TabelaServidores`), que editam quem já está.
	 *
	 * A diferença entre os dois tipos está aqui:
	 * - EXPEDIENTE: o policial é adicionado uma vez, sem dias;
	 * - PLANTÃO: escolhe-se o primeiro plantão e o regime — `1x3` (de 4 em 4
	 *   dias) ou `2x6` (dois dias seguidos a cada 8) — e `calcularDatasPlantao`
	 *   projeta as demais datas até o fim da escala. É o ciclo da corporação, não
	 *   uma data por vez: escalar um plantonista dia a dia seriam oito submits.
	 *
	 * As datas projetadas vão num campo hidden como JSON
	 * (`datasPlantaoParaJson`): o servidor insere uma linha por dia, e é ele quem
	 * decide o que já existe. A tela não tenta adivinhar duplicata.
	 *
	 * `podeEditarEscala`, `documentoAssinadoExiste` e `finalizadaEm` bloqueiam o
	 * formulário pelo mesmo motivo da tabela: acrescentar alguém depois da
	 * assinatura mudaria um documento já assinado.
	 */
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { mostrarErroDeResultado } from '$lib/enhance-handler';
	import { formatarData } from '$lib/utils/datas';
	import { buscarPoliciaisOptions } from '$lib/busca-policiais';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import SeletorHoraMinuto from '$lib/components/SeletorHoraMinuto.svelte';
	import {
		ultimoDiaMes,
		mesAnoFormatado,
		primeiroPlantaoDoDia,
		calcularDatasPlantao,
		datasPlantaoParaJson,
		tratarResultadoAdicionarPlantao
	} from './plantao-datas';
	import type { ActionResult } from '@sveltejs/kit';
	import type { Escala } from '$lib/server/schema';
	import type { EscalaPolicialComDados } from '$lib/types';

	const {
		escala,
		isExpediente,
		diasEscalaLocal,
		modoEdicao,
		podeEditarEscala,
		documentoAssinadoExiste,
		finalizadaEm,
		solicitacaoAtual,
		policiaisEscalaLocal,
		onPoliciaisAtualizados
	}: {
		escala: Escala;
		isExpediente: boolean;
		diasEscalaLocal: string[];
		modoEdicao: boolean;
		podeEditarEscala: boolean;
		documentoAssinadoExiste: boolean;
		finalizadaEm: string | null;
		solicitacaoAtual: { tipo: string } | null;
		policiaisEscalaLocal: EscalaPolicialComDados[];
		onPoliciaisAtualizados: (policiais: EscalaPolicialComDados[]) => void;
	} = $props();

	let cargoBusca = $state<'DPC' | 'OIP' | ''>('');
	let policialId = $state('');
	// Derivado gravável: acompanha a escala, mas admite edição manual no form.
	let dataPlantao = $derived(escala.data_inicio ?? '');
	let addHoraEntrada = $state('08');
	let addMinutoEntrada = $state('00');
	let addHoraSaida = $state('08');
	let addMinutoSaida = $state('00');
	let addEquipe = $state('1');
	let addTipoEscala = $state<'1x3' | '2x6'>('1x3');
	let addPrimeiroDia = $state('');
	// Derivado gravável: recalcula do "1º dia" digitado, mas admite os resets
	// manuais do fluxo (criar equipe / pós-submit).
	let addPrimeiroPlantao = $derived(primeiroPlantaoDoDia(escala.data_inicio ?? '', addPrimeiroDia));

	let addObservacoes = $state('');

	let activeEquipeForm = $state<string | null>(null);

	const equipesAtuais = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const eq = new Set<string>();
		for (const p of policiaisEscalaLocal || []) {
			if (p.equipe) eq.add(p.equipe);
		}
		return Array.from(eq).sort();
	});

	const equipesDisponiveis = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const eq = new Set<string>();
		for (let i = 1; i <= 5; i++) eq.add(String(i));
		for (const e of equipesAtuais) eq.delete(e);
		return Array.from(eq).sort();
	});

	let pendingAdd = $state(false);
	let pendingPlantao = $state(false);
	let pendingAdicionarTodos = $state(false);

	const buscarPoliciaisAsync = buscarPoliciaisOptions({ cargo: () => cargoBusca });

	// Derivado gravável: recalcula do 1º plantão/tipo, mas admite a seleção
	// manual de datas e o reset pós-submit.
	let addDatasSelecionadas = $derived(
		calcularDatasPlantao(escala, addPrimeiroPlantao, addTipoEscala)
	);

	const datasPlantaoJson = $derived(
		datasPlantaoParaJson(
			addDatasSelecionadas,
			`${addHoraEntrada}:${addMinutoEntrada}`,
			`${addHoraSaida}:${addMinutoSaida}`
		)
	);

	function handleAdd({ cancel }: { cancel: () => void }) {
		if (!policialId) {
			cancel();
			return;
		}
		pendingAdd = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingAdd = false;
			if (result.type === 'success') {
				onPoliciaisAtualizados(result.data?.policiais);
				toaster.create({ title: 'Policial adicionado à escala', type: 'success' });
				cargoBusca = '';
				policialId = '';
				addObservacoes = '';
			} else {
				mostrarErroDeResultado(result, 'Erro ao adicionar');
			}
		};
	}

	function handlePlantao({ cancel }: { cancel: () => void }) {
		if (!policialId || addDatasSelecionadas.length === 0) {
			cancel();
			return;
		}
		pendingPlantao = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingPlantao = false;
			tratarResultadoAdicionarPlantao(result, onPoliciaisAtualizados, () => {
				cargoBusca = '';
				policialId = '';
				addPrimeiroPlantao = '';
				addEquipe = '1';
				addDatasSelecionadas = [];
			});
		};
	}

	function handleAdicionarTodos() {
		pendingAdicionarTodos = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingAdicionarTodos = false;
			if (result.type === 'success') {
				const d = result.data as Record<string, unknown> | undefined;
				onPoliciaisAtualizados(result.data?.policiais);
				// Quem ficou de fora por afastamento (E60) é dito pelo nome.
				const fora = (d?.foraPorAfastamento as string[] | undefined) ?? [];
				const descricao = fora.length
					? `Não escalado(s) por afastamento: ${fora.join('; ')}.`
					: undefined;
				if (Number(d?.quantidade) === 0)
					toaster.create({
						title: fora.length
							? 'Nenhum servidor adicionado'
							: 'Todos os servidores já estão na escala',
						description: descricao,
						type: 'warning'
					});
				else
					toaster.create({
						title: `${d?.quantidade} servidor(es) adicionado(s)`,
						description: descricao,
						type: fora.length ? 'warning' : 'success'
					});
			} else {
				mostrarErroDeResultado(result, 'Erro');
			}
		};
	}

	const visivel = $derived(
		podeEditarEscala && modoEdicao && !documentoAssinadoExiste && !finalizadaEm && !solicitacaoAtual
	);
</script>

<!-- Par Cargo/Servidor — mesma marcação nos dois formulários (FDS rápido e
     normal), só a largura da coluna de Servidor muda. -->
{#snippet camposCargoServidor(colSpanServidor: string)}
	<label class="label sm:col-span-1">
		<span class="label-text">Cargo</span>
		<select
			class="select h-9 py-0 px-2"
			bind:value={cargoBusca}
			onchange={() => {
				policialId = '';
			}}
		>
			<option value="">...</option>
			<option value="DPC">DPC</option>
			<option value="OIP">OIP</option>
		</select>
	</label>
	<label class="label {colSpanServidor} self-center">
		<span class="label-text">Servidor</span>
		{#key cargoBusca}
			<SearchableSelect
				name="policial_id"
				bind:value={policialId}
				disabled={!cargoBusca}
				loadOptions={buscarPoliciaisAsync}
				placeholder={cargoBusca ? 'Digite para buscar servidor...' : 'Selecione o cargo primeiro'}
				class="w-full h-9"
			/>
		{/key}
	</label>
{/snippet}

{#if visivel && isExpediente}
	<div
		class="p-4 sm:p-5 mb-4 rounded-3xl bg-primary-500/8 border border-primary-500/25 backdrop-blur-md"
	>
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
			<div>
				<h3 class="font-semibold text-sm text-primary-700 dark:text-primary-400">
					Adicionar Todos os Servidores do Expediente
				</h3>
				<p class="text-xs text-surface-600 dark:text-surface-400 mt-1">
					Adiciona automaticamente todos os servidores cadastrados com regime de expediente da {escala.lotacao}
					que ainda não estão na escala.
				</p>
			</div>
			<form
				method="POST"
				action="?/adicionarTodos"
				use:enhance={handleAdicionarTodos}
				class="contents"
			>
				<button
					type="submit"
					class="btn preset-filled-primary-500 w-full sm:w-auto shrink-0 font-semibold flex items-center justify-center gap-2 transition-all"
					disabled={pendingAdicionarTodos}
				>
					{pendingAdicionarTodos ? 'Adicionando...' : '+ Adicionar Todos'}
				</button>
			</form>
		</div>
	</div>
{/if}

{#if visivel && (escala.tipo === 'expediente' || (escala.tipo === 'plantao' && equipesDisponiveis.length > 0))}
	<div class="card-glass p-4 sm:p-6 mb-4 rounded-3xl">
		<h3 class="font-semibold text-sm mb-3">
			{escala.tipo === 'plantao' ? 'Criar Nova Equipe na Escala' : 'Adicionar DPC/OIP à Escala'}
		</h3>
		{#if escala.tipo === 'plantao'}
			{#if equipesDisponiveis.length > 0}
				<div
					class="p-4 border border-surface-200 dark:border-white/10 rounded-xl bg-surface-50/50 dark:bg-surface-800/30"
				>
					{#if activeEquipeForm !== 'nova'}
						<button
							type="button"
							class="btn preset-filled-primary-500 w-full sm:w-auto"
							onclick={() => {
								activeEquipeForm = 'nova';
								cargoBusca = 'DPC';
								policialId = '';
								addPrimeiroDia = '';
								addPrimeiroPlantao = '';
								addEquipe = equipesDisponiveis[0];
							}}
						>
							+ Criar Nova Equipe
						</button>
					{:else}
						<h4 class="font-bold text-sm text-primary-700 dark:text-primary-400 mb-3">
							Criar Nova Equipe
						</h4>
						<form method="POST" action="?/adicionarPlantao" use:enhance={handlePlantao}>
							<input type="hidden" name="datas" value={datasPlantaoJson} />

							<div class="grid grid-cols-1 sm:grid-cols-12 gap-4 mb-4 items-end">
								<label class="label sm:col-span-2">
									<span class="label-text">Equipe</span>
									<select class="select h-9 py-0 px-2" name="equipe" bind:value={addEquipe}>
										{#each equipesDisponiveis as n (n)}<option value={n}>Equipe {n}</option>{/each}
									</select>
								</label>
								<label class="label sm:col-span-4">
									<span class="label-text">DPC Chefe</span>
									{#key cargoBusca}
										<SearchableSelect
											name="policial_id"
											bind:value={policialId}
											loadOptions={buscarPoliciaisAsync}
											placeholder="Buscar DPC..."
											class="w-full h-9"
										/>
									{/key}
								</label>
								<label class="label sm:col-span-2">
									<span class="label-text">Tipo de Escala</span>
									<select class="select h-9 py-0 px-2" bind:value={addTipoEscala}>
										<option value="1x3">1×3</option>
										<option value="2x6">2×6</option>
									</select>
								</label>
								<div class="sm:col-span-2">
									<span class="label-text block text-sm mb-1">1º dia (DPC)</span>
									<div class="flex items-center gap-1 h-9">
										<input
											type="number"
											class="input h-9 w-12 text-center p-1"
											bind:value={addPrimeiroDia}
											min="1"
											max={ultimoDiaMes(escala.data_inicio)}
											required
										/>
										<span class="text-sm font-medium opacity-70"
											>/ {mesAnoFormatado(escala.data_inicio)}</span
										>
									</div>
								</div>
								<div class="sm:col-span-2 flex gap-2 h-9 items-center">
									<button
										type="submit"
										class="btn btn-sm preset-filled-primary-500 transition-all flex-1"
										disabled={pendingPlantao || !policialId || !addPrimeiroPlantao}
									>
										{pendingPlantao ? 'Criando...' : 'Criar'}
									</button>
									<button
										type="button"
										class="btn btn-sm preset-outlined-surface-500"
										onclick={() => (activeEquipeForm = null)}
									>
										Cancelar
									</button>
								</div>
							</div>
						</form>
					{/if}
				</div>
			{/if}
		{:else if isExpediente}
			<form method="POST" action="?/adicionar" use:enhance={handleAdd}>
				<input type="hidden" name="data_plantao" value={escala.data_inicio} />
				<input type="hidden" name="data_saida_override" value={escala.data_fim} />
				<input type="hidden" name="hora_entrada" value="00" />
				<input type="hidden" name="minuto_entrada" value="00" />
				<input type="hidden" name="hora_saida" value="23" />
				<input type="hidden" name="minuto_saida" value="59" />
				<input type="hidden" name="equipe" value="1" />
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
					{@render camposCargoServidor('sm:col-span-4')}
					<label class="label sm:col-span-5">
						<span class="label-text">Observações</span>
						<input
							type="text"
							name="observacoes"
							class="input h-9"
							bind:value={addObservacoes}
							maxlength="500"
							placeholder="Informações complementares (opcional)"
						/>
					</label>
					<div class="sm:col-span-2">
						<button
							type="submit"
							class="btn preset-filled-primary-500 w-full transition-all"
							disabled={pendingAdd || !policialId}
						>
							{pendingAdd ? 'Adicionando...' : '+ Adicionar'}
						</button>
					</div>
				</div>
			</form>
		{:else}
			<form method="POST" action="?/adicionar" use:enhance={handleAdd}>
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end mb-4">
					{@render camposCargoServidor('sm:col-span-3')}
					<label class="label sm:col-span-2">
						<span class="label-text">Data</span>
						<select
							name="data_plantao"
							class="select h-9 py-0 px-2"
							bind:value={dataPlantao}
							required
						>
							{#each diasEscalaLocal as d (d)}
								<option value={d}>{formatarData(d)}</option>
							{/each}
						</select>
					</label>
					<div class="sm:col-span-2">
						<span class="label-text text-xs">Entrada</span>
						<SeletorHoraMinuto
							bind:hora={addHoraEntrada}
							bind:minuto={addMinutoEntrada}
							nameHora="hora_entrada"
							nameMinuto="minuto_entrada"
							selectClass="select flex-1 h-9 py-0 px-1"
						/>
					</div>
					<div class="sm:col-span-2">
						<span class="label-text text-xs">Saída</span>
						<SeletorHoraMinuto
							bind:hora={addHoraSaida}
							bind:minuto={addMinutoSaida}
							nameHora="hora_saida"
							nameMinuto="minuto_saida"
							selectClass="select flex-1 h-9 py-0 px-1"
						/>
					</div>
					<input type="hidden" name="equipe" value="1" />
					<div class="sm:col-span-2">
						<button
							type="submit"
							class="btn preset-filled-primary-500 w-full transition-all"
							disabled={pendingAdd || !policialId || !dataPlantao}
						>
							{pendingAdd ? 'Adicionando...' : '+ Adicionar'}
						</button>
					</div>
				</div>
			</form>
		{/if}
	</div>
{/if}
