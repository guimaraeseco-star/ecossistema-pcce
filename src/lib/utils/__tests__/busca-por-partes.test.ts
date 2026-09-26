/**
 * A busca por partes do navegador (E76) — a regra que as listas de escolha
 * aplicam enquanto a pessoa digita. Os casos são os nomes reais que motivaram
 * o pedido: achar "2ª Delegacia de Polícia Civil de Juazeiro do Norte" sem
 * digitar o nome inteiro, na ordem, com acento.
 */
import { describe, it, expect } from 'vitest';
import { casaPorPartes, partesDaBusca, semAcentos } from '../busca-por-partes';

const JUAZEIRO = '2ª Delegacia de Polícia Civil de Juazeiro do Norte';

describe('semAcentos', () => {
	it('tira acento e cedilha e põe em minúscula', () => {
		expect(semAcentos('JOSÉ')).toBe('jose');
		expect(semAcentos('Tauá')).toBe('taua');
		expect(semAcentos('Iguatu — AÇÃO')).toBe('iguatu — acao');
	});
});

describe('partesDaBusca', () => {
	it('parte por espaço, ignorando espaço repetido e nas pontas', () => {
		expect(partesDaBusca('  jua   nor ')).toEqual(['jua', 'nor']);
	});

	it('vazio ou só espaço não tem o que buscar', () => {
		expect(partesDaBusca('')).toEqual([]);
		expect(partesDaBusca('   ')).toEqual([]);
	});

	it('guarda no máximo seis pedaços — o mesmo teto do servidor', () => {
		expect(partesDaBusca('a b c d e f g h')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
	});
});

describe('casaPorPartes', () => {
	it('acha por pedaços, fora de ordem, sem acento e sem maiúscula', () => {
		expect(casaPorPartes(JUAZEIRO, 'jua nor')).toBe(true);
		expect(casaPorPartes(JUAZEIRO, 'norte 2ª')).toBe(true);
		expect(casaPorPartes(JUAZEIRO, 'POLICIA juazeiro')).toBe(true);
	});

	it('TODO pedaço tem de aparecer — um que falte recusa', () => {
		expect(casaPorPartes(JUAZEIRO, 'jua crato')).toBe(false);
	});

	it('termo vazio casa com tudo: a lista inteira aparece antes de digitar', () => {
		expect(casaPorPartes(JUAZEIRO, '')).toBe(true);
		expect(casaPorPartes(JUAZEIRO, '  ')).toBe(true);
	});

	it('com vários textos, cada pedaço pode estar em um diferente', () => {
		// O posto e o nome da mãe: "fortim aracati" acha o posto de Fortim
		// porque a mãe dele é Aracati.
		const posto = ['POSTO DE FORTIM', 'DELEGACIA REGIONAL DE ARACATI'];
		expect(casaPorPartes(posto, 'fortim aracati')).toBe(true);
		expect(casaPorPartes(posto, 'fortim russas')).toBe(false);
	});

	it('um texto só ou uma lista com um texto dão a mesma resposta', () => {
		expect(casaPorPartes(JUAZEIRO, 'jua')).toBe(casaPorPartes([JUAZEIRO], 'jua'));
	});
});
