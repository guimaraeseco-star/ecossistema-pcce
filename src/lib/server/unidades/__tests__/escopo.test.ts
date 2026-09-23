/**
 * O ESCOPO de unidades (E65 + E71), contra SQLite real.
 *
 * Duas coisas se provam aqui, e as duas mudaram em 23/09:
 *
 * 1. A raiz do admin é o NÓ da conta (`administradores.unidade_id`) e não mais
 *    o departamento inferido da lotação do policial vinculado. Conta sem nó
 *    não administra unidade nenhuma — e isso é resposta, não defeito.
 * 2. O CHAPÉU (E71) encolhe a árvore: no de unidade só a casa (o nó e as suas
 *    subunidades), no de rede a subárvore inteira. O corte é por TIPO — um
 *    núcleo pendurado no departamento é casa, uma seccional não é —, e é
 *    exatamente isso que este arquivo trava.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { escopoDeUnidades, unidadeNoEscopo } from '../escopo';
import type { UsuarioLogado } from '$lib/auth';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const DEP = 93000;
const NUCLEO = 93001;
const SECCIONAL = 93002;
const DELEGACIA = 93003;
const POSTO = 93004;

const admin = (over: Record<string, unknown> = {}) =>
	({ id: 1, tipo: 'admin', nome: 'Admin', primeiro_acesso: false, ...over }) as UsuarioLogado;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo, seccional_id) VALUES
			(${DEP}, 'DEP DE TESTE', 'departamento', NULL),
			(${NUCLEO}, 'NUCLEO DO DEP', 'nucleo', ${DEP}),
			(${SECCIONAL}, 'SECCIONAL DO DEP', 'seccional', ${DEP}),
			(${DELEGACIA}, 'DELEGACIA DA SECCIONAL', 'delegacia', ${SECCIONAL}),
			(${POSTO}, 'POSTO DA DELEGACIA', 'unidade', ${DELEGACIA});
	`);
});

const nomes = async (u: UsuarioLogado) => {
	const e = await escopoDeUnidades(db, u);
	return (e?.nos ?? []).map((n) => n.nome).sort();
};

describe('escopoDeUnidades para a sessão admin', () => {
	it('no chapéu de REDE alcança a subárvore inteira do nó', async () => {
		expect(await nomes(admin({ unidade_id: DEP, atuandoComo: 'rede' }))).toEqual([
			'DELEGACIA DA SECCIONAL',
			'DEP DE TESTE',
			'NUCLEO DO DEP',
			'POSTO DA DELEGACIA',
			'SECCIONAL DO DEP'
		]);
	});

	it('no chapéu de UNIDADE alcança só a casa — o nó e as subunidades dele', async () => {
		const escopo = await escopoDeUnidades(db, admin({ unidade_id: DEP, atuandoComo: 'unidade' }));
		expect((escopo?.nos ?? []).map((n) => n.nome).sort()).toEqual([
			'DEP DE TESTE',
			'NUCLEO DO DEP'
		]);
		// A seccional pende do mesmo nó e NÃO é casa: quem a administra é o
		// chapéu de rede. É o corte por tipo, e não por profundidade.
		expect(unidadeNoEscopo(escopo!, SECCIONAL)).toBe(false);
		// E o posto da delegacia, que é subunidade de OUTRA casa, também não entra.
		expect(unidadeNoEscopo(escopo!, POSTO)).toBe(false);
	});

	it('sem chapéu declarado vale o de rede — é o comportamento de sempre', async () => {
		expect(await nomes(admin({ unidade_id: DEP }))).toHaveLength(5);
	});

	it('conta admin SEM nó não administra unidade nenhuma (E65)', async () => {
		expect(await escopoDeUnidades(db, admin())).toBeNull();
	});

	it('nó que não existe mais também devolve nada, em vez de adivinhar', async () => {
		expect(await escopoDeUnidades(db, admin({ unidade_id: 987654 }))).toBeNull();
	});
});
