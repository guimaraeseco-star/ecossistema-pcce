/**
 * Troca da própria senha — e o único brute-force ONLINE que sobrava.
 *
 * Com uma sessão roubada, conferir `senha_atual` aqui era caminho ilimitado
 * para adivinhar a senha e depois trocá-la "legitimamente". O throttle usa
 * chave POR USUÁRIO e não por IP, porque o atacante já está autenticado: o IP
 * dele não diz nada, a conta sim.
 *
 * Esta rota também é o destino do primeiro acesso (ver
 * `redefinir-senha/+page.server.ts`): é aqui que senha e e-mail pessoal são
 * definidos na mesma passagem, e é por isso que ela precisa funcionar para quem
 * ainda tem `primeiro_acesso = 1`. O COLABORADOR não verifica e-mail aqui: o
 * dele já é o pessoal, e o 2FA do login acabou de prová-lo (E55). Em vez
 * disso, a tela PERGUNTA se ele quer outro endereço para recuperar a senha
 * (`email_recuperacao`, opcional). A action `sair` existe porque esta rota não
 * tem o "Sair" do layout: sem ela, fechar a aba deixava o cookie vivo e o hook
 * devolvia o usuário para cá.
 */
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDB, auditar, contextoDeEvento, definirEmailRecuperacao } from '$lib/db';
import { hashSenha, verificarSenha, criarSessao, temCadastro } from '$lib/auth';
import { administradores, policiais, colaboradores } from '$lib/server/schema';
import { alterarSenhaSchema, emailRecuperacaoSchema } from '$lib/schemas';
import { cookieOptions, mascararEmail } from '$lib/server/auth/auth-flow';
import {
	credencialDoUsuario,
	resolverCredencial,
	revogarSessoesDaCredencial
} from '$lib/server/auth/credencial';
import { invalidarSessaoCache } from '$lib/server/auth/session-cache';
import { encerrarSessaoAtual } from '$lib/server/auth/encerrar-sessao';
import {
	contarRecoveryAttempts,
	registrarRecoveryAttempt
} from '$lib/server/auth/recovery-rate-limit';
import type { Actions, PageServerLoad } from './$types';
import type { Identidade } from '$lib/server/auth/credencial';

/**
 * A linha onde a senha mora, por tipo de identidade — a tabela é decidida
 * AQUI, uma vez, e não em cada leitura/escrita. O colaborador é a terceira;
 * "o que não é policial é admin" gravaria a senha dele na linha de um admin de
 * mesmo id.
 */
async function lerLinhaDaSenha(
	db: ReturnType<typeof getDB>,
	alvo: Identidade
): Promise<{ senha: string; email_pessoal_verificado: number } | undefined> {
	if (alvo.tipo === 'policial') {
		return db
			.select({
				senha: policiais.senha,
				email_pessoal_verificado: policiais.email_pessoal_verificado
			})
			.from(policiais)
			.where(eq(policiais.id, alvo.id))
			.get();
	}
	if (alvo.tipo === 'admin') {
		return db
			.select({
				senha: administradores.senha,
				email_pessoal_verificado: administradores.email_pessoal_verificado
			})
			.from(administradores)
			.where(eq(administradores.id, alvo.id))
			.get();
	}
	// O e-mail pessoal do colaborador é o do 2FA que ele acabou de passar —
	// já está provado, sem etapa de verificação (E55).
	const c = await db
		.select({ senha: colaboradores.senha })
		.from(colaboradores)
		.where(eq(colaboradores.id, alvo.id))
		.get();
	return c ? { senha: c.senha, email_pessoal_verificado: 1 } : undefined;
}

async function gravarSenha(db: ReturnType<typeof getDB>, alvo: Identidade, hash: string) {
	const valores = { senha: hash, primeiro_acesso: 0 };
	if (alvo.tipo === 'policial') {
		await db.update(policiais).set(valores).where(eq(policiais.id, alvo.id));
	} else if (alvo.tipo === 'admin') {
		await db.update(administradores).set(valores).where(eq(administradores.id, alvo.id));
	} else {
		await db.update(colaboradores).set(valores).where(eq(colaboradores.id, alvo.id));
	}
}

// Throttle da verificação de senha_atual: com uma sessão roubada, este era o
// único caminho de brute-force online ilimitado da senha (para depois trocá-la
// "legitimamente"). Chave POR USUÁRIO (não IP): o atacante já está autenticado.
const SENHA_ATUAL_MAX_TENTATIVAS = 5;
const SENHA_ATUAL_JANELA_MIN = 15;

export const load: PageServerLoad = async ({ locals }) => {
	const u = locals.usuario;
	const colaborador = u?.tipo === 'colaborador';
	return {
		primeiro_acesso: u?.primeiro_acesso ?? false,
		colaborador,
		// O endereço que já recebe o 2FA — a tela mostra para a pessoa decidir
		// se quer outro para a recuperação.
		emailPessoalMascarado: colaborador && u?.email ? mascararEmail(u.email) : ''
	};
};

export const actions = {
	alterar: async (event) => {
		const { request, platform, locals, cookies, url } = event;
		const db = getDB(platform);
		const usuario = locals.usuario;

		if (!usuario) {
			return fail(401, { error: 'Não autorizado' });
		}

		const formData = await request.formData();
		const nova_senha = formData.get('nova_senha')?.toString();
		const senha_atual = formData.get('senha_atual')?.toString();

		const parsed = alterarSenhaSchema.safeParse({
			nova_senha,
			senha_atual: senha_atual || undefined
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		// Onde a senha realmente mora — no Admin Geral VINCULADO é a linha do
		// policial, não a linha admin (que tem só um placeholder). Regra única em
		// `credencialDoUsuario`; escrita à mão aqui, ela não protegia o
		// `redefinir-senha`, que nasceu sem ela.
		const alvo: Identidade = temCadastro(usuario)
			? credencialDoUsuario(usuario)
			: { tipo: 'colaborador', id: usuario.id };
		const alvoId = alvo.id;

		if (usuario.primeiro_acesso) {
			const registroEmail = await lerLinhaDaSenha(db, alvo);

			if (!registroEmail || registroEmail.email_pessoal_verificado !== 1) {
				return fail(400, {
					error: 'Confirme seu e-mail pessoal antes de concluir o primeiro acesso.'
				});
			}
		}

		const pepper = (platform?.env as Env | undefined)?.PASSWORD_PEPPER?.trim() || undefined;

		// Verificar senha atual (exceto no primeiro acesso)
		if (!usuario.primeiro_acesso) {
			if (!senha_atual) {
				return fail(400, { error: 'Senha atual é obrigatória' });
			}

			const chaveThrottle = `senha-atual:${usuario.tipo}:${usuario.id}`;
			const { blocked } = await contarRecoveryAttempts(
				db,
				chaveThrottle,
				'alterar_senha',
				SENHA_ATUAL_JANELA_MIN,
				SENHA_ATUAL_MAX_TENTATIVAS
			);
			if (blocked) {
				return fail(429, {
					error: `Muitas tentativas de senha incorretas. Tente novamente em ${SENHA_ATUAL_JANELA_MIN} minutos.`
				});
			}

			const registro = await lerLinhaDaSenha(db, alvo);
			if (!registro || !(await verificarSenha(senha_atual, registro.senha, pepper))) {
				await registrarRecoveryAttempt(db, chaveThrottle, 'alterar_senha');
				return fail(401, { error: 'Senha atual incorreta' });
			}
		}

		// O e-mail de recuperação do colaborador: só no primeiro acesso, opcional,
		// e validado ANTES de gravar a senha — recusar depois deixaria a senha
		// trocada e o primeiro acesso fechado com a resposta de erro na tela.
		let emailRecuperacao: string | null | undefined;
		if (alvo.tipo === 'colaborador' && usuario.primeiro_acesso) {
			const bruto = formData.get('email_recuperacao')?.toString().trim() ?? '';
			if (bruto) {
				const rec = emailRecuperacaoSchema.safeParse(bruto);
				if (!rec.success) return fail(400, { error: rec.error.issues[0].message });
				emailRecuperacao = rec.data;
			} else {
				emailRecuperacao = null;
			}
		}

		const novaSenhaHash = await hashSenha(parsed.data.nova_senha, pepper);
		await gravarSenha(db, alvo, novaSenhaHash);
		if (emailRecuperacao !== undefined) {
			await definirEmailRecuperacao(db, alvoId, emailRecuperacao);
		}

		// Rotação completa: invalida TODAS as sessões (inclusive a atual) e cria
		// uma nova. Se um atacante tinha o cookie roubado, o `Set-Cookie` novo
		// só vai para o navegador legítimo desta resposta — atacante perde acesso.
		//
		// "Todas" inclui as DUAS identidades do Admin Geral vinculado. Apagar só
		// as do modo atual deixava vivo o cookie do outro modo, destravado pela
		// MESMA senha — exatamente o cookie roubado que esta rotação existe para
		// matar (FLW-AUTH-002).
		await revogarSessoesDaCredencial(db, await resolverCredencial(db, usuario.tipo, usuario.id));

		// Higiene do cache edge de sessão: o token antigo ainda valeria por até
		// 60s no colo local. O token NOVO é cache-miss natural (chave diferente),
		// então primeiro_acesso=0 entra em vigor imediatamente.
		await invalidarSessaoCache(cookies.get('session_token'));

		const novoToken = await criarSessao(db, usuario.tipo, usuario.id);
		cookies.set('session_token', novoToken, cookieOptions(url));

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'alterar_senha',
				usuario,
				entidade: alvo.tipo,
				entidade_id: alvoId,
				alvo_tipo: alvo.tipo,
				alvo_id: alvoId,
				alvo_nome: usuario.nome,
				detalhes: usuario.primeiro_acesso
					? 'Senha definida no primeiro acesso'
					: 'Senha alterada pelo próprio usuário',
				metadados: { primeiro_acesso: usuario.primeiro_acesso },
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	// A tela é `ROTAS_SEM_SIDEBAR`: sem o Sair do layout, o cookie de sessão
	// sobrevive ao fechar a aba e o hook devolve o usuário para cá. O POST
	// `/api/auth/logout` já era livre em primeiro acesso; faltava o controle.
	sair: async (event) => {
		if (!event.locals.usuario) {
			return fail(401, { error: 'Não autorizado' });
		}
		await encerrarSessaoAtual(event);
		redirect(303, '/login');
	}
} satisfies Actions;
