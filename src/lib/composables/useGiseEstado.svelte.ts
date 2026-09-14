/**
 * Hook de estados derivados e helpers para a página GISE detalhada.
 * Centraliza permissões, formatação e detecção de dispositivo.
 */

import type { GiseDetalhado } from '$lib/db';
import type { Unidade } from '$lib/types';
import { statusLabel, statusColor } from '$lib/gise/formatters';
import { SvelteDate } from 'svelte/reactivity';
import { useMobile } from './useMobile.svelte';

interface GiseData {
	gise?: GiseDetalhado | null;
	policiais?: unknown[];
	todasUnidades?: Unidade[];
	papelGise?: string;
	minhaSeccionalId?: number | null;
	isGeral?: boolean;
	isSeccional?: boolean;
	isUnidade?: boolean;
	isSupervisor?: boolean;
	isMembro?: boolean;
	usuarioAtual?: { id: number } | null;
}

interface GiseEstadoParams {
	getData: () => GiseData;
}

export function useGiseEstado({ getData }: GiseEstadoParams) {
	const _data = $derived(getData());
	const gise = $derived(_data.gise);
	const policiais = $derived(_data.policiais ?? []);
	const todasUnidades = $derived(_data.todasUnidades ?? []);
	const minhaSeccionalId = $derived(_data.minhaSeccionalId ?? null);

	// Permissões
	const isAdminGeral = $derived(_data.isGeral === true);
	const isSeccional = $derived(_data.isSeccional === true);
	const isUnidade = $derived(_data.isUnidade === true);
	const isSupervisor = $derived(
		_data.isSupervisor === true || gise?.supervisor_id === _data.usuarioAtual?.id
	);
	const isMembro = $derived(_data.isMembro === true);

	const minhaSeccional = $derived(
		isSeccional ? gise?.seccionais?.find((s) => s.seccional_id === minhaSeccionalId) : null
	);

	const todasSeccionaisPreenchidas = $derived(
		(gise?.seccionais?.length ?? 0) > 0 &&
			(gise?.seccionais?.every(
				(s) => s.status === 'preenchida' || s.status === 'preenchida_retificada'
			) ??
				false)
	);

	// NÃO é `escalaGiseJaAssinada` (`$lib/gise/status-escala`): a edição trava um
	// degrau ANTES, já em `aguardando_assinatura` — mexer no quadro enquanto o
	// supervisor assina mudaria o documento debaixo da assinatura. O conjunto
	// parecido é proposital; não unifique com o predicado de "já assinada".
	const editaBloqueado = $derived(
		gise?.status === 'aguardando_assinatura' ||
			gise?.status === 'em_andamento' ||
			gise?.status === 'aguardando_relatorios' ||
			gise?.status === 'aguardando_assinatura_relat' ||
			gise?.status === 'pronta_para_finalizar' ||
			gise?.status === 'finalizada'
	);

	const podeDownload = $derived(isAdminGeral || isSeccional || isSupervisor);
	const podeEditar = $derived(!editaBloqueado);

	// Helpers de data (rótulos/cores de status vêm de `$lib/gise/formatters`)
	function fmtDate(iso: string): string {
		const d = new SvelteDate(iso + 'T00:00:00');
		return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
	}

	function diaSemana(iso: string): string {
		const d = new SvelteDate(iso + 'T00:00:00');
		return d.toLocaleDateString('pt-BR', { weekday: 'long' });
	}

	// Delegado a `useMobile` — não reimplementar aqui. Este composable já teve um
	// `MediaQuery('(min-width: 768px)')` próprio, que divergia do de `useMobile`
	// em 768px e em desktop com toque; como o valor decide a aplicação de
	// `restringirSmartphone`, a mesma restrição de assinatura valia diferente na
	// tela de escalas e na de GISE. O cabeçalho de `useMobile` explica o critério.
	//
	// Havia uma TERCEIRA cópia, em `gise/+page.svelte`, que sobreviveu àquela
	// unificação por não estar no escopo dela: a listagem emitia `?via=token`
	// por largura enquanto `/operacoes/gise/[id]` consumia o param caindo neste `isMobile`
	// quando ele faltava. Resolvida em ago/2026 — a listagem passou a ler
	// `useMobile()` para o fluxo e `useLarguraDesktop()` para o layout do card,
	// que são perguntas diferentes.
	const mobile = useMobile();

	return {
		get gise() {
			return gise;
		},
		get policiais() {
			return policiais;
		},
		get todasUnidades() {
			return todasUnidades;
		},
		get isAdminGeral() {
			return isAdminGeral;
		},
		get isSeccional() {
			return isSeccional;
		},
		get isUnidade() {
			return isUnidade;
		},
		get isSupervisor() {
			return isSupervisor;
		},
		get isMembro() {
			return isMembro;
		},
		get minhaSeccional() {
			return minhaSeccional;
		},
		get minhaSeccionalId() {
			return minhaSeccionalId;
		},
		get todasSeccionaisPreenchidas() {
			return todasSeccionaisPreenchidas;
		},
		get editaBloqueado() {
			return editaBloqueado;
		},
		get podeDownload() {
			return podeDownload;
		},
		get podeEditar() {
			return podeEditar;
		},
		get isMobile() {
			return mobile.isMobile;
		},
		statusLabel,
		statusColor,
		fmtDate,
		diaSemana
	};
}
