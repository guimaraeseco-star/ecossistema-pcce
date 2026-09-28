/**
 * As opções das caixas de escolha do cadastro de servidor (E76, etapa 2): o
 * que a caixa precisa receber para mostrar o valor atual e distinguir as
 * opções.
 */
import { describe, it, expect } from 'vitest';
import { opcoesDeClasse } from '../opcoes-cadastro';
import { opcoesDesignacao } from '../opcoes-designacao';

describe('opcoesDeClasse', () => {
	it('oferece as classes do cargo', () => {
		expect(opcoesDeClasse(['A', 'B'], 'A')).toEqual([
			{ value: 'A', label: 'A' },
			{ value: 'B', label: 'B' }
		]);
	});

	it('mantém a classe atual que o cargo não oferece mais, marcada "(Atual)"', () => {
		// Sem ela a caixa não acharia o valor, e o campo apareceria vazio.
		expect(opcoesDeClasse(['A', 'B'], 'ESPECIAL')).toContainEqual({
			value: 'ESPECIAL',
			label: 'ESPECIAL (Atual)'
		});
	});

	it('sem classe atual, nada a acrescentar', () => {
		expect(opcoesDeClasse(['A'], '')).toHaveLength(1);
	});
});

describe('opcoesDesignacao', () => {
	it('id em texto, nome como rótulo e símbolo como detalhe', () => {
		expect(
			opcoesDesignacao([
				{ id: 7, nome: 'Delegado Titular', simbolo: 'DAS-1' },
				{ id: 8, nome: 'Plantão', simbolo: '' }
			])
		).toEqual([
			{ value: '7', label: 'Delegado Titular', detalhe: 'DAS-1' },
			{ value: '8', label: 'Plantão' }
		]);
	});
});
