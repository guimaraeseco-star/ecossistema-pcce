/**
 * Complemento da carga da planilha (fase 2-C): designação no catálogo,
 * afastamentos legados regravados sem tocar os da tela, e o titular da
 * unidade com as três origens possíveis do vigente.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import {
	designacoes,
	policiais,
	policialHistorico,
	unidadeResponsaveis,
	unidades
} from '$lib/server/schema';
import {
	DESIGNACOES_DE_TITULAR,
	idDaDesignacao,
	regravarAfastamentosLegados,
	regravarHistoricoDaPlanilha,
	regravarTitularDaPlanilha
} from '../carga-planilha';

let db: Database;

async function policial(nome: string, lotacao: string) {
	const [l] = await db
		.insert(policiais)
		.values({ nome, matricula: `${Math.random()}`.slice(2, 10), cargo: 'DPC', lotacao, senha: 'x' })
		.returning({ id: policiais.id });
	return l.id;
}

beforeEach(() => {
	db = drizzleSobre(bancoMigrado());
});

describe('idDaDesignacao', () => {
	it('acha as semeadas sem diferenciar caixa/espaços e cria as desconhecidas', async () => {
		const semeadas = await db.select().from(designacoes);
		expect(semeadas.map((d) => d.nome)).toEqual(
			expect.arrayContaining([...DESIGNACOES_DE_TITULAR])
		);
		const titular = semeadas.find((d) => d.nome === 'Delegado Titular')!;
		expect(titular.simbolo).toBe('DAS-1');
		expect(await idDaDesignacao(db, '  delegado  titular ')).toBe(titular.id);
		expect(await idDaDesignacao(db, '')).toBeNull();

		const nova = await idDaDesignacao(db, 'Chefe de núcleo');
		expect(nova).toBeGreaterThan(0);
		expect(await idDaDesignacao(db, 'chefe de núcleo')).toBe(nova);
		expect((await db.select().from(designacoes)).length).toBe(semeadas.length + 1);
	});
});

describe('regravarAfastamentosLegados', () => {
	it('substitui só os legados; o que a tela registrou fica', async () => {
		const p = await policial('A', 'DP de Icó');
		await db.insert(policialHistorico).values({
			policial_id: p,
			tipo: 'afastamento',
			subtipo: 'ferias',
			data_inicio: '2026-01-05',
			data_fim: '2026-01-14',
			legado: 0
		});
		await regravarAfastamentosLegados(
			db,
			p,
			[
				{
					subtipo: 'lts',
					data_inicio: '2026-03-01',
					data_fim: '2026-03-30',
					descricao: 'x',
					nup: '1'
				}
			],
			'carga'
		);
		await regravarAfastamentosLegados(
			db,
			p,
			[
				{
					subtipo: 'ferias',
					data_inicio: '2026-09-08',
					data_fim: '2026-09-17',
					descricao: '',
					nup: ''
				}
			],
			'carga'
		);
		const linhas = await db
			.select()
			.from(policialHistorico)
			.where(eq(policialHistorico.policial_id, p));
		expect(linhas).toHaveLength(2);
		const legado = linhas.find((l) => l.legado === 1)!;
		expect(legado).toMatchObject({
			subtipo: 'ferias',
			data_inicio: '2026-09-08',
			qtd_dias: 10,
			nup: null
		});
		expect(linhas.find((l) => l.legado === 0)?.subtipo).toBe('ferias');
	});
});

describe('regravarTitularDaPlanilha', () => {
	it('grava, mantém a mesma pessoa, substitui a da planilha e respeita a do sistema', async () => {
		const [u] = await db
			.insert(unidades)
			.values({ nome: 'DP de Icó', tipo: 'delegacia' })
			.returning({ id: unidades.id });
		const a = await policial('A', 'DP de Icó');
		const b = await policial('B', 'DP de Icó');

		expect(await regravarTitularDaPlanilha(db, a, 'DP de Icó', '2026-09-16')).toEqual({
			acao: 'gravado'
		});
		expect(await regravarTitularDaPlanilha(db, a, 'DP de Icó', '2026-10-01')).toEqual({
			acao: 'mantido'
		});
		expect(await regravarTitularDaPlanilha(db, b, 'DP de Icó', '2026-10-01')).toEqual({
			acao: 'substituido'
		});
		const linhas = await db
			.select()
			.from(unidadeResponsaveis)
			.where(eq(unidadeResponsaveis.unidade_id, u.id));
		expect(linhas).toHaveLength(2);
		expect(linhas.find((l) => l.policial_id === a)).toMatchObject({
			data_inicio: '2026-09-16',
			data_fim: '2026-10-01',
			origem: 'planilha'
		});
		expect(linhas.find((l) => l.policial_id === b)?.data_fim).toBeNull();

		// A tela cadastrou outro titular: a planilha não passa por cima.
		await db
			.update(unidadeResponsaveis)
			.set({ origem: 'sistema' })
			.where(eq(unidadeResponsaveis.policial_id, b));
		expect(await regravarTitularDaPlanilha(db, a, 'DP de Icó', '2026-11-01')).toEqual({
			acao: 'vigente_do_sistema',
			vigentePolicialId: b
		});
		expect(await regravarTitularDaPlanilha(db, a, 'DP inexistente', '2026-11-01')).toEqual({
			acao: 'unidade_desconhecida'
		});
	});
});

describe('regravarHistoricoDaPlanilha', () => {
	it('grava os eventos do texto, pula os repetidos de outra origem e regrava só os seus', async () => {
		const p = await policial('A', 'DP de Icó');
		// O evento atual da planilha de servidores (legado 1) e um da tela (legado 0).
		await regravarAfastamentosLegados(
			db,
			p,
			[
				{
					subtipo: 'ferias',
					data_inicio: '2026-09-08',
					data_fim: '2026-09-17',
					descricao: '',
					nup: ''
				}
			],
			'carga'
		);
		await db.insert(policialHistorico).values({
			policial_id: p,
			tipo: 'movimentacao',
			descricao: 'Transferido para a DP de Icó',
			data_evento: '2024-03-01'
		});
		const eventos = [
			{
				tipo: 'afastamento' as const,
				subtipo: 'ferias',
				data_inicio: '2026-09-08',
				data_fim: '2026-09-17',
				descricao: 'FÉRIAS DE 08 A 17/09/2026'
			},
			{
				tipo: 'afastamento' as const,
				subtipo: 'ferias',
				data_inicio: '2025-01-02',
				data_fim: '2025-01-11',
				descricao: 'FÉRIAS DE 02 A 11/01/2025'
			},
			{
				tipo: 'observacao' as const,
				descricao: 'AFASTAMENTO ELEITORAL',
				nup: '10051.027822/2026-33'
			},
			{
				tipo: 'movimentacao' as const,
				data_evento: '2022-02-18',
				unidade_destino: 'DPISUL',
				descricao: 'Transferido da DRFVC para o DPISUL em 18/02/22'
			}
		];
		expect(await regravarHistoricoDaPlanilha(db, p, eventos, 'hist')).toEqual({
			gravados: 3,
			repetidos: 1
		});
		// Reexecutar: apaga os seus e regrava — nada duplica.
		expect(await regravarHistoricoDaPlanilha(db, p, eventos, 'hist')).toEqual({
			gravados: 3,
			repetidos: 1
		});
		const linhas = await db
			.select()
			.from(policialHistorico)
			.where(eq(policialHistorico.policial_id, p));
		expect(linhas).toHaveLength(5);
		const obs = linhas.find((l) => l.tipo === 'observacao')!;
		expect(obs.created_at).toBe('1970-01-01 00:00:00');
		expect(obs.nup).toBe('10051.027822/2026-33');
		expect(linhas.find((l) => l.legado === 2 && l.subtipo === 'ferias')?.created_at).toBe(
			'2025-01-02 00:00:00'
		);
		expect(linhas.filter((l) => l.legado === 1)).toHaveLength(1);
	});
});
