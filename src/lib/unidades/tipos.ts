/**
 * Catálogo dos TIPOS de unidade — a árvore do organograma da Polícia Civil do
 * Ceará (Decreto 37.465, DOE 03/07/2026), fonte única para o enum do schema,
 * o Zod de `/unidades`, os rótulos da interface e a régua de "quem pode ser
 * pai de quem".
 *
 * Até set/2026 o sistema conhecia quatro tipos (departamento, subdepartamento,
 * seccional, delegacia) porque nasceu para um departamento só. A fase 1 do
 * Ecossistema (decisão E23) abre a árvore para a corporação: a raiz é a
 * Delegacia-Geral; departamentos territoriais têm seccionais; departamentos
 * especializados ligam delegacia direto a si; abaixo vêm células, seções,
 * núcleos e unidades. Nada do que se constrói pode contar níveis fixos — a
 * pergunta certa é sempre "está abaixo de", respondida andando na árvore
 * (`$lib/db/unidades`: `ancestraisDe`, `departamentoDe`).
 *
 * `nivel` é uma ORDEM de precedência, não um degrau obrigatório: delegacia
 * (nível 40) pode pender de seccional (30) ou direto de departamento (20).
 * A única regra é que o pai tenha nível MENOR que o filho — um departamento
 * não pende de uma delegacia.
 *
 * Mora em `lib/` e não em `lib/server/` porque a tela de unidades também lê o
 * catálogo; são dados puros, sem dependência de servidor.
 */

export const TIPOS_UNIDADE = [
	{ valor: 'delegacia_geral', rotulo: 'Delegacia-Geral', nivel: 0, corporativo: true },
	{ valor: 'diretoria', rotulo: 'Diretoria', nivel: 10, corporativo: true },
	{ valor: 'coordenadoria', rotulo: 'Coordenadoria', nivel: 10, corporativo: true },
	{ valor: 'corregedoria', rotulo: 'Corregedoria', nivel: 10, corporativo: true },
	{ valor: 'departamento', rotulo: 'Departamento', nivel: 20, corporativo: false },
	{ valor: 'sub_departamento', rotulo: 'Subdepartamento', nivel: 25, corporativo: false },
	{ valor: 'seccional', rotulo: 'Seccional', nivel: 30, corporativo: false },
	{ valor: 'delegacia', rotulo: 'Delegacia', nivel: 40, corporativo: false },
	{ valor: 'celula', rotulo: 'Célula', nivel: 50, corporativo: false },
	{ valor: 'secao', rotulo: 'Seção', nivel: 50, corporativo: false },
	{ valor: 'nucleo', rotulo: 'Núcleo', nivel: 50, corporativo: false },
	{ valor: 'unidade', rotulo: 'Unidade', nivel: 50, corporativo: false }
] as const;

export type TipoUnidade = (typeof TIPOS_UNIDADE)[number]['valor'];

/** Os valores, na ordem do catálogo — para `z.enum` e para o enum do Drizzle. */
export const TIPO_UNIDADE_VALORES = TIPOS_UNIDADE.map((t) => t.valor) as [
	TipoUnidade,
	...TipoUnidade[]
];

/** Os quatro tipos que existiam antes da fase 1 — o que a tela de cadastro ainda oferece. */
export const TIPOS_UNIDADE_LEGADOS = [
	'departamento',
	'sub_departamento',
	'seccional',
	'delegacia'
] as const satisfies readonly TipoUnidade[];

const POR_VALOR = new Map(TIPOS_UNIDADE.map((t) => [t.valor, t]));

/** Rótulo para a interface; tipo desconhecido volta como está, para não esconder dado. */
export function rotuloTipoUnidade(tipo: string): string {
	return POR_VALOR.get(tipo as TipoUnidade)?.rotulo ?? tipo;
}

/** Ordem de precedência (menor = mais alto na árvore); desconhecido vai para o fim. */
export function nivelTipoUnidade(tipo: string): number {
	return POR_VALOR.get(tipo as TipoUnidade)?.nivel ?? 99;
}

/**
 * Um tipo pode ser pai de outro quando está ACIMA dele na precedência. Mesmo
 * nível não pode (célula não pende de seção), e a raiz não tem pai.
 */
export function podeSerPaiDe(tipoPai: string, tipoFilho: string): boolean {
	return nivelTipoUnidade(tipoPai) < nivelTipoUnidade(tipoFilho);
}

/**
 * Abrangência padrão de um tipo (decisão E26): órgãos de direção, gerência
 * superior e execução instrumental (Delegacia-Geral, diretorias,
 * coordenadorias, corregedoria) veem a corporação inteira; o resto vê a
 * própria subárvore. É só o PADRÃO — a coluna `unidades.abrangencia` é o que
 * vale, e o Super Admin pode marcar exceções.
 */
export function abrangenciaPadrao(tipo: string): 'departamental' | 'corporativa' {
	return POR_VALOR.get(tipo as TipoUnidade)?.corporativo ? 'corporativa' : 'departamental';
}
