<script lang="ts">
	/**
	 * Fluxo 1+2 da tela de login: formulário de senha (→ 2FA no orquestrador)
	 * e entrada por certificado digital SERPRO (dispensa 2FA).
	 *
	 * O COLABORADOR (terceira identidade) entra pela mesma tela, por um link
	 * abaixo do formulário e não por uma terceira opção no alternador: o
	 * alternador é de duas posições por desenho, e colaborador é exceção —
	 * meia dúzia de contas. Nesse modo o campo é o e-mail (decisão 71), sem
	 * certificado, sem primeiro acesso por link e sem recuperação de senha
	 * (a senha provisória e a redefinição são do Super Admin).
	 */
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import UserRound from '@lucide/svelte/icons/user-round';
	import { enhance } from '$app/forms';
	import { loading as loadingService } from '$lib/loading.svelte';
	import SeletorPolicialAdmin from './SeletorPolicialAdmin.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		tipo = $bindable(),
		comoColaborador = $bindable(false),
		matricula = $bindable(),
		senha = $bindable(),
		loginErrorDisplay,
		handleLogin,
		fazerLoginComCertificado,
		onPrimeiroAcesso,
		onRecuperacao
	}: {
		tipo: 'policial' | 'admin';
		/** Modo colaborador: e-mail no lugar da matrícula; o POST leva `tipo=colaborador`. */
		comoColaborador?: boolean;
		matricula: string;
		senha: string;
		loginErrorDisplay: string | null;
		handleLogin: SubmitFunction;
		fazerLoginComCertificado: (comoAdmin?: boolean) => Promise<void>;
		onPrimeiroAcesso: () => void;
		onRecuperacao: () => void;
	} = $props();
</script>

{#if comoColaborador}
	<p class="mb-5 text-sm text-surface-600 dark:text-surface-400 text-center">
		Acesso de <strong>colaborador(a)</strong> — entre com o e-mail cadastrado.
	</p>
{:else}
	<div class="mb-5">
		<SeletorPolicialAdmin bind:tipo />
	</div>
{/if}

<form method="POST" action="?/login" use:enhance={handleLogin} class="flex flex-col gap-4">
	<input type="hidden" name="tipo" value={comoColaborador ? 'colaborador' : tipo} />
	<label class="label">
		<span class="label-text"
			>{comoColaborador ? 'E-mail' : tipo === 'admin' ? 'Login' : 'Matrícula'}</span
		>
		<!-- svelte-ignore a11y_autofocus -->
		<!-- Página dedicada de login: foco inicial no campo é padrão aceito por a11y. -->
		<input
			class="input"
			type={comoColaborador ? 'email' : 'text'}
			name="matricula"
			bind:value={matricula}
			placeholder={comoColaborador
				? 'Digite seu e-mail'
				: tipo === 'admin'
					? 'Digite seu login'
					: 'Digite sua matrícula (8 caracteres)'}
			maxlength={comoColaborador ? 254 : tipo === 'admin' ? undefined : 8}
			autocomplete="username"
			inputmode={comoColaborador ? 'email' : tipo === 'policial' ? 'numeric' : 'text'}
			enterkeyhint="next"
			aria-describedby={loginErrorDisplay ? 'login-error' : undefined}
			autofocus
			required
		/>
	</label>

	<label class="label">
		<span class="label-text">Senha</span>
		<input
			class="input"
			type="password"
			name="senha"
			bind:value={senha}
			placeholder="Digite sua senha"
			autocomplete="current-password"
			enterkeyhint="go"
			aria-describedby={loginErrorDisplay ? 'login-error' : undefined}
			required
		/>
	</label>

	{#if loginErrorDisplay}
		<div
			id="login-error"
			role="alert"
			aria-live="assertive"
			class="flex items-center gap-2 p-3 rounded-xl bg-error-500/10 border border-error-500/25 text-error-700 dark:text-error-300 text-sm"
		>
			<AlertCircle class="w-4 h-4 shrink-0" aria-hidden="true" />
			{loginErrorDisplay}
		</div>
	{/if}

	<button
		type="submit"
		class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
		disabled={loadingService.active}
	>
		{loadingService.active ? 'Entrando...' : 'Entrar'}
	</button>
</form>

{#if comoColaborador}
	<div class="mt-4 text-xs text-surface-600 dark:text-surface-400 text-center">
		<button
			type="button"
			class="text-primary-600 dark:text-primary-400 underline underline-offset-2 hover:opacity-80 transition-opacity"
			onclick={() => {
				comoColaborador = false;
				matricula = '';
			}}
		>
			Voltar ao acesso de policial ou administrador
		</button>
	</div>
{:else}
	<div class="flex items-center gap-3 my-3">
		<div class="flex-1 h-px bg-surface-200 dark:bg-surface-700"></div>
		<span class="text-xs text-surface-600 dark:text-surface-400 shrink-0">ou</span>
		<div class="flex-1 h-px bg-surface-200 dark:bg-surface-700"></div>
	</div>
	<!-- As duas portas alternativas com o MESMO peso: certificado e colaborador.
	     "Sou colaborador(a)" era um link miúdo na linha de ajuda e ninguém o
	     achava (pedido de 13/09/2026). -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<button
			type="button"
			class="btn preset-outlined-surface-500 w-full py-3 flex items-center justify-center gap-2 text-sm"
			disabled={loadingService.active}
			onclick={() => fazerLoginComCertificado(tipo === 'admin')}
		>
			<!-- Token A3 / pendrive USB — Lucide não tem flash-drive; silhueta lateral. -->
			<svg
				class="w-4 h-4 shrink-0"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<!-- Conector USB-A -->
				<path d="M2 9h5v6H2z" />
				<path d="M4 11v2M6 11v2" />
				<!-- Corpo do token -->
				<rect x="7" y="7" width="15" height="10" rx="2" />
			</svg>
			Certificado Digital (SERPRO)
		</button>
		<button
			type="button"
			class="btn preset-outlined-surface-500 w-full py-3 flex items-center justify-center gap-2 text-sm"
			disabled={loadingService.active}
			onclick={() => {
				comoColaborador = true;
				matricula = '';
			}}
		>
			<UserRound class="w-4 h-4 shrink-0" aria-hidden="true" />
			Sou colaborador(a)
		</button>
	</div>

	<div
		class="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-xs text-surface-600 dark:text-surface-400 text-center"
		role="navigation"
		aria-label="Ajuda de acesso"
	>
		{#if tipo === 'policial'}
			<span class="inline-flex flex-nowrap items-baseline gap-1">
				<span class="shrink-0">Primeiro acesso?</span>
				<button
					type="button"
					class="shrink-0 text-primary-600 dark:text-primary-400 underline underline-offset-2 hover:opacity-80 transition-opacity"
					onclick={onPrimeiroAcesso}
				>
					Clique aqui
				</button>
			</span>
			<span
				class="hidden sm:inline text-surface-300 dark:text-surface-600 select-none"
				aria-hidden="true">·</span
			>
		{/if}
		<span class="inline-flex flex-nowrap items-baseline gap-1">
			<span class="shrink-0">Esqueceu a senha?</span>
			<button
				type="button"
				class="shrink-0 text-primary-600 dark:text-primary-400 underline underline-offset-2 hover:opacity-80 transition-opacity"
				onclick={onRecuperacao}
			>
				Recuperar
			</button>
		</span>
	</div>
{/if}
