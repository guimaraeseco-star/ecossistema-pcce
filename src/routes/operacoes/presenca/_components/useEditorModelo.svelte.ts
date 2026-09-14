/**
 * Editor do MODELO do formulário de produtividade — a metade de `/operacoes/presenca` que
 * pertence ao ADMIN GERAL, consumida por `ConfigurarFormulario.svelte`.
 *
 * A rota tem duas audiências que não se cruzam: o policial confirma presença e
 * entrega relatório; o Admin Geral não presta serviço nenhum ali — para ele a
 * tela é este editor. Até ago/2026 as duas viviam num composable só
 * (`useResGise`, 663 ln) que devolvia 41 membros, e cada componente recebia o
 * objeto inteiro para usar metade. Separados, o editor nem chega a ser
 * instanciado para o policial.
 *
 * O que é do policial está em `usePresencaGise.svelte.ts`; a navegação por
 * query string, que as duas telas dividem, em `res-gise-navegacao.svelte.ts`.
 */
import { toaster } from '$lib/toast';
import { renumerarPerguntas } from '$lib/gise/renumerar-perguntas';
import { ehProporcao } from '$lib/gise/indicadores';
import { formasDaMarca, type FormaGrafico } from '$lib/produtividade';
import { loading } from '$lib/loading.svelte';
import { untrack } from 'svelte';
import { invalidateShared } from '$lib/cross-tab-invalidate';
import type { ActionResult } from '@sveltejs/kit';
import type { GiseModeloPerguntaConfig, ResGisePageData } from '$lib/types';
import { navigateWithFilters } from './res-gise-navegacao.svelte';

interface EditorModeloParams {
	getData: () => ResGisePageData;
	/**
	 * Chamado depois que o modelo é gravado e o `load` recarrega.
	 *
	 * Existe para a página religar a presença: gravar o modelo invalida
	 * `app:res-gise`, e quem tiver uma escala selecionada precisa reapontar para
	 * a linha nova. Na prática o Admin Geral não seleciona escala (a lista é do
	 * policial, e a tela dele é só o editor), mas a dependência era real no
	 * composable único — mantê-la explícita é mais barato que apostar que o
	 * caminho é inalcançável.
	 */
	aoSalvar?: () => void;
}

export function useEditorModelo({ getData, aoSalvar }: EditorModeloParams) {
	const data = $derived(getData());

	let configTipo = $state<'operacional' | 'seint'>('operacional');
	let perguntasConfig = $state<GiseModeloPerguntaConfig[]>([]);

	$effect(() => {
		const source = configTipo === 'seint' ? data.modeloSeint : data.modeloOperacional;
		perguntasConfig = structuredClone(source);
	});

	/**
	 * A operação em edição sai do SERVIDOR, não de um `$state` local: quem resolve
	 * `?operacaoId=` (e o fallback quando ele é inválido) é o `load`, e duplicar
	 * essa decisão aqui deixaria o editor mostrando uma operação e salvando em
	 * outra.
	 */
	const operacaoSelecionada = $derived(
		data.operacoes.find((o) => o.id === data.operacaoSelecionadaId) ?? null
	);

	/**
	 * Tipos de equipe que ESTA operação usa. Uma operação só de inteligência não
	 * mostra a aba "Operacional" — e a action recusa o POST correspondente, então
	 * o que a tela esconde o servidor também nega.
	 */
	const tiposDisponiveis = $derived.by((): Array<'operacional' | 'seint'> => {
		const op = operacaoSelecionada;
		if (!op) return ['operacional', 'seint'];
		const t: Array<'operacional' | 'seint'> = [];
		if (op.usa_equipe_operacional) t.push('operacional');
		if (op.usa_equipe_seint) t.push('seint');
		return t.length > 0 ? t : ['operacional'];
	});

	// Trocar de operação pode deixar o tipo corrente indisponível (estava em
	// "Operacional" e a nova operação é só SEINT). Cai no primeiro disponível em
	// vez de manter uma aba que a operação não tem.
	$effect(() => {
		const disponiveis = tiposDisponiveis;
		if (!disponiveis.includes(untrack(() => configTipo))) configTipo = disponiveis[0];
	});

	/** Troca a operação em edição pela URL — o `load` recarrega os modelos dela. */
	function trocarOperacao(id: number) {
		navigateWithFilters({ operacaoId: String(id) });
	}

	/**
	 * Liga/desliga UMA FORMA do gráfico da pergunta no painel de produtividade.
	 *
	 * Três formas independentes (colunas, ranking, detalhamento), e a pergunta
	 * pode ter quantas quiser: drogas e armas mostram ranking E detalhamento, que
	 * é como o painel sempre as desenhou.
	 *
	 * Remove a chave inteira quando a última forma é desligada, em vez de deixar
	 * `{}` pendurado: a ausência já é a resposta ("não aparece"), e um objeto vazio
	 * no JSON convidaria a próxima leitura a inventar um terceiro estado. Mesma
	 * escolha de `alternarIndicador`, logo abaixo.
	 *
	 * `formasDaMarca` normaliza a leitura porque o modelo pode trazer a marca
	 * ANTIGA — o booleano anterior à migração 0054, ainda possível numa
	 * sub-pergunta, que a migração não alcançou.
	 *
	 * Independente do indicador de propósito — são duas seções diferentes do
	 * painel. Uma pergunta pode ser gráfico sem meta (volume que se acompanha sem
	 * prometer número) e meta sem gráfico (a de cobertura, que já tem a própria
	 * leitura).
	 */
	function alternarFormaGrafico(p: GiseModeloPerguntaConfig, forma: FormaGrafico) {
		const formas = formasDaMarca(p.grafico);
		formas[forma] = !formas[forma];

		if (!formas.colunas && !formas.ranking && !formas.detalhe) delete p.grafico;
		else p.grafico = formas;

		perguntasConfig = [...perguntasConfig];
	}

	/**
	 * Liga/desliga o indicador de meta de uma pergunta.
	 *
	 * Ao ligar, semeia o caso que o tipo da pergunta já anuncia: cobertura de 100%
	 * numa pergunta de proporção, redução de 20% nas demais (o caso mais comum do
	 * pedido). Ao desligar, remove a chave inteira em vez de deixar
	 * `indicador: undefined` — o `config` vira JSON, e `undefined` sumiria de
	 * qualquer jeito na serialização, mas um objeto meio-apagado confundiria quem
	 * lesse o blob.
	 */
	function alternarIndicador(p: GiseModeloPerguntaConfig) {
		if (p.indicador) {
			delete p.indicador;
		} else if (ehProporcao(p.tipo)) {
			p.indicador = { metaTipo: 'proporcao', metaValor: 100 };
		} else {
			p.indicador = { objetivo: 'diminuir', metaTipo: 'percentual', metaValor: 20 };
		}
		perguntasConfig = [...perguntasConfig];
	}

	/**
	 * Troca o TIPO da meta, reconstruindo o objeto inteiro.
	 *
	 * Reconstrói, e não muta o campo: `proporcao` não tem `objetivo` nem
	 * `rotuloBase`, e um `bind:value` deixaria os dois pendurados no JSON gravado
	 * — campo morto que a próxima leitura interpreta como intenção. É a união
	 * discriminada de `IndicadorConfig` cobrando o que ela promete.
	 */
	function definirMetaTipoIndicador(p: GiseModeloPerguntaConfig, metaTipo: string) {
		const anterior = p.indicador;
		if (!anterior) return;
		const unidadeMedida = anterior.unidadeMedida;

		if (metaTipo === 'proporcao') {
			p.indicador = { metaTipo: 'proporcao', metaValor: 100, unidadeMedida };
		} else {
			p.indicador = {
				objetivo: anterior.metaTipo === 'proporcao' ? 'aumentar' : anterior.objetivo,
				metaTipo: metaTipo === 'absoluto' ? 'absoluto' : 'percentual',
				metaValor: anterior.metaValor,
				unidadeMedida,
				rotuloBase: anterior.metaTipo === 'proporcao' ? '' : anterior.rotuloBase
			};
		}
		perguntasConfig = [...perguntasConfig];
	}

	const configJson = $derived(JSON.stringify(perguntasConfig));

	/**
	 * O editor tem alteração que ainda não foi gravada?
	 *
	 * Compara o que está na tela com o modelo que o `load` trouxe. Depois de
	 * salvar, `invalidateShared` recarrega o `load` e os dois voltam a bater
	 * sozinhos — não há flag a limpar à mão.
	 *
	 * Existe porque o editor avisa que "nada é gravado até clicar em Salvar" e
	 * nada na tela tornava isso concreto: a barra de status tinha dois estados,
	 * "Salvando..." (que dura o tempo da requisição) e "Pronto para salvar", que
	 * era o `else` — dizia a mesma coisa tendo-se mexido em algo ou não.
	 *
	 * Comparação por JSON, com um falso positivo conhecido: ligar e desligar a
	 * mesma caixinha pode reordenar as chaves do objeto (`delete` + reatribuição
	 * põem a chave no fim), e o texto muda sem o conteúdo mudar. Erra para o lado
	 * de "salve" — que é o lado certo para errar num aviso — e um comparador
	 * profundo custaria mais do que vale.
	 */
	const alteracoesNaoSalvas = $derived(
		configJson !==
			JSON.stringify(configTipo === 'seint' ? data.modeloSeint : data.modeloOperacional)
	);

	function adicionarPergunta() {
		const id = Date.now();
		// Herda a etapa da última pergunta: a nova entra no FIM do formulário, que
		// é dentro da última etapa. Sem isso, cada pergunta nova abriria sozinha um
		// grupo "sem etapa" no fim — e o admin teria de redigitar o nome sempre.
		const etapa = perguntasConfig.at(-1)?.etapa;
		perguntasConfig = [
			...perguntasConfig,
			{
				id,
				texto: '',
				tipo: 'texto',
				obrigatoria: false,
				key: `extra_${id}`,
				...(etapa ? { etapa } : {}),
				filhos: []
			}
		];
	}

	function adicionarSubPergunta(pai: GiseModeloPerguntaConfig) {
		const id = Date.now();
		pai.filhos = [
			...(pai.filhos || []),
			{ id, texto: '', tipo: 'texto', obrigatoria: false, key: `extra_${id}`, filhos: [] }
		];
		perguntasConfig = [...perguntasConfig];
	}

	/**
	 * Move a pergunta de NÍVEL 0 de uma posição para outra e renumera os rótulos.
	 *
	 * A renumeração é o ponto: o badge do card sai de `indexOf` e se acerta
	 * sozinho, mas o número que o policial lê está DENTRO do texto ("4. Houve…")
	 * e nos sub-rótulos ("4.1 QUANTIDADE:"). Sem `renumerarPerguntas`, arrastar a
	 * 4 para o fim deixaria um "4." na posição 8.
	 */
	function moverPergunta(de: number, para: number) {
		const total = perguntasConfig.length;
		if (de === para || de < 0 || para < 0 || de >= total || para >= total) return;
		const lista = [...perguntasConfig];
		const [movida] = lista.splice(de, 1);
		lista.splice(para, 0, movida);
		perguntasConfig = renumerarPerguntas(lista);
	}

	function removerPergunta(id: number, lista = perguntasConfig) {
		const idx = lista.findIndex((p) => p.id === id);
		if (idx > -1) {
			lista.splice(idx, 1);
			// Renumera também aqui: remover a 4 e deixar 5,6,7… seria a mesma
			// inconsistência que o arraste corrige. Remoção de FILHO não mexe em
			// nada (a função só toca no primeiro segmento, que não mudou).
			perguntasConfig = renumerarPerguntas([...perguntasConfig]);
			return true;
		}
		for (const p of lista) {
			if (p.filhos && removerPergunta(id, p.filhos)) return true;
		}
		return false;
	}

	function handleSalvarModelo() {
		loading.show(`Salvando Modelo ${configTipo}...`);
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				toaster.success({ title: `Modelo ${configTipo} salvo com sucesso` });
				await invalidateShared('app:res-gise', 'app:papel-gise');
				aoSalvar?.();
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.error({ title: String(d?.error || 'Erro ao salvar modelo') });
			}
		};
	}

	return {
		get configTipo() {
			return configTipo;
		},
		set configTipo(v) {
			configTipo = v;
		},
		get perguntasConfig() {
			return perguntasConfig;
		},
		set perguntasConfig(v) {
			perguntasConfig = v;
		},
		get configJson() {
			return configJson;
		},
		/** Há edição na tela que ainda não foi gravada? Move o rodapé do editor. */
		get alteracoesNaoSalvas() {
			return alteracoesNaoSalvas;
		},
		/** Operações ativas, para o seletor do editor. */
		get operacoes() {
			return data.operacoes;
		},
		get operacaoSelecionadaId() {
			return data.operacaoSelecionadaId;
		},
		get tiposDisponiveis() {
			return tiposDisponiveis;
		},

		trocarOperacao,
		alternarFormaGrafico,
		alternarIndicador,
		definirMetaTipoIndicador,
		adicionarPergunta,
		adicionarSubPergunta,
		moverPergunta,
		removerPergunta,
		handleSalvarModelo
	};
}
