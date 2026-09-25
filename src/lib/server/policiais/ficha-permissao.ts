/**
 * O portão da ficha do servidor (`/servidores` e `/servidores/[id]`): quem entra,
 * sobre quem, e com que poder.
 *
 * Três respostas possíveis, e a diferença entre as duas primeiras é o assunto
 * inteiro desta tela:
 *
 *   - **`'direto'`** — Admin Geral. Escopo irrestrito, e o que ele salva ou
 *     registra vale na hora.
 *   - **`'solicitacao'`** — administrador de seccional ou de unidade, dentro do
 *     escopo dele. Vê a mesma ficha, mas nada do que ele submete muda o cadastro:
 *     vira pedido para o Admin Geral decidir.
 *   - **`'solicitacao'`** também para o COLABORADOR lotado (E61): entra com a
 *     chave `servidores.ver` e cada action diz, em `acessoExigido`, qual chave
 *     do catálogo ela exige dele — sem a chave, 403. Para policial e admin o
 *     parâmetro é indiferente.
 *   - recusa, para todo o resto.
 *
 * O modo é decidido AQUI, uma vez, e não em cada action. Enquanto cada uma
 * decidisse por conta própria, bastaria uma esquecer para o administrador de
 * unidade gravar direto o que as outras só pedem — a forma exata dos gates de
 * assinatura que divergiram em cinco cópias (ver `CLAUDE.md`).
 *
 * **O escopo é sempre reconferido contra o ALVO.** A tela lista só quem está no
 * escopo, mas o id chega pela URL: sem esta conferência, trocar o número na
 * barra de endereço abriria a ficha de um servidor de outra seccional
 * (FLW-ESC-002, na sua versão de cadastro).
 */

import { fail } from '@sveltejs/kit';
import type { ActionFailure } from '@sveltejs/kit';
import {
	colaboradorTemAcesso,
	isAdminGeral,
	isAdminSeccional,
	isAdminUnidade,
	type UsuarioLogado
} from '$lib/auth';
import type { AcessoDoColaborador } from '$lib/colaboradores/acessos';
import { buscarPolicial, type Database } from '$lib/db';
import type { Policial } from '$lib/server/schema';
import { lotacoesAdministradas, lotacaoNoEscopo } from '$lib/server/policial-permissao';
import { apiError, ErrorCode } from '$lib/server/api';

/** Como as submissões deste usuário sobre este servidor terminam. */
export type ModoFicha = 'direto' | 'solicitacao';

/** O usuário administra ALGUÉM? (não diz quem — para isso, `escopoDaFicha`.) */
export function podeAbrirFichaDePolicial(u: UsuarioLogado | null): boolean {
	return (
		isAdminGeral(u) ||
		isAdminSeccional(u) ||
		isAdminUnidade(u) ||
		colaboradorTemAcesso(u, 'servidores.ver')
	);
}

/** O modo desta sessão. Só o Admin Geral executa direto. */
export function modoDaFicha(u: UsuarioLogado): ModoFicha {
	return isAdminGeral(u) ? 'direto' : 'solicitacao';
}

/**
 * As lotações que este usuário alcança (`null` = irrestrito), ou `null` de
 * recusa — quem chama distingue pelo `podeAbrirFichaDePolicial` anterior.
 */
async function escopoDaFicha(db: Database, u: UsuarioLogado): Promise<Set<string> | null> {
	return lotacoesAdministradas(db, u);
}

/** A recusa do portão, na forma que uma form action devolve. */
export type RecusaDaFicha = ActionFailure<{ error: string }>;

/**
 * A MESMA recusa, na forma que um `+server.ts` devolve.
 *
 * Existe para que a rota de download do anexo não precise reescrever o portão
 * só porque responde JSON em vez de `ActionFailure` — reescrevê-lo seria abrir
 * a segunda cópia de onde as duas passariam a divergir. Os status que o portão
 * produz são fechados (400/403/404), e o mapa cobre exatamente esses.
 */
export function recusaComoResposta(erro: RecusaDaFicha): Response {
	const CODIGO: Record<number, ErrorCode> = {
		400: ErrorCode.VALIDATION,
		403: ErrorCode.FORBIDDEN,
		404: ErrorCode.NOT_FOUND
	};
	return apiError(erro.data.error, erro.status, CODIGO[erro.status] ?? ErrorCode.FORBIDDEN);
}

/** O que o portão devolve quando deixa passar. */
export interface FichaAutorizada {
	u: UsuarioLogado;
	db: Database;
	id: number;
	alvo: Policial;
	modo: ModoFicha;
	/** `null` = irrestrito (Admin Geral). */
	escopo: Set<string> | null;
}

/**
 * Autoriza uma operação sobre a ficha de UM servidor e devolve o contexto dela.
 *
 * Devolve `{ erro }` com o `fail` pronto quando recusa: o chamador só repassa,
 * e o guard de autorização enxerga o 403 pelo nome desta função.
 */
export async function carregarFichaDoPolicial(
	db: Database,
	u: UsuarioLogado | null,
	idBruto: string | undefined,
	acessoExigido: AcessoDoColaborador | null = null
): Promise<FichaAutorizada | { erro: RecusaDaFicha }> {
	if (!u || !podeAbrirFichaDePolicial(u)) {
		return { erro: fail(403, { error: 'Sem permissão para gerir este servidor' }) };
	}
	// O colaborador só faz o que a unidade liberou; action sem chave declarada
	// é action que ele não faz (falha fechado).
	if (u.tipo === 'colaborador' && (!acessoExigido || !colaboradorTemAcesso(u, acessoExigido))) {
		return { erro: fail(403, { error: 'A unidade não liberou esta ação para você.' }) };
	}

	const id = Number(idBruto);
	if (isNaN(id)) return { erro: fail(400, { error: 'ID inválido' }) };

	const alvo = await buscarPolicial(db, id);
	if (!alvo) return { erro: fail(404, { error: 'Policial não encontrado' }) };

	const escopo = await escopoDaFicha(db, u);
	if (!lotacaoNoEscopo(escopo, alvo.lotacao)) {
		return { erro: fail(403, { error: 'Este servidor não está sob a sua administração' }) };
	}

	return { u, db, id, alvo, modo: modoDaFicha(u), escopo };
}
