/**
 * Redefinição de senha por link de e-mail — e o desvio do PRIMEIRO ACESSO.
 *
 * O token do link é a credencial: quem o tem redefine a senha sem sessão. Por
 * isso ele é de uso único e a troca revoga as OUTRAS sessões da credencial —
 * senha nova com sessão velha ativa deixaria o invasor dentro.
 *
 * O primeiro acesso não termina aqui, e isso é decisão: fechá-lo só com a senha
 * deixaria o e-mail PESSOAL (o canal de recuperação) por coletar. O link então
 * age como magic link — autentica e manda para `/alterar-senha`, onde senha e
 * e-mail pessoal são definidos e verificados juntos. Ver `ehPrimeiroAcesso`.
 */
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDB, registrarAuditComContexto } from '$lib/db';
import {
	verificarTokenRedefinicao,
	consumirTokenRedefinicao,
	hashSenha,
	criarSessao,
	type TipoUsuarioReset
} from '$lib/auth';
import { administradores, colaboradores, policiais } from '$lib/server/schema';
import { alterarSenhaSchema } from '$lib/schemas';
import { cookieOptions } from '$lib/server/auth/auth-flow';
import { resolverCredencial, revogarSessoesDaCredencial } from '$lib/server/auth/credencial';
import type { PageServerLoad, Actions } from './$types';

/**
 * Primeiro acesso: o link enviado ao e-mail funcional NÃO deve fechar o
 * primeiro acesso definindo só a senha — senão o e-mail pessoal (canal de
 * recuperação) nunca é coletado, ao contrário do fluxo por Token A3. Em vez
 * disso, tratamos o link como "magic link": autentica o usuário e o leva ao
 * /alterar-senha, onde senha + e-mail pessoal são definidos e verificados.
 */
async function ehPrimeiroAcesso(
	db: ReturnType<typeof getDB>,
	tipo: TipoUsuarioReset,
	usuarioId: number
): Promise<boolean> {
	if (tipo === 'colaborador') {
		const c = await db
			.select({ pa: colaboradores.primeiro_acesso })
			.from(colaboradores)
			.where(eq(colaboradores.id, usuarioId))
			.get();
		return c?.pa === 1;
	}
	if (tipo === 'admin') {
		const a = await db
			.select({ pa: administradores.primeiro_acesso })
			.from(administradores)
			.where(eq(administradores.id, usuarioId))
			.get();
		return a?.pa === 1;
	}
	const p = await db
		.select({ pa: policiais.primeiro_acesso })
		.from(policiais)
		.where(eq(policiais.id, usuarioId))
		.get();
	return p?.pa === 1;
}

/** A tabela da auditoria de cada identidade. */
function entidadeDe(tipo: TipoUsuarioReset): string {
	return tipo === 'policial'
		? 'policiais'
		: tipo === 'colaborador'
			? 'colaboradores'
			: 'administradores';
}

export const load: PageServerLoad = async ({ url, platform, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });

	const token = url.searchParams.get('token') ?? '';

	if (!token) {
		return { valido: false, erro: 'Link inválido ou ausente.', token: '', primeiroAcesso: false };
	}

	const db = getDB(platform);
	const resultado = await verificarTokenRedefinicao(db, token);

	if (resultado === 'invalido') {
		return {
			valido: false,
			erro: 'Este link é inválido ou já foi utilizado.',
			token,
			primeiroAcesso: false
		};
	}
	if (resultado === 'expirado') {
		return {
			valido: false,
			erro: 'Este link expirou. Solicite um novo link de redefinição.',
			token,
			primeiroAcesso: false
		};
	}

	const primeiroAcesso = await ehPrimeiroAcesso(db, resultado.tipo, resultado.usuarioId);
	return { valido: true, erro: null, token, primeiroAcesso };
};

export const actions: Actions = {
	redefinir: async ({ request, platform, getClientAddress, cookies, url }) => {
		const formData = await request.formData();
		const token = formData.get('token')?.toString() ?? '';

		if (!token) {
			return fail(400, { error: 'Token ausente' });
		}

		const db = getDB(platform);

		// Leitura ANTES de ramificar: só para saber de quem é o token e se o
		// fluxo pede senha. Não autoriza nada — quem autoriza é o consumo
		// atômico, mais abaixo em cada ramo.
		const previa = await verificarTokenRedefinicao(db, token);
		if (previa === 'expirado') {
			return fail(400, { error: 'Este link expirou. Solicite um novo link de redefinição.' });
		}
		if (previa === 'invalido') {
			return fail(400, { error: 'Este link é inválido ou já foi utilizado.' });
		}

		/** Traduz a recusa do consumo para a mensagem da tela. */
		const recusa = (motivo: 'expirado' | 'invalido') =>
			fail(400, {
				error:
					motivo === 'expirado'
						? 'Este link expirou. Solicite um novo link de redefinição.'
						: 'Este link é inválido ou já foi utilizado.'
			});

		// PRIMEIRO ACESSO (magic link): não define senha aqui nem fecha o primeiro
		// acesso. Autentica e manda para /alterar-senha, onde senha + e-mail
		// pessoal são definidos/verificados (igual ao fluxo do Token A3). Fecha o
		// furo de um POST direto a ?/redefinir burlar a coleta do e-mail pessoal.
		if (await ehPrimeiroAcesso(db, previa.tipo, previa.usuarioId)) {
			const consumo = await consumirTokenRedefinicao(db, token);
			if (typeof consumo === 'string') return recusa(consumo);
			const { tipo, usuarioId } = consumo;

			const sessionToken = await criarSessao(db, tipo, usuarioId);
			cookies.set('session_token', sessionToken, cookieOptions(url));
			await registrarAuditComContexto(db, {
				usuario: { id: usuarioId, nome: 'Usuário' },
				acao: 'primeiro_acesso_link',
				entidade: entidadeDe(tipo),
				entidade_id: usuarioId,
				ip: getClientAddress(),
				user_agent: request.headers.get('user-agent'),
				env: platform?.env
			});
			redirect(303, '/alterar-senha');
		}

		// RESET NORMAL (não é primeiro acesso): exige senha.
		const nova_senha = formData.get('nova_senha')?.toString() ?? '';
		const confirmar_senha = formData.get('confirmar_senha')?.toString() ?? '';

		if (nova_senha !== confirmar_senha) {
			return fail(400, { error: 'As senhas não conferem.' });
		}

		const parsed = alterarSenhaSchema.safeParse({ nova_senha });
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		// O consumo vem DEPOIS de validar a senha e ANTES de gravá-la, e é o que
		// autoriza a troca: perder a corrida aqui interrompe o fluxo. A ordem
		// importa nos dois sentidos — consumir antes de validar queimaria o link
		// de quem só errou a confirmação; consumir depois de gravar reabriria a
		// janela que este consumo existe para fechar.
		const consumo = await consumirTokenRedefinicao(db, token);
		if (typeof consumo === 'string') return recusa(consumo);
		const { tipo, usuarioId } = consumo;

		const pepper = (platform?.env as Env | undefined)?.PASSWORD_PEPPER?.trim() || undefined;
		const novaSenhaHash = await hashSenha(parsed.data.nova_senha, pepper);

		// A senha vai para a linha que o LOGIN lê, não para a do token. São
		// diferentes no Admin Geral VINCULADO: a linha `administradores` dele tem
		// só um placeholder, e o login autentica contra `policiais.senha`. Gravar
		// no lugar errado não muda nada — a senha nova não passa a valer e a
		// ANTIGA continua valendo, justamente no fluxo que existe para trocar uma
		// senha comprometida (FLW-AUTH-002).
		const cred = await resolverCredencial(db, tipo, usuarioId);

		// Buscar nome para auditoria
		let nome = 'Usuário';

		if (cred.dono.tipo === 'colaborador') {
			const c = await db
				.select({ nome: colaboradores.nome })
				.from(colaboradores)
				.where(eq(colaboradores.id, cred.dono.id))
				.get();
			nome = c?.nome ?? nome;

			await db
				.update(colaboradores)
				.set({ senha: novaSenhaHash, primeiro_acesso: 0 })
				.where(eq(colaboradores.id, cred.dono.id));
		} else if (cred.dono.tipo === 'admin') {
			const admin = await db
				.select({ nome: administradores.nome })
				.from(administradores)
				.where(eq(administradores.id, cred.dono.id))
				.get();
			nome = admin?.nome ?? nome;

			await db
				.update(administradores)
				.set({ senha: novaSenhaHash, primeiro_acesso: 0 })
				.where(eq(administradores.id, cred.dono.id));
		} else {
			const policial = await db
				.select({ nome: policiais.nome })
				.from(policiais)
				.where(eq(policiais.id, cred.dono.id))
				.get();
			nome = policial?.nome ?? nome;

			await db
				.update(policiais)
				.set({ senha: novaSenhaHash, primeiro_acesso: 0 })
				.where(eq(policiais.id, cred.dono.id));
		}

		// Derruba as sessões das DUAS identidades quando são a mesma pessoa: uma
		// senha destrava dois cookies, e deixar um vivo é deixar de fora o cookie
		// roubado que motivou o reset.
		await revogarSessoesDaCredencial(db, cred);

		// Auditoria
		await registrarAuditComContexto(db, {
			usuario: { id: usuarioId, nome },
			acao: 'redefinir_senha',
			entidade: entidadeDe(tipo),
			entidade_id: usuarioId,
			alvo_tipo: tipo,
			alvo_id: usuarioId,
			ip: getClientAddress(),
			user_agent: request.headers.get('user-agent'),
			env: platform?.env
		});

		redirect(303, '/login?resetado=1');
	}
};
