/**
 * Envio de e-mail com PROVEDOR PADRÃO configurável e fallback automático:
 *   - O provedor padrão (Cloudflare ou Resend) é definido em Configurações Gerais
 *     (`email.provedor_padrao`; default 'cloudflare').
 *   - O OUTRO provedor assume automaticamente quando o padrão falha — inclusive
 *     quando a cota do padrão é extrapolada (erro/429 cai no fallback).
 *
 * Configuração necessária (wrangler.toml / .dev.vars):
 *   EMAIL binding            ← Cloudflare Email Sending
 *   RESEND_API_KEY=re_...    ← Chave de API do Resend
 *   RESEND_FROM_EMAIL=...    ← Remetente verificado no Resend
 *
 * Cada remetente monta só o CORPO da mensagem; a moldura visual vem de
 * `layoutEmail` e o envio + log padronizado, de `enviarERegistrar`. O HTML
 * resultante é congelado por goldens (`__tests__/email-templates.test.ts`).
 */

import { montarHtmlEmailNotificacaoAssessorGise } from './gise/assessor-notificacao-text';
import { logger } from './logger';
import { redigirEmails } from '$lib/utils/pii';
import { CORPORACAO_PROSA, SISTEMA_NOME } from '$lib/institucional';
import { mascararEmail } from '$lib/utils/pii';
import { getDB, buscarProvedorEmailPadrao, type EmailProvedor } from '$lib/db';
import { abreviarCredencial } from '$lib/chave-assinatura-ui';
import { mensagemDeErro } from '$lib/utils/erro';

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#x27;');
}

/**
 * Remetente do caminho Cloudflare — **constante, e o domínio é o da conta**.
 *
 * Não há env para isto de propósito: o Cloudflare Email Sending só entrega de
 * um domínio verificado NA CONTA, então um valor configurável apenas moveria a
 * falha para o runtime. O preço é uma armadilha de implantação: numa instalação
 * cujo domínio não seja `escalaspcce.com.br`, este caminho falha SEMPRE e o
 * sistema cai no Resend — que funciona, e por isso ninguém investiga o log
 * `[email/cloudflare]`.
 *
 * Quem for implantar em outro domínio troca esta constante no mesmo PR em que
 * configurar o Email Sending. O Resend tem remetente próprio
 * (`RESEND_FROM_EMAIL`) e não depende daqui.
 */
const CF_FROM = 'sistema@nao-responda.escalaspcce.com.br';
const CF_FROM_NAME = SISTEMA_NOME;

interface EmailAttachment {
	filename: string;
	content: string; // Base64
}

interface EmailOptions {
	to: string;
	subject: string;
	html: string;
	text?: string;
	attachments?: EmailAttachment[];
}

// ─── Cloudflare Email Sending ────────────────────────────────────────────────

/**
 * Teto do corpo de erro que entra em log e em mensagem de exceção. O provedor
 * pode devolver o payload inteiro de volta; guardar tudo aumenta a superfície
 * sem melhorar o diagnóstico, que está nas primeiras linhas.
 */
const LIMITE_TEXTO_ERRO = 500;

/**
 * Teto de espera por provedor de e-mail. Sem ele, provedor pendurado prende a
 * requisição até o limite da plataforma — e envio de e-mail NÃO é caminho
 * secundário aqui: `enviarCodigo2FA` está no caminho crítico do login (relança
 * de propósito, porque sem o código ninguém entra) e `solicitar-redefinicao` é
 * rota PÚBLICA. Provedor lento viraria, por essas duas portas,
 * indisponibilidade do login — e a única defesa era o limite da plataforma.
 *
 * 15 s alinhado à TSA (o OCSP usa 10 s): e-mail transacional responde em menos
 * de um segundo quando o provedor está de pé. Falhar em 15 s e cair para o
 * provedor de fallback é melhor do que esperar.
 */
const EMAIL_TIMEOUT_MS = 15_000;

/**
 * `fetch` com AbortController — o mesmo padrão de `ocsp.ts` e `tsa.ts`.
 *
 * O `clearTimeout` no `finally` importa: sem ele o timer fica pendente depois da
 * resposta e mantém o isolate vivo à espera de nada.
 */
async function fetchComTimeout(url: string, init: RequestInit): Promise<Response> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), EMAIL_TIMEOUT_MS);
	try {
		return await fetch(url, { ...init, signal: ctrl.signal });
	} finally {
		clearTimeout(t);
	}
}

/**
 * Corpo de erro do provedor, pronto para log e para mensagem de exceção.
 *
 * O corpo ECOA a requisição — inclusive o destinatário —, e a mensagem do
 * `Error` sobe até o `enviarERegistrar`, que a registra. Sem redigir na origem,
 * a máscara que aquele wrapper aplica no destinatário é desfeita por dentro da
 * própria mensagem (FLW-LGPD-002). O motivo do erro continua legível: some o
 * "para quem", não o "o quê".
 *
 * Vale para os DOIS provedores. Cloudflare e Resend têm o mesmo trecho de
 * tratamento de erro, e corrigir um só deixaria o vazamento inteiro de pé no
 * outro — que é justamente o que assume quando o primeiro falha.
 */
async function corpoDeErroSeguro(response: Response): Promise<string> {
	return redigirEmails(await response.text()).slice(0, LIMITE_TEXTO_ERRO);
}

async function dispararEmailCloudflare(
	platform: App.Platform | undefined,
	options: EmailOptions
): Promise<{ messageId: string }> {
	const env = platform?.env as Env | undefined;

	// Se houver o binding nativo de e-mail (Workers/Pages em prod), prioriza-o
	if (env?.EMAIL && typeof env.EMAIL === 'object' && 'send' in env.EMAIL) {
		const result = await (
			env.EMAIL as { send(m: Record<string, unknown>): Promise<{ messageId?: string }> }
		).send({
			from: { email: CF_FROM, name: CF_FROM_NAME },
			to: [{ email: options.to }],
			subject: options.subject,
			html: options.html,
			...(options.text ? { text: options.text } : {}),
			...(options.attachments?.length
				? {
						attachments: options.attachments.map((a) => ({
							disposition: 'attachment' as const,
							filename: a.filename,
							content: a.content,
							type: 'application/octet-stream'
						}))
					}
				: {})
		});

		return { messageId: result.messageId ?? 'cf-ok' };
	}

	// Caso contrário, tenta enviar via REST API utilizando as credenciais fornecidas
	const apiToken = env?.CLOUDFLARE_API_TOKEN;
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID;

	// `hasAccountId` é o que o diagnóstico precisa; o valor não (SEC-30). Não é
	// credencial — o segredo é o CLOUDFLARE_API_TOKEN —, mas é identificador de
	// conta em log, e log é lido por mais gente que o cofre.
	logger.info('[email/cloudflare] REST API config state', {
		hasApiToken: !!apiToken,
		apiTokenLength: apiToken ? apiToken.length : 0,
		hasAccountId: !!accountId
	});

	if (!apiToken || !accountId) {
		throw new Error('CF_EMAIL_BINDING_ABSENT');
	}

	const bodyPayload = {
		from: { address: CF_FROM, name: CF_FROM_NAME },
		to: options.to,
		subject: options.subject,
		html: options.html,
		...(options.text ? { text: options.text } : {}),
		...(options.attachments?.length
			? {
					attachments: options.attachments.map((a) => ({
						disposition: 'attachment',
						filename: a.filename,
						content: a.content,
						type: 'application/octet-stream'
					}))
				}
			: {})
	};

	const response = await fetchComTimeout(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(bodyPayload)
		}
	);

	if (!response.ok) {
		const errorText = await corpoDeErroSeguro(response);
		logger.error('[email/cloudflare] REST API error response', {
			status: response.status,
			statusText: response.statusText,
			errorText
		});
		throw new Error(
			`Falha ao enviar e-mail via Cloudflare REST API (HTTP ${response.status}): ${errorText}`
		);
	}

	const data = (await response.json()) as {
		success: boolean;
		result: { delivered: string[] } | null;
	};

	// `data.result.delivered` é a lista de DESTINATÁRIOS. Registrar a resposta
	// inteira jogava endereços em claro no Cloudflare Logs, fora do perímetro de
	// retenção do sistema (FLW-LGPD-002). Para operar basta saber que entregou e
	// para quantos.
	logger.info('[email/cloudflare] REST API success response', {
		success: data.success,
		entregues: data.result?.delivered?.length ?? 0
	});

	if (!data.success) {
		throw new Error('Falha na resposta do Cloudflare REST API');
	}

	return { messageId: 'cf-rest-ok' };
}

// ─── Resend (fallback) ────────────────────────────────────────────────────────

async function dispararEmailResend(
	platform: App.Platform | undefined,
	options: EmailOptions
): Promise<{ messageId: string }> {
	const e = platform?.env as Env | undefined;
	const apiKey = e?.RESEND_API_KEY ?? '';
	const from = e?.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';

	if (!apiKey)
		throw new Error('Resend API key não configurada. Defina RESEND_API_KEY no ambiente.');

	const bodyPayload = {
		from: `${CF_FROM_NAME} <${from}>`,
		to: options.to,
		subject: options.subject,
		html: options.html,
		...(options.text ? { text: options.text } : {}),
		...(options.attachments ? { attachments: options.attachments } : {})
	};

	const response = await fetchComTimeout('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(bodyPayload)
	});

	if (!response.ok) {
		const errorText = await corpoDeErroSeguro(response);
		throw new Error(
			`Falha ao enviar e-mail via Resend API (HTTP ${response.status}): ${errorText}`
		);
	}

	const data = (await response.json()) as { id: string };
	return { messageId: data.id };
}

// ─── Dispatcher com fallback ─────────────────────────────────────────────────

type EnvioFn = (p: App.Platform | undefined, o: EmailOptions) => Promise<{ messageId: string }>;

/**
 * Provedor PADRÃO é configurável (Configurações Gerais → `email.provedor_padrao`);
 * default 'cloudflare'. O OUTRO provedor assume automaticamente como fallback
 * quando o padrão falha — inclusive quando a cota do padrão é extrapolada
 * (o provedor devolve erro/429, que cai no catch abaixo).
 */
async function dispararEmail(
	platform: App.Platform | undefined,
	options: EmailOptions
): Promise<{ messageId: string }> {
	let preferido: EmailProvedor = 'cloudflare';
	try {
		preferido = await buscarProvedorEmailPadrao(getDB(platform));
	} catch {
		// Sem DB/config acessível: mantém o padrão histórico (cloudflare).
	}

	const cloudflare: [string, EnvioFn] = ['Cloudflare', dispararEmailCloudflare];
	const resend: [string, EnvioFn] = ['Resend', dispararEmailResend];
	const [[primNome, primFn], [secNome, secFn]] =
		preferido === 'resend' ? [resend, cloudflare] : [cloudflare, resend];

	try {
		const result = await primFn(platform, options);
		logger.debug(`[email] Enviado via ${primNome} (provedor padrão)`);
		return result;
	} catch (errPrim) {
		const motivo = mensagemDeErro(errPrim);
		// Binding do CF ausente é silencioso (config esperada em alguns ambientes);
		// qualquer outra falha — inclusive cota estourada — loga e cai no fallback.
		if (motivo !== 'CF_EMAIL_BINDING_ABSENT') {
			logger.warn(
				`[email] Falha no provedor padrão (${primNome}); usando ${secNome} como fallback`,
				{
					motivo
				}
			);
		}
		return secFn(platform, options);
	}
}

/**
 * Moldura comum dos e-mails transacionais: cabeçalho institucional, cartão
 * branco centralizado e rodapé. Os sete remetentes usavam cópias byte a byte
 * destas 28 linhas — mudar a identidade visual exigia editar todas.
 *
 * `corpo` entra dentro da célula de conteúdo (já com `padding:32px`) e é HTML
 * confiável, montado aqui no servidor; texto vindo do usuário passa por
 * `escapeHtml` antes.
 */
function layoutEmail(corpo: string): string {
	return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1a3a6e;padding:24px 32px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:bold;">${CORPORACAO_PROSA}</p>
            <p style="margin:4px 0 0;color:#a0b4d6;font-size:13px;">${SISTEMA_NOME}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
${corpo}          </td>
        </tr>
        <tr>
          <td style="background:#f8f9fc;padding:16px 32px;border-top:1px solid #eee;">
            <p style="margin:0;color:#999;font-size:11px;">${SISTEMA_NOME} — ${CORPORACAO_PROSA}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * A caixa azul destacada com o código de uso único.
 *
 * `rotulo` é OPCIONAL porque as três cópias divergiram: o e-mail de 2FA — o
 * único que todo usuário recebe, a cada login — é o que NÃO traz a legenda
 * acima do número; os de verificação de e-mail pessoal e de redefinição trazem.
 * A diferença tem toda a cara de esquecimento, mas mudá-la altera o e-mail que
 * já chega às caixas de entrada, então fica como parâmetro explícito: a
 * extração não decide isso sozinha. Para uniformizar, passe um rótulo em
 * `enviarCodigo2FA` e regrave o golden.
 */
function caixaCodigo(codigo: string, rotulo?: string): string {
	const linhaRotulo = rotulo
		? `\n              <p style="margin:0 0 8px;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:1px;">${rotulo}</p>`
		: '';
	return `            <div style="background:#eef2ff;border:2px solid #1a3a6e;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">${linhaRotulo}
              <span style="font-size:40px;font-weight:bold;letter-spacing:10px;color:#1a3a6e;">${codigo}</span>
            </div>`;
}

/**
 * Botão de ação mais o link em texto logo abaixo — a mesma URL nas duas formas.
 *
 * O link repetido não é redundância: cliente de e-mail corporativo com HTML
 * desligado, ou que reescreve o `href` do botão, deixaria o usuário sem
 * caminho nenhum. E como a URL É a credencial (quem a tem redefine a senha),
 * ficar sem caminho significa não conseguir entrar.
 *
 * `word-break:break-all` no parágrafo evita que o token seja quebrado com
 * hífen pelo cliente de e-mail, o que invalidaria o link ao copiar.
 */
function botaoComLink(link: string, textoBotao: string): string {
	return `            <div style="text-align:center;margin-bottom:24px;">
              <a href="${link}"
                 style="display:inline-block;background:#1a3a6e;color:#ffffff;font-size:15px;font-weight:bold;
                        text-decoration:none;padding:14px 32px;border-radius:8px;">
                ${textoBotao}
              </a>
            </div>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ⏱ Este link expira em <strong>1 hora</strong>.
            </p>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              Se o botão não funcionar, copie e cole este link no navegador:
            </p>
            <p style="margin:0 0 16px;font-size:12px;word-break:break-all;">
              <a href="${link}" style="color:#1a3a6e;">${link}</a>
            </p>`;
}

/**
 * Envia e registra o resultado com o mesmo formato de log em todos os
 * remetentes: sucesso com `messageId`, falha com a mensagem do erro — sempre
 * com o destinatário MASCARADO (o log não guarda e-mail em claro).
 *
 * Relança em caso de falha: quem chama decide se o envio é crítico (bloqueia a
 * ação) ou best-effort (só loga).
 *
 * `extras` cobre os envios que não são só assunto + HTML: `text` (alternativa em
 * texto puro, para quem lê o e-mail sem HTML), `attachments` e `logExtra` com
 * campos adicionais de log. Sem isso, cada um desses remetentes reescrevia o
 * try/catch inteiro e o formato do log podia divergir em silêncio.
 */
async function enviarERegistrar(
	platform: App.Platform | undefined,
	tag: string,
	destinatario: string,
	subject: string,
	html: string,
	acao = 'enviado',
	extras?: {
		text?: string;
		attachments?: EmailOptions['attachments'];
		logExtra?: Record<string, unknown>;
	}
): Promise<void> {
	try {
		const info = await dispararEmail(platform, {
			to: destinatario,
			subject,
			html,
			...(extras?.text ? { text: extras.text } : {}),
			...(extras?.attachments ? { attachments: extras.attachments } : {})
		});
		logger.info(`[email/${tag}] ${acao}`, {
			destinatario: mascararEmail(destinatario),
			...(extras?.logExtra ?? {}),
			messageId: info.messageId
		});
	} catch (err) {
		logger.error(`[email/${tag}] Erro ao enviar`, {
			destinatario: mascararEmail(destinatario),
			error: mensagemDeErro(err)
		});
		throw err;
	}
}

/**
 * Código de 2FA para entrar no sistema, enviado ao e-mail INSTITUCIONAL.
 * Crítico: relança em caso de falha, porque sem o código ninguém entra — a rota
 * de login precisa saber que o envio não aconteceu.
 */
export async function enviarCodigo2FA(
	destinatario: string,
	codigo: string,
	nomeUsuario: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 24px;color:#555;font-size:14px;">
              Seu código de verificação para acesso ao sistema é:
            </p>
${caixaCodigo(codigo)}
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ⏱ Este código expira em <strong>10 minutos</strong>.
            </p>
            <p style="margin:0;color:#666;font-size:13px;">
              🔒 Se você não tentou fazer login, ignore este e-mail.
            </p>
`);

	await enviarERegistrar(
		platform,
		'2fa',
		destinatario,
		'Código de Verificação — Acesso ao Sistema',
		html,
		'Código enviado'
	);
}

/**
 * Código para o titular confirmar um e-mail PESSOAL como canal de recuperação.
 * Vai para o endereço sendo verificado, que é justamente o que ainda não se
 * pode considerar confiável — daí o código, e não um simples aviso.
 */
export async function enviarCodigoEmailPessoal(
	destinatario: string,
	codigo: string,
	nomeUsuario: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 24px;color:#555;font-size:14px;">
              Para confirmar seu e-mail pessoal no sistema como canal de recuperação de senha, use o código abaixo:
            </p>
${caixaCodigo(codigo, 'Código de Verificação')}
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ⏱ Este código expira em <strong>10 minutos</strong>.
            </p>
            <p style="margin:0;color:#666;font-size:13px;">
              🔒 Se você não solicitou isso, ignore este e-mail.
            </p>
`);

	await enviarERegistrar(
		platform,
		'verificacao-pessoal',
		destinatario,
		`Verificação de E-mail Pessoal — ${SISTEMA_NOME}`,
		html,
		'Código enviado'
	);
}

/**
 * Aviso informativo ao E-MAIL FUNCIONAL quando o e-mail pessoal (canal de
 * recuperação de senha) é TROCADO pelo perfil. Deixa rastro visível ao
 * titular: se ele não reconhecer a troca, procura o administrador.
 */
export async function enviarAvisoTrocaEmailPessoal(
	destinatarioFuncional: string,
	nomeUsuario: string,
	novoEmailMascarado: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 16px;color:#555;font-size:14px;">
              O <strong>e-mail pessoal</strong> cadastrado na sua conta (usado para recuperação de senha)
              acaba de ser <strong>alterado</strong> para <strong>${escapeHtml(novoEmailMascarado)}</strong>.
            </p>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ✅ Se foi você, nenhuma ação é necessária.
            </p>
            <p style="margin:0;color:#666;font-size:13px;">
              🔒 Se você <strong>não reconhece</strong> esta alteração, troque sua senha imediatamente e
              comunique o administrador do sistema.
            </p>
`);

	await enviarERegistrar(
		platform,
		'aviso-troca-email-pessoal',
		destinatarioFuncional,
		`Aviso de segurança: e-mail pessoal alterado — ${SISTEMA_NOME}`,
		html,
		'Aviso enviado'
	);
}

/** Cadastro, substituição ou revogação da chave — o rastro visível ao titular. */
export type EventoAvisoChaveAssinatura = 'cadastrada' | 'substituida' | 'revogada';

const ASSUNTO_AVISO_CHAVE: Record<EventoAvisoChaveAssinatura, string> = {
	cadastrada: `Aviso de segurança: chave de assinatura cadastrada — ${SISTEMA_NOME}`,
	substituida: `Aviso de segurança: chave de assinatura substituída — ${SISTEMA_NOME}`,
	revogada: `Aviso de segurança: chave de assinatura revogada — ${SISTEMA_NOME}`
};

function corpoEventoChave(evento: EventoAvisoChaveAssinatura, quando: string): string {
	if (evento === 'cadastrada') {
		return `A <strong>chave de assinatura</strong> da sua conta acaba de ser <strong>cadastrada</strong> (${escapeHtml(quando)}).`;
	}
	if (evento === 'substituida') {
		return (
			`A <strong>chave de assinatura</strong> da sua conta acaba de ser <strong>substituída</strong> (${escapeHtml(quando)}). ` +
			'A chave anterior deixa de valer para novas assinaturas.'
		);
	}
	return `A <strong>chave de assinatura</strong> da sua conta acaba de ser <strong>revogada</strong> (${escapeHtml(quando)}).`;
}

function recadoSeNaoReconhece(evento: EventoAvisoChaveAssinatura): string {
	if (evento === 'revogada') {
		return (
			'🔒 Se você <strong>não reconhece</strong> esta revogação, comunique o Admin Geral e ' +
			'<strong>não cadastre</strong> uma chave nova até esclarecer. Documentos já assinados continuam válidos.'
		);
	}
	return (
		'🔒 Se você <strong>não reconhece</strong> esta alteração, revogue a chave em Meu Perfil ' +
		'(pelo celular) ou peça ao Admin Geral. Documentos já assinados continuam válidos.'
	);
}

/**
 * Aviso informativo ao E-MAIL FUNCIONAL quando a chave de assinatura é
 * cadastrada, substituída ou revogada. Rastro visível ao titular — o mesmo
 * papel do aviso de troca de e-mail pessoal. Best-effort no caller: falha de
 * envio não desfaz o ato.
 *
 * O identificador vai recortado (o mesmo do manifesto). Sem IP, user-agent
 * nem o id completo.
 *
 * `quando` entra nos goldens: passe um instante fixo no teste; em produção
 * o caller omite e usa a hora de Brasília.
 */
export async function enviarAvisoChaveAssinatura(
	destinatarioFuncional: string,
	nomeUsuario: string,
	evento: EventoAvisoChaveAssinatura,
	credentialId: string,
	platform: App.Platform | undefined,
	quando?: string
): Promise<void> {
	const instante = quando ?? new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
	const recorte = abreviarCredencial(credentialId);
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 16px;color:#555;font-size:14px;">
              ${corpoEventoChave(evento, instante)}
            </p>
            <p style="margin:0 0 16px;color:#555;font-size:14px;">
              Identificador (como no manifesto):
              <strong style="font-family:Consolas,Monaco,monospace;letter-spacing:0.04em;">${escapeHtml(recorte)}</strong>
            </p>
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ✅ Se você reconhece esta alteração, nenhuma ação é necessária.
            </p>
            <p style="margin:0;color:#666;font-size:13px;">
              ${recadoSeNaoReconhece(evento)}
            </p>
`);

	await enviarERegistrar(
		platform,
		'aviso-chave-assinatura',
		destinatarioFuncional,
		ASSUNTO_AVISO_CHAVE[evento],
		html,
		'Aviso enviado'
	);
}

/**
 * Código de redefinição de senha, enviado ao e-mail pessoal já verificado.
 * Alternativa ao link para quem abre o e-mail em outro aparelho.
 */
export async function enviarCodigoRedefinicaoSenha(
	destinatario: string,
	codigo: string,
	nomeUsuario: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 24px;color:#555;font-size:14px;">
              Use o código abaixo para autorizar o envio do link de redefinição de senha:
            </p>
${caixaCodigo(codigo, 'Código de Redefinição')}
            <p style="margin:0 0 8px;color:#666;font-size:13px;">
              ⏱ Este código expira em <strong>10 minutos</strong>.
            </p>
            <p style="margin:0;color:#666;font-size:13px;">
              🔒 Se você não solicitou a redefinição de senha, ignore este e-mail.
            </p>
`);

	await enviarERegistrar(
		platform,
		'redefinicao-codigo',
		destinatario,
		`Código de Redefinição de Senha — ${SISTEMA_NOME}`,
		html,
		'Código enviado'
	);
}

/**
 * Link de redefinição de senha. A URL carrega o token em claro — é a
 * credencial: quem tem o link redefine a senha, e por isso o e-mail traz o
 * prazo de validade e o aviso de ignorar se não foi o titular que pediu.
 */
export async function enviarLinkRedefinicaoSenha(
	destinatario: string,
	nomeUsuario: string,
	linkRedefinicao: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 24px;color:#555;font-size:14px;">
              Recebemos uma solicitação de redefinição de senha para a sua conta no ${SISTEMA_NOME}.
              Clique no botão abaixo para definir uma nova senha:
            </p>
${botaoComLink(linkRedefinicao, 'Redefinir minha senha')}
            <p style="margin:0;color:#e53e3e;font-size:13px;font-weight:bold;">
              🔒 Se você não solicitou a redefinição de senha, ignore este e-mail. Sua senha permanece a mesma.
            </p>
`);

	await enviarERegistrar(
		platform,
		'redefinicao',
		destinatario,
		`Redefinição de Senha — ${SISTEMA_NOME}`,
		html,
		'Link enviado'
	);
}

/**
 * Link de primeiro acesso, o único caminho de entrada de quem foi cadastrado
 * (`criarPolicial` grava senha aleatória). Mesma natureza do link de
 * redefinição: a URL é a credencial.
 */
export async function enviarLinkPrimeiroAcesso(
	destinatario: string,
	nomeUsuario: string,
	linkPrimeiroAcesso: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeUsuario)}</strong>!</p>
            <p style="margin:0 0 24px;color:#555;font-size:14px;">
              Sua conta no ${SISTEMA_NOME} foi criada. Clique no botão abaixo para definir sua senha e ativar o acesso:
            </p>
${botaoComLink(linkPrimeiroAcesso, 'Definir minha senha')}
            <p style="margin:0;color:#e53e3e;font-size:13px;font-weight:bold;">
              🔒 Se você não esperava este e-mail, entre em contato com o administrador do sistema.
            </p>
`);

	await enviarERegistrar(
		platform,
		'primeiro-acesso',
		destinatario,
		`Primeiro Acesso — ${SISTEMA_NOME}`,
		html,
		'Link enviado'
	);
}

/**
 * Envia a escala de fim de semana com o `.docx` ANEXADO — único remetente com
 * anexo. O buffer é convertido para base64 aqui porque é o formato que os dois
 * provedores esperam, e vai acompanhado de uma versão em texto puro, já que
 * este e-mail costuma ser reencaminhado.
 */
export async function enviarEscalaFDSPorEmail(
	destinatario: string,
	tituloEscala: string,
	nomeRemetente: string,
	docxBuffer: Uint8Array,
	nomeArquivo: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = layoutEmail(`            <p style="margin:0 0 16px;color:#333;font-size:15px;">
              Segue em anexo a <strong>Escala de Plantão do Final de Semana</strong>:
            </p>
            <div style="background:#eef2ff;border-left:4px solid #1a3a6e;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
              <p style="margin:0;color:#1a3a6e;font-size:14px;font-weight:bold;">${escapeHtml(tituloEscala)}</p>
            </div>
            <p style="margin:0 0 8px;color:#555;font-size:13px;">
              Enviado por: <strong>${escapeHtml(nomeRemetente)}</strong>
            </p>
            <p style="margin:0;color:#888;font-size:12px;">
              O arquivo <em>.docx</em> está disponível em anexo.
            </p>
`);

	// O provedor recebe o anexo em base64, não em bytes.
	const base64Content = Buffer.from(docxBuffer).toString('base64');

	await enviarERegistrar(
		platform,
		'fds',
		destinatario,
		`Escala de FDS — ${tituloEscala}`,
		html,
		'Escala enviada',
		{
			text: `Segue em anexo a Escala de Plantão do Final de Semana.\n\nTítulo: ${tituloEscala}\nEnviado por: ${nomeRemetente}`,
			attachments: [{ filename: nomeArquivo, content: base64Content }],
			logExtra: { titulo: tituloEscala }
		}
	);
}

/**
 * Avisa o assessor que uma seccional enviou sua composição, com o resumo em
 * TEXTO PURO pronto para ele copiar no WhatsApp — o `text` aqui não é fallback
 * do HTML, é o produto principal do e-mail.
 */
export async function enviarNotificacaoAssessorGisePreenchimentoSeccional(
	destinatario: string,
	nomeAssessor: string,
	textoPlano: string,
	platform: App.Platform | undefined
): Promise<void> {
	const html = montarHtmlEmailNotificacaoAssessorGise(textoPlano);

	await enviarERegistrar(
		platform,
		'gise-assessor',
		destinatario,
		'GISE — seccional enviou a escala (resumo para WhatsApp)',
		html,
		'Notificação enviada',
		{ text: textoPlano, logExtra: { assessor: nomeAssessor } }
	);
}

/**
 * O relatório diário dos colaboradores da unidade (E61-b): o que cada um fez
 * no dia, para o admin da unidade. Uma tabela simples, colaborador a
 * colaborador; o e-mail vai ao endereço PESSOAL do admin (o do 2FA), como
 * decidido em 21/09/2026. Não relança: quem chama registra a falha e segue
 * para a próxima unidade.
 */
export async function enviarRelatorioColaboradores(
	destinatario: string,
	nomeAdmin: string,
	unidade: string,
	diaISO: string,
	acoes: readonly {
		colaborador: string;
		hora: string;
		acao: string;
		alvo: string | null;
		detalhes: string | null;
	}[],
	platform: App.Platform | undefined
): Promise<void> {
	const [ano, mes, dia] = diaISO.split('-');
	const diaBR = `${dia}/${mes}/${ano}`;
	const porColaborador = new Map<string, typeof acoes>();
	for (const a of acoes) {
		porColaborador.set(a.colaborador, [...(porColaborador.get(a.colaborador) ?? []), a]);
	}
	const blocos = [...porColaborador.entries()]
		.map(
			([nome, lista]) => `
            <p style="margin:16px 0 4px;color:#1a3a6e;font-size:14px;font-weight:bold;">${escapeHtml(nome)} <span style="color:#777;font-weight:normal;">— ${lista.length} ação${lista.length === 1 ? '' : 'ões'}</span></p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;color:#333;">
${lista
	.map(
		(a) => `              <tr>
                <td style="padding:4px 8px 4px 0;vertical-align:top;white-space:nowrap;color:#777;">${escapeHtml(a.hora)}</td>
                <td style="padding:4px 0;vertical-align:top;"><strong>${escapeHtml(a.acao)}</strong>${a.alvo ? ` — ${escapeHtml(a.alvo)}` : ''}${a.detalhes ? `<br><span style="color:#555;">${escapeHtml(a.detalhes)}</span>` : ''}</td>
              </tr>`
	)
	.join('\n')}
            </table>`
		)
		.join('\n');

	const html =
		layoutEmail(`            <p style="margin:0 0 8px;color:#333;font-size:15px;">Olá, <strong>${escapeHtml(nomeAdmin)}</strong>!</p>
            <p style="margin:0 0 8px;color:#555;font-size:14px;">
              Este é o relatório do dia <strong>${diaBR}</strong> das ações dos colaboradores lotados na
              <strong>${escapeHtml(unidade)}</strong>: ${acoes.length} ação${acoes.length === 1 ? '' : 'ões'}, tirada${acoes.length === 1 ? '' : 's'} da auditoria do ${SISTEMA_NOME}.
            </p>
${blocos}
            <p style="margin:24px 0 0;color:#777;font-size:12px;">
              O que cada colaborador pode fazer é definido na ficha da unidade (bloco "Colaboradores"). Este e-mail sai todo dia às 19h, só quando houve ação.
            </p>
`);

	await enviarERegistrar(
		platform,
		'relatorio-colaboradores',
		destinatario,
		`Colaboradores — ${unidade} — ${diaBR}`,
		html,
		'Relatório enviado',
		{ logExtra: { unidade, dia: diaISO, acoes: acoes.length } }
	);
}
