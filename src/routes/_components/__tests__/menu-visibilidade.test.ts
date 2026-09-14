/**
 * A regra do menu, verificada.
 *
 * Cada bloco abaixo cobre um caso que até ago/2026 existia SÓ como comentário
 * dentro de `+layout.svelte` — e comentário não reprova mudança errada. O
 * cabeçalho do layout dizia, em prosa, que a visibilidade cruza dois eixos que
 * não se implicam; era exatamente isso que ninguém conseguia rodar.
 *
 * Nada aqui é teste de autorização: a sidebar esconde, o `load` de cada rota é
 * que barra. Estes testes protegem a EXPERIÊNCIA (item certo, para a pessoa
 * certa), não o acesso.
 */
import { describe, it, expect } from 'vitest';
import {
	visibilidadeDoMenu,
	itensExtraDoMenu,
	rotaAtiva,
	type EntradaVisibilidade
} from '../menu-visibilidade';

/** Sessão mínima: policial comum, sem papel, sem nada de GISE. */
function entrada(over: Partial<EntradaVisibilidade> = {}): EntradaVisibilidade {
	return {
		usuario: { tipo: 'policial', papel: null },
		adminModulo: 'ambas',
		isSupervisorGise: false,
		temLinhaBasePendente: false,
		temPresencaGisePendente: false,
		temGiseHistorico: false,
		...over
	};
}

const url = (s: string) => new URL(s, 'https://exemplo.test');

describe('eixo QUEM é a pessoa', () => {
	it('Admin Geral é quem tem sessão tipo admin', () => {
		expect(visibilidadeDoMenu(entrada({ usuario: { tipo: 'admin' } })).isAdmGeral).toBe(true);
		expect(visibilidadeDoMenu(entrada()).isAdmGeral).toBe(false);
	});

	it('a aba Arquivo é dos DOIS papéis de unidade — e não do Admin Geral', () => {
		const papeis = ['admin_seccional', 'admin_unidade'] as const;
		for (const papel of papeis) {
			expect(
				visibilidadeDoMenu(entrada({ usuario: { tipo: 'policial', papel } })).showEscalasPoliciais
			).toBe(true);
		}
		expect(visibilidadeDoMenu(entrada({ usuario: { tipo: 'admin' } })).showEscalasPoliciais).toBe(
			false
		);
		expect(visibilidadeDoMenu(entrada()).showEscalasPoliciais).toBe(false);
	});

	it('GISE aceita supervisor ativo mesmo sem papel de admin', () => {
		expect(visibilidadeDoMenu(entrada({ isSupervisorGise: true })).showGise).toBe(true);
		expect(visibilidadeDoMenu(entrada()).showGise).toBe(false);
	});

	it('admin_unidade só vê GISE se também for supervisor', () => {
		const papel = { tipo: 'policial', papel: 'admin_unidade' } as const;
		expect(visibilidadeDoMenu(entrada({ usuario: papel })).showGise).toBe(false);
		expect(visibilidadeDoMenu(entrada({ usuario: papel, isSupervisorGise: true })).showGise).toBe(
			true
		);
	});

	/**
	 * O caso que o comentário do layout marcava como deliberado: quem alimenta o
	 * denominador de uma meta precisa ver o resultado dela.
	 */
	it('Produtividade inclui admin_unidade, que showGise NÃO cobre', () => {
		const flags = visibilidadeDoMenu(
			entrada({ usuario: { tipo: 'policial', papel: 'admin_unidade' } })
		);
		expect(flags.showIndicadores).toBe(true);
		expect(flags.showGise).toBe(false);
	});

	it('policial comum não vê Produtividade', () => {
		expect(visibilidadeDoMenu(entrada()).showIndicadores).toBe(false);
	});
});

/**
 * Pedir e decidir deixaram de ser o mesmo ato em ago/2026, e a navegação
 * acompanhou: as duas flags saíram de uma condição só (`isAdmGeral`).
 *
 * O caso que este bloco protege é a fusão de volta — juntar as duas outra vez
 * ou dá ao admin de unidade a fila de decisão do Admin Geral (ele aprovaria os
 * próprios pedidos, que é o ponto inteiro do fluxo), ou tira dele o cadastro,
 * que é a única porta por onde ele pede qualquer coisa.
 */
describe('Policiais e Solicitações são perguntas diferentes', () => {
	const PAPEIS_COM_ESCOPO = ['admin_seccional', 'admin_unidade'] as const;

	it('os três papéis administrativos veem o cadastro', () => {
		expect(visibilidadeDoMenu(entrada({ usuario: { tipo: 'admin' } })).showPoliciais).toBe(true);
		for (const papel of PAPEIS_COM_ESCOPO) {
			expect(
				visibilidadeDoMenu(entrada({ usuario: { tipo: 'policial', papel } })).showPoliciais,
				papel
			).toBe(true);
		}
	});

	it('policial sem papel não vê o cadastro', () => {
		expect(visibilidadeDoMenu(entrada()).showPoliciais).toBe(false);
	});

	it('só o Admin Geral vê a fila de decisão', () => {
		expect(visibilidadeDoMenu(entrada({ usuario: { tipo: 'admin' } })).showSolicitacoes).toBe(true);
		for (const papel of PAPEIS_COM_ESCOPO) {
			expect(
				visibilidadeDoMenu(entrada({ usuario: { tipo: 'policial', papel } })).showSolicitacoes,
				papel
			).toBe(false);
		}
		expect(visibilidadeDoMenu(entrada()).showSolicitacoes).toBe(false);
	});

	it('Colaboradores é SÓ do Admin Geral — os papéis com escopo não criam identidade', () => {
		// A flag não acompanha `showPoliciais` de propósito: administrar servidor
		// já cadastrado (o que o escopo permite) é outra coisa que criar uma conta
		// de acesso ao sistema. O Super Admin entra por aqui por ser `tipo: 'admin'`.
		expect(visibilidadeDoMenu(entrada({ usuario: { tipo: 'admin' } })).showColaboradores).toBe(
			true
		);
		for (const papel of PAPEIS_COM_ESCOPO) {
			expect(
				visibilidadeDoMenu(entrada({ usuario: { tipo: 'policial', papel } })).showColaboradores,
				papel
			).toBe(false);
		}
		expect(visibilidadeDoMenu(entrada()).showColaboradores).toBe(false);
		expect(
			visibilidadeDoMenu(entrada({ usuario: { tipo: 'colaborador' } })).showColaboradores
		).toBe(false);
	});

	it('Atualização de valores é de departamento para cima — só a sessão de admin', () => {
		expect(visibilidadeDoMenu(entrada({ usuario: { tipo: 'admin' } })).showValores).toBe(true);
		for (const papel of PAPEIS_COM_ESCOPO) {
			expect(
				visibilidadeDoMenu(entrada({ usuario: { tipo: 'policial', papel } })).showValores,
				papel
			).toBe(false);
		}
		expect(visibilidadeDoMenu(entrada()).showValores).toBe(false);
	});

	it('Gestão de unidade é dos três papéis administrativos — cada um com a própria subárvore', () => {
		expect(visibilidadeDoMenu(entrada({ usuario: { tipo: 'admin' } })).showUnidade).toBe(true);
		for (const papel of PAPEIS_COM_ESCOPO) {
			expect(
				visibilidadeDoMenu(entrada({ usuario: { tipo: 'policial', papel } })).showUnidade,
				papel
			).toBe(true);
		}
		expect(visibilidadeDoMenu(entrada()).showUnidade).toBe(false);
		expect(visibilidadeDoMenu(entrada({ usuario: { tipo: 'colaborador' } })).showUnidade).toBe(
			false
		);
	});
});

describe('Dados base não segue Produtividade', () => {
	/**
	 * Quem responde é o servidor (`temLinhaBaseAPreencher`), porque a pergunta
	 * depende de escala e de modelo. Antes o item aparecia para todo admin de
	 * unidade — inclusive os de delegacias fora de qualquer operação, que abriam
	 * uma tela vazia sem entender por quê.
	 */
	it('admin de unidade COM Produtividade mas SEM base pendente não vê Dados base', () => {
		const flags = visibilidadeDoMenu(
			entrada({ usuario: { tipo: 'policial', papel: 'admin_unidade' } })
		);
		expect(flags.showIndicadores).toBe(true);
		expect(flags.showDadosBase).toBe(false);
	});

	it('aparece exatamente quando o servidor diz que há base pendente', () => {
		expect(visibilidadeDoMenu(entrada({ temLinhaBasePendente: true })).showDadosBase).toBe(true);
	});
});

describe('eixo QUAL MÓDULO — só existe para admin', () => {
	/** O caso que o cabeçalho do layout explicava e nada verificava. */
	it('não-admin vê os dois grupos, qualquer que seja o adminModulo', () => {
		for (const adminModulo of ['ambas', 'gise', 'escalas'] as const) {
			const flags = visibilidadeDoMenu(entrada({ adminModulo }));
			expect(flags.showGrupo1, `grupo1 com adminModulo=${adminModulo}`).toBe(true);
			expect(flags.showGrupo2, `grupo2 com adminModulo=${adminModulo}`).toBe(true);
		}
	});

	it('admin em módulo "escalas" perde o grupo da GISE, e vice-versa', () => {
		const admin = { tipo: 'admin' } as const;
		const escalas = visibilidadeDoMenu(entrada({ usuario: admin, adminModulo: 'escalas' }));
		expect(escalas.showGrupo1).toBe(true);
		expect(escalas.showGrupo2).toBe(false);

		const gise = visibilidadeDoMenu(entrada({ usuario: admin, adminModulo: 'gise' }));
		expect(gise.showGrupo1).toBe(false);
		expect(gise.showGrupo2).toBe(true);
	});
});

describe('itens do submenu "Escala extra"', () => {
	it('some inteiro quando o grupo da GISE está desligado', () => {
		const flags = visibilidadeDoMenu(
			entrada({ usuario: { tipo: 'admin' }, adminModulo: 'escalas' })
		);
		expect(itensExtraDoMenu(flags, url('/operacoes/produtividade'))).toEqual([]);
	});

	it('lista só o que o usuário vê', () => {
		const flags = visibilidadeDoMenu(entrada({ isSupervisorGise: true }));
		const hrefs = itensExtraDoMenu(flags, url('/operacoes/gise')).map((i) => i.href);
		expect(hrefs).toEqual(['/operacoes/gise']);
	});

	it('/operacoes/gise acende na lista e na escala, mas não em /operacoes/gise/operacoes nem /operacoes/gise/finalizadas', () => {
		const flags = visibilidadeDoMenu(entrada({ isSupervisorGise: true }));
		const ativoEm = (p: string) =>
			itensExtraDoMenu(flags, url(p)).find((i) => i.href === '/operacoes/gise')?.ativo;

		expect(ativoEm('/operacoes/gise')).toBe(true);
		expect(ativoEm('/operacoes/gise/42')).toBe(true);
		expect(ativoEm('/operacoes/gise/operacoes')).toBe(false);
		expect(ativoEm('/operacoes/gise/finalizadas')).toBe(false);
	});

	it('Admin Geral ganha Finalizadas entre Ativas e Produtividade', () => {
		const flags = visibilidadeDoMenu(entrada({ usuario: { tipo: 'admin' } }));
		const hrefs = itensExtraDoMenu(flags, url('/operacoes/gise')).map((i) => i.href);
		expect(hrefs).toEqual([
			'/operacoes/gise',
			'/operacoes/gise/finalizadas',
			'/operacoes/produtividade'
		]);
	});

	it('/operacoes/gise/finalizadas acende Finalizadas, não Ativas', () => {
		const flags = visibilidadeDoMenu(entrada({ usuario: { tipo: 'admin' } }));
		const ativo = (href: string, path: string) =>
			itensExtraDoMenu(flags, url(path)).find((i) => i.href === href)?.ativo;

		expect(ativo('/operacoes/gise', '/operacoes/gise/finalizadas')).toBe(false);
		expect(ativo('/operacoes/gise/finalizadas', '/operacoes/gise/finalizadas')).toBe(true);
		expect(ativo('/operacoes/gise', '/operacoes/gise/42')).toBe(true);
		expect(ativo('/operacoes/gise/finalizadas', '/operacoes/gise/42')).toBe(false);
	});

	it('admin seccional não vê Finalizadas — o arquivo é do Admin Geral', () => {
		const flags = visibilidadeDoMenu(
			entrada({ usuario: { tipo: 'policial', papel: 'admin_seccional' } })
		);
		const hrefs = itensExtraDoMenu(flags, url('/operacoes/gise')).map((i) => i.href);
		expect(hrefs).not.toContain('/operacoes/gise/finalizadas');
	});

	/**
	 * As duas abas de /operacoes/presenca dividem a MESMA rota por query string. Um
	 * `ativo` só por pathname acenderia as duas ao mesmo tempo.
	 */
	it('presença × histórico se distinguem pelo ?status, não pelo pathname', () => {
		const flags = visibilidadeDoMenu(
			entrada({ temPresencaGisePendente: true, temGiseHistorico: true })
		);

		const semStatus = itensExtraDoMenu(flags, url('/operacoes/presenca'));
		expect(semStatus.find((i) => i.rotulo === 'Minha presença')?.ativo).toBe(true);
		expect(semStatus.find((i) => i.rotulo === 'Meu histórico')?.ativo).toBe(false);

		const comStatus = itensExtraDoMenu(flags, url('/operacoes/presenca?status=finalizadas'));
		expect(comStatus.find((i) => i.rotulo === 'Minha presença')?.ativo).toBe(false);
		expect(comStatus.find((i) => i.rotulo === 'Meu histórico')?.ativo).toBe(true);
	});

	it('a rota de relatório conta como /operacoes/presenca e carrega o status junto', () => {
		const flags = visibilidadeDoMenu(
			entrada({ temPresencaGisePendente: true, temGiseHistorico: true })
		);
		const itens = itensExtraDoMenu(
			flags,
			url('/operacoes/presenca/relatorio/7?status=finalizadas')
		);
		expect(itens.find((i) => i.rotulo === 'Meu histórico')?.ativo).toBe(true);
	});

	it('o Admin Geral não recebe os itens de presença — para ele /operacoes/presenca é o editor', () => {
		const flags = visibilidadeDoMenu(
			entrada({
				usuario: { tipo: 'admin' },
				temPresencaGisePendente: true,
				temGiseHistorico: true
			})
		);
		const rotulos = itensExtraDoMenu(flags, url('/operacoes/presenca')).map((i) => i.rotulo);
		expect(rotulos).not.toContain('Minha presença');
		expect(rotulos).not.toContain('Meu histórico');
	});

	it('histórico aparece mesmo sem serviço ativo — é o que mantém a aba após finalizar tudo', () => {
		const flags = visibilidadeDoMenu(entrada({ temGiseHistorico: true }));
		const rotulos = itensExtraDoMenu(flags, url('/operacoes/presenca')).map((i) => i.rotulo);
		expect(rotulos).toEqual(['Meu histórico']);
	});

	it('todo item sai com ícone — o submenu não desenha item sem símbolo', () => {
		const flags = visibilidadeDoMenu(
			entrada({
				usuario: { tipo: 'policial', papel: 'admin_seccional' },
				temLinhaBasePendente: true,
				temPresencaGisePendente: true,
				temGiseHistorico: true
			})
		);
		const itens = itensExtraDoMenu(flags, url('/operacoes/gise'));
		expect(itens.length).toBeGreaterThan(1);
		for (const item of itens) {
			expect(Array.isArray(item.icone), `ícone de ${item.rotulo}`).toBe(true);
			expect(item.icone.length, `ícone de ${item.rotulo}`).toBeGreaterThan(0);
		}
	});
});

describe('rotaAtiva', () => {
	it('casa a rota exata e os filhos, nunca um prefixo parcial de nome', () => {
		expect(rotaAtiva('/escalas', '/escalas')).toBe(true);
		expect(rotaAtiva('/escalas/12', '/escalas')).toBe(true);
		// O caso que um `startsWith` ingênuo erraria.
		expect(rotaAtiva('/escalas-extra', '/escalas')).toBe(false);
	});
});
