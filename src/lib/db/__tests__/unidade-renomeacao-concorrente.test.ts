/**
 * Renomear unidade não deixa lotação órfã — FLW-UNIDADE-004.
 *
 * `unidades.nome` é denormalizado em `policiais.lotacao` e `escalas.lotacao`;
 * não há FK, a propagação é manual. Ler o nome, gravar o novo e propagar em
 * comandos separados produz o pior desfecho possível quando duas edições partem
 * do mesmo estado:
 *
 *   T1 lê "A" · T2 lê "A"
 *   T1 grava "B" e propaga (WHERE lotacao = 'A')  → efetivo vai para "B"
 *   T2 grava "C" e propaga (WHERE lotacao = 'A')  → não acha ninguém
 *
 * Sobra uma unidade chamada "C" e um efetivo inteiro lotado em "B", que não
 * existe. Ninguém percebe até alguém montar uma escala.
 *
 * A corrida é reproduzida com um `Database` que INTERFERE entre a leitura e a
 * gravação — é a janela do achado, e é onde a outra requisição caberia. Sem
 * isso o harness é síncrono e a janela nunca aparece.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { atualizarUnidade, ConflitoDeRenomeacaoUnidade } from '../unidades';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const UNID = 96001;

const DADOS = {
	nome: 'DELEGACIA A',
	tipo: 'delegacia' as const,
	seccional_id: null,
	tem_plantao: true,
	tem_expediente: true,
	tem_fds: true,
	cidade: 'CIDADE X',
	sigla: ''
};

const estado = () => ({
	unidade: (
		sqlite.prepare(`SELECT nome FROM unidades WHERE id = ${UNID}`).get() as { nome: string }
	).nome,
	policial: (
		sqlite.prepare('SELECT lotacao FROM policiais WHERE id = 96101').get() as { lotacao: string }
	).lotacao,
	escala: (
		sqlite.prepare('SELECT lotacao FROM escalas WHERE id = 96201').get() as { lotacao: string }
	).lotacao
});

/**
 * Um `Database` que roda `interferir()` na PRIMEIRA chamada a `update` — o
 * instante exato em que a outra requisição chegaria, depois de o nome ter sido
 * lido e antes de a gravação condicionada a ele acontecer.
 *
 * O gancho é `update`, e não `batch`, porque os dois caminhos da função passam
 * por ele: a renomeação monta o UPDATE e o manda ao `batch`, a edição sem troca
 * de nome monta o mesmo UPDATE e o aguarda direto. Ancorar no `batch` deixaria
 * o segundo caminho sem janela — e foi o que aconteceu na primeira versão deste
 * teste.
 */
function dbComInterferencia(base: Database, interferir: () => void): Database {
	let jaInterferiu = false;
	return new Proxy(base, {
		get(alvo, prop, receiver) {
			if (prop === 'update') {
				return (...args: unknown[]) => {
					if (!jaInterferiu) {
						jaInterferiu = true;
						interferir();
					}
					return (base as unknown as { update: (...a: unknown[]) => unknown }).update(...args);
				};
			}
			return Reflect.get(alvo, prop, receiver);
		}
	}) as Database;
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo, cidade)
		VALUES (${UNID}, 'DELEGACIA A', 'delegacia', 'CIDADE X');

		-- O par nome + id (E51): a cascata da renomeação mira o ID, então a
		-- fixture precisa ter os dois, como toda linha que o sistema grava.
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, unidade_id, senha)
		VALUES (96101, 'M96101', 'Fulano', 'OIP', 'DELEGACIA A', ${UNID}, 'h');

		INSERT INTO escalas (id, titulo, tipo, lotacao, unidade_id, cidade, data_inicio, data_fim)
		VALUES (96201, 'ESCALA', 'plantao', 'DELEGACIA A', ${UNID}, 'CIDADE X', '2026-09-01', '2026-09-30');
	`);
});

describe('renomeação sem disputa', () => {
	it('propaga para policiais e escalas', async () => {
		await atualizarUnidade(db, UNID, { ...DADOS, nome: 'DELEGACIA B' });
		expect(estado()).toEqual({
			unidade: 'DELEGACIA B',
			policial: 'DELEGACIA B',
			escala: 'DELEGACIA B'
		});
	});

	it('edição sem trocar o nome não mexe nas lotações', async () => {
		await atualizarUnidade(db, UNID, { ...DADOS, cidade: 'OUTRA CIDADE' });
		expect(estado().policial).toBe('DELEGACIA A');
		const linha = sqlite.prepare(`SELECT cidade FROM unidades WHERE id = ${UNID}`).get() as {
			cidade: string;
		};
		expect(linha.cidade).toBe('OUTRA CIDADE');
	});

	it('unidade inexistente continua sendo erro', async () => {
		await expect(atualizarUnidade(db, 999999, DADOS)).rejects.toThrow('Unidade não encontrada');
	});
});

describe('duas renomeações a partir do mesmo estado', () => {
	it('a segunda é RECUSADA em vez de deixar lotação órfã', async () => {
		// T2 leu "DELEGACIA A"; T1 chega primeiro e leva tudo para "DELEGACIA B".
		const dbT2 = dbComInterferencia(db, () => {
			sqlite.exec(`
				UPDATE unidades SET nome = 'DELEGACIA B' WHERE id = ${UNID};
				UPDATE policiais SET lotacao = 'DELEGACIA B' WHERE lotacao = 'DELEGACIA A';
				UPDATE escalas SET lotacao = 'DELEGACIA B' WHERE lotacao = 'DELEGACIA A';
			`);
		});

		await expect(
			atualizarUnidade(dbT2, UNID, { ...DADOS, nome: 'DELEGACIA C' })
		).rejects.toBeInstanceOf(ConflitoDeRenomeacaoUnidade);

		// O desfecho que o achado descreve seria unidade "C" com efetivo em "B".
		expect(estado(), 'a renomeação de T1 fica de pé, inteira').toEqual({
			unidade: 'DELEGACIA B',
			policial: 'DELEGACIA B',
			escala: 'DELEGACIA B'
		});
	});

	it('edição SEM troca de nome também é recusada se a linha mudou', async () => {
		// Sem a condição, esta edição gravaria tipo/cidade por cima de um nome que
		// ela nunca viu.
		const dbT2 = dbComInterferencia(db, () => {
			sqlite.exec(`UPDATE unidades SET nome = 'OUTRO NOME' WHERE id = ${UNID}`);
		});

		await expect(
			atualizarUnidade(dbT2, UNID, { ...DADOS, cidade: 'CIDADE NOVA' })
		).rejects.toBeInstanceOf(ConflitoDeRenomeacaoUnidade);

		const linha = sqlite.prepare(`SELECT nome, cidade FROM unidades WHERE id = ${UNID}`).get() as {
			nome: string;
			cidade: string;
		};
		expect(linha).toEqual({ nome: 'OUTRO NOME', cidade: 'CIDADE X' });
	});
});

describe('a mensagem do conflito', () => {
	it('diz qual nome era esperado e o que fazer', () => {
		const e = new ConflitoDeRenomeacaoUnidade('DELEGACIA A');
		expect(e.message).toContain('DELEGACIA A');
		expect(e.message).toContain('Recarregue');
		expect(e.name).toBe('ConflitoDeRenomeacaoUnidade');
	});
});
