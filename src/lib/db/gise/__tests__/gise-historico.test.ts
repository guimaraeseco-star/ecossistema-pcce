/**
 * `temGiseHistorico` — o predicado que libera a aba "Histórico GISE".
 *
 * A régua tem de ser a MESMA que a lista de `/operacoes/presenca` usa para separar ativas
 * de finalizadas (`isFinished`): o policial tem histórico quando já bateu a
 * SAÍDA (mesmo com a GISE aberta para os demais) ou quando a GISE inteira foi
 * finalizada. Participação ainda em curso, sem saída, NÃO é histórico — senão a
 * aba apareceria vazia para quem acabou de ser escalado.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { temGiseHistorico } from '../escalas-papel';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const UNID = 93101;
/** policiais usados nos cenários. */
const P_SEM_NADA = 93201;
const P_MEMBRO_ATIVA = 93202;
const P_MEMBRO_FINALIZADA = 93203;
const P_SAIDA_ATIVA = 93204;
const P_SEINT_FINALIZADA = 93205;
const P_SUPERVISOR_ATIVA = 93206;

const GISE_ATIVA = 93001;
const GISE_FINALIZADA = 93002;

function semear() {
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (${UNID}, 'SECCIONAL H', 'seccional');

		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES
			(${P_SEM_NADA}, 'M93201', 'Sem Nada', 'OIP', 'SECCIONAL H', 'h'),
			(${P_MEMBRO_ATIVA}, 'M93202', 'Membro Ativa', 'OIP', 'SECCIONAL H', 'h'),
			(${P_MEMBRO_FINALIZADA}, 'M93203', 'Membro Final', 'OIP', 'SECCIONAL H', 'h'),
			(${P_SAIDA_ATIVA}, 'M93204', 'Saiu Ativa', 'OIP', 'SECCIONAL H', 'h'),
			(${P_SEINT_FINALIZADA}, 'M93205', 'Seint Final', 'OIP', 'SECCIONAL H', 'h'),
			(${P_SUPERVISOR_ATIVA}, 'M93206', 'Super Ativa', 'DPC', 'SECCIONAL H', 'h');

		INSERT INTO gise_escalas (id, data_inicio, status, supervisor_id, seint1_id) VALUES
			(${GISE_ATIVA}, '2026-08-10', 'em_andamento', ${P_SUPERVISOR_ATIVA}, NULL),
			(${GISE_FINALIZADA}, '2026-07-01', 'finalizada', NULL, ${P_SEINT_FINALIZADA});

		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status) VALUES
			(93301, ${GISE_ATIVA}, ${UNID}, 'preenchida'),
			(93302, ${GISE_FINALIZADA}, ${UNID}, 'preenchida');

		INSERT INTO gise_equipes (id, gise_seccional_id, tipo) VALUES
			(93401, 93301, 'operacional'),
			(93402, 93302, 'operacional');

		INSERT INTO gise_membros (equipe_id, policial_id) VALUES
			(93401, ${P_MEMBRO_ATIVA}),
			(93401, ${P_SAIDA_ATIVA}),
			(93402, ${P_MEMBRO_FINALIZADA});

		-- Só o P_SAIDA_ATIVA bateu a saída (na GISE que segue ativa).
		INSERT INTO gise_presencas (gise_id, policial_id, entrada_timestamp, saida_timestamp) VALUES
			(${GISE_ATIVA}, ${P_MEMBRO_ATIVA}, '2026-08-10 08:00:00', NULL),
			(${GISE_ATIVA}, ${P_SAIDA_ATIVA}, '2026-08-10 08:00:00', '2026-08-10 16:00:00');
	`);
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	semear();
});

describe('temGiseHistorico', () => {
	it('policial que nunca participou não tem histórico', async () => {
		expect(await temGiseHistorico(db, P_SEM_NADA)).toBe(false);
	});

	it('membro de GISE ativa, sem saída, ainda NÃO é histórico', async () => {
		expect(await temGiseHistorico(db, P_MEMBRO_ATIVA)).toBe(false);
	});

	it('membro de GISE finalizada é histórico', async () => {
		expect(await temGiseHistorico(db, P_MEMBRO_FINALIZADA)).toBe(true);
	});

	it('quem bateu a saída é histórico, mesmo com a GISE ainda ativa', async () => {
		expect(await temGiseHistorico(db, P_SAIDA_ATIVA)).toBe(true);
	});

	it('SEINT do quadro de uma GISE finalizada é histórico', async () => {
		expect(await temGiseHistorico(db, P_SEINT_FINALIZADA)).toBe(true);
	});

	it('supervisor de GISE ativa, sem saída, ainda NÃO é histórico', async () => {
		expect(await temGiseHistorico(db, P_SUPERVISOR_ATIVA)).toBe(false);
	});
});
