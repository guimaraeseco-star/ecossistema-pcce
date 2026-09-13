<script lang="ts">
	/**
	 * Casca de toda página autenticada — o que sobra depois que a navegação saiu.
	 *
	 * Este arquivo cuida só do CHROME global: barra de progresso de navegação,
	 * banner de versão nova, overlay de carregamento, provedor de Toast, o
	 * diálogo de logout e o `<main>`. As peças que ele monta:
	 *
	 *   - `_components/BarraTopo.svelte` — topo + alternância de acesso;
	 *   - `_components/SidebarNavegacao.svelte` — a gaveta inteira;
	 *   - `_components/navegacao-estado.svelte.ts` — estado da gaveta + modelo do
	 *     menu, compartilhado pelos dois acima;
	 *   - `_components/menu-visibilidade.ts` — QUEM vê cada item, com testes;
	 *   - `_components/ToastProvider.svelte` — o `Toast.Group` estilizado.
	 *
	 * O corte levou o ESTADO junto com o markup, e não só o markup: a gaveta
	 * inteira depende de ~18 valores, e descê-los por props teria produzido o
	 * repassador que a auditoria de 13/ago/2026 catalogou em `GiseSupervisao`
	 * (encolheu 88% e virou 38 props). `SidebarNavegacao` tem DUAS props porque
	 * o resto ele lê de `page.data`, igual este arquivo lia.
	 *
	 * **Nada aqui é gate de segurança** — a sidebar apenas ESCONDE o que o
	 * usuário não usa; quem barra é o `load` de cada rota.
	 *
	 * `ROTAS_SEM_SIDEBAR` são os PORTÕES — login, troca de senha obrigatória e
	 * aceite do termo. `/aceitar-termo` é autenticado e por isso precisa estar
	 * listado à mão, senão a sidebar aparece atrás do card de aceite.
	 *
	 * Três armadilhas de navegação já resolvidas aqui, invisíveis em teste
	 * unitário: o `tick()` antes de `startViewTransition` (sem ele a barra de
	 * progresso é fotografada ainda em `opacity:0` e nunca aparece); o
	 * `afterNavigate(() => loading.hide())`, que solta o overlay quando um
	 * `loading.show()` anterior a um `goto` ficaria preso pedindo refresh; e
	 * pular o view-transition na troca de chrome do portão (login/senha/termo),
	 * que deixava `$derived` do Skeleton inertes (`derived_inert`).
	 */
	import type { LayoutProps } from './$types';
	import '../app.css';
	// Preload das duas fontes críticas acima da dobra (corpo + títulos): sem
	// isto o browser só descobre os woff2 após baixar e parsear o CSS, e o
	// texto pisca no swap. O ?url resolve para o MESMO asset hasheado que o
	// @font-face do app.css referencia — um download só. Demais pesos seguem
	// sob demanda via @fontsource.
	import inter400Url from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
	import outfit700Url from '@fontsource/outfit/files/outfit-latin-700-normal.woff2?url';
	import { tick } from 'svelte';
	import { page, navigating, updated } from '$app/state';
	import { goto, onNavigate, afterNavigate, beforeNavigate } from '$app/navigation';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { apiFetch } from '$lib/api-fetch';
	import { apagarReauth } from '$lib/assinatura-reauth';
	import { loading } from '$lib/loading.svelte';
	import LoadingOverlay from '$lib/components/LoadingOverlay.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { useScrollLock, useInvalidateOnFocus } from '$lib/composables';
	import { fetchSyncEstado } from '$lib/sync-estado';
	import BarraTopo from './_components/BarraTopo.svelte';
	import SidebarNavegacao from './_components/SidebarNavegacao.svelte';
	import ToastProvider from './_components/ToastProvider.svelte';
	import { criarNavegacaoEstado, ROTAS_SEM_SIDEBAR } from './_components/navegacao-estado.svelte';

	const { children }: LayoutProps = $props();

	const usuario = $derived(page.data.usuario);

	const nav = criarNavegacaoEstado();

	// Badge da Cx. de Entrada: poll frio em qualquer rota (admin). A inbox tem
	// poll próprio quente/frio; as duas chaves ficam alinhadas via `also`.
	useInvalidateOnFocus('app:recebidos-badge', {
		isHot: () => false,
		probe: async () => {
			if (usuario?.tipo !== 'admin') return null;
			try {
				const e = await fetchSyncEstado();
				return e.recebidos?.stamp ?? null;
			} catch {
				return null;
			}
		}
	});

	const showSidebar = $derived(!ROTAS_SEM_SIDEBAR.includes(page.url.pathname));

	let showLogoutConfirm = $state(false);
	let isLoggingOut = $state(false);

	useScrollLock(() => nav.ehModal);

	function closeOnEscape(event: KeyboardEvent) {
		if (event.key === 'Escape' && nav.ehModal) {
			event.preventDefault();
			void nav.fechar();
		}
	}

	async function logout() {
		isLoggingOut = true;
		try {
			await apiFetch('/api/auth/logout', { method: 'POST' });
		} catch {
			/* ignora erros de rede — o redirecionamento ocorre de qualquer forma */
		}

		// Limpa filtros salvos no localStorage ao deslogar
		if (typeof localStorage !== 'undefined') {
			const keysToRemove = [];
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key?.startsWith('filtros_')) {
					keysToRemove.push(key);
				}
			}
			keysToRemove.forEach((k) => localStorage.removeItem(k));
		}

		// Janela de senha da assinatura fica em `sessionStorage`, que sobrevive à
		// troca de conta na MESMA aba (logout+login em seguida). Sem isto, quem
		// loga como outra pessoa herda um id que ainda parece válido no cliente
		// (formato + prazo ok) mas pertence à sessão anterior — o pad pula
		// direto para o 2FA achando que a senha já foi confirmada, e o servidor
		// recusa por sessão/usuário divergente.
		apagarReauth();

		try {
			// invalidateAll separado causava duas navegações conflitantes (AbortError na view transition).
			// goto com invalidateAll:true faz tudo numa única navegação.
			await goto('/login', { invalidateAll: true });
		} finally {
			// O layout raiz persiste entre navegações — resetar aqui garante que o
			// modal de logout não reapareça ao fazer login novamente.
			showLogoutConfirm = false;
			isLoggingOut = false;
		}
	}

	onNavigate((navigation) => {
		if (nav.aberta) {
			void nav.fechar({ aposNavegacao: true });
		}
		// Portão (login / senha / termo) ↔ sessão (sidebar): o chrome inteiro
		// troca. O view-transition deixava a árvore antiga INERT enquanto o
		// `page` global já tinha mudado, e os `$derived` do Skeleton (Progress
		// do overlay, Tabs do login) disparavam `derived_inert`.
		const de = navigation.from?.url.pathname ?? '';
		const para = navigation.to?.url.pathname ?? '';
		if (
			!document.startViewTransition ||
			ROTAS_SEM_SIDEBAR.includes(de) ||
			ROTAS_SEM_SIDEBAR.includes(para)
		) {
			return;
		}
		// await tick() flushes Svelte's pending DOM updates (e.g. nav-progress-visible)
		// BEFORE startViewTransition captures the old-state screenshot. Without this,
		// the progress bar is still opacity:0 in the snapshot and never appears.
		// Aguarda tick() ANTES de iniciar a transição; evita o async-executor
		// (new Promise(async …)), que engoliria eventuais rejeições.
		return tick().then(
			() =>
				new Promise<void>((resolve) => {
					document.startViewTransition(async () => {
						resolve();
						await navigation.complete;
					});
				})
		);
	});

	// Fecha o overlay global de carregamento quando QUALQUER navegação termina.
	// Sem isto, `loading.show()` chamado antes de um goto() (ex.: /validar) ficava
	// preso, exigindo refresh para ver o resultado já renderizado por baixo.
	afterNavigate(() => {
		loading.hide();
		void nav.devolverFocoSePendente();
	});

	// Deploy novo detectado: força reload na próxima navegação (bundle fresco).
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) {
			location.href = to.url.href;
		}
	});
</script>

<svelte:window onkeydown={closeOnEscape} />

<svelte:head>
	<!-- crossorigin é obrigatório em preload de fonte (fetch em modo CORS
	     mesmo same-origin); sem ele o browser baixa o arquivo duas vezes. -->
	<link rel="preload" href={inter400Url} as="font" type="font/woff2" crossorigin="anonymous" />
	<link rel="preload" href={outfit700Url} as="font" type="font/woff2" crossorigin="anonymous" />
	<title>Ecossistema PCCE</title>
	<meta
		name="description"
		content="Portal de Gestão de Escalas e Relatórios GISE - Polícia Civil."
	/>
	<meta property="og:title" content="Ecossistema PCCE" />
	<meta
		property="og:description"
		content="Acompanhe escalas de plantão e documente relatórios de inteligência na plataforma unificada da Polícia Civil."
	/>
	<meta property="og:type" content="website" />
</svelte:head>

<!-- Navigation progress bar — always in DOM so view-transition captures it at full opacity -->
<div
	class="nav-progress-wrap"
	class:nav-progress-visible={navigating?.to &&
		!ROTAS_SEM_SIDEBAR.includes(navigating.to.url.pathname)}
	aria-hidden="true"
>
	<div class="nav-progress-bar"></div>
</div>

{#if updated.current && showSidebar}
	<div
		class="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-3 bg-warning-500 px-4 py-2 text-sm font-semibold text-surface-950 shadow-md"
		role="status"
	>
		<span class="text-center">Nova versão do sistema disponível.</span>
		<button
			type="button"
			class="rounded-lg bg-surface-950/15 px-3 py-1 text-xs font-bold uppercase tracking-wide hover:bg-surface-950/25"
			onclick={() => location.reload()}
		>
			Atualizar agora
		</button>
	</div>
{/if}

<!-- Global Loading Overlay — only for API operations (signing, saving). Page navigation uses the top progress bar + inline skeletons. -->
<!-- offsetSidebar=false: a gaveta é overlay (não reserva espaço), então o overlay
     de carregamento centraliza na viewport inteira. -->
<LoadingOverlay active={loading.active} message={loading.message} offsetSidebar={false} />

<ToastProvider />

<a
	href="#conteudo-principal"
	class="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[10001] focus:rounded-lg focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
	inert={nav.ehModal}
>
	Pular para o conteúdo
</a>

{#if showSidebar && usuario}
	<BarraTopo {nav} />
	<SidebarNavegacao {nav} onSair={() => (showLogoutConfirm = true)} />

	<!--
		Exceção deliberada ao ModalShell: o logout é um diálogo global z-[100],
		com estado de redirecionamento e ações verticais próprias do shell da
		aplicação. Mantê-lo aqui evita transformar o primitive em um segundo layout.
	-->
	<Dialog
		open={showLogoutConfirm}
		onOpenChange={(e) => {
			if (!e.open && !isLoggingOut) showLogoutConfirm = false;
		}}
	>
		<Dialog.Content
			class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
		>
			<div class="w-full max-w-sm rounded-2xl card-elevated shadow-2xl p-6 space-y-6">
				<div class="flex flex-col items-center text-center space-y-2">
					<Dialog.Title class="text-xl font-bold text-surface-900 dark:text-surface-50">
						{isLoggingOut ? 'Encerrando sessão...' : 'Sair do Sistema'}
					</Dialog.Title>
					<Dialog.Description class="text-sm text-surface-600 dark:text-surface-400">
						{isLoggingOut
							? 'Aguarde, você será redirecionado em instantes.'
							: 'Deseja realmente encerrar sua sessão?'}
					</Dialog.Description>
				</div>
				<div class="flex flex-col gap-2">
					<button
						type="button"
						class="btn preset-filled-error-500 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
						onclick={logout}
						disabled={isLoggingOut}
					>
						{#if isLoggingOut}
							<Spinner size="sm" />
							Saindo...
						{:else}
							Sim, Sair
						{/if}
					</button>
					<button
						type="button"
						class="btn preset-outlined-surface-500 py-3 rounded-xl font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
						onclick={() => (showLogoutConfirm = false)}
						disabled={isLoggingOut}
					>
						Cancelar
					</button>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<!-- Conteúdo principal: gaveta é overlay (não empurra). `pt-20` reserva a
	     topbar fixa. Em xl+ o wrapper vira "folha" (borda + bg-white +
	     rounded-2xl — teste visual 07/ago/2026).
	     No PAPEL a topbar não existe (`print:hidden` nela), então o `pt-20` viraria
	     uma faixa em branco no alto de toda impressão; a margem da folha é do
	     `@page`, não do wrapper. -->
	<main
		id="conteudo-principal"
		class="min-h-screen relative print:min-h-0"
		inert={nav.ehModal}
		aria-hidden={nav.ehModal}
	>
		<div
			class="max-w-6xl mx-auto min-w-0 px-4 sm:px-6 lg:px-8 pt-20 pb-12 print:max-w-none print:px-0 print:pt-0 print:pb-0 transition-opacity duration-200 {navigating?.to &&
			navigating.to.url.pathname !== page.url.pathname
				? 'opacity-40 pointer-events-none'
				: ''}"
		>
			<div
				class="min-w-0 xl:border xl:border-surface-200/80 dark:xl:border-white/10 xl:bg-white dark:xl:bg-surface-900 xl:rounded-2xl xl:px-6 xl:py-6 print:border-0 print:bg-white print:p-0"
			>
				{@render children()}
			</div>
		</div>
	</main>
{:else}
	<!-- No sidebar: login / alterar-senha -->
	<main id="conteudo-principal">
		{@render children()}
	</main>
{/if}

<style>
	:root {
		/* Gaveta de navegação (overlay em qualquer viewport): largura fixa e legível. */
		--sidebar-width: 240px;
	}

	@media (prefers-reduced-motion: no-preference) {
		::view-transition-old(root) {
			animation: 180ms linear both vt-fade-out;
		}
		::view-transition-new(root) {
			animation: 180ms linear both vt-fade-in;
		}
		@keyframes vt-fade-out {
			to {
				opacity: 0;
			}
		}
		@keyframes vt-fade-in {
			from {
				opacity: 0;
			}
		}
	}

	.nav-progress-wrap {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		z-index: 10000;
		pointer-events: none;
		overflow: hidden;
		opacity: 0;
		/* Give it its own view-transition name so it is excluded from the
		   root cross-fade (which starts at opacity:0 and would hide the bar) */
		view-transition-name: nav-progress;
	}
	.nav-progress-visible {
		opacity: 1;
		background: color-mix(in oklch, var(--color-primary-500) 25%, transparent);
	}
	.nav-progress-bar {
		height: 100%;
		width: 40%;
		background: linear-gradient(90deg, var(--color-primary-500), var(--color-secondary-500));
		border-radius: 999px;
		animation: nav-progress 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}
	@keyframes nav-progress {
		0% {
			transform: translateX(-120%);
		}
		100% {
			transform: translateX(350%);
		}
	}
	/* Opt the progress bar out of the root cross-fade entirely */
	::view-transition-old(nav-progress),
	::view-transition-new(nav-progress) {
		animation: none;
	}
</style>
