/**
 * Indicadores de meta: quais perguntas do formulário viram série acompanhada, de
 * onde sai o número realizado, e o que a meta significa em valor absoluto.
 *
 * Existe como módulo único porque as MESMAS três respostas são precisas em
 * quatro telas que não se conhecem — o editor do Admin Geral, a aba de dados
 * base do admin de unidade, o campo de base dentro do formulário de
 * produtividade e os gráficos de `/operacoes/produtividade`. É exatamente a forma dos bugs
 * catalogados no `CLAUDE.md`: lógica copiada, uma cópia consertada, as outras
 * não. Aqui a pior seria a das CHAVES, e ela já mordeu este projeto uma vez (ver
 * o cabeçalho de `tipos-pergunta.ts`).
 *
 * ## Duas chaves, não uma
 *
 * `pergunta.key` identifica a PERGUNTA e é o que a linha de base referencia:
 * gerada na criação, nunca editável na UI, estável. Mas a RESPOSTA nem sempre
 * mora nela — nos tipos de lista o número está em `${key}__qtd`. A tradução é de
 * `chavesLista()`, e é reusada aqui em vez de reescrita.
 *
 * ## Os três tipos de meta
 *
 * Percentual é relativo à linha de base ("redução mínima de 20% do acervo") e
 * por isso EXIGE que a unidade informe a base. Absoluta é um alvo fixo ("mínimo
 * de 1 por unidade/mês") e não exige nada — não há valor anterior a comparar.
 * Proporção é cobertura ("atender 100% das ocorrências"): o denominador vem da
 * própria pergunta, no mesmo relatório, então também não pede base.
 *
 * Essa diferença é o que decide se a delegacia vê ou não o campo de base, então
 * ela mora em `exigeLinhaBase()` e não espalhada em `if`s pelas telas.
 *
 * ## O primeiro argumento das contas é "referência", não "base"
 *
 * `metaAbsoluta`, `percentualAtingimento` e `metaAtingida` recebem o valor de
 * referência DA UNIDADE: a linha de base num indicador percentual, o total
 * existente num de proporção, e nada num absoluto. Generalizar o parâmetro em
 * vez de duplicar as três funções é o que mantém uma conta só por pergunta —
 * três cópias divergiriam exatamente como o `CLAUDE.md` cataloga.
 */
import type { GiseModeloPerguntaConfig, IndicadorConfig, IndicadorMetaValor } from '$lib/types';
import { chavesLista, chavesProporcao, TIPO_PROPORCAO } from './tipos-pergunta';

/**
 * Tipos de pergunta que podem ser indicador: os que produzem um NÚMERO por
 * relatório, e só eles.
 *
 * Texto livre não agrega; `sim_nao` responde outra coisa (proporção, não
 * volume). Os tipos de lista entram porque têm quantidade — é o `__qtd` que
 * `chaveResposta` resolve.
 *
 * Deliberadamente mais restrito que `CHARTABLE_TYPES` de `$lib/produtividade`:
 * aquele decide o que vira gráfico de barras qualquer; este, o que pode ter meta
 * e linha de base.
 */
export const TIPOS_INDICADORAVEIS: readonly string[] = [
	'numero',
	TIPO_PROPORCAO,
	'select_99',
	'select_999',
	'lista_detalhada',
	'mandados_maiores',
	'prisoes_maiores',
	'apreensoes_menores',
	'celulares_complex',
	'analise_complex',
	'relatorios_seint_complex',
	'foragidos_complex',
	'operacoes_seint_complex',
	'operacoes_seint_pura'
];

/** Um indicador já resolvido: a pergunta, a meta e onde ler a resposta dela. */
export interface Indicador {
	/** `pergunta.key` — a referência estável, e o que `operacao_linha_base.indicador_key` guarda. */
	key: string;
	/** Onde a RESPOSTA está no blob. Igual a `key`, exceto nos tipos de lista e de proporção. */
	chaveResposta: string;
	/**
	 * Onde está o DENOMINADOR, só no tipo `proporcao`; `null` nos demais.
	 *
	 * É o que separa cobertura de volume: com ele o painel sabe que 12 é "12 de
	 * 40", e sem ele leria 12 como o realizado inteiro.
	 */
	chaveTotal: string | null;
	/** O enunciado da pergunta, para rótulo de gráfico e de campo. */
	texto: string;
	/**
	 * O título que o admin deu ao card no painel, CRU — sem o padrão aplicado.
	 *
	 * Passa por aqui em vez de já resolvido porque quem sabe resolver é
	 * `tituloNoPainel` (`$lib/produtividade/apresentacao`), e é ele que os cards
	 * de gráfico usam. Resolver aqui também seria a mesma precedência escrita
	 * duas vezes, uma em cada seção do painel.
	 *
	 * Não afeta `/operacoes/dados-base`: lá o rótulo do campo é `config.rotuloBase`, que
	 * pergunta outra coisa ("como pedir o valor inicial à unidade").
	 */
	rotulo_painel?: string;
	tipo: string;
	config: IndicadorConfig;
}

/** O tipo aceita meta? Único lugar que responde — usado pelo editor e na validação. */
export function podeSerIndicador(tipo: string): boolean {
	return TIPOS_INDICADORAVEIS.includes(tipo);
}

/** O tipo mede COBERTURA (dois campos, total e parte)? */
export function ehProporcao(tipo: string): boolean {
	return tipo === TIPO_PROPORCAO;
}

/**
 * Onde a resposta desta pergunta está no blob gravado.
 *
 * Nos tipos de lista é a chave de QUANTIDADE (`${key}__qtd` ou a fixa do tipo);
 * na proporção é a chave da PARTE atendida; nos demais é a própria `key`. Reusa
 * `chavesLista`/`chavesProporcao` de propósito: uma segunda implementação
 * divergiria em silêncio e o indicador simplesmente leria zero.
 */
export function chaveResposta(p: { tipo: string; key: string }): string {
	return chavesProporcao(p)?.parte ?? chavesLista(p)?.qtd ?? p.key;
}

/**
 * A meta deste indicador exige linha de base da unidade?
 *
 * Só a percentual — ela é uma fração de um valor anterior, e sem esse valor não
 * há meta nenhuma a calcular. A absoluta já é o alvo, e a proporção traz o
 * próprio denominador dentro do relatório.
 *
 * Devolve um type guard, e não um `boolean`: quem passou por aqui está falando
 * de uma meta que TEM `rotuloBase` e `objetivo`, e é o compilador que garante
 * isso no chamador em vez de um `!` solto.
 */
export function exigeLinhaBase(ind: IndicadorConfig): ind is IndicadorMetaValor {
	return ind.metaTipo === 'percentual';
}

/** Um indicador que PEDE linha de base — `config` já estreitado para a variante que tem `rotuloBase`. */
export type IndicadorComLinhaBase = Omit<Indicador, 'config'> & { config: IndicadorMetaValor };

/**
 * Filtra para os indicadores que pedem base à unidade, estreitando o tipo junto.
 *
 * Existe porque `.filter((i) => exigeLinhaBase(i.config))` não estreita nada: o
 * guard fala do `config`, e o compilador não propaga isso para o elemento da
 * lista. Sem esta função, os dois chamadores (a aba de dados base e o campo
 * dentro do formulário) leriam `rotuloBase` com um `!` — que é exatamente o
 * ponto em que uma meta de cobertura passaria a pedir base sem ninguém notar.
 */
export function indicadoresComLinhaBase(inds: Indicador[]): IndicadorComLinhaBase[] {
	return inds.filter((i): i is IndicadorComLinhaBase => exigeLinhaBase(i.config));
}

/**
 * A cobertura em porcentagem — quanto da parte sobre o total.
 *
 * `null` quando o total é zero ou desconhecido: não houve ocorrência nenhuma no
 * período, e nesse caso a cobertura não é 0% nem 100%, é indefinida. Devolver 0
 * faria a unidade aparecer como omissa por um período em que não havia o que
 * atender.
 */
export function percentualCobertura(
	parte: number,
	total: number | null | undefined
): number | null {
	if (total == null || !Number.isFinite(total) || total <= 0) return null;
	if (!Number.isFinite(parte)) return null;
	return (parte / total) * 100;
}

/**
 * Todos os indicadores de um modelo, na ordem em que aparecem no formulário.
 *
 * Percorre também os `filhos`: uma pergunta condicional ("se Sim, quantos?") é
 * um lugar legítimo para um indicador, e ignorá-los faria a meta configurada no
 * editor sumir do gráfico sem aviso.
 *
 * Deduplica por `key` mantendo a PRIMEIRA ocorrência. A `key` é gerada na
 * criação e não é editável, então repetição aqui só acontece por modelo
 * importado ou clonado à mão — e duas linhas com a mesma `key` colidiriam no
 * índice único de `operacao_linha_base`.
 */
export function extrairIndicadores(
	perguntas: GiseModeloPerguntaConfig[] | null | undefined
): Indicador[] {
	const achados: Indicador[] = [];
	const vistas = new Set<string>();

	function andar(lista: GiseModeloPerguntaConfig[]) {
		for (const p of lista) {
			if (p.indicador && podeSerIndicador(p.tipo) && !vistas.has(p.key)) {
				vistas.add(p.key);
				achados.push({
					key: p.key,
					chaveResposta: chaveResposta(p),
					chaveTotal: chavesProporcao(p)?.total ?? null,
					texto: p.texto,
					rotulo_painel: p.rotulo_painel,
					tipo: p.tipo,
					config: p.indicador
				});
			}
			if (p.filhos?.length) andar(p.filhos);
		}
	}

	andar(perguntas ?? []);
	return achados;
}

/**
 * Os indicadores de VÁRIOS modelos (operacional + SEINT da mesma operação),
 * unificados.
 *
 * A mesma `key` pode estar nos dois formulários — é o caso quando o indicador
 * vale para a operação inteira, não para um tipo de equipe. A linha de base é da
 * UNIDADE, não da equipe, então ela é uma só: deduplicar aqui é o que impede a
 * aba de dados base de pedir o mesmo número duas vezes.
 */
export function extrairIndicadoresDeModelos(
	modelos: Array<GiseModeloPerguntaConfig[] | null | undefined>
): Indicador[] {
	const porChave = new Map<string, Indicador>();
	for (const modelo of modelos) {
		for (const ind of extrairIndicadores(modelo)) {
			if (!porChave.has(ind.key)) porChave.set(ind.key, ind);
		}
	}
	return [...porChave.values()];
}

/**
 * O valor que a operação persegue, em número absoluto.
 *
 * Percentual aplica a variação sobre a base, na direção do objetivo: base 1.240
 * com "diminuir 20%" vira 992. Absoluta devolve o próprio alvo e ignora a
 * referência. Proporção aplica a cobertura sobre o TOTAL do período: 40
 * ocorrências com meta de 100% viram 40 atendimentos a fazer.
 *
 * `null` quando falta a referência de um indicador que precisa dela — não há
 * meta a exibir, e devolver 0 faria um gráfico afirmar que a meta é zerar o
 * acervo.
 */
export function metaAbsoluta(
	referencia: number | null | undefined,
	ind: IndicadorConfig
): number | null {
	if (ind.metaTipo === 'absoluto') return ind.metaValor;
	if (referencia == null || !Number.isFinite(referencia)) return null;
	if (ind.metaTipo === 'proporcao') {
		// Total zero é "não houve o que atender": sem meta a desenhar, e não meta 0.
		if (referencia <= 0) return null;
		return referencia * (ind.metaValor / 100);
	}
	const fator = ind.objetivo === 'diminuir' ? 1 - ind.metaValor / 100 : 1 + ind.metaValor / 100;
	return referencia * fator;
}

/**
 * Quanto da meta foi cumprido, em porcentagem (100 = meta batida; passa de 100
 * quando supera).
 *
 * Para `diminuir`, o progresso é o quanto ANDOU da base em direção à meta —
 * `(base − atual) / (base − meta)`. Não é `atual / meta`: com base 1.000, meta
 * 800 e realizado 900, `atual/meta` daria 112%, dizendo que superou a meta
 * quando na verdade fez metade do caminho.
 *
 * Na PROPORÇÃO a conta volta a ser `atual / meta`, e é o certo aqui: não há
 * caminho a percorrer desde um valor anterior, só a fatia coberta contra a fatia
 * prometida. Cobertura de 87% com meta de 80% dá 108,75% de atingimento.
 *
 * `null` quando não há como calcular: falta base num indicador percentual, total
 * zero num de proporção, ou o denominador é zero (base já igual à meta — não há
 * distância a percorrer, e dividir daria ±∞).
 */
export function percentualAtingimento(
	referencia: number | null | undefined,
	atual: number,
	ind: IndicadorConfig
): number | null {
	const meta = metaAbsoluta(referencia, ind);
	if (meta == null || !Number.isFinite(atual)) return null;

	if (ind.metaTipo === 'proporcao') {
		return meta === 0 ? null : (atual / meta) * 100;
	}

	if (ind.metaTipo === 'absoluto') {
		if (ind.objetivo === 'diminuir') {
			// Sem base, "diminuir até no máximo N" só tem duas leituras honestas:
			// dentro do teto (100%) ou fora dele, proporcional a quanto excedeu.
			if (atual <= meta) return 100;
			return meta === 0 ? 0 : Math.max(0, (meta / atual) * 100);
		}
		return meta === 0 ? 100 : (atual / meta) * 100;
	}

	if (referencia == null) return null;
	const distancia = meta - referencia;
	if (distancia === 0) return null;
	return ((atual - referencia) / distancia) * 100;
}

/** A meta foi atingida? `null` quando não há como saber (mesma razão de `percentualAtingimento`). */
export function metaAtingida(
	referencia: number | null | undefined,
	atual: number,
	ind: IndicadorConfig
): boolean | null {
	const meta = metaAbsoluta(referencia, ind);
	if (meta == null || !Number.isFinite(atual)) return null;
	// Cobertura só se atinge por cima: atender MAIS que o prometido é bater a meta.
	if (ind.metaTipo === 'proporcao') return atual >= meta;
	return ind.objetivo === 'diminuir' ? atual <= meta : atual >= meta;
}

/**
 * Soma uma chave do blob num conjunto de respostas já parseadas.
 *
 * Recebe a CHAVE, e não o indicador, porque a proporção tem duas — o numerador e
 * o denominador saem da mesma função, somados do mesmo jeito.
 *
 * Trata ausente, `null`, `''` e texto não-numérico como 0 — o blob é gravado por
 * formulário e sempre teve buracos (pergunta acrescentada depois de respostas já
 * existirem é o caso normal, não a exceção).
 */
export function somarChave(respostas: Array<Record<string, unknown>>, chave: string): number {
	let total = 0;
	for (const r of respostas) {
		const bruto = r[chave];
		const n = typeof bruto === 'number' ? bruto : Number(bruto);
		if (Number.isFinite(n)) total += n;
	}
	return total;
}
