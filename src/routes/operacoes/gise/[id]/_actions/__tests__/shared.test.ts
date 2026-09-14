/**
 * A regra de quem preenche uma seccional da GISE — FLW-GISE-004.
 *
 * O e2e prova que as actions de preenchimento chamam esta função; aqui fica a
 * regra em si, caso a caso. O que a versão anterior errava não era um caso: era
 * a ausência de um. Por isso os casos negativos abaixo cobrem cada perfil que
 * NÃO tem papel de seccional — é lá que o buraco estava.
 */
import { describe, it, expect } from 'vitest';
import { podePreencherSeccional, exigirAdminGeral } from '../shared';

type Usuario = App.Locals['usuario'];

const SECCIONAL = 71;
const OUTRA = 72;

function policial(extra: Partial<NonNullable<Usuario>> = {}): Usuario {
	return {
		id: 1,
		tipo: 'policial',
		nome: 'Fulano',
		matricula: '0001',
		lotacao: 'DELEGACIA X',
		cargo: 'OIP',
		papel: null,
		papel_unidade_id: null,
		primeiro_acesso: false,
		isSuperAdmin: false,
		...extra
	} as NonNullable<Usuario>;
}

describe('podePreencherSeccional', () => {
	it('Admin Geral preenche qualquer seccional', () => {
		const admin = policial({ tipo: 'admin' });
		expect(podePreencherSeccional(admin, SECCIONAL)).toBe(true);
		expect(podePreencherSeccional(admin, OUTRA)).toBe(true);
	});

	it('admin de seccional preenche a SUA', () => {
		const u = policial({ papel: 'admin_seccional', papel_unidade_id: SECCIONAL });
		expect(podePreencherSeccional(u, SECCIONAL)).toBe(true);
	});

	it('admin de seccional NÃO preenche a de outro', () => {
		const u = policial({ papel: 'admin_seccional', papel_unidade_id: SECCIONAL });
		expect(podePreencherSeccional(u, OUTRA)).toBe(false);
	});

	describe('sem papel de seccional — o caso que faltava', () => {
		// A regra anterior era `!(isAdminSeccional(u) && papel !== seccional)`:
		// para todos estes o predicado interno era falso, então ela devolvia
		// "pode". Um policial de outra unidade montava equipe alheia por POST
		// direto.
		it.each([
			['policial comum', policial()],
			['policial de outra lotação', policial({ lotacao: 'DELEGACIA Z' })],
			['admin de UNIDADE', policial({ papel: 'admin_unidade', papel_unidade_id: SECCIONAL })],
			['supervisor da GISE (policial sem papel)', policial({ id: 99, cargo: 'DPC' })]
		])('%s é recusado', (_rotulo, u) => {
			expect(podePreencherSeccional(u, SECCIONAL)).toBe(false);
		});
	});

	it('anônimo é recusado', () => {
		expect(podePreencherSeccional(null, SECCIONAL)).toBe(false);
	});

	it('papel sem unidade de responsabilidade não vale como escopo', () => {
		// `papel_unidade_id` nulo não pode casar com uma seccional nula/ausente e
		// virar permissão por coincidência de `undefined === undefined`.
		const u = policial({ papel: 'admin_seccional', papel_unidade_id: null });
		expect(podePreencherSeccional(u, SECCIONAL)).toBe(false);
		expect(podePreencherSeccional(u, null)).toBe(false);
		expect(podePreencherSeccional(u, undefined)).toBe(false);
	});
});

describe('exigirAdminGeral', () => {
	it('recusa anônimo e policial', () => {
		const anon = exigirAdminGeral(null);
		expect('id' in anon).toBe(false);
		if (!('id' in anon)) expect(anon.status).toBe(403);

		const policialRecusa = exigirAdminGeral(policial());
		expect('id' in policialRecusa).toBe(false);
		if (!('id' in policialRecusa)) expect(policialRecusa.status).toBe(403);
	});

	it('devolve o usuário para Admin Geral', () => {
		const admin = policial({ tipo: 'admin' });
		const out = exigirAdminGeral(admin);
		expect(out).toBe(admin);
		expect('id' in out).toBe(true);
	});

	it('aceita mensagem customizada', () => {
		const recusa = exigirAdminGeral(policial(), 'Apenas Admin Geral pode editar');
		expect('id' in recusa).toBe(false);
		if (!('id' in recusa)) {
			expect(recusa.data).toEqual({ error: 'Apenas Admin Geral pode editar' });
		}
	});
});
