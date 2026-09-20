/**
 * Afastamento × férias (decisão de 20/09): nos dois sentidos, impede.
 */
import { describe, it, expect } from 'vitest';
import {
	conflitosDasFerias,
	conflitosDoAfastamento,
	ocupadosDoHistorico,
	periodosSobrepoem
} from '../conflitos';

const ocupados = ocupadosDoHistorico([
	{ tipo: 'afastamento', subtipo: 'ferias', data_inicio: '2026-10-01', data_fim: '2026-10-10' },
	{ tipo: 'afastamento', subtipo: 'lts', data_inicio: '2026-11-03', data_fim: '2026-11-12' },
	{ tipo: 'afastamento', subtipo: 'cessao', data_inicio: '2027-01-01', data_fim: null },
	{ tipo: 'movimentacao', subtipo: null, data_inicio: null, data_fim: null }
]);

describe('sobreposição', () => {
	it('inclusiva nas pontas; fim nulo é em aberto', () => {
		expect(
			periodosSobrepoem(
				{ inicio: '2026-10-10', fim: '2026-10-20' },
				{ inicio: '2026-10-01', fim: '2026-10-10' }
			)
		).toBe(true);
		expect(
			periodosSobrepoem(
				{ inicio: '2026-10-11', fim: '2026-10-20' },
				{ inicio: '2026-10-01', fim: '2026-10-10' }
			)
		).toBe(false);
		expect(
			periodosSobrepoem(
				{ inicio: '2028-05-01', fim: '2028-05-02' },
				{ inicio: '2027-01-01', fim: null }
			)
		).toBe(true);
	});
});

describe('afastamento contra férias', () => {
	it('abranger férias programadas é erro; os demais afastamentos não contam aqui', () => {
		const c = conflitosDoAfastamento({ inicio: '2026-10-05', fim: '2026-10-20' }, ocupados);
		expect(c).toHaveLength(1);
		expect(c[0].nivel).toBe('erro');
		expect(c[0].texto).toContain('férias de 01/10/2026 a 10/10/2026');
		expect(conflitosDoAfastamento({ inicio: '2026-10-11', fim: null }, ocupados)).toEqual([]);
	});
});

describe('férias contra afastamentos', () => {
	it('cair dentro de LTS ou de cessão em aberto é erro; as férias já registradas não contam', () => {
		const c = conflitosDasFerias(
			[
				{ inicio: '2026-10-01', fim: '2026-10-10' }, // as próprias férias: ignoradas
				{ inicio: '2026-11-10', fim: '2026-11-19' }, // LTS
				{ inicio: '2027-02-01', fim: '2027-02-10' } // cessão em aberto
			],
			ocupados
		);
		expect(c.map((x) => x.texto)).toEqual([
			'2ª fração (10/11/2026 a 19/11/2026) coincide com Tratamento de saúde (LTS ordinária) de 03/11/2026 a 12/11/2026.',
			'3ª fração (01/02/2027 a 10/02/2027) coincide com Cessão a outro órgão de 01/01/2027 (em aberto).'
		]);
	});
});
