<script lang="ts">
	/**
	 * Lista de ESCALAS GISE — porta de entrada do módulo.
	 *
	 * Lista as escalas ATIVAS (tudo que não está `finalizada`), em cards grandes
	 * com o andamento de cada uma. O arquivo das encerradas mora em
	 * `/operacoes/gise/finalizadas`, aba só do Admin Geral. Para os demais papéis esta
	 * página é um painel do que está acontecendo agora, não um arquivo.
	 *
	 * O que cada usuário recebe já vem filtrado pelo `load` (por vínculo:
	 * supervisor, membro, seccional participante) — esta tela não faz controle de
	 * acesso, só de apresentação.
	 *
	 * O botão Ass. Escala / Ass. Extra do card é atalho: abre a escala com
	 * `?assinar=` e dispara o mesmo fluxo de dentro (assinatura em tela no
	 * celular, token no computador). Não há um segundo caminho de assinatura
	 * nesta tela.
	 *
	 * Sem chips de papel sob o título — a sessão e o que a tela oferece já
	 * identificam o usuário; repetir "Adm Seccional" / "Membro" era decoração.
	 */
	import type { PageProps } from './$types';
	import Paginador from '$lib/components/Paginador.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CardGiseAtiva from './_components/CardGiseAtiva.svelte';
	import FiltroOperacaoGise from './_components/FiltroOperacaoGise.svelte';
	import ModalCriarGise from './_components/ModalCriarGise.svelte';
	import ModalDownloadExtras from '$lib/components/ModalDownloadExtras.svelte';
	import DialogInfo from './_components/DialogInfo.svelte';
	import { fmtDate, diaSemana } from '$lib/gise/formatters';
	import { escalaGiseJaAssinada } from '$lib/gise/status-escala';
	import {
		dialogoDownloadAssinado,
		dialogoDownloadNaoAssinado,
		type DialogoDownload
	} from '$lib/gise/mensagens-download';
	import { useInvalidateOnFocus, useMobile, useLarguraDesktop } from '$lib/composables';
	import { avancadaEmTelaDoLayout, mensagemConviteChave } from '$lib/chave-assinatura-ui';
	import { fetchSyncEstado } from '$lib/sync-estado';

	type GiseEscala = {
		id: number;
		status: string;
		data_inicio: string;
		hora_entrada: string;
		hora_saida: string;
		totalSeccionais: number;
		seccionaisEnviadas: number;
		extrasPendentes: number;
		extrasPendentesIds: number[];
		assinaturasRelatorioExtra?: number;
		assinaturasRelatorioExtraIds?: number[];
		supervisor_id?: number | null;
		assessor_id?: number | null;
		seint1_id?: number | null;
		seint2_id?: number | null;
		temSaidaConfirmada?: boolean;
		seccionais?: { id: number; tipos?: string[]; nome?: string }[];
		/** Operação da escala; `null` só em linha anterior à migração 0048. */
		operacao_id?: number | null;
	};

	const { data }: PageProps = $props();

	const escalas = $derived((data.escalas as GiseEscala[]) ?? []);
	const isAdminGeral = $derived(!!data.isGeral);
	const isSeccional = $derived(!!data.isSeccional);
	const isUnidade = $derived(!!data.isUnidade);
	const isSupervisor = $derived(!!data.isSupervisor);
	const isMembro = $derived(!!data.isMembro);

	/**
	 * Filtro por OPERAÇÃO — a razão de a aba não ser mais "Escalas GISE".
	 *
	 * A GISE virou uma operação entre várias (CRAJUBAR, EDGE…), que podem estar
	 * ativas ao mesmo tempo. Em vez de uma aba por operação, uma aba só com este
	 * recorte: sem ele a lista mistura escalas de operações diferentes, com
	 * formulários e metas diferentes, sem nada que as distinga.
	 *
	 * É filtro de LEITURA, aplicado no cliente sobre a lista que a tela já recebe
	 * inteira. O escopo de quem vê o quê continua no servidor.
	 */
	const operacoes = $derived(data.operacoes ?? []);
	let filtroOperacaoId = $state<number | null>(null);
	const nomeDaOperacao = $derived(new Map(operacoes.map((o) => [o.id, o.sigla || o.nome])));

	const escalasFiltradas = $derived(
		filtroOperacaoId === null ? escalas : escalas.filter((e) => e.operacao_id === filtroOperacaoId)
	);

	const ativas = $derived(escalasFiltradas.filter((e) => e.status !== 'finalizada'));

	useInvalidateOnFocus('app:gise-list', {
		isHot: () => ativas.length > 0,
		probe: async () => {
			try {
				const e = await fetchSyncEstado();
				return e.giseList?.stamp ?? null;
			} catch {
				return null;
			}
		}
	});

	const minhaSeccionalId = $derived(data.minhaSeccionalId ?? null);
	const supervisaoExtraUnidadeId = $derived(data.supervisaoExtraUnidadeId ?? null);
	// A listagem não carrega o assinante de cada documento; aproxima a regra de
	// `podeBaixarComManifesto` (escala GISE e rel. da supervisão são assinados
	// pelo supervisor): Admin Geral/Super, ou supervisor DPC. O servidor segue
	// sendo quem decide — quem não passa lá recebe a cópia de conferência.
	const podeManifestoProvavel = $derived(
		page.data.usuario?.tipo === 'admin' || (isSupervisor && page.data.usuario?.cargo === 'DPC')
	);

	// DUAS perguntas diferentes, e esta tela precisa das duas. Até ago/2026 um
	// `MediaQuery('(min-width: 768px)')` próprio respondia as duas ao mesmo
	// tempo — era a terceira definição de "é mobile?" do projeto, e a única que
	// sobreviveu à unificação de `useMobile` por não estar no escopo dela.
	//
	// `assinaViaToken` é sobre o APARELHO: o token A3 (SERPRO) é periférico de
	// computador. Precisa concordar com o `isMobile` de `/operacoes/gise/[id]`, que é
	// quem consome o `?via=` emitido aqui e cai no `useMobile` dele quando o
	// param falta. Enquanto eram predicados diferentes, esta tela mandava
	// `via=token` para um tablet que a tela de destino classificava como
	// celular.
	const mobile = useMobile();
	const assinaViaToken = $derived(!mobile.isMobile);
	// `larguraDesktop` é sobre a VIEWPORT, e só serve ao layout do card, onde
	// tem de bater com as classes `md:` dele.
	const viewport = useLarguraDesktop();
	const avancadaDisponivel = $derived(avancadaEmTelaDoLayout(page.data));

	// Duas colunas (`sm:grid-cols-2`) × três linhas na folha com altura mínima.
	const ITEMS_ATIVAS = 6;
	let paginaAtivas = $state(1);
	const totalPaginasAtivas = $derived(Math.max(1, Math.ceil(ativas.length / ITEMS_ATIVAS)));
	const paginaAtivasExibida = $derived(Math.min(paginaAtivas, totalPaginasAtivas));
	const ativasPaginadas = $derived(
		ativas.slice((paginaAtivasExibida - 1) * ITEMS_ATIVAS, paginaAtivasExibida * ITEMS_ATIVAS)
	);
	const mostraRodapeLista = $derived(
		isAdminGeral || isSeccional || isUnidade || isSupervisor || (ativas.length > 0 && !isMembro)
	);

	/**
	 * Troca o filtro e volta para a primeira página.
	 *
	 * As duas coisas juntas, e não num efeito: manter a página 3 numa lista que
	 * encolheu para caber numa página só mostra tela vazia com "página 3 de 1", e o reset
	 * pertence à ação que causou o encolhimento.
	 */
	function filtrarPorOperacao(id: number | null) {
		filtroOperacaoId = id;
		paginaAtivas = 1;
	}

	let menuExpandidoId = $state<number | null>(null);
	let showCriarModal = $state(false);

	// --- Download de Extras ---
	let showDownloadExtrasModal = $state(false);
	let giseParaDownloadExtras = $state<GiseEscala | null>(null);

	// --- Dialog informativo ---
	type DialogInfoType = {
		titulo: string;
		linhas: string[];
		acao?: { label: string; fn: () => void };
		acaoSecundaria?: { label: string; fn: () => void };
	};
	let dialogInfo = $state<DialogInfoType | null>(null);

	function iniciarAssinaturaEscala(ativa: (typeof ativas)[0]) {
		if (!assinaViaToken && !avancadaDisponivel) {
			dialogInfo = {
				titulo: 'Chave de assinatura',
				linhas: [mensagemConviteChave(true)],
				acao: { label: 'Ir para Meu Perfil', fn: () => goto('/perfil') }
			};
			return;
		}
		void goto(
			`/operacoes/gise/${ativa.id}?assinar=escala&via=${assinaViaToken ? 'token' : 'tela'}`
		);
	}

	function iniciarAssinaturaExtra(ativa: (typeof ativas)[0]) {
		if (!assinaViaToken && !avancadaDisponivel) {
			dialogInfo = {
				titulo: 'Chave de assinatura',
				linhas: [mensagemConviteChave(true)],
				acao: { label: 'Ir para Meu Perfil', fn: () => goto('/perfil') }
			};
			return;
		}
		void goto(`/operacoes/gise/${ativa.id}?assinar=extra&via=${assinaViaToken ? 'token' : 'tela'}`);
	}

	function clicarAssEscala(ativa: (typeof ativas)[0]) {
		if (ativa.status === 'aguardando_assinatura') {
			iniciarAssinaturaEscala(ativa);
			return;
		}
		let linhas: string[];
		if (ativa.status === 'em_definicao_supervisor') {
			linhas = [
				'O supervisor ainda não foi definido para esta escala.',
				'Aguarde a definição para liberar a assinatura.'
			];
		} else if (ativa.status === 'em_preenchimento') {
			const faltam = ativa.totalSeccionais - ativa.seccionaisEnviadas;
			linhas = [
				`Faltam ${faltam} de ${ativa.totalSeccionais} seccional(is) enviarem seus relatórios.`,
				'A assinatura será liberada quando todas as seccionais concluírem o envio.'
			];
		} else if (escalaGiseJaAssinada(ativa.status)) {
			dialogInfo = {
				titulo: 'Escala Assinada',
				linhas: [
					'Esta escala já foi assinada digitalmente.',
					'Para fazer o download do PDF oficial, clique no botão "Opções" do card desta escala e selecione "Escala PDF".'
				]
			};
			return;
		} else {
			linhas = ['A assinatura da escala não está disponível no momento.'];
		}
		dialogInfo = { titulo: 'Ass. Escala — Indisponível', linhas };
	}

	function clicarAssExtra(ativa: (typeof ativas)[0]) {
		const temSupervisao = !!(
			ativa.supervisor_id ||
			ativa.assessor_id ||
			ativa.seint1_id ||
			ativa.seint2_id
		);
		const totalExtras = ativa.totalSeccionais + (temSupervisao ? 1 : 0);
		const prontos = ativa.extrasPendentes;

		if (prontos > 0) {
			const jaAssinados = ativa.assinaturasRelatorioExtra ?? 0;
			const ainda = totalExtras - prontos - jaAssinados;
			const linhas: string[] = [
				`Serão assinados ${prontos} relatório(s) de extra que já estão prontos.`,
				...(ainda > 0 ? [`Ainda faltam ${ainda} relatório(s) com saída não confirmada.`] : []),
				...(jaAssinados > 0
					? [`${jaAssinados} relatório(s) já foram assinados anteriormente.`]
					: [])
			];
			dialogInfo = {
				titulo: `Ass. Extra (${prontos}/${totalExtras})`,
				linhas,
				acao: {
					label: `Assinar ${prontos} relatório(s)`,
					fn: () => {
						dialogInfo = null;
						iniciarAssinaturaExtra(ativa);
					}
				}
			};
			return;
		}

		let linhas: string[];
		const jaAssinados = ativa.assinaturasRelatorioExtra ?? 0;
		if (jaAssinados >= totalExtras) {
			linhas = ['Todos os relatórios de extra já foram assinados.'];
		} else if (!ativa.temSaidaConfirmada) {
			linhas = [
				'Nenhuma saída foi confirmada ainda.',
				'Os relatórios de extra só ficam disponíveis após a confirmação de saída de cada policial.'
			];
		} else {
			const pendSaida = totalExtras - jaAssinados;
			linhas = [
				`${pendSaida} relatório(s) ainda aguardam confirmação de saída dos policiais.`,
				'Acompanhe o andamento na página de detalhes da escala.'
			];
		}
		dialogInfo = { titulo: `Ass. Extra (0/${totalExtras})`, linhas };
	}

	/**
	 * Veste o descritor de `$lib/gise/mensagens-download` com o estado desta
	 * tela: fechar o diálogo e abrir a URL. O módulo é puro de propósito — só
	 * aqui existe `dialogInfo` para zerar.
	 */
	function mostrarDialogoDownload(d: DialogoDownload) {
		const abrir = (url: string) => () => {
			dialogInfo = null;
			window.open(url, '_blank');
		};
		dialogInfo = {
			titulo: d.titulo,
			linhas: d.linhas,
			acao: { label: d.principal.label, fn: abrir(d.principal.url) },
			...(d.secundaria
				? { acaoSecundaria: { label: d.secundaria.label, fn: abrir(d.secundaria.url) } }
				: {})
		};
	}

	function handleEscalaPdf(ativa: (typeof ativas)[0]) {
		const url = `/api/gise/${ativa.id}/download?format=pdf`;
		mostrarDialogoDownload(
			escalaGiseJaAssinada(ativa.status)
				? dialogoDownloadAssinado({
						documento: 'escala',
						url,
						urlComManifesto: `${url}&manifesto=true`,
						podeManifesto: podeManifestoProvavel
					})
				: dialogoDownloadNaoAssinado({ documento: 'escala', url })
		);
	}

	function handleExtraPdf(ativa: GiseEscala) {
		if (isAdminGeral && !isSupervisor && !isSeccional) {
			giseParaDownloadExtras = ativa;
			showDownloadExtrasModal = true;
			return;
		}

		// Supervisão extra e seccional são o MESMO diálogo com outro id na URL —
		// eram duas cópias idênticas até ago/2026. O que muda é só de quem é o
		// relatório que este usuário alcança daqui.
		// `??` e não ternário aninhado: quem é supervisor E seccional, mas está sem
		// `supervisaoExtraUnidadeId`, CAI para o relatório da seccional dele — era
		// o encadeamento de `if`s do código anterior, e um ternário puro pelo
		// primeiro papel devolveria "indisponível" a quem tem o que baixar.
		const seccionalId =
			(isSupervisor ? supervisaoExtraUnidadeId : null) ?? (isSeccional ? minhaSeccionalId : null);

		if (seccionalId === null) {
			dialogInfo = {
				titulo: 'Extra PDF — Indisponível',
				linhas: [
					'Não foi possível determinar qual relatório baixar. Entre na escala para acessar os relatórios.'
				]
			};
			return;
		}

		const url = `/api/gise/${ativa.id}/download?format=extraordinario&seccionalId=${seccionalId}`;
		const assinado = !!ativa.assinaturasRelatorioExtraIds?.includes(seccionalId);

		mostrarDialogoDownload(
			assinado
				? dialogoDownloadAssinado({
						documento: 'relatorioExtra',
						url,
						urlComManifesto: `${url}&manifesto=true`,
						podeManifesto: podeManifestoProvavel
					})
				: dialogoDownloadNaoAssinado({ documento: 'relatorioExtra', url })
		);
	}
</script>

<svelte:head>
	<title>Escala extra | Ecossistema PCCE</title>
</svelte:head>

<!-- A folha desta tela é curta com poucas escalas. Sem altura mínima ela
     colava no topo; o `calc` desconta topbar (`pt-20`) e as margens do
     `<main>` (`pb-12`, e em `xl` o padding da folha). O título permanece
     no lugar de sempre; o rodapé de página ancora o pé da folha. -->
<div
	class="flex min-h-[calc(100dvh-8rem)] min-w-0 flex-col gap-6 xl:min-h-[calc(100dvh-11rem)] print:min-h-0"
>
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
		<h1 class="h1 min-w-0 text-2xl font-bold">Escala extra</h1>

		{#if isAdminGeral}
			<button
				type="button"
				class="btn shrink-0 w-full sm:w-auto preset-filled-primary-500 px-4 py-2 text-sm font-semibold transition-all rounded-xl"
				onclick={() => (showCriarModal = true)}
			>
				Nova escala
			</button>
		{/if}
	</div>

	{#if isMembro && !isAdminGeral && !isSeccional && !isUnidade && !isSupervisor}
		<div
			class="rounded-2xl border border-primary-500/20 bg-primary-500/5 dark:bg-primary-500/10 p-4 sm:p-6 text-center space-y-2"
		>
			<p class="text-base font-semibold text-surface-900 dark:text-surface-100">
				Você está escalado na GISE
			</p>
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Os formulários de produtividade estarão disponíveis nesta área.
			</p>
			{#if ativas.length > 0}
				<div class="mt-2 space-y-1">
					{#each ativas as ativa (ativa.id)}
						<p class="text-xs text-surface-600 dark:text-surface-400">
							Escala vigente: <span class="font-medium"
								>{diaSemana(ativa.data_inicio)}
								{fmtDate(ativa.data_inicio)}</span
							>
						</p>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<FiltroOperacaoGise {operacoes} value={filtroOperacaoId} onChange={filtrarPorOperacao} />

	{#if ativas.length > 0 && (isAdminGeral || isSeccional || isUnidade || isSupervisor || !isMembro)}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{#each ativasPaginadas as ativa (ativa.id)}
				<CardGiseAtiva
					{ativa}
					operacaoNome={ativa.operacao_id ? (nomeDaOperacao.get(ativa.operacao_id) ?? '') : ''}
					{isSupervisor}
					{assinaViaToken}
					larguraDesktop={viewport.desktop}
					usuario={data.usuario}
					{menuExpandidoId}
					onAssEscala={() => clicarAssEscala(ativa)}
					onAssExtra={() => clicarAssExtra(ativa)}
					onEscalaPdf={() => handleEscalaPdf(ativa)}
					onExtraPdf={() => handleExtraPdf(ativa)}
					onToggleMenu={() => (menuExpandidoId = menuExpandidoId === ativa.id ? null : ativa.id)}
				/>
			{/each}
		</div>
	{:else if isAdminGeral || isSeccional || isUnidade || isSupervisor}
		<div
			class="rounded-2xl border border-dashed border-surface-300 dark:border-surface-700 p-4 sm:p-6 text-center"
		>
			<p class="text-surface-600 dark:text-surface-400">Nenhuma escala GISE ativa no momento.</p>
		</div>
	{/if}

	{#if mostraRodapeLista}
		<div
			class="mt-auto pt-6 border-t border-surface-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4"
		>
			<span class="text-xs text-surface-600 dark:text-surface-400 px-1">
				{ativas.length} escalas ativas — página {paginaAtivasExibida} de {totalPaginasAtivas}
			</span>
			<Paginador
				count={Math.max(ativas.length, 1)}
				pageSize={ITEMS_ATIVAS}
				page={paginaAtivasExibida}
				onPageChange={(p) => (paginaAtivas = p)}
			/>
		</div>
	{/if}
</div>

<ModalCriarGise
	bind:open={showCriarModal}
	{escalas}
	operacoes={operacoes.filter((o) => o.ativo)}
	onSuccess={(count, firstId) => {
		if (count === 1 && firstId) goto(`/operacoes/gise/${firstId}?edit=true`);
	}}
/>

<ModalDownloadExtras
	bind:open={showDownloadExtrasModal}
	gise={giseParaDownloadExtras}
	supervisaoExtraUnidadeId={data.supervisaoExtraUnidadeId}
	podeManifesto={podeManifestoProvavel}
/>

<DialogInfo {dialogInfo} onClose={() => (dialogInfo = null)} />
