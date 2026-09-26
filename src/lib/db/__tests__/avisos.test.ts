/**
 * Avisos (E59): a caixa certa recebe, a errada não vê, e "lido" é da linha.
 * Contra SQLite real com as migrações, porque o que se testa é o filtro do
 * destinatário, o UPDATE condicionado e — desde a E51 — o gatilho da `0103`.
 *
 * Desde a E51 a caixa filtra pelo ID da unidade, e o nome fica ao lado só para
 * exibir. O caso que motivou a troca está aqui em "renomear a unidade": pelo
 * nome, todo aviso recebido antes da renomeação sumia da caixa da própria
 * unidade, sem erro nenhum.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { contarNaoLidos, criarAvisos, listarAvisos, marcarLidos } from '../avisos';
import { atualizarUnidade } from '../unidades';

let sqlite: DatabaseSync;
let db: Database;
const QUEM = { id: 7, nome: 'Titular de Tauá' };
const TAUA = 'Delegacia de Polícia Civil de Tauá';
const AURORA = 'Delegacia de Polícia Civil de Aurora';
const ID_TAUA = 96100;
const ID_AURORA = 96200;

/** A caixa de quem administra estas unidades. */
const caixa = (...unidades: number[]) => ({ adminGeral: false, unidades });

beforeEach(async () => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo, cidade) VALUES
			(${ID_TAUA}, '${TAUA}', 'delegacia', 'TAUÁ'),
			(${ID_AURORA}, '${AURORA}', 'delegacia', 'AURORA');
	`);
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

/** O par gravado na linha, para conferir os dois lados. */
const destinoDe = (tipo: string) =>
	sqlite
		.prepare(
			'SELECT destinatario_lotacao AS nome, destinatario_unidade_id AS id FROM avisos WHERE tipo = ?'
		)
		.get(tipo) as { nome: string | null; id: number | null };

describe('caixa e destinatário', () => {
	it('a unidade vê só a sua lotação; a seccional vê as suas; o Admin Geral vê a caixa dele', async () => {
		const taua = await listarAvisos(db, caixa(ID_TAUA));
		expect(taua.map((a) => a.tipo)).toEqual(['rh_movimentacao']);

		const seccional = await listarAvisos(db, caixa(ID_TAUA, ID_AURORA));
		expect(seccional.map((a) => a.tipo).sort()).toEqual(['direcao_registrada', 'rh_movimentacao']);

		const admin = await listarAvisos(db, { adminGeral: true, unidades: [] });
		expect(admin.map((a) => a.tipo)).toEqual(['ferias_programada']);
	});

	it('quem não administra nada não vê nada', async () => {
		expect(await listarAvisos(db, caixa())).toEqual([]);
		expect((await contarNaoLidos(db, caixa())).size).toBe(0);
	});

	it('conta as não lidas por cartão', async () => {
		const n = await contarNaoLidos(db, caixa(ID_TAUA, ID_AURORA));
		expect(n.get('servidores')).toBe(1);
		expect(n.get('unidade')).toBe(1);
	});
});

describe('o par nome + id (E51)', () => {
	it('criarAvisos grava o nome E o id da unidade', () => {
		expect(destinoDe('rh_movimentacao')).toEqual({ nome: TAUA, id: ID_TAUA });
		expect(destinoDe('direcao_registrada')).toEqual({ nome: AURORA, id: ID_AURORA });
	});

	it('renomear a unidade NÃO some com os avisos que ela já recebeu', async () => {
		// O caso que motivou a troca. A renomeação reescreve o nome nas fichas de
		// servidores e escalas, mas não nos avisos — e não deve: o aviso é registro
		// do que se disse, com o nome da época. Pelo nome, a caixa de Tauá ficava
		// vazia a partir daqui.
		await atualizarUnidade(db, ID_TAUA, {
			nome: 'DELEGACIA REGIONAL DE TAUÁ',
			tipo: 'delegacia',
			seccional_id: null,
			tem_plantao: true,
			tem_expediente: false,
			tem_fds: false,
			cidade: 'TAUÁ',
			sigla: ''
		});

		const depois = await listarAvisos(db, caixa(ID_TAUA));
		expect(depois.map((a) => a.tipo)).toEqual(['rh_movimentacao']);
		// E o registro guarda o nome que tinha quando foi enviado.
		expect(destinoDe('rh_movimentacao').nome).toBe(TAUA);
	});

	it('destino que nunca foi unidade fica sem id, e sem id não entra em caixa nenhuma', async () => {
		await criarAvisos(db, [
			{
				destinatario: { tipo: 'lotacao', lotacao: 'Aposentadoria' },
				cartao: 'servidores',
				tipo: 'destino_estranho',
				titulo: 'Destino que nunca foi unidade',
				autor: null
			}
		]);
		expect(destinoDe('destino_estranho')).toEqual({ nome: 'Aposentadoria', id: null });
		const tudo = await listarAvisos(db, caixa(ID_TAUA, ID_AURORA));
		expect(tudo.map((a) => a.tipo)).not.toContain('destino_estranho');
	});

	it('no Admin Geral, assunto que nunca foi unidade NÃO vira "aviso sem assunto"', async () => {
		// O "sem assunto" (visível a todo Admin Geral) é decidido pelo TEXTO nulo.
		// Se fosse pelo id nulo, este aviso passaria a aparecer para todos.
		await criarAvisos(db, [
			{
				destinatario: { tipo: 'admin_geral', lotacao: 'Aposentadoria' },
				cartao: 'servidores',
				tipo: 'assunto_estranho',
				titulo: 'Assunto que nunca foi unidade',
				autor: null
			}
		]);
		const doNo = await listarAvisos(db, { adminGeral: true, unidades: [ID_TAUA] });
		expect(doNo.map((a) => a.tipo)).toContain('ferias_programada'); // sem assunto: vê
		expect(doNo.map((a) => a.tipo)).not.toContain('assunto_estranho');
	});
});

describe('o gatilho da 0103 (a janela do deploy)', () => {
	it('aviso gravado SÓ com o nome, como o código antigo fazia, recebe o id no próprio banco', async () => {
		// É o que acontece no minuto entre a migração e o código novo entrar no
		// ar: o código antigo grava sem o id. Sem o gatilho, esse aviso ficaria
		// invisível para sempre na caixa que filtra por id.
		sqlite.exec(`
			INSERT INTO avisos (destinatario_tipo, destinatario_lotacao, cartao, tipo, titulo)
			VALUES ('lotacao', '${AURORA}', 'unidade', 'gravado_pelo_codigo_antigo', 'Sem id');
		`);
		expect(destinoDe('gravado_pelo_codigo_antigo')).toEqual({ nome: AURORA, id: ID_AURORA });
		const aurora = await listarAvisos(db, caixa(ID_AURORA));
		expect(aurora.map((a) => a.tipo)).toContain('gravado_pelo_codigo_antigo');
	});

	it('o gatilho não mexe no id que o código já gravou', async () => {
		// Grava de propósito um id que NÃO é o do nome: se o gatilho sobrescrevesse,
		// o id viraria o de Aurora.
		sqlite.exec(`
			INSERT INTO avisos (destinatario_tipo, destinatario_lotacao, destinatario_unidade_id, cartao, tipo, titulo)
			VALUES ('lotacao', '${AURORA}', ${ID_TAUA}, 'unidade', 'id_ja_gravado', 'Com id');
		`);
		expect(destinoDe('id_ja_gravado').id).toBe(ID_TAUA);
	});
});

describe('lido', () => {
	it('marcar por id só alcança a própria caixa; marcar todas limpa o resto', async () => {
		const [deAurora] = await listarAvisos(db, caixa(ID_AURORA));
		// Tauá tenta marcar o aviso de Aurora: não muda nada.
		expect(await marcarLidos(db, caixa(ID_TAUA), QUEM, '2026-09-20', [deAurora.id])).toBe(0);

		expect(await marcarLidos(db, caixa(ID_TAUA), QUEM, '2026-09-20')).toBe(1);
		const [lido] = await listarAvisos(db, caixa(ID_TAUA));
		expect(lido.lido_em).toBe('2026-09-20');
		expect(lido.lido_por_nome).toBe(QUEM.nome);
		// A segunda vez não conta de novo.
		expect(await marcarLidos(db, caixa(ID_TAUA), QUEM, '2026-09-21')).toBe(0);
	});
});
