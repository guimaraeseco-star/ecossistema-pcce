/**
 * O RESUMO que o layout entrega a toda página (E59): quantas pendências e
 * notícias não lidas o usuário tem, por cartão da home — é o número do badge
 * nos cartões grandes do Início, nos cartões dos módulos e na barra lateral.
 * Roda a cada navegação, por isso é só contagem: a lista completa mora em
 * `/avisos`.
 */
import { contarNaoLidos, type CaixaDeAvisos } from '$lib/db/avisos';
import type { Database } from '$lib/db/core';
import { colaboradorTemAcesso, isAdminGeral, type UsuarioLogado } from '$lib/auth';
import { unidadesAdministradas } from '$lib/server/policial-permissao';
import { pendenciasDoUsuario } from './pendencias';

export interface ResumoDeAvisos {
	/** Pendências + não lidas, somadas. */
	total: number;
	/** Por cartão da home (`servidores`, `unidade`…). */
	porCartao: Record<string, number>;
	pendencias: number;
	naoLidos: number;
}

/** A caixa que este usuário lê. */
export async function caixaDoUsuario(db: Database, u: UsuarioLogado): Promise<CaixaDeAvisos> {
	// Em IDS (E51): a caixa filtra `avisos.destinatario_unidade_id`, que
	// sobrevive a uma renomeação. A régua é a gêmea exata da de nomes.
	const escopo = await unidadesAdministradas(db, u);
	// `null` é o Super Admin: caixa sem recorte, como o resto do sistema.
	return { adminGeral: isAdminGeral(u), unidades: escopo ? [...escopo] : [] };
}

/** Só quem tem home de módulos tem caixa: Admin Geral, admin de seccional e de unidade. */
export function temCaixaDeAvisos(u: UsuarioLogado | null): boolean {
	return (
		!!u &&
		!u.isSuperAdmin &&
		(isAdminGeral(u) || !!u.papel || colaboradorTemAcesso(u, 'avisos.ler'))
	);
}

/** As contagens do badge. */
export async function resumoDeAvisos(db: Database, u: UsuarioLogado): Promise<ResumoDeAvisos> {
	const [caixa, pendencias] = await Promise.all([
		caixaDoUsuario(db, u),
		pendenciasDoUsuario(db, u)
	]);
	const naoLidos = await contarNaoLidos(db, caixa);
	const porCartao: Record<string, number> = {};
	let nPend = 0;
	for (const p of pendencias) {
		porCartao[p.cartao] = (porCartao[p.cartao] ?? 0) + p.quantidade;
		nPend += p.quantidade;
	}
	let nLidos = 0;
	for (const [cartao, n] of naoLidos) {
		porCartao[cartao] = (porCartao[cartao] ?? 0) + n;
		nLidos += n;
	}
	return { total: nPend + nLidos, porCartao, pendencias: nPend, naoLidos: nLidos };
}
