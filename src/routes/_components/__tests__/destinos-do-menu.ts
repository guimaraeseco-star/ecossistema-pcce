/**
 * O espelho da SIDEBAR para os testes de paridade — os destinos que
 * `SidebarNavegacao.svelte` oferece a cada perfil, reproduzidos a partir das
 * mesmas flags que o markup lê. Compartilhado por `bem-vindo-cards.test.ts`
 * (policial sem papel e Super Admin) e `home-modulos.test.ts` (perfis
 * administrativos): a lista é UMA porque a barra é uma.
 *
 * `itensExtraDoMenu` é a função de verdade, não uma cópia. O resto reproduz o
 * markup à mão — mudou a barra, este arquivo tem de acompanhar, e o teste que
 * o consome reprova até o card acompanhar também.
 */
import { visibilidadeDoMenu, itensExtraDoMenu, type FlagsMenu } from '../menu-visibilidade';
import { gruposHome } from '../home-modulos';

export interface UsuarioDeTeste {
	tipo?: 'policial' | 'admin' | 'colaborador';
	papel?: 'admin_seccional' | 'admin_unidade' | null;
	cargo?: string | null;
	isSuperAdmin?: boolean;
	modulosAdmin?: { escalas: boolean; gise: boolean } | null;
}

export type Modulo = 'ambas' | 'gise' | 'escalas';

export interface ExtrasDeFlags {
	isSupervisorGise?: boolean;
	temLinhaBasePendente?: boolean;
	temPresencaGisePendente?: boolean;
	temGiseHistorico?: boolean;
}

export function flagsDe(
	usuario: UsuarioDeTeste,
	adminModulo: Modulo,
	extra: ExtrasDeFlags = {}
): FlagsMenu {
	return visibilidadeDoMenu({
		usuario,
		adminModulo,
		isSupervisorGise: extra.isSupervisorGise ?? false,
		temLinhaBasePendente: extra.temLinhaBasePendente ?? false,
		temPresencaGisePendente: extra.temPresencaGisePendente ?? false,
		temGiseHistorico: extra.temGiseHistorico ?? false
	});
}

/** Os destinos que a sidebar oferece — espelho do markup de `SidebarNavegacao.svelte`. */
export function destinosDoMenu(usuario: UsuarioDeTeste, flags: FlagsMenu): string[] {
	if (usuario.isSuperAdmin) {
		return [
			'/unidades',
			'/servidores',
			'/colaboradores',
			'/conf-ass',
			'/config-geral',
			'/valores',
			'/auditoria'
		];
	}
	const ehAdmin = usuario.tipo === 'admin';
	const destinos: string[] = [];

	// Os títulos de grupo são links para a tela do grupo — a barra desenha um
	// para cada grupo que a HOME mostra (mesma fonte: `gruposHome`), mesmo sem
	// item de menu embaixo. O policial sem papel tem a barra plana.
	for (const g of gruposHome({ usuario, flags })) destinos.push(g.href);
	// Gestão de pessoal
	if (flags.showPoliciais) destinos.push('/servidores');
	if (flags.showSolicitacoes) destinos.push('/solicitacoes');
	if (flags.showValores) destinos.push('/valores');
	if (flags.showGrupo1) {
		if (ehAdmin) destinos.push('/painel', '/recebidos');
		if (flags.showEscalasPoliciais) destinos.push('/escalas');
	}
	// Gestão operacional
	if (flags.showGrupo2) {
		const extra = itensExtraDoMenu(flags, new URL('http://x/')).map((i) => i.href);
		destinos.push(...extra);
		if (flags.showGise && ehAdmin) destinos.push('/operacoes/gise/operacoes', '/operacoes/planos');
	}
	// Gestão de unidade
	if (flags.showUnidade) destinos.push('/unidade');
	// Gestão administrativa
	if (flags.showColaboradores) destinos.push('/colaboradores');
	// Meu perfil
	if (usuario.tipo === 'policial') destinos.push('/perfil');

	return [...new Set(destinos)];
}
