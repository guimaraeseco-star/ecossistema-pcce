<script lang="ts">
	/**
	 * Timeline do histórico funcional do servidor — a leitura do que
	 * `PainelAcoesServidor` grava.
	 *
	 * A tabela é APPEND-ONLY e esta tela é só leitura: não há caminho de UI que
	 * edite ou apague um evento. É a visão de RH, e complementa (não substitui)
	 * a trilha forense do Super Admin em `/auditoria`.
	 *
	 * `afastamentoVigenteId` marca o afastamento em curso HOJE, calculado no
	 * servidor: comparar datas aqui reintroduziria o problema de fuso que a
	 * timeline não tem como resolver sozinha.
	 *
	 * Paginação é client-side porque o histórico completo já vem no `load` — o
	 * `$effect` que corrige `paginaAtual` existe para o caso de a lista encolher
	 * ou crescer num `invalidateAll()` depois de registrar um evento, que
	 * deixaria o usuário numa página vazia.
	 */
	import type { PolicialHistorico } from '$lib/types';
	import { formatarData } from '$lib/utils/datas';
	import { LABEL_SUBTIPO_AFASTAMENTO } from '$lib/schemas/policial-historico';
	import Paginador from '$lib/components/Paginador.svelte';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import CalendarOff from '@lucide/svelte/icons/calendar-off';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import FileText from '@lucide/svelte/icons/file-text';
	import History from '@lucide/svelte/icons/history';
	import CircleDot from '@lucide/svelte/icons/circle-dot';

	interface Props {
		historico: PolicialHistorico[];
		afastamentoVigenteId: number | null;
		/** Unidades para resolver ids (ex.: papel_unidade_id) para nome legível. */
		unidades?: { id: number; nome: string }[];
	}

	const { historico, afastamentoVigenteId, unidades = [] }: Props = $props();

	const nomePorUnidadeId = $derived(new Map(unidades.map((u) => [u.id, u.nome])));

	// Paginação client-side (o histórico completo já vem no load).
	const ITENS_POR_PAGINA = 5;
	let paginaAtual = $state(1);
	const totalPaginas = $derived(Math.max(1, Math.ceil(historico.length / ITENS_POR_PAGINA)));
	// Se o histórico encolher (ou crescer após invalidateAll), mantém a página válida.
	$effect(() => {
		if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
	});
	const historicoPagina = $derived(
		historico.slice((paginaAtual - 1) * ITENS_POR_PAGINA, paginaAtual * ITENS_POR_PAGINA)
	);

	const META: Record<
		string,
		{ label: string; icon: typeof CircleDot; cor: string; ponto: string }
	> = {
		movimentacao: {
			label: 'Movimentação',
			icon: ArrowRightLeft,
			cor: 'text-primary-500',
			ponto: 'bg-primary-500'
		},
		afastamento: {
			label: 'Afastamento',
			icon: CalendarOff,
			cor: 'text-warning-500',
			ponto: 'bg-warning-500'
		},
		desvinculacao: {
			label: 'Desvinculação',
			icon: UserMinus,
			cor: 'text-error-500',
			ponto: 'bg-error-500'
		},
		edicao: {
			label: 'Edição cadastral',
			icon: Pencil,
			cor: 'text-surface-600 dark:text-surface-400',
			ponto: 'bg-surface-400'
		},
		papel: {
			label: 'Mudança de papel',
			icon: ShieldCheck,
			cor: 'text-tertiary-500',
			ponto: 'bg-tertiary-500'
		}
	};

	function meta(tipo: string) {
		return (
			META[tipo] ?? {
				label: tipo,
				icon: CircleDot,
				cor: 'text-surface-600 dark:text-surface-400',
				ponto: 'bg-surface-400'
			}
		);
	}

	/** "2026-07-22 14:30:05" → "22/07/2026 14:30". */
	function dataHora(ts: string): string {
		if (!ts) return '';
		const [dia, hora] = ts.split(/[ T]/);
		return `${formatarData(dia)}${hora ? ' ' + hora.slice(0, 5) : ''}`;
	}

	const LABEL_CAMPO: Record<string, string> = {
		nome: 'Nome',
		matricula: 'Matrícula',
		cargo: 'Cargo',
		telefone: 'Telefone',
		lotacao: 'Lotação',
		regime: 'Regime',
		classe: 'Classe',
		email: 'E-mail',
		email_pessoal: 'E-mail pessoal',
		papel: 'Papel',
		papel_unidade_id: 'Unidade do papel',
		ativo: 'Ativo'
	};

	function parseDiff(json: string | null): Record<string, unknown> {
		if (!json) return {};
		try {
			return JSON.parse(json) as Record<string, unknown>;
		} catch {
			return {};
		}
	}

	const LABEL_PAPEL: Record<string, string> = {
		admin_seccional: 'Admin Seccional',
		admin_unidade: 'Admin Unidade'
	};

	/** Converte o valor cru do diff em texto legível conforme o campo. */
	function formatarValor(campo: string, v: unknown): string {
		if (v === null || v === undefined || v === '') return '—';
		if (campo === 'papel_unidade_id') return nomePorUnidadeId.get(Number(v)) ?? String(v);
		if (campo === 'papel') return LABEL_PAPEL[String(v)] ?? String(v);
		if (campo === 'regime')
			return v === 'plantao' ? 'Plantão' : v === 'expediente' ? 'Expediente' : String(v);
		if (campo === 'ativo') return v === 1 || v === '1' ? 'Ativo' : 'Inativo';
		return String(v);
	}

	function diffLinhas(antes: string | null, depois: string | null) {
		const a = parseDiff(antes);
		const d = parseDiff(depois);
		const chaves = new Set([...Object.keys(a), ...Object.keys(d)]);
		return [...chaves].map((c) => ({
			campo: LABEL_CAMPO[c] ?? c,
			antes: formatarValor(c, a[c]),
			depois: formatarValor(c, d[c])
		}));
	}
</script>

<div class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6 mt-4">
	<h2
		class="text-base font-bold mb-3 text-surface-700 dark:text-surface-300 flex items-center gap-2"
	>
		<History size={18} /> Histórico do Servidor
	</h2>

	{#if historico.length === 0}
		<p class="text-sm text-surface-600 dark:text-surface-400 italic py-4 text-center">
			Nenhum registro no histórico ainda.
		</p>
	{:else}
		<ol class="relative border-s-2 border-surface-200 dark:border-surface-700 ml-2 space-y-4">
			{#each historicoPagina as ev (ev.id)}
				{@const m = meta(ev.tipo)}
				{@const Icone = m.icon}
				<li class="ms-5">
					<span
						class="absolute -start-[7px] mt-1.5 h-3 w-3 rounded-full ring-4 ring-white dark:ring-surface-900 {m.ponto}"
					></span>
					<div class="card-elevated-2 rounded-xl p-3">
						<div class="flex items-start justify-between gap-2 flex-wrap">
							<div class="flex items-center gap-2 font-semibold text-sm {m.cor}">
								<Icone size={16} />
								<span>{m.label}</span>
								{#if ev.tipo === 'afastamento' && ev.id === afastamentoVigenteId}
									<span class="badge preset-filled-warning-500 text-3xs">Vigente</span>
								{/if}
							</div>
							<span class="text-3xs text-surface-600 dark:text-surface-400 tabular-nums"
								>{dataHora(ev.created_at)}</span
							>
						</div>

						<div class="mt-2 text-sm text-surface-700 dark:text-surface-200 space-y-1">
							{#if ev.tipo === 'movimentacao'}
								<p class="flex items-center gap-1.5 flex-wrap">
									<span class="text-surface-600 dark:text-surface-400"
										>{ev.unidade_origem || '—'}</span
									>
									<ArrowRightLeft size={14} class="text-primary-500" />
									<span class="font-medium">{ev.unidade_destino}</span>
								</p>
								{#if ev.data_evento}<p class="text-xs text-surface-600 dark:text-surface-400">
										Data: {formatarData(ev.data_evento)}
									</p>{/if}
							{:else if ev.tipo === 'afastamento'}
								<p class="font-medium">
									{LABEL_SUBTIPO_AFASTAMENTO[
										ev.subtipo as keyof typeof LABEL_SUBTIPO_AFASTAMENTO
									] ?? ev.subtipo}
								</p>
								{#if ev.descricao}<p class="text-xs">{ev.descricao}</p>{/if}
								<p class="text-xs text-surface-600 dark:text-surface-400">
									{formatarData(ev.data_inicio ?? '')} a {formatarData(ev.data_fim ?? '')}
									{#if ev.qtd_dias}· {ev.qtd_dias} dia(s){/if}
								</p>
							{:else if ev.tipo === 'desvinculacao'}
								<p>
									Destino: <span class="font-medium">{ev.descricao || ev.unidade_destino}</span>
								</p>
								{#if ev.data_evento}<p class="text-xs text-surface-600 dark:text-surface-400">
										Data: {formatarData(ev.data_evento)}
									</p>{/if}
							{:else if ev.tipo === 'edicao' || ev.tipo === 'papel'}
								<div class="space-y-0.5">
									{#each diffLinhas(ev.dados_antes, ev.dados_depois) as l (l.campo)}
										<p class="text-xs">
											<span class="font-medium">{l.campo}:</span>
											<span class="text-surface-600 dark:text-surface-400 line-through"
												>{l.antes}</span
											>
											<span class="mx-1">→</span>
											<span>{l.depois}</span>
										</p>
									{/each}
								</div>
							{/if}

							{#if ev.nup}
								<p class="text-3xs text-surface-600 dark:text-surface-400 font-mono">
									NUP: {ev.nup}
								</p>
							{/if}
						</div>

						<div class="mt-2 flex items-center justify-between gap-2 flex-wrap">
							{#if ev.registrado_por_nome}
								<span class="text-3xs text-surface-400">por {ev.registrado_por_nome}</span>
							{:else}
								<span></span>
							{/if}
							{#if ev.documento_r2_key}
								<a
									href="/api/policiais/historico/{ev.id}/documento"
									target="_blank"
									rel="noopener"
									class="btn btn-sm preset-outlined-surface-500 flex items-center gap-1.5 text-xs"
								>
									<FileText size={14} /> Documento
								</a>
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ol>

		{#if totalPaginas > 1}
			<div
				class="mt-4 pt-3 border-t border-surface-200 dark:border-white/5 flex items-center justify-between gap-2"
			>
				<span class="text-xs text-surface-600 dark:text-surface-400">
					Página {paginaAtual} de {totalPaginas} · {historico.length} registro(s)
				</span>
				<Paginador
					count={historico.length}
					pageSize={ITENS_POR_PAGINA}
					page={paginaAtual}
					onPageChange={(p) => (paginaAtual = p)}
				/>
			</div>
		{/if}
	{/if}
</div>
