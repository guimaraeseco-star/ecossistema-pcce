/**
 * O que a UNIDADE pode liberar para o seu colaborador (E61, 21/09/2026).
 *
 * Catálogo FECHADO: cada chave é uma caixa de marcar na ficha da unidade, e o
 * portão de rotas (`colaborador-rotas.ts`), o escopo (`lotacoesAdministradas`)
 * e cada action perguntam por ela. Tudo o que o colaborador alcança está
 * recortado à unidade em que está lotado (`colaboradores.unidade_id`), e nada
 * aqui DECIDE: o colaborador propõe o que o admin da unidade proporia, e quem
 * decide continua sendo o DPI SUL / a seccional / o Admin Geral.
 *
 * Fora do catálogo, de propósito: montar escala (a decisão dele: só ver),
 * propor direção (não é ato da unidade — é da seccional), assinatura, GISE,
 * patrimônio, dados pessoais dos servidores e pedidos para si.
 *
 * Módulo puro: importável por componentes (só tipos e constantes).
 */

export const ACESSOS_DO_COLABORADOR = [
	{
		chave: 'servidores.ver',
		rotulo: 'Ver os servidores da unidade',
		descricao: 'Lista e ficha dos servidores lotados na unidade. Base para as demais.'
	},
	{
		chave: 'servidores.cadastro',
		rotulo: 'Propor alteração de cadastro',
		descricao: 'Pede correção de dados do servidor (nome, cargo, contato…) — o Admin Geral decide.'
	},
	{
		chave: 'servidores.afastamento',
		rotulo: 'Propor afastamento',
		descricao:
			'Pede afastamento (LTS, licenças, dispensa…) e retorno antecipado — o Admin Geral decide.'
	},
	{
		chave: 'servidores.ferias',
		rotulo: 'Férias',
		descricao:
			'Lança a programação, pede reprogramação à COGEP, homologa a resposta e dá ciência de abono.'
	},
	{
		chave: 'escalas.ver',
		rotulo: 'Ver as escalas',
		descricao: 'Só leitura das escalas ordinárias da unidade — não monta nem altera.'
	},
	{
		chave: 'avisos.ler',
		rotulo: 'Ler os avisos da unidade',
		descricao: 'A caixa de avisos e pendências da unidade; pode marcar como lido.'
	}
] as const;

export type AcessoDoColaborador = (typeof ACESSOS_DO_COLABORADOR)[number]['chave'];

/** As chaves, para validar o que chega do formulário. */
export const CHAVES_DE_ACESSO: readonly AcessoDoColaborador[] = ACESSOS_DO_COLABORADOR.map(
	(a) => a.chave
);

/** `true` quando a string é uma chave do catálogo. */
export function ehChaveDeAcesso(v: string): v is AcessoDoColaborador {
	return (CHAVES_DE_ACESSO as readonly string[]).includes(v);
}

/**
 * As chaves que dependem de `servidores.ver`: sem ver a ficha, não há onde
 * propor. Marcar uma delas marca a base junto; desmarcar a base derruba todas.
 */
const DEPENDEM_DE_VER: readonly AcessoDoColaborador[] = [
	'servidores.cadastro',
	'servidores.afastamento',
	'servidores.ferias'
];

/** Normaliza o conjunto marcado: dedup, só chaves válidas, base implícita. */
export function normalizarAcessos(marcadas: readonly string[]): AcessoDoColaborador[] {
	const set = new Set<AcessoDoColaborador>();
	for (const m of marcadas) if (ehChaveDeAcesso(m)) set.add(m);
	if (DEPENDEM_DE_VER.some((c) => set.has(c))) set.add('servidores.ver');
	return CHAVES_DE_ACESSO.filter((c) => set.has(c));
}

/** O rótulo de uma chave, para avisos e relatórios. */
export function rotuloDoAcesso(chave: AcessoDoColaborador): string {
	return ACESSOS_DO_COLABORADOR.find((a) => a.chave === chave)?.rotulo ?? chave;
}

/** O que mudou entre dois conjuntos — o texto do aviso à unidade. */
export function diferencaDeAcessos(
	antes: readonly string[],
	depois: readonly string[]
): { concedidas: AcessoDoColaborador[]; retiradas: AcessoDoColaborador[] } {
	const a = new Set(antes);
	const d = new Set(depois);
	return {
		concedidas: CHAVES_DE_ACESSO.filter((c) => d.has(c) && !a.has(c)),
		retiradas: CHAVES_DE_ACESSO.filter((c) => a.has(c) && !d.has(c))
	};
}
