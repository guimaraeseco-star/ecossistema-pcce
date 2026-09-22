/**
 * O atalho "designar como titular" (E66) e a régua da designação de direção
 * (E69), contra SQLite real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { responsavelVigente } from '$lib/db/unidades-responsaveis';
import { motivoParaRecusarDesignacao } from '$lib/db/policiais/designacoes';
import { designarTitularNoAto } from '../designar-titular';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;
const QUEM = { id: 1, nome: 'Admin Geral' };
let idTitular = 0;
let idAdjunto = 0;
let idChefeSecao = 0;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES
			(97010, 'DP de Aurora', 'delegacia'),
			(97011, 'DP de Barro', 'delegacia');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES
			(97001, '97001', 'DELEGADO NOVO', 'DPC', 'DP de Aurora', 'h'),
			(97002, '97002', 'DELEGADO ANTIGO', 'DPC', 'DP de Barro', 'h'),
			(97003, '97003', 'INSPETOR', 'OIP', 'DP de Aurora', 'h');
-- O catálogo já vem semeado pela migração 0088: só apanhamos os ids.
	`);
	const pega = (nome: string) =>
		(sqlite.prepare('SELECT id FROM designacoes WHERE nome = ?').get(nome) as { id: number }).id;
	idTitular = pega('Delegado Titular');
	idAdjunto = pega('Delegado Adjunto');
	idChefeSecao = pega('Chefe de seção de operações');
});

describe('designarTitularNoAto', () => {
	it('designa o delegado na unidade sem titular, com vigência e NUP', async () => {
		const r = await designarTitularNoAto(db, {
			unidadeNome: 'DP de Aurora',
			policialId: 97001,
			cargo: 'DPC',
			dataInicio: '2026-09-22',
			nup: '00000.000000/2026-00',
			quem: QUEM
		});
		expect(r).toEqual({ ok: true, unidadeId: 97010 });
		const vigente = await responsavelVigente(db, 97010);
		expect(vigente).toMatchObject({
			policial_id: 97001,
			papel: 'titular',
			data_inicio: '2026-09-22',
			nup: '00000.000000/2026-00'
		});
	});

	it('recusa em vez de adivinhar: unidade com titular, OIP, sem NUP, unidade desconhecida', async () => {
		await designarTitularNoAto(db, {
			unidadeNome: 'DP de Barro',
			policialId: 97002,
			cargo: 'DPC',
			dataInicio: '2026-09-01',
			nup: '1',
			quem: QUEM
		});
		const ocupada = await designarTitularNoAto(db, {
			unidadeNome: 'DP de Barro',
			policialId: 97001,
			cargo: 'DPC',
			dataInicio: '2026-09-22',
			nup: '2',
			quem: QUEM
		});
		expect(ocupada).toEqual({ ok: false, motivo: 'ja_tem_titular' });

		const oip = await designarTitularNoAto(db, {
			unidadeNome: 'DP de Aurora',
			policialId: 97003,
			cargo: 'OIP',
			dataInicio: '2026-09-22',
			nup: '3',
			quem: QUEM
		});
		expect(oip).toEqual({ ok: false, motivo: 'nao_e_delegado' });

		const semNup = await designarTitularNoAto(db, {
			unidadeNome: 'DP de Aurora',
			policialId: 97001,
			cargo: 'DPC',
			dataInicio: '2026-09-22',
			nup: '   ',
			quem: QUEM
		});
		expect(semNup).toEqual({ ok: false, motivo: 'sem_nup' });

		const inexistente = await designarTitularNoAto(db, {
			unidadeNome: 'DP de Lugar Nenhum',
			policialId: 97001,
			cargo: 'DPC',
			dataInicio: '2026-09-22',
			nup: '4',
			quem: QUEM
		});
		expect(inexistente).toEqual({ ok: false, motivo: 'unidade_desconhecida' });
		// Nenhuma recusa deixou rastro: Aurora continua sem direção.
		expect(await responsavelVigente(db, 97010)).toBeNull();
	});
});

describe('motivoParaRecusarDesignacao (E69)', () => {
	it('direção da unidade só em DPC; chefia de seção pode ser OIP', async () => {
		expect(await motivoParaRecusarDesignacao(db, idTitular, 'OIP')).toMatch(/só cabe em delegado/);
		expect(await motivoParaRecusarDesignacao(db, idAdjunto, 'OIP')).toMatch(/só cabe em delegado/);
		expect(await motivoParaRecusarDesignacao(db, idChefeSecao, 'OIP')).toBeNull();
		expect(await motivoParaRecusarDesignacao(db, idTitular, 'DPC')).toBeNull();
		expect(await motivoParaRecusarDesignacao(db, null, 'OIP')).toBeNull();
	});
});
