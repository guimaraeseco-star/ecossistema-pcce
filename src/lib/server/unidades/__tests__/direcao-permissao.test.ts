/**
 * A direção da unidade é indicação do DPI SUL (E67, 22/09): só o Admin Geral
 * registra. O teste existe porque a régua ANTERIOR dava à seccional o direito
 * de propor — quem reintroduzir o modo `proposta` sem decisão dele derruba
 * este arquivo.
 */
import { describe, it, expect } from 'vitest';
import { modoDaDirecao } from '../direcao-permissao';
import type { UsuarioLogado } from '$lib/auth';

const admin = { id: 1, tipo: 'admin', nome: 'Admin Geral' } as UsuarioLogado;
const seccional = {
	id: 2,
	tipo: 'policial',
	nome: 'Chefe da Seccional',
	papel: 'admin_seccional',
	papel_unidade_id: 10
} as UsuarioLogado;
const unidade = {
	id: 3,
	tipo: 'policial',
	nome: 'Admin da Delegacia',
	papel: 'admin_unidade',
	papel_unidade_id: 20
} as UsuarioLogado;
const comum = { id: 4, tipo: 'policial', nome: 'Servidor', papel: null } as UsuarioLogado;

describe('modoDaDirecao', () => {
	it('o Admin Geral registra direto', () => {
		expect(modoDaDirecao(admin)).toBe('direto');
	});

	it('a seccional NÃO propõe mais — lê, como todos os outros', () => {
		expect(modoDaDirecao(seccional)).toBe('leitura');
		expect(modoDaDirecao(unidade)).toBe('leitura');
		expect(modoDaDirecao(comum)).toBe('leitura');
		expect(modoDaDirecao(null)).toBe('leitura');
	});
});
