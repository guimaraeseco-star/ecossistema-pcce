/**
 * Os schemas dos endpoints de autenticação — e o teto de tamanho como defesa.
 *
 * O cap de cada campo não é preciosismo de validação: sem ele, um corpo de
 * vários MB era lido, coagido e — no caso da senha — HASHEADO antes de a
 * requisição falhar. Hash de senha é caro de propósito, então um campo sem
 * limite transforma a rota de login em amplificador de custo. Os limites são
 * folgados para uso legítimo (128 chars de senha, 32 de matrícula).
 *
 * `codigoField` e `desafioIdField` são compartilhados pelos fluxos de 2FA
 * porque o mesmo par viaja em quatro rotas; duplicá-los faria uma delas ficar
 * sem cap na próxima vez que alguém acrescentasse um fluxo — foi o que houve
 * com a form action de `verificar2FA`, que conferia só truthiness até set/2026.
 */
import { z } from 'zod';

export const loginSchema = z
	.object({
		/** Matrícula (policial), login (admin) ou CPF (colaborador, E55). */
		matricula: z.string().min(1, 'Matrícula é obrigatória').max(32, 'Identificador muito longo'),
		senha: z.string().min(1, 'Senha é obrigatória').max(128, 'Senha muito longa'),
		tipo: z.enum(['policial', 'admin', 'colaborador']).default('policial')
	})
	// O CPF do colaborador chega com ou sem máscara; só os dígitos contam.
	.refine((v) => v.tipo !== 'colaborador' || v.matricula.replace(/\D/g, '').length === 11, {
		message: 'CPF deve ter 11 dígitos',
		path: ['matricula']
	});

// ---- Endpoints de autenticação: validação Zod + caps de tamanho ----
// Cumpre a diretriz do CLAUDE.md (sempre Zod/validateBody) e fecha DoS-leve:
// sem cap, um body de vários MB era processado/hasheado antes de falhar. Os
// limites são folgados para uso legítimo.

const desafioIdField = z.string().trim().min(1, 'Desafio inválido').max(128, 'Desafio inválido');
const codigoField = z.coerce.string().trim().min(1, 'Código inválido').max(16, 'Código inválido');
const emailField = z.string().trim().min(1, 'E-mail inválido').max(254, 'E-mail inválido');

export const verificar2faSchema = z.object({ desafioId: desafioIdField, codigo: codigoField });

export const reenviarCodigoSchema = z.object({ desafioId: desafioIdField });

/**
 * O e-mail de recuperação do colaborador (E55): opcional, informado no
 * primeiro acesso. Quem chama já tratou o vazio — aqui só chega texto.
 */
export const emailRecuperacaoSchema = z
	.string()
	.trim()
	.toLowerCase()
	.max(254, 'E-mail de recuperação muito longo')
	.email('E-mail de recuperação inválido');

export const solicitarRedefinicaoSchema = z.object({
	/** Matrícula, login ou, para o colaborador, o CPF (E55). */
	identificador: z.string().trim().min(1).max(64),
	tipo: z.enum(['policial', 'admin', 'colaborador'])
});

export const confirmarRedefinicaoSchema = z.object({
	desafioId: desafioIdField,
	codigo: codigoField
});

export const solicitarVerificacaoEmailSchema = z.object({
	email: emailField,
	// Exigida quando o usuário JÁ tem e-mail pessoal cadastrado (troca): prova
	// de posse da conta além da sessão aberta. Opcional no 1º cadastro.
	senha: z.string().max(200).optional()
});

export const confirmarVerificacaoEmailSchema = z.object({
	desafioId: desafioIdField,
	codigo: codigoField,
	email: emailField
});

export const certificadoVerificarSchema = z.object({
	desafioId: desafioIdField,
	// CMS PKCS#7 em base64 — a folha do SERPRO fica ~8-11 KB; cap generoso
	// bloqueia payloads multi-MB que custariam parsing ASN.1 caro.
	cmsBase64: z.string().trim().min(1, 'cmsBase64 inválido').max(50_000, 'Certificado muito grande'),
	// Intenção de entrar no console de Admin Geral (aba "Administrador" da tela de
	// login). Só concede sessão admin se o CPF do certificado tiver uma conta
	// vinculada em `administradores.policial_id`; caso contrário, erro claro.
	comoAdmin: z.boolean().optional(),
	// Modo "Sou colaborador(a)" da tela de login (E55): o CPF do e-CPF é casado
	// com `colaboradores`, não com `policiais`.
	comoColaborador: z.boolean().optional()
});

/**
 * Lista negra de senhas inviáveis — comparada em lowercase. Cobre:
 *  - Top 20 do leak SecLists (rockyou / HaveIBeenPwned top)
 *  - Sequências numéricas óbvias
 *  - Padrões de teclado (qwerty, asdfgh)
 *  - Vocabulário institucional do contexto (policial, delegado, etc.) que
 *    seria a primeira tentativa de um atacante focado neste sistema
 *  - Variações com sufixo numérico curto (`senha1`, `admin12`) que passam
 *    pelos critérios mínimos de força mas são triviais em dicionário
 *
 * NÃO é exaustiva — uma blocklist completa precisaria de listas externas
 * de 1M+ entradas (Have I Been Pwned API). Esta serve como primeira
 * camada (`refine` é O(1) em Set lookup) sem custo operacional.
 */
const SENHAS_COMUNS = new Set([
	// Sequências numéricas / repetições
	'12345678',
	'123456789',
	'1234567890',
	'87654321',
	'01234567',
	'11111111',
	'22222222',
	'33333333',
	'44444444',
	'55555555',
	'66666666',
	'77777777',
	'88888888',
	'99999999',
	'00000000',
	'12341234',
	'11223344',
	'11112222',
	'12121212',
	// Top do rockyou / breach datasets
	'password',
	'password1',
	'password12',
	'password123',
	'senha123',
	'qwerty',
	'qwerty12',
	'qwerty123',
	'qwertyui',
	'asdfghjk',
	'iloveyou',
	'iloveyou1',
	'iloveyou12',
	'iloveyou123',
	'princess',
	'princess1',
	'sunshine',
	'sunshine1',
	'football',
	'baseball',
	'welcome1',
	'monkey12',
	'dragon12',
	'master12',
	'letmein1',
	'admin123',
	'admin1234',
	'administrador',
	'admin2024',
	'admin2025',
	'admin2026',
	'abc12345',
	'abcd1234',
	'abc123456',
	'a1b2c3d4',
	// Vocabulário institucional / regional (contexto Polícia Civil CE)
	'policial',
	'policial1',
	'policial2024',
	'policial2025',
	'policial2026',
	'delegado',
	'delegado1',
	'delegado2024',
	'delegado2025',
	'pccear',
	'pccea2024',
	'pccea2025',
	'ceara123',
	'plantao1',
	'plantao2024',
	'escala2024',
	'escala2025'
]);

export const alterarSenhaSchema = z.object({
	senha_atual: z.string().optional(),
	nova_senha: z
		.string()
		.min(8, 'A senha deve ter no mínimo 8 caracteres')
		.max(64, 'A senha deve ter no máximo 64 caracteres')
		.refine((s) => /[A-Z]/.test(s), 'A senha deve conter pelo menos uma letra maiúscula')
		.refine((s) => /[a-z]/.test(s), 'A senha deve conter pelo menos uma letra minúscula')
		.refine((s) => /[0-9]/.test(s), 'A senha deve conter pelo menos um número')
		.refine((s) => !SENHAS_COMUNS.has(s.toLowerCase()), 'Essa senha é muito comum. Escolha outra.')
});

/** Reautenticação por senha na cerimônia de assinatura avançada. Sem matrícula. */
export const reautenticarAssinaturaSchema = z.object({
	senha: z.string().min(1, 'Senha é obrigatória').max(128, 'Senha muito longa')
});
