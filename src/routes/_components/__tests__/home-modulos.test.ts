/**
 * Paridade entre a HOME DE MÓDULOS e a navegação lateral, mais as regras de
 * organização que o responsável fixou em 13/09/2026 (decisões E39–E42): os
 * quatro grupos, o que é planejado, o que só aparece de departamento para
 * cima e o que a conta admin com um módulo só NÃO pode ver.
 *
 * O teste que importa é o mesmo das boas-vindas: **home e menu oferecem os
 * MESMOS destinos**. `destinosDoMenu` (em `destinos-do-menu.ts`) reproduz o
 * markup da sidebar; um item novo na barra reprova aqui até ganhar cartão ou
 * atalho na home.
 */
import { describe, it, expect } from 'vitest';
import {
	gruposHome,
	destinosDaHome,
	temHomeDeModulos,
	moduloParaHome,
	gruposHomeDaPagina,
	type UsuarioDaHome
} from '../home-modulos';
import { destinosDoMenu, flagsDe, type ExtrasDeFlags, type Modulo } from './destinos-do-menu';

const POLICIAL: UsuarioDaHome = { tipo: 'policial', papel: null, cargo: 'OIP' };
const ADM_UNIDADE_OIP: UsuarioDaHome = { tipo: 'policial', papel: 'admin_unidade', cargo: 'OIP' };
const ADM_UNIDADE_DPC: UsuarioDaHome = { tipo: 'policial', papel: 'admin_unidade', cargo: 'DPC' };
const ADM_SECC_OIP: UsuarioDaHome = { tipo: 'policial', papel: 'admin_seccional', cargo: 'OIP' };
const ADM_SECC_DPC: UsuarioDaHome = { tipo: 'policial', papel: 'admin_seccional', cargo: 'DPC' };
const ADM_GERAL: UsuarioDaHome = { tipo: 'admin', papel: null, cargo: null };
const SUPER: UsuarioDaHome = { tipo: 'admin', papel: null, cargo: null, isSuperAdmin: true };

const CENARIOS: Array<{
	nome: string;
	usuario: UsuarioDaHome;
	modulo: Modulo;
	extra?: ExtrasDeFlags;
}> = [
	{ nome: 'admin de unidade (OIP)', usuario: ADM_UNIDADE_OIP, modulo: 'ambas' },
	{ nome: 'admin de unidade (DPC)', usuario: ADM_UNIDADE_DPC, modulo: 'ambas' },
	{
		nome: 'admin de unidade com base pendente',
		usuario: ADM_UNIDADE_OIP,
		modulo: 'ambas',
		extra: { temLinhaBasePendente: true }
	},
	{
		nome: 'admin de unidade DPC supervisor de GISE',
		usuario: ADM_UNIDADE_DPC,
		modulo: 'ambas',
		extra: { isSupervisorGise: true }
	},
	{ nome: 'admin de seccional (OIP)', usuario: ADM_SECC_OIP, modulo: 'ambas' },
	{ nome: 'admin de seccional (DPC)', usuario: ADM_SECC_DPC, modulo: 'ambas' },
	{
		nome: 'admin de seccional com presença e histórico',
		usuario: ADM_SECC_OIP,
		modulo: 'ambas',
		extra: { temPresencaGisePendente: true, temGiseHistorico: true }
	},
	// Para admin, o "módulo" da home é o que a conta tem LIGADO (moduloParaHome);
	// os três valores cobrem as três combinações de `modulosAdmin`.
	{ nome: 'Admin Geral — só escalas', usuario: ADM_GERAL, modulo: 'escalas' },
	{ nome: 'Admin Geral — só GISE', usuario: ADM_GERAL, modulo: 'gise' },
	{ nome: 'Admin Geral — ambos os módulos', usuario: ADM_GERAL, modulo: 'ambas' }
];

describe('home de módulos × navegação lateral', () => {
	for (const { nome, usuario, modulo, extra } of CENARIOS) {
		describe(nome, () => {
			const flags = flagsDe(usuario, modulo, extra);
			const grupos = gruposHome({ usuario, flags });
			const destinos = destinosDaHome(grupos);
			const menu = destinosDoMenu(usuario, flags);

			it('todo destino do menu é cartão ou atalho da home', () => {
				for (const d of menu) expect(destinos, `menu oferece ${d}`).toContain(d);
			});

			it('todo destino da home está na barra', () => {
				// A home só acrescenta a escala de FDS, que é filtro da tela de escalas.
				const soDaHome = destinos.filter((d) => !menu.includes(d));
				expect(soDaHome.every((d) => d.startsWith('/escalas?tipo=fds'))).toBe(true);
			});

			it('cada grupo tem a sua tela e um resumo do que contém', () => {
				for (const g of grupos) {
					expect(g.href).toBe(`/grupo/${g.id}`);
					expect(g.descricao.length).toBeGreaterThan(5);
				}
			});

			it('nenhum cartão duplicado', () => {
				const ids = grupos.flatMap((g) => g.cartoes.map((c) => c.id));
				expect(new Set(ids).size).toBe(ids.length);
			});

			it('todo cartão tem título, descrição e chamada', () => {
				for (const g of grupos) {
					for (const c of g.cartoes) {
						expect(c.titulo.length, `título de ${c.id}`).toBeGreaterThan(2);
						expect(c.descricao.length, `descrição de ${c.id}`).toBeGreaterThan(20);
						expect(c.cta.length, `cta de ${c.id}`).toBeGreaterThan(2);
					}
				}
			});

			it('os grupos saem na ordem fixada: pessoal, operacional, unidade, administrativa', () => {
				const ordem = ['pessoal', 'operacional', 'unidade', 'administrativa'];
				const ids = grupos.map((g) => g.id);
				expect(ids).toEqual(ordem.filter((o) => ids.includes(o as (typeof ids)[number])));
			});
		});
	}
});

describe('quem tem home de módulos', () => {
	it('sessão de admin e os dois papéis com escopo têm; policial comum, Super Admin e colaborador não', () => {
		expect(temHomeDeModulos(ADM_GERAL)).toBe(true);
		expect(temHomeDeModulos(ADM_UNIDADE_OIP)).toBe(true);
		expect(temHomeDeModulos(ADM_SECC_DPC)).toBe(true);
		expect(temHomeDeModulos(POLICIAL)).toBe(false);
		expect(temHomeDeModulos(SUPER)).toBe(false);
		expect(temHomeDeModulos({ tipo: 'colaborador' })).toBe(false);
		expect(temHomeDeModulos(null)).toBe(false);
	});

	it('quem não tem home recebe lista vazia', () => {
		expect(gruposHome({ usuario: POLICIAL, flags: flagsDe(POLICIAL, 'ambas') })).toEqual([]);
		expect(gruposHome({ usuario: SUPER, flags: flagsDe(SUPER, 'ambas') })).toEqual([]);
		expect(gruposHome({ usuario: null, flags: flagsDe(POLICIAL, 'ambas') })).toEqual([]);
	});
});

describe('o módulo da home segue o que a conta admin tem ligado, não a preferência de tela', () => {
	it('os dois ligados → ambas; um só → aquele; sem registro → ambas', () => {
		expect(moduloParaHome({ ...ADM_GERAL, modulosAdmin: { escalas: true, gise: true } })).toBe(
			'ambas'
		);
		expect(moduloParaHome({ ...ADM_GERAL, modulosAdmin: { escalas: true, gise: false } })).toBe(
			'escalas'
		);
		expect(moduloParaHome({ ...ADM_GERAL, modulosAdmin: { escalas: false, gise: true } })).toBe(
			'gise'
		);
		expect(moduloParaHome(ADM_GERAL)).toBe('ambas');
		expect(moduloParaHome(ADM_SECC_OIP)).toBe('ambas');
	});

	it('admin só de escalas não vê cartão de GISE; admin só de GISE não vê escalas ordinárias', () => {
		const soEscalas = gruposHomeDaPagina(
			{ ...ADM_GERAL, modulosAdmin: { escalas: true, gise: false } },
			{}
		);
		const destinosEscalas = destinosDaHome(soEscalas);
		expect(destinosEscalas).toContain('/painel');
		expect(destinosEscalas).not.toContain('/operacoes/gise');
		expect(destinosEscalas).not.toContain('/operacoes/planos');

		const soGise = gruposHomeDaPagina(
			{ ...ADM_GERAL, modulosAdmin: { escalas: false, gise: true } },
			{}
		);
		const destinosGise = destinosDaHome(soGise);
		expect(destinosGise).toContain('/operacoes/gise');
		expect(destinosGise).not.toContain('/painel');
		expect(destinosGise).not.toContain('/recebidos');
	});
});

describe('a organização fixada em 13/09/2026', () => {
	const flagsGeral = flagsDe(ADM_GERAL, 'ambas');
	const geral = gruposHome({ usuario: ADM_GERAL, flags: flagsGeral });
	const unidade = gruposHome({
		usuario: ADM_UNIDADE_OIP,
		flags: flagsDe(ADM_UNIDADE_OIP, 'ambas')
	});

	const idsDe = (grupos: typeof geral, grupo: string) =>
		grupos.find((g) => g.id === grupo)?.cartoes.map((c) => c.id) ?? [];

	it('E39: Diárias, Extras e Atualização de valores ficam em Gestão de pessoal', () => {
		const pessoal = idsDe(geral, 'pessoal');
		expect(pessoal).toEqual(
			expect.arrayContaining(['servidores', 'escalas', 'diarias', 'extras', 'valores'])
		);
	});

	it('E39: Atualização de valores e Municípios são de departamento para cima', () => {
		expect(idsDe(geral, 'pessoal')).toContain('valores');
		expect(idsDe(geral, 'administrativa')).toContain('municipios');
		expect(idsDe(unidade, 'pessoal')).not.toContain('valores');
		expect(idsDe(unidade, 'administrativa')).not.toContain('municipios');
	});

	it('E40: Armamento e Veículos em Gestão operacional; Patrimônio móvel em Gestão administrativa', () => {
		expect(idsDe(geral, 'operacional')).toEqual(expect.arrayContaining(['armamento', 'veiculos']));
		expect(idsDe(geral, 'administrativa')).toContain('patrimonio-movel');
		// "para todos" = todos os NÍVEIS veem os seus (E42): a delegacia também os tem.
		expect(idsDe(unidade, 'operacional')).toEqual(
			expect.arrayContaining(['armamento', 'veiculos'])
		);
	});

	it('E41: Protocolo e Ofício não entram — futuros sem definição', () => {
		const todos = geral.flatMap((g) => g.cartoes.map((c) => c.titulo.toLowerCase()));
		expect(todos.some((t) => t.includes('protocolo') || t.includes('ofício'))).toBe(false);
	});

	it('cartão planejado vem desligado (sem href) e diz "Em breve"', () => {
		for (const g of geral) {
			for (const c of g.cartoes) {
				if (c.href === null) {
					expect(c.cta).toBe('Em breve');
					expect(c.atalhos).toEqual([]);
					expect(c.fase).toBeGreaterThan(0);
				}
			}
		}
		expect(geral.flatMap((g) => g.cartoes).some((c) => c.href === null)).toBe(true);
	});

	it('Gestão de unidade: um cartão só, com o rótulo do nível', () => {
		expect(geral.find((g) => g.id === 'unidade')?.cartoes.map((c) => c.titulo)).toEqual([
			'Departamento'
		]);
		expect(unidade.find((g) => g.id === 'unidade')?.cartoes.map((c) => c.titulo)).toEqual([
			'Minha delegacia'
		]);
		const secc = gruposHome({ usuario: ADM_SECC_OIP, flags: flagsDe(ADM_SECC_OIP, 'ambas') });
		expect(secc.find((g) => g.id === 'unidade')?.cartoes.map((c) => c.titulo)).toEqual([
			'Minha seccional'
		]);
	});

	it('o verbo do cartão de escalas segue o cargo, como o servidor', () => {
		const dpc = gruposHome({ usuario: ADM_UNIDADE_DPC, flags: flagsDe(ADM_UNIDADE_DPC, 'ambas') })
			.flatMap((g) => g.cartoes)
			.find((c) => c.id === 'escalas');
		const oip = unidade.flatMap((g) => g.cartoes).find((c) => c.id === 'escalas');
		// DPC assina (podeAssinarEscala); OIP monta e PEDE a assinatura
		// (podeOIPSolicitarAssinatura) — server/escalas/permissao.ts.
		expect(dpc?.descricao).toMatch(/assine/i);
		expect(oip?.descricao).toMatch(/pe(ç|c)a .* assinatura/i);
	});

	it('a escala de fim de semana vai junto da escala extra, como atalho de quem monta escala', () => {
		const extra = unidade.flatMap((g) => g.cartoes).find((c) => c.id === 'escala-extra');
		// admin de unidade não vê GISE (showGise) — o atalho aparece no de seccional
		expect(extra).toBeUndefined();
		const secc = gruposHome({ usuario: ADM_SECC_OIP, flags: flagsDe(ADM_SECC_OIP, 'ambas') });
		const extraSecc = secc.flatMap((g) => g.cartoes).find((c) => c.id === 'escala-extra');
		expect(extraSecc?.atalhos.map((a) => a.href)).toContain('/escalas?tipo=fds');
		// o Admin Geral não monta escala: sem o atalho
		const extraGeral = geral.flatMap((g) => g.cartoes).find((c) => c.id === 'escala-extra');
		expect(extraGeral?.atalhos.map((a) => a.href)).not.toContain('/escalas?tipo=fds');
		expect(extraGeral?.atalhos.map((a) => a.href)).toContain('/operacoes/gise/finalizadas');
	});

	it('o resumo do cartão grande segue o que o perfil alcança', () => {
		const pessoalGeral = geral.find((g) => g.id === 'pessoal');
		expect(pessoalGeral?.descricao).toBe(
			'Servidores, Escalas ordinárias, Diárias, Extras, Atualização de valores'
		);
		expect(geral.find((g) => g.id === 'unidade')?.descricao).toBe(
			'Vê os dados da unidade e vinculadas'
		);
		expect(geral.find((g) => g.id === 'administrativa')?.titulo).toBe('Gestão administrativa');
		// admin de unidade não tem Solicitações nem Valores: o resumo não os promete
		expect(unidade.find((g) => g.id === 'pessoal')?.descricao).not.toMatch(/valores/i);
	});

	it('sessão de admin não recebe "Meu perfil" (não tem cadastro de policial)', () => {
		expect(destinosDaHome(geral)).not.toContain('/perfil');
		expect(destinosDaHome(unidade)).toContain('/perfil');
	});
});
