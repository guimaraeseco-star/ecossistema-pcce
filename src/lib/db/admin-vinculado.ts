/**
 * Vínculo policial ↔ conta Admin Geral: a mesma pessoa loga nos dois papéis
 * com a matrícula. A conta admin não tem senha própria.
 *
 * Os consoles liberados (`modulo_escalas` / `modulo_gise`) moram nesta linha —
 * ver `admin-modulos.ts` e a migração 0065.
 */
import { eq } from 'drizzle-orm';
import { administradores, policiais, unidades } from '../server/schema';
import { gerarSenhaAleatoriaHash } from '../auth';
import type { Database } from './core';
import type { ModulosAdmin } from '../server/auth/admin-modulos';
import { modulosDaContaAdmin, temAlgumModulo } from '../server/auth/admin-modulos';

export type { ModulosAdmin };

/**
 * Admin Geral VINCULADO: cria (ou mantém) uma linha em `administradores`
 * ligada a um policial. A conta admin NÃO tem senha própria — o login de
 * administrador autentica contra as credenciais do policial (mesma senha/
 * e-mail/2FA). `login` = matrícula, então a pessoa loga com a MESMA matrícula
 * escolhendo "Administrador". `senha` recebe um placeholder aleatório (nunca
 * usado). `primeiro_acesso=0`: o policial já se onboardou como servidor.
 *
 * `modulos` default = os dois liberados (comportamento legado). Quem quer
 * liberar só um passa o recorte explícito.
 */
export async function vincularAdminGeral(
	db: Database,
	policial: typeof policiais.$inferSelect,
	modulos: ModulosAdmin = { escalas: true, gise: true },
	/**
	 * O NÓ que a conta vai administrar (E65). Obrigatório na prática — conta
	 * sem nó não opera —, opcional na assinatura só para não quebrar os
	 * chamadores antigos enquanto a tela nova não é o único caminho.
	 */
	unidadeId: number | null = null
): Promise<void> {
	const existente = await db
		.select({ id: administradores.id })
		.from(administradores)
		.where(eq(administradores.policial_id, policial.id))
		.get();
	if (existente) return; // já vinculado — idempotente

	const senhaPlaceholder = await gerarSenhaAleatoriaHash();
	await db.insert(administradores).values({
		login: policial.matricula,
		senha: senhaPlaceholder,
		nome: policial.nome,
		email: policial.email ?? null,
		email_pessoal: policial.email_pessoal ?? null,
		email_pessoal_verificado: policial.email_pessoal_verificado,
		primeiro_acesso: 0,
		policial_id: policial.id,
		modulo_escalas: modulos.escalas ? 1 : 0,
		modulo_gise: modulos.gise ? 1 : 0,
		unidade_id: unidadeId
	});
}

/** Remove a condição de Admin Geral vinculado de um policial. */
export async function desvincularAdminGeral(db: Database, policialId: number): Promise<void> {
	await db.delete(administradores).where(eq(administradores.policial_id, policialId));
}

/** True se o policial tem uma conta Admin Geral vinculada. */
export async function ehAdminGeralVinculado(db: Database, policialId: number): Promise<boolean> {
	const row = await db
		.select({ id: administradores.id })
		.from(administradores)
		.where(eq(administradores.policial_id, policialId))
		.get();
	return !!row;
}

/**
 * Módulos liberados na conta Admin Geral vinculada, ou `null` se não houver
 * vínculo. Usado pela ficha do policial (toggles Escalas / GISE).
 */
export async function buscarModulosAdminVinculado(
	db: Database,
	policialId: number
): Promise<ModulosAdmin | null> {
	const row = await db
		.select({
			modulo_escalas: administradores.modulo_escalas,
			modulo_gise: administradores.modulo_gise
		})
		.from(administradores)
		.where(eq(administradores.policial_id, policialId))
		.get();
	if (!row) return null;
	return modulosDaContaAdmin(row);
}

export type ResultadoToggleModulo = 'ok' | 'nao_vinculado' | 'sem_modulos';

/**
 * Liga/desliga um console na conta vinculada. Recusa deixar os dois desligados
 * — Admin Geral sem módulo nenhum não tem console; quem quer isso remove o
 * vínculo (`desvincularAdminGeral`).
 */
export async function atualizarModuloAdminVinculado(
	db: Database,
	policialId: number,
	modulo: 'escalas' | 'gise',
	ativar: boolean
): Promise<ResultadoToggleModulo> {
	const row = await db
		.select({
			id: administradores.id,
			modulo_escalas: administradores.modulo_escalas,
			modulo_gise: administradores.modulo_gise
		})
		.from(administradores)
		.where(eq(administradores.policial_id, policialId))
		.get();
	if (!row) return 'nao_vinculado';

	const atual = modulosDaContaAdmin(row);
	const proximo: ModulosAdmin =
		modulo === 'escalas'
			? { escalas: ativar, gise: atual.gise }
			: { escalas: atual.escalas, gise: ativar };

	if (!temAlgumModulo(proximo)) return 'sem_modulos';

	await db
		.update(administradores)
		.set({
			modulo_escalas: proximo.escalas ? 1 : 0,
			modulo_gise: proximo.gise ? 1 : 0
		})
		.where(eq(administradores.id, row.id));

	return 'ok';
}

/**
 * Devolve a conta admin (id/nome) vinculada a um policial, ou `undefined`.
 * Usado pela alternância de sessão Usuário → ADM Geral (a pessoa já poderia
 * logar como admin com as mesmas credenciais; aqui só evitamos o relogin).
 */
export async function buscarAdminVinculadoPorPolicial(
	db: Database,
	policialId: number
): Promise<{ id: number; nome: string; modulo_escalas: number; modulo_gise: number } | undefined> {
	return db
		.select({
			id: administradores.id,
			nome: administradores.nome,
			modulo_escalas: administradores.modulo_escalas,
			modulo_gise: administradores.modulo_gise
		})
		.from(administradores)
		.where(eq(administradores.policial_id, policialId))
		.get();
}

/** Uma conta administrativa como a tela do Super Admin a lista (E65). */
export interface ContaAdministrativa {
	id: number;
	login: string;
	nome: string;
	/** O policial vinculado, quando a conta é de alguém do quadro. */
	policial_id: number | null;
	/** O nó que ela administra; `null` = conta que NÃO opera. */
	unidade_id: number | null;
	unidade_nome: string | null;
	modulo_escalas: boolean;
	modulo_gise: boolean;
	created_at: string | null;
}

/**
 * As contas administrativas, para a tela do Super Admin.
 *
 * Inclui as que estão sem nó de propósito: é justamente a conta que não opera
 * que precisa aparecer, para ele dar um nó a ela ou entender por que alguém
 * não consegue entrar.
 */
export async function listarContasAdministrativas(db: Database): Promise<ContaAdministrativa[]> {
	const linhas = await db
		.select({
			id: administradores.id,
			login: administradores.login,
			nome: administradores.nome,
			policial_id: administradores.policial_id,
			unidade_id: administradores.unidade_id,
			unidade_nome: unidades.nome,
			modulo_escalas: administradores.modulo_escalas,
			modulo_gise: administradores.modulo_gise,
			created_at: administradores.created_at
		})
		.from(administradores)
		.leftJoin(unidades, eq(unidades.id, administradores.unidade_id))
		.orderBy(administradores.nome);
	return linhas.map((l) => ({
		...l,
		modulo_escalas: Number(l.modulo_escalas) === 1,
		modulo_gise: Number(l.modulo_gise) === 1
	}));
}

/** Troca o nó que a conta administra. Devolve `false` quando a conta não existe. */
export async function definirNoDaConta(
	db: Database,
	adminId: number,
	unidadeId: number | null
): Promise<boolean> {
	const conta = await db
		.select({ id: administradores.id })
		.from(administradores)
		.where(eq(administradores.id, adminId))
		.get();
	if (!conta) return false;
	await db
		.update(administradores)
		.set({ unidade_id: unidadeId })
		.where(eq(administradores.id, adminId));
	return true;
}
