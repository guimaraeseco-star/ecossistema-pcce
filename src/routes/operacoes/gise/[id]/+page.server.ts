/**
 * `load` da escala GISE e o ponto de junção das suas form actions.
 *
 * O `load` monta a árvore inteira (`buscarGiseDetalhado`) e resolve o PAPEL de
 * quem abriu — Admin Geral, admin de seccional/unidade, supervisor ou membro —
 * porque quase tudo na tela depende disso. `isSupervisorGise` vem do `parent()`,
 * já resolvido pelo layout, para não repetir a consulta a cada navegação.
 *
 * `depends('gise:detail')` é a chave que as ações invalidam: a página se
 * recarrega sem `invalidateAll()`, que também derrubaria o layout.
 *
 * As actions estão divididas por ASSUNTO em `_actions/` — escala, seccional,
 * equipe, membros e unidade — e são espalhadas aqui num objeto só. São mais de
 * trinta; num arquivo só, achar a que interessa era o problema. O que elas
 * compartilham (`getInt`, `saiuDaFaseDeEdicao`) mora em `_actions/shared.ts`.
 */
import type { PageServerLoad, Actions } from './$types';
import { redirect, error } from '@sveltejs/kit';
import {
	getDB,
	buscarGiseDetalhado,
	buscarPresencasGise,
	buscarAssinaturasRelatoriosGise,
	buscarRestringirSmartphone,
	buscarOperacao,
	tiposEquipeDaOperacao,
	TIPOS_EQUIPE
} from '$lib/db';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { cpfAssinanteParaExibir } from '$lib/server/assinatura/cpf-assinante';
import { presencasParaCliente } from '$lib/server/gise/presenca-cliente';
import { getBreveRelatorioEnvMergido } from '$lib/server/gise/breve-relatorio-env';
import { buscarUnidadeIdSupervisaoExtra } from '$lib/server/gise/supervisao-extra';
import { adminParticipaDaGise } from '$lib/server/gise/permissao';
import { logger } from '$lib/server/logger';
import { unidades, policiais, giseRespostasFormulario } from '$lib/server/schema';
import { eq, asc, inArray, and, isNull } from 'drizzle-orm';
import { actionsEscala } from './_actions/actions-escala';
import { actionsSeccional } from './_actions/actions-seccional';
import { actionsEquipe } from './_actions/actions-equipe';
import { actionsMembros } from './_actions/actions-membros';
import { actionsUnidade } from './_actions/actions-unidade';
import { mensagemDeErro } from '$lib/utils/erro';

export const load: PageServerLoad = async ({ locals, params, platform, depends, parent }) => {
	depends('gise:detail');
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const id = parseInt(params.id);
	if (isNaN(id)) error(400, 'ID inválido');

	const db = getDB(platform);

	const isGeral = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);

	// isSupervisorGise já resolvido pelo layout (evita query duplicada)
	const parentData = await parent();
	const isSupervisor = u.tipo === 'policial' ? (parentData.isSupervisorGise ?? false) : false;

	// Escopo por participação (Opção B): admin seccional só abre GISEs que
	// incluem a seccional que ele administra — não qualquer GISE.
	const isSeccionalParticipante =
		isSeccional && (await adminParticipaDaGise(db, id, u.papel_unidade_id));
	if (!isGeral && !isSeccionalParticipante && !isSupervisor) {
		redirect(302, '/');
	}

	try {
		const gise = await buscarGiseDetalhado(db, id);
		if (!gise) error(404, 'Escala GISE não encontrada');

		// Mascarado para quem não é Super Admin — a MESMA regra que
		// `/api/gise/[id]/documento-assinado/info` aplica a este mesmo campo, e que
		// este `load` não aplicava: decifrava e devolvia o CPF COMPLETO no payload
		// de hidratação, para o supervisor (policial comum) e o admin de seccional,
		// sem que tela nenhuma o renderize. Ver `cpf-assinante.ts`.
		if (gise.documento) {
			gise.documento.assinante_cpf = await cpfAssinanteParaExibir(
				gise.documento.assinante_cpf,
				platform?.env,
				u
			);
		}

		const supportIds = [
			gise.supervisor_id,
			gise.assessor_id,
			gise.seint1_id,
			gise.seint2_id
		].filter((val): val is number => val !== null);

		// Antes carregávamos até 10 000 policiais aqui só para popular `<SearchableSelect>`
		// no cliente. Agora os selects buscam sob demanda em `/api/policiais/search`
		// (paginado, com RBAC). O servidor só envia o **mínimo necessário** para
		// renderizar labels dos valores já selecionados:
		//   - Os 4 supportIds (supervisor/assessor/SEINT1/SEINT2) — para o card de supervisão.
		//   - Membros já alocados são entregues via `gise.seccionais[].equipes[].membros`
		//     (já vêm com nome/matrícula em `buscarGiseDetalhado`), nada a fazer.
		const policiaisPromise: Promise<
			Array<{
				id: number;
				nome: string;
				matricula: string;
				cargo: 'DPC' | 'OIP';
				lotacao: string;
				email: string | null;
				email_pessoal: string | null;
			}>
		> =
			supportIds.length > 0
				? // E-mails (dado pessoal — LGPD) só para Admin Geral, espelhando a
					// política de /api/policiais/[id]/email-aviso e do campo
					// `assessorEmailSugerido` abaixo. A condição fica na PROJEÇÃO do
					// SELECT (minimização: o dado nem sai do banco para supervisores),
					// não em anulação pós-fetch.
					isGeral
					? db
							.select({
								id: policiais.id,
								nome: policiais.nome,
								matricula: policiais.matricula,
								cargo: policiais.cargo,
								lotacao: policiais.lotacao,
								email: policiais.email,
								email_pessoal: policiais.email_pessoal
							})
							.from(policiais)
							.where(and(eq(policiais.ativo, 1), inArray(policiais.id, supportIds)))
							.orderBy(asc(policiais.nome))
					: db
							.select({
								id: policiais.id,
								nome: policiais.nome,
								matricula: policiais.matricula,
								cargo: policiais.cargo,
								lotacao: policiais.lotacao
							})
							.from(policiais)
							.where(and(eq(policiais.ativo, 1), inArray(policiais.id, supportIds)))
							.orderBy(asc(policiais.nome))
							.then((rows) => rows.map((r) => ({ ...r, email: null, email_pessoal: null })))
				: Promise.resolve([]);

		const seintIdsParaRelatorio = [gise.seint1_id, gise.seint2_id].filter(
			(x): x is number => x != null
		);

		/** E-mail do assessor já vinculado à GISE (pessoal ou institucional), só para Admin Geral — não depende da lista enxuta nem de `ativo`. */
		const assessorEmailRowPromise =
			isGeral && gise.assessor_id
				? db
						.select({
							email_pessoal: policiais.email_pessoal,
							email: policiais.email
						})
						.from(policiais)
						.where(eq(policiais.id, gise.assessor_id))
						.get()
				: Promise.resolve(null as { email_pessoal: string | null; email: string | null } | null);

		// Queries paralelas restantes
		const [
			policiaisListResult,
			todasUnidades,
			assinaturasRelatorios,
			restringirSmartphone,
			presencasGise,
			supervisaoExtraUnidadeId,
			respostasSeintSupervisaoRows,
			assessorEmailRow
		] = await Promise.all([
			policiaisPromise,
			db.select().from(unidades).orderBy(asc(unidades.nome)),
			buscarAssinaturasRelatoriosGise(db, id),
			buscarRestringirSmartphone(db),
			buscarPresencasGise(db, id, platform?.env),
			buscarUnidadeIdSupervisaoExtra(db),
			seintIdsParaRelatorio.length
				? db
						.select({ policial_id: giseRespostasFormulario.policial_id })
						.from(giseRespostasFormulario)
						.where(
							and(
								eq(giseRespostasFormulario.gise_id, id),
								inArray(giseRespostasFormulario.policial_id, seintIdsParaRelatorio),
								isNull(giseRespostasFormulario.equipe_id)
							)
						)
						.all()
				: Promise.resolve([] as { policial_id: number | null }[]),
			assessorEmailRowPromise
		]);

		const assessorEmailSugerido =
			isGeral && assessorEmailRow
				? assessorEmailRow.email_pessoal?.trim() || assessorEmailRow.email?.trim() || null
				: null;

		const seintSupervisaoComRelatorio = [
			...new Set(
				respostasSeintSupervisaoRows
					.map((r) => r.policial_id)
					.filter((pid): pid is number => pid != null)
			)
		];

		// Tipos de equipe que a OPERAÇÃO desta escala habilita — a EDGE pode ser só
		// de inteligência. Serve para a tela não OFERECER um tipo que a action vai
		// recusar; quem recusa continua sendo a action (`adicionarEquipe`).
		// Escala sem operação (anterior à migração 0048) aceita os dois, como antes.
		const operacaoDaEscala =
			gise.operacao_id != null ? await buscarOperacao(db, gise.operacao_id) : null;
		const tiposEquipePermitidos = operacaoDaEscala
			? tiposEquipeDaOperacao(operacaoDaEscala)
			: [...TIPOS_EQUIPE];

		return {
			gise,
			operacaoNome: operacaoDaEscala?.nome ?? null,
			tiposEquipePermitidos,
			breveRelatorioEnv: await getBreveRelatorioEnvMergido(db, gise.operacao_id),
			policiais: policiaisListResult,
			assessorEmailSugerido,
			todasUnidades,
			assinaturasRelatorios,
			// RECORTADO a `policial_id` + entrada/saída. A linha crua de
			// `buscarPresencasGise` é o manifesto forense (CPF decifrado, IP,
			// user-agent, GPS e as chaves R2 das selfies) e viajava INTEIRA para o
			// cliente — inclusive para o supervisor, que é policial comum —, sem que
			// tela nenhuma use nada além dos dois timestamps. É a mesma minimização
			// que os e-mails acima já recebiam neste mesmo `load`.
			presencasGise: presencasParaCliente(presencasGise),
			supervisaoExtraUnidadeId,
			seintSupervisaoComRelatorio,
			papelGise: isGeral
				? 'admin_geral'
				: isSeccional
					? 'admin_seccional'
					: isSupervisor
						? 'supervisor'
						: 'policial',
			isGeral,
			isSeccional,
			isUnidade: isAdminUnidade(u),
			isSupervisor,
			isMembro: u.tipo === 'policial' ? (parentData.isMembroGise ?? false) : false,
			minhaSeccionalId: isSeccional || isAdminUnidade(u) ? u.papel_unidade_id : null,
			usuarioAtual: u,
			restringirSmartphone,
			exigirFotoAssinatura: parentData.exigirFotoAssinatura,
			exigirGpsAssinatura: parentData.exigirGpsAssinatura,
			exigirCodigoEmailAssinatura: parentData.exigirCodigoEmailAssinatura
		};
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		const msg = mensagemDeErro(e);
		// errorId correlaciona a mensagem genérica ao log estruturado — a
		// mensagem interna (Drizzle/D1) nunca vai para o cliente.
		const errorId = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
		logger.error('[gise/load] Erro ao carregar GISE', {
			gise_id: id,
			errorId,
			error: msg,
			stack: e instanceof Error ? e.stack : undefined
		});
		error(500, `Erro ao carregar a escala GISE. Informe o código ${errorId} ao suporte.`);
	}
};

export const actions: Actions = {
	...actionsEscala,
	...actionsSeccional,
	...actionsEquipe,
	...actionsMembros,
	...actionsUnidade
};
