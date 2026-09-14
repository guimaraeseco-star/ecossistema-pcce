/**
 * Paridade entre os quadros de boas-vindas e a navegação lateral.
 *
 * O teste que importa aqui não é "o card tem o texto X" — é **card e menu
 * oferecem os MESMOS destinos**. Foi a ausência dele que deixou admin de
 * unidade sem "Produtividade", ninguém com "Dados base" e o Admin Geral de
 * módulo "ambas" com 4 cards para 7 destinos de menu.
 *
 * Desde a fase 1 do Ecossistema os perfis administrativos entram pela home de
 * módulos (`home-modulos.test.ts` cobre a paridade deles); aqui ficam os que
 * ainda têm tela de boas-vindas — policial sem papel e Super Admin — e a
 * garantia de que `cardsBemVindo` NÃO responde pelos administrativos.
 *
 * `destinosDoMenu` (em `destinos-do-menu.ts`) reproduz o markup da sidebar;
 * `itensExtraDoMenu` é a função de verdade, não uma cópia. Mudou o menu, este
 * arquivo reprova até o card acompanhar.
 */
import { describe, it, expect } from 'vitest';
import { cardsBemVindo, type UsuarioDosCards } from '../bem-vindo-cards';
import { destinosDoMenu, flagsDe, type ExtrasDeFlags, type Modulo } from './destinos-do-menu';

const POLICIAL: UsuarioDosCards = { tipo: 'policial', papel: null, cargo: 'OIP' };
const ADM_UNIDADE_OIP: UsuarioDosCards = { tipo: 'policial', papel: 'admin_unidade', cargo: 'OIP' };
const ADM_SECC_DPC: UsuarioDosCards = { tipo: 'policial', papel: 'admin_seccional', cargo: 'DPC' };
const ADM_GERAL: UsuarioDosCards = { tipo: 'admin', papel: null, cargo: null };
const SUPER: UsuarioDosCards = { tipo: 'admin', papel: null, cargo: null, isSuperAdmin: true };

/** Os cenários medidos no navegador na auditoria de ago/2026 que ainda passam por aqui. */
const CENARIOS: Array<{
	nome: string;
	usuario: UsuarioDosCards;
	modulo: Modulo;
	extra?: ExtrasDeFlags;
}> = [
	{ nome: 'policial comum', usuario: POLICIAL, modulo: 'ambas' },
	{
		nome: 'membro GISE (presença pendente)',
		usuario: POLICIAL,
		modulo: 'ambas',
		extra: { temPresencaGisePendente: true }
	},
	{
		nome: 'supervisor GISE',
		usuario: POLICIAL,
		modulo: 'ambas',
		extra: { isSupervisorGise: true, temPresencaGisePendente: true }
	},
	{
		nome: 'policial com histórico GISE',
		usuario: POLICIAL,
		modulo: 'ambas',
		extra: { temGiseHistorico: true }
	},
	{
		nome: 'policial com base pendente (flag vem do servidor)',
		usuario: POLICIAL,
		modulo: 'ambas',
		extra: { temLinhaBasePendente: true }
	},
	{ nome: 'Super Admin', usuario: SUPER, modulo: 'ambas' }
];

describe('cards de boas-vindas × navegação lateral', () => {
	for (const { nome, usuario, modulo, extra } of CENARIOS) {
		describe(nome, () => {
			const flags = flagsDe(usuario, modulo, extra);
			const cards = cardsBemVindo({ usuario, flags });
			const hrefs = cards.map((c) => c.href);
			// `/unidade` é de perfil administrativo; o espelho da barra só o lista
			// para quem tem `showUnidade`, que nenhum destes tem.
			const menu = destinosDoMenu(usuario, flags);

			it('todo destino do menu tem card', () => {
				expect([...menu].sort()).toEqual([...new Set(hrefs)].sort());
			});

			it('nenhum card duplicado', () => {
				expect(new Set(hrefs).size).toBe(hrefs.length);
			});

			it('todo card tem título, descrição e chamada', () => {
				for (const c of cards) {
					expect(c.titulo.length, `título de ${c.href}`).toBeGreaterThan(2);
					expect(c.descricao.length, `descrição de ${c.href}`).toBeGreaterThan(20);
					expect(c.cta.length, `cta de ${c.href}`).toBeGreaterThan(2);
				}
			});
		});
	}

	it('Super Admin não recebe as abas operacionais do dia a dia', () => {
		const flags = flagsDe(SUPER, 'ambas');
		const hrefs = cardsBemVindo({ usuario: SUPER, flags }).map((c) => c.href);
		expect(hrefs).not.toContain('/escalas');
		expect(hrefs).not.toContain('/gise');
		expect(hrefs).not.toContain('/perfil');
	});

	it('perfis administrativos não recebem card aqui — a entrada deles é a home de módulos', () => {
		for (const u of [ADM_GERAL, ADM_UNIDADE_OIP, ADM_SECC_DPC]) {
			expect(cardsBemVindo({ usuario: u, flags: flagsDe(u, 'ambas') })).toEqual([]);
		}
	});

	it('colaborador não recebe card nenhum', () => {
		const u: UsuarioDosCards = { tipo: 'colaborador' };
		expect(cardsBemVindo({ usuario: u, flags: flagsDe(u, 'ambas') })).toEqual([]);
	});

	it('usuário sem sessão não recebe card nenhum', () => {
		expect(cardsBemVindo({ usuario: null, flags: flagsDe(POLICIAL, 'ambas') })).toEqual([]);
	});
});
