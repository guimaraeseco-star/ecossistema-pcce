<script lang="ts">
	/**
	 * O termo de uso em página própria, endereçável por VERSÃO.
	 *
	 * Existe separada da tela de aceite porque o termo precisa ser consultável
	 * depois — por quem já aceitou, por quem audita, e pelo link que o rodapé
	 * dos documentos carrega. O hash SHA-256 aparece na página pelo mesmo
	 * motivo: é ele que amarra "este texto" ao aceite registrado.
	 *
	 * É o único `{@html}` do projeto, e o conteúdo é constante do código-fonte
	 * passada por `sanitizeTermoHtml` — defesa em camadas, não confiança.
	 */
	import type { PageProps } from './$types';
	const { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Termo de Uso v{data.versao} | Ecossistema PCCE</title>
</svelte:head>

<div
	class="min-h-screen bg-surface-50 dark:bg-surface-900 flex flex-col items-center justify-start p-3 sm:p-6"
>
	<div
		class="w-full max-w-3xl bg-white dark:bg-surface-800 shadow-xl border border-primary-500/20 rounded-2xl sm:rounded-3xl overflow-hidden"
	>
		<header
			class="flex flex-col items-center p-4 sm:p-6 border-b border-surface-200 dark:border-white/5"
		>
			<!-- Brasão do Estado do Ceará (R2 assets/logo_ceara.jpg via /api/validar/logo). -->
			<img
				src="/api/validar/logo"
				alt="Brasão do Estado do Ceará"
				width="200"
				height="200"
				class="h-16 sm:h-24 w-auto mb-2 drop-shadow-md"
			/>
			<h1
				class="text-lg sm:text-xl font-black uppercase tracking-tighter text-surface-900 dark:text-white text-center"
			>
				Termo de Uso e Política de Privacidade
			</h1>
			<p class="text-xs text-surface-600 dark:text-surface-400 mt-1">
				Versão {data.versao} · vigente desde {data.vigenteDesde}
			</p>
			<p class="text-3xs text-surface-600 dark:text-surface-400 mt-1 font-mono">
				Hash SHA-256: {data.hash}
			</p>
		</header>

		<div
			class="termo-conteudo p-4 sm:p-6 text-sm leading-relaxed text-surface-700 dark:text-surface-200"
		>
			<!-- sanitizado em +page.server.ts via sanitizeTermoHtml() -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html data.conteudoHtml}
		</div>
	</div>
</div>

<style>
	.termo-conteudo :global(h2) {
		font-size: 1.05rem;
		font-weight: 800;
		margin-bottom: 0.25rem;
	}
	.termo-conteudo :global(h3) {
		font-size: 0.92rem;
		font-weight: 700;
		margin-top: 1rem;
		margin-bottom: 0.4rem;
	}
	.termo-conteudo :global(p) {
		margin-bottom: 0.5rem;
		text-align: justify;
		hyphens: auto;
	}
	.termo-conteudo :global(.subtitulo) {
		font-size: 0.78rem;
		opacity: 0.7;
		margin-bottom: 0.75rem;
	}
	.termo-conteudo :global(ul) {
		list-style: disc;
		padding-left: 1.25rem;
		margin-bottom: 0.6rem;
	}
	.termo-conteudo :global(li) {
		margin-bottom: 0.2rem;
	}
	.termo-conteudo :global(code) {
		background: rgba(0, 0, 0, 0.05);
		padding: 0 0.25rem;
		border-radius: 4px;
	}
</style>
