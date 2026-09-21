/**
 * O emissor de avisos (E59): quem fez a ação NÃO recebe o aviso dela — recebe
 * o OUTRO LADO. Se o Admin Geral agiu, a notícia vai para a lotação do
 * servidor (a delegacia e, por consequência, a seccional acima); se a ponta
 * agiu, vai para o Admin Geral. É a única regra, e é aqui que ela mora.
 *
 * As actions chamam `avisarOutroLado` depois de gravar e auditar, e o aviso
 * nunca derruba a ação: falhou o aviso, fica o log — a alteração já
 * aconteceu e é isso que a auditoria registra.
 */
import { eq } from 'drizzle-orm';
import { criarAvisos, type NovoAviso } from '$lib/db/avisos';
import { policiais } from '$lib/server/schema';
import type { Database } from '$lib/db/core';
import { isAdminGeral, type UsuarioLogado } from '$lib/auth';
import { logger } from '$lib/server/logger';

export interface AvisoAEmitir {
	/** O cartão da home que acende (`servidores`, `unidade`…). */
	cartao: string;
	tipo: string;
	titulo: string;
	texto?: string;
	/** O lugar exato da alteração. */
	link?: string;
	/**
	 * As lotações alcançadas quando o autor é o Admin Geral (a do servidor;
	 * na movimentação, origem e destino). Sem lotação, ninguém da ponta recebe.
	 */
	lotacoes: readonly (string | null | undefined)[];
}

/** Os destinatários pela regra do outro lado. */
export function destinatariosDe(
	autor: UsuarioLogado,
	aviso: Pick<AvisoAEmitir, 'lotacoes'>
): NovoAviso['destinatario'][] {
	const lotacoes = [...new Set(aviso.lotacoes.filter((l): l is string => !!l))];
	if (isAdminGeral(autor)) {
		return lotacoes.map((lotacao) => ({ tipo: 'lotacao' as const, lotacao }));
	}
	return [{ tipo: 'admin_geral' as const }];
}

/** Emite o aviso para o outro lado. Nunca lança. */
export async function avisarOutroLado(
	db: Database,
	autor: UsuarioLogado,
	aviso: AvisoAEmitir
): Promise<void> {
	try {
		const destinos = destinatariosDe(autor, aviso);
		await criarAvisos(
			db,
			destinos.map((destinatario) => ({
				destinatario,
				cartao: aviso.cartao,
				tipo: aviso.tipo,
				titulo: aviso.titulo,
				texto: aviso.texto,
				link: aviso.link,
				autor: { id: autor.id, nome: autor.nome }
			}))
		);
	} catch (e) {
		logger.warn('[avisos] falha ao emitir aviso', { tipo: aviso.tipo, erro: String(e) });
	}
}

/** Nome e lotação de um servidor, para o título e o destinatário do aviso. */
export async function servidorParaAviso(
	db: Database,
	policialId: number
): Promise<{ nome: string; lotacao: string } | null> {
	const p = await db
		.select({ nome: policiais.nome, lotacao: policiais.lotacao })
		.from(policiais)
		.where(eq(policiais.id, policialId))
		.get();
	return p ?? null;
}
