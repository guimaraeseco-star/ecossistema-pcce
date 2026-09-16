/**
 * A lista de servidores (`/servidores`) precisa do NOME da designação, não do
 * `designacao_id` — e do filtro por ela, que é o que responde "quem são os de
 * plantão" e "quantos chefes de cartório há nesta unidade".
 *
 * Contra SQLite real porque o que se testa é o LEFT JOIN: um INNER esconderia
 * silenciosamente quem está sem designação (a célula vazia da planilha), e esse
 * é o tipo de sumiço que ninguém percebe olhando a tela.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '../../__tests__/sqlite-migrado';
import { criarPolicial, listarPoliciais } from '../cadastro';

let db: Database;

/** Ids semeados pela 0088: 3 = Delegado Titular (DAS-1), 15 = Plantão. */
const DELEGADO_TITULAR = 3;
const PLANTAO = 15;

beforeEach(async () => {
	db = drizzleSobre(bancoMigrado());
	await criarPolicial(db, {
		nome: 'ANA TITULAR',
		matricula: '1000001',
		cargo: 'DPC',
		lotacao: 'DP de Milagres',
		designacao_id: DELEGADO_TITULAR
	});
	await criarPolicial(db, {
		nome: 'BRUNO PLANTONISTA',
		matricula: '1000002',
		cargo: 'OIP',
		lotacao: 'DP de Milagres',
		designacao_id: PLANTAO
	});
	await criarPolicial(db, {
		nome: 'CARLA SEM DESIGNACAO',
		matricula: '1000003',
		cargo: 'OIP',
		lotacao: 'DP de Milagres'
	});
});

describe('listarPoliciais — designação', () => {
	it('traz o nome e o símbolo já resolvidos', async () => {
		const { policiais } = await listarPoliciais(db, 'DP de Milagres');
		const ana = policiais.find((p) => p.nome === 'ANA TITULAR');
		expect(ana?.designacao).toBe('Delegado Titular');
		expect(ana?.designacao_simbolo).toBe('DAS-1');
	});

	it('quem está SEM designação continua na lista', async () => {
		const { policiais, total } = await listarPoliciais(db, 'DP de Milagres');
		expect(total).toBe(3);
		const carla = policiais.find((p) => p.nome === 'CARLA SEM DESIGNACAO');
		expect(carla).toBeDefined();
		expect(carla?.designacao).toBeNull();
	});

	it('filtra pela função exercida', async () => {
		const { policiais, total } = await listarPoliciais(db, 'DP de Milagres', false, {
			designacaoId: PLANTAO
		});
		expect(total).toBe(1);
		expect(policiais[0].nome).toBe('BRUNO PLANTONISTA');
	});

	it('nasce com a origem "planilha" — a tela é que marca "sistema"', async () => {
		const { policiais } = await listarPoliciais(db, 'DP de Milagres');
		expect(policiais.every((p) => p.designacao_origem === 'planilha')).toBe(true);
	});
});
