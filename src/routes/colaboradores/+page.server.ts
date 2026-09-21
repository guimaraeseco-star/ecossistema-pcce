/**
 * Cadastro de colaboradores (`/colaboradores`) — **Admin Geral** (o Super
 * Admin é um Admin Geral com poderes extras, então entra por aqui também).
 *
 * A decisão 23 do plano do módulo de diárias dizia Super Admin; mudou em
 * set/2026, a pedido: quem opera o módulo é o Admin Geral do departamento, e
 * fazer a criação da conta subir um nível travaria o dia a dia. A assimetria é
 * sabida e está registrada — o Admin Geral **não** cadastra policial nem
 * unidade (ver a matriz em DEPLOY.md), mas cadastra colaborador. Ela se
 * justifica pelo que a identidade alcança: o colaborador falha fechado em tudo
 * e só age onde for designado.
 *
 * Admin de seccional e de unidade continuam FORA: eles têm escopo sobre
 * pessoas já cadastradas, não sobre a criação de identidade de acesso.
 *
 * A senha nasce PROVISÓRIA, gerada pelo servidor e mostrada uma única vez na
 * resposta desta action — nunca gravada em claro nem registrada na auditoria.
 * No primeiro login (por CPF, E55) a pessoa passa pelo 2FA no e-mail pessoal
 * (obrigatório para colaborador) e é forçada a trocá-la. Esqueceu a senha?
 * Ela mesma recupera pela tela de login, como o servidor; o administrador
 * também pode gerar outra provisória aqui (`redefinirSenha`), o que derruba
 * as sessões da conta.
 *
 * **Colaborador não se exclui, só se desativa** — pela mesma razão das
 * unidades e dos policiais: o que ele fizer no módulo de diárias (autuações,
 * pedidos montados) aponta para o id dele.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarColaboradores,
	criarColaborador,
	buscarColaborador,
	definirColaboradorAtivo,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { colaboradores } from '$lib/server/schema';
import { isAdminGeral } from '$lib/auth';
import { eq } from 'drizzle-orm';
import { colaboradorSchema } from '$lib/schemas';
import { hashSenha } from '$lib/auth';
import { gerarSenhaProvisoria } from '$lib/server/auth/senha-provisoria';
import { resolverCredencial, revogarSessoesDaCredencial } from '$lib/server/auth/credencial';
import { ehViolacaoUnique, mensagemComCausas } from '$lib/server/db-errors';
import { CpfDeColaboradorJaCadastrado } from '$lib/db/colaboradores';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals, platform, depends }) => {
	depends('app:colaboradores');
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (!isAdminGeral(u)) redirect(302, '/');

	const db = getDB(platform);
	return { colaboradores: await listarColaboradores(db) };
};

/** O pepper do ambiente — o mesmo de todo hash de senha do sistema. */
function pepperDe(platform: App.Platform | undefined): string | undefined {
	return (platform?.env as Env | undefined)?.PASSWORD_PEPPER?.trim() || undefined;
}

export const actions: Actions = {
	criar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) {
			return fail(403, { error: 'Acesso restrito a administradores gerais' });
		}

		const data = await request.formData();
		const parsed = colaboradorSchema.safeParse({
			nome: data.get('nome')?.toString() ?? '',
			cpf: data.get('cpf')?.toString() ?? '',
			email_pessoal: data.get('email_pessoal')?.toString() ?? '',
			vinculo: data.get('vinculo')?.toString() ?? ''
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}

		const db = getDB(platform);
		const senhaProvisoria = gerarSenhaProvisoria();
		try {
			const criado = await criarColaborador(
				db,
				{
					nome: parsed.data.nome,
					cpf: parsed.data.cpf,
					emailPessoal: parsed.data.email_pessoal,
					vinculo: parsed.data.vinculo,
					senhaHash: await hashSenha(senhaProvisoria, pepperDe(platform)),
					criadoPor: { id: u.id, nome: u.nome }
				},
				platform?.env
			);
			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'criar_colaborador',
					usuario: u,
					entidade: 'colaborador',
					entidade_id: criado.id,
					alvo_tipo: 'colaborador',
					alvo_id: criado.id,
					alvo_nome: criado.nome,
					detalhes: `Colaborador criado: ${criado.nome} (${criado.email_pessoal})`,
					// Sem CPF e sem senha: a auditoria guarda o que identifica, não o que expõe.
					dados_depois: {
						nome: criado.nome,
						email_pessoal: criado.email_pessoal,
						vinculo: criado.vinculo
					},
					...contexto
				},
				{ env }
			);
			// A senha provisória sai UMA vez, nesta resposta, para o admin repassar.
			return { success: true, criado: { id: criado.id, nome: criado.nome }, senhaProvisoria };
		} catch (e: unknown) {
			// O cadastro confere antes (sem chave o índice é nulo); o índice único
			// pega a corrida entre dois cadastros simultâneos.
			if (e instanceof CpfDeColaboradorJaCadastrado || ehViolacaoUnique(e)) {
				return fail(409, { error: 'Já existe um colaborador com este CPF' });
			}
			logger.error('[colaboradores/criar]', { error: mensagemComCausas(e) });
			return fail(500, { error: 'Erro ao cadastrar o colaborador. Tente novamente.' });
		}
	},

	definirAtivo: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) {
			return fail(403, { error: 'Acesso restrito a administradores gerais' });
		}

		const data = await request.formData();
		const id = Number(data.get('colaborador_id'));
		if (!Number.isInteger(id) || id < 1) return fail(400, { error: 'ID inválido' });
		const ativo = data.get('ativo') === 'true';

		const db = getDB(platform);
		const alvo = await buscarColaborador(db, id);
		if (!alvo) return fail(404, { error: 'Colaborador não encontrado' });

		await definirColaboradorAtivo(db, id, ativo);
		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: ativo ? 'reativar_colaborador' : 'desativar_colaborador',
				usuario: u,
				entidade: 'colaborador',
				entidade_id: id,
				alvo_tipo: 'colaborador',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `${ativo ? 'Reativado' : 'Desativado'}: ${alvo.nome}`,
				...contexto
			},
			{ env }
		);
		return { success: true };
	},

	/**
	 * Nova senha provisória: `primeiro_acesso` volta a 1 (troca obrigatória no
	 * próximo login) e as sessões da conta caem — quem estava logado com a senha
	 * antiga, inclusive um cookie roubado, perde o acesso agora.
	 */
	redefinirSenha: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !isAdminGeral(u)) {
			return fail(403, { error: 'Acesso restrito a administradores gerais' });
		}

		const data = await request.formData();
		const id = Number(data.get('colaborador_id'));
		if (!Number.isInteger(id) || id < 1) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		const alvo = await buscarColaborador(db, id);
		if (!alvo) return fail(404, { error: 'Colaborador não encontrado' });
		if (alvo.ativo !== 1)
			return fail(409, { error: 'Reative o colaborador antes de redefinir a senha' });

		const senhaProvisoria = gerarSenhaProvisoria();
		await db
			.update(colaboradores)
			.set({ senha: await hashSenha(senhaProvisoria, pepperDe(platform)), primeiro_acesso: 1 })
			.where(eq(colaboradores.id, id));
		await revogarSessoesDaCredencial(db, await resolverCredencial(db, 'colaborador', id));

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'redefinir_senha_colaborador',
				usuario: u,
				entidade: 'colaborador',
				entidade_id: id,
				alvo_tipo: 'colaborador',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `Senha provisória gerada para ${alvo.nome}; sessões revogadas`,
				...contexto
			},
			{ env }
		);
		return { success: true, criado: { id, nome: alvo.nome }, senhaProvisoria };
	}
};
