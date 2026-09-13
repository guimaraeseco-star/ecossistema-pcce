/**
 * A árvore de unidades da fase 1 do Ecossistema (migração 0084, decisões E23 e
 * E24): departamento derivado de qualquer nó, subárvore como escopo, e a
 * caminhada que não trava em dado corrompido.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';
import { arvoreUnidades, ancestraisDe, subarvoreDe, departamentoDe } from '../unidades';
import { departamentoDoPlano } from '$lib/server/planos/departamento';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

async function inserir(
	nome: string,
	tipo: string,
	pai: number | null,
	extra: Partial<{
		sigla: string;
		abrangencia: 'departamental' | 'corporativa';
		ativo: boolean;
	}> = {}
): Promise<number> {
	const [l] = await db
		.insert(unidades)
		.values({
			nome,
			tipo: tipo as typeof unidades.$inferInsert.tipo,
			seccional_id: pai,
			sigla: extra.sigla ?? '',
			abrangencia: extra.abrangencia ?? 'departamental',
			ativo: extra.ativo ?? true
		})
		.returning({ id: unidades.id });
	return l.id;
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('árvore de unidades', () => {
	it('deriva o departamento de delegacia, seccional, subdepartamento e do próprio departamento', async () => {
		const raiz = await inserir('Delegacia-Geral', 'delegacia_geral', null, {
			abrangencia: 'corporativa'
		});
		const dpiNorte = await inserir('DPI Norte', 'departamento', raiz, { sigla: 'DPI NORTE' });
		const sub = await inserir('DPI Norte - Sobral', 'sub_departamento', dpiNorte);
		const secc = await inserir('1ª Seccional do Interior Norte', 'seccional', dpiNorte);
		const dp = await inserir('DP de Tianguá', 'delegacia', secc);
		const dpDoSub = await inserir('DP de Sobral', 'delegacia', sub);
		const arvore = await arvoreUnidades(db);

		for (const id of [dp, secc, sub, dpDoSub, dpiNorte]) {
			expect(departamentoDe(arvore, id)?.sigla).toBe('DPI NORTE');
		}
		expect(departamentoDe(arvore, raiz)).toBeNull();
	});

	it('departamento especializado liga delegacia direto a si, sem seccional', async () => {
		const dep = await inserir('Departamento de Polícia Especializada', 'departamento', null, {
			sigla: 'DPE'
		});
		const dp = await inserir('Delegacia de Proteção ao Turista', 'delegacia', dep);
		const arvore = await arvoreUnidades(db);
		expect(ancestraisDe(arvore, dp).map((u) => u.id)).toEqual([dep]);
		expect(departamentoDe(arvore, dp)?.sigla).toBe('DPE');
	});

	it('órgão corporativo não tem departamento e a raiz não tem ancestrais', async () => {
		const raiz = await inserir('Delegacia-Geral', 'delegacia_geral', null, {
			abrangencia: 'corporativa'
		});
		const cogep = await inserir('COGEP', 'coordenadoria', raiz, { abrangencia: 'corporativa' });
		const arvore = await arvoreUnidades(db);
		expect(ancestraisDe(arvore, raiz)).toEqual([]);
		expect(ancestraisDe(arvore, cogep).map((u) => u.nome)).toEqual(['Delegacia-Geral']);
		expect(departamentoDe(arvore, cogep)).toBeNull();
		expect(arvore.get(cogep)?.abrangencia).toBe('corporativa');
	});

	it('subárvore é a unidade e tudo abaixo — e ignora unidade desativada', async () => {
		const dep = await inserir('DPI Sul de teste', 'departamento', null, { sigla: 'DPIS-T' });
		const secc = await inserir('4ª Seccional do Interior Sul', 'seccional', dep);
		const dp1 = await inserir('DP de Iguatu', 'delegacia', secc);
		await inserir('DP desativada', 'delegacia', secc, { ativo: false });
		const outra = await inserir('DPI Norte', 'departamento', null);
		const arvore = await arvoreUnidades(db);
		const ids = subarvoreDe(arvore, dep)
			.map((u) => u.id)
			.sort();
		expect(ids).toEqual([dep, secc, dp1].sort());
		expect(ids).not.toContain(outra);
	});

	it('ciclo no dado não trava a caminhada', async () => {
		const a = await inserir('A', 'seccional', null);
		const b = await inserir('B', 'delegacia', a);
		await db.update(unidades).set({ seccional_id: b }).where(eq(unidades.id, a));
		const arvore = await arvoreUnidades(db);
		expect(ancestraisDe(arvore, b).map((u) => u.id)).toEqual([a]);
		expect(subarvoreDe(arvore, a).length).toBe(2);
	});

	it('departamentoDoPlano usa a unidade demandante e cai no padrão sem ela', async () => {
		// o banco migrado já traz o DPI SUL semeado (0006) como departamento padrão
		const dpiNorte = await inserir(
			'Departamento de Polícia do Interior Norte',
			'departamento',
			null,
			{ sigla: 'DPI NORTE' }
		);
		const dp = await inserir('DP de Tianguá', 'delegacia', dpiNorte);
		expect((await departamentoDoPlano(db, dp)).sigla).toBe('DPI NORTE');
		expect((await departamentoDoPlano(db)).sigla).toBe('DPI SUL');
		expect((await departamentoDoPlano(db, 999999)).sigla).toBe('DPI SUL');
	});
});
