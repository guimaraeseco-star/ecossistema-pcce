/**
 * "Meu perfil" (`/perfil`) — visão do próprio servidor. **Página de leitura**,
 * com duas exceções que pertencem ao titular e a mais ninguém.
 *
 * O servidor não pede alteração do próprio cadastro. Telefone, classe, regime e
 * lotação são corrigidos pelo administrador da unidade ou da seccional dele, na
 * ficha em `/servidores/[id]`, e a correção ainda passa pela aprovação do Admin
 * Geral. Até ago/2026 o pedido saía daqui; o fluxo mudou de dono, e com ele a
 * página — o formulário e o quadro "Minhas solicitações" saíram junto com a
 * action `solicitar`.
 *
 * O que continua sendo do titular, e por isso continua aqui:
 *
 *  - o **e-mail pessoal**, que é o canal de recuperação da conta. A troca exige
 *    a senha dele MAIS um código enviado ao novo endereço; nenhum administrador
 *    entra nesse caminho, porque quem troca esse endereço assume a identidade da
 *    pessoa no próximo "esqueci a senha";
 *  - a **chave de assinatura** (passkey), que prova controle exclusivo do
 *    aparelho (Lei 14.063/2020, art. 4º II "b") e portanto não pode ser
 *    cadastrada por terceiro.
 *
 * Os dois vão por API, não por form action — daí este arquivo não ter `actions`.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { eq } from 'drizzle-orm';
import { getDB, buscarCredencialAtiva } from '$lib/db';
import { temCadastro } from '$lib/auth';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { nomeProvedorAaguid } from '$lib/server/assinatura/webauthn/aaguid-provedores';
import { abreviarCredencial } from '$lib/chave-assinatura-ui';
import { policiais } from '$lib/server/schema';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	// Admin geral não tem cadastro de policial próprio — perfil é do servidor.
	// `temCadastro` é o narrowing de tipo (colaborador também não tem perfil).
	if (!temCadastro(u) || u.tipo !== 'policial') redirect(302, '/');

	const db = getDB(platform);
	const [row, credencial] = await Promise.all([
		db
			.select({
				nome: policiais.nome,
				matricula: policiais.matricula,
				cargo: policiais.cargo,
				telefone: policiais.telefone,
				classe: policiais.classe,
				regime: policiais.regime,
				lotacao: policiais.lotacao,
				email: policiais.email,
				email_pessoal: policiais.email_pessoal,
				email_pessoal_verificado: policiais.email_pessoal_verificado
			})
			.from(policiais)
			.where(eq(policiais.id, u.id))
			.get(),
		buscarCredencialAtiva(db, credencialDoUsuario(u))
	]);

	if (!row) redirect(302, '/login');

	return {
		perfil: row,
		// Recorte do identificador (o mesmo do manifesto) + último uso. O id
		// completo e a chave pública NÃO vão para o cliente.
		passkey: credencial
			? {
					criadoEm: credencial.criadoEm,
					ultimoUso: credencial.ultimoUso,
					vinculo: descreverVinculoCredencial(credencial),
					identificador: abreviarCredencial(credencial.credentialId),
					// Apelido: rótulo que o titular escolheu no cadastro. Provedor: do
					// AAGUID, os dois DECLARADOS pelo aparelho, nunca verificados — nem
					// um nem outro entram no manifesto do PDF.
					apelido: credencial.apelido,
					provedor: nomeProvedorAaguid(credencial.aaguid)
				}
			: null
	};
};
