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

	it('a ponta agiu → o Admin Geral, e só ele', () => {
		expect(destinatariosDe(UNIDADE, { lotacoes: ['DP Tauá'] })).toEqual([{ tipo: 'admin_geral' }]);
	});

	it('o Admin Geral agiu sem lotação conhecida → ninguém', () => {
		expect(destinatariosDe(ADMIN, { lotacoes: [null] })).toEqual([]);
	});
});
