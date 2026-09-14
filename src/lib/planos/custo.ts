/**
 * O cálculo de custo do plano operacional: por membro, por equipe e o
 * consolidado do Anexo II.
 *
 * ## Tudo em centavos, do começo ao fim
 *
 * Nenhuma função aqui vê `real`. As diárias entram em MEIAS DIÁRIAS inteiras
 * (ver `diarias.ts`), e a única divisão do módulo é a do arredondamento da meia
 * diária, feita uma vez e com regra escrita. É o que faz o total bater com a
 * planilha da corporação até o último centavo.
 *
 * ## Membro sem classe não custa zero — impede a emissão
 *
 * `policiais.classe` é `text NOT NULL DEFAULT ''`, então existe servidor sem
 * classe no cadastro. Sem faixa, não há valor/hora aplicável, e as duas saídas
 * fáceis são ambas erradas: cobrar zero produz um documento orçado a menor que
 * nada denuncia, e escolher a faixa mais barata inventa um dado.
 *
 * A saída daqui é a terceira: o membro entra em `pendencias` e NÃO entra no
 * total. `custoDoPlano` devolve essa lista, a tela a exibe como bloqueio e o
 * endpoint de download recusa a emissão enquanto ela não estiver vazia. O custo
 * calculado sem os pendentes é PARCIAL de propósito — é número para a tela
 * mostrar o que já fechou, nunca para imprimir.
 *
 * ## `sem_custo` não é estado final — por isso existe `avisos`
 *
 * Numa equipe sem custo ninguém recebe, então classe em branco não impede nada
 * HOJE. Mas ela impediria amanhã: a operação é remarcada para um sábado, o
 * horário escorrega para depois das 18h, e a mesma equipe passa a custar. Se a
 * falha de cadastro só aparecesse nesse instante, o bloqueio surgiria na
 * véspera da emissão — e o cadastro do servidor é justamente o que ninguém
 * corrige às pressas.
 *
 * Daí a mesma falha sair em duas listas de peso diferente: `pendencias` onde já
 * há custo (impede emitir) e `avisos` onde ainda não há (só alerta). Tratar as
 * duas como uma só erraria dos dois lados — bloquear a operação diurna em dia
 * útil, que é o caso mais comum de todos, ou calar sobre um problema que a
 * primeira remarcação transforma em impedimento.
 */
import { faixaDoPolicial, categoriaDaFaixa, type CategoriaAnexo } from './faixa-custo';
import type { TipoDiaria } from './meias-diarias';
import type { TipoCusto } from './rotulos';

/** Os valores aplicados — o recorte de `custo_parametros` que o cálculo usa. */
export interface ValoresCusto {
	oip_cd_normal: number;
	oip_ab_normal: number;
	dpc_12_normal: number;
	dpc_3e_normal: number;
	oip_cd_plus: number;
	oip_ab_plus: number;
	dpc_12_plus: number;
	dpc_3e_plus: number;
	diaria_estadual: number;
	diaria_interestadual: number;
}

/**
 * Tabela zerada — o que se usa enquanto o Super Admin não gravou nenhuma.
 *
 * Existe para o cálculo não estourar antes da primeira configuração, e **nunca
 * é um valor legítimo**: as telas que a usam avisam que o Anexo II sairia
 * zerado. Não confundir com custo zero de verdade, que é a equipe `sem_custo`
 * ou a janela inteira dentro de 08:00–18:00 em dia útil.
 *
 * Mora aqui, e não no call site, porque são DEZ campos: uma segunda cópia que
 * esqueça um deles depois de a interface crescer não dá erro de tipo enquanto o
 * campo novo for opcional — dá R$ 0 numa faixa só, que é o modo de falhar que
 * este módulo inteiro existe para evitar.
 */
export const VALORES_ZERADOS: ValoresCusto = {
	oip_cd_normal: 0,
	oip_ab_normal: 0,
	dpc_12_normal: 0,
	dpc_3e_normal: 0,
	oip_cd_plus: 0,
	oip_ab_plus: 0,
	dpc_12_plus: 0,
	dpc_3e_plus: 0,
	diaria_estadual: 0,
	diaria_interestadual: 0
};

/** O recorte de `plano_equipes` que o cálculo consulta. */
export interface EquipeParaCusto {
	id: number;
	nome: string;
	tipo_custo: TipoCusto;
	horas_normais: number;
	horas_plus: number;
	diaria_tipo: TipoDiaria | null;
	diarias_meias: number;
}

/** O recorte de `plano_equipe_membros` (+ join em `policiais`) que o cálculo consulta. */
export interface MembroParaCusto {
	id: number;
	policial_id: number;
	nome: string;
	/** Congelado na linha do membro — a base de cálculo não acompanha promoção. */
	cargo_snapshot: string;
	classe_snapshot: string;
}

/** O custo de UM membro, já resolvido. */
interface CustoMembro {
	membro: MembroParaCusto;
	/** `null` quando a classe não resolve faixa — a linha não entra no total. */
	categoria: CategoriaAnexo | null;
	/** Centavos. Zero quando a equipe é `sem_custo` ou quando há pendência. */
	total: number;
}

/** Um servidor que impede a emissão do documento. */
interface Pendencia {
	policial_id: number;
	nome: string;
	equipe: string;
	motivo: string;
}

/** O custo de uma equipe. */
export interface CustoEquipe {
	equipe: EquipeParaCusto;
	membros: CustoMembro[];
	/** Centavos, somando só os membros com faixa resolvida. */
	total: number;
}

/** Uma linha do consolidado do Anexo II. */
interface LinhaConsolidado {
	categoria: CategoriaAnexo;
	/** Quantos SERVIDORES entram nesta linha (é o que o modelo chama "QUANTIDADE"). */
	quantidade: number;
	/** Centavos. */
	total: number;
}

/** O Anexo II inteiro. */
interface Consolidado {
	/** Bloco "DIÁRIA DE REFORÇO OPERACIONAL (HORAS EXTRAS)". */
	dro: LinhaConsolidado[];
	/** Bloco "DIÁRIAS". */
	diarias: LinhaConsolidado[];
	droTotal: number;
	diariasTotal: number;
	/** Centavos — o TOTAL GERAL do documento. */
	totalGeral: number;
}

/** O resultado completo, que a tela e o PDF consomem. */
export interface CustoPlano {
	equipes: CustoEquipe[];
	consolidado: Consolidado;
	/**
	 * Servidores sem faixa resolvida em equipe QUE TEM CUSTO. **Lista não vazia =
	 * documento não pode ser emitido**, e o total abaixo é parcial.
	 */
	pendencias: Pendencia[];
	/**
	 * Servidores sem faixa resolvida em equipe SEM CUSTO — não bloqueiam nada
	 * hoje, mas bloqueariam no instante em que a equipe mudar de tipo de custo.
	 *
	 * Existe porque `sem_custo` não é um estado final: a operação é remarcada
	 * para um sábado, o horário escorrega para depois das 18h, e a equipe que não
	 * custava nada passa a custar. Se a classe faltando só aparecesse nesse
	 * momento, o bloqueio surgiria na véspera da emissão — com o efetivo já
	 * montado e o cadastro do servidor sendo justamente o que ninguém consegue
	 * corrigir às pressas.
	 *
	 * A tela mostra estes como aviso, não como impedimento. É a diferença entre
	 * "corrija agora, ainda dá tempo" e "não dá para emitir".
	 */
	avisos: Pendencia[];
	/** Centavos, somando só o que fechou. */
	total: number;
}

/** O valor/hora aplicável a uma faixa, na espécie pedida. */
function valorHora(
	valores: ValoresCusto,
	faixa: 'oip_cd' | 'oip_ab' | 'dpc_12' | 'dpc_3e',
	especie: 'normal' | 'plus'
): number {
	return valores[`${faixa}_${especie}` as keyof ValoresCusto];
}

/**
 * Custo de diárias de UM servidor, em centavos.
 *
 * A conta é `meias × valor / 2`. A divisão vem por ÚLTIMO, depois da
 * multiplicação, para que meia diária de um valor ímpar em centavos não perca
 * precisão no meio do caminho. O arredondamento é meio-para-cima
 * (`Math.round`), que é a convenção da corporação para fração de centavo.
 */
export function custoDeDiarias(meias: number, valorDiaria: number): number {
	return Math.round((meias * valorDiaria) / 2);
}

/** O custo de um membro dentro de uma equipe. */
function custoDoMembro(
	membro: MembroParaCusto,
	equipe: EquipeParaCusto,
	valores: ValoresCusto
): CustoMembro {
	const faixa = faixaDoPolicial(membro.cargo_snapshot, membro.classe_snapshot);

	// Sem custo não precisa de faixa: ninguém recebe, então classe em branco não
	// impede nada. Tratar isso como pendência travaria a emissão de um plano
	// inteiramente diurno em dia útil — o caso mais comum de todos.
	if (equipe.tipo_custo === 'sem_custo') {
		return { membro, categoria: faixa ? categoriaDaFaixa(faixa) : null, total: 0 };
	}

	if (!faixa) return { membro, categoria: null, total: 0 };

	const categoria = categoriaDaFaixa(faixa);

	if (equipe.tipo_custo === 'hora_extra') {
		const total =
			equipe.horas_normais * valorHora(valores, faixa, 'normal') +
			equipe.horas_plus * valorHora(valores, faixa, 'plus');
		return { membro, categoria, total };
	}

	// Diária: valor único, sem faixa de classe. A faixa ainda foi resolvida
	// acima porque é ela que decide a CATEGORIA do Anexo II (Delegados/Agentes).
	const valorDiaria =
		equipe.diaria_tipo === 'interestadual' ? valores.diaria_interestadual : valores.diaria_estadual;
	return { membro, categoria, total: custoDeDiarias(equipe.diarias_meias, valorDiaria) };
}

/**
 * O custo de uma equipe e de cada um dos seus membros.
 *
 * Membro sem faixa resolvida entra na lista com `categoria: null` e `total: 0`,
 * e NÃO soma. Quem transforma isso em bloqueio é `custoDoPlano`.
 */
export function custoDaEquipe(
	equipe: EquipeParaCusto,
	membros: MembroParaCusto[],
	valores: ValoresCusto
): CustoEquipe {
	const linhas = membros.map((m) => custoDoMembro(m, equipe, valores));
	return {
		equipe,
		membros: linhas,
		total: linhas.reduce((soma, l) => soma + l.total, 0)
	};
}

/** Acumula uma linha do consolidado, criando-a na primeira ocorrência. */
function acumular(destino: LinhaConsolidado[], categoria: CategoriaAnexo, total: number): void {
	const linha = destino.find((l) => l.categoria === categoria);
	if (linha) {
		linha.quantidade += 1;
		linha.total += total;
		return;
	}
	destino.push({ categoria, quantidade: 1, total });
}

/**
 * O custo do plano inteiro, com o consolidado do Anexo II e as pendências.
 *
 * `equipes` traz cada equipe já com os seus membros. A ordem de saída preserva a
 * de entrada — o Anexo I imprime as equipes na ordem em que o admin as montou.
 */
export function custoDoPlano(
	equipes: Array<{ equipe: EquipeParaCusto; membros: MembroParaCusto[] }>,
	valores: ValoresCusto
): CustoPlano {
	const calculadas = equipes.map(({ equipe, membros }) => custoDaEquipe(equipe, membros, valores));

	const dro: LinhaConsolidado[] = [];
	const diarias: LinhaConsolidado[] = [];
	const pendencias: Pendencia[] = [];
	const avisos: Pendencia[] = [];

	for (const ce of calculadas) {
		for (const linha of ce.membros) {
			if (!linha.categoria) {
				const item: Pendencia = {
					policial_id: linha.membro.policial_id,
					nome: linha.membro.nome,
					equipe: ce.equipe.nome,
					motivo: linha.membro.classe_snapshot.trim()
						? `Classe "${linha.membro.classe_snapshot}" não corresponde ao cargo ${linha.membro.cargo_snapshot || '(vazio)'}`
						: 'Servidor sem classe cadastrada'
				};
				// A MESMA falha de cadastro, em dois pesos: onde já há custo ela
				// impede a emissão; onde não há, ela é o alerta de que a equipe não
				// pode mudar de tipo de custo sem antes corrigir o cadastro. Ver o
				// JSDoc de `CustoPlano.avisos`.
				if (ce.equipe.tipo_custo === 'sem_custo') avisos.push(item);
				else pendencias.push(item);
				continue;
			}
			if (ce.equipe.tipo_custo === 'hora_extra') acumular(dro, linha.categoria, linha.total);
			else if (ce.equipe.tipo_custo === 'diaria') acumular(diarias, linha.categoria, linha.total);
		}
	}

	// Ordem fixa: Delegados antes de Agentes, como no modelo.
	const ordenar = (l: LinhaConsolidado[]) =>
		l.sort((a, b) => (a.categoria === b.categoria ? 0 : a.categoria === 'dpc' ? -1 : 1));
	ordenar(dro);
	ordenar(diarias);

	const droTotal = dro.reduce((s, l) => s + l.total, 0);
	const diariasTotal = diarias.reduce((s, l) => s + l.total, 0);

	return {
		equipes: calculadas,
		consolidado: {
			dro,
			diarias,
			droTotal,
			diariasTotal,
			totalGeral: droTotal + diariasTotal
		},
		pendencias,
		avisos,
		total: calculadas.reduce((s, ce) => s + ce.total, 0)
	};
}

/**
 * O plano pode ser emitido?
 *
 * Fonte única do gate, consultada pela tela e pelo endpoint de download — o
 * botão escondido não é autorização, e as duas precisam concordar sobre o que
 * bloqueia.
 */
export function podeEmitir(custo: CustoPlano): boolean {
	return custo.pendencias.length === 0;
}

/**
 * O acréscimo de 30% que define a hora "plus", como valor SUGERIDO.
 *
 * A tela de `/valores` usa isto para pré-preencher os quatro campos
 * `_plus` a partir dos `_normal`. **Não é aplicado no cálculo**: lá o valor lido
 * é o que está gravado na versão, justamente para um reajuste futuro na
 * alíquota não reescrever documento já emitido.
 *
 * Mora aqui, em `$lib/planos/`, e não na camada de dados — é função pura, e a
 * tela precisa dela. Enquanto estava em `$lib/db/planos/custo-parametros.ts`, o
 * import do `.svelte` arrastava `$lib/server/schema` para o bundle do browser e
 * o SvelteKit derrubava a rota inteira ("Cannot import $lib/server/schema.ts
 * into code that runs in the browser"). O `svelte-check` não vê esse erro: a
 * fronteira servidor/cliente é do bundler, não do TypeScript.
 */
export function sugerirPlus(normal: number): number {
	return Math.round(normal * 1.3);
}
