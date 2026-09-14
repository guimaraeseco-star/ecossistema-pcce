/**
 * PREÂMBULO comum às form actions do editor de plano operacional.
 *
 * Preâmbulo é o trecho que toda action repete antes de mutar: carregar o plano,
 * provar que quem chamou pode agir sobre ele, e amarrar o id filho (equipe,
 * membro) ao plano da URL.
 *
 * Existe pela lição registrada em `/operacoes/gise/[id]/_actions/shared.ts`: escrito à
 * mão em cada action, é onde faltam cópias — lá, três das quatro actions de
 * equipe recusavam escala finalizada e uma não, e nenhuma conferia que a equipe
 * era mesmo daquela GISE. Aqui a conferência de posse é a mesma coisa: o id da
 * equipe e o do membro vêm do FORMULÁRIO, não da URL, e sem amarrá-los ao plano
 * ser Admin Geral bastaria para editar equipe de outro plano por POST direto
 * (a classe do FLW-ESC-002).
 *
 * As três funções abaixo devolvem `{ erro: fail(...) }` em vez de lançar: a
 * action repassa com `if ('erro' in x) return x.erro`, que é o padrão das
 * actions de `/escalas/[id]`.
 */
import { fail, type ActionFailure } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import type { Database } from '$lib/db';
import type { PlanoOperacional, PlanoEquipe } from '$lib/server/schema';
import {
	carregarPlanoParaEdicao,
	carregarEquipeDoPlano,
	carregarMembroDoPlano
} from '$lib/server/planos/permissao';

export type EventoPlano = RequestEvent<{ id: string }>;

/** Recusa pronta para a action repassar. */
type Recusa = { erro: ActionFailure<{ error: string }> };

/**
 * Traduz a `Response` que o portão devolve na `ActionFailure` que a action
 * precisa retornar. Preserva o status (403 de permissão, 404 de inexistente) —
 * achatar tudo em 400 apagaria a diferença que o e2e de autorização verifica.
 */
async function recusaDe(r: Response): Promise<Recusa> {
	let mensagem = 'Sem permissão para este plano operacional.';
	try {
		const corpo = (await r.clone().json()) as { error?: string };
		if (corpo?.error) mensagem = corpo.error;
	} catch {
		// A resposta do portão é sempre JSON; se não for, a mensagem padrão serve.
	}
	return { erro: fail(r.status, { error: mensagem }) };
}

/** O plano da URL, com a permissão já decidida. */
export async function planoDaRota(
	event: EventoPlano
): Promise<{ db: Database; plano: PlanoOperacional } | Recusa> {
	const db = getDB(event.platform);
	const id = Number(event.params.id);
	const acesso = await carregarPlanoParaEdicao(db, id, event.locals.usuario);
	if (acesso instanceof Response) return recusaDe(acesso);
	return { db, plano: acesso.plano };
}

/** O plano MAIS a equipe cujo id veio do formulário, provada como dele. */
export async function equipeDaRota(
	event: EventoPlano,
	equipeId: number
): Promise<{ db: Database; plano: PlanoOperacional; equipe: PlanoEquipe } | Recusa> {
	const base = await planoDaRota(event);
	if ('erro' in base) return base;
	const eq = await carregarEquipeDoPlano(base.db, base.plano.id, equipeId);
	if (eq instanceof Response) return recusaDe(eq);
	return { ...base, equipe: eq.equipe };
}

/** O plano MAIS o membro cujo id veio do formulário, provado como dele. */
export async function membroDaRota(
	event: EventoPlano,
	membroId: number
): Promise<
	{ db: Database; plano: PlanoOperacional; membro: { id: number; equipe_id: number } } | Recusa
> {
	const base = await planoDaRota(event);
	if ('erro' in base) return base;
	const m = await carregarMembroDoPlano(base.db, base.plano.id, membroId);
	if (m instanceof Response) return recusaDe(m);
	return { ...base, membro: m.membro };
}

/** Inteiro do formulário, ou `NaN` — o chamador decide o que fazer com isso. */
export function getInt(fd: FormData, campo: string): number {
	return Number(String(fd.get(campo) ?? '').trim());
}

/** Texto do formulário, aparado e limitado. */
export function getTexto(fd: FormData, campo: string, max: number): string {
	return String(fd.get(campo) ?? '')
		.trim()
		.slice(0, max);
}

/**
 * Texto do formulário, ou `null` quando vazio.
 *
 * Nas colunas de horário e de briefing da equipe, `null` significa HERDA DO
 * PLANO — não "vazio". Esvaziar o campo na tela tem de gravar `null` para a
 * equipe voltar a acompanhar o plano; gravar `''` a congelaria num valor em
 * branco, e o Anexo I sairia sem horário.
 */
export function getTextoOuNulo(fd: FormData, campo: string, max: number): string | null {
	const s = getTexto(fd, campo, max);
	return s === '' ? null : s;
}
