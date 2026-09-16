/**
 * A tranca da decisão de cadastro é o `WHERE status='pendente'` (SEC-36).
 * Sem ele, o segundo clique reaplicava o patch no policial — inclusive
 * depois de o valor_novo ter sido mexido na linha já decidida.
 *
 * O segundo bloco cobre o que mudou em ago/2026: o pedido passou a ter DONO
 * (`solicitante_id`) e MOTIVO (`justificativa`), e o CPF passou a NÃO ser
 * aplicado por aqui — cifra e índice cego são de `atualizarPolicial`, e gravar
 * `valor_novo` cru na coluna deixaria o índice apontando para o valor anterior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { criarSolicitacoesCadastro, decidirSolicitacaoCadastro } from '../solicitacoes';
import type { Database } from '$lib/db';

const POL = 44101;
const ADMIN_UNIDADE = 44102;

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, cpf, cpf_index)
		VALUES (${POL}, 'M44101', 'Servidor Alvo', 'OIP', 'DEL A', 'h', 'cpf-cifrado', 'idx-antigo');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, papel, papel_unidade_id)
		VALUES (${ADMIN_UNIDADE}, 'M44102', 'Admin da Unidade', 'DPC', 'DEL A', 'h', 'admin_unidade', 1);
		INSERT INTO cadastro_solicitacoes (id, policial_id, campo, valor_atual, valor_novo, status)
		VALUES (1, ${POL}, 'lotacao', 'DEL A', 'DEL B', 'pendente');
	`);
});

describe('decidirSolicitacaoCadastro (SEC-36)', () => {
	it('aprova uma vez e aplica o valor no cadastro', async () => {
		const r = await decidirSolicitacaoCadastro(db, 1, true, 99);
		expect(r?.status).toBe('aprovada');
		const row = sqlite.prepare('SELECT lotacao FROM policiais WHERE id = ?').get(POL) as {
			lotacao: string;
		};
		expect(row.lotacao).toBe('DEL B');
	});

	it('segunda decisão não reaplica o patch', async () => {
		await decidirSolicitacaoCadastro(db, 1, true, 99);
		sqlite.exec(`UPDATE cadastro_solicitacoes SET valor_novo = 'DEL C' WHERE id = 1`);
		const segunda = await decidirSolicitacaoCadastro(db, 1, true, 99);
		expect(segunda).toBeNull();
		const row = sqlite.prepare('SELECT lotacao FROM policiais WHERE id = ?').get(POL) as {
			lotacao: string;
		};
		expect(row.lotacao).toBe('DEL B');
	});

	it('rejeitar e depois aprovar não muda o cadastro', async () => {
		const rejeitada = await decidirSolicitacaoCadastro(db, 1, false, 99);
		expect(rejeitada?.status).toBe('rejeitada');
		expect(await decidirSolicitacaoCadastro(db, 1, true, 99)).toBeNull();
		const row = sqlite.prepare('SELECT lotacao FROM policiais WHERE id = ?').get(POL) as {
			lotacao: string;
		};
		expect(row.lotacao).toBe('DEL A');
	});
});

describe('pedido do administrador com escopo', () => {
	const SOLICITANTE = { id: ADMIN_UNIDADE, nome: 'Admin da Unidade' };

	it('grava quem pediu e por quê, em TODAS as linhas do pedido', async () => {
		await criarSolicitacoesCadastro(
			db,
			POL,
			[
				{ campo: 'telefone', valorAtual: null, valorNovo: '85999990000' },
				{ campo: 'classe', valorAtual: 'A', valorNovo: 'B' }
			],
			'Correção informada pelo servidor no ofício 12/2026.',
			SOLICITANTE
		);

		const linhas = sqlite
			.prepare(
				`SELECT campo, justificativa, solicitante_id, solicitante_nome
				 FROM cadastro_solicitacoes WHERE policial_id = ? AND campo <> 'lotacao'
				 ORDER BY campo`
			)
			.all(POL) as Array<{
			campo: string;
			justificativa: string;
			solicitante_id: number;
			solicitante_nome: string;
		}>;

		expect(linhas.map((l) => l.campo)).toEqual(['classe', 'telefone']);
		// A justificativa se repete de propósito: as linhas são decididas UMA A UMA,
		// e uma delas sem o motivo ao lado obrigaria quem decide a procurá-lo em
		// outra linha da fila.
		for (const l of linhas) {
			expect(l.justificativa).toBe('Correção informada pelo servidor no ofício 12/2026.');
			expect(l.solicitante_id).toBe(ADMIN_UNIDADE);
			expect(l.solicitante_nome).toBe('Admin da Unidade');
		}
	});

	it('pedido novo do mesmo campo substitui o pendente anterior', async () => {
		await criarSolicitacoesCadastro(
			db,
			POL,
			[{ campo: 'telefone', valorAtual: null, valorNovo: '85999990000' }],
			'primeiro pedido',
			SOLICITANTE
		);
		await criarSolicitacoesCadastro(
			db,
			POL,
			[{ campo: 'telefone', valorAtual: null, valorNovo: '85988887777' }],
			'número corrigido',
			SOLICITANTE
		);

		const linhas = sqlite
			.prepare(
				`SELECT valor_novo FROM cadastro_solicitacoes
				 WHERE policial_id = ? AND campo = 'telefone' AND status = 'pendente'`
			)
			.all(POL) as Array<{ valor_novo: string }>;
		expect(linhas).toEqual([{ valor_novo: '85988887777' }]);
	});

	/** O id da (única) solicitação pendente daquele campo. */
	function idDoPedido(campo: string): number {
		return (
			sqlite
				.prepare(`SELECT id FROM cadastro_solicitacoes WHERE campo = ? AND status = 'pendente'`)
				.get(campo) as { id: number }
		).id;
	}

	/**
	 * A aprovação grava por `atualizarPolicial`, e não por um `UPDATE` cru — é o
	 * que faz o cadastro resultante ser IGUAL ao que a edição direta produz.
	 *
	 * A matrícula é o caso que denuncia a diferença: `limparMatricula` tira pontos
	 * e hífens. Com um `UPDATE` direto, aprovar `301.095-1` gravaria a forma
	 * pontuada, e o login por matrícula deixaria de casar com o que o Admin Geral
	 * teria gravado à mão para o mesmo pedido.
	 */
	it('aprovar matrícula NORMALIZA, como a edição direta', async () => {
		await criarSolicitacoesCadastro(
			db,
			POL,
			[{ campo: 'matricula', valorAtual: 'M44101', valorNovo: '301.095-1' }],
			'Matrícula divergente da planilha institucional.',
			SOLICITANTE
		);

		await decidirSolicitacaoCadastro(db, idDoPedido('matricula'), true, 99);

		const row = sqlite.prepare('SELECT matricula FROM policiais WHERE id = ?').get(POL) as {
			matricula: string;
		};
		expect(row.matricula).toBe('3010951');
	});

	/**
	 * O CPF é cifrado em repouso e tem índice cego. Sem chave de cifra (o caso do
	 * teste e do desenvolvimento) ele fica em claro — o que importa aqui é que os
	 * DOIS campos sejam regravados juntos: um índice apontando para o CPF anterior
	 * faria o lookup por CPF, que a assinatura com certificado usa para casar
	 * titular e servidor, parar de encontrar a pessoa.
	 */
	it('aprovar CPF regrava o índice cego junto', async () => {
		await criarSolicitacoesCadastro(
			db,
			POL,
			[{ campo: 'cpf', valorAtual: null, valorNovo: '11122233344' }],
			'CPF ausente no cadastro',
			SOLICITANTE
		);

		const decidida = await decidirSolicitacaoCadastro(db, idDoPedido('cpf'), true, 99);
		expect(decidida?.status).toBe('aprovada');

		const row = sqlite.prepare('SELECT cpf, cpf_index FROM policiais WHERE id = ?').get(POL) as {
			cpf: string;
			cpf_index: string | null;
		};
		expect(row.cpf).toBe('11122233344');
		// Nunca o índice do CPF anterior.
		expect(row.cpf_index).not.toBe('idx-antigo');
	});
});

/**
 * `designacao_id` é o único campo solicitável que guarda uma REFERÊNCIA (o id
 * do catálogo `designacoes`), e não o texto que se lê. Duas coisas têm de valer
 * na aprovação: o valor entra como NÚMERO na coluna, e a linha passa a contar
 * como decidida pelo sistema — senão a próxima carga da planilha desfaria em
 * silêncio o que o Admin Geral acabou de homologar (0089/E50).
 */
describe('decidirSolicitacaoCadastro — designação (E50)', () => {
	/** Ids semeados pela 0088: 9 = Chefe de seção de expedientes e cartório. */
	const CHEFE_CARTORIO = 9;

	beforeEach(async () => {
		await criarSolicitacoesCadastro(
			db,
			POL,
			[{ campo: 'designacao_id', valorAtual: null, valorNovo: String(CHEFE_CARTORIO) }],
			'Assumiu o cartório da unidade em 01/09.',
			{ id: ADMIN_UNIDADE, nome: 'Admin da Unidade' }
		);
	});

	const pedido = () =>
		sqlite.prepare("SELECT id FROM cadastro_solicitacoes WHERE campo = 'designacao_id'").get() as {
			id: number;
		};

	const alvo = () =>
		sqlite
			.prepare('SELECT designacao_id, designacao_origem FROM policiais WHERE id = ?')
			.get(POL) as { designacao_id: number | null; designacao_origem: string };

	it('aprovar grava o id como número e marca a origem como sistema', async () => {
		const r = await decidirSolicitacaoCadastro(db, pedido().id, true, 99);
		expect(r?.status).toBe('aprovada');
		expect(alvo()).toEqual({ designacao_id: CHEFE_CARTORIO, designacao_origem: 'sistema' });
	});

	it('rejeitar não toca no cadastro', async () => {
		const r = await decidirSolicitacaoCadastro(db, pedido().id, false, 99);
		expect(r?.status).toBe('rejeitada');
		expect(alvo()).toEqual({ designacao_id: null, designacao_origem: 'planilha' });
	});
});
