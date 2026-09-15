import { z } from 'zod';
import { TIPO_UNIDADE_VALORES } from '$lib/unidades/tipos';

/** Texto opcional com teto, sempre `trim()`ado; vazio é válido e vira ''. */
const textoCurto = (max: number, rotulo: string) =>
	z
		.string()
		.max(max, `${rotulo} muito longo (máx. ${max})`)
		.transform((s) => s.trim())
		.default('');

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
	sigla: textoCurto(20, 'Sigla'),
	// ---- A ficha (migração 0085), editável pelo Super Admin em /unidades ----
	endereco: textoCurto(300, 'Endereço'),
	telefone: textoCurto(60, 'Telefone'),
	email: z
		.string()
		.max(120, 'E-mail muito longo (máx. 120)')
		.transform((s) => s.trim())
		.refine((s) => s === '' || z.string().email().safeParse(s).success, 'E-mail inválido')
		.default(''),
	/** A AIS da unidade — texto livre curto ("AIS 15"), como na planilha. */
	ais: textoCurto(20, 'AIS'),
	xadrezes: z.number().int().min(0, 'Xadrezes: mínimo 0').max(99, 'Xadrezes: máximo 99').default(0),
	tira_gravame: z.boolean().default(false),
	/**
	 * Link de origem da foto (Google Drive etc.). `null` = sem link. `.optional()`
	 * e não `.default('')`: o default do Zod pula os transforms, e o ausente
	 * precisa sair como null igual ao vazio.
	 */
	foto_url: z
		.string()
		.max(500, 'Link da foto muito longo (máx. 500)')
		.optional()
		.transform((s) => (s ?? '').trim())
		.refine((s) => s === '' || /^https?:\/\//i.test(s), 'Link da foto precisa começar com http')
		.transform((s) => (s === '' ? null : s))
});
