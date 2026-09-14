/**
 * Presença do POLICIAL na GISE — a metade de `/operacoes/presenca` que pertence a quem
 * presta o serviço: escolher a escala, confirmar entrada e saída, baixar
 * relatórios e comprovantes.
 *
 * A rota tem duas audiências que não se cruzam; a do Admin Geral (o editor do
 * modelo de perguntas) está em `useEditorModelo.svelte.ts`. Até ago/2026 as
 * duas viviam num composable só (`useResGise`, 663 ln) que devolvia 41 membros,
 * e cada componente recebia o objeto inteiro para usar metade.
 *
 * Os filtros espelham a URL — não `$state` — para a aba "Presença GISE" resetar
 * ao navegar sem query. A navegação em si fica em `res-gise-navegacao.svelte.ts`,
 * dividida com o editor, porque as duas telas escrevem na MESMA query string.
 */
import { toaster } from '$lib/toast';
import { apiFetchResponse } from '$lib/api-fetch';
import { baixarBlob, nomeArquivoContentDisposition } from '$lib/utils/download';
import { loading } from '$lib/loading.svelte';
import { page } from '$app/state';
import { goto } from '$app/navigation';
import { untrack } from 'svelte';
import { invalidateShared } from '$lib/cross-tab-invalidate';
import type { ActionResult } from '@sveltejs/kit';
import { postPageAction } from '$lib/post-form-action';
import type { ResGiseEscalaSelecionavel, ResGisePageData } from '$lib/types';
import type { GisePresenca } from '$lib/server/schema';
import type { SignaturePadConfirmPayload } from '$lib/components/SignaturePadTypes';
import { assinarPresencaComPasskey } from '$lib/assinatura-passkey';
import { ehErroReauthAssinatura } from '$lib/assinatura-reauth';
import { navigateWithFilters } from './res-gise-navegacao.svelte';
import {
	historicoTemFiltroAlemDoPadrao,
	parseFiltrosHistoricoResGise,
	type ModoPeriodoResGise
} from './filtros-historico';
import { hojeLocalISO } from '$lib/utils/datas';
import { anosParaSeletorCiclo, cicloQueContem } from '$lib/gise/ciclos';
import { mensagemDeErro } from '$lib/utils/erro';

function erroDaAction(result: ActionResult, fallback: string): string {
	if (result.type === 'failure') {
		const data = result.data as { error?: string } | undefined;
		if (data?.error) return data.error;
	}
	if (result.type === 'error' && result.error) {
		return typeof result.error === 'string' ? result.error : fallback;
	}
	return fallback;
}

export function usePresencaGise(getData: () => ResGisePageData) {
	const data = $derived(getData());

	let escalaSelecionada = $state<ResGiseEscalaSelecionavel | null>(null);
	let capturandoAssinatura = $state(false);

	// --- Filtros ---
	// Espelham a URL (fonte única). São as duas abas da sidebar que trocam o
	// `?status`: sem ele é "ativas", com `finalizadas` é o histórico. Derivados
	// (não `$state`) porque quem manda é a URL — a aba "Presença GISE" navega
	// para `/operacoes/presenca` SEM `status`, e um `$state` sincronizado só quando o
	// parâmetro existe ficaria preso em "finalizadas" ao voltar do histórico.
	const statusFilterUrl = $derived(
		page.url.searchParams.get('status') === 'finalizadas' ? 'finalizadas' : 'ativas'
	);
	const filtrosHistorico = $derived.by(() => {
		const historico = page.url.searchParams.get('status') === 'finalizadas';
		return parseFiltrosHistoricoResGise(
			page.url.searchParams,
			historico ? hojeLocalISO() : undefined
		);
	});
	const mesFilterUrl = $derived(filtrosHistorico.mes);
	const dataFilterUrl = $derived(filtrosHistorico.data);
	const tipoFilterUrl = $derived(filtrosHistorico.tipo);
	const modoPeriodo = $derived(filtrosHistorico.periodo);
	const anoFilterUrl = $derived(filtrosHistorico.ano);
	const cicloFilterUrl = $derived(filtrosHistorico.ciclo);
	const anosCiclo = $derived.by(() => {
		const base = anosParaSeletorCiclo(hojeLocalISO());
		const ano = filtrosHistorico.ano;
		if (ano != null && !base.includes(ano)) return [...base, ano].sort((a, b) => a - b);
		return base;
	});
	const temFiltrosHistorico = $derived(
		historicoTemFiltroAlemDoPadrao(filtrosHistorico, hojeLocalISO())
	);

	let idProdutividadeBaixando = $state<number | null>(null);
	let idExtraBaixando = $state<number | null>(null);
	// Qual comprovante de presença está baixando ('entrada' | 'saida' | null).
	let termoBaixando = $state<'entrada' | 'saida' | null>(null);

	// Após invalidate externo (outra aba / poll), realinha a seleção ao load fresco.
	// Só depende de `minhasEscalas` — ler `escalaSelecionada` no effect causaria loop.
	$effect(() => {
		const lista = data.minhasEscalas;
		const sel = untrack(() => escalaSelecionada);
		if (!sel || !lista) return;
		const atualizada = lista.find((e) => e.id === sel.id && e.equipe_id === sel.equipe_id);
		if (atualizada) escalaSelecionada = atualizada;
	});

	// Mês civil, ciclo e data são mutuamente exclusivos. Só navega — os derivados
	// reajustam sozinhos depois do `goto`. O `?status` corrente é preservado por
	// `navigateWithFilters`, então filtrar não tira o usuário do histórico.
	function changeDateFilter(type: 'mes' | 'data', value: string) {
		if (type === 'mes') {
			navigateWithFilters({
				mes: value || null,
				data: null,
				periodo: 'mes',
				ano: null,
				ciclo: null
			});
		} else {
			navigateWithFilters({
				data: value || null,
				mes: null,
				periodo: 'data',
				ano: null,
				ciclo: null
			});
		}
	}

	function changeTipoFilter(value: string) {
		navigateWithFilters({
			tipo: value === 'operacional' || value === 'seint' ? value : null
		});
	}

	function changeModoPeriodo(modo: ModoPeriodoResGise) {
		const hoje = hojeLocalISO();
		if (modo === 'data') {
			navigateWithFilters({
				periodo: 'data',
				mes: null,
				ano: null,
				ciclo: null,
				data: dataFilterUrl || hoje
			});
		} else if (modo === 'ciclo') {
			const corrente = cicloQueContem(hoje);
			navigateWithFilters({
				periodo: 'ciclo',
				mes: null,
				data: null,
				ano: String(anoFilterUrl ?? corrente.ano),
				ciclo: String(cicloFilterUrl ?? corrente.ciclo)
			});
		} else {
			navigateWithFilters({
				periodo: 'mes',
				data: null,
				ano: null,
				ciclo: null,
				mes: mesFilterUrl || hoje.slice(0, 7)
			});
		}
	}

	function changeCicloFilter(campo: 'ano' | 'ciclo', value: string) {
		const corrente = cicloQueContem(hojeLocalISO());
		const n = Number(value);
		const ano = campo === 'ano' && Number.isFinite(n) ? n : (anoFilterUrl ?? corrente.ano);
		const ciclo = campo === 'ciclo' && Number.isFinite(n) ? n : (cicloFilterUrl ?? corrente.ciclo);
		navigateWithFilters({
			periodo: 'ciclo',
			mes: null,
			data: null,
			ano: String(ano),
			ciclo: String(ciclo)
		});
	}

	// Limpa a busca detalhada — mantém a aba (o `status` da URL). Antes zerava
	// `status` também, o que jogava o usuário do Histórico de volta para Ativas.
	function limparFiltros() {
		navigateWithFilters({
			mes: null,
			data: null,
			tipo: null,
			periodo: null,
			ano: null,
			ciclo: null
		});
	}

	async function selecionarEscala(escala: ResGiseEscalaSelecionavel) {
		const isSame =
			escalaSelecionada?.id === escala.id && escalaSelecionada?.equipe_id === escala.equipe_id;
		if (isSame) return;

		escalaSelecionada = escala;

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams(page.url.searchParams);
		params.set('giseId', String(escala.id));
		if (escala.equipe_id) params.set('equipeId', String(escala.equipe_id));
		else params.delete('equipeId');

		await goto(`?${params}`, { keepFocus: true, noScroll: true });
	}

	/**
	 * Após qualquer invalidate de `app:res-gise`, `escalaSelecionada` ainda aponta
	 * para o objeto antigo. Reaplica a partir de `data.minhasEscalas`; se sumiu da
	 * lista (saída finalizada), opcionalmente carimba o timestamp local.
	 */
	function reaplicarEscalaSelecionada(tipoPresenca?: 'entrada' | 'saida') {
		const sel = escalaSelecionada;
		if (!sel) return;
		const atualizada = data.minhasEscalas?.find(
			(e) => e.id === sel.id && e.equipe_id === sel.equipe_id
		);
		if (atualizada) {
			escalaSelecionada = atualizada;
			return;
		}
		if (!tipoPresenca) return;
		const prev = 'presenca' in sel && sel.presenca ? sel.presenca : undefined;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const ts = new Date().toISOString();
		escalaSelecionada = {
			...sel,
			presenca: {
				...prev,
				...(tipoPresenca === 'entrada' ? { entrada_timestamp: ts } : { saida_timestamp: ts })
			} as GisePresenca
		} as ResGiseEscalaSelecionavel;
	}

	/**
	 * Re-sincroniza `escalaSelecionada` após uma confirmação de presença feita
	 * FORA do fluxo de `salvarEntrada`/`salvarSaida` — caso do Token A3 no
	 * desktop, em que o PainelAssinaturaToken posta direto na API. Sem isto, o
	 * container fica preso no objeto antigo e só muda de estado após reload.
	 */
	async function sincronizarPresencaAtual(tipo: 'entrada' | 'saida') {
		if (!escalaSelecionada) return;
		await invalidateShared('app:res-gise', 'app:papel-gise');
		reaplicarEscalaSelecionada(tipo);
	}

	/** Corpo comum dos dois POSTs de presença — só o rótulo e a action mudam. */
	function formDataPresenca(giseId: number, payload: SignaturePadConfirmPayload): FormData {
		const {
			lat: latitude,
			lng: longitude,
			selfie: selfieBase64,
			codigoEmail,
			desafioId,
			reauthId,
			motivoSemGps
		} = payload;
		const fd = new FormData();
		fd.set('giseId', String(giseId));
		if (latitude !== undefined) fd.set('latitude', String(latitude));
		if (longitude !== undefined) fd.set('longitude', String(longitude));
		if (selfieBase64) fd.set('selfieBase64', selfieBase64);
		if (codigoEmail) fd.set('codigoEmail', codigoEmail);
		if (desafioId) fd.set('desafioId', desafioId);
		if (reauthId) fd.set('reauthId', reauthId);
		// Sem isto o servidor recusa o ato quando a flag de GPS está ligada e a
		// coordenada não veio — é a declaração que substitui a evidência ausente e
		// entra na trilha de auditoria (ver `$lib/assinatura-evidencia`).
		if (motivoSemGps) fd.set('motivoSemGps', motivoSemGps);
		return fd;
	}

	function evidenciasPresenca(payload: SignaturePadConfirmPayload) {
		return {
			latitude: payload.lat,
			longitude: payload.lng,
			selfieBase64: payload.selfie,
			codigoValidação: payload.codigoEmail,
			desafioId: payload.desafioId,
			livenessChallenge: payload.liveness,
			reauthId: payload.reauthId
		};
	}

	async function confirmarPresenca(tipo: 'entrada' | 'saida', payload: SignaturePadConfirmPayload) {
		if (!escalaSelecionada) return;
		const giseAlvoId = escalaSelecionada.id;
		loading.show(tipo === 'entrada' ? 'Confirmando Entrada...' : 'Confirmando Saída...');
		try {
			if (page.data.exigirPasskeyAssinatura) {
				await assinarPresencaComPasskey(giseAlvoId, tipo, evidenciasPresenca(payload), (rotulo) =>
					loading.show(rotulo)
				);
			} else {
				const action = tipo === 'entrada' ? 'salvarEntrada' : 'salvarSaida';
				const result = await postPageAction(action, formDataPresenca(giseAlvoId, payload));
				if (result.type !== 'success') {
					throw new Error(
						erroDaAction(
							result,
							tipo === 'entrada' ? 'Erro ao salvar entrada' : 'Erro ao salvar saída'
						)
					);
				}
			}

			toaster.success({
				title:
					tipo === 'entrada' ? 'Entrada confirmada com sucesso' : 'Saída confirmada com sucesso'
			});
			capturandoAssinatura = false;
			await invalidateShared('app:res-gise', 'app:papel-gise');
			reaplicarEscalaSelecionada(tipo);
		} catch (e: unknown) {
			if (ehErroReauthAssinatura(e)) throw e;
			toaster.error({ title: 'Erro', description: mensagemDeErro(e) });
		} finally {
			loading.hide();
		}
	}

	async function salvarEntrada(payload: SignaturePadConfirmPayload) {
		await confirmarPresenca('entrada', payload);
	}

	async function salvarSaida(payload: SignaturePadConfirmPayload) {
		await confirmarPresenca('saida', payload);
	}

	const isHorarioLiberado = (escala: ResGiseEscalaSelecionavel, isAdminGeral: boolean) => {
		if (isAdminGeral) return true;
		if (!escala?.horarioPrevisto?.inicio) return true;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const agora = new Date();
		const [h, min] = escala.horarioPrevisto.inicio.split(':');
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const dataInicioPrevista = new Date(
			escala.data_inicio + 'T' + h.padStart(2, '0') + ':' + (min || '00') + ':00'
		);
		return agora >= dataInicioPrevista;
	};

	const isSaidaLiberada = (escala: ResGiseEscalaSelecionavel, isAdminGeral: boolean) => {
		if (isAdminGeral) return true;
		if (!escala?.horarioPrevisto?.fim) return true;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const agora = new Date();
		const [h, min] = escala.horarioPrevisto.fim.split(':');
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const dataFimPrevista = new Date(
			escala.data_inicio + 'T' + h.padStart(2, '0') + ':' + (min || '00') + ':00'
		);
		return agora >= dataFimPrevista;
	};

	async function baixarRelatorio(escala: ResGiseEscalaSelecionavel) {
		idProdutividadeBaixando = escala.id;
		loading.show('Baixando Relatório de Produtividade...');
		try {
			const url = `/api/gise/${escala.id}/download?format=produtividade&seccionalId=${escala.seccional_id}&equipeType=${escala.equipe_tipo}`;
			const res = await apiFetchResponse(url);
			baixarBlob(
				await res.blob(),
				`relatorio_produtividade_${escala.seccional_nome}_${escala.data_inicio}.pdf`
			);
		} catch (e: unknown) {
			toaster.error({ title: 'Erro no Download', description: mensagemDeErro(e) });
		} finally {
			loading.hide();
			idProdutividadeBaixando = null;
		}
	}

	async function baixarRelatorioExtra(escala: ResGiseEscalaSelecionavel) {
		idExtraBaixando = escala.id;
		loading.show('Baixando Relatório Extraordinário...');
		try {
			const secId =
				escala.seccional_id === 0 && data.supervisaoExtraUnidadeId != null
					? data.supervisaoExtraUnidadeId
					: escala.seccional_id;
			const url = `/api/gise/${escala.id}/download?format=extraordinario&seccionalId=${secId}`;
			const res = await apiFetchResponse(url);
			baixarBlob(
				await res.blob(),
				`relatorio_extraordinario_${escala.seccional_nome}_${escala.data_inicio}.pdf`
			);
		} catch (e: unknown) {
			toaster.error({ title: 'Erro no Download', description: mensagemDeErro(e) });
		} finally {
			loading.hide();
			idExtraBaixando = null;
		}
	}

	/**
	 * Baixa o comprovante (Termo de Presença) da confirmação de entrada/saída do
	 * próprio policial. O servidor decide a fonte: PDF assinado no R2 (Token A3) ou
	 * geração sob demanda com selo institucional (confirmação em tela).
	 */
	async function baixarTermoPresenca(tipo: 'entrada' | 'saida') {
		const sel = escalaSelecionada;
		if (!sel) return;
		termoBaixando = tipo;
		loading.show('Baixando comprovante de presença...');
		try {
			const res = await apiFetchResponse(`/api/gise/${sel.id}/presenca/termo?tipo=${tipo}`);
			const nome = nomeArquivoContentDisposition(
				res.headers.get('Content-Disposition'),
				`comprovante_presenca_${tipo}_gise_${sel.id}.pdf`
			);
			baixarBlob(await res.blob(), nome);
		} catch (e: unknown) {
			toaster.error({ title: 'Erro no Download', description: mensagemDeErro(e) });
		} finally {
			loading.hide();
			termoBaixando = null;
		}
	}

	return {
		get escalaSelecionada() {
			return escalaSelecionada;
		},
		set escalaSelecionada(v) {
			escalaSelecionada = v;
		},
		get capturandoAssinatura() {
			return capturandoAssinatura;
		},
		set capturandoAssinatura(v) {
			capturandoAssinatura = v;
		},
		/** Carimbo do 1º envio da resposta de produtividade (ou null) — vem do load. */
		get respostaEnviadaEm() {
			return data.respostaEnviadaEm ?? null;
		},
		/** Carimbo da última retificação da resposta de produtividade (ou null). */
		get respostaAtualizadaEm() {
			return data.respostaAtualizadaEm ?? null;
		},
		get baixandoProdutividade() {
			return idProdutividadeBaixando;
		},
		get baixandoExtra() {
			return idExtraBaixando;
		},
		get baixandoTermo() {
			return termoBaixando;
		},
		get statusFilterUrl() {
			return statusFilterUrl;
		},
		get mesFilterUrl() {
			return mesFilterUrl;
		},
		get dataFilterUrl() {
			return dataFilterUrl;
		},
		get tipoFilterUrl() {
			return tipoFilterUrl;
		},
		get modoPeriodo() {
			return modoPeriodo;
		},
		get anoFilterUrl() {
			return anoFilterUrl;
		},
		get cicloFilterUrl() {
			return cicloFilterUrl;
		},
		get anosCiclo() {
			return anosCiclo;
		},
		get temFiltrosHistorico() {
			return temFiltrosHistorico;
		},

		changeDateFilter,
		changeTipoFilter,
		changeModoPeriodo,
		changeCicloFilter,
		limparFiltros,
		selecionarEscala,
		reaplicarEscalaSelecionada,
		sincronizarPresencaAtual,
		salvarEntrada,
		salvarSaida,
		isHorarioLiberado,
		isSaidaLiberada,
		baixarRelatorio,
		baixarRelatorioExtra,
		baixarTermoPresenca
	};
}
