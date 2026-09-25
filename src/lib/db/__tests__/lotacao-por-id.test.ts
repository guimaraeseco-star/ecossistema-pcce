/**
 * A ligação servidor/escala → unidade por ID (E51), contra SQLite real.
 *
 * O que este arquivo trava é o ganho concreto da decisão: **renomear uma
 * unidade não pode quebrar nada**. Antes, o vínculo era o NOME
 * (`policiais.lotacao` = `unidades.nome`), e a renomeação obrigava a reescrever
 * o nome antigo em cinco tabelas; a linha que escapasse ficava órfã em
 * silêncio — o servidor sumia do escopo do administrador, a escala perdia a
 * lotação, e ninguém via até montarem a próxima escala.
 *
 * O texto continua gravado ao lado do id, como cache de exibição. Por isso os
 * testes conferem os DOIS: o id é o vínculo, o nome é o que a tela mostra.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { atualizarUnidade, idDaUnidadePeloNome } from '../unidades';
import { criarPolicial, listarPoliciais, upsertPolicial } from '../policiais/cadastro';
import { criarEscala } from '../escalas';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const UNID = 95500;
const OUTRA = 95501;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo, cidade) VALUES
			(${UNID}, 'DELEGACIA DE ANTES', 'delegacia', 'CIDADE X'),
			(${OUTRA}, 'DELEGACIA VIZINHA', 'delegacia', 'CIDADE Y');
	`);
});

const dadosDaUnidade = (nome: string) => ({
	nome,
	tipo: 'delegacia' as const,
	seccional_id: null,
	tem_plantao: true,
	tem_expediente: false,
	tem_fds: false,
	cidade: 'CIDADE X',
	sigla: ''
});

const lerPolicial = (matricula: string) =>
	sqlite
		.prepare('SELECT lotacao, unidade_id FROM policiais WHERE matricula = ?')
		.get(matricula) as { lotacao: string; unidade_id: number | null };

describe('a escrita guarda o par nome + id', () => {
	it('criarPolicial resolve o id a partir do nome', async () => {
		await criarPolicial(db, {
			nome: 'FULANO',
			matricula: '95001',
			cargo: 'OIP',
			lotacao: 'DELEGACIA DE ANTES'
		} as Parameters<typeof criarPolicial>[1]);
		expect(lerPolicial('95001')).toEqual({ lotacao: 'DELEGACIA DE ANTES', unidade_id: UNID });
	});

	it('a carga da planilha (upsert) também — senão a primeira sincronização apagaria o id de todos', async () => {
		const folha = {
			nome: 'BELTRANO',
			matricula: '95002',
			cargo: 'OIP',
			lotacao: 'DELEGACIA DE ANTES'
		} as Parameters<typeof upsertPolicial>[1];
		await upsertPolicial(db, folha);
		expect(lerPolicial('95002').unidade_id).toBe(UNID);
		// A rodada seguinte manda a mesma folha com a lotação trocada.
		await upsertPolicial(db, { ...folha, lotacao: 'DELEGACIA VIZINHA' });
		expect(lerPolicial('95002')).toEqual({ lotacao: 'DELEGACIA VIZINHA', unidade_id: OUTRA });
	});

	it('nome que não existe no cadastro fica sem id, e isso é resposta — não falha', async () => {
		await criarPolicial(db, {
			nome: 'CICRANO',
			matricula: '95003',
			cargo: 'OIP',
			lotacao: 'DRPC DE OUTRO DEPARTAMENTO'
		} as Parameters<typeof criarPolicial>[1]);
		expect(lerPolicial('95003')).toEqual({
			lotacao: 'DRPC DE OUTRO DEPARTAMENTO',
			unidade_id: null
		});
	});

	it('idDaUnidadePeloNome ignora espaço sobrando e devolve null para vazio', async () => {
		expect(await idDaUnidadePeloNome(db, '  DELEGACIA DE ANTES  ')).toBe(UNID);
		expect(await idDaUnidadePeloNome(db, '')).toBeNull();
		expect(await idDaUnidadePeloNome(db, null)).toBeNull();
	});
});

describe('renomear a unidade não quebra o vínculo (o ganho da E51)', () => {
	it('o servidor continua no escopo, e o nome exibido acompanha', async () => {
		await criarPolicial(db, {
			nome: 'FULANO',
			matricula: '95010',
			cargo: 'OIP',
			lotacao: 'DELEGACIA DE ANTES'
		} as Parameters<typeof criarPolicial>[1]);

		await atualizarUnidade(db, UNID, dadosDaUnidade('DELEGACIA DE DEPOIS'));

		// O vínculo é o id: não mudou. O texto acompanhou, para a tela não
		// mostrar o nome velho.
		expect(lerPolicial('95010')).toEqual({ lotacao: 'DELEGACIA DE DEPOIS', unidade_id: UNID });

		// E o recorte por escopo continua achando o servidor — era isto que
		// quebrava quando a comparação era por nome.
		const r = await listarPoliciais(db, undefined, false, { escopoUnidades: [UNID] });
		expect(r.policiais.map((p) => p.matricula)).toEqual(['95010']);
	});

	it('a escala continua ligada à unidade renomeada', async () => {
		await criarEscala(db, {
			titulo: 'ESCALA',
			tipo: 'plantao',
			lotacao: 'DELEGACIA DE ANTES',
			cidade: 'CIDADE X',
			data_inicio: '2026-10-01',
			data_fim: '2026-10-31',
			horario: '07h/19h',
			hora_entrada: '07:00',
			hora_saida: '19:00'
		} as Parameters<typeof criarEscala>[1]);

		await atualizarUnidade(db, UNID, dadosDaUnidade('DELEGACIA DE DEPOIS'));

		const escala = sqlite.prepare('SELECT lotacao, unidade_id FROM escalas').get() as {
			lotacao: string;
			unidade_id: number | null;
		};
		expect(escala).toEqual({ lotacao: 'DELEGACIA DE DEPOIS', unidade_id: UNID });
	});

	it('a unidade vizinha não é tocada pela renomeação', async () => {
		await criarPolicial(db, {
			nome: 'VIZINHO',
			matricula: '95020',
			cargo: 'OIP',
			lotacao: 'DELEGACIA VIZINHA'
		} as Parameters<typeof criarPolicial>[1]);

		await atualizarUnidade(db, UNID, dadosDaUnidade('DELEGACIA DE DEPOIS'));

		expect(lerPolicial('95020')).toEqual({ lotacao: 'DELEGACIA VIZINHA', unidade_id: OUTRA });
	});
});
