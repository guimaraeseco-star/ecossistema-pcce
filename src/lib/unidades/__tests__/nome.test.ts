/** O nome curto das unidades do DPI Sul, como as tabelas as mostram. */
import { describe, it, expect } from 'vitest';
import { nomeCurtoDeUnidade } from '../nome';

describe('nomeCurtoDeUnidade', () => {
	it('encurta o prefixo conhecido e preserva o ordinal e o lugar', () => {
		expect(nomeCurtoDeUnidade('Delegacia de Polícia Civil de Milagres')).toBe('DP de Milagres');
		expect(nomeCurtoDeUnidade('1ª Delegacia de Polícia Civil de Juazeiro do Norte')).toBe(
			'1ª DP de Juazeiro do Norte'
		);
		expect(nomeCurtoDeUnidade('Unidade de Atendimento de Aiuaba')).toBe('UA de Aiuaba');
		expect(nomeCurtoDeUnidade('Departamento de Polícia do Interior Sul - Juazeiro')).toBe(
			'Depto. do Interior Sul - Juazeiro'
		);
	});

	it('sigla vence; nome sem prefixo conhecido fica como está', () => {
		expect(nomeCurtoDeUnidade('Departamento de Polícia do Interior Sul', 'DPI SUL')).toBe(
			'DPI SUL'
		);
		expect(nomeCurtoDeUnidade('2ª Seccional do Interior Sul')).toBe('2ª Seccional do Interior Sul');
		expect(nomeCurtoDeUnidade('Núcleo de Homicídios')).toBe('Núcleo de Homicídios');
		expect(nomeCurtoDeUnidade('  ')).toBe('');
	});
});
