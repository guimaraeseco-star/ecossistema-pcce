/**
 * As regras de férias contra os casos que a COGEP devolve.
 *
 * O que vale mais aqui é o classificador: sustação × suspensão é a confusão
 * que faz o pedido chegar errado, e a resposta tem de sair dos FATOS (a fração
 * começou?), nunca de uma escolha do usuário.
 */
import { describe, it, expect } from 'vitest';
import {
	classificarReprogramacao,
	conferirAbono,
	conferirNovoPeriodo,
	criteriosDaSuspensao,
	fracionamentoValido,
	impedimentosDoAbono,
	janelaDeGozo,
	periodoAquisitivo,
	periodoGozadoComAbono,
	statusPelaData,
	temErro,
	textoDoOficio,
	type Fracao
} from '../ferias';

const fracao = (ordem: 1 | 2 | 3, inicio: string, fim: string): Fracao => ({
	ordem,
	data_inicio: inicio,
	data_fim: fim,
	status: 'programada'
});

describe('fracionamento (Dec. 32.907, art. 3º § 1º)', () => {
	it('aceita só as cinco formas, na ordem', () => {
		expect(fracionamentoValido([30])).toBe(true);
		expect(fracionamentoValido([10, 20])).toBe(true);
		expect(fracionamentoValido([20, 10])).toBe(true);
		expect(fracionamentoValido([15, 15])).toBe(true);
		expect(fracionamentoValido([10, 10, 10])).toBe(true);
	});

	it('recusa o que não está na lista', () => {
		expect(fracionamentoValido([5, 25])).toBe(false);
		expect(fracionamentoValido([15, 10, 5])).toBe(false);
		expect(fracionamentoValido([20, 20])).toBe(false);
		expect(fracionamentoValido([])).toBe(false);
	});
});

describe('período aquisitivo (art. 3º) — contado da posse', () => {
	it('exercício = ano em que o aquisitivo se completa', () => {
		expect(periodoAquisitivo('2019-03-15', 2020)).toEqual({
			inicio: '2019-03-15',
			fim: '2020-03-14'
		});
		expect(periodoAquisitivo('2019-03-15', 2026)).toEqual({
			inicio: '2025-03-15',
			fim: '2026-03-14'
		});
	});

	it('antes do primeiro aquisitivo não há direito', () => {
		expect(periodoAquisitivo('2019-03-15', 2019)).toBeNull();
	});

	it('posse em 29/02 não quebra em ano comum', () => {
		expect(periodoAquisitivo('2020-02-29', 2021)).toEqual({
			inicio: '2020-02-29',
			fim: '2021-02-27'
		});
	});

	it('a janela de gozo são os 11 meses seguintes ao mês do fim (§ 5º)', () => {
		expect(janelaDeGozo({ fim: '2026-03-14' })).toEqual({
			inicio: '2026-04-01',
			fim: '2027-02-28'
		});
		expect(janelaDeGozo({ fim: '2026-12-31' })).toEqual({
			inicio: '2027-01-01',
			fim: '2027-11-30'
		});
	});
});

describe('status pela data', () => {
	const f = fracao(1, '2026-07-01', '2026-07-15');
	it('programada → em gozo → gozada conforme hoje', () => {
		expect(statusPelaData(f, '2026-06-30')).toBe('programada');
		expect(statusPelaData(f, '2026-07-01')).toBe('em_gozo');
		expect(statusPelaData(f, '2026-07-15')).toBe('em_gozo');
		expect(statusPelaData(f, '2026-07-16')).toBe('gozada');
	});
	it('sustada e suspensa são por ato, não pela data', () => {
		expect(statusPelaData({ ...f, status: 'sustada' }, '2026-07-05')).toBe('sustada');
	});
});

describe('sustação × suspensão — decidido pelos fatos', () => {
	it('fração que ainda não começou é SUSTAÇÃO, sem exigir motivo', () => {
		const c = classificarReprogramacao(fracao(1, '2026-12-01', '2026-12-15'), '2026-11-20');
		expect(c.tipo).toBe('sustacao');
		expect(c.motivo).toContain('ainda não iniciou');
		expect(c.admiteSuspensaoPeloParagrafo13).toBe(false);
	});

	it('fração já iniciada é SUSPENSÃO', () => {
		const c = classificarReprogramacao(fracao(1, '2026-07-01', '2026-07-30'), '2026-07-10');
		expect(c.tipo).toBe('suspensao');
		expect(c.motivo).toContain('necessidade do serviço');
	});

	it('2ª fração antes de começar, com a 1ª gozada: sustação, mas avisa o § 13', () => {
		const primeira = fracao(1, '2026-03-01', '2026-03-15');
		const segunda = fracao(2, '2026-12-01', '2026-12-15');
		const c = classificarReprogramacao(segunda, '2026-11-01', [primeira, segunda]);
		expect(c.tipo).toBe('sustacao');
		expect(c.admiteSuspensaoPeloParagrafo13).toBe(true);
	});

	it('fração gozada não se reprograma', () => {
		expect(() =>
			classificarReprogramacao(fracao(1, '2026-01-05', '2026-01-19'), '2026-06-01')
		).toThrow(/já gozada/);
	});
});

describe('critérios da suspensão (art. 6º III)', () => {
	const f = fracao(1, '2026-07-01', '2026-07-30');
	it('menos de 7 dias gozados é ERRO', () => {
		const c = criteriosDaSuspensao(f, '2026-07-05', '2026-08-01');
		expect(c[0].ok).toBe(false);
		expect(c[0].nivel).toBe('erro');
		expect(c[0].texto).toContain('4 dia');
	});
	it('7 dias gozados passa; reprogramar depois de 10 dias só AVISA', () => {
		const c = criteriosDaSuspensao(f, '2026-07-08', '2026-08-01');
		expect(c[0].ok).toBe(true);
		expect(c[1].ok).toBe(false);
		expect(c[1].nivel).toBe('aviso');
		expect(temErro(c)).toBe(false);
	});
});

describe('novas datas (o que o Guardião e a COGEP conferem)', () => {
	const original = fracao(1, '2026-07-01', '2026-07-15'); // 15 dias
	const base = { fracaoOriginal: original, feriados: ['2026-09-07'] };

	it('mesma quantidade de dias, 1º dia útil, fração ≥ 10: tudo ok', () => {
		const c = conferirNovoPeriodo({ ...base, novoInicio: '2026-09-08', novoFim: '2026-09-22' });
		expect(temErro(c)).toBe(false);
	});

	it('quantidade diferente é erro', () => {
		const c = conferirNovoPeriodo({ ...base, novoInicio: '2026-09-08', novoFim: '2026-09-17' });
		expect(c[0].ok).toBe(false);
		expect(temErro(c)).toBe(true);
	});

	it('1º dia em fim de semana ou feriado é erro', () => {
		// 2026-09-05 é sábado; 2026-09-07 está na lista de feriados.
		expect(
			conferirNovoPeriodo({ ...base, novoInicio: '2026-09-05', novoFim: '2026-09-19' })[1].ok
		).toBe(false);
		expect(
			conferirNovoPeriodo({ ...base, novoInicio: '2026-09-07', novoFim: '2026-09-21' })[1].ok
		).toBe(false);
	});

	it('teto de 15 % só AVISA, e só no 1º período', () => {
		const acima = conferirNovoPeriodo({
			...base,
			novoInicio: '2026-09-08',
			novoFim: '2026-09-22',
			emFeriasNoMes: 3,
			efetivoDaUnidade: 12
		});
		const aviso = acima.find((c) => c.texto.includes('%'));
		expect(aviso?.ok).toBe(false);
		expect(aviso?.nivel).toBe('aviso');
		expect(temErro(acima)).toBe(false);

		const segundo = conferirNovoPeriodo({
			fracaoOriginal: fracao(2, '2026-07-01', '2026-07-15'),
			feriados: [],
			novoInicio: '2026-09-08',
			novoFim: '2026-09-22',
			emFeriasNoMes: 3,
			efetivoDaUnidade: 12
		});
		expect(segundo.some((c) => c.texto.includes('%'))).toBe(false);
	});
});

describe('o ofício do NUP sai com o instituto certo', () => {
	const servidor = {
		nome: 'MARIA DA SILVA',
		matricula: '30012345',
		cargo: 'OIP',
		lotacao: 'Delegacia de Polícia Civil de Aurora'
	};
	it('sustação', () => {
		const f = fracao(2, '2026-12-01', '2026-12-15');
		const texto = textoDoOficio({
			servidor,
			classificacao: classificarReprogramacao(f, '2026-11-01'),
			fracaoOriginal: f,
			novoInicio: '2027-01-12',
			novoFim: '2027-01-26'
		});
		expect(texto).toContain('SUSTAÇÃO');
		expect(texto).not.toContain('SUSPENSÃO');
		expect(texto).toContain('2ª fração, de 01/12/2026 a 15/12/2026 (15 dias)');
		expect(texto).toContain('§§ 10 e 14');
	});
	it('suspensão traz a justificativa e os dias gozados', () => {
		const f = fracao(1, '2026-07-01', '2026-07-30');
		const texto = textoDoOficio({
			servidor,
			classificacao: classificarReprogramacao(f, '2026-07-10'),
			fracaoOriginal: f,
			novoInicio: '2026-08-03',
			novoFim: '2026-08-23',
			justificativa: 'Operação Carnaval fora de época na região.',
			dataSuspensao: '2026-07-10'
		});
		expect(texto).toContain('SUSPENSÃO');
		expect(texto).toContain('9 dias gozados');
		expect(texto).toContain('Operação Carnaval');
	});
});

describe('abono pecuniário (Dec. 37.363/2026)', () => {
	const f = fracao(1, '2026-12-01', '2026-12-30'); // 30 dias

	it('janela de 60 a 90 dias: dentro passa, fora avisa', () => {
		const dentro = conferirAbono({
			fracao: f,
			dataRequerimentoISO: '2026-09-15',
			posicao: 'finais',
			abonosJaDeferidosNoAno: 0,
			historico: []
		});
		expect(dentro[0].ok).toBe(true);
		const fora = conferirAbono({
			fracao: f,
			dataRequerimentoISO: '2026-11-20',
			posicao: 'finais',
			abonosJaDeferidosNoAno: 0,
			historico: []
		});
		expect(fora[0].ok).toBe(false);
		expect(fora[0].nivel).toBe('aviso');
	});

	it('fração maior que 10 exige a posição (art. 4º)', () => {
		const c = conferirAbono({
			fracao: f,
			dataRequerimentoISO: '2026-09-15',
			posicao: null,
			abonosJaDeferidosNoAno: 0,
			historico: []
		});
		expect(c[1].ok).toBe(false);
		expect(temErro(c)).toBe(true);
	});

	it('segundo abono no ano é erro (art. 11)', () => {
		const c = conferirAbono({
			fracao: f,
			dataRequerimentoISO: '2026-09-15',
			posicao: 'iniciais',
			abonosJaDeferidosNoAno: 1,
			historico: []
		});
		expect(c.find((x) => x.texto.includes('uma vez'))?.ok).toBe(false);
	});

	it('impedimentos do art. 13 apurados no histórico', () => {
		// I: 45 + 20 = 65 dias de LTS nos últimos 12 meses.
		const historico = [
			{ subtipo: 'lts', data_inicio: '2026-01-10', data_fim: '2026-02-23' },
			{ subtipo: 'lts', data_inicio: '2026-06-01', data_fim: '2026-06-20' }
		];
		const imp = impedimentosDoAbono(historico, '2026-09-15');
		expect(imp).toHaveLength(1);
		expect(imp[0]).toContain('65 dias');

		// II: LIP vigente.
		const lip = impedimentosDoAbono(
			[{ subtipo: 'lip', data_inicio: '2026-08-01', data_fim: null }],
			'2026-09-15'
		);
		expect(lip[0]).toContain('lip');

		// Licença antiga, fora da janela de 12 meses, não conta.
		expect(
			impedimentosDoAbono(
				[{ subtipo: 'lts', data_inicio: '2024-01-01', data_fim: '2024-04-30' }],
				'2026-09-15'
			)
		).toEqual([]);
	});

	it('os 10 dias convertidos saem do gozo: iniciais ou finais', () => {
		expect(periodoGozadoComAbono(f, 'iniciais')).toEqual({
			abono: { inicio: '2026-12-01', fim: '2026-12-10' },
			gozo: { inicio: '2026-12-11', fim: '2026-12-30' }
		});
		expect(periodoGozadoComAbono(f, 'finais')).toEqual({
			abono: { inicio: '2026-12-21', fim: '2026-12-30' },
			gozo: { inicio: '2026-12-01', fim: '2026-12-20' }
		});
		// Fração de exatamente 10 dias: converte inteira, nada a gozar.
		expect(periodoGozadoComAbono(fracao(3, '2026-12-01', '2026-12-10'), 'finais').gozo).toBeNull();
	});
});
