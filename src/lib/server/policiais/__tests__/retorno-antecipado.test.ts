/**
 * O retorno antecipado segue o rito dos outros atos (decisão de 20/09): a
 * unidade PEDE, o Admin Geral decide. Aprovado, o afastamento que o pedido
 * aponta (servidor, subtipo, 1º dia) encurta até a véspera; rejeitado, nada
 * muda. Contra SQLite real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { criarSolicitacaoAcao } from '$lib/db/policiais/acao-solicitacoes';
import { registrarHistorico } from '$lib/db/policiais/historico';
import { decidirSolicitacaoAcao } from '../solicitacoes';

const POL = 96101;
let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(async () => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha)
		VALUES (${POL}, '96101', 'SERVIDOR QUE VOLTOU', 'OIP', 'DP de Aurora', 'h');
	`);
	await registrarHistorico(db, {
		policial_id: POL,
		tipo: 'afastamento',
		subtipo: 'lts',
		data_inicio: '2026-09-15',
		data_fim: '2026-09-29',
		qtd_dias: 15
	});
});

const lts = () =>
	sqlite
		.prepare(
			`SELECT data_fim, qtd_dias, descricao FROM policial_historico WHERE policial_id = ${POL}`
		)
		.get() as { data_fim: string; qtd_dias: number; descricao: string | null };

async function pedir() {
	return criarSolicitacaoAcao(db, {
		policial_id: POL,
		tipo: 'retorno_antecipado',
		subtipo: 'lts',
		data_inicio: '2026-09-15',
		data_fim: '2026-09-29',
		data_evento: '2026-09-22',
		nup: '10051.028034/2026-64',
		justificativa: '',
		solicitante_id: 1,
		solicitante_nome: 'Titular'
	});
}

describe('retorno antecipado como pedido', () => {
	it('aprovado: o afastamento encurta até a véspera, com o NUP', async () => {
		const id = await pedir();
		const r = await decidirSolicitacaoAcao(db, id!, true, 2);
		expect(r?.status).toBe('aprovada');
		expect(lts()).toEqual({
			data_fim: '2026-09-21',
			qtd_dias: 7,
			descricao: 'Retorno antecipado em 2026-09-22 (NUP 10051.028034/2026-64)'
		});
	});

	it('rejeitado: nada muda', async () => {
		const id = await pedir();
		await decidirSolicitacaoAcao(db, id!, false, 2);
		expect(lts()).toMatchObject({ data_fim: '2026-09-29', qtd_dias: 15 });
	});
});
