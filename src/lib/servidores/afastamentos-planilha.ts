/**
 * A planilha `afastamentos.xlsx` (fase 2-C, 16/09/2026) — a fonte MAIS
 * ORGANIZADA dos afastamentos: SERVIDOR · DATA INICIAL · DIAS · DATA FINAL ·
 * TIPO DE AFASTAMENTO · CID · TIPO · STATUS · NUP, com as datas coerentes
 * (fim = início + dias − 1 em 533 de 533 linhas).
 *
 * Decisão do responsável: onde ela e o HISTORICO falarem do MESMO afastamento,
 * vale esta; o que só existe no histórico permanece. "Mesmo afastamento" é
 * período que se SOBREPÕE (não datas idênticas) — a planilha corrige datas, e
 * exigir igualdade criaria dois registros do mesmo fato.
 *
 * A coluna TIPO DE AFASTAMENTO é campo livre e virou caderno de recados: além
 * dos afastamentos de verdade ("MÉDICO", "LICENÇA PATERNIDADE", "LUTO"…), traz
 * pedidos de movimentação ("TRANSFERIR PARA A DDM TAUÁ", "MUDAR AIS") e
 * lembretes ("APTO COM PORTE", "VERIFICAR A DATA", "RECURSO"). Por isso a
 * classificação devolve três destinos, e só o primeiro vira afastamento:
 *   - `afastamento` com subtipo dos 19 do Estatuto;
 *   - `movimentacao` (transferência/permuta/mudança de AIS pedida);
 *   - `observacao` (o resto, com o texto original) — inclusive exoneração,
 *     aposentadoria e demissão, que são desvinculação e não afastamento.
 *
 * Sem dependência de `$lib` nem de servidor: o script de carga importa daqui.
 */

type DestinoDaLinha = 'afastamento' | 'movimentacao' | 'observacao';

export interface ClassificacaoAfastamento {
	destino: DestinoDaLinha;
	/** Só quando `destino === 'afastamento'`: o subtipo do catálogo. */
	subtipo?: string;
}

const semAcento = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Nome "sanitizado" para casar planilha × cadastro: sem acento, em maiúsculas,
 * sem pontuação e sem as partículas (DE/DA/DO/DOS/DAS/E) — é o que absorve
 * "MARIA DE SOUSA" × "MARIA SOUSA" sem juntar pessoas diferentes.
 */
export function nomeSanitizado(nome: string): string {
	return semAcento(nome)
		.replace(/[^A-Z\s]/g, ' ')
		.split(/\s+/)
		.filter((p) => p && !['DE', 'DA', 'DO', 'DOS', 'DAS', 'E'].includes(p))
		.join(' ')
		.trim();
}

/** Grafias erradas incluídas de propósito: a planilha é digitada à mão. */
const REGRAS: Array<[RegExp, ClassificacaoAfastamento]> = [
	// Movimentações pedidas/registradas (a linha não é afastamento).
	[
		/TRANSFER|TRASFER|TRANFER|PERMUT|MUDAR (A )?AIS|MUDAR PARA|ALTERAR A AIS|INCLUIR AIS|VERIFICAR AIS|TROCAR D|PASSADO A|SOLICITADO|ESTA EM /,
		{ destino: 'movimentacao' }
	],
	// Desvinculação e situação funcional: anotação, nunca afastamento.
	[/EXONERA|DEMISS|DEMITID|APOSENTAD|FALECIMENTO/, { destino: 'observacao' }],
	[/APTO|RETORNO AO TRABALHO|RECURSO|VERIFICAR/, { destino: 'observacao' }],
	// Afastamentos de verdade.
	[/MEDICO|MEDICA|ATESTADO|SAUDE|LTS/, { destino: 'afastamento', subtipo: 'lts' }],
	[
		/PATERNIDADE|PATERNINDADE|PARTERNIDADE|PATERNIDDE/,
		{ destino: 'afastamento', subtipo: 'paternidade' }
	],
	[/GESTANTE|MATERNIDADE/, { destino: 'afastamento', subtipo: 'maternidade' }],
	[/ADOTANTE|ADOCAO/, { destino: 'afastamento', subtipo: 'adotante' }],
	[
		/ACOMPANH|FAMILIAR|PESSOA DA FAMILIA/,
		{ destino: 'afastamento', subtipo: 'acompanhamento_familiar' }
	],
	[/NOJO|LUTO/, { destino: 'afastamento', subtipo: 'luto' }],
	[/CASAMENTO|CASMENTO|GALA/, { destino: 'afastamento', subtipo: 'casamento' }],
	[/DISPENSA DE PONTO|FOLGA/, { destino: 'afastamento', subtipo: 'dispensa_ponto' }],
	[/INTERESSE PARTICULAR|\bLIP\b/, { destino: 'afastamento', subtipo: 'lip' }],
	[/CEDID|CESSAO|A DISPOSICAO/, { destino: 'afastamento', subtipo: 'cessao' }],
	[/ELEITORAL|MANDATO/, { destino: 'afastamento', subtipo: 'outros' }],
	[/CURSO|CAPACITACAO|ESTUDO/, { destino: 'afastamento', subtipo: 'estudante' }],
	[/FERIAS/, { destino: 'afastamento', subtipo: 'ferias' }],
	[
		/PREVENTIV|SUSPENS|PRISAO|CONDENA/,
		{ destino: 'afastamento', subtipo: 'afastamento_preventivo' }
	],
	[/LICENCA/, { destino: 'afastamento', subtipo: 'lts' }],
	[/ADM(INISTRATIVO)?\b/, { destino: 'afastamento', subtipo: 'outros' }]
];

/**
 * TIPO DE AFASTAMENTO (texto livre) → destino e subtipo. Texto vazio ou que
 * não casa com nada vira anotação: melhor guardar a frase do que inventar um
 * afastamento que ninguém escreveu.
 */
export function classificarTipoAfastamento(texto: string): ClassificacaoAfastamento {
	const t = semAcento(texto);
	if (!t) return { destino: 'observacao' };
	for (const [re, r] of REGRAS) if (re.test(t)) return r;
	return { destino: 'observacao' };
}

/** Dois períodos se sobrepõem? Fim vazio = aberto. */
export function periodosSeSobrepoem(
	a: { inicio: string; fim?: string | null },
	b: { inicio: string; fim?: string | null }
): boolean {
	const fimA = a.fim || '9999-12-31';
	const fimB = b.fim || '9999-12-31';
	return a.inicio <= fimB && b.inicio <= fimA;
}
