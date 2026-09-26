/**
 * As opções das listas de unidades (E76): o nome da mãe como detalhe, e a
 * unidade técnica fora de toda lista.
 */
import { describe, it, expect } from 'vitest';
import { ehUnidadeTecnica, opcoesDeNomesDeUnidades, opcoesDeUnidades } from '../opcoes';

const SECC = { id: 10, nome: '1ª SECCIONAL', seccional_id: 2 };
const ARACATI = { id: 20, nome: 'DP ARACATI', seccional_id: 10 };
const FORTIM = { id: 30, nome: 'POSTO FORTIM', seccional_id: 20 };
const TECNICA = { id: 1, nome: '__GISE_SUPERVISAO_EXTRA__', seccional_id: null };

describe('ehUnidadeTecnica', () => {
	it('reconhece o nome entre sublinhados duplos, e só ele', () => {
		expect(ehUnidadeTecnica('__GISE_SUPERVISAO_EXTRA__')).toBe(true);
		expect(ehUnidadeTecnica('DP ARACATI')).toBe(false);
		expect(ehUnidadeTecnica('____')).toBe(false);
		expect(ehUnidadeTecnica('__SÓ NO COMEÇO')).toBe(false);
	});
});

describe('opcoesDeUnidades', () => {
	it('valor é o id, e a mãe vem como detalhe quando está na lista', () => {
		expect(opcoesDeUnidades([SECC, ARACATI, FORTIM])).toEqual([
			{ value: 10, label: '1ª SECCIONAL' },
			{ value: 20, label: 'DP ARACATI', detalhe: '1ª SECCIONAL' },
			{ value: 30, label: 'POSTO FORTIM', detalhe: 'DP ARACATI' }
		]);
	});

	it('a mãe pode vir de outra lista — a de todas as unidades', () => {
		expect(opcoesDeUnidades([FORTIM], { maes: [ARACATI, FORTIM] })).toEqual([
			{ value: 30, label: 'POSTO FORTIM', detalhe: 'DP ARACATI' }
		]);
	});

	it('onde a tela grava por nome, o valor é o nome', () => {
		expect(opcoesDeUnidades([ARACATI], { valor: 'nome' })[0].value).toBe('DP ARACATI');
	});

	it('a unidade técnica não aparece', () => {
		expect(opcoesDeUnidades([TECNICA, ARACATI]).map((o) => o.value)).toEqual([20]);
	});
});

describe('opcoesDeNomesDeUnidades', () => {
	it('nome é valor e rótulo; a técnica fica de fora', () => {
		expect(opcoesDeNomesDeUnidades(['DP ARACATI', '__GISE_SUPERVISAO_EXTRA__'])).toEqual([
			{ value: 'DP ARACATI', label: 'DP ARACATI' }
		]);
	});
});
