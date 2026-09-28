/**
 * A caixa "Tipo do Campo" do editor do formulário (E76, etapa 2): os tipos
 * aposentados só aparecem na pergunta que já está com um deles — senão a
 * caixa não acharia o valor atual, e a pergunta pareceria sem tipo.
 */
import { describe, it, expect } from 'vitest';
import { opcoesDoTipoDoCampo } from '../opcoes-tipo-do-campo';

const valores = (tipo: string) => opcoesDoTipoDoCampo(tipo).map((o) => o.value);

describe('opcoesDoTipoDoCampo', () => {
	it('numa pergunta comum, nenhum tipo aposentado', () => {
		const v = valores('texto');
		expect(v).toContain('lista_detalhada');
		expect(v).not.toContain('mandados_maiores');
		expect(v).not.toContain('prisoes_maiores');
		expect(v).not.toContain('apreensoes_menores');
	});

	it('na pergunta que já é de um aposentado, ele aparece — e só ele', () => {
		const v = valores('prisoes_maiores');
		expect(v).toContain('prisoes_maiores');
		expect(v).not.toContain('mandados_maiores');
	});

	it('o grupo vai como detalhe de cada opção', () => {
		const opcoes = opcoesDoTipoDoCampo('mandados_maiores');
		expect(opcoes.find((o) => o.value === 'texto')?.detalhe).toBe('Campos básicos');
		expect(opcoes.find((o) => o.value === 'vtr_placa')?.detalhe).toBe(
			'Campos inteligentes (sistemáticos)'
		);
		expect(opcoes.find((o) => o.value === 'mandados_maiores')?.detalhe).toMatch(/Aposentado/);
	});
});
