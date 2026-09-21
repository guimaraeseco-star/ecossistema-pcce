/**
 * O relatório diário dos colaboradores (E61-b) contra SQLite real: as ações
 * do dia saem da auditoria agrupadas pela unidade do colaborador, o e-mail
 * vai ao admin da unidade com e-mail pessoal, e a reexecução não repete.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { auditar } from '$lib/db/audit';
import { acoesDeColaboradoresNoDia, contarRelatoriosDoDia } from '$lib/db/colaboradores-relatorio';
import { enviarRelatoriosDoDia } from '../relatorio-diario';

const enviar = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/email', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/email')>();
	return { ...actual, enviarRelatorioColaboradores: (...a: unknown[]) => enviar(...a) };
});

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;
const DIA = '2026-09-21';

beforeEach(async () => {
	enviar.mockClear();
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (97010, 'DP de Aurora', 'delegacia'), (97011, 'DP de Barro', 'delegacia');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, papel, papel_unidade_id, email_pessoal) VALUES
			(97001, '97001', 'GUARDIÃO DE AURORA', 'DPC', 'DP de Aurora', 'h', 'admin_unidade', 97010, 'guardiao@x.br'),
			(97002, '97002', 'SEM E-MAIL', 'DPC', 'DP de Barro', 'h', 'admin_unidade', 97011, NULL),
			(97003, '97003', 'SERVIDOR', 'OIP', 'DP de Aurora', 'h', NULL, NULL, NULL);
		INSERT INTO colaboradores (id, nome, cpf, email_pessoal, senha, unidade_id) VALUES
			(7, 'ANA', '52998224725', 'a@x.br', 'h', 97010),
			(8, 'BIA', '11144477735', 'b@x.br', 'h', 97011);
	`);
	// Duas ações da Ana, uma da Bia, todas no dia (UTC 15:00 = 12:00 em Brasília).
	const colab = (id: number, nome: string) => ({ id, nome, tipo: 'colaborador' as const });
	await auditar(db, {
		acao: 'solicitar_acao_policial',
		usuario: colab(7, 'ANA'),
		entidade: 'policial',
		entidade_id: 97003,
		alvo_nome: 'SERVIDOR',
		detalhes: 'Pedido de afastamento'
	});
	await auditar(db, {
		acao: 'ferias_registrar_programacao',
		usuario: colab(7, 'ANA'),
		entidade: 'policial',
		entidade_id: 97003,
		alvo_nome: 'SERVIDOR'
	});
	await auditar(db, {
		acao: 'solicitar_acao_policial',
		usuario: colab(8, 'BIA'),
		entidade: 'policial',
		entidade_id: 97003
	});
	sqlite.exec(
		`UPDATE audit_log SET created_at = '${DIA} 15:00:00' WHERE actor_tipo = 'colaborador'`
	);
});

describe('acoesDeColaboradoresNoDia', () => {
	it('agrupa pela unidade do colaborador, traduz a ação e converte a hora para Brasília', async () => {
		const r = await acoesDeColaboradoresNoDia(db, DIA);
		expect(r.map((u) => [u.unidade, u.acoes.length])).toEqual([
			['DP de Aurora', 2],
			['DP de Barro', 1]
		]);
		expect(r[0].acoes[0]).toMatchObject({
			colaborador: 'ANA',
			hora: '12:00',
			alvo: 'SERVIDOR',
			detalhes: 'Pedido de afastamento'
		});
		expect(r[0].acoes[0].acao).not.toBe('solicitar_acao_policial'); // rótulo do catálogo
		// Outro dia: nada. O dia de Brasília começa às 03:00 UTC.
		expect(await acoesDeColaboradoresNoDia(db, '2026-09-22')).toEqual([]);
		sqlite.exec(`UPDATE audit_log SET created_at = '2026-09-22 02:30:00' WHERE usuario_id = 8`);
		expect((await acoesDeColaboradoresNoDia(db, DIA)).map((u) => u.unidade)).toEqual([
			'DP de Aurora',
			'DP de Barro'
		]);
	});
});

describe('enviarRelatoriosDoDia', () => {
	it('manda ao admin com e-mail pessoal, pula a unidade sem destinatário e não repete', async () => {
		const r1 = await enviarRelatoriosDoDia(db, undefined, DIA);
		expect(r1.unidadesComAcao).toBe(2);
		expect(r1.enviados).toEqual([{ unidade: 'DP de Aurora', destinatarios: 1, acoes: 2 }]);
		expect(r1.semDestinatario).toEqual(['DP de Barro']);
		expect(enviar).toHaveBeenCalledTimes(1);
		expect(enviar.mock.calls[0].slice(0, 4)).toEqual([
			'guardiao@x.br',
			'GUARDIÃO DE AURORA',
			'DP de Aurora',
			DIA
		]);
		expect(await contarRelatoriosDoDia(db, DIA)).toBe(1);
		const trilha = sqlite
			.prepare("SELECT COUNT(*) n FROM audit_log WHERE acao = 'relatorio_colaboradores'")
			.get() as { n: number };
		expect(trilha.n).toBe(1);

		// Reexecução: Aurora já saiu; Barro continua sem destinatário.
		const r2 = await enviarRelatoriosDoDia(db, undefined, DIA);
		expect(r2.enviados).toEqual([]);
		expect(r2.jaEnviados).toEqual(['DP de Aurora']);
		expect(enviar).toHaveBeenCalledTimes(1);
	});

	it('dia sem ação: nada enviado, nada reservado', async () => {
		const r = await enviarRelatoriosDoDia(db, undefined, '2026-01-01');
		expect(r.unidadesComAcao).toBe(0);
		expect(enviar).not.toHaveBeenCalled();
		expect(await contarRelatoriosDoDia(db, '2026-01-01')).toBe(0);
	});
});
