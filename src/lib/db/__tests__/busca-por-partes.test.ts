/**
 * Busca por partes (pedido dele em 22/09) contra SQLite real: cada pedaço
 * digitado tem de aparecer em alguma das colunas, em qualquer ordem, sem
 * acento e sem caixa. Contra o banco de verdade porque quem normaliza é o
 * SQL — um mock provaria só que a função monta a string que ela monta.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { buscaPorPartes } from '../core';
import { policiais } from '$lib/server/schema';

let db: Database;

beforeEach(async () => {
	db = drizzleSobre(bancoMigrado());
	await db.insert(policiais).values([
		{ nome: 'JOSÉ DA SILVA SANTOS', matricula: '10001', cargo: 'OIP', lotacao: 'DP A', senha: 'x' },
		{ nome: 'MARIA SILVA', matricula: '10002', cargo: 'DPC', lotacao: 'DP A', senha: 'x' },
		{ nome: 'ANTÔNIO ASSUNÇÃO', matricula: '10003', cargo: 'OIP', lotacao: 'DP B', senha: 'x' }
	]);
});

const buscar = async (termo: string) => {
	const cond = buscaPorPartes([policiais.nome, policiais.matricula], termo);
	const linhas = await db
		.select({ nome: policiais.nome })
		.from(policiais)
		.where(cond)
		.orderBy(policiais.nome)
		.all();
	return linhas.map((l) => l.nome);
};

describe('buscaPorPartes', () => {
	it('acha por partes do nome, em qualquer ordem', async () => {
		expect(await buscar('jose silva')).toEqual(['JOSÉ DA SILVA SANTOS']);
		expect(await buscar('silva jose')).toEqual(['JOSÉ DA SILVA SANTOS']);
		expect(await buscar('silva')).toEqual(['JOSÉ DA SILVA SANTOS', 'MARIA SILVA']);
	});

	it('ignora acento dos dois lados e a caixa', async () => {
		expect(await buscar('antonio')).toEqual(['ANTÔNIO ASSUNÇÃO']);
		expect(await buscar('ASSUNCAO')).toEqual(['ANTÔNIO ASSUNÇÃO']);
		expect(await buscar('josé')).toEqual(['JOSÉ DA SILVA SANTOS']);
	});

	it('procura também nas outras colunas — a matrícula entra como um pedaço', async () => {
		expect(await buscar('10002')).toEqual(['MARIA SILVA']);
		expect(await buscar('maria 10002')).toEqual(['MARIA SILVA']);
		// Pedaço que não existe em coluna nenhuma derruba a linha inteira.
		expect(await buscar('maria 99999')).toEqual([]);
	});

	it('termo vazio não filtra nada (devolve `undefined` para o chamador)', () => {
		expect(buscaPorPartes([policiais.nome], '   ')).toBeUndefined();
		expect(buscaPorPartes([], 'silva')).toBeUndefined();
	});
});
