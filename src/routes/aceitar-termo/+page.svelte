<script lang="ts">
	/**
	 * A tela do aceite do termo — porta obrigatória, uma vez por usuário.
	 *
	 * O texto exibido é o MESMO que o servidor hasheia ao gravar o aceite (ver
	 * `+page.server.ts`): a página não resume nem parafraseia. Mostrar uma
	 * versão "amigável" e gravar o hash de outra tornaria o registro inútil como
	 * prova do que a pessoa leu.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';

	const { data, form }: PageProps = $props();

	let enviando = $state(false);
</script>

<svelte:head>
	<title>Termo de Uso | Ecossistema PCCE</title>
</svelte:head>

<div
	class="min-h-screen bg-surface-50 dark:bg-surface-900 flex flex-col items-center justify-center p-4"
>
	<!-- Card compacto (modal): aceite único e implícito. O termo completo abre em
	     nova aba pelo link, sem exigir rolagem nem múltiplas caixas. -->
	<div
		class="w-full max-w-md bg-white dark:bg-surface-800 shadow-xl border border-primary-500/20 rounded-2xl overflow-hidden"
	>
		<header class="flex flex-col items-center px-6 pt-6 pb-4">
			<!-- Brasão do Estado do Ceará, servido do R2 (assets/logo_ceara.jpg) pela
			     rota pública /api/validar/logo. -->
			<img
				src="/api/validar/logo"
				alt="Brasão do Estado do Ceará"
				width="200"
				height="200"
				class="h-16 w-auto mb-3 drop-shadow-md"
			/>
			<h1
				class="text-base font-black uppercase tracking-tight text-surface-900 dark:text-white text-center"
			>
				Termo de Uso e Política de Privacidade
			</h1>
			<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
				Versão {data.versao} · vigente desde {data.vigenteDesde}
			</p>
		</header>

		<div class="px-6 pb-2 text-sm leading-relaxed text-surface-700 dark:text-surface-200">
			<p class="text-justify hyphens-auto">
				Para usar o Sistema, você precisa aceitar os Termos de Uso e a Política de Privacidade. Ao
				clicar em <strong>“Li e aceito”</strong>, você declara ciência e concordância — inclusive
				com o uso da
				<strong
					>assinatura eletrônica do Sistema como equivalente à sua assinatura de próprio punho</strong
				>.
			</p>
			<p class="mt-3">
				<a
					href="/termo/{data.versao}"
					target="_blank"
					rel="noopener noreferrer"
					class="text-primary-600 dark:text-primary-400 font-semibold underline underline-offset-2 hover:text-primary-700"
				>
					Ler o termo completo (abre em nova aba) ↗
				</a>
			</p>
		</div>

		<form
			method="POST"
			action="?/aceitar"
			use:enhance={() => {
				enviando = true;
				return async ({ update }) => {
					await update();
					enviando = false;
				};
			}}
			class="px-6 pt-3 pb-5"
		>
			<!-- Manifestação deliberada: o POST com este campo É o aceite (implícito
			     no clique do botão, conforme a cláusula 7 do termo). -->
			<input type="hidden" name="confirmado" value="true" />

			{#if form?.erro}
				<p class="text-sm text-error-600 font-bold mb-3">{form.erro}</p>
			{/if}

			<div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
				<a
					href="/api/auth/logout"
					class="px-4 py-2 text-center bg-surface-200 hover:bg-surface-300 dark:bg-surface-700 dark:hover:bg-surface-600 text-surface-800 dark:text-surface-200 font-bold rounded-xl text-sm transition-colors"
				>
					Recusar e sair
				</a>
				<button
					type="submit"
					disabled={enviando}
					class="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 disabled:bg-surface-400 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors"
				>
					{enviando ? 'Registrando aceite…' : 'Li e aceito'}
				</button>
			</div>

			<p class="text-3xs text-surface-600 dark:text-surface-400 mt-4 text-center">
				O aceite registra data/hora, IP e dispositivo · Hash do termo:
				<code class="font-mono">{data.hash.slice(0, 16)}…</code>
			</p>
		</form>
	</div>
</div>
