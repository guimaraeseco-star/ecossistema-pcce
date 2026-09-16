/**
 * O domínio dos campos solicitáveis — a regra que a ficha e o servidor têm de
 * ler igual.
 *
 * Dois casos aqui não são "validação de formulário", e são o motivo do arquivo:
 *
 *  - **e-mail pessoal e lotação estão FORA da lista**, cada um por um motivo
 *    próprio (canal de recuperação da conta; transferência exige portaria). São
 *    ausências que ninguém percebe ao reintroduzir o campo — o formulário
 *    passaria a oferecê-lo e nada reprovaria;
 *  - **a classe é conferida contra o cargo PEDIDO**, não contra o gravado: quem
 *    promove de OIP para DPC pede as duas coisas na mesma submissão, e conferir
 *    contra o cargo antigo recusaria a classe correta.
 */
import { describe, it, expect } from 'vitest';
import {
	CAMPOS_SOLICITAVEIS,
	MAX_JUSTIFICATIVA,
	ROTULO_CAMPO,
	classesDoCargo,
	motivoParaRecusarValor,
	textoDoValorSolicitado
} from '../cadastro-campos';

/** A lista é o contrato: a ficha monta o formulário a partir dela. */
const oferecidos: readonly string[] = CAMPOS_SOLICITAVEIS;

describe('o que pode ser pedido', () => {
	it('e-mail pessoal NÃO é solicitável — só o titular o troca', () => {
		expect(oferecidos).not.toContain('email_pessoal');
	});

	/**
	 * Transferir servidor é MOVIMENTAÇÃO: tem data, NUP e portaria anexa, que
	 * `valor_novo` não guarda. Dois caminhos abertos produziriam transferência sem
	 * portaria, indistinguível de uma com portaria depois de gravada.
	 */
	it('lotação NÃO é solicitável por campo — vai por movimentação', () => {
		expect(oferecidos).not.toContain('lotacao');
		// Continua exibível: as linhas anteriores a ago/2026 usam este campo.
		expect(ROTULO_CAMPO.lotacao).toBe('Lotação');
	});

	it('nada que seja credencial ou permissão entra na lista', () => {
		for (const proibido of ['senha', 'ativo', 'papel', 'papel_unidade_id']) {
			expect(oferecidos, proibido).not.toContain(proibido);
		}
	});

	it('todo campo solicitável tem rótulo de exibição', () => {
		for (const campo of CAMPOS_SOLICITAVEIS) {
			expect(ROTULO_CAMPO[campo], campo).toBeTruthy();
		}
	});
});

describe('motivoParaRecusarValor', () => {
	it('aceita os valores válidos de cada campo', () => {
		expect(motivoParaRecusarValor('nome', 'MARIA DE SOUZA', 'OIP')).toBeNull();
		expect(motivoParaRecusarValor('matricula', '123456', 'OIP')).toBeNull();
		expect(motivoParaRecusarValor('cargo', 'DPC', 'OIP')).toBeNull();
		expect(motivoParaRecusarValor('cpf', '111.222.333-44', 'OIP')).toBeNull();
		expect(motivoParaRecusarValor('cpf', '11122233344', 'OIP')).toBeNull();
		expect(motivoParaRecusarValor('telefone', '85999990000', 'OIP')).toBeNull();
		expect(motivoParaRecusarValor('regime', 'expediente', 'OIP')).toBeNull();
		expect(motivoParaRecusarValor('email', 'a.b@pc.ce.gov.br', 'OIP')).toBeNull();
	});

	it('recusa o que não serve, com mensagem', () => {
		expect(motivoParaRecusarValor('cargo', 'CHEFE', 'OIP')).toMatch(/DPC ou OIP/);
		expect(motivoParaRecusarValor('cpf', '123', 'OIP')).toMatch(/CPF inválido/);
		expect(motivoParaRecusarValor('telefone', '85', 'OIP')).toMatch(/Telefone inválido/);
		expect(motivoParaRecusarValor('regime', 'ferias', 'OIP')).toMatch(/Regime inválido/);
		expect(motivoParaRecusarValor('email', 'sem-arroba', 'OIP')).toMatch(/E-mail funcional/);
		expect(motivoParaRecusarValor('nome', 'x'.repeat(201), 'OIP')).toMatch(/muito longo/);
	});

	it('a classe segue o cargo ALVO, não o gravado', () => {
		// '1ª' é classe de DPC; 'A' é de OIP.
		expect(motivoParaRecusarValor('classe', '1ª', 'DPC')).toBeNull();
		expect(motivoParaRecusarValor('classe', '1ª', 'OIP')).toMatch(/Classe inválida/);
		expect(motivoParaRecusarValor('classe', 'A', 'OIP')).toBeNull();
		expect(motivoParaRecusarValor('classe', 'A', 'DPC')).toMatch(/Classe inválida/);
	});

	it('classesDoCargo separa as duas carreiras', () => {
		expect(classesDoCargo('DPC')).toEqual(['1ª', '2ª', '3ª', 'ESPECIAL']);
		expect(classesDoCargo('OIP')).toEqual(['A', 'B', 'C', 'D']);
	});
});

describe('justificativa', () => {
	it('o teto é o mesmo que a tela e o servidor aplicam', () => {
		expect(MAX_JUSTIFICATIVA).toBe(300);
	});
});

/**
 * `designacao_id` é a única referência da lista: a fila do Admin Geral precisa
 * mostrar a FUNÇÃO, não o id, e o valor pedido tem de ser um id plausível antes
 * de o servidor ir ao banco conferir se ele existe.
 */
describe('designação (E50)', () => {
	const CATALOGO = [
		{ id: 3, nome: 'Delegado Titular' },
		{ id: 9, nome: 'Chefe de seção de expedientes e cartório' }
	];

	it('é solicitável, e a ponta é quem sabe da mudança', () => {
		expect(oferecidos).toContain('designacao_id');
		expect(ROTULO_CAMPO.designacao_id).toBe('Designação');
	});

	it('só aceita id plausível — a existência quem confere é o banco', () => {
		expect(motivoParaRecusarValor('designacao_id', '9', 'OIP')).toBeNull();
		expect(motivoParaRecusarValor('designacao_id', '0', 'OIP')).toBeTruthy();
		expect(motivoParaRecusarValor('designacao_id', 'Cartório', 'OIP')).toBeTruthy();
		expect(motivoParaRecusarValor('designacao_id', '-3', 'OIP')).toBeTruthy();
	});

	it('exibe o nome da função, nunca o id', () => {
		expect(textoDoValorSolicitado('designacao_id', '9', CATALOGO)).toBe(
			'Chefe de seção de expedientes e cartório'
		);
	});

	it('id que sumiu do catálogo mostra o valor cru, não vazio', () => {
		// Designação desativada depois do pedido: a fila continua legível e quem
		// decide vê que há algo estranho, em vez de uma célula em branco.
		expect(textoDoValorSolicitado('designacao_id', '404', CATALOGO)).toBe('404');
	});

	it('os demais campos passam pelo helper sem tradução', () => {
		expect(textoDoValorSolicitado('telefone', '85999990000', CATALOGO)).toBe('85999990000');
		expect(textoDoValorSolicitado('nome', null, CATALOGO)).toBe('');
	});
});
