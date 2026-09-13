import { z } from 'zod';
import { TIPO_UNIDADE_VALORES } from '$lib/unidades/tipos';

export const unidadeSchema = z.object({
	nome: z
		.string()
		.min(1, 'Nome da unidade é obrigatório')
		.max(200, 'Nome muito longo (máx. 200)')
		.transform((s) => s.trim()),
	tipo: z.enum(TIPO_UNIDADE_VALORES).default('delegacia'),
	seccional_id: z.number().nullable().default(null),
	tem_plantao: z.boolean().default(false),
	tem_expediente: z.boolean().default(false),
	tem_fds: z.boolean().default(false),
	cidade: z.string().max(200).default(''),
	// Forma curta do departamento ("DPI SUL"). Vai para indexador e interface,
	// nunca para o cargo impresso — por isso o teto é curto e o vazio é válido.
	sigla: z
		.string()
		.max(20, 'Sigla muito longa (máx. 20)')
		.transform((s) => s.trim())
		.default('')
});
