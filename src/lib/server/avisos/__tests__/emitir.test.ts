/**
 * A regra do emissor (E59): quem fez NÃO recebe; recebe o outro lado.
 */
import { describe, it, expect } from 'vitest';
import { destinatariosDe } from '../emitir';
import type { UsuarioLogado } from '$lib/auth';

const ADMIN = { id: 1, nome: 'Admin', tipo: 'admin' } as unknown as UsuarioLogado;
const UNIDADE = {
	id: 2,
	nome: 'Titular',
	tipo: 'policial',
	papel: 'admin_unidade',
	papel_unidade_id: 61
} as unknown as UsuarioLogado;

describe('o outro lado', () => {
	it('o Admin Geral agiu → as lotações alcançadas (sem repetir, sem vazio)', () => {
		expect(
			destinatariosDe(ADMIN, { lotacoes: ['DP Tauá', null, 'DP Tauá', 'DP Aurora', ''] })
		).toEqual([
			{ tipo: 'lotacao', lotacao: 'DP Tauá' },
			{ tipo: 'lotacao', lotacao: 'DP Aurora' }
		]);
	});

	it('a ponta agiu → o Admin Geral, e só ele — levando a lotação como ASSUNTO', () => {
		// A lotação não é o destinatário aqui: é por ela que a caixa do Admin
		// Geral é recortada pelo nó da conta (E65). Sem lotação conhecida o aviso
		// fica visível a todos os administradores, como antes.
		expect(destinatariosDe(UNIDADE, { lotacoes: ['DP Tauá'] })).toEqual([
			{ tipo: 'admin_geral', lotacao: 'DP Tauá' }
		]);
		expect(destinatariosDe(UNIDADE, { lotacoes: [null] })).toEqual([
			{ tipo: 'admin_geral', lotacao: undefined }
		]);
	});

	it('o Admin Geral agiu sem lotação conhecida → ninguém', () => {
		expect(destinatariosDe(ADMIN, { lotacoes: [null] })).toEqual([]);
	});
});

describe('a caixa do Admin Geral tem recorte (E65)', () => {
	it('a lotação vai no aviso como ASSUNTO, e é por ela que a caixa filtra', () => {
		// Duas unidades de departamentos diferentes: a caixa de quem administra
		// uma não pode acender com o que aconteceu na outra. O destinatário
		// continua sendo "admin_geral" — o que mudou é o aviso passar a dizer de
		// que casa ele fala.
		const [destino] = destinatariosDe(UNIDADE, { lotacoes: ['DP Tauá', 'DP Crato'] });
		expect(destino).toEqual({ tipo: 'admin_geral', lotacao: 'DP Tauá' });
	});
});
