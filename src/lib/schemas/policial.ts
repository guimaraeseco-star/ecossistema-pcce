import { z } from 'zod';

export const policialSchema = z.object({
	nome: z.string().min(1, 'Nome é obrigatório').max(200, 'Nome muito longo (máx. 200)'),
	matricula: z.string().min(1, 'Matrícula é obrigatória').max(20),
	cargo: z.enum(['DPC', 'OIP'], { message: 'Cargo deve ser DPC ou OIP' }),
	cpf: z
		.string()
		.regex(
			/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/,
			'CPF inválido (use 11 dígitos ou formato ###.###.###-##)'
		)
		.optional()
		.nullable(),
	telefone: z.string().max(20).default(''),
	lotacao: z.string().max(200).default(''),
	regime: z.enum(['plantao', 'expediente']).default('plantao'),
	classe: z.string().max(100).default(''),
	papel: z.enum(['admin_seccional', 'admin_unidade']).nullable().optional(),
	papel_unidade_id: z.number().nullable().optional(),
	/** Onde trabalha (E66): id de unidade; o servidor confere se pertence à lotação. */
	local_id: z.number().nullable().optional(),
	email: z.string().email('E-mail inválido').or(z.literal('')).nullable().optional().default(null),
	email_pessoal: z
		.string()
		.email('E-mail pessoal inválido')
		.or(z.literal(''))
		.nullable()
		.optional()
		.default(null)
});

export const policialUpdateSchema = policialSchema.partial().extend({
	ativo: z.number().min(0).max(1).optional()
});
