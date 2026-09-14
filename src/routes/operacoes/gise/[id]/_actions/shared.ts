/**
 * Utilitários e PREÂMBULOS comuns às form actions de `/operacoes/gise/[id]` (equipes,
 * membros, seccionais e unidades).
 *
 * Preâmbulo é o trecho que toda action repete antes de mutar: carregar a GISE,
 * recusar escala finalizada e amarrar o id filho — equipe, seccional — à GISE
 * da URL. Repetido à mão, é onde faltam cópias: três das quatro actions de
 * equipe recusavam `finalizada` e uma não, e nenhuma das quatro conferia que a
 * equipe era mesmo daquela GISE.
 */
import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { buscarGiseEscala } from '$lib/db';
import type { Database } from '$lib/db';
import { giseEquipes, giseMembros, giseSeccionais, policiais } from '$lib/server/schema';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';

/**
 * Quem pode PREENCHER uma seccional da GISE: o Admin Geral, em qualquer uma, e
 * o admin da própria seccional, só na dela.
 *
 * Até ago/2026 as actions que preenchem seccional — `adicionarMembro`,
 * `removerMembro`, `finalizarSeccional`, `salvarHorariosSec` e
 * `selecionarUnidade` — escreviam cada uma a METADE de baixo desta regra:
 *
 *     if (isAdminSeccional(u) && u.papel_unidade_id !== sec.seccional_id)
 *         return fail(403, ...)
 *
 * O 403 só disparava para quem JÁ era admin de seccional. Policial comum — de
 * qualquer unidade, sem papel nenhum — atravessava o guard inteiro e montava
 * equipe de seccional alheia por POST direto (FLW-GISE-004). A tela nunca
 * ofereceu isso: `podeEditarMembros` e o botão de horários exigem
 * `isAdminGeral || (isSeccional && a própria seccional)`, e é essa a regra
 * escrita aqui.
 *
 * Cinco call sites da mesma regra. Até 12/ago `selecionarUnidade` ainda
 * inlinava o predicado; as outras quatro já passavam por aqui. Quem ganhar a
 * sexta action não tem como escrever só a metade.
 */
export function podePreencherSeccional(
	u: App.Locals['usuario'],
	seccionalId: number | null | undefined
): boolean {
	if (!u) return false;
	if (isAdminGeral(u)) return true;
	return isAdminSeccional(u) && u.papel_unidade_id != null && u.papel_unidade_id === seccionalId;
}

/**
 * Recusa a form action se quem chamou não é Admin Geral.
 *
 * Devolve o usuário (estreito) ou o `fail(403)`. Anônimo e demais papéis caem
 * no mesmo 403 — a mensagem não distingue de propósito. Quem precisa de 401
 * por sessão ausente confere `!u` ANTES.
 *
 * Uso: `const u = exigirAdminGeral(locals.usuario); if (!('id' in u)) return u;`
 */
export function exigirAdminGeral(u: App.Locals['usuario'], mensagem = 'Apenas Admin Geral') {
	if (!u || !isAdminGeral(u)) return fail(403, { error: mensagem });
	return u;
}

/** Lê um campo do FormData como inteiro; devolve `NaN` quando ausente/inválido. */
export function getInt(fd: FormData, key: string): number {
	const v = fd.get(key);
	if (v === null || v === undefined) return NaN;
	return parseInt(v as string);
}

/** Status em que a GISE ainda é rascunho: montar e remexer a escala é livre. */
const STATUS_FASE_EDICAO = ['em_definicao_supervisor', 'em_preenchimento'];

/**
 * A GISE já passou da fase de rascunho?
 *
 * Depois disso o PDF da escala pode ter sido gerado e assinado, então qualquer
 * mudança de composição precisa invalidar o que ficou para trás. O alcance da
 * mudança decide quanto cai — ver `Invalidacao`, em `desfecho.ts`, que é onde
 * as duas formas moram. As duas descartam o documento consolidado; a de
 * alcance seccional descarta também os relatórios e as presenças dela.
 */
export function saiuDaFaseDeEdicao(status: string): boolean {
	return !STATUS_FASE_EDICAO.includes(status);
}

/**
 * Carrega a GISE e recusa o que não pode mais mudar.
 *
 * `finalizada` é terminal: o modal diz "não poderá ser desfeita", e voltar
 * atrás tem um caminho próprio e auditado (`reabrirEscala`). Mutar direto
 * contornava esse caminho — e `salvarSlotsEquipe` chegava a APAGAR o
 * `gise_documentos` da escala assinada e devolvê-la a `em_preenchimento`, sem
 * auditoria e deixando o PDF órfão no R2 (FLW-GISE-006 / FLW-AUT-010).
 *
 * Exportada para actions de escala/seccional/membro que antes só faziam
 * `buscarGiseEscala` e mutavam `finalizada`.
 */
export async function carregarGiseEditavel(db: Database, giseId: number) {
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return { erro: fail(404, { error: 'GISE não encontrada' }) } as const;
	if (gise.status === 'finalizada') {
		return {
			erro: fail(409, {
				error: 'Escala finalizada. Reabra-a antes de alterar a composição.'
			})
		} as const;
	}
	return { gise } as const;
}

/**
 * O mesmo, mais a amarração da EQUIPE à GISE da URL.
 *
 * `atualizarGiseEquipe` e `excluirGiseEquipe` filtram só por `equipes.id`: um
 * `equipeId` de outra GISE no corpo do formulário era aceito, e a mutação caía
 * na equipe alheia enquanto a invalidação de documento caía na GISE da URL —
 * duas escalas erradas de uma vez (FLW-GISE-007). O `innerJoin` abaixo é o que
 * fecha isso, e devolve de quebra a seccional, que as actions já precisavam
 * para revogar assinaturas.
 */
export async function carregarEquipeDaGise(db: Database, giseId: number, equipeId: number) {
	const carga = await carregarGiseEditavel(db, giseId);
	// Reempacotado em vez de repassado: `return carga` deixa o tipo de retorno
	// com o caso `{ gise }` sem `equipe`, e todo chamador precisaria estreitar
	// duas vezes para chegar na seccional.
	if ('erro' in carga) return { erro: carga.erro } as const;

	// Traz também o estado ATUAL da equipe: é o `dados_antes` da trilha, e
	// depois do UPDATE (ou do DELETE) não haveria mais de onde tirá-lo.
	const equipe = await db
		.select({
			id: giseEquipes.id,
			gise_seccional_id: giseEquipes.gise_seccional_id,
			tipo: giseEquipes.tipo,
			slots_dpc: giseEquipes.slots_dpc,
			slots_oip: giseEquipes.slots_oip,
			hora_entrada: giseEquipes.hora_entrada,
			hora_saida: giseEquipes.hora_saida
		})
		.from(giseEquipes)
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.where(and(eq(giseEquipes.id, equipeId), eq(giseSeccionais.gise_id, giseId)))
		.get();

	if (!equipe) return { erro: fail(404, { error: 'Equipe não encontrada nesta escala' }) } as const;
	return { gise: carga.gise, equipe } as const;
}

/** Idem para a SECCIONAL, usada por quem cria equipe dentro dela. */
export async function carregarSeccionalDaGise(db: Database, giseId: number, secId: number) {
	const carga = await carregarGiseEditavel(db, giseId);
	if ('erro' in carga) return { erro: carga.erro } as const;

	const sec = await db
		.select({ id: giseSeccionais.id, seccional_id: giseSeccionais.seccional_id })
		.from(giseSeccionais)
		.where(and(eq(giseSeccionais.id, secId), eq(giseSeccionais.gise_id, giseId)))
		.get();

	if (!sec) return { erro: fail(404, { error: 'Seccional não encontrada nesta escala' }) } as const;
	return { gise: carga.gise, sec } as const;
}

/**
 * Idem para o MEMBRO, a partir do id da linha `gise_membros`.
 *
 * `removerMembro` filtrava só por `giseMembros.id` — o join subia até
 * `gise_seccionais` para descobrir a seccional, mas nada exigia que ela fosse
 * de ESTA GISE. Um `memId` de outra escala era removido enquanto a invalidação
 * de documento e o gate de status caíam na GISE da URL: duas escalas erradas de
 * uma vez, que é a assinatura de FLW-GISE-007.
 *
 * Traz de uma vez o que a action precisa depois do DELETE — nome do policial,
 * equipe e seccional —, porque depois dele a linha não existe mais.
 */
export async function carregarMembroDaGise(db: Database, giseId: number, memId: number) {
	const carga = await carregarGiseEditavel(db, giseId);
	if ('erro' in carga) return { erro: carga.erro } as const;

	const membro = await db
		.select({
			equipe_id: giseMembros.equipe_id,
			policial_id: giseMembros.policial_id,
			policial_nome: policiais.nome,
			gise_seccional_id: giseEquipes.gise_seccional_id,
			seccional_id: giseSeccionais.seccional_id
		})
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(policiais, eq(giseMembros.policial_id, policiais.id))
		.where(and(eq(giseMembros.id, memId), eq(giseSeccionais.gise_id, giseId)))
		.get();

	if (!membro) return { erro: fail(404, { error: 'Membro não encontrado nesta escala' }) } as const;
	return { gise: carga.gise, membro } as const;
}
