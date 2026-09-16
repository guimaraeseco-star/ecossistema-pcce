/**
 * A largura do container por rota: tabela larga ganha 1408 px, o resto fica na
 * largura de leitura.
 */
import { describe, it, expect } from 'vitest';
import { LARGURA_AMPLA, LARGURA_PADRAO, ehPaginaLarga, larguraDaPagina } from '../largura-pagina';

describe('largura da página', () => {
	it('as telas de tabela larga e suas sub-rotas', () => {
		for (const r of [
			'/unidade',
			'/unidade/99534',
			'/municipios',
			'/municipios/2305506',
			'/municipios/mapa',
			'/servidores',
			'/servidores/123'
		])
			expect(ehPaginaLarga(r), r).toBe(true);
	});

	it('o resto do sistema fica na largura de leitura — inclusive prefixos parecidos', () => {
		for (const r of ['/', '/escalas', '/operacoes/gise', '/unidades', '/valores', '/perfil'])
			expect(ehPaginaLarga(r), r).toBe(false);
		// `/unidades` (cadastro, Super Admin) NÃO é `/unidade`.
		expect(larguraDaPagina('/unidades')).toBe(LARGURA_PADRAO);
		expect(larguraDaPagina('/unidade')).toBe(LARGURA_AMPLA);
	});
});
