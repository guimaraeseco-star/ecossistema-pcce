/**
 * Cadastro de colaborador pelo Admin Geral (`/colaboradores`) — a terceira
 * identidade, que entra por CPF (E55).
 *
 * O CPF é o login, então é obrigatório e precisa ser válido pelos dígitos
 * verificadores: vai cifrado para o banco, é por ele que a pessoa entra e, no
 * módulo de diárias, sai impresso no Requerimento — o `cpfValido` existe
 * justamente para o dado digitado à mão uma vez e nunca mais conferido. O
 * e-mail pessoal é o canal do 2FA e da senha provisória.
 */
import { z } from 'zod';
import { cpfValido } from '$lib/utils/cpf';

export const colaboradorSchema = z.object({
	nome: z.string().trim().min(3, 'Nome muito curto').max(200, 'Nome muito longo (máx. 200)'),
	cpf: z
		.string()
		.trim()
		.min(11, 'CPF é obrigatório')
		.max(14, 'CPF inválido')
		.refine((v) => cpfValido(v), 'CPF inválido'),
	email_pessoal: z
		.string()
		.trim()
		.toLowerCase()
		.min(5, 'E-mail pessoal é obrigatório')
		.max(254, 'E-mail muito longo')
		.email('E-mail inválido'),
	vinculo: z.string().trim().max(120, 'Vínculo muito longo (máx. 120)').default('')
});
