<script lang="ts">
	/**
	 * A porta do portal público de validação: um campo para o código, e nada mais.
	 *
	 * **Não há upload aqui, e é decisão.** Conferir a assinatura de um PDF de
	 * terceiro é competência do ITI — a tela de resultado (`/validar/[hash]`)
	 * aponta para `validar.iti.gov.br`, que é a autoridade para isso. O que este
	 * portal prova é outra coisa: que o código de verificação corresponde a um
	 * documento REGISTRADO neste sistema, com assinante, data e hash.
	 *
	 * A consequência prática é que a superfície pública não parseia arquivo
	 * nenhum: só consulta por hash, com teto de varredura no servidor
	 * (`validar-rate-limit.ts`).
	 */
	import { goto } from '$app/navigation';
	import { loading } from '$lib/loading.svelte';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';

	let hash = $state('');

	function validar() {
		if (hash.trim()) {
			loading.show('Validando documento...');
			goto(`/validar/${hash.trim()}`);
		}
	}
</script>

<svelte:head>
	<title>Validar Documento | Ecossistema PCCE</title>
</svelte:head>

<div
	class="min-h-screen bg-surface-50 dark:bg-surface-900 flex flex-col items-center justify-center p-4"
>
	<div
		class="card w-full max-w-lg bg-white dark:bg-surface-800 shadow-2xl border border-surface-200 dark:border-white/10 rounded-3xl overflow-hidden p-6 sm:p-12 transition-all hover:shadow-primary-500/5"
	>
		<!-- Header / Identity -->
		<div class="flex flex-col items-center mb-10">
			<div class="relative mb-6">
				<div class="absolute -inset-1 rounded-full bg-primary-500/20 blur-xl animate-pulse"></div>
				<img
					src="/api/validar/logo"
					alt="Brasão do Estado do Ceará"
					width="200"
					height="200"
					class="relative w-20 sm:w-24 drop-shadow-2xl"
				/>
			</div>
			<span
				class="text-3xs font-black text-primary-600 dark:text-primary-400 uppercase tracking-[0.3em] mb-2"
				>Portal de Autenticidade</span
			>
			<h1
				class="text-2xl sm:text-3xl font-black text-surface-900 dark:text-white uppercase tracking-tighter text-center leading-none"
			>
				Verificação de Documentos
			</h1>
			<p
				class="text-surface-600 dark:text-surface-400 font-medium text-center mt-3 text-sm max-w-[280px]"
			>
				Confirme a validade jurídica de escalas e relatórios oficiais.
			</p>
		</div>

		<!-- Validation Form -->
		<form
			onsubmit={(e) => {
				e.preventDefault();
				validar();
			}}
			class="space-y-6"
		>
			<div class="space-y-2">
				<label
					for="hash"
					class="block text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-widest ml-1"
					>Código de Verificação (Hash)</label
				>
				<div class="relative group">
					<div
						class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-surface-400 group-focus-within:text-primary-500 transition-colors"
					>
						<ShieldCheck class="w-5 h-5" aria-hidden="true" />
					</div>
					<input
						id="hash"
						type="text"
						bind:value={hash}
						placeholder="Digite o código aqui..."
						class="w-full pl-12 pr-6 py-5 bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-white/5 rounded-2xl text-xl font-mono focus:ring-4 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all uppercase placeholder:font-sans placeholder:text-sm"
						autocomplete="off"
						spellcheck="false"
					/>
				</div>
			</div>

			<button
				type="submit"
				disabled={!hash.trim() || loading.active}
				class="group relative w-full py-5 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white font-black uppercase tracking-[0.15em] rounded-2xl shadow-xl shadow-primary-600/20 transition-all disabled:opacity-30 disabled:grayscale disabled:shadow-none overflow-hidden"
			>
				<div
					class="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300"
				></div>
				<span class="relative flex items-center justify-center gap-2">
					{loading.active ? 'Validando...' : 'Verificar Autenticidade'}
				</span>
			</button>
		</form>

		<!-- Info / Helper -->
		<div class="mt-12 pt-8 border-t border-surface-100 dark:border-white/5 text-center">
			<div
				class="flex items-center justify-center gap-2 text-surface-600 dark:text-surface-400 text-2xs mb-4"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				<span>Onde encontrar o código?</span>
			</div>
			<p
				class="text-3xs text-surface-600 dark:text-surface-400 leading-relaxed max-w-[320px] mx-auto italic"
			>
				O código alfanumérico está localizado no rodapé do documento impresso, logo abaixo do QR
				Code de validação.
			</p>
		</div>
	</div>

	<p class="mt-10 text-3xs text-surface-400/50 uppercase font-black tracking-[0.3em]">
		Ambiente Seguro PC-CE
	</p>
</div>

<style>
	:global(body) {
		overflow-x: hidden;
	}
</style>
