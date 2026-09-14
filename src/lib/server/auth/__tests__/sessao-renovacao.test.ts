import { describe, it, expect } from 'vitest';
import { renovaSessao } from '../sessao-renovacao';

describe('renovaSessao (LGPD A14 — aba aberta não renova sozinha)', () => {
	it('o poll de fundo NÃO renova', () => {
		expect(renovaSessao('/api/sync/estado')).toBe(false);
	});

	it('o poll com querystring também não — o match é por caminho', () => {
		// `pathname` nunca traz a query, mas a sub-rota sim: o delimitador é o que
		// impede `/api/sync/estado-detalhado` de herdar a isenção.
		expect(renovaSessao('/api/sync/estado/qualquer')).toBe(false);
		expect(renovaSessao('/api/sync/estado-detalhado')).toBe(true);
	});

	it('ação de gente renova', () => {
		for (const rota of [
			'/escalas',
			'/operacoes/gise/12',
			'/api/policiais/search',
			'/api/escalas/1/preparar-assinatura',
			'/operacoes/produtividade'
		]) {
			expect(renovaSessao(rota), rota).toBe(true);
		}
	});

	it('o default é RENOVAR: rota nova nasce contando como atividade', () => {
		// O contrário (allowlist do que renova) daria logout silencioso em toda
		// tela que alguém esquecesse de declarar.
		expect(renovaSessao('/rota/que/ainda/nao/existe')).toBe(true);
	});

	it('outras rotas de sync, que são ação e não poll, renovam', () => {
		expect(renovaSessao('/api/sync/policiais')).toBe(true);
	});
});
