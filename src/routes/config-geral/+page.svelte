<script lang="ts">
	/**
	 * Configurações gerais — hoje, a escolha do PROVEDOR de e-mail.
	 *
	 * A escolha não é cosmética: o 2FA e o primeiro acesso são fail-closed em
	 * cima do envio de e-mail, então um provedor mal configurado tranca o login
	 * de todo mundo. Por isso a tela testa o envio antes de o operador confiar na
	 * mudança, em vez de só gravar a preferência.
	 *
	 * O `state_referenced_locally` é intencional e está anotado no ponto: o valor
	 * inicial é capturado uma vez e o `$effect` o re-sincroniza quando o servidor
	 * confirma — sem isso, o radio saltaria de volta enquanto o salvamento corre.
	 */
	import type { PageProps } from './$types';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';

	const { data, form }: PageProps = $props();

	// Captura intencional do valor inicial — `provedor` é editável pelos radios e
	// é re-sincronizado pelo $effect abaixo quando o servidor confirma o salvar.
	// svelte-ignore state_referenced_locally
	let provedor = $state<'cloudflare' | 'resend'>(data.provedorEmail);
	let salvando = $state(false);

	// Mantém a seleção sincronizada com o que o servidor confirmou após salvar.
	$effect(() => {
		if (form?.provedorEmail) provedor = form.provedorEmail as 'cloudflare' | 'resend';
	});

	const OPCOES = [
		{
			valor: 'cloudflare' as const,
			titulo: 'Cloudflare Email',
			descricao: 'Binding nativo do Worker (cota ~200/dia). Padrão histórico do sistema.'
		},
		{
			valor: 'resend' as const,
			titulo: 'Resend',
			descricao: 'API HTTP (RESEND_API_KEY). Útil para isolar problemas de entrega.'
		}
	];
</script>

<svelte:head><title>Configurações Gerais | Ecossistema PCCE</title></svelte:head>

<div class="space-y-6">
	<header>
		<h1 class="h1 text-2xl font-bold">Configurações Gerais</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400">
			Ajustes globais do sistema. Alterações ficam registradas na auditoria.
		</p>
	</header>

	<section class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
		<div>
			<h2 class="text-lg font-semibold text-surface-900 dark:text-white">
				Provedor de e-mail padrão
			</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Define qual serviço envia os e-mails primeiro (códigos 2FA, recuperação de senha, link de
				primeiro acesso). Se o provedor padrão falhar ou estourar a cota, o outro assume
				automaticamente.
			</p>
		</div>

		<form
			method="POST"
			action="?/salvarEmail"
			use:enhance={() => {
				salvando = true;
				return async ({ result, update }) => {
					salvando = false;
					if (result.type === 'success') {
						toaster.success({ title: 'Configuração salva' });
					} else if (result.type === 'failure') {
						toaster.error({
							title: 'Não foi possível salvar',
							description: String(result.data?.error ?? '')
						});
					}
					await update({ reset: false });
				};
			}}
			class="space-y-4"
		>
			<div class="grid gap-3 sm:grid-cols-2">
				{#each OPCOES as op (op.valor)}
					<label
						class="flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors {provedor ===
						op.valor
							? 'border-primary-500/60 bg-primary-500/10'
							: 'border-surface-200 dark:border-white/10 hover:bg-surface-100/50 dark:hover:bg-surface-800/40'}"
					>
						<input
							type="radio"
							name="provedor"
							value={op.valor}
							bind:group={provedor}
							class="radio mt-1 shrink-0"
						/>
						<span class="space-y-1">
							<span class="block font-medium text-surface-900 dark:text-white">{op.titulo}</span>
							<span class="block text-xs text-surface-600 dark:text-surface-400"
								>{op.descricao}</span
							>
						</span>
					</label>
				{/each}
			</div>

			{#if provedor === 'resend' && !data.resendConfigurado}
				<p
					class="rounded-lg border border-warning-500/30 bg-warning-500/10 p-3 text-xs text-warning-700 dark:text-warning-300"
				>
					<AlertTriangle class="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> O Resend não parece
					configurado (RESEND_API_KEY ausente). O envio cairá no fallback (Cloudflare) até configurar
					a chave.
				</p>
			{/if}

			<div class="flex items-center gap-3">
				<button
					type="submit"
					class="btn preset-filled-primary-500 text-sm"
					disabled={salvando || provedor === data.provedorEmail}
				>
					{salvando ? 'Salvando…' : 'Salvar'}
				</button>
				<span class="text-xs text-surface-600 dark:text-surface-400">
					Padrão atual: <strong>{data.provedorEmail === 'resend' ? 'Resend' : 'Cloudflare'}</strong>
				</span>
			</div>
		</form>
	</section>
</div>
