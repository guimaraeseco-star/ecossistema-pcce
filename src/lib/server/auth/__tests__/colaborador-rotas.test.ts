/**
 * A lista fechada do colaborador — o portão do `hooks.server.ts` para a
 * terceira identidade. O que está fora dela é o que um colaborador NÃO pode
 * ver, e a lista de "fora" abaixo é a parte que importa: são as rotas que
 * exigem só sessão e mostrariam a tela de um policial sem papel.
 */
import { describe, it, expect } from 'vitest';
import { colaboradorPodeAcessarRota } from '../colaborador-rotas';
import type { UsuarioLogado } from '$lib/auth';

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
			'/operacoes/presenca',
			'/operacoes/gise',
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

describe('o que a unidade libera (E61)', () => {
	const colab = (acessos: string[]): UsuarioLogado => ({
		id: 7,
		tipo: 'colaborador',
		nome: 'Ana',
		primeiro_acesso: false,
		papel_unidade_id: 10,
		lotacao: 'DP de Aurora',
		acessos: acessos as UsuarioLogado['acessos']
	});

	it('sem chave, nada além da base — mesmo lotado', () => {
		const u = colab([]);
		for (const r of ['/servidores', '/servidores/1', '/avisos', '/escalas/1', '/unidade/10']) {
			expect(colaboradorPodeAcessarRota(r, u), r).toBe(false);
		}
		expect(colaboradorPodeAcessarRota('/colaborador', u)).toBe(true);
	});

	it('servidores.ver abre a lista, a ficha, os anexos e a ficha da unidade — não o upload', () => {
		const u = colab(['servidores.ver']);
		for (const r of [
			'/servidores',
			'/servidores/165',
			'/api/policiais/historico/12/documento',
			'/api/policiais/solicitacoes/3/documento',
			'/unidade/10',
			'/api/unidades/10/foto'
		]) {
			expect(colaboradorPodeAcessarRota(r, u), r).toBe(true);
		}
		for (const r of [
			'/servidores/upload',
			'/unidade/10/ferias',
			'/escalas/1',
			'/avisos',
			'/unidade'
		]) {
			expect(colaboradorPodeAcessarRota(r, u), r).toBe(false);
		}
	});

	it('escalas.ver abre só a escala pelo id — nunca a lista dos admins nem a criação', () => {
		const u = colab(['escalas.ver']);
		expect(colaboradorPodeAcessarRota('/escalas/42', u)).toBe(true);
		expect(colaboradorPodeAcessarRota('/colaborador/escalas', u)).toBe(true);
		for (const r of ['/escalas', '/escalas/nova', '/escalas/42/x', '/api/escalas/42/download']) {
			expect(colaboradorPodeAcessarRota(r, u), r).toBe(false);
		}
	});

	it('avisos.ler e servidores.ferias abrem as rotas delas', () => {
		expect(colaboradorPodeAcessarRota('/avisos', colab(['avisos.ler']))).toBe(true);
		expect(colaboradorPodeAcessarRota('/unidade/10/ferias', colab(['servidores.ferias']))).toBe(
			true
		);
	});
});
