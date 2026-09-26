/**
 * A régua ÚNICA de escopo administrativo (E75), contra SQLite real.
 *
 * Até a E75 havia quatro respostas para "quem administra o quê": a da Gestão
 * de unidade (`escopoDeUnidades`), as gêmeas `lotacoesAdministradas` (nomes) e
 * `unidadesAdministradas` (ids), e uma cópia nas operações. Elas discordavam —
 * a de nomes expandia a seccional uma volta só; a da árvore descia até o fim —,
 * e a divergência aparecia na tela sem erro nenhum: o admin simplesmente via
 * mais, ou menos, conforme a tela.
 *
 * Este arquivo trava as duas coisas que a E75 decidiu:
 *
 * 1. **As réguas respondem a MESMA coisa** — agora por construção, porque as
 *    gêmeas delegam para `escopoDeUnidades`; o teste garante que ninguém volte
 *    a dar a uma delas uma regra própria.
 * 2. **A regra dele**, de 25/09: o posto é administrado pela unidade-mãe SE não
 *    tiver direção própria; quem está acima vê tudo abaixo ("se enxerga a mãe,
 *    enxerga a filha"); o colaborador vê SOMENTE a sua unidade. O critério é a
 *    DIREÇÃO REGISTRADA — no cadastro real, o titular de Fortim está lotado em
 *    Aracati, e pelo critério da lotação Fortim iria para a mãe.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import { lotacoesAdministradas, unidadesAdministradas } from '../policial-permissao';
import { escopoDeUnidades } from '../unidades/escopo';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';

let sqlite: DatabaseSync;
let db: Database;

const DEP = 9300;
const POSTO_DO_DEP = 9301;
const SECC_NORTE = 9100;
const DP_PRIMEIRA = 9101;
const POSTO_SEM_CHEFE = 9103;
const POSTO_COM_CHEFE = 9104;
const NUCLEO_DO_POSTO_COM_CHEFE = 9105;
const DP_SEGUNDA = 9102;
const SECC_SUL = 9200;
const DP_TERCEIRA = 9201;
const TITULAR = 95900;

/** Monta um `usuario` de sessão com o mínimo que os predicados de papel leem. */
function usuario(over: Record<string, unknown>) {
	return {
		id: 1,
		tipo: 'policial',
		nome: 'Fulano',
		primeiro_acesso: false,
		...over
	} as unknown as NonNullable<App.Locals['usuario']>;
}

/** Os nomes destes ids, para comparar as réguas na mesma moeda. */
function nomesDe(ids: Iterable<number>): string[] {
	const lista = [...ids];
	if (lista.length === 0) return [];
	const linhas = sqlite
		.prepare(`SELECT nome FROM unidades WHERE id IN (${lista.join(',')})`)
		.all() as { nome: string }[];
	return linhas.map((l) => l.nome).sort();
}

/**
 * As três réguas para a MESMA sessão, na mesma moeda.
 *
 * `null` (Super Admin) é preservado nas duas gêmeas, porque `null` e conjunto
 * vazio são opostos — um libera tudo, o outro barra tudo — e um teste que os
 * achatasse passaria justamente no erro que mais importa.
 */
async function asTres(u: NonNullable<App.Locals['usuario']>) {
	const porNome = await lotacoesAdministradas(db, u);
	const porId = await unidadesAdministradas(db, u);
	const arvore = await escopoDeUnidades(db, u);
	return {
		nomes: porNome === null ? null : [...porNome].sort(),
		ids: porId === null ? null : nomesDe(porId),
		arvore: (arvore?.nos ?? []).map((n) => n.nome).sort()
	};
}

/** O que a sessão alcança — conferindo, de quebra, que as três concordam. */
async function alcance(u: NonNullable<App.Locals['usuario']>): Promise<string[]> {
	const { nomes, ids, arvore } = await asTres(u);
	expect(ids, 'nomes e ids têm de concordar').toEqual(nomes);
	expect(arvore, 'a Gestão de unidade tem de concordar com as outras').toEqual(nomes);
	return nomes ?? [];
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);

	// Um departamento com duas seccionais. Sob a DP PRIMEIRA, dois postos — um
	// SEM direção e um COM titular registrado — e, sob o posto com chefe, um
	// núcleo: é onde a regra da E75 decide alguma coisa.
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo, seccional_id) VALUES
			(${DEP}, 'DEP DE TESTE', 'departamento', NULL),
			(${POSTO_DO_DEP}, 'POSTO DO DEP', 'unidade', ${DEP}),
			(${SECC_NORTE}, 'SECCIONAL NORTE', 'seccional', ${DEP}),
			(${DP_PRIMEIRA}, 'DP PRIMEIRA', 'delegacia', ${SECC_NORTE}),
			(${POSTO_SEM_CHEFE}, 'POSTO SEM CHEFE', 'unidade', ${DP_PRIMEIRA}),
			(${POSTO_COM_CHEFE}, 'POSTO COM CHEFE', 'unidade', ${DP_PRIMEIRA}),
			(${NUCLEO_DO_POSTO_COM_CHEFE}, 'NUCLEO DO POSTO COM CHEFE', 'nucleo', ${POSTO_COM_CHEFE}),
			(${DP_SEGUNDA}, 'DP SEGUNDA', 'delegacia', ${SECC_NORTE}),
			(${SECC_SUL}, 'SECCIONAL SUL', 'seccional', ${DEP}),
			(${DP_TERCEIRA}, 'DP TERCEIRA', 'delegacia', ${SECC_SUL});
		-- O titular está LOTADO na delegacia-mãe, como o de Fortim no cadastro real.
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, unidade_id, senha)
		VALUES (${TITULAR}, '95900', 'TITULAR DO POSTO', 'DPC', 'DP PRIMEIRA', ${DP_PRIMEIRA}, 'x');
		INSERT INTO unidade_responsaveis (unidade_id, policial_id, papel, carater, data_inicio)
		VALUES (${POSTO_COM_CHEFE}, ${TITULAR}, 'titular', 'permanente', '2026-01-01');
	`);
});

describe('a regra da E75', () => {
	it('admin de unidade: a unidade e o posto SEM direção — o posto com chefe fica de fora', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: DP_PRIMEIRA });
		expect(await alcance(u)).toEqual(['DP PRIMEIRA', 'POSTO SEM CHEFE']);
	});

	it('o que pende do posto com chefe também fica de fora da mãe', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: DP_PRIMEIRA });
		expect(await alcance(u)).not.toContain('NUCLEO DO POSTO COM CHEFE');
	});

	it('o critério é a direção REGISTRADA, não a lotação do delegado', async () => {
		// O titular do posto está lotado na DP PRIMEIRA. Pela lotação, o posto
		// "não teria delegado" e iria para a mãe — o contrário do decidido.
		const lotacao = sqlite
			.prepare('SELECT unidade_id FROM policiais WHERE id = ?')
			.get(TITULAR) as { unidade_id: number };
		expect(lotacao.unidade_id).toBe(DP_PRIMEIRA);
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: DP_PRIMEIRA });
		expect(await alcance(u)).not.toContain('POSTO COM CHEFE');
	});

	it('encerrada a direção, o posto volta para a mãe', async () => {
		sqlite.exec(
			`UPDATE unidade_responsaveis SET data_fim = '2026-02-01' WHERE unidade_id = ${POSTO_COM_CHEFE}`
		);
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: DP_PRIMEIRA });
		expect(await alcance(u)).toEqual([
			'DP PRIMEIRA',
			'NUCLEO DO POSTO COM CHEFE',
			'POSTO COM CHEFE',
			'POSTO SEM CHEFE'
		]);
	});

	it('a seccional vê TUDO abaixo, inclusive o posto com chefe ("se enxerga a mãe, enxerga a filha")', async () => {
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: SECC_NORTE });
		expect(await alcance(u)).toEqual([
			'DP PRIMEIRA',
			'DP SEGUNDA',
			'NUCLEO DO POSTO COM CHEFE',
			'POSTO COM CHEFE',
			'POSTO SEM CHEFE',
			'SECCIONAL NORTE'
		]);
	});

	it('a seccional no chapéu de unidade é só uma casa — as delegacias não são subunidade', async () => {
		const u = usuario({
			papel: 'admin_seccional',
			papel_unidade_id: SECC_NORTE,
			atuandoComo: 'unidade'
		});
		expect(await alcance(u)).toEqual(['SECCIONAL NORTE']);
	});

	it('o colaborador vê SOMENTE a sua unidade — nem o posto sem chefe', async () => {
		const u = usuario({ tipo: 'colaborador', papel_unidade_id: DP_PRIMEIRA, acessos: ['ferias'] });
		expect(await alcance(u)).toEqual(['DP PRIMEIRA']);
	});
});

describe('as outras sessões, com as três réguas concordando', () => {
	it('Super Admin: as gêmeas devolvem null, e null não é conjunto vazio', async () => {
		const { nomes, ids } = await asTres(usuario({ tipo: 'admin', isSuperAdmin: true }));
		expect(nomes).toBeNull();
		expect(ids).toBeNull();
	});

	it('Admin Geral no chapéu de rede: a subárvore inteira do nó', async () => {
		const u = usuario({ tipo: 'admin', unidade_id: DEP, atuandoComo: 'rede' });
		const tudo = await alcance(u);
		expect(tudo).toContain('POSTO COM CHEFE');
		expect(tudo).toContain('DP TERCEIRA');
		expect(tudo).toHaveLength(10);
	});

	it('Admin Geral no chapéu de unidade: só a casa do departamento', async () => {
		const u = usuario({ tipo: 'admin', unidade_id: DEP, atuandoComo: 'unidade' });
		expect(await alcance(u)).toEqual(['DEP DE TESTE', 'POSTO DO DEP']);
	});

	it('conta admin sem nó e papel sem unidade: nada, e nada barra tudo', async () => {
		expect(await alcance(usuario({ tipo: 'admin' }))).toEqual([]);
		for (const papel of ['admin_seccional', 'admin_unidade']) {
			expect(await alcance(usuario({ papel, papel_unidade_id: null })), papel).toEqual([]);
		}
	});

	it('unidade do papel que não existe: vazio, não um id órfão', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: 999999 });
		expect(await alcance(u)).toEqual([]);
	});

	it('a lotação atual não dá escopo — o escopo vem do PAPEL (FLW-RBAC-003)', async () => {
		const u = usuario({
			papel: 'admin_unidade',
			lotacao: 'DP SEGUNDA',
			papel_unidade_id: DP_PRIMEIRA
		});
		expect(await alcance(u)).not.toContain('DP SEGUNDA');
	});
});
