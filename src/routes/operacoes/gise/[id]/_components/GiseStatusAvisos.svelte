<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	/**
	 * Avisos contextuais que aparecem abaixo do bloco principal da GISE:
	 *  - Admin Seccional: alerta quando a seccional foi retificada após envio.
	 *  - Supervisor: alerta quando ainda está aguardando as seccionais concluírem.
	 *
	 * Extraído de `+page.svelte` para reduzir a densidade da página principal
	 * (2.400 linhas). Pedaços pequenos como este são os primeiros candidatos
	 * a componentizar — zero estado próprio, só apresentação.
	 */
	interface Props {
		isSeccional: boolean;
		isSupervisor: boolean;
		minhaSeccionalRetificada: boolean;
		giseEmPreenchimento: boolean;
	}

	const { isSeccional, isSupervisor, minhaSeccionalRetificada, giseEmPreenchimento }: Props =
		$props();
</script>

{#if isSeccional && minhaSeccionalRetificada}
	<div class="rounded-2xl border border-warning-500/40 bg-warning-500/10 p-4 text-sm">
		<p class="font-semibold text-warning-700 dark:text-warning-400">
			<AlertTriangle class="inline w-4 h-4 -mt-0.5" aria-hidden="true" /> Seccional Retificada
		</p>
		<p class="text-warning-600 dark:text-warning-300 mt-1 text-sm">
			Você realizou alterações após o envio. A assinatura digital da escala foi revogada. Finalize o
			envio novamente para prosseguir com a assinatura.
		</p>
	</div>
{/if}

{#if isSupervisor && giseEmPreenchimento}
	<div class="rounded-2xl border border-warning-500/30 bg-warning-500/5 p-5 text-center">
		<p class="text-warning-700 dark:text-warning-400 text-sm font-medium">
			A escala ainda não está concluída pelas seccionais.
		</p>
	</div>
{/if}
