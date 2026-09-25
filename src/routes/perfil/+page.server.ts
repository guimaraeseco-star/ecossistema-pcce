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
 *
 * **A vida funcional do titular (E53)**: desde 24/09 a página também mostra o
 * que era visível só dentro da ficha administrativa — a linha do tempo (férias,
 * afastamentos com o CID, movimentações, designações, posse) e os dias em que
 * ele está escalado. Enquanto o sistema era ferramenta de gestão, fazia sentido
 * que o servidor não visse nada disso; com ele virando a fonte da verdade
 * (E52), não ver a própria vida funcional virou defeito.
 *
 * Tudo em LEITURA: os mesmos componentes da ficha, com as ações desligadas. A
 * correção continua vindo do administrador da unidade, e não daqui — por isso
 * este arquivo continua sem `actions`.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { eq } from 'drizzle-orm';
import {
	getDB,
	buscarCredencialAtiva,
	listarHistoricoPolicial,
	listarDesignacoes,
	listarUnidades,
	afastamentoVigente
} from '$lib/db';
import { ocupadosDoAbono, ocupadosDoHistorico } from '$lib/servidores/conflitos';
import { escalasDoServidorNoPeriodo } from '$lib/db/policiais/afastamento-escalas';
import { listarFeriasDoPolicial } from '$lib/db/policiais/ferias';
import { feriadosNoIntervalo } from '$lib/db/diarias/feriados';
import { adicionarDias, hojeBrasilISO } from '$lib/utils/datas';
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
				id: policiais.id,
				nome: policiais.nome,
				matricula: policiais.matricula,
				cargo: policiais.cargo,
				telefone: policiais.telefone,
				classe: policiais.classe,
				regime: policiais.regime,
				lotacao: policiais.lotacao,
				email: policiais.email,
				email_pessoal: policiais.email_pessoal,
				email_pessoal_verificado: policiais.email_pessoal_verificado,
				data_posse: policiais.data_posse
			})
			.from(policiais)
			.where(eq(policiais.id, u.id))
			.get(),
		buscarCredencialAtiva(db, credencialDoUsuario(u))
	]);

	if (!row) redirect(302, '/login');

	const hoje = hojeBrasilISO();
	const [historico, ferias, feriados, designacoes, unidades, escalas] = await Promise.all([
		listarHistoricoPolicial(db, u.id),
		listarFeriasDoPolicial(db, u.id),
		// Os mesmos 18 meses da ficha: o cartão de férias marca feriado no
		// calendário, e ele é de leitura aqui, mas o calendário é o mesmo.
		feriadosNoIntervalo(db, hoje, adicionarDias(hoje, 540)),
		listarDesignacoes(db),
		listarUnidades(db),
		// A janela das escalas: do início do ano passado ao fim do que vem. É
		// ampla de propósito — a pergunta "em que dia eu estou escalado" olha
		// para a frente, e a de "quando eu estive" olha para trás.
		escalasDoServidorNoPeriodo(
			db,
			u.id,
			`${Number(hoje.slice(0, 4)) - 1}-01-01`,
			`${Number(hoje.slice(0, 4)) + 1}-12-31`
		)
	]);

	return {
		perfil: row,
		/**
		 * A vida funcional do titular (E53), em leitura: os mesmos dados da ficha
		 * administrativa, sem nenhuma ação.
		 */
		historico,
		ferias,
		ocupados: [...ocupadosDoHistorico(historico), ...ocupadosDoAbono(ferias.fracoes)],
		feriados: feriados.map((f: { data: string }) => f.data),
		afastamentoVigenteId: afastamentoVigente(historico, hoje)?.id ?? null,
		designacoes,
		unidades: unidades.map((x: { id: number; nome: string }) => ({ id: x.id, nome: x.nome })),
		/** Os dias em que ele está (ou esteve) escalado — ordinária e GISE. */
		escalas,
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
