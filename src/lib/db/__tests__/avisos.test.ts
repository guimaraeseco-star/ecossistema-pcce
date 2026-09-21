/**
 * Avisos (E59): a caixa certa recebe, a errada não vê, e "lido" é da linha.
 * Contra SQLite real com as migrações, porque o que se testa é o filtro do
 * destinatário e o UPDATE condicionado.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { contarNaoLidos, criarAvisos, listarAvisos, marcarLidos } from '../avisos';

let db: Database;
const QUEM = { id: 7, nome: 'Titular de Tauá' };
const TAUA = 'Delegacia de Polícia Civil de Tauá';
const AURORA = 'Delegacia de Polícia Civil de Aurora';

beforeEach(async () => {
	db = drizzleSobre(bancoMigrado());
	await criarAvisos(db, [
		{
			destinatario: { tipo: 'lotacao', lotacao: TAUA },
			cartao: 'servidores',
			tipo: 'rh_movimentacao',
			titulo: 'Movimentação de X registrada pelo DPI SUL',
			link: '/servidores/1',
			autor: { id: 1, nome: 'Admin Geral' }
		},
		{
			destinatario: { tipo: 'lotacao', lotacao: AURORA },
			cartao: 'unidade',
			tipo: 'direcao_registrada',
			titulo: 'Titular de Aurora registrado',
			autor: { id: 1, nome: 'Admin Geral' }
		},
		{
			destinatario: { tipo: 'admin_geral' },
			cartao: 'servidores',
			tipo: 'ferias_programada',
			titulo: 'Férias de Y programadas',
			autor: QUEM
		}
	]);
});

describe('caixa e destinatário', () => {
	it('a unidade vê só a sua lotação; a seccional vê as suas; o Admin Geral vê a caixa dele', async () => {
		const taua = await listarAvisos(db, { adminGeral: false, lotacoes: [TAUA] });
		expect(taua.map((a) => a.tipo)).toEqual(['rh_movimentacao']);

		const seccional = await listarAvisos(db, { adminGeral: false, lotacoes: [TAUA, AURORA] });
		expect(seccional.map((a) => a.tipo).sort()).toEqual(['direcao_registrada', 'rh_movimentacao']);

		const admin = await listarAvisos(db, { adminGeral: true, lotacoes: [] });
		expect(admin.map((a) => a.tipo)).toEqual(['ferias_programada']);
	});

	it('quem não administra nada não vê nada', async () => {
		expect(await listarAvisos(db, { adminGeral: false, lotacoes: [] })).toEqual([]);
		expect((await contarNaoLidos(db, { adminGeral: false, lotacoes: [] })).size).toBe(0);
	});

	it('conta as não lidas por cartão', async () => {
		const n = await contarNaoLidos(db, { adminGeral: false, lotacoes: [TAUA, AURORA] });
		expect(n.get('servidores')).toBe(1);
		expect(n.get('unidade')).toBe(1);
	});
});

describe('lido', () => {
	it('marcar por id só alcança a própria caixa; marcar todas limpa o resto', async () => {
		const [deAurora] = await listarAvisos(db, { adminGeral: false, lotacoes: [AURORA] });
		// Tauá tenta marcar o aviso de Aurora: não muda nada.
		expect(
			await marcarLidos(db, { adminGeral: false, lotacoes: [TAUA] }, QUEM, '2026-09-20', [
				deAurora.id
			])
		).toBe(0);

		expect(await marcarLidos(db, { adminGeral: false, lotacoes: [TAUA] }, QUEM, '2026-09-20')).toBe(
			1
		);
		const [lido] = await listarAvisos(db, { adminGeral: false, lotacoes: [TAUA] });
		expect(lido.lido_em).toBe('2026-09-20');
		expect(lido.lido_por_nome).toBe(QUEM.nome);
		// A segunda vez não conta de novo.
		expect(await marcarLidos(db, { adminGeral: false, lotacoes: [TAUA] }, QUEM, '2026-09-21')).toBe(
			0
		);
	});
});
