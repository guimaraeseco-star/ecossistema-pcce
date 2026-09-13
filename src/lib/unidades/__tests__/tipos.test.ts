import { describe, it, expect } from 'vitest';
import {
	TIPOS_UNIDADE,
	TIPO_UNIDADE_VALORES,
	TIPOS_UNIDADE_LEGADOS,
	rotuloTipoUnidade,
	nivelTipoUnidade,
	podeSerPaiDe,
	abrangenciaPadrao
} from '../tipos';

describe('catálogo de tipos de unidade', () => {
	it('mantém os quatro tipos legados e cobre o organograma', () => {
		for (const t of TIPOS_UNIDADE_LEGADOS) expect(TIPO_UNIDADE_VALORES).toContain(t);
		expect(TIPO_UNIDADE_VALORES).toContain('delegacia_geral');
		expect(TIPO_UNIDADE_VALORES).toContain('coordenadoria');
		expect(TIPO_UNIDADE_VALORES).toContain('secao');
		expect(new Set(TIPO_UNIDADE_VALORES).size).toBe(TIPOS_UNIDADE.length);
	});

	it('rotula o que conhece e devolve o valor cru para o que não conhece', () => {
		expect(rotuloTipoUnidade('sub_departamento')).toBe('Subdepartamento');
		expect(rotuloTipoUnidade('delegacia_geral')).toBe('Delegacia-Geral');
		expect(rotuloTipoUnidade('inexistente')).toBe('inexistente');
	});

	it('pai precisa estar acima na precedência — nunca no mesmo nível', () => {
		expect(podeSerPaiDe('departamento', 'seccional')).toBe(true);
		// departamento especializado liga delegacia direto a si
		expect(podeSerPaiDe('departamento', 'delegacia')).toBe(true);
		expect(podeSerPaiDe('delegacia_geral', 'departamento')).toBe(true);
		expect(podeSerPaiDe('coordenadoria', 'celula')).toBe(true);
		expect(podeSerPaiDe('celula', 'secao')).toBe(false);
		expect(podeSerPaiDe('delegacia', 'departamento')).toBe(false);
		expect(podeSerPaiDe('seccional', 'seccional')).toBe(false);
	});

	it('tipo desconhecido vai para o fim e não pode ser pai de ninguém conhecido', () => {
		expect(nivelTipoUnidade('inexistente')).toBe(99);
		expect(podeSerPaiDe('inexistente', 'unidade')).toBe(false);
	});

	it('órgãos de direção e instrumentais nascem corporativos; o resto, departamental', () => {
		expect(abrangenciaPadrao('delegacia_geral')).toBe('corporativa');
		expect(abrangenciaPadrao('coordenadoria')).toBe('corporativa');
		expect(abrangenciaPadrao('corregedoria')).toBe('corporativa');
		expect(abrangenciaPadrao('departamento')).toBe('departamental');
		expect(abrangenciaPadrao('delegacia')).toBe('departamental');
		expect(abrangenciaPadrao('inexistente')).toBe('departamental');
	});
});
