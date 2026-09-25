<script lang="ts">
	/**
	 * "Minhas escalas" (E53): em que dias o servidor está escalado — plantão,
	 * expediente, fim de semana e GISE —, mês a mês.
	 *
	 * A pergunta que esta seção responde é a mais simples do sistema e era a que
	 * o servidor não conseguia fazer: "quando eu trabalho?". Ele chegava aqui
	 * pelo WhatsApp de alguém, porque `/escalas` o redirecionava.
	 *
	 * Os meses futuros vêm ABERTOS e os passados FECHADOS: quem abre esta tela
	 * quer saber o que vem, e o passado serve para conferir. O mês corrente
	 * conta como futuro — o dia de hoje ainda não acabou.
	 */
	import { formatarData } from '$lib/utils/datas';

	interface EscalaDoDia {
		tipo: 'ordinaria' | 'gise';
		id: number;
		titulo: string;
		data: string;
		lotacao: string | null;
		link: string;
	}

	const { escalas }: { escalas: EscalaDoDia[] } = $props();

	const MESES = [
		'janeiro',
		'fevereiro',
		'março',
		'abril',
		'maio',
		'junho',
		'julho',
		'agosto',
		'setembro',
		'outubro',
		'novembro',
		'dezembro'
	];

	/** "2026-10-05" → "outubro de 2026". */
	const rotuloDoMes = (chave: string) => {
		const [ano, mes] = chave.split('-');
		return `${MESES[Number(mes) - 1]} de ${ano}`;
	};

	const mesAtual = new Date().toISOString().slice(0, 7);

	/**
	 * Um bloco por mês, do mais recente para o mais antigo.
	 *
	 * Objeto simples e não `Map`: a lente do Svelte cobra `SvelteMap` para
	 * qualquer Map dentro de um `$derived`, e aqui não há reatividade a ganhar —
	 * o agrupamento é recalculado inteiro quando `escalas` muda.
	 */
	const porMes = $derived.by(() => {
		const grupos: Record<string, EscalaDoDia[]> = {};
		for (const e of escalas) {
			const chave = e.data.slice(0, 7);
			(grupos[chave] ??= []).push(e);
		}
		return Object.entries(grupos)
			.sort((a, b) => b[0].localeCompare(a[0]))
			.map(([chave, dias]) => ({
				chave,
				rotulo: rotuloDoMes(chave),
				futuro: chave >= mesAtual,
				dias: dias.sort((a, b) => a.data.localeCompare(b.data))
			}));
	});
</script>

<section class="mt-4" aria-labelledby="minhas-escalas">
	<h2
		id="minhas-escalas"
		class="mb-2 text-base font-semibold text-surface-900 dark:text-surface-50"
	>
		Minhas escalas
	</h2>
	{#if escalas.length === 0}
		<div class="card-elevated rounded-2xl p-5">
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Você não está escalado em nenhum dia. Quem monta a escala é quem administra a sua unidade.
			</p>
		</div>
	{:else}
		<div class="card-elevated space-y-2 rounded-2xl p-5">
			{#each porMes as mes (mes.chave)}
				<details
					open={mes.futuro}
					class="rounded-xl border border-surface-200 dark:border-white/10"
				>
					<summary
						class="cursor-pointer px-3 py-2 text-sm font-semibold text-surface-800 dark:text-surface-200"
					>
						{mes.rotulo}
						<span class="ml-1 text-xs font-normal text-surface-500">
							· {mes.dias.length}
							{mes.dias.length === 1 ? 'dia' : 'dias'}
						</span>
					</summary>
					<ul class="border-t border-surface-200 px-3 py-2 dark:border-white/10">
						{#each mes.dias as d (`${d.tipo}${d.id}-${d.data}`)}
							<li class="flex flex-wrap items-baseline gap-x-2 py-1 text-sm">
								<span class="font-mono text-xs tabular-nums text-surface-500"
									>{formatarData(d.data)}</span
								>
								<a href={d.link} class="font-medium no-underline hover:underline">{d.titulo}</a>
								{#if d.tipo === 'gise'}
									<span class="badge preset-filled-warning-500 text-2xs">GISE</span>
								{/if}
								{#if d.lotacao}
									<span class="text-xs text-surface-500">{d.lotacao}</span>
								{/if}
							</li>
						{/each}
					</ul>
				</details>
			{/each}
		</div>
	{/if}
</section>
