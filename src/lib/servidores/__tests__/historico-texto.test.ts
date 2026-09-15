/**
 * Extração de eventos do texto livre da planilha de histórico — os padrões
 * reais (recortados) e o que deve virar anotação.
 */
import { describe, it, expect } from 'vitest';
import { extrairEventos, extrairHistorico, quebrarAnotacoes } from '../historico-texto';

describe('extrairEventos', () => {
	it('férias: uma faixa por período, completando mês e ano pelo fim', () => {
		expect(extrairEventos('FÉRIAS DE 02 A 16/01/2023')).toEqual([
			expect.objectContaining({
				tipo: 'afastamento',
				subtipo: 'ferias',
				data_inicio: '2023-01-02',
				data_fim: '2023-01-16'
			})
		]);
		expect(extrairEventos('SERVIDOR VENDEU AS FÉRIAS 29/09/2026 ATÉ 08/10/2026')[0]).toMatchObject({
			subtipo: 'ferias',
			data_inicio: '2026-09-29',
			data_fim: '2026-10-08'
		});
		expect(extrairEventos('FÉRIAS DE 26/12/2022 A 04/01/2023')[0]).toMatchObject({
			data_inicio: '2022-12-26',
			data_fim: '2023-01-04'
		});
		const varias = extrairEventos(
			'FÉRIAS DE 27/02 A 08/03/2023; 03 A 12/07/2023; 02 A 11/10/2023 - NUP 10051.020279/2026-43'
		);
		expect(varias.map((e) => e.data_inicio)).toEqual(['2023-02-27', '2023-07-03', '2023-10-02']);
		expect(varias[0].nup).toBe('10051.020279/2026-43');
	});

	it('licenças: dias a contar de uma data, ou faixa; subtipo pelo texto', () => {
		expect(
			extrairEventos(
				'LICENÇA MÉDICA DE 60 DIAS, A CONTAR DE 27/02/2025 (NUP 10051.013944/2026-42)'
			)[0]
		).toMatchObject({
			tipo: 'afastamento',
			subtipo: 'lts',
			data_inicio: '2025-02-27',
			data_fim: '2025-04-27',
			nup: '10051.013944/2026-42'
		});
		expect(extrairEventos('ATESTADO 15 DIAS A PARTIR DE 18/04/22')[0]).toMatchObject({
			subtipo: 'lts',
			data_inicio: '2022-04-18',
			data_fim: '2022-05-02'
		});
		expect(extrairEventos('LICENÇA PATERNIDADE DE 16/10 a 04/11/2025')[0]).toMatchObject({
			subtipo: 'paternidade',
			data_inicio: '2025-10-16',
			data_fim: '2025-11-04'
		});
		// Sem data reconhecível: anotação.
		expect(
			extrairEventos('LICENÇA MATERNIDADE COMUNICADA NAS ESCALAS DE JANEIRO A ABRIL/2024')[0].tipo
		).toBe('observacao');
	});

	it('movimentação com data e destino; cessão; curso', () => {
		const mov = extrairEventos(
			'Transferido da DRFVC para o DPISUL em 18/02/22. Portaria 189/22'
		)[0];
		expect(mov).toMatchObject({
			tipo: 'movimentacao',
			data_evento: '2022-02-18',
			unidade_destino: 'DPISUL'
		});
		const mov2 = extrairEventos(
			'SERVIDOR TRANSFERIDO DA DELEGACIA DE IGUATU PARA A DELEGACIA DE ACOPIARA, CONFORME PORTARIA Nº 244/2025-GAB/PCCE, DE 20/05/2025'
		)[0];
		expect(mov2).toMatchObject({
			tipo: 'movimentacao',
			data_evento: '2025-05-20',
			unidade_destino: 'DELEGACIA DE ACOPIARA'
		});
		expect(
			extrairEventos('SERVIDOR CEDIDO À POLÍCIA FEDERAL, PORTARIA Nº 233/2021, DE 09/02/2021')[0]
		).toMatchObject({
			tipo: 'afastamento',
			subtipo: 'cessao',
			data_inicio: '2021-02-09'
		});
		expect(extrairEventos('CURSO DE FORMAÇÃO (01/11/2022 A 10/03/2023)')[0]).toMatchObject({
			subtipo: 'estudante',
			data_inicio: '2022-11-01',
			data_fim: '2023-03-10'
		});
	});

	it('descarta "CARGO ANTIGO"; sustação/reprogramação e texto solto viram anotação com a primeira data', () => {
		expect(extrairEventos('CARGO ANTIGO: EPC.')).toEqual([]);
		const s = extrairEventos(
			'Sustação das férias agendadas para 02 a 11/10/2023, com a reprogramação para 08 a 17/01/2024'
		)[0];
		expect(s.tipo).toBe('observacao');
		expect(s.data_evento).toBe('2023-10-11');
		expect(extrairEventos('AFASTAMENTO ELEITORAL – NUP Nº 10051.027822/2026-33')[0]).toMatchObject({
			tipo: 'observacao',
			nup: '10051.027822/2026-33'
		});
	});

	it('quebra a célula em anotações e junta os eventos', () => {
		const celula =
			'FÉRIAS DE 31/10/2022 A 09/11/2022. FÉRIAS DE 02 A 11/01/2024\nCARGO ANTIGO: EPC.\nLICENÇA DE 15 DIAS A PARTIR DE 10/03/2023';
		expect(quebrarAnotacoes(celula)).toHaveLength(4);
		const ev = extrairHistorico(celula);
		expect(ev.map((e) => e.subtipo)).toEqual(['ferias', 'ferias', 'lts']);
	});
});
