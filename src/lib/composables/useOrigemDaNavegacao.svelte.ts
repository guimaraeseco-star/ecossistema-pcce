/**
 * De onde o usuário veio — o que faz o botão "Voltar" VOLTAR de verdade.
 *
 * Problema relatado pelo responsável (16/09/2026): o "← Voltar" das fichas era
 * um link para a lista, ou seja, uma navegação NOVA — e o voltar do navegador,
 * depois dele, trazia a ficha de novo (lista → ficha → lista → ficha…). Nas
 * telas sem botão, o voltar do navegador funcionava; com botão, não.
 *
 * A regra: quando a página atual foi alcançada por um link ou `goto` de dentro
 * do app (há uma entrada anterior no histórico que é nossa), "Voltar" chama
 * `history.back()` — desfaz a entrada em vez de empilhar outra. Quando a
 * página foi aberta direto (URL colada, nova aba, recarga) ou por
 * `popstate` (o usuário acabou de usar o voltar/avançar do navegador, e a
 * entrada anterior é desconhecida), o botão navega para o `href` de sempre.
 *
 * O registro é feito UMA vez, no `afterNavigate` do layout raiz
 * (`registrarNavegacao`); quem consome é o `BotaoVoltar`.
 */
import type { AfterNavigate } from '@sveltejs/kit';

const estado = $state({ podeVoltar: false });

/** Chamar no `afterNavigate` do layout raiz. */
export function registrarNavegacao(n: AfterNavigate): void {
	estado.podeVoltar = (n.type === 'link' || n.type === 'goto') && n.from !== null;
}

export function useOrigemDaNavegacao() {
	return {
		/** Há uma entrada anterior do próprio app no histórico? */
		get podeVoltar() {
			return estado.podeVoltar;
		}
	};
}
