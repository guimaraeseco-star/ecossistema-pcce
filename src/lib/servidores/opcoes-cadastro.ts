/**
 * As opções fixas das caixas de escolha do cadastro de servidor (E76, etapa
 * 2), num lugar só: a ficha (`/servidores/[id]`) e a janela de cadastro
 * (`/servidores`) mostram as mesmas, e antes cada uma tinha a sua cópia.
 */

export const OPCOES_CARGO = [
	{ value: 'DPC', label: 'DPC - Delegado' },
	{ value: 'OIP', label: 'OIP - Investigador' }
];

export const OPCOES_REGIME = [
	{ value: 'plantao', label: 'Plantão' },
	{ value: 'expediente', label: 'Expediente' }
];

/** O papel administrativo. "Servidor (sem papel)" é o vazio — vai como `opcaoVazia`. */
export const OPCOES_PAPEL = [
	{ value: 'admin_seccional', label: 'Admin Seccional' },
	{ value: 'admin_unidade', label: 'Admin Unidade' }
];

/**
 * As classes do cargo e, se a pessoa está numa classe que o cargo não oferece
 * mais (cadastro antigo), essa também — marcada "(Atual)". Sem ela, a caixa não
 * acharia o valor e o campo apareceria vazio.
 */
export function opcoesDeClasse(
	disponiveis: readonly string[],
	atual: string
): { value: string; label: string }[] {
	const opcoes = disponiveis.map((c) => ({ value: c, label: c }));
	return atual && !disponiveis.includes(atual)
		? [...opcoes, { value: atual, label: `${atual} (Atual)` }]
		: opcoes;
}
