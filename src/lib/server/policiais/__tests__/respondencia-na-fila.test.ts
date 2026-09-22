/**
 * A indicação de respondência temporária (E68) pela unidade ou pela seccional
 * passa pela MESMA fila dos outros atos, com subtipo próprio: aprovada, vira a
 * cobertura; rejeitada, não vira nada. Contra SQLite real, porque o que se
 * prova aqui é o reencontro do titular e do evento a partir do que a fila
 * guarda — a dívida da E51 é justamente essa indireção por nome e por data.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { criarSolicitacaoAcao } from '$lib/db/policiais/acao-solicitacoes';
import { registrarHistorico } from '$lib/db/policiais/historico';
import { responsavelVigente } from '$lib/db/unidades-responsaveis';
import { decidirSolicitacaoAcao } from '../solicitacoes';

const TITULAR = 94001;
const ADJUNTO = 94002;
const UNIDADE = 94010;
const NOME = 'DP de Aurora';
const FERIAS_INICIO = '2026-10-01';
const FERIAS_FIM = '2026-10-30';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(async () => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (${UNIDADE}, '${NOME}', 'delegacia');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha) VALUES
			(${TITULAR}, '94001', 'TITULAR', 'DPC', '${NOME}', 'h'),
			(${ADJUNTO}, '94002', 'ADJUNTO', 'DPC', '${NOME}', 'h');
		INSERT INTO unidade_responsaveis (unidade_id, policial_id, papel, carater, data_inicio, nup, origem, registrado_por_id, registrado_por_nome)
			VALUES (${UNIDADE}, ${TITULAR}, 'titular', 'permanente', '2026-01-01', '00000.000000/2026-00', 'sistema', 1, 'Carga');
	`);
	await registrarHistorico(db, {
		policial_id: TITULAR,
		tipo: 'afastamento',
		subtipo: 'ferias',
		data_inicio: FERIAS_INICIO,
		data_fim: FERIAS_FIM,
		qtd_dias: 30
	});
});

const indicar = () =>
	criarSolicitacaoAcao(db, {
		policial_id: ADJUNTO,
		tipo: 'direcao',
		subtipo: 'respondencia_temporaria',
		unidade_destino: NOME,
		data_inicio: FERIAS_INICIO,
		data_fim: FERIAS_FIM,
		// O 1º dia do AFASTAMENTO, que é como a fila reencontra o evento.
		data_evento: FERIAS_INICIO,
		nup: '00000.000000/2026-77',
		justificativa: 'O adjunto responde durante as férias do titular',
		solicitante_id: 7,
		solicitante_nome: 'Admin da Unidade'
	});

const cobertura = () =>
	sqlite
		.prepare(
			`SELECT policial_id, substitui_policial_id, evento_id, data_inicio, data_fim, nup
			 FROM unidade_responsaveis WHERE carater = 'temporaria'`
		)
		.get() as
		| {
				policial_id: number;
				substitui_policial_id: number;
				evento_id: number | null;
				data_inicio: string;
				data_fim: string;
				nup: string;
		  }
		| undefined;

describe('respondência temporária pela fila', () => {
	it('aprovada, vira cobertura ligada ao titular e ao evento', async () => {
		const pedido = await indicar();
		await decidirSolicitacaoAcao(db, pedido, true, 1);
		const c = cobertura();
		expect(c).toMatchObject({
			policial_id: ADJUNTO,
			substitui_policial_id: TITULAR,
			data_inicio: FERIAS_INICIO,
			data_fim: FERIAS_FIM,
			nup: '00000.000000/2026-77'
		});
		// O evento foi reencontrado pelo 1º dia — é ele que permite encurtar a
		// cobertura junto com o afastamento.
		expect(c?.evento_id).not.toBeNull();
		// Dentro do período quem dirige é o adjunto; fora, o titular, que nunca
		// foi encerrado.
		expect(await responsavelVigente(db, UNIDADE, '2026-10-15')).toMatchObject({
			policial_id: ADJUNTO
		});
		expect(await responsavelVigente(db, UNIDADE, '2026-11-01')).toMatchObject({
			policial_id: TITULAR
		});
	});

	it('rejeitada, não registra nada', async () => {
		const pedido = await indicar();
		await decidirSolicitacaoAcao(db, pedido, false, 1);
		expect(cobertura()).toBeUndefined();
	});

	it('titular trocado entre a indicação e a decisão: cobre o titular de agora', async () => {
		const pedido = await indicar();
		// O titular antigo saiu e outro delegado assumiu antes da homologação.
		sqlite.exec(`
			UPDATE unidade_responsaveis SET data_fim = '2026-09-20' WHERE carater = 'permanente';
			INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha)
				VALUES (94003, '94003', 'TITULAR NOVO', 'DPC', '${NOME}', 'h');
			INSERT INTO unidade_responsaveis (unidade_id, policial_id, papel, carater, data_inicio, nup, origem, registrado_por_id, registrado_por_nome)
				VALUES (${UNIDADE}, 94003, 'titular', 'permanente', '2026-09-21', '00000.000000/2026-11', 'sistema', 1, 'Tela');
		`);
		await decidirSolicitacaoAcao(db, pedido, true, 1);
		// Sem afastamento do titular NOVO, o evento não é reencontrado — a
		// cobertura existe, amarrada a quem de fato ocupa a cadeira.
		expect(cobertura()).toMatchObject({ substitui_policial_id: 94003, evento_id: null });
	});
});
