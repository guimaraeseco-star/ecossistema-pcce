/**
 * Os tipos de afastamento do servidor — o catálogo do Ecossistema (fase 2-C,
 * migração 0088), com o rótulo de tela e a base no Estatuto da Polícia Civil
 * (Lei nº 12.124/93) ou no Estatuto dos Funcionários (Lei nº 9.826/74).
 *
 * Mora em `lib/` (não em `lib/server/`) porque a tela de ficha e o Zod leem o
 * mesmo catálogo. Os cinco valores anteriores à 0088 (`ferias`,
 * `licenca_medica`, `judicial`, `licenca_outros`, `outros`) continuam válidos:
 * linhas gravadas com eles não mudam, e a tela os mostra com o rótulo novo
 * (`licenca_medica` lê-se como LTS). Decisão do responsável em 16/09/2026:
 * NÃO criar tipos além destes — o que não couber vai em `outros` com a
 * descrição (ex.: afastamento eleitoral, aguardando aposentadoria).
 */

export const SUBTIPOS_AFASTAMENTO = [
	'ferias',
	'lts',
	'acompanhamento_familiar',
	'maternidade',
	'adotante',
	'paternidade',
	'casamento',
	'luto',
	'estudante',
	'dispensa_ponto',
	'cessao',
	'lip',
	'mandato_eletivo',
	'mandato_sindical',
	'afastamento_preventivo',
	'suspensao',
	'prisao_denuncia',
	'condenacao',
	'outros',
	// Valores anteriores à 0088, mantidos para as linhas já gravadas.
	'licenca_medica',
	'judicial',
	'licenca_outros'
] as const;

export type SubtipoAfastamento = (typeof SUBTIPOS_AFASTAMENTO)[number];

interface DescricaoSubtipo {
	rotulo: string;
	/** Artigo do Estatuto (Lei 12.124/93) ou norma que o prevê — para a tela e o documento. */
	base: string;
	/** Aparece no cadastro? Os valores legados não: só se leem. */
	cadastravel: boolean;
}

export const AFASTAMENTOS: Record<SubtipoAfastamento, DescricaoSubtipo> = {
	ferias: { rotulo: 'Férias', base: '', cadastravel: true },
	lts: {
		rotulo: 'Licença para tratamento de saúde (LTS)',
		base: 'arts. 62, I e 63',
		cadastravel: true
	},
	acompanhamento_familiar: {
		rotulo: 'Licença por doença em pessoa da família',
		base: 'arts. 62, III e 65',
		cadastravel: true
	},
	maternidade: {
		rotulo: 'Licença-maternidade (gestante)',
		base: 'art. 66 (120 + 60 dias)',
		cadastravel: true
	},
	adotante: { rotulo: 'Licença-adotante', base: 'Lei 9.826/74', cadastravel: true },
	paternidade: {
		rotulo: 'Paternidade (5 dias)',
		base: 'arts. 39, I, e e 62, VII',
		cadastravel: true
	},
	casamento: { rotulo: 'Casamento (8 dias)', base: 'art. 39, I, c', cadastravel: true },
	luto: { rotulo: 'Luto — até 2º grau (8 dias)', base: 'art. 39, I, d', cadastravel: true },
	estudante: {
		rotulo: 'Estudo, curso ou missão',
		base: 'art. 39, I, a/b; Decreto 25.851/2000',
		cadastravel: true
	},
	dispensa_ponto: { rotulo: 'Dispensa de ponto', base: '', cadastravel: true },
	cessao: {
		rotulo: 'Cessão a outro órgão',
		base: 'art. 39, III; Decreto 32.960/2019',
		cadastravel: true
	},
	lip: {
		rotulo: 'Licença para interesse particular (LIP)',
		base: 'arts. 35, III, 38 e 40',
		cadastravel: true
	},
	mandato_eletivo: { rotulo: 'Mandato eletivo', base: 'art. 47, I', cadastravel: true },
	mandato_sindical: { rotulo: 'Mandato sindical', base: '', cadastravel: true },
	afastamento_preventivo: {
		rotulo: 'Afastamento preventivo',
		base: 'art. 40, § 5º, II',
		cadastravel: true
	},
	suspensao: { rotulo: 'Suspensão disciplinar', base: 'art. 40, § 5º, II', cadastravel: true },
	prisao_denuncia: {
		rotulo: 'Prisão ou denúncia por crime funcional',
		base: 'art. 40, § 5º, I',
		cadastravel: true
	},
	condenacao: {
		rotulo: 'Condenação criminal definitiva',
		base: 'art. 40, § 5º, III',
		cadastravel: true
	},
	outros: { rotulo: 'Outros', base: '', cadastravel: true },
	licenca_medica: {
		rotulo: 'Licença para tratamento de saúde (LTS)',
		base: 'arts. 62, I e 63',
		cadastravel: false
	},
	judicial: { rotulo: 'Afastamento judicial', base: '', cadastravel: false },
	licenca_outros: { rotulo: 'Outra licença', base: '', cadastravel: false }
};

/** Os subtipos que a tela de cadastro oferece, na ordem do catálogo. */
export const SUBTIPOS_CADASTRAVEIS = SUBTIPOS_AFASTAMENTO.filter(
	(s) => AFASTAMENTOS[s].cadastravel
);

/** Rótulo de tela; um valor desconhecido (nunca deveria) volta como está. */
export function rotuloAfastamento(subtipo: string): string {
	return AFASTAMENTOS[subtipo as SubtipoAfastamento]?.rotulo ?? subtipo;
}

/** A situação de hoje de um servidor: ativo, de férias ou afastado por outro motivo. */
export type SituacaoServidor = 'ativo' | 'ferias' | 'afastado';

/**
 * Classe Tailwind do selo/número de cada situação — férias em DOURADO e
 * afastado em VERMELHO em todas as telas (pedido do responsável, 15/09/2026).
 */
export const COR_SITUACAO: Record<SituacaoServidor, string> = {
	ativo: 'text-primary-700 dark:text-primary-400',
	ferias: 'text-warning-600 dark:text-warning-400',
	afastado: 'text-error-600 dark:text-error-400'
};

export const ROTULO_SITUACAO: Record<SituacaoServidor, string> = {
	ativo: 'Ativo',
	ferias: 'Férias',
	afastado: 'Afastado'
};
