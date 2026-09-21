<script lang="ts">
	/**
	 * A GAVETA de navegação inteira: marca, árvore de itens, tema, cartão do
	 * usuário e o botão de sair.
	 *
	 * **Nada aqui é gate de segurança.** Esconder um item não protege nada e
	 * mostrá-lo não libera nada — quem barra é o `load` de cada rota. A regra de
	 * QUEM VÊ O QUÊ mora em `menu-visibilidade.ts`, em `.ts` puro e com testes,
	 * justamente porque enquanto era markup ninguém conseguia verificá-la.
	 *
	 * Duas props só: a gaveta (`nav`, que carrega estado E modelo do menu — ver
	 * `navegacao-estado.svelte.ts`) e o pedido de logout, que sobe porque o
	 * diálogo é global e vive no layout. Todo o resto este componente lê de
	 * `page.data` sozinho.
	 *
	 * O tema e a alternância de MÓDULO ficam aqui, e não no layout, porque só
	 * são alcançáveis por dentro da gaveta: o `localStorage` do tema e o
	 * `switchingModule` não têm leitor fora deste arquivo.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { apiFetch } from '$lib/api-fetch';
	import { loading } from '$lib/loading.svelte';
	import { toaster } from '$lib/toast';
	import { mensagemDeErro } from '$lib/utils/erro';
	import { ICONE } from '$lib/constants/icones';
	import type { NavegacaoEstado } from './navegacao-estado.svelte';
	import { gruposHomeDaPagina } from './home-modulos';

	const { nav, onSair }: { nav: NavegacaoEstado; onSair: () => void } = $props();

	const usuario = $derived(nav.usuario);
	const flags = $derived(nav.flags);
	const giseOperacoesPathAtivo = $derived(
		page.url.pathname.startsWith('/operacoes/gise/operacoes')
	);
	const planosPathAtivo = $derived(page.url.pathname.startsWith('/operacoes/planos'));

	/**
	 * Os grupos que a HOME mostra a este usuário — a barra desenha o título de
	 * cada um (link para a tela do grupo) mesmo quando não há item de menu
	 * embaixo, porque o grupo pode ter só cartões planejados (o admin de
	 * unidade tem "Gestão operacional" com Armamento e Veículos "Em breve").
	 * Mesma fonte da home: título na barra ⇔ cartão grande no Início.
	 */
	const gruposDaHome = $derived(new Set(gruposHomeDaPagina(usuario, page.data).map((g) => g.id)));

	/**
	 * A métrica das linhas da barra, uma só para as três formas: item que navega,
	 * pai que abre o submenu e voltar para a raiz. Divergir aqui faria o submenu
	 * parecer outra tela em vez do mesmo menu.
	 */
	const CLASSE_ITEM =
		'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all no-underline border';
	const CLASSE_ACESO =
		'bg-primary-500/15 text-primary-700 dark:text-primary-400 border-primary-500/20';
	const CLASSE_APAGADO =
		'text-surface-600 dark:text-surface-300 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 border-transparent';

	let isDark = $state(
		typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true
	);

	function alternarTema() {
		isDark = !isDark;
		if (isDark) {
			document.documentElement.classList.add('dark');
			localStorage.setItem('color-theme', 'dark');
		} else {
			document.documentElement.classList.remove('dark');
			localStorage.setItem('color-theme', 'light');
		}
	}

	let alternandoModulo = $state(false);

	async function alternarModulo() {
		if (alternandoModulo) return;
		alternandoModulo = true;
		loading.show('Alternando módulo...');
		try {
			const result = await apiFetch<{ redirect?: string }>('/api/auth/alternar-modulo', {
				method: 'POST'
			});
			if (result.redirect) {
				await goto(result.redirect, { invalidateAll: true });
			}
		} catch (e: unknown) {
			toaster.create({ title: mensagemDeErro(e, 'Erro ao alternar módulo'), type: 'error' });
		} finally {
			alternandoModulo = false;
			loading.hide();
		}
	}
</script>

<!-- Backdrop (todas as larguras): clicar fora fecha. -->
{#if nav.aberta}
	<button
		type="button"
		class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm print:hidden"
		onclick={() => void nav.fechar()}
		aria-label="Fechar menu"
	></button>
{/if}

<aside
	class="
		fixed top-0 left-0 z-50 h-full
		bg-surface-50/95 dark:bg-surface-950/95 backdrop-blur-xl
		border-r border-surface-200 dark:border-white/10
		shadow-xl shadow-black/5 dark:shadow-black/30
		flex flex-col
		transition-transform duration-300 ease-in-out
		print:hidden
		{nav.aberta ? 'translate-x-0' : '-translate-x-full'}
	"
	style="width: var(--sidebar-width, 240px);"
	inert={nav.ehInerte}
	aria-hidden={nav.ehInerte}
>
	<!-- Logo -->
	<div class="h-16 flex items-center px-5 border-b border-surface-200 dark:border-white/5 shrink-0">
		<!-- A marca da gaveta é a corporação; o departamento e a unidade da
		     pessoa estão na barra do topo (`BarraTopo`), que tem espaço. -->
		<div class="flex items-center gap-2 group">
			<img src="/brasao-pcce.png" alt="" width="273" height="360" class="h-8 w-auto" />
			<span
				class="font-heading font-bold text-base text-surface-900 dark:text-surface-50 tracking-tight"
				>Ecossistema PCCE</span
			>
		</div>
		<button
			type="button"
			class="ml-auto p-1 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 transition-colors"
			onclick={() => void nav.fechar()}
			aria-label="Fechar menu"
		>
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M6 18L18 6M6 6l12 12"
				/></svg
			>
		</button>
	</div>

	<nav
		id="navegacao-principal"
		class="flex-1 px-3 py-4 space-y-1 overflow-y-auto"
		tabindex="-1"
		aria-label={nav.nivel === 'extra' ? 'Escala extra' : 'Menu principal'}
	>
		{#snippet iconeItem(paths: string[])}
			<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				{#each paths as d (d)}
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" {d} />
				{/each}
			</svg>
		{/snippet}

		<!--
			O pai é `<button>` e não `<a>`: ele não leva a lugar nenhum, e um link
			que não navega quebra "abrir em nova aba" e o clique do meio.

			NÃO chama `nav.aoNavegar()`: entrar no submenu não é navegar, e fechar a
			gaveta aqui desfaria o próprio clique.
		-->
		{#snippet itemPaiExtra(ativo: boolean)}
			<button
				id="menu-pai-extra"
				type="button"
				class="{CLASSE_ITEM} {ativo ? CLASSE_ACESO : CLASSE_APAGADO}"
				onclick={() => void nav.irParaNivel('extra')}
			>
				{@render iconeItem(ICONE.pranchetaLista)}
				<span class="truncate flex-1 text-left">Escala extra</span>
				{@render iconeItem(ICONE.chevronDireita)}
			</button>
		{/snippet}

		<!--
			Voltar do submenu. Não usa `BotaoVoltar`: aquele é de tela de detalhe,
			acima do `<h1>` (README §10). Aqui é linha de menu, e tem de ter a
			métrica das outras linhas.
		-->
		{#snippet itemVoltarMenu()}
			<button
				id="menu-voltar"
				type="button"
				class="{CLASSE_ITEM} {CLASSE_APAGADO}"
				onclick={() => void nav.irParaNivel('raiz')}
			>
				{@render iconeItem(ICONE.setaEsquerda)}
				<span class="truncate flex-1 text-left font-bold">Escala extra</span>
			</button>
		{/snippet}

		{#snippet itemMenu(
			href: string,
			rotulo: string,
			paths: string[],
			ativo?: boolean,
			badge?: number
		)}
			<a
				{href}
				data-sveltekit-preload-data="hover"
				class="{CLASSE_ITEM} {(ativo ?? nav.rotaEstaAtiva(href)) ? CLASSE_ACESO : CLASSE_APAGADO}"
				onclick={() => void nav.aoNavegar()}
			>
				{@render iconeItem(paths)}
				<span class="truncate flex-1 text-left">{rotulo}</span>
				{#if badge && badge > 0}
					<span
						class="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary-500 text-white text-3xs font-bold tabular-nums flex items-center justify-center"
						aria-label={`${badge} não lidos`}
					>
						{badge > 99 ? '99+' : badge}
					</span>
				{/if}
			</a>
		{/snippet}

		<!-- Título de grupo da barra dos perfis administrativos: o MESMO nome do
		     cartão grande do Início, e um link para a tela do grupo
		     (`/grupo/[id]`), para a barra e a home lerem como a mesma
		     organização. Realça quando a rota atual é a própria tela do grupo. -->
		{#snippet tituloGrupo(rotulo: string, grupoId: string)}
			<a
				href="/grupo/{grupoId}"
				data-sveltekit-preload-data="hover"
				class="!mt-4 mb-1 block px-3 text-3xs font-semibold tracking-[0.18em] uppercase no-underline transition-colors hover:text-primary-700 dark:hover:text-primary-400 {page
					.url.pathname === `/grupo/${grupoId}`
					? 'text-primary-700 dark:text-primary-400'
					: 'text-surface-500 dark:text-surface-500'}"
				onclick={() => void nav.aoNavegar()}
			>
				{rotulo}
			</a>
		{/snippet}

		{#if nav.nivel === 'extra'}
			<!--
				SUBMENU de "Escala extra". Substitui a barra inteira em vez de expandir
				dentro dela: cinco itens indentados sob um pai devolveriam a lista
				comprida que este agrupamento veio desfazer.

				Sem `{#if}` por item — `filhosExtra` já vem filtrado pelas MESMAS
				condições de antes, e é ele que decide se o pai chega a aparecer.
			-->
			{@render itemVoltarMenu()}
			<hr class="!my-3 border-surface-200 dark:border-white/10" />
			{#each nav.filhosExtra as filho (filho.href)}
				{@render itemMenu(filho.href, filho.rotulo, filho.icone, filho.ativo)}
			{/each}
		{:else if usuario?.tipo === 'colaborador'}
			<!-- Colaborador (terceira identidade): só a própria área. As funções
			     designadas no módulo de diárias acrescentam itens aqui quando
			     existirem; até lá a lista é esta, e o portão do hooks.server.ts
			     recusa qualquer outra rota. -->
			{@render itemMenu('/colaborador', 'Boas-vindas', ICONE.casa)}
		{:else if usuario?.isSuperAdmin}
			<!-- Super Admin: menu exclusivo — apenas estas 8 abas, nesta ordem.

			     "Valores de custo" é do Super Admin, e não do Admin Geral que monta
			     os planos, porque é a tabela de hora extra e diária da corporação:
			     quem planeja a operação escolhe QUANTAS horas, não QUANTO vale a
			     hora. -->
			{@render itemMenu('/super-admin', 'Boas-vindas', ICONE.casa)}
			{@render itemMenu('/unidades', 'Unidades', ICONE.predio)}
			{@render itemMenu('/servidores', 'Policiais', ICONE.pessoas)}
			{@render itemMenu('/colaboradores', 'Colaboradores', ICONE.pessoas)}
			{@render itemMenu('/conf-ass', 'Config. Ass.', ICONE.engrenagem)}
			{@render itemMenu('/config-geral', 'Config. Geral', ICONE.sliders)}
			{@render itemMenu('/valores', 'Valores', ICONE.barras)}
			{@render itemMenu('/auditoria', 'Auditoria', ICONE.documento)}
		{:else if usuario?.tipo === 'policial' && !usuario.papel}
			<!-- Policial sem papel: boas-vindas, o que houver de escala extra, perfil. -->
			{@render itemMenu('/bem-vindo', 'Boas-vindas', ICONE.casa)}
			{#if nav.filhosExtra.length > 0}
				{@render itemPaiExtra(nav.naRotaExtra)}
			{/if}
			<hr class="!my-3 border-surface-200 dark:border-white/10" />
			{@render itemMenu('/perfil', 'Meu perfil', ICONE.perfil)}
		{:else}
			<!--
				Perfis ADMINISTRATIVOS (Admin Geral, admin de seccional, admin de
				unidade): "Início" é a home de módulos, e a barra repete a organização
				dela em quatro grupos (decisão E39) — Gestão de pessoal · Gestão
				operacional · Gestão de unidade · Gestão administrativa. Um grupo sem
				item não desenha o título.

				`showGrupo1`/`showGrupo2` são o filtro de módulo do Admin Geral
				(GISE ↔ Escalas), que continua valendo na barra; a home não o usa.
			-->
			{@render itemMenu('/', 'Início', ICONE.casa, page.url.pathname === '/')}
			<!-- A caixa de avisos (E59): pendências e notícias, com o total no badge. -->
			{@render itemMenu('/avisos', 'Avisos', ICONE.sino, undefined, nav.avisosTotal)}

			<!-- Gestão de pessoal: servidores (os três papéis), a fila de quem
			     decide, e a escala ordinária — painel + caixa de entrada para o
			     Admin Geral, a lista de escalas para quem monta/assina. -->
			{#if gruposDaHome.has('pessoal')}
				{@render tituloGrupo('Gestão de pessoal', 'pessoal')}
			{/if}
			{#if flags.showPoliciais}
				{@render itemMenu('/servidores', 'Servidores', ICONE.pessoas)}
			{/if}
			{#if flags.showSolicitacoes}
				{@render itemMenu('/solicitacoes', 'Solicitações', ICONE.checkLista)}
			{/if}
			{#if flags.showValores}
				{@render itemMenu('/valores', 'Atualização de valores', ICONE.barras)}
			{/if}
			{#if flags.showGrupo1}
				{#if usuario?.tipo === 'admin'}
					{@render itemMenu('/painel', 'Painel', ICONE.painel)}
					{@render itemMenu(
						'/recebidos',
						'Cx. de Entrada',
						ICONE.caixaEntrada,
						undefined,
						nav.recebidosNaoVistos
					)}
				{/if}
				{#if flags.showEscalasPoliciais}
					{@render itemMenu('/escalas', 'Escalas ordinárias', ICONE.calendario)}
				{/if}
			{/if}

			<!--
				Gestão operacional: tudo o que é de ESCALA EXTRA atrás de um pai
				(a lista vive em `nav.filhosExtra`), mais o cadastro de operações e
				o plano operacional do Admin Geral.

				"Conf. GISE" e "Conf. Form." saíram do menu: o que editavam virou
				configuração POR OPERAÇÃO, nos botões de cada linha de /operacoes/gise/operacoes.
				O plano operacional NASCE em /operacoes/gise/operacoes, mas a lista precisa de
				entrada própria: sem ela, um plano já criado só se alcançaria pela URL.
			-->
			{#if gruposDaHome.has('operacional')}
				{@render tituloGrupo('Gestão operacional', 'operacional')}
			{/if}
			{#if flags.showGrupo2}
				{#if nav.filhosExtra.length > 0}
					{@render itemPaiExtra(nav.naRotaExtra)}
				{/if}
				{#if flags.showGise && usuario?.tipo === 'admin'}
					{@render itemMenu(
						'/operacoes/gise/operacoes',
						'Operações',
						ICONE.engrenagem,
						giseOperacoesPathAtivo
					)}
					{@render itemMenu(
						'/operacoes/planos',
						'Plano Op.',
						ICONE.pranchetaLista,
						planosPathAtivo
					)}
				{/if}
			{/if}

			<!-- Gestão de unidade: a própria subárvore, com o rótulo do nível. -->
			{#if gruposDaHome.has('unidade')}
				{@render tituloGrupo('Gestão de unidade', 'unidade')}
			{/if}
			{#if flags.showUnidade}
				{@render itemMenu(
					'/unidade',
					usuario?.tipo === 'admin'
						? 'Departamento'
						: usuario?.papel === 'admin_seccional'
							? 'Minha seccional'
							: 'Minha delegacia',
					ICONE.predio
				)}
			{/if}

			<!-- Administrativo: só o Admin Geral cria identidade de acesso —
			     administrar pessoa já cadastrada é outra coisa. -->
			{#if gruposDaHome.has('administrativa')}
				{@render tituloGrupo('Gestão administrativa', 'administrativa')}
			{/if}
			{#if flags.showColaboradores}
				{@render itemMenu('/colaboradores', 'Colaboradores', ICONE.pessoas)}
			{/if}
			{#if flags.showMunicipios}
				{@render itemMenu('/municipios', 'Municípios', ICONE.mapa)}
			{/if}

			<!-- Meu perfil (todo policial; sessão de admin não tem cadastro) -->
			{#if usuario?.tipo === 'policial'}
				<hr class="!my-3 border-surface-200 dark:border-white/10" />
				{@render itemMenu('/perfil', 'Meu perfil', ICONE.perfil)}
			{/if}
		{/if}
	</nav>

	<!-- Rodapé: tema, usuário, sair -->
	<div class="px-3 pb-4 space-y-3 border-t border-surface-200 dark:border-white/5 pt-4 shrink-0">
		<button
			type="button"
			class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-600 dark:text-surface-400 hover:bg-surface-200/50 dark:hover:bg-surface-800/50 transition-colors"
			onclick={alternarTema}
		>
			{#if isDark}
				<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
					/></svg
				>
				<span>Tema claro</span>
			{:else}
				<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
					/></svg
				>
				<span>Tema escuro</span>
			{/if}
		</button>

		{#if usuario?.nome}
			<div
				class="mx-1 mb-1 rounded-xl border border-surface-200/70 bg-surface-100/60 px-3 py-2.5 dark:border-white/5 dark:bg-surface-800/40"
			>
				<p
					class="truncate text-xs font-semibold leading-tight text-surface-900 dark:text-surface-100"
				>
					{usuario.nome}
				</p>
				{#if !usuario?.papel && !nav.isSupervisorGise && usuario?.lotacao}
					<p class="mt-0.5 truncate text-3xs text-surface-600 dark:text-surface-400">
						{usuario.lotacao}
					</p>
				{/if}

				<!-- Papéis / status -->
				{#if usuario?.tipo === 'admin' || usuario?.papel === 'admin_seccional' || usuario?.papel === 'admin_unidade' || nav.isSupervisorGise}
					<div class="mt-2 flex flex-wrap items-center gap-1.5">
						{#if usuario?.tipo === 'admin'}
							<span
								class="badge preset-filled-primary-500 text-3xs font-semibold uppercase tracking-wider"
							>
								{usuario?.isSuperAdmin
									? 'SUPER ADMIN'
									: nav.adminModulo === 'gise'
										? 'ADMIN GISE'
										: nav.adminModulo === 'escalas'
											? 'ADMIN ESCALAS'
											: 'ADMIN GERAL'}
							</span>
							{#if page.data.podeAlternarModulo}
								<button
									type="button"
									class="btn-icon btn-sm preset-outlined-surface-500 flex cursor-pointer items-center justify-center rounded-md p-1 transition-all"
									onclick={alternarModulo}
									title="Alternar módulo (GISE ↔ Escalas)"
									aria-label="Alternar módulo"
									disabled={alternandoModulo}
								>
									<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2.5"
											d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
										/>
									</svg>
								</button>
							{/if}
						{/if}
						{#if usuario?.papel === 'admin_seccional'}
							<span
								class="badge preset-filled-warning-500 text-3xs font-semibold uppercase tracking-wider"
								>ADM SECCIONAL</span
							>
						{/if}
						{#if usuario?.papel === 'admin_unidade'}
							<span
								class="badge preset-filled-tertiary-500 text-3xs font-semibold uppercase tracking-wider"
								>ADM UNIDADE</span
							>
						{/if}
						{#if nav.isSupervisorGise}
							<span
								class="badge preset-filled-success-500 text-3xs font-semibold uppercase tracking-wider"
								>SUPERVISOR GISE</span
							>
						{/if}
					</div>
				{/if}
			</div>
		{/if}

		<button
			type="button"
			class="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-surface-600 dark:text-surface-400 hover:bg-error-500/10 hover:text-error-600 dark:hover:text-error-400 transition-colors"
			onclick={onSair}
		>
			<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
				/></svg
			>
			Sair
		</button>
	</div>
</aside>
