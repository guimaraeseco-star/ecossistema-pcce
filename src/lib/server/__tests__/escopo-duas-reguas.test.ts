/**
 * As DUAS réguas de escopo administrativo, par a par, contra SQLite real.
 *
 * Enquanto a E51 migra o vínculo de nome para id, `lotacoesAdministradas`
 * (nomes) e `unidadesAdministradas` (ids) convivem. Este arquivo existe para
 * garantir a única coisa que torna essa convivência segura: **as duas têm de
 * responder a MESMA coisa**. Se divergirem, trocar uma pela outra numa consulta
 * deixa de ser "migrar de nome para id" e passa a ser alargar ou estreitar
 * escopo de carona — a mudança mais silenciosa que existe, porque nenhuma tela
 * acusa e nenhum teste de rota quebra: o admin simplesmente passa a ver mais
 * gente.
 *
 * Isso não é hipótese. A primeira versão de `unidadesAdministradas` (E51 parte
 * 1) delegava tudo a `escopoDeUnidades`, que desce a árvore INTEIRA, enquanto a
 * régua de nomes expande uma volta para `admin_seccional` e nem isso para
 * `admin_unidade`. A diferença aparece no fim do arquivo, medida.
 *
 * ## A decisão que NÃO é deste teste
 *
 * Qual das réguas é a certa é decisão dele, não consequência de uma migração.
 * O comentário da E71 diz que quem administra uma unidade administra "aquela
 * unidade e os postos dela", o que aponta para a árvore; a régua de nomes diz
 * outra coisa desde antes. Os dois últimos casos aqui MEDEM a diferença em vez
 * de escolher, para que ela fique visível e não volte a ser descoberta por
 * acidente.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import { lotacoesAdministradas, unidadesAdministradas } from '../policial-permissao';
import { escopoDeUnidades } from '../unidades/escopo';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';

let sqlite: DatabaseSync;
let db: Database;

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

/** Os nomes das unidades destes ids, para comparar as duas réguas na mesma moeda. */
function nomesDe(ids: Set<number>): string[] {
	if (ids.size === 0) return [];
	const linhas = sqlite
		.prepare(`SELECT nome FROM unidades WHERE id IN (${[...ids].join(',')})`)
		.all() as { nome: string }[];
	return linhas.map((l) => l.nome).sort();
}

/**
 * O par: as duas réguas para a MESMA sessão, já na mesma moeda.
 *
 * `null` (Super Admin) é preservado, porque `null` e conjunto vazio são
 * opostos — um libera tudo, o outro barra tudo — e um teste que os achatasse
 * passaria justamente no erro que mais importa.
 */
async function asDuas(u: NonNullable<App.Locals['usuario']>) {
	const porNome = await lotacoesAdministradas(db, u);
	const porId = await unidadesAdministradas(db, u);
	return {
		nomes: porNome === null ? null : [...porNome].sort(),
		ids: porId === null ? null : nomesDe(porId)
	};
}

beforeAll(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);

	// A mesma topologia do teste irmão (`policial-permissao.test.ts`) MAIS um
	// posto pendurado numa delegacia — que é exatamente onde as duas réguas se
	// separam, e o que a topologia de lá não tinha para mostrar.
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo, seccional_id) VALUES
			(9300, 'DEP DE TESTE', 'departamento', NULL),
			(9301, 'POSTO DO DEP', 'unidade', 9300),
			(9100, 'SECCIONAL NORTE', 'seccional', 9300),
			(9101, 'DP PRIMEIRA', 'delegacia', 9100),
			(9103, 'POSTO DA PRIMEIRA', 'unidade', 9101),
			(9102, 'DP SEGUNDA', 'delegacia', 9100),
			(9200, 'SECCIONAL SUL', 'seccional', NULL),
			(9201, 'DP TERCEIRA', 'delegacia', 9200);
	`);
});

describe('as duas réguas respondem a mesma coisa', () => {
	it('Super Admin: as duas devolvem null, e null não é conjunto vazio', async () => {
		const { nomes, ids } = await asDuas(usuario({ tipo: 'admin', isSuperAdmin: true }));
		expect(nomes).toBeNull();
		expect(ids).toBeNull();
	});

	it('Admin Geral no chapéu de rede: a subárvore do nó, igual nas duas', async () => {
		const { nomes, ids } = await asDuas(
			usuario({ tipo: 'admin', unidade_id: 9300, atuandoComo: 'rede' })
		);
		expect(ids).toEqual(nomes);
		expect(nomes).toContain('DP PRIMEIRA');
		expect(nomes).toContain('POSTO DA PRIMEIRA');
	});

	it('Admin Geral no chapéu de unidade: só a casa, igual nas duas', async () => {
		const { nomes, ids } = await asDuas(
			usuario({ tipo: 'admin', unidade_id: 9300, atuandoComo: 'unidade' })
		);
		expect(ids).toEqual(nomes);
		expect(nomes).toEqual(['DEP DE TESTE', 'POSTO DO DEP']);
	});

	it('conta admin sem nó: as duas devolvem vazio, e vazio barra tudo', async () => {
		const { nomes, ids } = await asDuas(usuario({ tipo: 'admin' }));
		expect(nomes).toEqual([]);
		expect(ids).toEqual([]);
	});

	it('admin de seccional: a seccional e as delegacias dela, igual nas duas', async () => {
		const { nomes, ids } = await asDuas(
			usuario({ papel: 'admin_seccional', papel_unidade_id: 9100 })
		);
		expect(ids).toEqual(nomes);
		expect(nomes).toEqual(['DP PRIMEIRA', 'DP SEGUNDA', 'SECCIONAL NORTE']);
	});

	it('admin de seccional no chapéu de unidade: só a casa, igual nas duas', async () => {
		const { nomes, ids } = await asDuas(
			usuario({ papel: 'admin_seccional', papel_unidade_id: 9100, atuandoComo: 'unidade' })
		);
		expect(ids).toEqual(nomes);
		expect(nomes).toEqual(['SECCIONAL NORTE']);
	});

	it('admin de unidade: a unidade do PAPEL, e só ela, igual nas duas', async () => {
		const { nomes, ids } = await asDuas(
			usuario({ papel: 'admin_unidade', lotacao: 'DP SEGUNDA', papel_unidade_id: 9101 })
		);
		expect(ids).toEqual(nomes);
		expect(nomes).toEqual(['DP PRIMEIRA']);
	});

	it('papel sem unidade: as duas devolvem vazio', async () => {
		for (const papel of ['admin_seccional', 'admin_unidade']) {
			const { nomes, ids } = await asDuas(usuario({ papel, papel_unidade_id: null }));
			expect(nomes, papel).toEqual([]);
			expect(ids, papel).toEqual([]);
		}
	});

	it('unidade do papel que não existe mais: vazio nas duas, não um id órfão', async () => {
		const { nomes, ids } = await asDuas(
			usuario({ papel: 'admin_unidade', papel_unidade_id: 999999 })
		);
		expect(nomes).toEqual([]);
		expect(ids, 'o id inexistente não pode virar escopo').toEqual([]);
	});

	it('colaborador com acesso: a unidade dele, igual nas duas', async () => {
		const { nomes, ids } = await asDuas(
			usuario({ tipo: 'colaborador', papel_unidade_id: 9101, acessos: ['ferias'] })
		);
		expect(ids).toEqual(nomes);
		expect(nomes).toEqual(['DP PRIMEIRA']);
	});
});

describe('a TERCEIRA régua, que desce a árvore, e o quanto ela difere', () => {
	/**
	 * `escopoDeUnidades` é a régua das telas de unidade, e é mais larga. Estes
	 * dois casos não dizem qual está certa: medem a diferença, para que a decisão
	 * seja tomada de propósito e não descoberta depois em produção.
	 */
	it('admin de unidade: a árvore inclui o posto da delegacia; as outras duas, não', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: 9101 });
		const arvore = await escopoDeUnidades(db, u);
		expect((arvore?.nos ?? []).map((n) => n.nome).sort()).toEqual([
			'DP PRIMEIRA',
			'POSTO DA PRIMEIRA'
		]);

		const { nomes } = await asDuas(u);
		expect(nomes, 'a régua administrativa para em DP PRIMEIRA').toEqual(['DP PRIMEIRA']);
	});

	it('admin de seccional: a árvore desce até o posto da delegacia; a de uma volta para antes', async () => {
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: 9100 });
		const arvore = await escopoDeUnidades(db, u);
		expect((arvore?.nos ?? []).map((n) => n.nome).sort()).toEqual([
			'DP PRIMEIRA',
			'DP SEGUNDA',
			'POSTO DA PRIMEIRA',
			'SECCIONAL NORTE'
		]);

		const { nomes } = await asDuas(u);
		expect(nomes, 'POSTO DA PRIMEIRA fica de fora da régua administrativa').toEqual([
			'DP PRIMEIRA',
			'DP SEGUNDA',
			'SECCIONAL NORTE'
		]);
	});
});
