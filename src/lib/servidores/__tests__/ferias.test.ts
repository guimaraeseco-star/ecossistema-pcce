/**
 * As regras de férias contra os casos que a COGEP devolve.
 *
 * O que vale mais aqui é o classificador: sustação × suspensão é a confusão
 * que faz o pedido chegar errado, e a resposta tem de sair dos FATOS (a fração
 * começou?), nunca de uma escolha do usuário.
 */
import { describe, it, expect } from 'vitest';
import {
	conferirAbono,
	conferirPrimeiroDia,
	diasRestantesNaSuspensao,
	divisoesPossiveis,
	fimDaFracao,
	montarPeriodos,
	situacaoDaReprogramacao,
	avisoDoTeto,
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

const fracao = (
	ordem: 1 | 2 | 3,
	inicio: string,
	fim: string,
	status: Fracao['status'] = 'programada'
): Fracao => ({ ordem, data_inicio: inicio, data_fim: fim, status });

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
	it('nada começou: só SUSTAÇÃO, de todas as frações juntas', () => {
		const ex = [fracao(1, '2026-12-01', '2026-12-10'), fracao(2, '2027-01-11', '2027-01-30')];
		const s = situacaoDaReprogramacao(ex, '2026-11-20');
		expect(s.suspensao).toBeNull();
		expect(s.sustacao?.fracoes.map((f) => f.ordem)).toEqual([1, 2]);
		expect(s.sustacao?.diasRestantes).toBe(30);
		expect(s.sustacao?.motivo).toContain('juntas');
		// A divisão atual (10+20) vem primeiro; depois as outras quatro formas.
		expect(s.sustacao?.divisoes.map((d) => d.join('+'))).toEqual([
			'10+20',
			'30',
			'20+10',
			'15+15',
			'10+10+10'
		]);
	});

	it('1ª em gozo e 2ª futura: SUSPENSÃO da 1ª e SUSTAÇÃO da 2ª, cada uma no seu lugar', () => {
		const ex = [fracao(1, '2026-07-01', '2026-07-30'), fracao(2, '2026-12-01', '2026-12-10')];
		const s = situacaoDaReprogramacao(ex, '2026-07-10');
		expect(s.suspensao?.fracao.ordem).toBe(1);
		expect(s.suspensao?.motivo).toContain('necessidade do serviço');
		expect(s.sustacao?.fracoes.map((f) => f.ordem)).toEqual([2]);
		expect(s.sustacao?.divisoes.map((d) => d.join('+'))).toEqual(['10']);
	});

	it('depois de uma suspensão o que resta pode não ser uma das cinco formas — a divisão atual ainda cabe', () => {
		// Continuação de 12 dias (ordem 2) mais a 3ª de 10: 22 não é forma do decreto.
		const ex = [fracao(2, '2026-10-01', '2026-10-12'), fracao(3, '2026-12-01', '2026-12-10')];
		const s = situacaoDaReprogramacao(ex, '2026-09-01');
		expect(s.sustacao?.divisoes.map((d) => d.join('+'))).toEqual(['12+10']);
	});

	it('venda de férias: a fração toda vendida sai da sustação; a parcial entra só com o que resta', () => {
		// 1ª de 10 toda vendida (abono), 2ª de 20 por gozar → sustam-se só os 20.
		const ex = [
			{ ...fracao(1, '2026-10-01', '2026-10-10'), diasAbonados: 10 },
			fracao(2, '2027-01-11', '2027-01-30')
		];
		const s = situacaoDaReprogramacao(ex, '2026-09-20');
		expect(s.sustacao?.fracoes.map((f) => f.ordem)).toEqual([2]);
		expect(s.sustacao?.diasRestantes).toBe(20);
		expect(s.sustacao?.divisoes.map((d) => d.join('+'))).toEqual(['20', '10+10']);

		// 1ª de 30 com 10 vendidos → restam 20; a divisão atual é [20].
		const parcial = situacaoDaReprogramacao(
			[{ ...fracao(1, '2026-12-01', '2026-12-30'), diasAbonados: 10 }],
			'2026-09-20'
		);
		expect(parcial.sustacao?.diasRestantes).toBe(20);
		expect(parcial.sustacao?.motivo).toContain('10 dias vendidos');
	});

	it('tudo gozado: não há o que reprogramar', () => {
		const s = situacaoDaReprogramacao([fracao(1, '2026-01-05', '2026-02-03')], '2026-06-01');
		expect(s).toEqual({ sustacao: null, suspensao: null });
	});

	it('fração sustada não conta: reprograma-se a que a substituiu', () => {
		const s = situacaoDaReprogramacao(
			[fracao(1, '2026-12-01', '2026-12-30', 'sustada'), fracao(1, '2027-02-01', '2027-03-02')],
			'2026-11-20'
		);
		expect(s.sustacao?.fracoes).toHaveLength(1);
		expect(s.sustacao?.fracoes[0].data_inicio).toBe('2027-02-01');
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

describe('teto de 15 % (art. 6º I)', () => {
	it('só AVISA, e só no 1º período', () => {
		const acima = avisoDoTeto({ ordem: 1, emFeriasNoMes: 3, efetivoDaUnidade: 12 });
		expect(acima?.ok).toBe(false);
		expect(acima?.nivel).toBe('aviso');
		expect(temErro([acima!])).toBe(false);
		expect(avisoDoTeto({ ordem: 1, emFeriasNoMes: 1, efetivoDaUnidade: 12 })?.ok).toBe(true);
		expect(avisoDoTeto({ ordem: 2, emFeriasNoMes: 3, efetivoDaUnidade: 12 })).toBeNull();
		expect(avisoDoTeto({ ordem: 1, emFeriasNoMes: 3, efetivoDaUnidade: 0 })).toBeNull();
	});
});

describe('o ofício do NUP sai com o instituto certo', () => {
	const servidor = {
		nome: 'MARIA DA SILVA',
		matricula: '30012345',
		cargo: 'OIP',
		lotacao: 'Delegacia de Polícia Civil de Aurora'
	};
	it('sustação de duas frações que voltam como uma', () => {
		const texto = textoDoOficio({
			servidor,
			tipo: 'sustacao',
			fracoesOriginais: [
				fracao(2, '2026-12-01', '2026-12-10'),
				fracao(3, '2027-01-04', '2027-01-13')
			],
			novosPeriodos: [{ inicio: '2027-02-01', fim: '2027-02-20', dias: 20 }]
		});
		expect(texto).toContain('SUSTAÇÃO');
		expect(texto).not.toContain('SUSPENSÃO');
		expect(texto).toContain('Períodos programados:');
		expect(texto).toContain('2ª fração, de 01/12/2026 a 10/12/2026 (10 dias)');
		expect(texto).toContain('3ª fração, de 04/01/2027 a 13/01/2027 (10 dias)');
		expect(texto).toContain('1º período, de 01/02/2027 a 20/02/2027 (20 dias)');
		expect(texto).toContain('§§ 10 e 14');
	});
	it('suspensão traz a justificativa e os dias gozados', () => {
		const f = fracao(1, '2026-07-01', '2026-07-30');
		const texto = textoDoOficio({
			servidor,
			tipo: 'suspensao',
			fracoesOriginais: [f],
			novosPeriodos: [{ inicio: '2026-08-03', fim: '2026-08-23', dias: 21 }],
			justificativa: 'Operação Carnaval fora de época na região.',
			dataSuspensao: '2026-07-10'
		});
		expect(texto).toContain('SUSPENSÃO');
		expect(texto).toContain('9 dias gozados');
		expect(texto).toContain('Operação Carnaval');
		expect(texto).toContain('§ 12');
	});
});

describe('abono pecuniário (Dec. 37.363/2026)', () => {
	const f = fracao(1, '2026-12-01', '2026-12-30'); // 30 dias

	// A janela de 60–90 dias (art. 3º) não é conferida: o DPI SUL recebe só a
	// decisão, sem a data do requerimento — a janela foi apreciada pela COGEP.

	it('fração maior que 10 exige a posição (art. 4º)', () => {
		const c = conferirAbono({
			fracao: f,
			hojeISO: '2026-09-15',
			posicao: null,
			abonosJaDeferidosNoAno: 0,
			historico: []
		});
		expect(c[0].ok).toBe(false);
		expect(temErro(c)).toBe(true);
	});

	it('segundo abono no ano é erro (art. 11)', () => {
		const c = conferirAbono({
			fracao: f,
			hojeISO: '2026-09-15',
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

describe('as férias são UM período: divisão, 1º dia e sustação do exercício', () => {
	it('30 dias admitem as cinco formas', () => {
		expect(divisoesPossiveis(30).map((d) => d.join('+'))).toEqual([
			'30',
			'10+20',
			'20+10',
			'15+15',
			'10+10+10'
		]);
	});

	it('o restante depois de uma fração gozada só admite os sufixos que somam', () => {
		expect(divisoesPossiveis(20).map((d) => d.join('+'))).toEqual(['20', '10+10']);
		expect(divisoesPossiveis(15).map((d) => d.join('+'))).toEqual(['15']);
		expect(divisoesPossiveis(10).map((d) => d.join('+'))).toEqual(['10']);
		expect(divisoesPossiveis(7)).toEqual([]);
	});

	it('o último dia sai do primeiro', () => {
		expect(fimDaFracao('2026-10-01', 10)).toBe('2026-10-10');
		expect(fimDaFracao('2026-10-01', 30)).toBe('2026-10-30');
	});

	it('1º dia em domingo ou feriado é erro — o caso do 01/11/2026', () => {
		expect(conferirPrimeiroDia('2026-11-01', []).ok).toBe(false); // domingo
		expect(conferirPrimeiroDia('2026-11-02', ['2026-11-02']).ok).toBe(false); // Finados
		expect(conferirPrimeiroDia('2026-11-03', ['2026-11-02']).ok).toBe(true);
	});

	it('monta os períodos da divisão e recusa sobreposição', () => {
		const ok = montarPeriodos([10, 20], ['2026-10-01', '2026-11-03'], ['2026-11-02']);
		expect(ok.periodos).toEqual([
			{ inicio: '2026-10-01', fim: '2026-10-10', dias: 10 },
			{ inicio: '2026-11-03', fim: '2026-11-22', dias: 20 }
		]);
		expect(temErro(ok.checagens)).toBe(false);

		const sobreposto = montarPeriodos([10, 20], ['2026-10-01', '2026-10-05'], []);
		expect(temErro(sobreposto.checagens)).toBe(true);
		expect(sobreposto.checagens.some((c) => c.texto.includes('começa antes'))).toBe(true);

		const faltando = montarPeriodos([15, 15], ['2026-10-01'], []);
		expect(faltando.checagens.some((c) => c.texto.includes('2ª fração'))).toBe(true);
	});

	it('na suspensão, a fração nova tem o que RESTA, não o original', () => {
		expect(diasRestantesNaSuspensao(fracao(1, '2026-10-01', '2026-10-30'), '2026-10-11')).toEqual({
			gozados: 10,
			restantes: 20
		});
	});
});
