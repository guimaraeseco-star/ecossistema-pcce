<script lang="ts">
	/**
	 * A faixa "escala desfalcada" (E60): quem está escalado e, pela linha do
	 * tempo, está AFASTADO na data — férias em gozo ou qualquer outro
	 * afastamento. O sistema avisa e não desescala sozinho: é o admin da escala
	 * quem decide substituir. Vazia, não desenha nada.
	 */
	import { formatarData } from '$lib/utils/datas';
	import type { Desfalque } from '$lib/db/policiais/afastamento-escalas';
	import { descreverAfastamento } from '$lib/servidores/afastamento-descricao';

	const { desfalques }: { desfalques: Desfalque[] } = $props();
</script>

{#if desfalques.length > 0}
	<div
		class="rounded-xl border-l-4 border-error-500 bg-error-500/10 px-4 py-3 text-sm"
		role="alert"
	>
		<p class="font-bold text-error-700 dark:text-error-300">
			⚠ Escala desfalcada: {desfalques.length} servidor{desfalques.length === 1 ? '' : 'es'} escalado{desfalques.length ===
			1
				? ''
				: 's'} em dia de afastamento
		</p>
		<ul class="mt-1 list-disc pl-5 text-xs text-error-700 dark:text-error-300">
			{#each desfalques as d (d.policial_id + d.data)}
				<li>
					<b>{d.nome}</b> em {formatarData(d.data)} — {descreverAfastamento(d.afastamento)}
				</li>
			{/each}
		</ul>
		<p class="mt-1 text-2xs text-error-700/80 dark:text-error-300/80">
			O sistema não desescala sozinho: substitua ou remova o servidor.
		</p>
	</div>
{/if}
