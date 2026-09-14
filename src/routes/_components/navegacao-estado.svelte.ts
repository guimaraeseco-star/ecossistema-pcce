/**
 * O estado da GAVETA de navegação e o modelo do menu que ela desenha.
 *
 * Existe para que `SidebarNavegacao` e `BarraTopo` sejam componentes de
 * verdade, e não repassadores: as duas peças precisam da MESMA gaveta (a barra
 * abre, a lateral fecha, e o `inert` das duas depende do mesmo booleano), e a
 * lateral precisa do modelo do menu. Descer isso por props custaria ~18
 * parâmetros e devolveria o problema que a extração veio resolver — é o defeito
 * que `GiseSupervisao` teve ao encolher 88% e virar um repassador de 38 props
 * (auditoria de 13/ago/2026), remediado lá do mesmo jeito: o estado sai junto
 * com o markup.
 *
 * Tudo o que é DERIVADO de `page.data` (usuário, papéis, flags do menu) fica
 * aqui em vez de virar prop, porque `page` é legível de qualquer componente —
 * repassar `usuario` para um filho que poderia lê-lo sozinho é prop-drilling
 * sem ganho.
 *
 * **Nada aqui é gate de segurança.** A gaveta apenas ESCONDE o que o usuário
 * não usa; quem barra é o `load` de cada rota. A regra de visibilidade em si
 * mora em `menu-visibilidade.ts`, com testes.
 *
 * Foco e acessibilidade são responsabilidade deste módulo, não do markup, e é
 * a parte que mais fácil se perde numa refatoração:
 *
 *   - `abrir()` tira o foco de onde estava ANTES de marcar a topbar como
 *     `inert` — o Chrome recusa `aria-hidden` num ancestral do elemento
 *     focado e imprime "Blocked aria-hidden on an element because its
 *     descendant retained focus";
 *   - `fechar()` faz o mesmo pelo lado da gaveta: o clique no item deixa o
 *     `<a>` focado, e fechar aplicaria `inert` com o foco lá dentro;
 *   - `irParaNivel()` move o foco para o primeiro item do novo nível porque o
 *     `<nav>` troca de conteúdo SEM trocar de página: nada anunciaria a
 *     mudança sozinho para o leitor de tela.
 */
import { tick } from 'svelte';
import { page } from '$app/state';
import {
	visibilidadeDoMenu,
	itensExtraDoMenu,
	rotaAtiva,
	type ItemMenu
} from './menu-visibilidade';

/** Telas de PORTÃO (pré-entrada): exibidas isoladas, sem navegação. */
export const ROTAS_SEM_SIDEBAR = ['/login', '/alterar-senha', '/aceitar-termo'];

export type NavegacaoEstado = ReturnType<typeof criarNavegacaoEstado>;

export function criarNavegacaoEstado() {
	// A gaveta é overlay OCULTO POR PADRÃO em todas as larguras — inclusive no
	// desktop. Não existe mais o modo "sempre aberta"; `aberta` é a fonte única.
	let aberta = $state(false);

	// Em qual nível a gaveta está: a raiz ou dentro de "Escala extra". Fixado ao
	// ABRIR, pela rota, e não mantido entre aberturas: abrir o menu estando em
	// `/operacoes/produtividade` e cair na raiz esconderia justamente onde a pessoa está.
	let nivel = $state<'raiz' | 'extra'>('raiz');

	let restaurarFocoAposNavegar = false;

	const usuario = $derived(page.data.usuario);
	const isSupervisorGise = $derived(page.data.isSupervisorGise ?? false);
	const adminModulo = $derived((page.data.adminModulo as 'ambas' | 'gise' | 'escalas') ?? 'ambas');
	const recebidosNaoVistos = $derived(Number(page.data.recebidosNaoVistos ?? 0));

	const flags = $derived(
		visibilidadeDoMenu({
			usuario,
			adminModulo,
			isSupervisorGise,
			temLinhaBasePendente: page.data.temLinhaBasePendente ?? false,
			temPresencaGisePendente: page.data.temPresencaGisePendente ?? false,
			temGiseHistorico: page.data.temGiseHistorico ?? false
		})
	);

	/**
	 * Os filhos do menu "Escala extra", já filtrados pelo que este usuário vê —
	 * inclusive o realce das duas abas de `/operacoes/presenca` (`?status=finalizadas`) e
	 * o par `/operacoes/gise` × `/operacoes/gise/finalizadas` do Admin Geral.
	 */
	const filhosExtra = $derived(itensExtraDoMenu(flags, page.url));

	/** A rota atual é de algum filho? Decide o nível em que a gaveta abre. */
	const naRotaExtra = $derived(filhosExtra.some((f: ItemMenu) => f.ativo));

	async function abrir() {
		const focado = document.activeElement;
		if (focado instanceof HTMLElement) focado.blur();

		nivel = naRotaExtra ? 'extra' : 'raiz';

		aberta = true;
		await tick();
		document.getElementById('navegacao-principal')?.focus();
	}

	async function fechar({
		restaurarFoco = true,
		aposNavegacao = false
	}: { restaurarFoco?: boolean; aposNavegacao?: boolean } = {}) {
		if (!aberta) return;

		const focado = document.activeElement;
		const gaveta = document.getElementById('navegacao-principal')?.closest('aside');
		if (focado instanceof HTMLElement && gaveta?.contains(focado)) {
			focado.blur();
		}

		aberta = false;

		if (!restaurarFoco) return;
		if (aposNavegacao) {
			restaurarFocoAposNavegar = true;
			return;
		}

		await tick();
		document.getElementById('botao-menu-mobile')?.focus();
	}

	async function irParaNivel(destino: 'raiz' | 'extra') {
		nivel = destino;
		await tick();
		document.getElementById(destino === 'extra' ? 'menu-voltar' : 'menu-pai-extra')?.focus();
	}

	return {
		get aberta() {
			return aberta;
		},
		get nivel() {
			return nivel;
		},
		/** Enquanto aberta a gaveta é modal: trava o fundo e o torna inerte. */
		get ehModal() {
			return aberta;
		},
		/** Fechada, a própria gaveta fica inerte (está fora da tela). */
		get ehInerte() {
			return !aberta;
		},
		get usuario() {
			return usuario;
		},
		get isSupervisorGise() {
			return isSupervisorGise;
		},
		get adminModulo() {
			return adminModulo;
		},
		get recebidosNaoVistos() {
			return recebidosNaoVistos;
		},
		get flags() {
			return flags;
		},
		get filhosExtra() {
			return filhosExtra;
		},
		get naRotaExtra() {
			return naRotaExtra;
		},
		abrir,
		fechar,
		irParaNivel,
		alternar() {
			return aberta ? fechar() : abrir();
		},
		/** Clique num item: fecha, mas devolve o foco só quando a rota trocar. */
		aoNavegar() {
			return fechar({ aposNavegacao: true });
		},
		rotaEstaAtiva(path: string) {
			return rotaAtiva(page.url.pathname, path);
		},
		/**
		 * Chamado pelo `afterNavigate` do layout. Devolve o foco ao botão de menu
		 * só se a navegação veio de um clique DENTRO da gaveta — depois que a
		 * rota trocou, para não competir com o foco da página nova.
		 */
		async devolverFocoSePendente() {
			if (!restaurarFocoAposNavegar) return;
			restaurarFocoAposNavegar = false;
			await tick();
			document.getElementById('botao-menu-mobile')?.focus();
		}
	};
}
