<script lang="ts">
	/**
	 * Barra fixa do topo: botão que abre a gaveta, a marca e a alternância de
	 * ACESSO (Admin Geral ↔ usuário, quando é a mesma pessoa vinculada).
	 *
	 * Recebe só a gaveta — `podeAlternarPara*` vem de `page.data`, que este
	 * componente lê sozinho. A alternância de MÓDULO (GISE ↔ Escalas) NÃO está
	 * aqui: ela vive no cartão do usuário, no rodapé da gaveta, ao lado do badge
	 * que diz qual módulo está ativo.
	 *
	 * `inert` quando a gaveta está aberta: com o overlay por cima, esta barra
	 * não deve receber foco por Tab.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { apiFetch } from '$lib/api-fetch';
	import { apagarReauth } from '$lib/assinatura-reauth';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import { mensagemDeErro } from '$lib/utils/erro';
	import type { NavegacaoEstado } from './navegacao-estado.svelte';

	const { nav }: { nav: NavegacaoEstado } = $props();

	/**
	 * "Polícia Civil do Ceará - DPI SUL - seccional - delegacia": a corporação
	 * fixa e, depois, a trilha da unidade de quem está logado (do departamento
	 * até a unidade dele — `trilhaDaUnidade`, no `+layout.server.ts`). Quem
	 * está no departamento vê só até ele; quem não tem unidade (Super Admin,
	 * colaborador) vê só a corporação. Em tela estreita a trilha se resume ao
	 * ÚLTIMO nível, que é o que identifica a pessoa.
	 */
	const trilha = $derived((page.data.trilhaUnidade as string[] | undefined) ?? []);
	const ultimoNivel = $derived(trilha.at(-1) ?? null);

	const podeAlternarParaUsuario = $derived(page.data.podeAlternarParaUsuario ?? false);
	const podeAlternarParaAdmin = $derived(page.data.podeAlternarParaAdmin ?? false);

	let alternando = $state(false);

	async function alternarAcesso() {
		if (alternando) return;
		alternando = true;
		loading.show('Alternando acesso...');
		try {
			const result = await apiFetch<{ redirect?: string }>('/api/auth/alternar-acesso', {
				method: 'POST'
			});
			// Nova sessão (token novo), mesma aba: a janela de senha da assinatura
			// em `sessionStorage` sobreviveria à troca e pareceria válida — mesmo
			// não pertencendo a esta sessão. É o caso do Admin Geral vinculado
			// (supervisor) alternando para modo Usuário e vice-versa sem logout.
			apagarReauth();
			await goto(result.redirect || '/', { invalidateAll: true });
		} catch (e: unknown) {
			toaster.create({ title: mensagemDeErro(e, 'Erro ao alternar acesso'), type: 'error' });
		} finally {
			alternando = false;
			loading.hide();
		}
	}
</script>

<div
	class="fixed top-0 left-0 right-0 z-40 h-14 bg-white/90 dark:bg-surface-950/90 backdrop-blur-lg border-b border-surface-200 dark:border-white/10 flex items-center px-4 print:hidden"
	inert={nav.ehModal}
>
	<button
		type="button"
		class="p-2 -ml-2 text-surface-600 dark:text-surface-300 hover:text-primary-500 transition-colors"
		onclick={() => void nav.alternar()}
		aria-label="Menu"
		aria-expanded={nav.aberta}
		aria-controls="navegacao-principal"
		id="botao-menu-mobile"
	>
		<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M4 6h16M4 12h16M4 18h16"
			/>
		</svg>
	</button>
	<div class="ml-3 flex min-w-0 items-center gap-2.5">
		<img
			src="/brasao-pcce.png"
			alt=""
			width="273"
			height="360"
			class="h-8 w-auto shrink-0 drop-shadow-sm"
		/>
		<span
			class="font-heading hidden min-w-0 truncate text-base font-bold tracking-tight text-surface-900 sm:block dark:text-surface-50"
		>
			Polícia Civil do Ceará{#each trilha as nivel (nivel)}
				<span class="mx-1.5 font-normal text-surface-400 dark:text-surface-500">-</span
				>{nivel}{/each}
		</span>
		<span
			class="font-heading min-w-0 truncate text-base font-bold tracking-tight text-surface-900 sm:hidden dark:text-surface-50"
		>
			{ultimoNivel ?? 'Polícia Civil do Ceará'}
		</span>
	</div>
	{#if podeAlternarParaUsuario || podeAlternarParaAdmin}
		<button
			type="button"
			class="ml-auto shrink-0 truncate max-w-[11rem] sm:max-w-none rounded-lg border border-primary-500/40 bg-primary-500/5 px-2.5 sm:px-3 py-1.5 text-2xs sm:text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-500/15 disabled:opacity-50 dark:text-primary-300"
			onclick={alternarAcesso}
			title={podeAlternarParaUsuario
				? 'Entrar como usuário (mesma conta)'
				: 'Assumir acesso de Administrador Geral (mesma conta)'}
			disabled={alternando}
		>
			{podeAlternarParaUsuario ? 'Ir p/ modo usuário' : 'Ir p/ modo admin'}
		</button>
	{/if}
</div>
