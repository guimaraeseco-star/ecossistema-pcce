/**
 * O escopo de escrita da linha de base, contra SQLite real.
 *
 * O que estes testes protegem: `unidade_id` chega no CORPO do POST, não na URL.
 * Um handler que confia nesse valor deixa qualquer admin autenticado reescrever
 * a base de qualquer delegacia — a base é parâmetro de um resultado divulgado, e
 * o formato do buraco é o mesmo do FLW-ESC-002.
 *
 * A regra tem DUAS condições, e cada uma tem seu caso negativo aqui: administrar
 * a unidade não basta se ela não participa da operação, e participar não basta
 * se não é administrada.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import type { DatabaseSync } from 'node:sqlite';
import type { UsuarioLogado } from '$lib/auth';
import type { Database } from '$lib/db';
import {
	unidadesLinhaBaseAdministradas,
	podeInformarLinhaBase,
	temLinhaBaseAPreencher,
	operacoesComLinhaBase,
	operacoesComLinhaBasePendente
} from '../permissao';

let sqlite: DatabaseSync;
let db: Database;
let craId: number;
let giseId: number;

/** Ids das unidades do cenário, montado uma vez por teste. */
let seccional: number;
let crato: number;
let barbalha: number;
let deOutraSeccional: number;
let foraDaOperacao: number;

function novaUnidade(nome: string, tipo = 'delegacia', seccionalId: number | null = null): number {
	sqlite
		.prepare('INSERT INTO unidades (nome, tipo, seccional_id) VALUES (?, ?, ?)')
		.run(nome, tipo, seccionalId);
	return Number((sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
}

/** Escala da operação com uma seccional e uma delegacia em slot. */
function escalaCom(operacaoId: number, seccionalId: number, slots: number[]) {
	sqlite
		.prepare('INSERT INTO gise_escalas (data_inicio, operacao_id) VALUES (?, ?)')
		.run('2026-08-15', operacaoId);
	const escId = Number(
		(sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
	);
	sqlite
		.prepare('INSERT INTO gise_seccionais (gise_id, seccional_id) VALUES (?, ?)')
		.run(escId, seccionalId);
	const secId = Number(
		(sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
	);
	for (const s of slots) {
		sqlite
			.prepare('INSERT INTO gise_seccional_unidades (gise_seccional_id, unidade_id) VALUES (?, ?)')
			.run(secId, s);
	}
}

function usuario(over: Partial<UsuarioLogado>): UsuarioLogado {
	return { id: 1, tipo: 'policial', nome: 'Fulano', primeiro_acesso: false, ...over };
}

const admGeral = usuario({ tipo: 'admin', nome: 'Admin Geral' });

beforeEach(async () => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);

	craId = Number(
		(
			sqlite.prepare(`SELECT id FROM operacoes WHERE nome = 'OPERAÇÃO CRAJUBAR'`).get() as {
				id: number;
			}
		).id
	);
	giseId = Number(
		(sqlite.prepare(`SELECT id FROM operacoes WHERE nome = 'GISE'`).get() as { id: number }).id
	);

	seccional = novaUnidade('2ª SECCIONAL DO CARIRI', 'seccional');
	crato = novaUnidade('DELEGACIA DO CRATO', 'delegacia', seccional);
	barbalha = novaUnidade('DELEGACIA DE BARBALHA', 'delegacia', seccional);
	const outraSec = novaUnidade('1ª SECCIONAL', 'seccional');
	deOutraSeccional = novaUnidade('DELEGACIA DE FORTALEZA', 'delegacia', outraSec);
	foraDaOperacao = novaUnidade('DELEGACIA DE SOBRAL', 'delegacia', seccional);

	// CRAJUBAR: a 2ª Seccional com Crato e Barbalha em slot. Sobral é subordinada
	// à mesma seccional mas NÃO entra em escala nenhuma.
	escalaCom(craId, seccional, [crato, barbalha]);
	// GISE: outra seccional, para provar o recorte por operação.
	escalaCom(giseId, outraSec, [deOutraSeccional]);
});

describe('sem sessão ou sem papel', () => {
	it('usuário nulo não administra nada', async () => {
		expect(await unidadesLinhaBaseAdministradas(db, null, craId)).toEqual(new Set());
	});

	it('policial sem papel não administra nada', async () => {
		const u = usuario({ papel: null });
		expect(await unidadesLinhaBaseAdministradas(db, u, craId)).toEqual(new Set());
	});

	it('admin com papel mas SEM papel_unidade_id não administra nada', async () => {
		// Sem unidade de papel não há escopo — nunca "então mostra tudo".
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: null });
		expect(await unidadesLinhaBaseAdministradas(db, u, craId)).toEqual(new Set());
	});
});

describe('Admin Geral', () => {
	it('recebe todas as unidades participantes da operação', async () => {
		const escopo = await unidadesLinhaBaseAdministradas(db, admGeral, craId);
		expect(escopo).toEqual(new Set([seccional, crato, barbalha]));
	});

	it('não recebe unidade que só participa de OUTRA operação', async () => {
		const escopo = await unidadesLinhaBaseAdministradas(db, admGeral, craId);
		expect(escopo.has(deOutraSeccional)).toBe(false);
	});

	it('não recebe unidade que não participa de escala nenhuma', async () => {
		const escopo = await unidadesLinhaBaseAdministradas(db, admGeral, craId);
		expect(escopo.has(foraDaOperacao)).toBe(false);
	});
});

describe('admin_unidade', () => {
	it('administra só a própria unidade de papel', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: crato });
		expect(await unidadesLinhaBaseAdministradas(db, u, craId)).toEqual(new Set([crato]));
	});

	it('não alcança a unidade vizinha da mesma seccional', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: crato });
		expect(await podeInformarLinhaBase(db, u, craId, barbalha)).toBe(false);
	});

	it('unidade que não participa da operação é recusada', async () => {
		// Administrar não basta: a unidade precisa estar na operação.
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: foraDaOperacao });
		expect(await unidadesLinhaBaseAdministradas(db, u, craId)).toEqual(new Set());
		expect(await podeInformarLinhaBase(db, u, craId, foraDaOperacao)).toBe(false);
	});

	it('a mesma unidade em outra operação não vaza', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: crato });
		expect(await unidadesLinhaBaseAdministradas(db, u, giseId)).toEqual(new Set());
	});
});

describe('admin_seccional', () => {
	it('administra a própria seccional e as subordinadas que participam', async () => {
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: seccional });
		expect(await unidadesLinhaBaseAdministradas(db, u, craId)).toEqual(
			new Set([seccional, crato, barbalha])
		);
	});

	it('subordinada que não participa fica de fora', async () => {
		// Sobral é da mesma seccional, mas não está em escala nenhuma da CRAJUBAR.
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: seccional });
		expect(await podeInformarLinhaBase(db, u, craId, foraDaOperacao)).toBe(false);
	});

	it('não alcança unidade de outra seccional', async () => {
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: seccional });
		expect(await podeInformarLinhaBase(db, u, giseId, deOutraSeccional)).toBe(false);
	});
});

describe('podeInformarLinhaBase', () => {
	it('concorda com o conjunto devolvido por unidadesLinhaBaseAdministradas', async () => {
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: seccional });
		const escopo = await unidadesLinhaBaseAdministradas(db, u, craId);
		for (const id of [seccional, crato, barbalha, foraDaOperacao, deOutraSeccional]) {
			expect(await podeInformarLinhaBase(db, u, craId, id)).toBe(escopo.has(id));
		}
	});

	it('Admin Geral pode informar a base de participante', async () => {
		expect(await podeInformarLinhaBase(db, admGeral, craId, crato)).toBe(true);
	});
});

describe('temLinhaBaseAPreencher — quem vê a aba "Dados base"', () => {
	// A aba só aparece com as DUAS condições valendo para a MESMA operação:
	// a operação pede base (tem indicador percentual) E o admin administra alguma
	// unidade participante dela. A CRAJUBAR já nasce com três indicadores
	// percentuais pela migração 0050, e é ela que o cenário escala.

	const doCrato = usuario({ papel: 'admin_unidade', papel_unidade_id: 0 });

	it('admin da unidade escalada em operação com indicador percentual → vê', async () => {
		expect(await temLinhaBaseAPreencher(db, { ...doCrato, papel_unidade_id: crato })).toBe(true);
	});

	it('admin seccional da seccional escalada → vê', async () => {
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: seccional });
		expect(await temLinhaBaseAPreencher(db, u)).toBe(true);
	});

	it('admin de unidade FORA de qualquer escala → não vê', async () => {
		// Sobral é subordinada à mesma seccional, mas não entra em escala nenhuma.
		// Era este o caso que abria uma tela vazia.
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: foraDaOperacao });
		expect(await temLinhaBaseAPreencher(db, u)).toBe(false);
	});

	it('admin escalado só em operação SEM indicador percentual → não vê', async () => {
		// A GISE não tem indicador nenhum semeado; quem só participa dela não tem
		// base a informar, mesmo estando escalado.
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: deOutraSeccional });
		expect(await temLinhaBaseAPreencher(db, u)).toBe(false);
	});

	it('operação desativada não conta como pendência', async () => {
		sqlite.prepare('UPDATE operacoes SET ativo = 0 WHERE id = ?').run(craId);
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: crato });
		expect(await temLinhaBaseAPreencher(db, u)).toBe(false);
	});

	it('policial sem papel e sem sessão não veem', async () => {
		expect(await temLinhaBaseAPreencher(db, null)).toBe(false);
		expect(await temLinhaBaseAPreencher(db, usuario({ papel: null }))).toBe(false);
	});

	it('Admin Geral não vê — para ele a conferência é por operação', async () => {
		// Não é falta de permissão: `/operacoes/dados-base` continua aberta a ele, e o acesso
		// é pelo botão dentro de /operacoes/gise/operacoes.
		expect(await temLinhaBaseAPreencher(db, admGeral)).toBe(false);
	});

	it('admin com papel mas sem papel_unidade_id não vê', async () => {
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: null });
		expect(await temLinhaBaseAPreencher(db, u)).toBe(false);
	});
});

describe('operacoesComLinhaBase — quais operações PEDEM base', () => {
	// É o critério do botão "Dados base" na linha de cada operação, e o mesmo da
	// flag do menu. Só meta PERCENTUAL pede base: absoluta já é o alvo e cobertura
	// traz o próprio denominador no relatório.

	function comModelo(nome: string, config: string): number {
		sqlite.prepare(`INSERT INTO operacoes (nome) VALUES (?)`).run(nome);
		const id = Number(
			(sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
		);
		sqlite
			.prepare(`INSERT INTO gise_modelo_formulario (operacao_id, tipo, config) VALUES (?, ?, ?)`)
			.run(id, 'operacional', config);
		return id;
	}

	it('a CRAJUBAR entra: a migração 0050 semeia três indicadores percentuais', async () => {
		const comBase = await operacoesComLinhaBase(db, [{ id: craId }, { id: giseId }]);
		expect(comBase.has(craId)).toBe(true);
	});

	it('a GISE não entra: não tem indicador nenhum', async () => {
		const comBase = await operacoesComLinhaBase(db, [{ id: craId }, { id: giseId }]);
		expect(comBase.has(giseId)).toBe(false);
	});

	it('operação só com meta ABSOLUTA não entra', async () => {
		const id = comModelo(
			'OP ABSOLUTA',
			JSON.stringify([
				{
					id: 1,
					texto: 'Operações com o DRCO',
					tipo: 'numero',
					key: 'abs',
					indicador: { objetivo: 'aumentar', metaTipo: 'absoluto', metaValor: 1 }
				}
			])
		);
		expect((await operacoesComLinhaBase(db, [{ id }])).has(id)).toBe(false);
	});

	it('operação só com meta de COBERTURA não entra', async () => {
		// O denominador vem no próprio relatório — não há o que pedir à delegacia.
		const id = comModelo(
			'OP COBERTURA',
			JSON.stringify([
				{
					id: 1,
					texto: 'Atendimentos de fim de semana',
					tipo: 'proporcao',
					key: 'cob',
					indicador: { metaTipo: 'proporcao', metaValor: 100 }
				}
			])
		);
		expect((await operacoesComLinhaBase(db, [{ id }])).has(id)).toBe(false);
	});

	it('config corrompido não derruba a consulta — a operação só fica de fora', async () => {
		const id = comModelo('OP JSON QUEBRADO', '{isso não é json');
		expect((await operacoesComLinhaBase(db, [{ id }])).has(id)).toBe(false);
	});

	it('lista vazia devolve conjunto vazio sem consultar', async () => {
		expect(await operacoesComLinhaBase(db, [])).toEqual(new Set());
	});
});

describe('operacoesComLinhaBasePendente — o que o índice de /operacoes/dados-base decide', () => {
	it('admin da unidade escalada recebe a CRAJUBAR, e só ela', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: crato });
		const pendentes = await operacoesComLinhaBasePendente(db, u);
		expect(pendentes.map((o) => o.nome)).toEqual(['OPERAÇÃO CRAJUBAR']);
	});

	it('admin de unidade fora de qualquer escala não recebe nada', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: foraDaOperacao });
		expect(await operacoesComLinhaBasePendente(db, u)).toEqual([]);
	});

	it('operação desativada sai da lista', async () => {
		sqlite.prepare('UPDATE operacoes SET ativo = 0 WHERE id = ?').run(craId);
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: crato });
		expect(await operacoesComLinhaBasePendente(db, u)).toEqual([]);
	});

	it('Admin Geral recebe a lista — o índice é aberto a ele', async () => {
		// `temLinhaBaseAPreencher` devolve false para ele (é sobre o MENU), mas a
		// tela continua acessível pelo botão de cada operação.
		const pendentes = await operacoesComLinhaBasePendente(db, admGeral);
		expect(pendentes.map((o) => o.nome)).toContain('OPERAÇÃO CRAJUBAR');
	});
});
