/**
 * As travas da estrutura (E73, parte 1), contra SQLite real com as migrações.
 *
 * O cenário é o de Fortim, que motivou as duas: um posto sob Aracati onde
 * servidores LOTADOS em Aracati TRABALHAM. Antes da E73, dava para pendurar
 * Fortim em Russas (deixando-os com o "trabalha em" fora da lotação) e dava
 * para desativar Fortim com eles apontando para ela.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { travaDaDesativacao, travaDaSincronizacao, travaDaTrocaDeMae } from '../travas';

let sqlite: DatabaseSync;
let db: Database;

const DEP = 9400;
const SECC = 9401;
const ARACATI = 9402;
const FORTIM = 9403;
const RUSSAS = 9404;
const OUTRA_SECC = 9405;

function servidor(
	id: number,
	nome: string,
	unidadeId: number | null,
	localId: number | null,
	ativo = 1
) {
	sqlite
		.prepare(
			`INSERT INTO policiais (id, matricula, nome, cargo, lotacao, unidade_id, local_id, senha, ativo)
			 VALUES (?, ?, ?, 'OIP', ?, ?, ?, 'x', ?)`
		)
		.run(id, String(id), nome, unidadeId ? `UNIDADE ${unidadeId}` : '', unidadeId, localId, ativo);
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo, seccional_id) VALUES
			(${DEP}, 'DEP TESTE', 'departamento', NULL),
			(${SECC}, 'SECCIONAL TESTE', 'seccional', ${DEP}),
			(${ARACATI}, 'DP ARACATI TESTE', 'delegacia', ${SECC}),
			(${FORTIM}, 'POSTO FORTIM TESTE', 'unidade', ${ARACATI}),
			(${RUSSAS}, 'DP RUSSAS TESTE', 'delegacia', ${SECC}),
			(${OUTRA_SECC}, 'OUTRA SECCIONAL TESTE', 'seccional', ${DEP});
	`);
	// Dois lotados em Aracati trabalhando em Fortim; um na sede de Aracati; um
	// INATIVO que também apontava para Fortim — aposentado não trava nada.
	servidor(96001, 'ANA DE FORTIM', ARACATI, FORTIM);
	servidor(96002, 'BRUNO DE FORTIM', ARACATI, FORTIM);
	servidor(96003, 'CARLA DA SEDE', ARACATI, null);
	servidor(96004, 'DAVI APOSENTADO', ARACATI, FORTIM, 0);
});

describe('a trava da troca de mãe', () => {
	it('recusa pendurar Fortim em Russas, e diz quem e o que fazer', async () => {
		const trava = await travaDaTrocaDeMae(db, FORTIM, RUSSAS);
		expect(trava).not.toBeNull();
		expect(trava).toContain('POSTO FORTIM TESTE');
		expect(trava).toContain('2 servidores trabalham');
		expect(trava).toContain('ANA DE FORTIM, BRUNO DE FORTIM');
		expect(trava).toContain('mude o "trabalha em"');
		// A ordem é a dele: primeiro as pessoas, depois a estrutura.
		expect(trava!.indexOf('1.')).toBeLessThan(trava!.indexOf('2. Depois, troque'));
		// O aposentado não entra.
		expect(trava).not.toContain('DAVI');
	});

	it('com o "trabalha em" resolvido, a troca passa', async () => {
		sqlite.exec(`UPDATE policiais SET local_id = NULL WHERE local_id = ${FORTIM} AND ativo = 1`);
		expect(await travaDaTrocaDeMae(db, FORTIM, RUSSAS)).toBeNull();
	});

	it('mover Aracati inteira não trava: os postos vão junto', async () => {
		expect(await travaDaTrocaDeMae(db, ARACATI, OUTRA_SECC)).toBeNull();
	});

	it('mas trava para quem é lotado acima e trabalha lá dentro', async () => {
		servidor(96005, 'EVA DA SECCIONAL', SECC, FORTIM);
		const trava = await travaDaTrocaDeMae(db, ARACATI, OUTRA_SECC);
		expect(trava).toContain('EVA DA SECCIONAL');
		expect(trava).not.toContain('ANA DE FORTIM');
	});

	it('sem troca de mãe não há o que travar', async () => {
		expect(await travaDaTrocaDeMae(db, FORTIM, ARACATI)).toBeNull();
	});
});

describe('a trava da desativação', () => {
	it('recusa desativar Fortim com gente trabalhando nela', async () => {
		const trava = await travaDaDesativacao(db, FORTIM);
		expect(trava).toContain('Não é possível desativar "POSTO FORTIM TESTE"');
		expect(trava).toContain('ANA DE FORTIM, BRUNO DE FORTIM');
		expect(trava).toContain('Depois, desative.');
		expect(trava).not.toContain('DAVI');
	});

	it('recusa desativar Aracati: tem lotados E um posto ativo abaixo', async () => {
		const trava = await travaDaDesativacao(db, ARACATI);
		expect(trava).toContain('gente e unidades');
		expect(trava).toContain('Mova a lotação dos 3 servidores lotados');
		expect(trava).toContain('CARLA DA SEDE');
		expect(trava).toContain('POSTO FORTIM TESTE');
	});

	it('quem é lotado E trabalha na sede conta uma vez só, como lotado', async () => {
		sqlite.exec(`UPDATE policiais SET local_id = ${ARACATI} WHERE id = 96003`);
		const trava = await travaDaDesativacao(db, ARACATI);
		expect(trava).toContain('dos 3 servidores lotados');
		expect(trava).not.toContain('trabalha em');
	});

	it('unidade sem ninguém dependendo dela desativa', async () => {
		expect(await travaDaDesativacao(db, RUSSAS)).toBeNull();
	});

	it('só gente INATIVA e filha INATIVA não travam', async () => {
		sqlite.exec(`
			UPDATE policiais SET ativo = 0 WHERE unidade_id = ${ARACATI};
			UPDATE unidades SET ativo = 0 WHERE id = ${FORTIM};
		`);
		expect(await travaDaDesativacao(db, ARACATI)).toBeNull();
	});
});

describe('a porta da planilha', () => {
	it('a sincronização que penduraria Fortim em Russas é recusada', async () => {
		const trava = await travaDaSincronizacao(db, 'POSTO FORTIM TESTE', RUSSAS);
		expect(trava).toContain('ANA DE FORTIM');
	});

	it('o nome vem da planilha com espaço sobrando e mesmo assim é achado', async () => {
		expect(await travaDaSincronizacao(db, '  POSTO FORTIM TESTE  ', RUSSAS)).not.toBeNull();
	});

	it('unidade nova na planilha não tem quem perder o local', async () => {
		expect(await travaDaSincronizacao(db, 'UNIDADE QUE AINDA NÃO EXISTE', RUSSAS)).toBeNull();
	});

	it('a mesma mãe de sempre não trava nem carrega a árvore', async () => {
		expect(await travaDaSincronizacao(db, 'POSTO FORTIM TESTE', ARACATI)).toBeNull();
	});
});
