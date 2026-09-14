/**
 * Módulos do console de Admin Geral — Escalas ordinárias e GISE (extra).
 *
 * São PERMISSÃO (vivem em `administradores.modulo_*`), não a preferência de
 * tela do cookie `admin_modulo`. O cookie só escolhe qual grupo mostrar quando
 * a conta tem os dois; quem tem um módulo só fica preso nele.
 *
 * Super Admin ignora as colunas: o console dele é outro (`/super-admin`), e
 * as flags na sessão vêm sempre ligadas para não barrar rotas compartilhadas.
 */
import { pathnameNoEscopo } from './onboarding-gates';

export type ModulosAdmin = { escalas: boolean; gise: boolean };

/** Preferência de tela (cookie). `'ambas'` = cookie ausente/inválido com os dois. */
export type AdminModuloPreferencia = 'ambas' | 'gise' | 'escalas';

const PREFIXOS_ESCALAS = ['/painel', '/recebidos', '/escalas', '/api/escalas'] as const;

// Desde o PR 1.4b todo o módulo Operações (escala extra, planos, presença,
// produtividade, dados base) mora sob `/operacoes`; um prefixo cobre as telas.
const PREFIXOS_GISE = ['/operacoes', '/api/gise', '/api/produtividade'] as const;

/** Lê as colunas da linha (ou força os dois para Super Admin). */
export function modulosDaContaAdmin(
	linha: { modulo_escalas?: number | boolean | null; modulo_gise?: number | boolean | null },
	isSuperAdmin = false
): ModulosAdmin {
	if (isSuperAdmin) return { escalas: true, gise: true };
	return {
		escalas: Number(linha.modulo_escalas ?? 1) === 1,
		gise: Number(linha.modulo_gise ?? 1) === 1
	};
}

export function temAlgumModulo(m: ModulosAdmin): boolean {
	return m.escalas || m.gise;
}

export function temAmbosModulos(m: ModulosAdmin): boolean {
	return m.escalas && m.gise;
}

/**
 * Escolhe o valor efetivo do cookie a partir do que a conta permite e da
 * preferência pedida (login / cookie antigo / alternância).
 *
 * - Só um módulo → esse módulo (ignora a preferência).
 * - Os dois → preferência `gise`/`escalas` se válida; senão `'ambas'`.
 * - Nenhum → `'escalas'` (estado inválido; o login recusa antes).
 */
export function resolverPreferenciaModulo(
	permitidos: ModulosAdmin,
	preferencia?: string | null
): AdminModuloPreferencia {
	if (permitidos.escalas && !permitidos.gise) return 'escalas';
	if (permitidos.gise && !permitidos.escalas) return 'gise';
	if (!permitidos.escalas && !permitidos.gise) return 'escalas';
	if (preferencia === 'gise' || preferencia === 'escalas') return preferencia;
	return 'ambas';
}

/** Valor a gravar no cookie — espelha a preferência efetiva (pode ser `'ambas'`). */
export function cookieModuloParaGravar(
	permitidos: ModulosAdmin,
	preferencia?: string | null
): AdminModuloPreferencia {
	return resolverPreferenciaModulo(permitidos, preferencia);
}

/** Cookie cru: só `gise`/`escalas`/`ambas` contam; o resto vira `'ambas'`. */
export function preferenciaDoCookie(raw?: string | null): AdminModuloPreferencia {
	if (raw === 'gise' || raw === 'escalas' || raw === 'ambas') return raw;
	return 'ambas';
}

/**
 * Qual módulo a rota exige do Admin Geral. `null` = compartilhada (policiais,
 * auth, perfil…) ou fora dos consoles — não recusa por módulo.
 */
export function moduloExigidoPelaRota(pathname: string): 'escalas' | 'gise' | null {
	for (const p of PREFIXOS_ESCALAS) {
		if (pathnameNoEscopo(pathname, p)) return 'escalas';
	}
	for (const p of PREFIXOS_GISE) {
		if (pathnameNoEscopo(pathname, p)) return 'gise';
	}
	return null;
}

/** A sessão admin pode abrir esta rota? Super Admin e não-admin passam. */
export function adminPodeAcessarRota(
	usuario: {
		tipo?: string;
		isSuperAdmin?: boolean;
		modulosAdmin?: ModulosAdmin | null;
	} | null,
	pathname: string
): boolean {
	if (!usuario || usuario.tipo !== 'admin' || usuario.isSuperAdmin) return true;
	const exigido = moduloExigidoPelaRota(pathname);
	if (!exigido) return true;
	const m = usuario.modulosAdmin ?? { escalas: true, gise: true };
	return exigido === 'escalas' ? m.escalas : m.gise;
}
