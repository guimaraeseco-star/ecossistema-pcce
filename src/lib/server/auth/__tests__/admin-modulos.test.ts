import { describe, expect, it } from 'vitest';
import {
	modulosDaContaAdmin,
	resolverPreferenciaModulo,
	cookieModuloParaGravar,
	moduloExigidoPelaRota,
	adminPodeAcessarRota,
	temAmbosModulos,
	temAlgumModulo,
	preferenciaDoCookie
} from '../admin-modulos';

describe('modulosDaContaAdmin', () => {
	it('lê as colunas da linha', () => {
		expect(modulosDaContaAdmin({ modulo_escalas: 1, modulo_gise: 0 })).toEqual({
			escalas: true,
			gise: false
		});
		expect(modulosDaContaAdmin({ modulo_escalas: 0, modulo_gise: 1 })).toEqual({
			escalas: false,
			gise: true
		});
	});

	it('Super Admin ignora as colunas', () => {
		expect(modulosDaContaAdmin({ modulo_escalas: 0, modulo_gise: 0 }, true)).toEqual({
			escalas: true,
			gise: true
		});
	});

	it('default legado (ausente) = os dois ligados', () => {
		expect(modulosDaContaAdmin({})).toEqual({ escalas: true, gise: true });
	});
});

describe('resolverPreferenciaModulo', () => {
	it('com um módulo só, ignora a preferência', () => {
		expect(resolverPreferenciaModulo({ escalas: true, gise: false }, 'gise')).toBe('escalas');
		expect(resolverPreferenciaModulo({ escalas: false, gise: true }, 'escalas')).toBe('gise');
	});

	it('com os dois, respeita gise/escalas e cai em ambas', () => {
		const ambos = { escalas: true, gise: true };
		expect(resolverPreferenciaModulo(ambos, 'gise')).toBe('gise');
		expect(resolverPreferenciaModulo(ambos, 'escalas')).toBe('escalas');
		expect(resolverPreferenciaModulo(ambos, null)).toBe('ambas');
		expect(resolverPreferenciaModulo(ambos, 'ambas')).toBe('ambas');
	});
});

describe('preferenciaDoCookie', () => {
	it('só aceita gise/escalas/ambas', () => {
		expect(preferenciaDoCookie('gise')).toBe('gise');
		expect(preferenciaDoCookie('escalas')).toBe('escalas');
		expect(preferenciaDoCookie('ambas')).toBe('ambas');
		expect(preferenciaDoCookie(undefined)).toBe('ambas');
		expect(preferenciaDoCookie('foo')).toBe('ambas');
	});
});

describe('cookieModuloParaGravar', () => {
	it('grava o módulo único quando só um está liberado', () => {
		expect(cookieModuloParaGravar({ escalas: true, gise: false }, 'gise')).toBe('escalas');
	});
});

describe('temAmbosModulos / temAlgumModulo', () => {
	it('distingue os casos', () => {
		expect(temAmbosModulos({ escalas: true, gise: true })).toBe(true);
		expect(temAmbosModulos({ escalas: true, gise: false })).toBe(false);
		expect(temAlgumModulo({ escalas: false, gise: false })).toBe(false);
		expect(temAlgumModulo({ escalas: true, gise: false })).toBe(true);
	});
});

describe('moduloExigidoPelaRota', () => {
	it('mapeia consoles Escalas e GISE', () => {
		expect(moduloExigidoPelaRota('/painel')).toBe('escalas');
		expect(moduloExigidoPelaRota('/recebidos')).toBe('escalas');
		expect(moduloExigidoPelaRota('/escalas/123')).toBe('escalas');
		expect(moduloExigidoPelaRota('/api/escalas/1/download')).toBe('escalas');
		expect(moduloExigidoPelaRota('/gise')).toBe('gise');
		expect(moduloExigidoPelaRota('/gise/operacoes')).toBe('gise');
		expect(moduloExigidoPelaRota('/produtividade')).toBe('gise');
		expect(moduloExigidoPelaRota('/res-gise')).toBe('gise');
		expect(moduloExigidoPelaRota('/api/gise/1/download')).toBe('gise');
	});

	it('rotas compartilhadas não exigem módulo', () => {
		expect(moduloExigidoPelaRota('/servidores')).toBeNull();
		expect(moduloExigidoPelaRota('/solicitacoes')).toBeNull();
		expect(moduloExigidoPelaRota('/api/auth/logout')).toBeNull();
		expect(moduloExigidoPelaRota('/alterar-senha')).toBeNull();
	});
});

describe('adminPodeAcessarRota', () => {
	const soEscalas = {
		tipo: 'admin',
		modulosAdmin: { escalas: true, gise: false }
	};
	const soGise = {
		tipo: 'admin',
		modulosAdmin: { escalas: false, gise: true }
	};

	it('barra o console que a conta não tem', () => {
		expect(adminPodeAcessarRota(soEscalas, '/gise')).toBe(false);
		expect(adminPodeAcessarRota(soEscalas, '/painel')).toBe(true);
		expect(adminPodeAcessarRota(soGise, '/painel')).toBe(false);
		expect(adminPodeAcessarRota(soGise, '/gise')).toBe(true);
	});

	it('Super Admin e não-admin passam', () => {
		expect(
			adminPodeAcessarRota(
				{ tipo: 'admin', isSuperAdmin: true, modulosAdmin: soEscalas.modulosAdmin },
				'/gise'
			)
		).toBe(true);
		expect(adminPodeAcessarRota({ tipo: 'policial' }, '/gise')).toBe(true);
		expect(adminPodeAcessarRota(null, '/gise')).toBe(true);
	});

	it('rotas compartilhadas passam mesmo com um módulo só', () => {
		expect(adminPodeAcessarRota(soEscalas, '/servidores/19')).toBe(true);
	});
});
