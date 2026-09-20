/**
 * O catálogo de afastamentos como REGRA, não só como lista: o prazo que cada
 * tipo trava, o que a unidade pode lançar e o NUP de 17 dígitos. É o que o
 * modal mostra e a action reaplica — as duas leem daqui, e é por isso que a
 * regra se testa uma vez.
 */
import { describe, it, expect } from 'vitest';
import {
	AFASTAMENTOS,
	conferirNup,
	regraDePrazo,
	SUBTIPOS_CADASTRAVEIS,
	subtiposPorCategoria
} from '../afastamentos';

describe('prazo por tipo (tabela do responsável, 20/09)', () => {
	it('os fixos: casamento 8, luto 8 e 2, paternidade 20, adotante 180', () => {
		expect(regraDePrazo('casamento').diasFixos).toBe(8);
		expect(regraDePrazo('luto').diasFixos).toBe(8);
		expect(regraDePrazo('luto_colateral').diasFixos).toBe(2);
		expect(regraDePrazo('paternidade').diasFixos).toBe(20);
		expect(regraDePrazo('adotante').diasFixos).toBe(180);
	});

	it('maternidade: 120, ou 180 quando a servidora pediu a prorrogação', () => {
		expect(regraDePrazo('maternidade').diasFixos).toBe(120);
		expect(regraDePrazo('maternidade', true).diasFixos).toBe(180);
		// O adicional só existe onde há prorrogação.
		expect(regraDePrazo('casamento', true).diasFixos).toBe(8);
	});

	it('LTS exige o CID; estudante e dispensa de ponto não têm prazo; os demais o usuário informa', () => {
		expect(regraDePrazo('lts')).toEqual({
			diasFixos: null,
			semPrazo: false,
			exigeCid: true,
			soGestao: false
		});
		expect(regraDePrazo('estudante').semPrazo).toBe(true);
		expect(regraDePrazo('dispensa_ponto').semPrazo).toBe(true);
		expect(regraDePrazo('lip').diasFixos).toBeNull();
	});
});

describe('quem lança o quê', () => {
	it('férias e os valores legados não se cadastram', () => {
		expect(SUBTIPOS_CADASTRAVEIS).not.toContain('ferias');
		expect(SUBTIPOS_CADASTRAVEIS).not.toContain('licenca_medica');
		expect(SUBTIPOS_CADASTRAVEIS).not.toContain('judicial');
	});

	it('as medidas disciplinares só aparecem para a gestão', () => {
		const unidade = subtiposPorCategoria(false).flatMap((g) => g.subtipos);
		const gestao = subtiposPorCategoria(true).flatMap((g) => g.subtipos);
		for (const s of ['afastamento_preventivo', 'suspensao', 'prisao_denuncia', 'condenacao']) {
			expect(unidade).not.toContain(s);
			expect(gestao).toContain(s);
			expect(AFASTAMENTOS[s as keyof typeof AFASTAMENTOS].soGestao).toBe(true);
		}
		// A unidade não vê a categoria vazia.
		expect(subtiposPorCategoria(false).map((g) => g.categoria)).not.toContain('disciplinar');
		expect(subtiposPorCategoria(true).map((g) => g.categoria)).toEqual([
			'curta',
			'licenca',
			'particular',
			'mandato',
			'disciplinar',
			'outros'
		]);
	});
});

describe('NUP de 17 dígitos', () => {
	it('aceita pontuado ou só dígitos e devolve a forma pontuada', () => {
		expect(conferirNup('10051.028034/2026-64', true)).toEqual({
			ok: true,
			digitos: '10051028034202664',
			formatado: '10051.028034/2026-64'
		});
		expect(conferirNup('10051028034202664', true)).toMatchObject({
			formatado: '10051.028034/2026-64'
		});
	});

	it('recusa o vazio quando obrigatório e a quantidade errada de dígitos', () => {
		expect(conferirNup('', true).ok).toBe(false);
		expect(conferirNup('', false)).toEqual({ ok: true, digitos: '', formatado: '' });
		const r = conferirNup('123', true);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.erro).toContain('3');
	});
});
