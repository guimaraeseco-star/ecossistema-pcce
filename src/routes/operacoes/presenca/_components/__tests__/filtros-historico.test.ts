import { describe, expect, it } from 'vitest';
import {
	historicoTemFiltroAlemDoPadrao,
	linhaResGisePassaTipo,
	parseFiltrosHistoricoResGise,
	recorteIsoDataInicio
} from '../filtros-historico';

function params(qs: string): URLSearchParams {
	return new URLSearchParams(qs);
}

const HOJE = '2026-08-22';
const VAZIO = {
	mes: '',
	data: '',
	tipo: '' as const,
	periodo: 'ciclo' as const,
	ano: null,
	ciclo: null
};

describe('parseFiltrosHistoricoResGise', () => {
	it('sem query e sem hojeISO não inventa recorte', () => {
		expect(parseFiltrosHistoricoResGise(params(''))).toEqual(VAZIO);
	});

	it('sem query no histórico preenche o ciclo corrente (21/ago abre o 9)', () => {
		expect(parseFiltrosHistoricoResGise(params(''), HOJE)).toEqual({
			...VAZIO,
			ano: 2026,
			ciclo: 9
		});
	});

	it('aceita mês civil e tipo de equipe', () => {
		expect(parseFiltrosHistoricoResGise(params('mes=2026-08&tipo=seint'))).toEqual({
			...VAZIO,
			mes: '2026-08',
			tipo: 'seint',
			periodo: 'mes'
		});
	});

	it('periodo=mes sem mês preenche o mês corrente', () => {
		expect(parseFiltrosHistoricoResGise(params('periodo=mes'), HOJE)).toEqual({
			...VAZIO,
			mes: '2026-08',
			periodo: 'mes'
		});
	});

	it('data exata impõe o modo personalizado', () => {
		expect(parseFiltrosHistoricoResGise(params('data=2026-08-03'))).toMatchObject({
			data: '2026-08-03',
			periodo: 'data'
		});
	});

	it('personalizado sem data preenche o dia corrente', () => {
		expect(parseFiltrosHistoricoResGise(params('periodo=data'), HOJE)).toEqual({
			...VAZIO,
			data: HOJE,
			periodo: 'data'
		});
	});

	it('ciclo sem ano/número preenche o ciclo corrente (21/ago abre o 9)', () => {
		expect(parseFiltrosHistoricoResGise(params('periodo=ciclo'), HOJE)).toEqual({
			...VAZIO,
			periodo: 'ciclo',
			ano: 2026,
			ciclo: 9
		});
	});

	it('aceita ano e ciclo explícitos', () => {
		expect(parseFiltrosHistoricoResGise(params('periodo=ciclo&ano=2026&ciclo=1'))).toEqual({
			...VAZIO,
			periodo: 'ciclo',
			ano: 2026,
			ciclo: 1
		});
	});

	it('ano/ciclo sem mes nem data ficam no modo ciclo (o padrão)', () => {
		expect(parseFiltrosHistoricoResGise(params('ano=2026&ciclo=1'))).toEqual({
			...VAZIO,
			periodo: 'ciclo',
			ano: 2026,
			ciclo: 1
		});
	});

	it('periodo=mes ignora ano/ciclo residuais', () => {
		expect(parseFiltrosHistoricoResGise(params('periodo=mes&ano=2026&ciclo=9'), HOJE)).toEqual({
			...VAZIO,
			mes: '2026-08',
			periodo: 'mes'
		});
	});

	it('descarta mês, data e tipo inválidos', () => {
		expect(
			parseFiltrosHistoricoResGise(params('mes=08-2026&data=03/08/2026&tipo=supervisor'))
		).toEqual(VAZIO);
	});
});

describe('historicoTemFiltroAlemDoPadrao', () => {
	it('ciclo corrente sem tipo é o padrão', () => {
		expect(
			historicoTemFiltroAlemDoPadrao({ ...VAZIO, periodo: 'ciclo', ano: 2026, ciclo: 9 }, HOJE)
		).toBe(false);
	});

	it('tipo, mês, data ou outro ciclo saem do padrão', () => {
		expect(
			historicoTemFiltroAlemDoPadrao(
				{ ...VAZIO, periodo: 'ciclo', ano: 2026, ciclo: 9, tipo: 'seint' },
				HOJE
			)
		).toBe(true);
		expect(historicoTemFiltroAlemDoPadrao({ ...VAZIO, periodo: 'mes', mes: '2026-08' }, HOJE)).toBe(
			true
		);
		expect(historicoTemFiltroAlemDoPadrao({ ...VAZIO, data: HOJE, periodo: 'data' }, HOJE)).toBe(
			true
		);
		expect(
			historicoTemFiltroAlemDoPadrao({ ...VAZIO, periodo: 'ciclo', ano: 2026, ciclo: 1 }, HOJE)
		).toBe(true);
	});
});

describe('recorteIsoDataInicio', () => {
	it('mês civil vira prefixo YYYY-MM', () => {
		expect(recorteIsoDataInicio({ ...VAZIO, periodo: 'mes', mes: '2026-08' })).toEqual({
			tipo: 'prefix',
			valor: '2026-08'
		});
	});

	it('ciclo 1 de 2026 é 21/dez/2025 a 20/jan/2026', () => {
		expect(recorteIsoDataInicio({ ...VAZIO, periodo: 'ciclo', ano: 2026, ciclo: 1 })).toEqual({
			tipo: 'intervalo',
			inicio: '2025-12-21',
			fim: '2026-01-20'
		});
	});

	it('ciclo 9 de 2026 é 21/ago a 20/set', () => {
		expect(recorteIsoDataInicio({ ...VAZIO, periodo: 'ciclo', ano: 2026, ciclo: 9 })).toEqual({
			tipo: 'intervalo',
			inicio: '2026-08-21',
			fim: '2026-09-20'
		});
	});

	it('data exata não cai no mês mesmo se mes vier preenchido', () => {
		expect(
			recorteIsoDataInicio({
				...VAZIO,
				periodo: 'data',
				mes: '2026-08',
				data: '2026-08-22'
			})
		).toEqual({ tipo: 'eq', valor: '2026-08-22' });
	});
});

describe('linhaResGisePassaTipo', () => {
	it('sem tipo deixa passar qualquer papel', () => {
		expect(linhaResGisePassaTipo('supervisor', '')).toBe(true);
		expect(linhaResGisePassaTipo('assessor', '')).toBe(true);
		expect(linhaResGisePassaTipo('operacional', '')).toBe(true);
	});

	it('operacional e SEINT não incluem quadro de supervisão', () => {
		expect(linhaResGisePassaTipo('operacional', 'operacional')).toBe(true);
		expect(linhaResGisePassaTipo('seint', 'seint')).toBe(true);
		expect(linhaResGisePassaTipo('seint', 'operacional')).toBe(false);
		expect(linhaResGisePassaTipo('assessor', 'seint')).toBe(false);
		expect(linhaResGisePassaTipo('supervisor', 'operacional')).toBe(false);
	});
});
