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
	planoDaReprogramacao,
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

describe('sustação × suspensão — decidido pelos fatos das FÉRIAS, não da fração', () => {
	it('nada começou: SUSTAÇÃO de todas as frações juntas, redivisível', () => {
		const ex = [fracao(1, '2026-12-01', '2026-12-10'), fracao(2, '2027-01-11', '2027-01-30')];
		const s = situacaoDaReprogramacao(ex, '2026-11-20');
		expect(s.tipo).toBe('sustacao');
		expect(s.emGozo).toBeNull();
		expect(s.futuras.map((f) => f.ordem)).toEqual([1, 2]);
		expect(s.motivo).toContain('juntas');
		const plano = planoDaReprogramacao(s);
		expect(plano.diasRestantes).toBe(30);
		// A divisão atual (10+20) vem primeiro; depois as outras quatro formas.
		expect(plano.divisoes.map((d) => d.join('+'))).toEqual([
			'10+20',
			'30',
			'20+10',
			'15+15',
			'10+10+10'
		]);
	});

	it('1ª em gozo e 2ª futura: SUSPENSÃO das duas — o quebrado da em gozo + a futura inteira', () => {
		const ex = [fracao(1, '2026-07-01', '2026-07-30'), fracao(2, '2026-12-01', '2026-12-10')];
		const s = situacaoDaReprogramacao(ex, '2026-07-10');
		expect(s.tipo).toBe('suspensao');
		expect(s.emGozo?.ordem).toBe(1);
		expect(s.futuras.map((f) => f.ordem)).toEqual([2]);
		expect(s.motivo).toContain('necessidade do serviço');
		// Sem o retorno, o plano só tem a futura.
		expect(planoDaReprogramacao(s).diasRestantes).toBe(10);
		// Retorno em 10/07: 9 gozados, 21 quebrados + 10 = 31.
		const plano = planoDaReprogramacao(s, '2026-07-10');
		expect(plano.quebrado).toBe(21);
		expect(plano.diasRestantes).toBe(31);
		expect(plano.fracoes.map((f) => f.ordem)).toEqual([1, 2]);
		expect(plano.divisoes.map((d) => d.join('+'))).toEqual(['21+10']);
	});

	it('1ª já gozada e 2ª futura: as férias começaram → SUSPENSÃO da futura, com os dias preservados', () => {
		const ex = [fracao(1, '2026-03-02', '2026-03-11'), fracao(2, '2026-12-01', '2026-12-20')];
		const s = situacaoDaReprogramacao(ex, '2026-09-20');
		expect(s.tipo).toBe('suspensao');
		expect(s.emGozo).toBeNull();
		expect(s.futuras.map((f) => f.ordem)).toEqual([2]);
		expect(s.motivo).toContain('preservados');
		expect(planoDaReprogramacao(s).divisoes.map((d) => d.join('+'))).toEqual(['20', '10+10']);
	});

	it('1ª vendida e já passada: as férias correram → SUSPENSÃO; antes de passar → SUSTAÇÃO', () => {
		const ex = [
			{ ...fracao(1, '2026-10-01', '2026-10-10'), diasAbonados: 10 },
			fracao(2, '2027-01-11', '2027-01-30')
		];
		expect(situacaoDaReprogramacao(ex, '2026-09-20').tipo).toBe('sustacao');
		const depois = situacaoDaReprogramacao(ex, '2026-10-15');
		expect(depois.tipo).toBe('suspensao');
		// A vendida nunca entra; só a 2ª, com 20.
		expect(depois.futuras.map((f) => f.ordem)).toEqual([2]);
		expect(planoDaReprogramacao(depois).diasRestantes).toBe(20);
	});

	// E63 (art. 4º § 1º, resposta da COGEP em 21/09): a fração com abono —
	// toda ou parcialmente vendida — fica intocável; as outras seguem a régua.
	describe('fração com abono é intocável (art. 4º § 1º, E63) — os cinco casos', () => {
		it('30 dias, 10 vendidos: nada entra e o motivo explica', () => {
			const s = situacaoDaReprogramacao(
				[{ ...fracao(1, '2026-12-01', '2026-12-30'), diasAbonados: 10 }],
				'2026-09-20'
			);
			expect(s.tipo).toBeNull();
			expect(s.comAbono.map((f) => f.ordem)).toEqual([1]);
			expect(s.motivo).toContain('art. 4º § 1º');
			expect(planoDaReprogramacao(s).diasRestantes).toBe(0);
		});

		it('15 + 15, 10 vendidos da 1ª: só a 2ª entra, redivisão só 15', () => {
			const s = situacaoDaReprogramacao(
				[
					{ ...fracao(1, '2026-10-01', '2026-10-15'), diasAbonados: 10 },
					fracao(2, '2026-12-01', '2026-12-15')
				],
				'2026-09-20'
			);
			expect(s.tipo).toBe('sustacao');
			expect(s.futuras.map((f) => f.ordem)).toEqual([2]);
			expect(s.comAbono.map((f) => f.ordem)).toEqual([1]);
			expect(s.motivo).toContain('1ª fração tem abono');
			const p = planoDaReprogramacao(s);
			expect(p.diasRestantes).toBe(15);
			expect(p.divisoes.map((d) => d.join('+'))).toEqual(['15']);
		});

		it('10 + 20: vendida a de 10 → a de 20 entra (20 ou 10+10); vendidos 10 da de 20 → a de 10 entra', () => {
			const vendeuA10 = situacaoDaReprogramacao(
				[
					{ ...fracao(1, '2026-10-01', '2026-10-10'), diasAbonados: 10 },
					fracao(2, '2026-12-01', '2026-12-20')
				],
				'2026-09-20'
			);
			expect(vendeuA10.futuras.map((f) => f.ordem)).toEqual([2]);
			expect(planoDaReprogramacao(vendeuA10).divisoes.map((d) => d.join('+'))).toEqual([
				'20',
				'10+10'
			]);
			const vendeuDa20 = situacaoDaReprogramacao(
				[
					fracao(1, '2026-10-01', '2026-10-10'),
					{ ...fracao(2, '2026-12-01', '2026-12-20'), diasAbonados: 10 }
				],
				'2026-09-20'
			);
			expect(vendeuDa20.futuras.map((f) => f.ordem)).toEqual([1]);
			expect(planoDaReprogramacao(vendeuDa20).divisoes.map((d) => d.join('+'))).toEqual(['10']);
		});

		it('10 + 10 + 10, uma vendida: as outras duas entram (20 ou 10+10)', () => {
			const s = situacaoDaReprogramacao(
				[
					fracao(1, '2026-10-01', '2026-10-10'),
					{ ...fracao(2, '2026-11-01', '2026-11-10'), diasAbonados: 10 },
					fracao(3, '2026-12-01', '2026-12-10')
				],
				'2026-09-20'
			);
			expect(s.futuras.map((f) => f.ordem)).toEqual([1, 3]);
			expect(planoDaReprogramacao(s).divisoes.map((d) => d.join('+'))).toEqual(['10+10', '20']);
		});

		it('em gozo COM abono não se interrompe: só as futuras sem abono entram, por suspensão', () => {
			const s = situacaoDaReprogramacao(
				[
					{ ...fracao(1, '2026-09-01', '2026-09-30'), diasAbonados: 10 },
					fracao(2, '2026-12-01', '2026-12-10')
				],
				'2026-09-20'
			);
			expect(s.tipo).toBe('suspensao');
			expect(s.emGozo).toBeNull();
			expect(s.futuras.map((f) => f.ordem)).toEqual([2]);
			expect(planoDaReprogramacao(s, '2026-09-25').quebrado).toBe(0);
		});
	});

	it('depois de uma suspensão o que resta pode não ser uma das cinco formas — a divisão atual ainda cabe', () => {
		const ex = [fracao(2, '2026-10-01', '2026-10-12'), fracao(3, '2026-12-01', '2026-12-10')];
		const s = situacaoDaReprogramacao(ex, '2026-09-01');
		expect(planoDaReprogramacao(s).divisoes.map((d) => d.join('+'))).toEqual(['12+10']);
	});

	it('tudo gozado: não há o que reprogramar', () => {
		const s = situacaoDaReprogramacao([fracao(1, '2026-01-05', '2026-02-03')], '2026-06-01');
		expect(s.tipo).toBeNull();
	});

	it('fração sustada não conta: reprograma-se a que a substituiu, e ela não marca o início das férias', () => {
		const s = situacaoDaReprogramacao(
			[fracao(1, '2026-10-01', '2026-10-30', 'sustada'), fracao(1, '2027-02-01', '2027-03-02')],
			'2026-11-20'
		);
		expect(s.tipo).toBe('sustacao');
		expect(s.futuras).toHaveLength(1);
		expect(s.futuras[0].data_inicio).toBe('2027-02-01');
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
			emGozo: f,
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

	it('segundo abono no ANO CIVIL é erro, mesmo de outro exercício (art. 11; E62)', () => {
		const c = conferirAbono({
			fracao: f,
			hojeISO: '2026-09-15',
			posicao: 'iniciais',
			abonosJaDeferidosNoAno: 1,
			abonosJaDeferidosNoExercicio: 0,
			historico: []
		});
		// [1] é o limite do exercício, [2] o do ano.
		expect(c[1].ok).toBe(true);
		expect(c[2].ok).toBe(false);
		expect(c[2].texto).toContain('por ano');
	});

	it('segundo abono no mesmo EXERCÍCIO é erro, mesmo em outro ano (E62)', () => {
		const c = conferirAbono({
			fracao: f,
			hojeISO: '2026-09-15',
			posicao: 'iniciais',
			abonosJaDeferidosNoAno: 0,
			abonosJaDeferidosNoExercicio: 1,
			historico: []
		});
		expect(c[1].ok).toBe(false);
		expect(c[1].texto).toContain('por exercício');
		expect(c[2].ok).toBe(true);
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
