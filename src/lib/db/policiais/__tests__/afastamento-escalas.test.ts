/**
 * Afastamento × escalas (E60): afastado não se escala na data; escala onde
 * ele já estava fica desfalcada. Contra SQLite real com as tabelas de escala
 * ordinária e de GISE.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { adicionarTodosPoliciais } from '$lib/db/escalas';
import {
	afastadosNoPeriodo,
	afastamentosNasDatas,
	desfalquesDaEscala,
	desfalquesDaGise,
	descreverAfastamento,
	escalasDoServidorNoPeriodo
} from '../afastamento-escalas';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;
const LOT = 'DP de Aurora';
const A = 97001; // afastado 15/10–29/10 (LTS)
const B = 97002; // de férias 01/11–10/11
const C = 97003; // livre

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (97010, '${LOT}', 'delegacia'), (97011, 'Seccional X', 'seccional');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, regime) VALUES
			(${A}, '97001', 'AFASTADO', 'OIP', '${LOT}', 'h', 'plantao'),
			(${B}, '97002', 'DE FERIAS', 'OIP', '${LOT}', 'h', 'plantao'),
			(${C}, '97003', 'LIVRE', 'OIP', '${LOT}', 'h', 'plantao');
		INSERT INTO policial_historico (policial_id, tipo, subtipo, data_inicio, data_fim) VALUES
			(${A}, 'afastamento', 'lts', '2026-10-15', '2026-10-29'),
			(${B}, 'afastamento', 'ferias', '2026-11-01', '2026-11-10');
		INSERT INTO escalas (id, titulo, cidade, lotacao, tipo, data_inicio, data_fim) VALUES
			(97020, 'Plantão outubro', 'Aurora', '${LOT}', 'plantao', '2026-10-01', '2026-10-31');
		INSERT INTO escala_policiais (escala_id, policial_id, data_plantao, data_saida) VALUES
			(97020, ${A}, '2026-10-20', '2026-10-21'),
			(97020, ${A}, '2026-10-05', '2026-10-06'),
			(97020, ${C}, '2026-10-20', '2026-10-21');
		INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida) VALUES (97030, '2026-11-05', 'em_preenchimento', '08:00', '16:00');
		INSERT INTO gise_seccionais (id, gise_id, seccional_id) VALUES (97031, 97030, 97011);
		INSERT INTO gise_seccional_unidades (id, gise_seccional_id, unidade_id) VALUES (97032, 97031, 97010);
		INSERT INTO gise_equipes (id, gise_seccional_id, gise_unidade_id, tipo, slots_dpc, slots_oip) VALUES (97033, 97031, 97032, 'operacional', 1, 3);
		INSERT INTO gise_membros (equipe_id, policial_id, gise_id) VALUES (97033, ${B}, 97030), (97033, ${C}, 97030);
	`);
});

describe('escalar', () => {
	it('afastamentosNasDatas: só as datas cobertas; férias contam como afastamento', async () => {
		const a = await afastamentosNasDatas(db, A, [
			'2026-10-10',
			'2026-10-20',
			'2026-10-29',
			'2026-10-30'
		]);
		expect([...a.keys()]).toEqual(['2026-10-20', '2026-10-29']);
		expect(descreverAfastamento(a.get('2026-10-20')!)).toBe(
			'Tratamento de saúde (LTS ordinária) de 15/10/2026 a 29/10/2026'
		);
		const b = await afastamentosNasDatas(db, B, ['2026-11-05']);
		expect(descreverAfastamento(b.get('2026-11-05')!)).toBe('férias de 01/11/2026 a 10/11/2026');
	});

	it('afastadosNoPeriodo e "adicionar todos" deixam o afastado de fora', async () => {
		const afastados = await afastadosNoPeriodo(db, [A, B, C], '2026-10-01', '2026-10-31');
		expect([...afastados.keys()]).toEqual([A]);
		sqlite.exec(
			`INSERT INTO escalas (id, titulo, cidade, lotacao, tipo, data_inicio, data_fim) VALUES (97021, 'Plantão nov', 'Aurora', '${LOT}', 'plantao', '2026-11-20', '2026-11-20');`
		);
		// Um plantão em novembro (um por lotação/tipo/mês): B está de férias.
		const novembro = await afastadosNoPeriodo(db, [A, B, C], '2026-11-20', '2026-11-20');
		expect([...novembro.keys()]).toEqual([]);
		const deFerias = await afastadosNoPeriodo(db, [A, B, C], '2026-11-01', '2026-11-30');
		const n = await adicionarTodosPoliciais(
			db,
			97021,
			LOT,
			'plantao',
			'2026-11-20',
			'2026-11-21',
			'08:00',
			'08:00',
			new Set(deFerias.keys())
		);
		expect(n).toBe(2); // A e C; B (férias em novembro) ficou de fora
	});
});

describe('desfalques', () => {
	it('escalasDoServidorNoPeriodo: só os plantões dentro do afastamento, e a GISE', async () => {
		const deA = await escalasDoServidorNoPeriodo(db, A, '2026-10-15', '2026-10-29');
		expect(deA.map((e) => [e.tipo, e.data])).toEqual([['ordinaria', '2026-10-20']]);
		expect(deA[0].link).toBe('/escalas/97020');
		const deB = await escalasDoServidorNoPeriodo(db, B, '2026-11-01', '2026-11-10');
		expect(deB.map((e) => [e.tipo, e.data, e.lotacao])).toEqual([
			['gise', '2026-11-05', 'Seccional X']
		]);
		expect(await escalasDoServidorNoPeriodo(db, C, '2026-10-15', null)).toHaveLength(2);
	});

	it('desfalquesDaEscala e desfalquesDaGise: quem está escalado em dia de afastamento', async () => {
		const e = await desfalquesDaEscala(db, 97020);
		expect(e.map((d) => [d.nome, d.data])).toEqual([['AFASTADO', '2026-10-20']]);
		const g = await desfalquesDaGise(db, 97030);
		expect(g.map((d) => d.nome)).toEqual(['DE FERIAS']);
	});
});
