<script lang="ts">
	/**
	 * Tela de uma ESCALA GISE — a mais densa do sistema, porque reúne num só
	 * lugar as visões de quatro papéis diferentes sobre o mesmo documento:
	 * Admin Geral (monta e finaliza), admin de seccional (preenche a sua),
	 * supervisor DPC (assina) e observador (só lê).
	 *
	 * A página é sobretudo COMPOSIÇÃO. A lógica mora em três composables, e é
	 * assim que se mantém legível apesar do tamanho:
	 *
	 * - `useGiseEstado` — permissões, formatação e derivações (`podeEditar`,
	 *   `editaBloqueado`, `todasSeccionaisPreenchidas`);
	 * - `useGiseAssinatura` — todos os fluxos de assinatura (em tela, token
	 *   SERPRO, lote de relatórios);
	 * - `makeEnhanceHandler` — o padrão dos ~30 forms (pending → invalidate →
	 *   toast → reset).
	 *
	 * O resto são os componentes de cada bloco (`GiseCabecalho`,
	 * `GiseSupervisao`, `GiseSeccional`, os modais) e o estado de UI que precisa
	 * viver aqui por ser compartilhado entre eles.
	 *
	 * Duas coisas que não se deduzem do markup:
	 *
	 * - a chave de invalidação é `'gise:detail'`, e não `invalidateAll()`: quase
	 *   toda ação muda a árvore da GISE e precisa recarregá-la, mas recarregar o
	 *   layout inteiro a cada clique piscava a sidebar;
	 * - `useInvalidateOnFocus('gise:detail')` cobre o gap cross-user leve
	 *   (outra sessão preenche presença/relatório/assinatura): refetch ao
	 *   voltar à aba + poll quente/frio; BroadcastChannel sincroniza outras
	 *   abas do mesmo browser na hora da mutação;
	 * - o "quadro de supervisão" é tratado como uma pseudo-seccional (a unidade
	 *   sintética de supervisão extra), e por isso aparece nas mesmas listas de
	 *   pendência e assinatura das seccionais de verdade.
	 */
	import { goto, replaceState, afterNavigate } from '$app/navigation';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import { untrack, tick } from 'svelte';
	import { toaster } from '$lib/toast';
	import { enhance } from '$app/forms';
	import { useGiseEstado, useGiseAssinatura } from '$lib/composables/gise';
	import { escalaGiseJaAssinada } from '$lib/gise/status-escala';
	import { useInvalidateOnFocus } from '$lib/composables';
	import { fetchSyncEstado } from '$lib/sync-estado';
	import { loading } from '$lib/loading.svelte';
	import type { Policial, GiseAssinaturaRelatorio } from '$lib/server/schema';
	import { checkAllSigned, filtrarSeccionaisDisponiveis } from '$lib/gise/page-helpers';
	import { podeBaixarComManifesto } from '$lib/manifesto';
	import {
		quadroSupervisaoExtraExigeRelatorio,
		supervisaoExtraPresencasCompletas
	} from '$lib/gise/supervisao-extra';
	import { makeEnhanceHandler } from '$lib/enhance-handler';
	import { avancadaEmTelaDoLayout } from '$lib/chave-assinatura-ui';
	import GiseCabecalho from './_components/GiseCabecalho.svelte';
	import GiseSupervisao from './_components/GiseSupervisao.svelte';
	import { publicarQuadroSupervisao } from './_components/supervisao/quadro-supervisao-estado.svelte';
	import GiseLoteAssinaturas from './_components/GiseLoteAssinaturas.svelte';
	import GiseStatusAvisos from './_components/GiseStatusAvisos.svelte';
	import GiseSeccional from './_components/GiseSeccional.svelte';
	import ModalExcluirGise from './_components/modais/ModalExcluirGise.svelte';
	import ModalReabrir from './_components/modais/ModalReabrir.svelte';
	import ModalFinalizar from './_components/modais/ModalFinalizar.svelte';
	import ModalDatasHoras from './_components/modais/ModalDatasHoras.svelte';
	import ModalAssinaturaAvancada from '$lib/components/ModalAssinaturaAvancada.svelte';
	import ModalRelatorioDigital from './_components/modais/ModalRelatorioDigital.svelte';
	import ModalBreveRelatorio from './_components/modais/ModalBreveRelatorio.svelte';
	import ModalDownloadExtras from '$lib/components/ModalDownloadExtras.svelte';

	const { data }: PageProps = $props();

	// Hook de estados derivados e permissões
	const giseEstado = useGiseEstado({ getData: () => data });
	const isAdminGeral = $derived(giseEstado.isAdminGeral);
	const isSeccional = $derived(giseEstado.isSeccional);
	const isSupervisor = $derived(giseEstado.isSupervisor);
	const minhaSeccional = $derived(giseEstado.minhaSeccional);
	const minhaSeccionalId = $derived(giseEstado.minhaSeccionalId);
	const todasSeccionaisPreenchidas = $derived(giseEstado.todasSeccionaisPreenchidas);
	const editaBloqueado = $derived(giseEstado.editaBloqueado);
	const podeDownload = $derived(giseEstado.podeDownload);
	const podeEditar = $derived(giseEstado.podeEditar);
	const isMobile = $derived(giseEstado.isMobile);
	const { statusLabel, fmtDate, diaSemana } = giseEstado;

	const gise = $derived(giseEstado.gise);

	// Outras sessões / abas: foco + broadcast + poll (30s quente / 120s frio).
	// Probe: carimbo leve — só refetch completo se a GISE mudou no servidor.
	useInvalidateOnFocus('gise:detail', {
		isHot: () => Boolean(gise?.status && gise.status !== 'finalizada'),
		probe: async () => {
			const id = gise?.id;
			if (!id) return null;
			try {
				const e = await fetchSyncEstado({ giseId: id });
				const stamp = e.gise?.stamp;
				return stamp ? `${id}:${stamp}` : null;
			} catch {
				return null;
			}
		}
	});
	const policiais = $derived(data.policiais as Policial[]);
	const todasUnidades = $derived(giseEstado.todasUnidades);

	// Relatórios extraordinários pendentes de assinatura (usado pelo hook de assinatura e pelo template)
	const pendentesExtra = $derived.by(() => {
		if (!isSupervisor) return [];
		const lista: Array<{ seccionalId: number; tipo: 'extraordinario' }> = [];
		const supId = data.supervisaoExtraUnidadeId;
		if (
			supId &&
			gise &&
			quadroSupervisaoExtraExigeRelatorio(gise) &&
			supervisaoExtraPresencasCompletas(gise, data.presencasGise ?? [])
		) {
			const relSup = data.assinaturasRelatorios?.find(
				(a: GiseAssinaturaRelatorio) => a.seccional_id === supId && a.tipo === 'extraordinario'
			);
			if (!relSup) {
				lista.push({ seccionalId: supId, tipo: 'extraordinario' });
			}
		}
		for (const sec of gise?.seccionais || []) {
			const relAssinado = data.assinaturasRelatorios?.find(
				(a: GiseAssinaturaRelatorio) =>
					(a.seccional_id === sec.seccional_id || a.seccional_id === sec.id) &&
					a.tipo === 'extraordinario'
			);
			if (!relAssinado && checkAllSigned(sec)) {
				lista.push({
					seccionalId: sec.seccional_id,
					tipo: 'extraordinario'
				});
			}
		}
		return lista;
	});

	// Hook de assinatura (cerimônia em tela, assinatura simples/SERPRO, lote de relatórios)
	const assinatura = useGiseAssinatura({
		getGiseId: () => gise?.id ?? 0,
		getGiseDataInicio: () => gise?.data_inicio,
		getPendentesExtra: () => pendentesExtra,
		initialSignerName: untrack(() => data.usuarioAtual?.nome ?? ''),
		initialSignerCpf: untrack(() => data.usuarioAtual?.cpf ?? '')
	});

	const avancadaDesktopDisponivel = $derived(
		!isMobile && !data.restringirSmartphone && avancadaEmTelaDoLayout(page.data)
	);

	function assinarGiseComTokenNoModal() {
		const alvo = assinatura.relatorioSendoAssinado;
		assinatura.relatorioSendoAssinado = null;
		assinatura.fecharModalAssinatura();
		if (alvo?.lote) {
			void assinatura.executarAssinarRelatorioLoteSERPRO();
			return;
		}
		if (alvo?.seccionalId != null && alvo.tipo) {
			const seccionalId = alvo.seccionalId;
			const tipo = alvo.tipo;
			const sec = gise?.seccionais?.find((s) => s.seccional_id === seccionalId);
			abrirAssinaturaRelatorioDigital(seccionalId, tipo, sec?.seccional_nome ?? 'Seccional');
			return;
		}
		void assinatura.painelTokenGise?.assinarComSerpro();
	}

	// Estados locais (não extraídos)
	let showFinalizarConfirm = $state(false);
	let showDigitalModalRelatorio = $state(false);
	let relatorioDigitalInfo = $state<{
		seccionalId: number;
		tipo: 'extraordinario' | 'produtividade';
		seccionalNome: string;
	} | null>(null);

	// Reabrir escala
	let showReabrirConfirm = $state(false);

	let showDownloadExtrasModal = $state(false);

	// "C/ manifesto" no modal de extras: só se o usuário receberia o blob forense
	// de TODOS os relatórios assinados (Admin Geral/Super ou DPC assinante).
	const podeManifestoExtras = $derived.by(() => {
		const rels = (data.assinaturasRelatorios ?? []).filter((a) => a.tipo === 'extraordinario');
		return (
			rels.length > 0 &&
			rels.every((a) => podeBaixarComManifesto(page.data.usuario, a.assinante_id))
		);
	});

	const giseParaDownload = $derived.by(() => {
		if (!gise) return null;
		return {
			id: gise.id,
			status: gise.status,
			data_inicio: gise.data_inicio,
			supervisor_id: gise.supervisor_id,
			assessor_id: gise.assessor_id,
			seint1_id: gise.seint1_id,
			seint2_id: gise.seint2_id,
			assinaturasRelatorioExtraIds: (data.assinaturasRelatorios ?? [])
				.filter((a) => a.tipo === 'extraordinario')
				.map((a) => a.seccional_id),
			seccionais: (gise.seccionais ?? []).map(
				(sec: { seccional_id: number; seccional_nome: string }) => ({
					id: sec.seccional_id,
					nome: sec.seccional_nome
				})
			)
		};
	});

	// Modo Edição Geral (Admin Geral)
	let modoEdicaoGeral = $state(false);
	$effect(() => {
		if (page.url.searchParams.get('edit') === 'true') {
			modoEdicaoGeral = true;
			// Remove the flag from URL to avoid re-activating on refresh
			const url = new URL(page.url);
			url.searchParams.delete('edit');
			replaceState(url, {});
		}
	});

	/**
	 * Atalho dos cards em `/operacoes/gise`: `?assinar=escala` ou `?assinar=extra` abre
	 * o mesmo controle de dentro da escala (assinatura em tela no celular,
	 * token no computador). Consome o param para o F5 não disparar de novo.
	 */
	afterNavigate(() => {
		const acao = page.url.searchParams.get('assinar');
		if (acao !== 'escala' && acao !== 'extra') return;
		const via = page.url.searchParams.get('via');
		const url = new URL(page.url);
		url.searchParams.delete('assinar');
		url.searchParams.delete('via');
		replaceState(url, {});
		void (async () => {
			await tick();
			await new Promise((r) => setTimeout(r, 0));
			const noCelular = via === 'tela' || (via !== 'token' && isMobile);
			const avancada = avancadaEmTelaDoLayout(page.data);
			const avancadaNoDesktop = avancada && !data.restringirSmartphone;
			if (acao === 'escala') {
				if (noCelular || (avancadaNoDesktop && via !== 'token')) {
					if (avancada) assinatura.abrirModalAssinatura('simples');
				} else {
					await assinatura.painelTokenGise?.assinarComSerpro();
				}
				return;
			}
			if (pendentesExtra.length === 0) return;
			if (noCelular || (avancadaNoDesktop && via !== 'token')) {
				if (avancada) assinatura.abrirAssinaturaLote();
			} else {
				await assinatura.executarAssinarRelatorioLoteSERPRO();
			}
		})();
	});
	let showModalDataHoras = $state(false);
	let showModalBreveRelatorio = $state(false);
	let showExcluirGiseConfirm = $state(false);
	let supervisorExpandiuQuadroSeccionais = $state(false);
	const seccionaisRecolhidas = $state<Record<number, boolean>>({});
	const supervisorSomente = $derived(isSupervisor && !isAdminGeral && !isSeccional);
	const exibirQuadroSeccionais = $derived(!supervisorSomente || supervisorExpandiuQuadroSeccionais);

	function seccionalIniciaRecolhida(status: string) {
		return status === 'preenchida' || status === 'preenchida_retificada';
	}

	function toggleRecolherSeccional(id: number, status: string) {
		const atual = seccionaisRecolhidas[id] ?? seccionalIniciaRecolhida(status);
		seccionaisRecolhidas[id] = !atual;
	}

	// Gerenciamento de seccionais (Admin Geral) — derivado dos dados já carregados
	const seccionaisDisponiveis = $derived(filtrarSeccionaisDisponiveis(gise, todasUnidades));
	let adicionandoSeccional = $state(false);
	let seccionalParaAdicionarIdx = $state<number | ''>('');
	let pendingCrud = $state(false);
	/** Último envio com sucesso à planilha Base_Equipe (persistido em `gise.planilha_base_equipe_alimentada_em`). */
	const planilhaBaseEquipeAlimentadaOk = $derived(!!gise?.planilha_base_equipe_alimentada_em);

	const setPending = (p: boolean) => (pendingCrud = p);

	const handleSalvarSupervisores = makeEnhanceHandler({
		setPending,
		successTitle: 'Supervisor salvo',
		errorTitle: 'Erro ao salvar',
		onSuccess: () => {
			quadro.editandoPapel = null;
		}
	});

	const handleSalvarBreveRelatorio = makeEnhanceHandler({
		setPending,
		successTitle: 'Textos do breve relatório salvos',
		errorTitle: 'Erro ao salvar',
		onSuccess: () => {
			showModalBreveRelatorio = false;
		}
	});

	const handleAdicionarSeccional = makeEnhanceHandler({
		setPending,
		beforeSubmit: () => seccionalParaAdicionarIdx !== '',
		successTitle: 'Seccional adicionada',
		errorTitle: 'Erro ao adicionar',
		onSuccess: () => {
			adicionandoSeccional = false;
			seccionalParaAdicionarIdx = '';
		}
	});

	// Documento assinado
	const documentoAssinadoInfo = $derived(
		gise?.documento
			? {
					existe: true,
					assinante_nome: gise.documento.assinante_nome,
					assinante_id: gise.documento.assinante_id,
					assinante_cpf: gise.documento.assinante_cpf ?? '',
					data: gise.documento.created_at,
					verificacao_hash: gise.documento.verificacao_hash
				}
			: null
	);

	const handleFinalizarGise = makeEnhanceHandler({
		setPending,
		invalidateKey: false,
		successTitle: 'Escala finalizada!',
		errorTitle: 'Erro ao finalizar',
		onSuccess: () => {
			showFinalizarConfirm = false;
			goto('/operacoes/gise');
		}
	});

	const handleSolicitarAssinatura = makeEnhanceHandler({
		setPending,
		successTitle: 'Edição finalizada',
		successDescription: 'Escala enviada para assinatura do Supervisor.',
		errorTitle: 'Erro ao enviar'
	});

	const handleRevogarPedidoAssinatura = makeEnhanceHandler({
		setPending,
		successTitle: 'Solicitação revogada',
		successDescription: 'Escala retornada para edição.',
		errorTitle: 'Erro ao revogar'
	});

	const handleEnviarPlanilha = makeEnhanceHandler<{ linhas?: number }>({
		setPending,
		successTitle: 'Dados enviados para a planilha',
		successDescription: (d) =>
			typeof d?.linhas === 'number' ? `${d.linhas} linha(s) na Base_Equipe.` : undefined,
		errorTitle: 'Falha ao enviar para a planilha'
	});

	function abrirAssinaturaRelatorioDigital(
		seccionalId: number,
		tipo: 'extraordinario' | 'produtividade',
		seccionalNome: string
	) {
		relatorioDigitalInfo = { seccionalId, tipo, seccionalNome };
		showDigitalModalRelatorio = true;
	}

	const handleReabrirEscala = makeEnhanceHandler({
		setPending,
		successTitle: 'Escala reaberta',
		successDescription: 'A assinatura foi revogada. A escala pode ser editada novamente.',
		errorTitle: 'Erro ao reabrir',
		onSuccess: () => {
			showReabrirConfirm = false;
		}
	});

	const handleSalvarDatasHorarios = makeEnhanceHandler<{ assinatura_revogada?: boolean }>({
		setPending,
		errorTitle: 'Erro ao salvar',
		onSuccess: (d) => {
			if (d?.assinatura_revogada) {
				toaster.warning({
					title: 'Datas/horários atualizados',
					description: 'A assinatura digital foi revogada. Será necessário assinar novamente.'
				});
			} else {
				toaster.success({ title: 'Datas/horários atualizados' });
			}
			showModalDataHoras = false;
		}
	});

	const handleExcluirGise = makeEnhanceHandler({
		setPending,
		invalidateKey: false,
		successTitle: 'Escala GISE excluída',
		errorTitle: 'Erro ao excluir',
		onSuccess: () => {
			showExcluirGiseConfirm = false;
			goto('/operacoes/gise');
		}
	});

	const podeFinalizar = $derived(
		isAdminGeral && (gise?.status === 'pronta_para_finalizar' || gise?.status === 'em_andamento')
	);
	const podeAssinar = $derived(
		isSupervisor &&
			gise?.status === 'aguardando_assinatura' &&
			gise?.supervisor_id === data.usuarioAtual?.id &&
			!documentoAssinadoInfo?.existe
	);
	const podeReabrir = $derived(isAdminGeral && escalaGiseJaAssinada(gise?.status ?? ''));

	/**
	 * Quadro de supervisão — publicado por contexto em vez de descido por props.
	 * O cabeçalho de `quadro-supervisao-estado.svelte.ts` explica a escolha; aqui
	 * fica só a ligação com o que é da PÁGINA (o `load` e os composables).
	 */
	const quadro = publicarQuadroSupervisao({
		get gise() {
			return gise ?? null;
		},
		get policiais() {
			return policiais;
		},
		get isAdminGeral() {
			return isAdminGeral;
		},
		get isSeccional() {
			return isSeccional;
		},
		get isSupervisor() {
			return isSupervisor;
		},
		get podeEditar() {
			return podeEditar;
		},
		get podeDownload() {
			return podeDownload;
		},
		get modoEdicaoGeral() {
			return modoEdicaoGeral;
		},
		get pendingCrud() {
			return pendingCrud;
		},
		get documentoAssinadoInfo() {
			return documentoAssinadoInfo;
		},
		get presencasGise() {
			return data.presencasGise ?? null;
		},
		get seintSupervisaoComRelatorio() {
			return data.seintSupervisaoComRelatorio ?? [];
		},
		get supervisaoExtraUnidadeId() {
			return data.supervisaoExtraUnidadeId ?? null;
		},
		get assinaturasRelatorios() {
			return data.assinaturasRelatorios ?? null;
		},
		get mostrarPainelAssinaturaEscala() {
			return podeAssinar;
		},
		get assinaturaEscalaSignerEmail() {
			return data.usuarioAtual?.email ?? undefined;
		},
		get assessorEmailSugerido() {
			return data.assessorEmailSugerido ?? undefined;
		},
		assinatura,
		onSubmitDesignacao: handleSalvarSupervisores,
		assinarExtraManual() {
			const id = data.supervisaoExtraUnidadeId;
			if (id) assinatura.abrirAssinaturaRelatorio(id, 'extraordinario');
		},
		assinarExtraDigital() {
			const id = data.supervisaoExtraUnidadeId;
			if (id) abrirAssinaturaRelatorioDigital(id, 'extraordinario', 'Supervisão GISE');
		},
		abrirAssinaturaEscalaManual() {
			assinatura.abrirModalAssinatura('simples');
		},
		async aoAssinarEscalaDigital() {
			await invalidateShared('gise:detail', 'app:gise-list');
		}
	});

	$effect(() => {
		quadro.sincronizarIdsComGise();
	});
	$effect(() => {
		quadro.sincronizarEmailAssessor();
	});
</script>

<svelte:head>
	{#if gise}
		<title
			>{diaSemana(gise.data_inicio)}, {fmtDate(gise.data_inicio)} — {statusLabel(
				gise.status
			)}</title
		>
	{:else}
		<title>Carregando GISE... | Ecossistema PCCE</title>
	{/if}
</svelte:head>

<div
	class="relative min-w-0 transition-all duration-500 {loading.active
		? 'pointer-events-none opacity-40 blur-[3px]'
		: 'opacity-100 blur-0'} space-y-6"
>
	{#if gise}
		<GiseCabecalho
			{gise}
			operacaoNome={data.operacaoNome}
			{isAdminGeral}
			{podeDownload}
			{podeEditar}
			{podeReabrir}
			{podeFinalizar}
			{editaBloqueado}
			{modoEdicaoGeral}
			{todasSeccionaisPreenchidas}
			documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
			{pendingCrud}
			onToggleEdit={() => (modoEdicaoGeral = !modoEdicaoGeral)}
			onAbrirDataHoras={() => (showModalDataHoras = true)}
			onAbrirExcluir={() => (showExcluirGiseConfirm = true)}
			onAbrirReabrir={() => (showReabrirConfirm = true)}
			onAbrirFinalizar={() => (showFinalizarConfirm = true)}
			onSolicitarAssinatura={handleSolicitarAssinatura}
			onRevogarPedido={handleRevogarPedidoAssinatura}
			onEnviarPlanilha={isAdminGeral ? handleEnviarPlanilha : undefined}
			{planilhaBaseEquipeAlimentadaOk}
			onAbrirBreveRelatorio={isAdminGeral ? () => (showModalBreveRelatorio = true) : undefined}
		/>
	{/if}

	{#if !gise}
		<p class="text-surface-600 dark:text-surface-400">Escala não encontrada.</p>
	{:else}
		{#if !isSeccional || isSupervisor}
			<GiseSupervisao>
				{#snippet loteSection()}
					{#if isSupervisor || isAdminGeral}
						<GiseLoteAssinaturas
							quantidadePendentes={pendentesExtra.length}
							assinandoLote={assinatura.assinandoLote}
							etapaAssinatura={assinatura.etapaAssinatura}
							progressoLote={assinatura.progressoLote}
							{isMobile}
							onAssinarManualLote={assinatura.abrirAssinaturaLote}
							onAssinarDigitalLote={assinatura.executarAssinarRelatorioLoteSERPRO}
							assinaturasRelatorios={data.assinaturasRelatorios}
							seccionais={gise.seccionais}
							supervisaoExtraUnidadeId={data.supervisaoExtraUnidadeId}
							podeAssinar={isSupervisor}
							giseStatus={gise.status}
							onConferencia={() => (showDownloadExtrasModal = true)}
						/>
					{/if}
				{/snippet}
			</GiseSupervisao>
		{/if}

		<div class="flex items-center gap-3 my-6 min-w-0">
			<hr class="min-w-0 flex-1 border-surface-200 dark:border-white/10" />
			<span
				class="min-w-0 text-center text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider"
				>Seccionais Participantes</span
			>
			<hr class="min-w-0 flex-1 border-surface-200 dark:border-white/10" />
		</div>

		<!-- Seccionais -->
		<div>
			{#if !isSeccional}
				<div class="mb-3 flex flex-col gap-2 xs:flex-row xs:items-center xs:justify-between">
					<h2 class="font-semibold text-surface-900 dark:text-surface-50">
						Seccionais ({gise.seccionais?.length ?? 0})
					</h2>
					{#if supervisorSomente}
						<button
							type="button"
							class="btn btn-sm preset-filled-primary-500 text-xs px-3 py-1.5 rounded-lg font-bold shadow-sm transition-all w-full xs:w-auto"
							onclick={() =>
								(supervisorExpandiuQuadroSeccionais = !supervisorExpandiuQuadroSeccionais)}
						>
							{exibirQuadroSeccionais ? 'Ocultar participantes' : 'Exibir participantes'}
						</button>
					{/if}
				</div>
			{/if}

			{#if exibirQuadroSeccionais}
				{#each gise.seccionais ?? [] as sec (sec.id)}
					{#if isAdminGeral || isSupervisor || sec.seccional_id === minhaSeccionalId}
						<GiseSeccional
							{sec}
							{gise}
							tiposEquipePermitidos={data.tiposEquipePermitidos}
							{todasUnidades}
							{isAdminGeral}
							{isSeccional}
							{isSupervisor}
							{podeEditar}
							{podeDownload}
							{isMobile}
							{minhaSeccionalId}
							{modoEdicaoGeral}
							assinaturasRelatorios={data.assinaturasRelatorios}
							restringirSmartphone={data.restringirSmartphone}
							recolhida={seccionaisRecolhidas[sec.id] ?? seccionalIniciaRecolhida(sec.status)}
							onToggleRecolher={() => toggleRecolherSeccional(sec.id, sec.status)}
							onAssinarRelatorioManual={(seccionalId) =>
								assinatura.abrirAssinaturaRelatorio(seccionalId, 'extraordinario')}
							onAssinarRelatorioDigital={(seccionalId, tipo, nome) =>
								abrirAssinaturaRelatorioDigital(seccionalId, tipo, nome)}
							onFinalizarSuccess={() => {
								seccionaisRecolhidas[sec.id] = true;
							}}
						/>
					{/if}
				{/each}
			{/if}

			{#if isAdminGeral && podeEditar && modoEdicaoGeral}
				{#if adicionandoSeccional}
					<div
						class="mt-4 p-4 sm:p-5 rounded-2xl border border-dashed border-primary-500/50 bg-primary-500/5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
					>
						<div class="w-full sm:flex-1 sm:min-w-[200px]">
							<label
								for="novaSeccional"
								class="text-sm font-medium text-surface-600 dark:text-surface-400 block mb-1"
								>Adicionar Seccional</label
							>
							<select
								id="novaSeccional"
								bind:value={seccionalParaAdicionarIdx}
								class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
							>
								<option value="">Selecione a seccional...</option>
								{#each seccionaisDisponiveis as s (s.id)}
									<option value={s.id}>{s.nome}</option>
								{/each}
							</select>
						</div>
						<form
							method="POST"
							action="?/adicionarSeccional"
							use:enhance={handleAdicionarSeccional}
							class="flex w-full gap-2 sm:w-auto"
						>
							<input type="hidden" name="seccionalId" value={seccionalParaAdicionarIdx} />
							<button
								type="submit"
								class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl flex-1 sm:flex-none transition-all"
								disabled={!seccionalParaAdicionarIdx || pendingCrud}
							>
								{pendingCrud ? 'Adicionando...' : 'Confirmar'}
							</button>
							<button
								type="button"
								class="btn preset-outlined-surface-500 text-sm px-4 py-2 rounded-xl flex-1 sm:flex-none"
								onclick={() => (adicionandoSeccional = false)}
							>
								Cancelar
							</button>
						</form>
					</div>
				{:else}
					<button
						type="button"
						class="btn preset-outlined-surface-500 text-sm px-4 py-2 rounded-xl border-dashed mt-4 flex items-center gap-2"
						onclick={() => (adicionandoSeccional = true)}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 4v16m8-8H4"
							/></svg
						>
						Adicionar Seccional
					</button>
				{/if}
			{/if}
		</div>

		<!-- Avisos contextuais de status (retificação seccional, aguardando conclusão) -->
		<GiseStatusAvisos
			{isSeccional}
			{isSupervisor}
			minhaSeccionalRetificada={minhaSeccional?.status === 'retificada'}
			giseEmPreenchimento={gise.status === 'em_preenchimento'}
		/>
	{/if}
</div>

{#if gise}
	<ModalDatasHoras
		open={showModalDataHoras}
		{pendingCrud}
		{editaBloqueado}
		{gise}
		onClose={() => (showModalDataHoras = false)}
		onSubmit={handleSalvarDatasHorarios}
	/>
{/if}

{#if gise}
	<ModalBreveRelatorio
		open={showModalBreveRelatorio}
		{gise}
		global={data.breveRelatorioEnv}
		{pendingCrud}
		onClose={() => (showModalBreveRelatorio = false)}
		onSubmit={handleSalvarBreveRelatorio}
	/>
{/if}

<ModalExcluirGise
	open={showExcluirGiseConfirm}
	giseId={gise?.id ?? 0}
	{pendingCrud}
	onClose={() => (showExcluirGiseConfirm = false)}
	onSubmit={handleExcluirGise}
/>

<ModalReabrir
	open={showReabrirConfirm}
	{pendingCrud}
	onClose={() => (showReabrirConfirm = false)}
	onSubmit={handleReabrirEscala}
/>

<ModalFinalizar
	open={showFinalizarConfirm}
	{pendingCrud}
	status={gise?.status ?? ''}
	onClose={() => (showFinalizarConfirm = false)}
	onSubmit={handleFinalizarGise}
/>

{#if showDigitalModalRelatorio && relatorioDigitalInfo && gise}
	<ModalRelatorioDigital
		open={showDigitalModalRelatorio}
		giseId={gise.id}
		seccionalId={relatorioDigitalInfo.seccionalId}
		seccionalNome={relatorioDigitalInfo.seccionalNome}
		signerEmail={data.usuarioAtual?.email ?? undefined}
		disabled={false}
		bind:control={assinatura.painelTokenRelatorio}
		bind:signerName={assinatura.relatorioSignerName}
		bind:signerCpf={assinatura.relatorioSignerCpf}
		onSuccess={async () => {
			showDigitalModalRelatorio = false;
			relatorioDigitalInfo = null;
			await invalidateShared('gise:detail', 'app:gise-list');
		}}
		onClose={() => {
			showDigitalModalRelatorio = false;
			relatorioDigitalInfo = null;
		}}
	/>
{/if}

<ModalAssinaturaAvancada
	open={assinatura.showAssinaturaModal}
	tituloAssinatura="Assinatura do Supervisor"
	tituloCamera="Prova de Vida do Supervisor"
	descricaoAssinatura="Confirme para assinar a escala GISE com validade jurídica."
	exigirFoto={page.data.exigirFotoAssinatura ?? true}
	exigirGps={page.data.exigirGpsAssinatura ?? true}
	exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
	cpfUsuario={data.usuarioAtual?.cpf ?? null}
	onAssinarToken={avancadaDesktopDisponivel ? assinarGiseComTokenNoModal : null}
	onConfirm={assinatura.confirmarAssinatura}
	onCancel={assinatura.fecharModalAssinatura}
	notaRodape="As evidências desta assinatura serão anexadas permanentemente ao PDF desta escala."
	largura="lg"
	camada="empilhado"
	familia="assinatura"
	padding="compacto"
/>

<ModalDownloadExtras
	bind:open={showDownloadExtrasModal}
	gise={giseParaDownload}
	supervisaoExtraUnidadeId={data.supervisaoExtraUnidadeId}
	podeManifesto={podeManifestoExtras}
/>
