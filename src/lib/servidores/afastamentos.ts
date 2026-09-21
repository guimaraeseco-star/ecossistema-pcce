/**
 * Os tipos de afastamento do servidor — o catálogo do Ecossistema (fase 2-C,
 * migração 0088), com o rótulo de tela, a base legal, a categoria e a REGRA DE
 * PRAZO de cada um. Fontes: o Estatuto da Polícia Civil (Lei nº 12.124/93), o
 * Estatuto dos Funcionários (Lei nº 9.826/74) e a tabela que o responsável
 * montou para o sistema anterior (`Tabela_Afastamentos_Policia_Civil_CE.xlsx`,
 * "atualizada com legislações complementares, decisões do STF e o MISP"),
 * adotada em 20/09/2026 como referência do modal de afastamento.
 *
 * Mora em `lib/` (não em `lib/server/`) porque a tela de ficha, a action e o
 * Zod leem o mesmo catálogo. Os cinco valores anteriores à 0088 (`ferias`,
 * `licenca_medica`, `judicial`, `licenca_outros`, `outros`) continuam válidos:
 * linhas gravadas com eles não mudam, e a tela os mostra com o rótulo novo
 * (`licenca_medica` lê-se como LTS). Decisão do responsável em 16/09/2026:
 * NÃO criar tipos além destes — o que não couber vai em `outros` com a
 * descrição (ex.: afastamento eleitoral, aguardando aposentadoria). A única
 * exceção posterior é `luto_colateral` (20/09): o Estatuto dá 2 dias para
 * tios e cunhados, contra 8 para o 2º grau, e um tipo só não sabe qual prazo
 * travar.
 *
 * As regras que o modal aplica saem daqui, e a action as reaplica:
 *   - `dias` fixo → a quantidade vem travada e o fim é calculado;
 *   - `semPrazo` → o fim pode ficar vazio (estudante, dispensa de ponto);
 *   - `adicional` → a maternidade tem 120 dias e o servidor pode ter pedido a
 *     prorrogação de 60 (Lei 13.881/2007); a tela pergunta, e 120 vira 180;
 *   - `cid` → LTS exige a classificação do CID; CID-F dispara a Portaria
 *     39/2026/PCCE/GABDG (recolher o armamento) — aviso a quem cadastra e ao
 *     DPI SUL;
 *   - `soGestao` → as medidas disciplinares/processuais só o Admin Geral
 *     lança; a unidade não as propõe (planilha, coluna "Responsável").
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
	'luto_colateral',
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

/** As categorias da tabela do responsável — os `<optgroup>` do modal, nesta ordem. */
const CATEGORIAS_AFASTAMENTO = [
	'curta',
	'licenca',
	'particular',
	'mandato',
	'disciplinar',
	'outros'
] as const;
export type CategoriaAfastamento = (typeof CATEGORIAS_AFASTAMENTO)[number];

const ROTULO_CATEGORIA: Record<CategoriaAfastamento, string> = {
	curta: 'Autorizações de curta duração',
	licenca: 'Licenças',
	particular: 'Interesse particular',
	mandato: 'Mandato e representação',
	disciplinar: 'Medidas disciplinares / processuais',
	outros: 'Outros'
};

/** A classificação do CID numa LTS (Portaria 39/2026: CID-F recolhe o armamento). */
export const TIPOS_CID = ['CID-Outras', 'CID-F'] as const;

/** O que a Portaria 39/2026/PCCE/GABDG manda quando a LTS é por CID-F. */
export const PORTARIA_39 = {
	titulo: 'Portaria nº 39/2026/PCCE/GABDG — LTS por CID-F',
	providencias: [
		'Recolhimento imediato e obrigatório da arma de fogo institucional e acessórios sob cautela do servidor.',
		'Suspensão temporária do porte de arma de fogo até perícia médica oficial favorável da DIPEM.',
		'Comunicação imediata à COGEP, à COSAÚDE e à DTO para depósito e custódia do armamento.'
	]
} as const;

interface DescricaoSubtipo {
	rotulo: string;
	/** Artigo do Estatuto (Lei 12.124/93) ou norma que o prevê — para a tela e o documento. */
	base: string;
	/** A observação que a tela mostra ao lado da base legal. */
	obs: string;
	categoria: CategoriaAfastamento;
	/**
	 * Aparece no modal de afastamento? Os valores legados não: só se leem. As
	 * FÉRIAS também não (decisão dele, 20/09): entram só pelo cartão Férias da
	 * ficha, que é quem mantém a programação, a reprogramação e o abono — um
	 * evento de férias lançado por aqui ficaria sem fração e fora do controle.
	 */
	cadastravel: boolean;
	/** Prazo FIXO em dias: a tela trava a quantidade e calcula o fim. `null` = o usuário informa. */
	dias: number | null;
	/** Prorrogação opcional (maternidade: +60), somada a `dias` quando o servidor a pediu. */
	adicional?: number;
	/** Sem prazo definido: o fim pode ficar vazio, com aviso. */
	semPrazo?: boolean;
	/** Exige a classificação do CID (LTS). */
	cid?: boolean;
	/** Só o Admin Geral lança; a unidade não propõe. */
	soGestao?: boolean;
}

export const AFASTAMENTOS: Record<SubtipoAfastamento, DescricaoSubtipo> = {
	ferias: {
		rotulo: 'Férias',
		base: 'Art. 60 e Dec. Estadual nº 32.907/2018',
		obs: 'Entram pelo cartão Férias da ficha.',
		categoria: 'outros',
		cadastravel: false,
		dias: null
	},
	casamento: {
		rotulo: 'Casamento (gala)',
		base: "Art. 39, I, 'c' e Art. 55, § 1º, II",
		obs: '8 dias consecutivos. Conta como efetivo exercício.',
		categoria: 'curta',
		cadastravel: true,
		dias: 8
	},
	luto: {
		rotulo: 'Luto / nojo — parentes até 2º grau',
		base: "Art. 39, I, 'd' e Art. 55, § 1º, III",
		obs: '8 dias consecutivos. Falecimento de cônjuge, ascendentes, descendentes, irmãos, madrasta, padrasto e pais adotivos. Conta como efetivo exercício.',
		categoria: 'curta',
		cadastravel: true,
		dias: 8
	},
	luto_colateral: {
		rotulo: 'Luto / nojo — tios e cunhados',
		base: 'Art. 55, § 1º, IV',
		obs: '2 dias consecutivos. Falecimento de parentes colaterais/afins (tios e cunhados). Conta como efetivo exercício.',
		categoria: 'curta',
		cadastravel: true,
		dias: 2
	},
	paternidade: {
		rotulo: 'Paternidade',
		base: "Art. 39, I, 'e' e Art. 55, § 1º, XVI",
		obs: '20 dias consecutivos — prazo estatuído no Executivo Estadual.',
		categoria: 'curta',
		cadastravel: true,
		dias: 20
	},
	estudante: {
		rotulo: 'Estudante (frequência a curso)',
		base: 'Art. 39, § 1º',
		obs: 'Até 2 horas diárias, para servidor matriculado em curso oficial de 2º grau ou ensino superior. Sem prazo definido: informe o fim quando houver.',
		categoria: 'curta',
		cadastravel: true,
		dias: null,
		semPrazo: true
	},
	dispensa_ponto: {
		rotulo: 'Dispensa de ponto',
		base: 'Art. 39, § 2º',
		obs: 'Somente os dias de realização de exames para ingresso em serviço público ou provas escolares. Sem prazo definido: informe o fim quando houver.',
		categoria: 'curta',
		cadastravel: true,
		dias: null,
		semPrazo: true
	},
	cessao: {
		rotulo: 'Cessão a outro órgão',
		base: "Art. 39, I, 'b' e Art. 55, § 1º, XIX",
		obs: 'Autorizada expressamente pelo Delegado-Geral; conta como efetivo exercício.',
		categoria: 'curta',
		cadastravel: true,
		dias: null
	},
	lts: {
		rotulo: 'Tratamento de saúde (LTS ordinária)',
		base: 'Art. 62, I, § 5º e Art. 63',
		obs: 'Conforme perícia médica oficial. Após 24 meses: retorno, prorrogação excepcional ou aposentadoria.',
		categoria: 'licenca',
		cadastravel: true,
		dias: null,
		cid: true
	},
	acompanhamento_familiar: {
		rotulo: 'Acompanhamento de familiar',
		base: 'Art. 62, III e Art. 65',
		obs: 'Assistência indispensável a cônjuge, ascendente, descendente ou dependente.',
		categoria: 'licenca',
		cadastravel: true,
		dias: null
	},
	maternidade: {
		rotulo: 'Maternidade / gestante',
		base: 'Art. 66 c/c Lei Estadual nº 13.881/2007',
		obs: '120 dias, a partir do 8º mês ou do nascimento; prorrogáveis por mais 60 a pedido da servidora.',
		categoria: 'licenca',
		cadastravel: true,
		dias: 120,
		adicional: 60
	},
	adotante: {
		rotulo: 'Adotante',
		base: 'LC Estadual nº 38/2003 c/c STF RE 778.889',
		obs: '180 dias — o STF equiparou integralmente aos prazos e prorrogações da licença-maternidade.',
		categoria: 'licenca',
		cadastravel: true,
		dias: 180
	},
	lip: {
		rotulo: 'Trato de interesses particulares (LIP)',
		base: 'Art. 38 e Art. 40',
		obs: 'Exige 2 anos de efetivo exercício prévio e 2 anos de carência para novo pedido. Não conta tempo de serviço.',
		categoria: 'particular',
		cadastravel: true,
		dias: null
	},
	mandato_eletivo: {
		rotulo: 'Exercício de mandato eletivo',
		base: 'Art. 29, II e Art. 55, § 1º, XI',
		obs: 'Afastamento legal com regras constitucionais de opção remuneratória.',
		categoria: 'mandato',
		cadastravel: true,
		dias: null
	},
	mandato_sindical: {
		rotulo: 'Mandato sindical / classista',
		base: 'Art. 55, § 1º, XXIV c/c EC Estadual 72/11',
		obs: 'Conta como efetivo exercício do cargo.',
		categoria: 'mandato',
		cadastravel: true,
		dias: null
	},
	afastamento_preventivo: {
		rotulo: 'Afastamento preventivo (cautelar)',
		base: 'Art. 113 c/c Lei 12.815/98 e LC 98/2011',
		obs: 'Medida preventiva de interesse da coletividade (não é punição). Perde verbas eventuais/plantões.',
		categoria: 'disciplinar',
		cadastravel: true,
		dias: null,
		soGestao: true
	},
	suspensao: {
		rotulo: 'Suspensão disciplinar',
		base: 'Art. 106',
		obs: 'Pode ser convertida em multa de 50 % dos vencimentos com permanência em serviço.',
		categoria: 'disciplinar',
		cadastravel: true,
		dias: null,
		soGestao: true
	},
	prisao_denuncia: {
		rotulo: 'Prisão penal / civil ou denúncia funcional',
		base: 'Art. 40, § 5º, I e Art. 72, § 2º, III',
		obs: 'Restituição da diferença retida caso venha a ser absolvido ao final.',
		categoria: 'disciplinar',
		cadastravel: true,
		dias: null,
		soGestao: true
	},
	condenacao: {
		rotulo: 'Condenação criminal definitiva (sem demissão)',
		base: 'Art. 40, § 5º, III e Art. 72, § 2º, IV',
		obs: 'Afastamento decorrente de prisão penal definitiva sem aplicação de demissão.',
		categoria: 'disciplinar',
		cadastravel: true,
		dias: null,
		soGestao: true
	},
	outros: {
		rotulo: 'Outros',
		base: '',
		obs: 'O que não cabe nos tipos acima — descreva no motivo (ex.: afastamento eleitoral, aguardando aposentadoria).',
		categoria: 'outros',
		cadastravel: true,
		dias: null
	},
	licenca_medica: {
		rotulo: 'Tratamento de saúde (LTS ordinária)',
		base: 'Art. 62, I, § 5º e Art. 63',
		obs: '',
		categoria: 'licenca',
		cadastravel: false,
		dias: null
	},
	judicial: {
		rotulo: 'Afastamento judicial',
		base: '',
		obs: '',
		categoria: 'disciplinar',
		cadastravel: false,
		dias: null
	},
	licenca_outros: {
		rotulo: 'Outra licença',
		base: '',
		obs: '',
		categoria: 'licenca',
		cadastravel: false,
		dias: null
	}
};

/** Os subtipos que a tela de cadastro oferece, na ordem do catálogo. */
export const SUBTIPOS_CADASTRAVEIS = SUBTIPOS_AFASTAMENTO.filter(
	(s) => AFASTAMENTOS[s].cadastravel
);

/**
 * Os subtipos que um PERFIL pode lançar, por categoria, na ordem do modal.
 * A unidade não vê as medidas disciplinares; o Admin Geral vê tudo.
 */
export function subtiposPorCategoria(
	gestao: boolean
): { categoria: CategoriaAfastamento; rotulo: string; subtipos: SubtipoAfastamento[] }[] {
	return CATEGORIAS_AFASTAMENTO.map((categoria) => ({
		categoria,
		rotulo: ROTULO_CATEGORIA[categoria],
		subtipos: SUBTIPOS_CADASTRAVEIS.filter(
			(s) => AFASTAMENTOS[s].categoria === categoria && (gestao || !AFASTAMENTOS[s].soGestao)
		)
	})).filter((g) => g.subtipos.length > 0);
}

/** A regra de prazo de um subtipo, já resolvida para a tela e a action. */
export interface RegraDePrazo {
	/** Quantidade travada, ou `null` quando o usuário informa. */
	diasFixos: number | null;
	semPrazo: boolean;
	exigeCid: boolean;
	soGestao: boolean;
}

/**
 * Resolve o prazo de um subtipo. `comAdicional` só importa onde há
 * prorrogação (maternidade): 120 + 60.
 */
export function regraDePrazo(subtipo: SubtipoAfastamento, comAdicional = false): RegraDePrazo {
	const d = AFASTAMENTOS[subtipo];
	const diasFixos =
		d.dias == null ? null : d.adicional && comAdicional ? d.dias + d.adicional : d.dias;
	return {
		diasFixos,
		semPrazo: !!d.semPrazo,
		exigeCid: !!d.cid,
		soGestao: !!d.soGestao
	};
}

/**
 * Valida um NUP: 17 dígitos (00000.000000/0000-00), como o SEI do Estado
 * emite. Devolve os dígitos e a forma pontuada, ou o erro para a tela.
 */
export function conferirNup(
	bruto: string,
	obrigatorio: boolean
): { ok: true; digitos: string; formatado: string } | { ok: false; erro: string } {
	const digitos = String(bruto ?? '').replace(/\D/g, '');
	if (digitos.length === 0) {
		return obrigatorio
			? { ok: false, erro: 'O NUP do processo é obrigatório neste afastamento.' }
			: { ok: true, digitos: '', formatado: '' };
	}
	if (digitos.length !== 17) {
		return {
			ok: false,
			erro: `O NUP tem 17 dígitos (ex.: 10051.028034/2026-64); foram informados ${digitos.length}.`
		};
	}
	return {
		ok: true,
		digitos,
		formatado: `${digitos.slice(0, 5)}.${digitos.slice(5, 11)}/${digitos.slice(11, 15)}-${digitos.slice(15, 17)}`
	};
}

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
