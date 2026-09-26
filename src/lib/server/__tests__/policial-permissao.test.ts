/**
 * Escopo administrativo sobre o cadastro (`lotacoesAdministradas`) contra um
 * SQLite REAL com todas as migrações aplicadas — mesmo harness de
 * `sync-estado.test.ts` e `schema-x-migracoes.test.ts`.
 *
 * Este helper decide QUEM um admin pode administrar, e é consumido por 7 pontos
 * (listagem e edição de policiais, permissão de escala, solicitação de
 * assinatura). Até aqui só existia cobertura INDIRETA, com ele
 * mockado (`escalas/__tests__/permissao.test.ts`) — ou seja, nada verificava a
 * query de expansão da seccional em si. Um erro nela abriria ou fecharia escopo
 * silenciosamente, sem quebrar teste nenhum.
 *
 * A distinção que mais importa aqui é `null` × `Set` vazio: `null` significa
 * "sem restrição" e `lotacaoNoEscopo` devolve `true` para qualquer lotação;
 * `Set` vazio significa "não administra nada" e devolve sempre `false`.
 * Trocar um pelo outro inverte o gate.
 *
 * Desde a E65 (23/09) o `null` é só do **Super Admin**: a sessão de Admin
 * Geral passou a ter o recorte do NÓ da conta (`administradores.unidade_id`),
 * e o chapéu de unidade (E71) encolhe esse recorte à casa. Os três casos estão
 * cobertos abaixo, porque é aqui que um deles vira o outro por engano.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import {
	lotacoesAdministradas,
	lotacaoNoEscopo,
	motivoParaRecusarPapel
} from '../policial-permissao';
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

beforeAll(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);

	// Duas seccionais com delegacias próprias: é o que prova que a expansão não
	// vaza de uma seccional para a outra. Ids 9xxx porque as migrações já semeiam
	// as unidades 1 e 2.
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo, seccional_id) VALUES
			(9300, 'DEP DE TESTE', 'departamento', NULL),
			(9301, 'POSTO DO DEP', 'unidade', 9300),
			(9100, 'SECCIONAL NORTE', 'seccional', 9300),
			(9101, 'DP PRIMEIRA', 'delegacia', 9100),
			(9102, 'DP SEGUNDA', 'delegacia', 9100),
			(9200, 'SECCIONAL SUL', 'seccional', NULL),
			(9201, 'DP TERCEIRA', 'delegacia', 9200);
	`);
});

describe('lotacoesAdministradas', () => {
	it('Super Admin recebe null — "sem restrição", não "escopo vazio"', async () => {
		const escopo = await lotacoesAdministradas(db, usuario({ tipo: 'admin', isSuperAdmin: true }));
		expect(escopo).toBeNull();
		// É esta a consequência prática do null, e o que o distingue do Set vazio.
		expect(lotacaoNoEscopo(escopo, 'QUALQUER UNIDADE')).toBe(true);
	});

	it('Admin Geral administra a subárvore do NÓ da conta, e nada fora dela (E65)', async () => {
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ tipo: 'admin', unidade_id: 9300, atuandoComo: 'rede' })
		);
		expect([...(escopo ?? [])].sort()).toEqual(
			['DEP DE TESTE', 'POSTO DO DEP', 'SECCIONAL NORTE', 'DP PRIMEIRA', 'DP SEGUNDA'].sort()
		);
		// A seccional do outro ramo não entra: é o que o `null` de antes deixava passar.
		expect(lotacaoNoEscopo(escopo, 'SECCIONAL SUL')).toBe(false);
	});

	it('no chapéu de UNIDADE alcança só a casa — o nó e as subunidades (E71)', async () => {
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ tipo: 'admin', unidade_id: 9300, atuandoComo: 'unidade' })
		);
		expect([...(escopo ?? [])].sort()).toEqual(['DEP DE TESTE', 'POSTO DO DEP']);
		// A delegacia que o departamento administra pela REDE fica de fora.
		expect(lotacaoNoEscopo(escopo, 'DP PRIMEIRA')).toBe(false);
	});

	it('conta admin SEM nó não administra nada — o bootstrap por env caiu nisso (E65)', async () => {
		const escopo = await lotacoesAdministradas(db, usuario({ tipo: 'admin' }));
		expect(escopo).not.toBeNull();
		expect(escopo?.size).toBe(0);
		expect(lotacaoNoEscopo(escopo, 'DP PRIMEIRA')).toBe(false);
	});

	it('admin_seccional administra a seccional e as unidades abaixo dela', async () => {
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ papel: 'admin_seccional', papel_unidade_id: 9100 })
		);
		expect(escopo).not.toBeNull();
		expect([...escopo!].sort()).toEqual(['DP PRIMEIRA', 'DP SEGUNDA', 'SECCIONAL NORTE']);
		expect(lotacaoNoEscopo(escopo, 'DP PRIMEIRA')).toBe(true);
		expect(lotacaoNoEscopo(escopo, 'DP TERCEIRA')).toBe(false);
	});

	it('admin_seccional SEM papel_unidade_id não administra nada', async () => {
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ papel: 'admin_seccional', papel_unidade_id: null })
		);
		expect(escopo).toEqual(new Set());
		expect(lotacaoNoEscopo(escopo, 'SECCIONAL NORTE')).toBe(false);
	});

	it('admin_unidade administra a unidade do PAPEL, não a lotação', async () => {
		// Até ago/2026 o escopo vinha de `u.lotacao`, e o `papel_unidade_id` — que
		// a concessão exige e persiste — era ignorado (FLW-RBAC-003).
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ papel: 'admin_unidade', lotacao: 'DP SEGUNDA', papel_unidade_id: 9101 })
		);
		expect(escopo).toEqual(new Set(['DP PRIMEIRA']));
		expect(lotacaoNoEscopo(escopo, 'DP SEGUNDA'), 'a lotação atual não dá escopo').toBe(false);
	});

	it('TRANSFERIR o admin não move o escopo junto', async () => {
		// O caso que o achado descreve: nomeado administrador da DP PRIMEIRA e
		// depois transferido para a DP TERCEIRA. Com o escopo vindo da lotação, ele
		// passava a administrar a DP TERCEIRA — autoridade que ninguém concedeu, e
		// que aparece sozinha numa movimentação de rotina.
		const antes = usuario({
			papel: 'admin_unidade',
			lotacao: 'DP PRIMEIRA',
			papel_unidade_id: 9101
		});
		const depoisDaTransferencia = { ...antes, lotacao: 'DP TERCEIRA' };

		expect(await lotacoesAdministradas(db, antes)).toEqual(new Set(['DP PRIMEIRA']));
		expect(await lotacoesAdministradas(db, depoisDaTransferencia)).toEqual(
			new Set(['DP PRIMEIRA'])
		);
	});

	it('admin_unidade SEM papel_unidade_id não administra nada', async () => {
		// Cair na lotação aqui é exatamente o defeito — papel sem unidade é papel
		// sem alcance, e a concessão já recusa criá-lo assim.
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ papel: 'admin_unidade', lotacao: 'DP PRIMEIRA', papel_unidade_id: null })
		);
		expect(escopo).toEqual(new Set());
	});

	it('papel_unidade_id INEXISTENTE dá escopo vazio, não escopo largo', async () => {
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ papel: 'admin_unidade', lotacao: 'DP PRIMEIRA', papel_unidade_id: 999999 })
		);
		expect(escopo).toEqual(new Set());
		expect(lotacaoNoEscopo(escopo, 'DP PRIMEIRA')).toBe(false);
	});

	it('policial sem papel administrativo não administra nada', async () => {
		const escopo = await lotacoesAdministradas(
			db,
			usuario({ papel: null, lotacao: 'DP PRIMEIRA' })
		);
		expect(escopo).toEqual(new Set());
		expect(lotacaoNoEscopo(escopo, 'DP PRIMEIRA')).toBe(false);
	});
});

/**
 * A validação da concessão — FLW-RBAC-003, segunda metade.
 *
 * `papel_unidade_id` era exigido pela tela mas nunca validado. Um id
 * inexistente produzia escopo vazio SILENCIOSO: o admin é nomeado, a tela
 * mostra o papel, e ele não administra nada — e ninguém liga uma coisa à outra.
 */
describe('motivoParaRecusarPapel', () => {
	it('aceita seccional para admin_seccional', async () => {
		expect(await motivoParaRecusarPapel(db, 'admin_seccional', 9100)).toBeNull();
	});

	it('aceita delegacia para admin_unidade', async () => {
		expect(await motivoParaRecusarPapel(db, 'admin_unidade', 9101)).toBeNull();
	});

	it('recusa unidade inexistente', async () => {
		const r = await motivoParaRecusarPapel(db, 'admin_unidade', 999999);
		expect(r).toContain('não existe');
	});

	it('recusa DELEGACIA para admin_seccional', async () => {
		// Delegacia não tem unidades subordinadas: o papel não teria o alcance que
		// o nome promete, e o escopo resultante seria o de `admin_unidade`.
		const r = await motivoParaRecusarPapel(db, 'admin_seccional', 9101);
		expect(r).toContain('DP PRIMEIRA');
		expect(r).toContain('Admin de Unidade');
	});
});
