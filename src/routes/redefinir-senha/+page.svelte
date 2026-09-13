<script lang="ts">
	/**
	 * A tela do link de redefinição — e o motivo de ela NÃO se enviar sozinha.
	 *
	 * No primeiro acesso o link é magic link, e seria natural submeter no
	 * `onMount` para poupar um clique. Não se faz: scanner de e-mail corporativo
	 * e prefetch de cliente abrem os links da mensagem para checar segurança, e o
	 * auto-submit consumiria o token de USO ÚNICO antes de a pessoa clicar — ela
	 * receberia "link inválido" num link que nunca usou.
	 *
	 * A conferência das duas senhas é conveniência de digitação; o que vale é a
	 * validação do servidor.
	 */
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { loading } from '$lib/loading.svelte';
	import CamposNovaSenha, { validarForcaSenha } from '$lib/components/CamposNovaSenha.svelte';
	import CabecalhoAuth from '$lib/components/CabecalhoAuth.svelte';
	import type { PageProps } from './$types';
	import type { ActionResult } from '@sveltejs/kit';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';

	const { data }: PageProps = $props();

	let novaSenha = $state('');
	let confirmarSenha = $state('');
	let erroForm = $state('');

	// Primeiro acesso por link: ao clicar em "Continuar", autentica (sessão
	// one-time) e segue ao /alterar-senha. NÃO auto-submeter: scanners de e-mail
	// (Safe Links/gateways) abrem o link num sandbox e executam o JS — um
	// auto-submit consumiria o token de uso único antes de o usuário clicar.
	// Exigir o clique explícito evita esse consumo (scanners não clicam botões).
	function handleMagic() {
		loading.show('Entrando...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true });
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				erroForm = String(d?.error || 'Erro ao iniciar o primeiro acesso.');
			}
		};
	}

	const forca = $derived(validarForcaSenha(novaSenha, confirmarSenha));

	function handleRedefinir({ cancel }: { cancel: () => void }) {
		erroForm = '';
		if (novaSenha !== confirmarSenha) {
			erroForm = 'As senhas não conferem.';
			cancel();
			return;
		}
		loading.show('Salvando nova senha...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				erroForm = String(d?.error || 'Erro ao redefinir a senha.');
			} else if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true });
			}
		};
	}
</script>

<svelte:head>
	<title>Redefinir Senha | Ecossistema PCCE</title>
</svelte:head>

<div class="min-h-[80vh] flex items-center justify-center p-4">
	<div class="w-full max-w-sm">
		<div class="p-6 sm:p-8 rounded-3xl card-glass-auth">
			{#if !data.valido}
				<!-- Token inválido / expirado -->
				<div class="text-center">
					<div
						class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-error-500/10 border border-error-500/20 mb-4"
					>
						<svg
							class="w-7 h-7 text-error-500"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
							/>
						</svg>
					</div>
					<h1 class="text-xl font-bold mb-2">Link inválido</h1>
					<p class="text-sm text-surface-600 dark:text-surface-400 mb-6">{data.erro}</p>
					<a href="/login" class="btn preset-filled-primary-500 w-full no-underline justify-center">
						Ir para o login
					</a>
				</div>
			{:else if data.primeiroAcesso}
				<!-- Primeiro acesso: magic link → /alterar-senha (senha + e-mail pessoal) -->
				<div class="text-center">
					<div
						class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-500/10 border border-primary-500/20 mb-4"
					>
						<svg
							class="w-7 h-7 text-primary-500 animate-pulse"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="1.8"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
							/>
						</svg>
					</div>
					<h1 class="text-xl font-bold mb-2">Primeiro acesso</h1>
					<p class="text-sm text-surface-600 dark:text-surface-400 mb-6">
						Para concluir seu primeiro acesso, clique no botão abaixo. Em seguida você definirá sua
						senha e confirmará seu e-mail pessoal.
					</p>

					{#if erroForm}
						<div
							class="flex items-center gap-2 p-3 mb-4 rounded-xl bg-error-500/10 border border-error-500/25 text-error-700 dark:text-error-300 text-sm"
						>
							{erroForm}
						</div>
					{/if}

					<form method="POST" action="?/redefinir" use:enhance={handleMagic}>
						<input type="hidden" name="token" value={data.token} />
						<button
							type="submit"
							class="btn preset-filled-primary-500 w-full py-3 font-semibold justify-center"
							disabled={loading.active}
						>
							{loading.active ? 'Entrando…' : 'Continuar primeiro acesso'}
						</button>
					</form>
				</div>
			{:else}
				<!-- Formulário de nova senha -->
				<CabecalhoAuth
					titulo="Definir nova senha"
					descricao="Escolha uma senha segura para sua conta."
				/>

				{#if erroForm}
					<div
						class="flex items-center gap-2 p-3 mb-4 rounded-xl bg-error-500/10 border border-error-500/25 text-error-700 dark:text-error-300 text-sm"
					>
						<AlertCircle class="w-4 h-4 shrink-0" aria-hidden="true" />
						{erroForm}
					</div>
				{/if}

				<form
					method="POST"
					action="?/redefinir"
					use:enhance={handleRedefinir}
					class="flex flex-col gap-4"
				>
					<input type="hidden" name="token" value={data.token} />

					<CamposNovaSenha bind:novaSenha bind:confirmarSenha nameConfirmar="confirmar_senha" />

					<button
						type="submit"
						class="btn preset-filled-primary-500 w-full py-3 mt-1 font-semibold tracking-wide flex items-center justify-center gap-2"
						disabled={loading.active || !forca.senhaOk || !forca.confirmaOk}
					>
						{loading.active ? 'Salvando...' : 'Definir nova senha'}
					</button>
				</form>
			{/if}
		</div>
	</div>
</div>
