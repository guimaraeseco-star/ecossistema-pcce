/**
 * O COMPLEMENTO que a carga da planilha de pessoal manda junto de cada
 * servidor no webhook `sync-policiais` (fase 2-C): os campos da 0088 e o
 * evento de afastamento da linha. Tudo opcional — o Apps Script antigo não
 * manda nada disto, e `undefined` significa "não mexe".
 */
import { z } from 'zod';
import { SUBTIPOS_AFASTAMENTO } from '$lib/servidores/afastamentos';

const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)');

const afastamentoDaPlanilhaSchema = z
	.object({
		subtipo: z.enum(SUBTIPOS_AFASTAMENTO, { message: 'Tipo de afastamento inválido' }),
		data_inicio: dataISO,
		data_fim: dataISO,
		descricao: z.string().trim().max(500, 'Descrição muito longa').default(''),
		nup: z.string().trim().max(30, 'NUP muito longo').default('')
	})
	.refine((a) => a.data_fim >= a.data_inicio, {
		message: 'Término anterior ao início',
		path: ['data_fim']
	});

/** Um evento da planilha de HISTÓRICO, extraído do texto pelo script de carga. */
const eventoDoHistoricoSchema = z
	.object({
		tipo: z.enum(['afastamento', 'movimentacao', 'observacao']),
		subtipo: z.enum(SUBTIPOS_AFASTAMENTO).optional(),
		data_inicio: dataISO.optional(),
		data_fim: dataISO.optional(),
		data_evento: dataISO.optional(),
		unidade_destino: z.string().trim().max(120).optional(),
		nup: z.string().trim().max(30).optional(),
		descricao: z.string().trim().max(1000, 'Descrição muito longa')
	})
	.refine((e) => !(e.data_inicio && e.data_fim) || e.data_fim >= e.data_inicio, {
		message: 'Término anterior ao início',
		path: ['data_fim']
	});

export const complementoDaPlanilhaSchema = z.object({
	/** Só o histórico: não faz upsert do cadastro (a planilha de histórico traz nome/cargo velhos). */
	somente_historico: z.boolean().optional(),
	/** Só os afastamentos da planilha dedicada (`legado = 3`), que mandam sobre o histórico. */
	somente_afastamentos: z.boolean().optional(),
	/** Os eventos da planilha de histórico — até 400 por servidor (a maior célula tem ~60). */
	historico: z.array(eventoDoHistoricoSchema).max(400).optional(),
	cargo_anterior: z.string().trim().max(10, 'Cargo anterior muito longo').optional(),
	data_nascimento: dataISO.nullable().optional(),
	data_posse: dataISO.nullable().optional(),
	designacao: z.string().trim().max(120, 'Designação muito longa').optional(),
	/** Até 20 por servidor — a planilha manda um; uma futura folha pode mandar o histórico. */
	afastamentos: z.array(afastamentoDaPlanilhaSchema).max(20).optional()
});

/** A linha trouxe algum campo do complemento? (Só então ele é validado e aplicado.) */
export function temComplemento(item: Record<string, unknown>): boolean {
	return [
		'cargo_anterior',
		'data_nascimento',
		'data_posse',
		'designacao',
		'afastamentos',
		'historico',
		'somente_historico',
		'somente_afastamentos'
	].some((k) => item[k] !== undefined);
}
