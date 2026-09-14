/**
 * Cliente do endpoint leve `/api/sync/estado` — usado pelo poll de
 * `useInvalidateOnFocus` para só invalidar o `load` quando o carimbo muda.
 *
 * ## Por que existe coalescência aqui
 *
 * Numa tela de detalhe há DOIS pollers: o do badge, montado no layout e
 * presente em toda página, e o da própria tela. Ambos escutam
 * `visibilitychange`, então voltar para a aba dispara os dois no MESMO tick.
 * Medido em Chromium na `/operacoes/gise/[id]`: 3 retornos de foco produziam 6
 * requisições, aos pares `(sem query)` + `?giseId=N`.
 *
 * As duas não são idênticas — e é por isso que descartar a segunda seria
 * errado. O corpo é montado por fatias: a resposta de `?giseId=N` já contém
 * tudo o que a chamada sem query traria (`recebidos`, `painel`, `resGise`,
 * `giseList`) MAIS o campo `gise`. Uma é superconjunto da outra.
 *
 * Então o que se faz é FUNDIR os pedidos do mesmo tick numa requisição só, com
 * a união dos parâmetros, e devolver a mesma promessa aos dois chamadores —
 * cada um lê o campo que lhe interessa. Como o lote se fecha no primeiro
 * microtask, nada é adiado de forma perceptível e nenhum dado velho é servido:
 * não há cache de resposta, só agrupamento do que já ia sair junto.
 *
 * Pedidos com `giseId`/`escalaId` DIFERENTES não podem ser fundidos (o endpoint
 * aceita um de cada) — nesse caso cada um abre o seu lote.
 */
import { apiFetch } from '$lib/api-fetch';

export type SyncEstado = {
	recebidos?: { stamp: string; naoVistos: number };
	escalas?: { stamp: string; pendentes: number };
	gise?: { stamp: string };
	giseList?: { stamp: string };
	painel?: { stamp: string };
	resGise?: { stamp: string };
	escala?: { stamp: string };
};

export type SyncEstadoOpts = { giseId?: number; escalaId?: number };

type Lote = { params: SyncEstadoOpts; promessa: Promise<SyncEstado> };

/** Lote em formação: fecha no próximo microtask. */
let lote: Lote | null = null;

function requisitar(params: SyncEstadoOpts): Promise<SyncEstado> {
	const q = new URLSearchParams();
	if (params.giseId) q.set('giseId', String(params.giseId));
	if (params.escalaId) q.set('escalaId', String(params.escalaId));
	const qs = q.toString();
	return apiFetch<SyncEstado>(`/api/sync/estado${qs ? `?${qs}` : ''}`);
}

/**
 * `a` pode absorver `b`? Só quando, para cada parâmetro, um dos dois é ausente
 * ou os dois são iguais — senão a fusão perderia um dos pedidos.
 */
function fundivel(a: SyncEstadoOpts, b: SyncEstadoOpts): boolean {
	const ok = (x?: number, y?: number) => !x || !y || x === y;
	return ok(a.giseId, b.giseId) && ok(a.escalaId, b.escalaId);
}

/**
 * GET coalescido de `/api/sync/estado`. Pedidos do mesmo tick com parâmetros
 * fundíveis viram uma requisição só (ver cabeçalho do módulo).
 */
export function fetchSyncEstado(opts?: SyncEstadoOpts): Promise<SyncEstado> {
	const pedido: SyncEstadoOpts = {
		...(opts?.giseId ? { giseId: opts.giseId } : {}),
		...(opts?.escalaId ? { escalaId: opts.escalaId } : {})
	};

	if (lote && fundivel(lote.params, pedido)) {
		if (pedido.giseId) lote.params.giseId = pedido.giseId;
		if (pedido.escalaId) lote.params.escalaId = pedido.escalaId;
		return lote.promessa;
	}

	const atual: Lote = { params: pedido, promessa: null as unknown as Promise<SyncEstado> };
	// O `then` de uma promessa já resolvida roda no próximo microtask: essa é a
	// janela em que os demais pedidos do mesmo tick entram no lote.
	atual.promessa = Promise.resolve().then(() => {
		if (lote === atual) lote = null;
		return requisitar(atual.params);
	});
	lote = atual;
	return atual.promessa;
}

/** Descarta o lote em formação — usado entre casos de teste. */
export function _resetLoteSyncEstado() {
	lote = null;
}
