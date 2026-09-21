/**
 * O catálogo de acessos do colaborador (E61): a base implícita, o descarte de
 * chave desconhecida e a diferença que vira aviso à unidade.
 */
import { describe, it, expect } from 'vitest';
import {
	CHAVES_DE_ACESSO,
	diferencaDeAcessos,
	ehChaveDeAcesso,
	normalizarAcessos,
	rotuloDoAcesso
} from '../acessos';

describe('normalizarAcessos', () => {
	it('descarta o que não é do catálogo e devolve na ordem do catálogo, sem repetir', () => {
		expect(normalizarAcessos(['avisos.ler', 'x', 'avisos.ler', 'escalas.ver'])).toEqual([
			'escalas.ver',
			'avisos.ler'
		]);
	});

	it('propor afastamento/férias/cadastro traz `servidores.ver` junto — sem ficha não há onde propor', () => {
		expect(normalizarAcessos(['servidores.ferias'])).toEqual([
			'servidores.ver',
			'servidores.ferias'
		]);
		expect(normalizarAcessos(['escalas.ver'])).toEqual(['escalas.ver']);
	});

	it('ehChaveDeAcesso e rótulo', () => {
		expect(CHAVES_DE_ACESSO.every(ehChaveDeAcesso)).toBe(true);
		expect(ehChaveDeAcesso('unidade.direcao')).toBe(false);
		expect(rotuloDoAcesso('escalas.ver')).toBe('Ver as escalas');
	});
});

describe('diferencaDeAcessos', () => {
	it('diz o que a unidade concedeu e o que retirou', () => {
		expect(
			diferencaDeAcessos(['servidores.ver', 'avisos.ler'], ['servidores.ver', 'escalas.ver'])
		).toEqual({ concedidas: ['escalas.ver'], retiradas: ['avisos.ler'] });
	});
});
