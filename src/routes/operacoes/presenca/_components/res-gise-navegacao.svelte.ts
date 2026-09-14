/**
 * Navegação por query string de `/operacoes/presenca`, compartilhada pelas duas telas da
 * rota (o editor do modelo e a presença do policial).
 *
 * Fica aqui, e não dentro de um dos dois composables, porque os dois navegam
 * pela MESMA URL: o editor troca `?operacaoId=`, a presença troca `?mes=` /
 * `?data=` / `?tipo=` / `?periodo=` / `?ano=` / `?ciclo=`. Escrever a query duas vezes é o caminho
 * para uma das telas apagar o parâmetro da outra — o `?status` da aba já foi
 * perdido assim uma vez (por `limparFiltros` zerando o filtro inteiro, o que
 * jogava quem estava no Histórico de volta para Ativas).
 *
 * Preserva tudo que não foi citado: só as chaves passadas são escritas, e
 * `null` apaga.
 */
import { page } from '$app/state';
import { goto } from '$app/navigation';

export function navigateWithFilters(params: Record<string, string | null>) {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const navUrl = new URL(page.url);
	Object.entries(params).forEach(([key, value]) => {
		if (value) navUrl.searchParams.set(key, value);
		else navUrl.searchParams.delete(key);
	});
	goto(navUrl.pathname + navUrl.search, { keepFocus: true, noScroll: true });
}
