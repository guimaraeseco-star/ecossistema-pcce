/**
 * Schemas dos eventos de histórico funcional — movimentação, afastamento,
 * desvinculação.
 *
 * O que estes schemas guardam é a diferença entre um registro de RH e uma
 * anotação solta: NUP no formato oficial, faixa de dias que não aceita 3650+,
 * subtipo em enum. O histórico funcional é consultado anos depois para
 * fundamentar decisão administrativa, e campo livre ali vira registro que
 * ninguém consegue interpretar nem contestar.
 *
 * `nupSchema` aceita string vazia de propósito: nem todo evento tem processo
 * associado, e exigir um faria o operador inventar número para conseguir
 * salvar — que é pior que o campo em branco.
 */
import { z } from 'zod';

/**
 * NUP (Número Único de Protocolo) no formato `00000.000000/0000-00`. Opcional:
 * nem todo registro histórico tem um processo associado. Aceita string vazia.
 */
const nupSchema = z
	.string()
	.trim()
	.regex(/^\d{5}\.\d{6}\/\d{4}-\d{2}$/, 'NUP inválido (use 00000.000000/0000-00)')
	.or(z.literal(''))
	.optional()
	.nullable();

/** Data no formato ISO `YYYY-MM-DD` (input type="date"). */
const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

// O catálogo mora em `$lib/servidores/afastamentos` (fase 2-C): 19 tipos do
// Estatuto mais os valores legados; o cadastro só oferece os cadastráveis.
export { SUBTIPOS_AFASTAMENTO } from '$lib/servidores/afastamentos';
import { AFASTAMENTOS, SUBTIPOS_AFASTAMENTO, TIPOS_CID } from '$lib/servidores/afastamentos';

export const movimentacaoSchema = z.object({
	unidade_destino: z
		.string()
		.trim()
		.min(1, 'Informe a unidade de destino')
		.max(200, 'Unidade muito longa'),
	data_evento: dataISO,
	nup: nupSchema
});

export const afastamentoSchema = z.object({
	subtipo: z.enum(SUBTIPOS_AFASTAMENTO, { message: 'Tipo de afastamento inválido' }),
	descricao: z.string().trim().max(500, 'Descrição muito longa').optional().nullable(),
	data_inicio: dataISO,
	/** Vazio só nos tipos sem prazo (estudante, dispensa de ponto) — a action confere. */
	data_fim: dataISO.optional().or(z.literal('')),
	qtd_dias: z.coerce.number().int().min(1, 'Quantidade de dias inválida').max(3650).optional(),
	nup: nupSchema,
	/** LTS: a classificação do CID (Portaria 39/2026). */
	tipo_cid: z.enum(TIPOS_CID).optional().or(z.literal('')),
	/** Maternidade: a servidora pediu a prorrogação de 60 dias. */
	adicional: z.coerce.boolean().optional()
});

export const desvinculacaoSchema = z.object({
	destino: z
		.string()
		.trim()
		.min(1, 'Informe o destino do policial')
		.max(200, 'Destino muito longo'),
	data_evento: dataISO,
	nup: nupSchema
});

/**
 * Rótulos PT-BR dos subtipos de afastamento — derivados do catálogo de
 * `$lib/servidores/afastamentos`, que é a fonte única desde a fase 2-C.
 */
export const LABEL_SUBTIPO_AFASTAMENTO: Record<(typeof SUBTIPOS_AFASTAMENTO)[number], string> =
	Object.fromEntries(SUBTIPOS_AFASTAMENTO.map((s) => [s, AFASTAMENTOS[s].rotulo])) as Record<
		(typeof SUBTIPOS_AFASTAMENTO)[number],
		string
	>;
