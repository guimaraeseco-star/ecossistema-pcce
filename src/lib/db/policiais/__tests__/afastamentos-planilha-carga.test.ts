/**
 * A planilha de afastamentos manda sobre o histórico: o evento equivalente
 * (período sobreposto) sai, o que ela não cobre fica, e a ordem das cargas
 * não importa.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { policiais, policialHistorico } from '$lib/server/schema';
import { regravarAfastamentosDaPlanilha, regravarHistoricoDaPlanilha } from '../carga-planilha';

let db: Database;
let p: number;

const doHistorico = [
	// O mesmo atestado, com datas mais pobres: sai quando a planilha chegar.
	{
		tipo: 'afastamento' as const,
		subtipo: 'lts',
		data_inicio: '2026-05-05',
		data_fim: '2026-06-01',
		descricao: 'LICENÇA MÉDICA'
	},
	// Férias no mesmo mês: NÃO podem ser suprimidas por um atestado.
	{
		tipo: 'afastamento' as const,
		subtipo: 'ferias',
		data_inicio: '2026-05-10',
		data_fim: '2026-05-19',
		descricao: 'FÉRIAS DE 10 A 19/05/2026'
	},
	// Fora do período da planilha: fica.
	{
		tipo: 'afastamento' as const,
		subtipo: 'lts',
		data_inicio: '2024-01-10',
		data_fim: '2024-02-08',
		descricao: 'ATESTADO 30 DIAS'
	},
	{ tipo: 'observacao' as const, descricao: 'PORTARIA 189/22' }
];
const daPlanilha = [
	{
		tipo: 'afastamento' as const,
		subtipo: 'lts',
		data_inicio: '2026-05-04',
		data_fim: '2026-06-02',
		descricao: 'MÉDICO · 30 dia(s)',
		nup: '10051.013800/2026-96'
	},
	{
		tipo: 'movimentacao' as const,
		data_evento: '2026-07-01',
		descricao: 'TRANSFERIR PARA A DDM TAUÁ'
	}
];

beforeEach(async () => {
	db = drizzleSobre(bancoMigrado());
	const [l] = await db
		.insert(policiais)
		.values({ nome: 'A', matricula: '12345678', cargo: 'OIP', lotacao: 'DP de Icó', senha: 'x' })
		.returning({ id: policiais.id });
	p = l.id;
});

const linhas = () =>
	db.select().from(policialHistorico).where(eq(policialHistorico.policial_id, p));

describe('afastamentos da planilha × histórico', () => {
	it('histórico primeiro: a planilha suprime o equivalente e poupa as férias', async () => {
		await regravarHistoricoDaPlanilha(db, p, doHistorico, 'hist');
		const r = await regravarAfastamentosDaPlanilha(db, p, daPlanilha, 'afast');
		expect(r).toEqual({ gravados: 2, suprimidosDoHistorico: 1 });
		const l = await linhas();
		expect(l.filter((x) => x.legado === 3)).toHaveLength(2);
		const legado2 = l.filter((x) => x.legado === 2);
		expect(legado2.map((x) => x.subtipo ?? '—').sort()).toEqual(['ferias', 'lts', '—']);
		expect(legado2.find((x) => x.subtipo === 'lts')?.data_inicio).toBe('2024-01-10');
		const daFonte = l.find((x) => x.legado === 3 && x.subtipo === 'lts')!;
		expect(daFonte).toMatchObject({
			data_inicio: '2026-05-04',
			data_fim: '2026-06-02',
			qtd_dias: 30,
			nup: '10051.013800/2026-96'
		});
	});

	it('planilha primeiro: o histórico não regrava o que ela já cobre', async () => {
		await regravarAfastamentosDaPlanilha(db, p, daPlanilha, 'afast');
		const r = await regravarHistoricoDaPlanilha(db, p, doHistorico, 'hist');
		expect(r.gravados).toBe(3);
		expect(r.repetidos).toBe(1);
		const l = await linhas();
		expect(l).toHaveLength(5);
		expect(
			l.filter((x) => x.legado === 2 && x.subtipo === 'lts' && x.data_inicio === '2026-05-05')
		).toHaveLength(0);
	});

	it('reexecutar a planilha não duplica e não toca no que a tela registrou', async () => {
		await db.insert(policialHistorico).values({
			policial_id: p,
			tipo: 'afastamento',
			subtipo: 'lts',
			data_inicio: '2026-05-04',
			data_fim: '2026-06-02',
			legado: 0
		});
		await regravarAfastamentosDaPlanilha(db, p, daPlanilha, 'afast');
		await regravarAfastamentosDaPlanilha(db, p, daPlanilha, 'afast');
		const l = await linhas();
		expect(l.filter((x) => x.legado === 3)).toHaveLength(2);
		expect(l.filter((x) => x.legado === 0)).toHaveLength(1);
	});
});

describe('planilha de afastamentos × evento vigente da planilha de servidores', () => {
	it('suprime o legado 1 equivalente e a recarga da folha não o traz de volta', async () => {
		const { regravarAfastamentosLegados } = await import('../carga-planilha');
		const daFolha = [
			{
				subtipo: 'lts' as const,
				data_inicio: '2026-05-05',
				data_fim: '2026-06-01',
				descricao: '',
				nup: ''
			},
			// Férias futuras: a planilha de afastamentos não cobre, então ficam.
			{
				subtipo: 'ferias' as const,
				data_inicio: '2026-12-01',
				data_fim: '2026-12-10',
				descricao: '',
				nup: ''
			}
		];
		await regravarAfastamentosLegados(db, p, daFolha, 'folha');
		const r = await regravarAfastamentosDaPlanilha(db, p, daPlanilha, 'afast');
		expect(r.suprimidosDoHistorico).toBe(1);
		expect((await linhas()).filter((x) => x.legado === 1)).toHaveLength(1);

		// A folha recarrega: o que a planilha de afastamentos cobre não volta.
		expect(await regravarAfastamentosLegados(db, p, daFolha, 'folha')).toBe(1);
		const l = await linhas();
		expect(l.filter((x) => x.legado === 1).map((x) => x.subtipo)).toEqual(['ferias']);
		expect(l.filter((x) => x.legado === 3)).toHaveLength(2);
	});
});
