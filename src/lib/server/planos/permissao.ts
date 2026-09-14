/**
 * Autorização do domínio PLANO OPERACIONAL — o portão único por onde toda
 * operação material do módulo entra.
 *
 * ## Por que UM portão, e não `isAdminGeral(u)` em cada rota
 *
 * A tabela de duplicação do `CLAUDE.md` termina em dois casos que são
 * exatamente este: o gate de assinar escala rodava copiado em cinco `+server.ts`
 * e uma das cópias não recusava escala FDS; o gate de assinar GISE rodava em
 * cinco e divergia em DOIS eixos independentes, cada um numa cópia diferente —
 * e uma delas admitia por POST direto um Admin Geral que a interface nunca
 * ofereceu.
 *
 * O que a extração comprou lá não foi a correção: foi tornar a pergunta
 * FORMULÁVEL. Enquanto eram cinco cópias, não havia o que comparar. Aqui o
 * módulo nasce com um ponto de entrada para que a pergunta "todas as rotas
 * concordam?" não chegue a existir.
 *
 * ## O que este portão exige, hoje
 *
 * **Admin Geral** para tudo em `/gise/planos` — ler, criar, editar, excluir e
 * baixar o PDF. É o que o pedido define: os dados são todos preenchidos pelo
 * Administrador Geral (GISE).
 *
 * `requireAuth` sozinho não serve, e o `CLAUDE.md` diz por quê: provar que há
 * sessão não prova que aquela sessão pode agir sobre aquele recurso. Toda rota
 * do módulo lê um `id` de fora da URL (corpo, `FormData`) — equipe, membro —, e
 * é `carregarEquipeDoPlano`/`carregarMembroDoPlano` que confere se aquele id
 * pertence ao plano da URL. Sem isso, membro de OUTRO plano viraria editável
 * por id, que é exatamente o FLW-ESC-002.
 *
 * A tela de VALORES (`/valores`) não passa por aqui: o gate dela é a
 * sessão de admin (Admin Geral ou Super Admin — decisão E39), conferido no
 * próprio `+page.server.ts`. São gates diferentes de propósito: este é por
 * plano e por participação; aquele, por papel.
 */
import { eq, and } from 'drizzle-orm';
import { planoEquipes, planoEquipeMembros } from '../schema';
import type { PlanoOperacional, PlanoEquipe } from '../schema';
import type { UsuarioLogado } from '$lib/auth';
import { isAdminGeral } from '$lib/auth';
import { buscarPlano, buscarEquipe, type Database } from '$lib/db';
import { forbidden, notFound } from '$lib/server/api';

/**
 * O plano da URL, se este usuário pode agir sobre ele.
 *
 * Devolve a `Response` de recusa pronta — 403 para quem não é Admin Geral, 404
 * para plano inexistente. Nessa ordem: responder 404 a quem não tem permissão
 * revelaria quais ids existem.
 */
export async function carregarPlanoParaEdicao(
	db: Database,
	planoId: number,
	usuario: UsuarioLogado | null | undefined
): Promise<{ plano: PlanoOperacional } | Response> {
	if (!usuario) return forbidden('Sem permissão para o plano operacional.');
	if (!isAdminGeral(usuario)) {
		return forbidden('O plano operacional é restrito ao Administrador Geral.');
	}
	if (!Number.isInteger(planoId) || planoId <= 0) return notFound('Plano operacional');

	const plano = await buscarPlano(db, planoId);
	if (!plano) return notFound('Plano operacional');

	return { plano };
}

/**
 * A equipe, se ela PERTENCE ao plano da URL.
 *
 * O id da equipe vem do formulário, não da rota. Sem esta conferência, um POST
 * direto com o id de uma equipe de outro plano seria aceito: o portão do plano
 * teria dito "sim" (é Admin Geral) e nada mais compararia os dois. É a mesma
 * classe do FLW-ESC-002, em que membro de outra escala virava editável por id.
 */
export async function carregarEquipeDoPlano(
	db: Database,
	planoId: number,
	equipeId: number
): Promise<{ equipe: PlanoEquipe } | Response> {
	if (!Number.isInteger(equipeId) || equipeId <= 0) return notFound('Equipe');
	const equipe = await buscarEquipe(db, equipeId);
	if (!equipe || equipe.plano_id !== planoId) return notFound('Equipe');
	return { equipe };
}

/** O membro, com a equipe dele, se ambos pertencem ao plano da URL. */
export async function carregarMembroDoPlano(
	db: Database,
	planoId: number,
	membroId: number
): Promise<{ membro: { id: number; equipe_id: number; policial_id: number } } | Response> {
	if (!Number.isInteger(membroId) || membroId <= 0) return notFound('Membro');
	const membro = await db
		.select({
			id: planoEquipeMembros.id,
			equipe_id: planoEquipeMembros.equipe_id,
			policial_id: planoEquipeMembros.policial_id
		})
		.from(planoEquipeMembros)
		.innerJoin(planoEquipes, eq(planoEquipes.id, planoEquipeMembros.equipe_id))
		.where(and(eq(planoEquipeMembros.id, membroId), eq(planoEquipes.plano_id, planoId)))
		.get();
	// O join com `plano_equipes` é o que fecha a porta: comparar só
	// `planoEquipeMembros.plano_id` confiaria na coluna denormalizada, e ela é
	// derivada — o vínculo de verdade é o da equipe.
	if (!membro) return notFound('Membro');
	return { membro };
}
