/**
 * "Trabalha em" (E66): os locais que uma lotação oferece e a régua que impede
 * o local de virar uma segunda lotação.
 */
import { describe, it, expect } from 'vitest';
import type { NoUnidade } from '$lib/db/unidades';
import { locaisDaUnidade, localValido, quemPerdeOLocal, rotuloDoLocal } from '../locais';

const no = (id: number, nome: string, seccional_id: number | null, tipo = 'delegacia'): NoUnidade =>
	({
		id,
		nome,
		tipo,
		seccional_id,
		sigla: '',
		abrangencia: 'departamental',
		ativo: true
	}) as NoUnidade;

// DPI SUL → 1ª Seccional → Aracati → posto de Fortim; e o núcleo de Juazeiro
// pendurado no próprio departamento.
const ARVORE = new Map<number, NoUnidade>(
	[
		no(2, 'DPI SUL', null, 'departamento'),
		no(4, '1ª Seccional', 2, 'seccional'),
		no(20, 'Aracati', 4),
		no(58, 'Posto de Fortim', 20, 'unidade'),
		no(59, 'Posto de Quixeré', 51, 'unidade'),
		no(51, 'Russas', 4),
		no(63, 'Núcleo de Juazeiro', 2, 'sub_departamento')
	].map((u) => [u.id, u])
);

describe('locaisDaUnidade', () => {
	it('devolve a sede primeiro e as subunidades em ordem', () => {
		expect(locaisDaUnidade(ARVORE, 20)).toEqual([
			{ id: 20, nome: 'Aracati', sede: true },
			{ id: 58, nome: 'Posto de Fortim', sede: false }
		]);
		// O departamento enxerga tudo abaixo — inclusive as delegacias, porque a
		// régua é a subárvore; a tela de cada servidor só mostra o que interessa.
		expect(locaisDaUnidade(ARVORE, 63)).toEqual([
			{ id: 63, nome: 'Núcleo de Juazeiro', sede: true }
		]);
		expect(locaisDaUnidade(ARVORE, 999)).toEqual([]);
		expect(locaisDaUnidade(ARVORE, null)).toEqual([]);
	});
});

describe('localValido', () => {
	it('aceita a sede, aceita descendente e recusa unidade de fora', () => {
		expect(localValido(ARVORE, 20, null)).toBe(true); // sede
		expect(localValido(ARVORE, 20, 20)).toBe(true);
		expect(localValido(ARVORE, 20, 58)).toBe(true);
		// O posto de Quixeré é de Russas: não serve para quem é lotado em Aracati.
		expect(localValido(ARVORE, 20, 59)).toBe(false);
		// Nem o caminho inverso: trabalhar na seccional não é ser lotado nela.
		expect(localValido(ARVORE, 20, 4)).toBe(false);
		expect(localValido(ARVORE, null, 58)).toBe(false);
	});

	it('o departamento alcança o núcleo dele', () => {
		expect(localValido(ARVORE, 2, 63)).toBe(true);
	});
});

describe('rotuloDoLocal', () => {
	it('só diz alguma coisa quando o local é diferente da lotação', () => {
		expect(rotuloDoLocal('Aracati', { id: 58, nome: 'Posto de Fortim' })).toBe('Posto de Fortim');
		expect(rotuloDoLocal('Aracati', { id: 20, nome: 'Aracati' })).toBeNull();
		expect(rotuloDoLocal('Aracati', null)).toBeNull();
	});
});

describe('quemPerdeOLocal — a trava da troca de mãe (E73)', () => {
	// Os quatro de Fortim: lotados em Aracati, trabalhando no posto.
	const deFortim = { nome: 'LOTADO EM ARACATI', unidade_id: 20, local_id: 58 };
	// Lotado na 1ª Seccional e trabalhando em Fortim — vale, porque Fortim está
	// abaixo da seccional.
	const daSeccional = { nome: 'LOTADO NA SECCIONAL', unidade_id: 4, local_id: 58 };
	const naSede = { nome: 'NA SEDE', unidade_id: 20, local_id: null };

	it('Fortim pendurada em Russas: quem é lotado em Aracati perde o local', () => {
		expect(quemPerdeOLocal(ARVORE, 58, 51, [deFortim, naSede])).toEqual([deFortim]);
	});

	it('a mãe leva os postos junto: mudar Aracati de lugar não afeta quem é lotado nela', () => {
		// Aracati sai da 1ª Seccional para o departamento; Fortim vai junto.
		expect(quemPerdeOLocal(ARVORE, 20, 2, [deFortim])).toEqual([]);
	});

	it('mas afeta quem é lotado ACIMA e trabalha lá dentro', () => {
		// Lotado na 1ª Seccional, trabalhando em Fortim. Aracati (com Fortim) sai
		// da seccional: Fortim deixa de estar abaixo da lotação dele.
		expect(quemPerdeOLocal(ARVORE, 20, 2, [daSeccional])).toEqual([daSeccional]);
	});

	it('sem troca de mãe, ninguém perde nada', () => {
		expect(quemPerdeOLocal(ARVORE, 58, 20, [deFortim])).toEqual([]);
	});

	it('quem já estava fora da regra não é consequência desta troca e não trava', () => {
		const jaErrado = { nome: 'JÁ ERRADO', unidade_id: 51, local_id: 58 };
		expect(quemPerdeOLocal(ARVORE, 58, 51, [jaErrado])).toEqual([]);
	});

	it('unidade fora da árvore (desativada) não trava', () => {
		expect(quemPerdeOLocal(ARVORE, 9999, 51, [deFortim])).toEqual([]);
	});
});
