/**
 * `load` e actions da lista de policiais (`/servidores`).
 *
 * O `load` só lista — paginação, filtros e escopo por lotação. Desde ago/2026 a
 * lista também é vista pelo administrador de SECCIONAL e de UNIDADE, RECORTADA
 * pelo escopo dele (`lotacoesAdministradas`): é dali que ele abre a ficha do
 * servidor para pedir a correção de um dado. O recorte é do servidor, não do
 * filtro de tela — trocar o parâmetro `lotacao` na URL não amplia nada.
 *
 * As duas actions continuam **exclusivas do Admin Geral**, e é o servidor que
 * impõe isso: a tela esconde os botões, mas quem recusa o POST direto é este
 * arquivo. Cadastrar e EXCLUIR não são "alterar dado do servidor" — o primeiro
 * cria o vínculo com a corporação, o segundo apaga a linha; nenhum dos dois
 * entra no fluxo de solicitação.
 *
 * - `criar`: cadastra o policial (senha aleatória + primeiro acesso), vincula
 *   conta de Admin Geral quando pedido e audita. Matrícula duplicada é o erro
 *   esperado e vira 409 legível via `ehViolacaoUnique` — a mensagem crua do
 *   Drizzle é só `"Failed query: insert into ..."`, e a violação real fica dois
 *   níveis de `cause` abaixo;
 * - `excluir`: DELETE físico, precedido de `desvincularAdminGeral` para não
 *   deixar login admin órfão, e auditado com nome e matrícula — depois do
 *   delete não haveria mais como saber quem foi.
 */
import { redirect, fail } from '@sveltejs/kit';
import { ehViolacaoUnique } from '$lib/server/db-errors';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarPoliciais,
	buscarPolicial,
	buscarPolicialPorMatricula,
	criarPolicial,
	excluirPolicial,
	excluirCredenciaisDoDono,
	listarUnidades,
	listarDesignacoes,
	registrarAuditComContexto,
	auditar,
	contextoDeEvento,
	vincularAdminGeral,
	desvincularAdminGeral
} from '$lib/db';
import { policialSchema } from '$lib/schemas/policial';
import { isAdminGeral } from '$lib/auth';
import {
	lotacoesAdministradas,
	unidadesAdministradas,
	lotacaoNoEscopo
} from '$lib/server/policial-permissao';
import { podeAbrirFichaDePolicial } from '$lib/server/policiais/ficha-permissao';
import { responsaveisVigentesDe } from '$lib/db/unidades-responsaveis';
import { arvoreUnidades } from '$lib/db/unidades';
import { localValido } from '$lib/unidades/locais';
import { designarTitularNoAto, mensagemDoAtalho } from '$lib/server/unidades/designar-titular';
import { decifrarCpfDoDB } from '$lib/crypto/cpf-cripto';
import { impedimentoParaExcluirPolicial } from '$lib/db/policiais';
import { afastamentosVigentesDe, situacaoDe } from '$lib/db/efetivo';
import { pendenciasDeFerias, abonosVigentesDe } from '$lib/db';
import { hojeBrasilISO } from '$lib/utils/datas';

export const load: PageServerLoad = async ({ locals, platform, url, depends }) => {
	depends('app:policiais');

	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	if (!podeAbrirFichaDePolicial(u)) {
		redirect(302, '/');
	}

	const db = getDB(platform);
	const lotacaoParam = url.searchParams.get('lotacao') || undefined;
	const cargo = url.searchParams.get('cargo') || undefined;
	const situacaoParam = url.searchParams.get('situacao') || '';
	const situacao = (['ativos', 'ferias', 'afastados'] as const).find((s) => s === situacaoParam);
	const hoje = hojeBrasilISO();
	const busca = url.searchParams.get('busca') || undefined;
	const designacaoParam = url.searchParams.get('designacao') || '';
	const designacaoId = Number(designacaoParam) > 0 ? Number(designacaoParam) : undefined;
	const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;

	const seccional = url.searchParams.get('seccional');
	const seccionalId = seccional && seccional !== 'todas' ? Number(seccional) : undefined;

	// `null` = irrestrito (Admin Geral); Set = as lotações do papel.
	// O recorte da lista, em IDS (E51): compara `policiais.unidade_id`, que
	// sobrevive a uma renomeação de unidade. `null` = irrestrito (Super Admin).
	const escopoIds = await unidadesAdministradas(db, u);

	// A árvore vem primeiro porque as direções se consultam pelos ids dela — o
	// atalho "designar como titular" (E66) só aparece para unidade SEM titular.
	const unidades = await listarUnidades(db);
	const [resultado, designacoes, direcoes] = await Promise.all([
		listarPoliciais(db, lotacaoParam, false, {
			busca,
			cargo,
			seccionalId,
			escopoUnidades: escopoIds ? [...escopoIds] : undefined,
			situacao,
			hojeISO: hoje,
			designacaoId,
			page,
			limit: 20
		}),
		listarDesignacoes(db),
		responsaveisVigentesDe(
			db,
			unidades.map((x) => x.id)
		)
	]);

	// CPF é cifrado em repouso (LGPD) e só é decifrado para quem edita o cadastro
	// direto — o Admin Geral. Para o administrador com escopo a lista vai SEM
	// CPF: ele pede a correção informando o número novo, e nunca precisou ler o
	// atual para isso (minimização, LGPD art. 6º III).
	// A situação de hoje de cada linha da página (fase 2-C): férias em dourado,
	// afastado em vermelho, com o tipo e o fim — o que faltava para saber de
	// quem se trata sem abrir a ficha.
	const ids = resultado.policiais.map((p) => p.id);
	// Pendências de férias — pedido aguardando a COGEP e abono sem ciência —
	// viram alerta na linha, e só somem quando a unidade resolve (E56).
	const [vigentes, pendencias, abonos] = await Promise.all([
		afastamentosVigentesDe(db, ids, hoje),
		pendenciasDeFerias(db, ids),
		abonosVigentesDe(db, ids, hoje)
	]);
	const policiaisComCpf = await Promise.all(
		resultado.policiais.map(async (p) => ({
			...p,
			cpf: isAdminGeral(u) ? (await decifrarCpfDoDB(p.cpf, platform?.env)) || null : null,
			situacao: situacaoDe(vigentes.get(p.id)),
			afastamento: vigentes.get(p.id) ?? null,
			pendenciasFerias: pendencias.get(p.id) ?? null,
			/** Nos dias convertidos em abono o servidor trabalha: ativo, com o porquê. */
			abono: abonos.get(p.id) ?? null
		}))
	);

	return {
		policiais: policiaisComCpf,
		pagination: {
			page: resultado.page,
			limit: resultado.limit,
			total: resultado.total,
			totalPages: resultado.totalPages
		},
		unidades,
		designacoes,
		/** Unidades ativas SEM direção vigente — o atalho da E66 e o aviso da tela. */
		semTitular: unidades.filter((x) => !direcoes.has(x.id)).map((x) => x.id),
		filtros: {
			lotacao: lotacaoParam ?? '',
			cargo: cargo ?? '',
			busca: busca ?? '',
			seccional: seccional ?? 'todas',
			situacao: situacao ?? '',
			designacao: designacaoId ? String(designacaoId) : ''
		},
		lotacaoUsuario: u.lotacao
	};
};

export const actions: Actions = {
	criar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		if (!isAdminGeral(u)) {
			return fail(403, { error: 'Apenas o Admin Geral pode cadastrar policiais' });
		}

		const data = await request.formData();

		const nome = data.get('nome')?.toString() || '';
		const matricula = data.get('matricula')?.toString() || '';
		const cargoVal = data.get('cargo')?.toString() as 'DPC' | 'OIP';
		const cpf = data.get('cpf')?.toString() || '';
		const telefone = data.get('telefone')?.toString() || '';
		const classe = data.get('classe')?.toString() || '';
		const regime = data.get('regime')?.toString() as 'plantao' | 'expediente' | 'ambos';
		const lotacao = data.get('lotacao')?.toString() || '';
		const email = data.get('email')?.toString() || null;
		const emailPessoal = data.get('email_pessoal')?.toString() || null;
		const papelRequisitado = data.get('papel')?.toString() || null;
		const papelUnidadeIdRequisitado = data.get('papel_unidade_id')
			? Number(data.get('papel_unidade_id'))
			: null;

		// Apenas Admin Geral pode atribuir papel administrativo. Para os demais,
		// ignoramos silenciosamente — o caminho legítimo é o endpoint dedicado
		// `?/salvarPapel` (em /servidores/[id], guardado por `u.tipo === 'admin'`).
		const papel = isAdminGeral(u) ? papelRequisitado : null;
		const papelUnidadeId = isAdminGeral(u) ? papelUnidadeIdRequisitado : null;

		// Papel administrativo exige a unidade/seccional de responsabilidade.
		if (papel && !papelUnidadeId) {
			return fail(400, {
				error: 'Selecione a unidade de responsabilidade para o papel administrativo.'
			});
		}

		const db = getDB(platform);

		// Escopo: admin_unidade só cria na própria lotação; admin_seccional só
		// dentro das unidades vinculadas à seccional dele.
		const escopo = await lotacoesAdministradas(db, u);
		if (!lotacaoNoEscopo(escopo, lotacao)) {
			return fail(403, {
				error: 'Você só pode cadastrar policiais nas unidades sob sua administração'
			});
		}

		// "Trabalha em" (E66) e o atalho "designar como titular": os dois só valem
		// para o Admin Geral, que é quem cadastra com lotação livre.
		const localBruto = data.get('local_id')?.toString() ?? '';
		const localId = localBruto === '' ? null : Number(localBruto);
		if (localId !== null && (!Number.isInteger(localId) || localId <= 0)) {
			return fail(400, { error: 'Local de trabalho inválido.' });
		}
		const arvore = await arvoreUnidades(db);
		const unidadeDaLotacao = [...arvore.values()].find((x) => x.nome === lotacao)?.id ?? null;
		if (!localValido(arvore, unidadeDaLotacao, localId)) {
			return fail(400, {
				error: 'O local de trabalho tem de ser a própria unidade de lotação ou uma subunidade dela.'
			});
		}

		const parsed = policialSchema.safeParse({
			nome,
			matricula,
			cargo: cargoVal,
			cpf: cpf || null,
			telefone,
			lotacao,
			regime,
			classe,
			papel: papel || null,
			papel_unidade_id: papelUnidadeId || null,
			local_id: localId,
			email: email || null,
			email_pessoal: emailPessoal || null
		});

		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0].message,
				fields: {
					nome,
					matricula,
					cargo: cargoVal,
					cpf,
					telefone,
					classe,
					regime,
					lotacao,
					email,
					emailPessoal
				}
			});
		}

		try {
			const concederAdminGeral = ['1', 'true', 'on'].includes(
				String(data.get('conceder_admin_geral') ?? '').toLowerCase()
			);
			const moduloEscalas = ['1', 'true', 'on'].includes(
				String(data.get('modulo_escalas') ?? '1').toLowerCase()
			);
			const moduloGise = ['1', 'true', 'on'].includes(
				String(data.get('modulo_gise') ?? '1').toLowerCase()
			);
			if (concederAdminGeral && !moduloEscalas && !moduloGise) {
				return fail(400, {
					error: 'Libere ao menos um módulo (Escalas ou GISE) ao conceder Admin Geral.'
				});
			}

			await criarPolicial(
				db,
				{
					...parsed.data,
					email: email || null,
					email_pessoal: emailPessoal || null
				},
				platform?.env
			);

			// Atalho da E66: o delegado recém-cadastrado assume a unidade que estava
			// sem titular, no mesmo ato. Recusa aqui é erro de formulário, não
			// silêncio: quem pediu precisa saber que a direção NÃO foi registrada.
			const designarTitular = ['1', 'true', 'on'].includes(
				String(data.get('designar_titular') ?? '').toLowerCase()
			);
			if (designarTitular) {
				const novo = await buscarPolicialPorMatricula(db, matricula);
				const r = novo
					? await designarTitularNoAto(db, {
							unidadeNome: lotacao,
							policialId: novo.id,
							cargo: cargoVal,
							dataInicio: data.get('titular_desde')?.toString() || hojeBrasilISO(),
							nup: data.get('titular_nup')?.toString() || '',
							quem: { id: u.id, nome: u.nome }
						})
					: ({ ok: false, motivo: 'falhou' } as const);
				if (!r.ok) {
					return fail(400, {
						error: `Servidor cadastrado, mas a direção não foi registrada: ${mensagemDoAtalho(r.motivo)}`
					});
				}
			}
			// Conceder Admin Geral já no cadastro (cria a conta vinculada). Como o
			// id só existe após o insert, busca pela matrícula.
			if (concederAdminGeral) {
				const novo = await buscarPolicialPorMatricula(db, matricula);
				if (novo) {
					await vincularAdminGeral(db, novo, {
						escalas: moduloEscalas,
						gise: moduloGise
					});
				}
			}
			const { contexto, env } = contextoDeEvento(event);
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'criar_policial',
				entidade: 'policial',
				alvo_tipo: 'policial',
				alvo_nome: nome,
				detalhes: `Criado policial: ${nome} (matrícula: ${matricula})`,
				...contexto,
				env
			});
			return { success: true };
		} catch (e: unknown) {
			// A violação de índice único fica em `e.cause` (ver `db-errors.ts`).
			if (ehViolacaoUnique(e)) {
				return fail(409, {
					error: 'Matrícula já cadastrada',
					fields: {
						nome,
						matricula,
						cargo: cargoVal,
						cpf,
						telefone,
						classe,
						regime,
						lotacao,
						email,
						emailPessoal
					}
				});
			}
			return fail(500, {
				error: 'Erro interno ao criar policial',
				fields: {
					nome,
					matricula,
					cargo: cargoVal,
					cpf,
					telefone,
					classe,
					regime,
					lotacao,
					email,
					emailPessoal
				}
			});
		}
	},
	excluir: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		if (!isAdminGeral(u))
			return fail(403, { error: 'Apenas o Admin Geral pode excluir policiais' });

		const data = await request.formData();
		const policialId = Number(data.get('policial_id'));
		if (isNaN(policialId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);

		// Escopo do alvo: admin_seccional/unidade só apaga policiais sob sua
		// administração. Admin Geral irrestrito.
		const policial = await buscarPolicial(db, policialId);
		if (!policial) return fail(404, { error: 'Policial não encontrado' });

		const escopo = await lotacoesAdministradas(db, u);
		if (!lotacaoNoEscopo(escopo, policial.lotacao)) {
			return fail(403, { error: 'Sem permissão para excluir este policial' });
		}

		// A regra não é "nunca apagar": é nunca apagar o que um documento assinado
		// referencia. O PDF continua existindo no R2 depois do DELETE, e passaria
		// a citar uma pessoa e fatos que o banco não tem mais (FLW-POLICIAL-002).
		// Quem já tem documento é DESVINCULADO, não excluído.
		const impedimento = await impedimentoParaExcluirPolicial(db, policialId);
		if (impedimento) return fail(409, { error: impedimento });

		// Remove também a conta Admin Geral vinculada (se houver), evitando um
		// login admin órfão apontando para um policial inexistente.
		await desvincularAdminGeral(db, policialId);

		// A passkey é dado pessoal e não tem FK que a leve junto. Só chegamos
		// aqui quando a pessoa NÃO tem documento assinado (o impedimento acima
		// barra quem tem), então não há assinatura órfã a conferir depois — e
		// deixar a chave pública viva seria guardar dado de um titular que não
		// existe mais no sistema (LGPD art. 16).
		await excluirCredenciaisDoDono(db, { tipo: 'policial', id: policialId });
		await excluirPolicial(db, policialId);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'excluir_policial',
				usuario: u,
				entidade: 'policial',
				entidade_id: policialId,
				alvo_tipo: 'policial',
				alvo_id: policialId,
				alvo_nome: policial.nome,
				detalhes: `Policial excluído: ${policial.nome} (mat. ${policial.matricula})`,
				...contexto
			},
			{ env }
		);
		return { success: true };
	}
};
