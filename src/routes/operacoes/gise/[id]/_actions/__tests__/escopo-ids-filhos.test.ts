/**
 * Id filho do formulário pertence à GISE da URL — FLW-GISE-007.
 *
 * Os preâmbulos resolvem o filho (equipe, seccional, membro) com a GISE da rota
 * no `WHERE`. Sem isso, um id de OUTRA escala é aceito: a mutação cai na
 * entidade alheia enquanto a invalidação de documento e o gate de status caem na
 * GISE da URL — duas escalas erradas de uma vez, e nenhuma tela mostra o
 * estrago.
 *
 * `removerMembro` era o último aberto: o join subia até `gise_seccionais` para
 * descobrir a seccional, mas o `WHERE` filtrava só por `giseMembros.id`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { carregarEquipeDaGise, carregarMembroDaGise, carregarSeccionalDaGise } from '../shared';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const GISE_A = 99001;
const GISE_B = 99002;
const SEC_A = 99101;
const SEC_B = 99102;
const EQ_A = 99201;
const EQ_B = 99202;
const MEM_A = 99301;
const MEM_B = 99302;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (99401, 'SECCIONAL X', 'seccional');

		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES
			(99501, 'M99501', 'Da Escala A', 'OIP', 'DEL A', 'h'),
			(99502, 'M99502', 'Da Escala B', 'OIP', 'DEL A', 'h');

		INSERT INTO gise_escalas (id, data_inicio, status) VALUES
			(${GISE_A}, '2026-10-01', 'em_preenchimento'),
			(${GISE_B}, '2026-10-02', 'em_preenchimento');

		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status) VALUES
			(${SEC_A}, ${GISE_A}, 99401, 'pendente'),
			(${SEC_B}, ${GISE_B}, 99401, 'pendente');

		INSERT INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip) VALUES
			(${EQ_A}, ${SEC_A}, 'operacional', 1, 1),
			(${EQ_B}, ${SEC_B}, 'operacional', 1, 1);

		INSERT INTO gise_membros (id, equipe_id, policial_id, gise_id) VALUES
			(${MEM_A}, ${EQ_A}, 99501, ${GISE_A}),
			(${MEM_B}, ${EQ_B}, 99502, ${GISE_B});
	`);
});

/** O `fail()` do SvelteKit devolve `{ status, data }`. */
const status = (r: { erro?: { status: number } }) => r.erro?.status;

describe('a equipe da GISE da URL', () => {
	it('resolve a própria', async () => {
		const r = await carregarEquipeDaGise(db, GISE_A, EQ_A);
		expect('erro' in r).toBe(false);
	});

	it('recusa a equipe da OUTRA escala com 404', async () => {
		const r = await carregarEquipeDaGise(db, GISE_A, EQ_B);
		expect(status(r)).toBe(404);
	});
});

describe('a seccional da GISE da URL', () => {
	it('resolve a própria', async () => {
		expect('erro' in (await carregarSeccionalDaGise(db, GISE_A, SEC_A))).toBe(false);
	});

	it('recusa a participação da OUTRA escala com 404', async () => {
		expect(status(await carregarSeccionalDaGise(db, GISE_A, SEC_B))).toBe(404);
	});
});

describe('o membro da GISE da URL', () => {
	it('resolve o próprio, com nome e seccional', async () => {
		const r = await carregarMembroDaGise(db, GISE_A, MEM_A);
		expect('erro' in r).toBe(false);
		if ('erro' in r) throw new Error('inalcançável');
		expect(r.membro.policial_nome).toBe('Da Escala A');
		expect(r.membro.gise_seccional_id).toBe(SEC_A);
	});

	it('recusa o membro da OUTRA escala com 404', async () => {
		// ESTE era o furo: o `WHERE` filtrava só por `giseMembros.id`, então o
		// membro da escala B era removido enquanto a invalidação caía na A.
		expect(status(await carregarMembroDaGise(db, GISE_A, MEM_B))).toBe(404);
	});

	it('recusa membro inexistente com 404, não 500', async () => {
		expect(status(await carregarMembroDaGise(db, GISE_A, 999999))).toBe(404);
	});
});

describe('GISE finalizada recusa antes de olhar o filho', () => {
	it('409, e a mensagem manda reabrir', async () => {
		sqlite.exec(`UPDATE gise_escalas SET status = 'finalizada' WHERE id = ${GISE_A}`);
		const r = await carregarMembroDaGise(db, GISE_A, MEM_A);
		expect(status(r)).toBe(409);
	});
});
