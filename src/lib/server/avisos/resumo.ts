/**
 * O RESUMO que o layout entrega a toda página (E59): quantas pendências e
 * notícias não lidas o usuário tem, por cartão da home — é o número do badge
 * nos cartões grandes do Início, nos cartões dos módulos e na barra lateral.
 * Roda a cada navegação, por isso é só contagem: a lista completa mora em
 * `/avisos`.
 */
import { contarNaoLidos, type CaixaDeAvisos } from '$lib/db/avisos';
import type { Database } from '$lib/db/core';
import { isAdminGeral, type UsuarioLogado } from '$lib/auth';
import { lotacoesAdministradas } from '$lib/server/policial-permissao';
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
	if (isAdminGeral(u)) return { adminGeral: true, lotacoes: [] };
	const escopo = await lotacoesAdministradas(db, u);
	return { adminGeral: false, lotacoes: escopo ? [...escopo] : [] };
}

/** Só quem tem home de módulos tem caixa: Admin Geral, admin de seccional e de unidade. */
export function temCaixaDeAvisos(u: UsuarioLogado | null): boolean {
	return !!u && !u.isSuperAdmin && (isAdminGeral(u) || !!u.papel);
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
