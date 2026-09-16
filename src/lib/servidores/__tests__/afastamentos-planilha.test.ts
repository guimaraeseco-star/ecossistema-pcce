/**
 * A planilha de afastamentos: nome sanitizado para o casamento, classificação
 * do campo livre (que também traz movimentações e recados) e sobreposição de
 * períodos — a régua de "é o mesmo afastamento".
 */
import { describe, it, expect } from 'vitest';
import {
	classificarTipoAfastamento,
	nomeSanitizado,
	periodosSeSobrepoem
} from '../afastamentos-planilha';

describe('nomeSanitizado', () => {
	it('tira acento, pontuação e partículas; não junta pessoas diferentes', () => {
		expect(nomeSanitizado('  José   de Souza-Lima ')).toBe('JOSE SOUZA LIMA');
		expect(nomeSanitizado('JOSE SOUSA')).not.toBe(nomeSanitizado('JOSE SOUZA'));
		expect(nomeSanitizado('Maria da Conceição')).toBe(nomeSanitizado('MARIA CONCEICAO'));
		expect(nomeSanitizado('')).toBe('');
	});
});

describe('classificarTipoAfastamento', () => {
	it('afastamentos de verdade, com as grafias erradas da planilha', () => {
		expect(classificarTipoAfastamento('MÉDICO')).toEqual({
			destino: 'afastamento',
			subtipo: 'lts'
		});
		expect(classificarTipoAfastamento('LICENÇA PATERNINDADE')).toEqual({
			destino: 'afastamento',
			subtipo: 'paternidade'
		});
		expect(classificarTipoAfastamento('CASMENTO')).toEqual({
			destino: 'afastamento',
			subtipo: 'casamento'
		});
		expect(classificarTipoAfastamento('NOJO/GALA')).toEqual({
			destino: 'afastamento',
			subtipo: 'luto'
		});
		expect(classificarTipoAfastamento('LICENÇA GESTANTE').subtipo).toBe('maternidade');
		expect(classificarTipoAfastamento('ACOMPANHAMENTO DE FAMILIAR').subtipo).toBe(
			'acompanhamento_familiar'
		);
		expect(classificarTipoAfastamento('DISPENSA DE PONTO').subtipo).toBe('dispensa_ponto');
		expect(classificarTipoAfastamento('INTERESSE PARTICULAR').subtipo).toBe('lip');
	});

	it('pedido de movimentação não é afastamento', () => {
		for (const t of [
			'TRANSFERIR PARA A DDM TAUÁ',
			'TRANSFERID PARA AIS02',
			'MUDAR AIS',
			'PERMUTOU PARA BEBERIBE, GUARAMIRANGA SOLICITADO',
			'TROCAR DO DPI SUL P DPE'
		])
			expect(classificarTipoAfastamento(t), t).toEqual({ destino: 'movimentacao' });
	});

	it('desvinculação, situação funcional e texto solto viram anotação', () => {
		for (const t of [
			'EXONERAÇÃO',
			'PEDIU EXONERAÇÃO',
			'APOSENTADO',
			'DEMISSÃO',
			'FALECIMENTO VER MISP'
		])
			expect(classificarTipoAfastamento(t), t).toEqual({ destino: 'observacao' });
		for (const t of ['APTO COM PORTE', 'RETORNO AO TRABALHO', 'VERIFICAR A DATA', 'RECURSO', ''])
			expect(classificarTipoAfastamento(t), t).toEqual({ destino: 'observacao' });
	});
});

describe('periodosSeSobrepoem', () => {
	it('sobrepostos, encostados e disjuntos; fim vazio é período aberto', () => {
		const a = { inicio: '2026-05-04', fim: '2026-06-02' };
		expect(periodosSeSobrepoem(a, { inicio: '2026-05-20', fim: '2026-06-18' })).toBe(true);
		expect(periodosSeSobrepoem(a, { inicio: '2026-06-02', fim: '2026-06-02' })).toBe(true);
		expect(periodosSeSobrepoem(a, { inicio: '2026-06-03', fim: '2026-06-10' })).toBe(false);
		expect(periodosSeSobrepoem(a, { inicio: '2026-01-01', fim: null })).toBe(true);
	});
});
