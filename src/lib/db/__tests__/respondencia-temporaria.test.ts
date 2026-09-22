/**
 * Respondência TEMPORÁRIA (E68), contra SQLite real — o que muda é sobretudo
 * SQL (o índice por caráter, a escolha de quem dirige hoje, a pendência ao
 * vivo), e um mock provaria só que a função chama o que chama.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import {
	encerrarTemporariaDoEvento,
	registrarRespondenciaTemporaria,
	responsavelVigente,
	responsaveisVigentesDe,
	titularesAusentesSemRespondencia
} from '../unidades-responsaveis';
import { sugestaoDeRespondencia } from '../policiais/designacoes';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const QUEM = { registrado_por_id: 1, registrado_por_nome: 'Admin Geral' };
const NUP = '00000.000000/2026-00';
/** O titular de Aurora, o delegado de Barro que o cobre, e um inspetor. */
const TITULAR = 96001;
const SUBSTITUTO = 96002;
const INSPETOR = 96003;
const AURORA = 96010;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES
			(96010, 'DP de Aurora', 'delegacia'),
			(96011, 'DP de Barro', 'delegacia');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES
			(96001, '96001', 'TITULAR DE AURORA', 'DPC', 'DP de Aurora', 'h'),
			(96002, '96002', 'DELEGADO DE BARRO', 'DPC', 'DP de Barro', 'h'),
			(96003, '96003', 'INSPETOR', 'OIP', 'DP de Aurora', 'h');
		INSERT INTO unidade_responsaveis (unidade_id, policial_id, papel, carater, data_inicio, nup, origem, registrado_por_id, registrado_por_nome)
			VALUES (96010, 96001, 'titular', 'permanente', '2026-01-01', '${NUP}', 'sistema', 1, 'Carga');
	`);
});

/** Um afastamento do titular; devolve o id do evento. */
function afastar(subtipo: string, inicio: string, fim: string | null): number {
	sqlite
		.prepare(
			`INSERT INTO policial_historico (policial_id, tipo, subtipo, data_inicio, data_fim, registrado_por_nome)
			 VALUES (?, 'afastamento', ?, ?, ?, 'Admin')`
		)
		.run(TITULAR, subtipo, inicio, fim);
	return (sqlite.prepare('SELECT max(id) AS id FROM policial_historico').get() as { id: number })
		.id;
}

const temporaria = (extra: Record<string, unknown> = {}) => ({
	unidade_id: AURORA,
	policial_id: SUBSTITUTO,
	substitui_policial_id: TITULAR,
	evento_id: null,
	data_inicio: '2026-10-01',
	data_fim: '2026-10-30',
	nup: NUP,
	...QUEM,
	...extra
});

describe('registrarRespondenciaTemporaria', () => {
	it('não encerra o titular: a unidade passa a ter duas direções abertas, uma de cada caráter', async () => {
		const r = await registrarRespondenciaTemporaria(db, temporaria());
		expect(r.ok).toBe(true);
		const linhas = sqlite
			.prepare('SELECT carater, policial_id, data_fim FROM unidade_responsaveis ORDER BY carater')
			.all() as { carater: string; policial_id: number; data_fim: string | null }[];
		expect(linhas).toEqual([
			{ carater: 'permanente', policial_id: TITULAR, data_fim: null },
			{ carater: 'temporaria', policial_id: SUBSTITUTO, data_fim: '2026-10-30' }
		]);
	});

	it('quem dirige hoje é a temporária DENTRO do período, e o titular fora dele', async () => {
		await registrarRespondenciaTemporaria(db, temporaria());
		expect(await responsavelVigente(db, AURORA, '2026-09-30')).toMatchObject({
			policial_id: TITULAR
		});
		expect(await responsavelVigente(db, AURORA, '2026-10-15')).toMatchObject({
			policial_id: SUBSTITUTO,
			carater: 'temporaria'
		});
		// O titular volta sozinho no dia seguinte ao fim — sem nenhuma escrita.
		expect(await responsavelVigente(db, AURORA, '2026-10-31')).toMatchObject({
			policial_id: TITULAR
		});
	});

	it('a lista de várias unidades também mostra quem responde hoje', async () => {
		await registrarRespondenciaTemporaria(db, temporaria());
		const mapa = await responsaveisVigentesDe(db, [AURORA, 96011], '2026-10-15');
		expect(mapa.get(AURORA)).toMatchObject({ policial_id: SUBSTITUTO, carater: 'temporaria' });
		expect(mapa.get(96011)).toBeUndefined();
	});

	it('recusa em vez de adivinhar', async () => {
		expect(await registrarRespondenciaTemporaria(db, temporaria({ nup: '  ' }))).toEqual({
			ok: false,
			motivo: 'sem_nup'
		});
		expect(
			await registrarRespondenciaTemporaria(db, temporaria({ policial_id: INSPETOR }))
		).toEqual({ ok: false, motivo: 'nao_e_delegado' });
		expect(
			await registrarRespondenciaTemporaria(db, temporaria({ data_fim: '2026-09-01' }))
		).toEqual({ ok: false, motivo: 'periodo_invertido' });
		expect(await registrarRespondenciaTemporaria(db, temporaria({ policial_id: TITULAR }))).toEqual(
			{ ok: false, motivo: 'responde_a_si_mesmo' }
		);
		// Quem ela diz cobrir não é o titular da unidade.
		expect(
			await registrarRespondenciaTemporaria(db, temporaria({ substitui_policial_id: INSPETOR }))
		).toEqual({ ok: false, motivo: 'nao_substitui_o_titular' });
	});

	it('recusa a segunda cobertura que encosta na primeira', async () => {
		await registrarRespondenciaTemporaria(db, temporaria());
		expect(
			await registrarRespondenciaTemporaria(
				db,
				temporaria({ data_inicio: '2026-10-30', data_fim: '2026-11-10' })
			)
		).toEqual({ ok: false, motivo: 'ja_ha_temporaria' });
		// Depois do fim da primeira, passa.
		expect(
			await registrarRespondenciaTemporaria(
				db,
				temporaria({ data_inicio: '2026-10-31', data_fim: '2026-11-10' })
			)
		).toMatchObject({ ok: true });
	});
});

describe('encerrarTemporariaDoEvento', () => {
	it('o titular voltou antes: a cobertura encurta junto', async () => {
		const evento = afastar('ferias', '2026-10-01', '2026-10-30');
		await registrarRespondenciaTemporaria(db, temporaria({ evento_id: evento }));
		expect(await encerrarTemporariaDoEvento(db, evento, '2026-10-10')).toBe(1);
		expect(await responsavelVigente(db, AURORA, '2026-10-15')).toMatchObject({
			policial_id: TITULAR
		});
	});

	it('retorno no próprio dia do início não produz período negativo', async () => {
		const evento = afastar('ferias', '2026-10-01', '2026-10-30');
		await registrarRespondenciaTemporaria(db, temporaria({ evento_id: evento }));
		await encerrarTemporariaDoEvento(db, evento, '2026-09-20');
		const linha = sqlite
			.prepare(
				`SELECT data_inicio, data_fim FROM unidade_responsaveis WHERE carater = 'temporaria'`
			)
			.get() as { data_inicio: string; data_fim: string };
		expect(linha.data_fim).toBe(linha.data_inicio);
	});
});

describe('titularesAusentesSemRespondencia', () => {
	it('férias avisam cinco dias antes; antes disso, não', async () => {
		afastar('ferias', '2026-10-01', '2026-10-30');
		expect(await titularesAusentesSemRespondencia(db, '2026-09-25')).toEqual([]);
		const em26 = await titularesAusentesSemRespondencia(db, '2026-09-26');
		expect(em26).toHaveLength(1);
		expect(em26[0]).toMatchObject({
			unidade_id: AURORA,
			unidade_nome: 'DP de Aurora',
			titular_nome: 'TITULAR DE AURORA',
			subtipo: 'ferias',
			data_inicio: '2026-10-01'
		});
	});

	it('afastamento avisa desde o registro — não há como prevê-lo', async () => {
		afastar('licenca_saude', '2026-10-01', null);
		// Cinco dias antes NÃO aparece (a antecedência é só das férias)...
		expect(await titularesAusentesSemRespondencia(db, '2026-09-28')).toEqual([]);
		// ...e no primeiro dia, sim.
		expect(await titularesAusentesSemRespondencia(db, '2026-10-01')).toHaveLength(1);
	});

	it('some sozinha quando a respondência é registrada', async () => {
		const evento = afastar('ferias', '2026-10-01', '2026-10-30');
		expect(await titularesAusentesSemRespondencia(db, '2026-09-28')).toHaveLength(1);
		await registrarRespondenciaTemporaria(db, temporaria({ evento_id: evento }));
		expect(await titularesAusentesSemRespondencia(db, '2026-09-28')).toEqual([]);
	});

	it('afastamento já terminado não é pendência', async () => {
		afastar('ferias', '2026-08-01', '2026-08-30');
		expect(await titularesAusentesSemRespondencia(db, '2026-09-28')).toEqual([]);
	});
});

describe('sugestaoDeRespondencia', () => {
	it('sugere o Delegado Adjunto da unidade, e na falta dele o Auxiliar', async () => {
		const idAdjunto = (
			sqlite.prepare(`SELECT id FROM designacoes WHERE nome = 'Delegado Adjunto'`).get() as {
				id: number;
			}
		).id;
		const idAuxiliar = (
			sqlite.prepare(`SELECT id FROM designacoes WHERE nome = 'Delegado Auxiliar'`).get() as {
				id: number;
			}
		).id;
		sqlite
			.prepare(
				`INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, designacao_id)
				 VALUES (96004, '96004', 'AUXILIAR DE AURORA', 'DPC', 'DP de Aurora', 'h', ?)`
			)
			.run(idAuxiliar);
		expect(await sugestaoDeRespondencia(db, 'DP de Aurora', TITULAR)).toMatchObject({
			policial_id: 96004
		});
		sqlite
			.prepare(
				`INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, designacao_id)
				 VALUES (96005, '96005', 'ADJUNTO DE AURORA', 'DPC', 'DP de Aurora', 'h', ?)`
			)
			.run(idAdjunto);
		// Com os dois, o adjunto vem primeiro — é a ordem da casa.
		expect(await sugestaoDeRespondencia(db, 'DP de Aurora', TITULAR)).toMatchObject({
			policial_id: 96005
		});
	});

	it('sem adjunto nem auxiliar não sugere ninguém — a indicação é da seccional', async () => {
		expect(await sugestaoDeRespondencia(db, 'DP de Aurora', TITULAR)).toBeNull();
	});
});
