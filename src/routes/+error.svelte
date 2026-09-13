<script lang="ts">
	/**
	 * A página de erro de TODA a aplicação — o que o usuário vê quando uma rota
	 * lança.
	 *
	 * Ela distingue 404 e 403 com texto próprio e cai numa mensagem genérica no
	 * resto. A distinção importa porque as três situações pedem ações
	 * diferentes: conferir o endereço, pedir acesso, ou tentar de novo. Um "algo
	 * deu errado" único faria o usuário sem permissão ficar recarregando.
	 *
	 * `page.error?.message` só aparece quando o SvelteKit o expõe — mensagem de
	 * 5xx não vaza detalhe interno para a tela; o rastreio fica no `errorId` que
	 * `serverError` gera e o usuário pode reportar (ver `$lib/server/api`).
	 */
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Erro {page.status} | Ecossistema PCCE</title>
</svelte:head>

<div class="min-h-[60vh] flex flex-col items-center justify-center p-4 sm:p-6 text-center">
	<div class="w-16 h-16 rounded-full bg-error-500/10 flex items-center justify-center mb-4">
		<svg class="w-8 h-8 text-error-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
			/>
		</svg>
	</div>

	<h1 class="text-3xl font-black text-surface-900 dark:text-surface-50">
		{page.status}
	</h1>

	<p class="text-surface-600 dark:text-surface-400 mt-2 max-w-md">
		{#if page.status === 404}
			A página que você procura não foi encontrada.
		{:else if page.status === 403}
			Você não tem permissão para acessar esta página.
		{:else if page.error?.message}
			{page.error.message}
		{:else}
			Ocorreu um erro inesperado. Tente novamente.
		{/if}
	</p>

	{#if page.error?.errorId}
		<p class="text-xs text-surface-600 dark:text-surface-400 mt-2 font-mono">
			Ref: {page.error.errorId}
		</p>
	{/if}

	<a href="/" class="mt-6 btn preset-filled-primary-500 text-sm px-6 py-2 rounded-xl">
		Voltar ao início
	</a>
</div>
