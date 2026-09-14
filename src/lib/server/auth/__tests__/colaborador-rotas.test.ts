/**
 * A lista fechada do colaborador — o portão do `hooks.server.ts` para a
 * terceira identidade. O que está fora dela é o que um colaborador NÃO pode
 * ver, e a lista de "fora" abaixo é a parte que importa: são as rotas que
 * exigem só sessão e mostrariam a tela de um policial sem papel.
 */
import { describe, it, expect } from 'vitest';
import { colaboradorPodeAcessarRota } from '../colaborador-rotas';

describe('colaboradorPodeAcessarRota', () => {
	it('libera a área dele, o onboarding e o logout', () => {
		for (const r of [
			'/colaborador',
			'/colaborador/',
			'/alterar-senha',
			'/aceitar-termo',
			'/termo',
			'/api/termos',
			'/api/auth/logout'
		]) {
			expect(colaboradorPodeAcessarRota(r), r).toBe(true);
		}
	});

	it('recusa tudo o que só exige sessão e pertence a policial ou admin', () => {
		for (const r of [
			'/',
			'/bem-vindo',
			'/escalas',
			'/escalas/bem-vindo',
			'/perfil',
			'/res-gise',
			'/gise',
			'/painel',
			'/servidores',
			'/unidades',
			'/super-admin',
			'/api/sync/estado',
			'/api/auth/alternar-acesso',
			'/api/auth/solicitar-codigo-assinatura',
			'/api/escalas/1/download',
			'/colaboradores'
		]) {
			expect(colaboradorPodeAcessarRota(r), r).toBe(false);
		}
	});

	it('não casa por prefixo colado: /colaboradores não é /colaborador', () => {
		expect(colaboradorPodeAcessarRota('/colaboradores')).toBe(false);
		expect(colaboradorPodeAcessarRota('/colaborador-x')).toBe(false);
	});
});
