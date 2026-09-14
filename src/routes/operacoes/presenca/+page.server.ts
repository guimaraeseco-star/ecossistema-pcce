/**
 * `/operacoes/presenca` — a tela do POLICIAL na GISE (o Admin Geral só observa).
 *
 * Reúne, para o usuário logado, todas as escalas GISE em que ele aparece, em
 * dois papéis que vêm de origens diferentes no banco:
 *
 * - **membro de equipe** — linhas de `gise_membros`, com seccional e unidade;
 * - **quadro de supervisão** (supervisor, assessor, SEINT) — não tem equipe;
 *   essas linhas são sintetizadas com `equipe_id = 0` e `seccional_id = 0`, e o
 *   `0` é depois traduzido para `supervisaoExtraUnidadeId` na hora de casar
 *   assinaturas de relatório de extra.
 *
 * As duas mutações de presença — confirmar entrada e confirmar saída — são de
 * assinatura AVANÇADA (Lei 14.063/2020 art. 4º II): exigem confirmação em tela,
 * 2FA por e-mail quando a flag está ligada, e gravam IP/GPS/foto como prova. Cada action
 * revalida a participação do policial na escala: a UI esconde o botão, mas o
 * POST direto precisa ser recusado no servidor.
 *
 * A terceira tarefa do policial, o relatório de produtividade, NÃO mora mais
 * aqui: o formulário virou a rota `/operacoes/presenca/relatorio/[giseId]`, com o `load` e
 * a action dele. Esta tela só mostra o estado da entrega (carimbos de envio e
 * retificação) e leva até lá.
 */

import { hojeBrasilISO } from '$lib/utils/datas';
import { redirect, fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { ResGiseMinhaEscalaLinha, GiseModeloPerguntaConfig } from '$lib/types';
import {
	getDB,
	getR2,
	hasR2,
	buscarGiseModeloFormulario,
	buscarRespostaGise,
	buscarGiseEscala,
	resolverParticipacaoGisePolicial,
	sincronizarStatusGiseAposPresencaRelatorios,
	salvarEntradaGise,
	salvarSaidaGise,
	salvarGiseModeloFormulario,
	buscarRestringirSmartphone,
	isSupervisaoGiseAtiva,
	isSupervisorGiseAtiva,
	auditar,
	contextoDeEvento,
	listarOperacoes,
	buscarOperacao,
	operacaoAceitaTipoEquipe,
	NOME_OPERACAO_PADRAO,
	DEFAULT_SEINT_QUESTIONS,
	DEFAULT_QUESTIONS_FORM_OPERACIONAL,
	likePrefix
} from '$lib/db';
import { invalidarPapelGise } from '$lib/server/gise/papel-cache';
import { buscarUnidadeIdSupervisaoExtra } from '$lib/server/gise/supervisao-extra';
import { lerFlagsAssinatura } from '$lib/server/assinatura/cfg-ass-cache';
import {
	recusadaPorPoliticaDispositivo,
	ERRO_POLITICA_DISPOSITIVO
} from '$lib/server/assinatura/signature-service';
import { ERRO_PASSKEY_UM_TIRO } from '$lib/server/assinatura/chave-assinatura';
import { exigirJanelaReauth } from '$lib/server/assinatura/reauth';
import { verificarDesafio2FA, temCadastro } from '$lib/auth';
import { logger } from '$lib/server/logger';
import { uploadSelfieDataUri } from '$lib/server/assinatura/selfie-upload';
import { coordenadaGeograficaValida } from '$lib/server/assinatura/document-utils';
import { textoLimitado, MAX_CONFIG_FORMULARIO } from '$lib/server/form-data';
import {
	lerMotivoSemEvidencia,
	recusaPorEvidenciaDePresenca,
	metadadosDeEvidenciaPresenca
} from '$lib/assinatura-evidencia';
import {
	giseEscalas,
	giseMembros,
	giseEquipes,
	giseSeccionais,
	gisePresencas,
	giseDocumentos,
	unidades,
	giseAssinaturasRelatorios,
	giseRespostasFormulario
} from '$lib/server/schema';
import { eq, and, inArray, desc, sql, or, gte, lte } from 'drizzle-orm';
import { gateDePresenca, type TipoPresenca } from '$lib/server/gise/presenca-gate';
import {
	linhaResGisePassaTipo,
	parseFiltrosHistoricoResGise,
	recorteIsoDataInicio,
	type FiltrosHistoricoResGise
} from './_components/filtros-historico';

function predRecorteDataInicio(f: FiltrosHistoricoResGise) {
	const r = recorteIsoDataInicio(f);
	if (r.tipo === 'eq') return eq(giseEscalas.data_inicio, r.valor);
	if (r.tipo === 'prefix') return likePrefix(giseEscalas.data_inicio, r.valor);
	if (r.tipo === 'intervalo') {
		return and(gte(giseEscalas.data_inicio, r.inicio), lte(giseEscalas.data_inicio, r.fim));
	}
	return sql`1=1`;
}

interface GiseEscalaItem {
	id: number;
	data_inicio: string;
	status: string;
	hora_entrada: string | null;
	hora_saida: string | null;
	equipe_id: number;
	sec_hora_entrada: string | null;
	sec_hora_saida: string | null;
	eq_hora_entrada: string | null;
	eq_hora_saida: string | null;
	equipe_tipo: 'operacional' | 'seint' | 'assessor' | 'supervisor';
	seccional_id: number;
	seccional_nome: string;
}

type GisePresenca = typeof gisePresencas.$inferSelect;

export const load: PageServerLoad = async ({ locals, platform, url, depends }) => {
	depends('app:res-gise');

	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	// Filtros da tela. "Ativa × finalizada" NÃO é o status da escala: uma GISE em
	// andamento já é "finalizada" para quem bateu a saída (ver `isFinished`).
	const statusFilter = url.searchParams.get('status') || ''; // 'ativas' ou 'finalizadas'
	const filtrosHistorico = parseFiltrosHistoricoResGise(
		url.searchParams,
		statusFilter === 'finalizadas' ? hojeBrasilISO() : undefined
	);
	const tipoFilter = filtrosHistorico.tipo;
	const recorteData = predRecorteDataInicio(filtrosHistorico);

	const db = getDB(platform);

	// ## As ondas deste `load`
	//
	// Esta é a tela do policial EM CAMPO — a que abre no celular, em rede móvel,
	// durante a operação. Cada `await` em série é uma ida à rede esperando a
	// anterior, e aqui eram DEZ, das quais só três dependiam de fato de algo
	// anterior. Agora são quatro ondas, e cada uma existe por uma dependência
	// REAL:
	//
	//   1. esta — o que só depende do usuário e da URL;
	//   2. as escalas do policial: `rawSupervisorDpc` precisa de `isSupervisorGise`;
	//   3. presenças/documentos/relatórios: precisam dos `giseIds` da onda 2;
	//   4. os modelos de formulário: precisam da operação resolvida na onda 2.
	//
	// Quem acrescentar consulta aqui: ponha na onda mais CEDO cuja dependência
	// ela respeite, não numa nova.
	const ehPolicial = u.tipo === 'policial';
	// Quem pode abrir esta rota (as duas abas — Presença e Histórico — moram nela):
	// qualquer policial que JÁ tenha participado de uma GISE, ativa ou encerrada.
	// Por isso o vínculo é checado sem filtro de status: membro de equipe (em
	// qualquer GISE) OU quadro de supervisão (supervisor/assessor/SEINT de
	// qualquer GISE). Sem isso, um policial cujo histórico é só de quadro (nunca
	// foi membro de equipe) e sem GISE ativa era barrado na própria aba de
	// histórico. Admin Geral entra sempre (usa a rota como editor do formulário).
	//
	// O portão continua ANTES de qualquer consulta de dado (onda 2): juntar as
	// duas ondas economizaria uma ida, ao custo de trabalhar em nome de quem vai
	// ser redirecionado.
	//
	// `precisaDeVinculo` e `ehPolicial` têm hoje o MESMO valor — `tipo` só assume
	// 'policial' e 'admin'. São dois nomes porque são duas perguntas: uma é de
	// autorização (quem passa no portão), a outra é de forma do dado (quem tem
	// escala própria para listar). Um terceiro tipo de usuário separaria as duas.
	const precisaDeVinculo = u.tipo !== 'admin';
	const [supervisaoExtraUnidadeId, isSupervisorGise, isSupervisaoGise, membroEver, quadroEver] =
		await Promise.all([
			buscarUnidadeIdSupervisaoExtra(db),
			// Supervisor DPC com GISE ativa (não finalizada) — mesmo critério do menu / cache de papel
			ehPolicial ? isSupervisorGiseAtiva(db, u.id) : Promise.resolve(false),
			ehPolicial ? isSupervisaoGiseAtiva(db, u.id) : Promise.resolve(false),
			precisaDeVinculo
				? db
						.select({ id: giseMembros.id })
						.from(giseMembros)
						.where(eq(giseMembros.policial_id, u.id))
						.limit(1)
						.get()
				: Promise.resolve(undefined),
			precisaDeVinculo
				? db
						.select({ id: giseEscalas.id })
						.from(giseEscalas)
						.where(
							or(
								eq(giseEscalas.supervisor_id, u.id),
								eq(giseEscalas.assessor_id, u.id),
								eq(giseEscalas.seint1_id, u.id),
								eq(giseEscalas.seint2_id, u.id)
							)
						)
						.limit(1)
						.get()
				: Promise.resolve(undefined)
		]);

	if (precisaDeVinculo && !membroEver && !quadroEver) redirect(302, '/');

	const minhasEscalas: ResGiseMinhaEscalaLinha[] = [];

	const effectiveStatus = statusFilter || 'ativas';

	// Lidos da URL, sem consulta — por isso `respostaRow` cabe na onda 2 junto
	// das escalas, e não numa onda depois delas.
	const giseIdSelected = url.searchParams.get('giseId')
		? parseInt(url.searchParams.get('giseId')!)
		: null;
	const equipeIdSelected = url.searchParams.get('equipeId')
		? parseInt(url.searchParams.get('equipeId')!)
		: null;

	// ONDA 2 — as três origens de escala do policial mais o que a aba do editor
	// precisa. As três origens eram três `await` em série e não dependem uma da
	// outra: `rawSupervisorDpc` depende de `isSupervisorGise`, que veio da onda 1.
	//
	// `operacoesLista`, `respostaRow` e `restringirSmartphone` moravam no FIM do
	// `load`, em duas ondas próprias, e nenhum dos três depende das escalas —
	// só da URL. Estar aqui não muda o que devolvem.
	const [
		escalasDeEquipe,
		escalasDeQuadro,
		escalasDeSupervisorDpc,
		operacoesLista,
		respostaRow,
		restringirSmartphone
	] = await Promise.all([
		ehPolicial
			? (db
					.select({
						id: giseEscalas.id,
						data_inicio: giseEscalas.data_inicio,
						status: giseEscalas.status,
						hora_entrada: giseEscalas.hora_entrada,
						hora_saida: giseEscalas.hora_saida,
						equipe_id: giseEquipes.id,
						// Horas por nível (equipe > seccional > escala)
						sec_hora_entrada: giseSeccionais.hora_entrada,
						sec_hora_saida: giseSeccionais.hora_saida,
						eq_hora_entrada: giseEquipes.hora_entrada,
						eq_hora_saida: giseEquipes.hora_saida,
						equipe_tipo: giseEquipes.tipo,
						seccional_id: giseSeccionais.seccional_id,
						seccional_nome: unidades.nome
					})
					.from(giseMembros)
					.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
					.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
					.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
					.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
					.where(
						and(
							eq(giseMembros.policial_id, u.id),
							recorteData,
							tipoFilter ? eq(giseEquipes.tipo, tipoFilter) : sql`1=1`
						)
					)
					.orderBy(desc(giseEscalas.data_inicio))
					.all() as unknown as Promise<GiseEscalaItem[]>)
			: Promise.resolve([] as GiseEscalaItem[]),
		// Segunda origem: o policial no quadro de supervisão da escala. Sem equipe
		// e sem seccional, os campos são preenchidos com `0`/NULL para caber no
		// mesmo shape das linhas de equipe e seguir por um único caminho abaixo.
		// Recorte "operacional" não inclui quadro; "seint" inclui só SEINT 1/2.
		ehPolicial && tipoFilter !== 'operacional'
			? (db
					.select({
						id: giseEscalas.id,
						data_inicio: giseEscalas.data_inicio,
						status: giseEscalas.status,
						hora_entrada: giseEscalas.hora_entrada,
						hora_saida: giseEscalas.hora_saida,
						equipe_id: sql`0`.as('equipe_id'),
						sec_hora_entrada: sql`NULL`.as('sec_hora_entrada'),
						sec_hora_saida: sql`NULL`.as('sec_hora_saida'),
						eq_hora_entrada: sql`NULL`.as('eq_hora_entrada'),
						eq_hora_saida: sql`NULL`.as('eq_hora_saida'),
						equipe_tipo: sql<string>`CASE WHEN ${giseEscalas.assessor_id} = ${u.id} THEN 'assessor' ELSE 'seint' END`,
						seccional_id: sql`0`.as('seccional_id'),
						seccional_nome: sql`'Supervisão Geral'`.as('seccional_nome')
					})
					.from(giseEscalas)
					.where(
						and(
							tipoFilter === 'seint'
								? sql`(${giseEscalas.seint1_id} = ${u.id} OR ${giseEscalas.seint2_id} = ${u.id})`
								: sql`(${giseEscalas.assessor_id} = ${u.id} OR ${giseEscalas.seint1_id} = ${u.id} OR ${giseEscalas.seint2_id} = ${u.id})`,
							recorteData
						)
					)
					.all() as unknown as Promise<GiseEscalaItem[]>)
			: Promise.resolve([] as GiseEscalaItem[]),
		// DPC supervisor da escala: mesma UX de assessor (entrada/saída, sem formulário de produtividade aqui)
		ehPolicial && isSupervisorGise && !tipoFilter
			? (db
					.select({
						id: giseEscalas.id,
						data_inicio: giseEscalas.data_inicio,
						status: giseEscalas.status,
						hora_entrada: giseEscalas.hora_entrada,
						hora_saida: giseEscalas.hora_saida,
						equipe_id: sql`0`.as('equipe_id'),
						sec_hora_entrada: sql`NULL`.as('sec_hora_entrada'),
						sec_hora_saida: sql`NULL`.as('sec_hora_saida'),
						eq_hora_entrada: sql`NULL`.as('eq_hora_entrada'),
						eq_hora_saida: sql`NULL`.as('eq_hora_saida'),
						equipe_tipo: sql<string>`'supervisor'`,
						seccional_id: sql`0`.as('seccional_id'),
						seccional_nome: sql`'Supervisão Geral'`.as('seccional_nome')
					})
					.from(giseEscalas)
					.where(and(eq(giseEscalas.supervisor_id, u.id), recorteData))
					.all() as unknown as Promise<GiseEscalaItem[]>)
			: Promise.resolve([] as GiseEscalaItem[]),
		listarOperacoes(db, { somenteAtivas: true }),
		giseIdSelected && !isNaN(giseIdSelected)
			? buscarRespostaGise(
					db,
					giseIdSelected,
					u.tipo === 'policial' ? u.id : null,
					equipeIdSelected ?? undefined
				)
			: Promise.resolve(null),
		buscarRestringirSmartphone(db)
	]);

	if (u.tipo === 'policial') {
		const rawEscalas = [...escalasDeEquipe, ...escalasDeQuadro];
		// O supervisor DPC pode já constar por outra origem — só entra o que falta.
		for (const row of escalasDeSupervisorDpc) {
			if (!rawEscalas.some((r) => r.id === row.id)) rawEscalas.push(row);
		}

		// Ordenar novamente já que fundimos duas listas
		rawEscalas.sort(
			(a, b) => new Date(b.data_inicio).getTime() - new Date(a.data_inicio).getTime()
		);

		const giseIds = [...new Set(rawEscalas.map((e) => e.id))];

		const presencasMap = new Map<number, GisePresenca>();
		const docsAssinadosMap = new Map<number, boolean>();
		const extrasAssinadosMap = new Map<string, boolean>();
		const respostasEquipeMap = new Map<string, boolean>();
		const respostasPolicialMap = new Map<string, boolean>();

		// Um lote por informação, em paralelo, em vez de N consultas por escala:
		// presença do usuário, escalas com documento assinado, extras assinados e
		// relatórios já enviados. Viram mapas para consulta O(1) no laço seguinte.
		if (giseIds.length > 0) {
			// 4 queries independentes em paralelo
			const [presencas, docs, extras, respostas] = await Promise.all([
				db
					.select()
					.from(gisePresencas)
					.where(and(inArray(gisePresencas.gise_id, giseIds), eq(gisePresencas.policial_id, u.id)))
					.all(),
				db
					.select({ gise_id: giseDocumentos.gise_id })
					.from(giseDocumentos)
					.where(inArray(giseDocumentos.gise_id, giseIds))
					.all(),
				db
					.select({
						gise_id: giseAssinaturasRelatorios.gise_id,
						seccional_id: giseAssinaturasRelatorios.seccional_id
					})
					.from(giseAssinaturasRelatorios)
					.where(
						and(
							inArray(giseAssinaturasRelatorios.gise_id, giseIds),
							eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
						)
					)
					.all(),
				db
					.select({
						gise_id: giseRespostasFormulario.gise_id,
						equipe_id: giseRespostasFormulario.equipe_id,
						policial_id: giseRespostasFormulario.policial_id
					})
					.from(giseRespostasFormulario)
					.where(inArray(giseRespostasFormulario.gise_id, giseIds))
					.all()
			]);

			presencas.forEach((p) => presencasMap.set(p.gise_id, p));
			docs.forEach((doc) => docsAssinadosMap.set(doc.gise_id, true));
			extras.forEach((ext) => extrasAssinadosMap.set(`${ext.gise_id}_${ext.seccional_id}`, true));
			respostas.forEach((res) => {
				if (res.equipe_id != null) {
					respostasEquipeMap.set(`${res.gise_id}_${res.equipe_id}`, true);
				}
				if (res.policial_id != null) {
					respostasPolicialMap.set(`${res.gise_id}_${res.policial_id}`, true);
				}
			});
		}

		for (const e of rawEscalas) {
			const presenca = presencasMap.get(e.id);
			// Para o policial, a escala "acabou" quando ELE bateu a saída — mesmo que
			// a GISE siga aberta para os demais. O outro caso é a escala finalizada
			// pelo Admin Geral.
			const isFinished = (presenca && presenca.saida_timestamp) || e.status === 'finalizada';

			if (effectiveStatus === 'ativas' && isFinished) continue;
			if (effectiveStatus === 'finalizadas' && !isFinished) continue;
			if (!linhaResGisePassaTipo(e.equipe_tipo, tipoFilter)) continue;

			const docAssinado = docsAssinadosMap.get(e.id);
			// Linha do quadro de supervisão (`seccional_id === 0`) casa com a unidade
			// sintética do extra da supervisão; as demais, com a própria seccional.
			const secKeyExtra =
				e.seccional_id === 0 && supervisaoExtraUnidadeId != null
					? supervisaoExtraUnidadeId
					: e.seccional_id;
			const extraAssinado = extrasAssinadosMap.get(`${e.id}_${secKeyExtra}`);
			// Quem deve o relatório muda por papel: no quadro de supervisão só o SEINT
			// entrega (e a resposta é individual, sem equipe); supervisor e assessor
			// não devem nada, por isso `true`. Nas equipes, a entrega é do time.
			const respostaEquipe =
				e.seccional_id === 0
					? e.equipe_tipo === 'seint'
						? !!respostasPolicialMap.get(`${e.id}_${u.id}`)
						: true
					: !!respostasEquipeMap.get(`${e.id}_${e.equipe_id}`);

			// Prioridade de horário: equipe > seccional > escala
			const hEnt = e.eq_hora_entrada ?? e.sec_hora_entrada ?? e.hora_entrada ?? '08:00';
			const hSai = e.eq_hora_saida ?? e.sec_hora_saida ?? e.hora_saida ?? '16:00';

			minhasEscalas.push({
				...e,
				hora_entrada: e.hora_entrada ?? '08:00',
				hora_saida: e.hora_saida ?? '16:00',
				presenca,
				assinada: !!docAssinado,
				extraAssinado: !!extraAssinado,
				equipeRespondida: !!respostaEquipe,
				horarioPrevisto: { inicio: hEnt, fim: hSai }
			});
		}
	}
	// Qual operação o editor está editando. O formulário é POR OPERAÇÃO desde a
	// migração 0048, então a tela precisa de uma escolhida — `?operacaoId=` quando
	// o admin trocou no seletor, a primeira ativa em ordem alfabética caso
	// contrário. Um id que não existe cai no mesmo padrão em vez de dar 404: a
	// aba é do editor, e derrubá-la por causa de um parâmetro velho na URL não
	// ajuda ninguém.
	const operacaoIdParam = Number(url.searchParams.get('operacaoId'));
	const operacaoSelecionada =
		operacoesLista.find((o) => o.id === operacaoIdParam) ??
		operacoesLista.find((o) => o.nome === NOME_OPERACAO_PADRAO) ??
		operacoesLista[0] ??
		null;

	// ONDA 4 — só os modelos: são a única coisa que depende da operação, e a
	// operação só é conhecida depois da onda 2. `respostaRow` e
	// `restringirSmartphone` viajaram para lá, porque nenhum dos dois depende
	// dela.
	const [modeloOp, modeloSeintRow] = operacaoSelecionada
		? await Promise.all([
				buscarGiseModeloFormulario(db, operacaoSelecionada.id, 'operacional'),
				buscarGiseModeloFormulario(db, operacaoSelecionada.id, 'seint')
			])
		: [null, null];

	let modeloOperacional = DEFAULT_QUESTIONS_FORM_OPERACIONAL;
	if (modeloOp?.config) {
		try {
			modeloOperacional = JSON.parse(modeloOp.config);
		} catch (err) {
			logger.warn('[res-gise] modelo operacional JSON inválido', { err: String(err) });
		}
	}
	let modeloSeint = DEFAULT_SEINT_QUESTIONS;
	if (modeloSeintRow?.config) {
		try {
			modeloSeint = JSON.parse(modeloSeintRow.config);
		} catch (err) {
			logger.warn('[res-gise] modelo seint JSON inválido', { err: String(err) });
		}
	}

	/**
	 * Versão anterior de cada modelo, para o "Restaurar anterior" do editor.
	 * `null` quando nunca houve uma segunda gravação — ou quando o JSON está
	 * corrompido, caso em que é melhor desabilitar o botão do que oferecer uma
	 * restauração que quebraria o editor.
	 */
	function parseAnterior(raw: string | null | undefined, rotulo: string) {
		if (!raw) return null;
		try {
			return JSON.parse(raw) as GiseModeloPerguntaConfig[];
		} catch (err) {
			logger.warn(`[res-gise] modelo anterior ${rotulo} JSON inválido`, { err: String(err) });
			return null;
		}
	}

	return {
		minhasEscalas,
		isSupervisorGise,
		isSupervisaoGise,
		supervisaoExtraUnidadeId,
		// Carimbo de envio (created_at) e da última retificação (updated_at) da
		// resposta de produtividade — exibidos no card "Relatório Entregue". O
		// BLOB das respostas não vem mais daqui: quem edita é o wizard em
		// `/operacoes/presenca/relatorio/[giseId]`, que carrega o seu próprio.
		respostaEnviadaEm: respostaRow?.created_at ?? null,
		respostaAtualizadaEm: respostaRow?.updated_at ?? null,
		restringirSmartphone,
		// Operações e a escolhida: o editor mostra um formulário por operação, e o
		// seletor de TIPO só pode oferecer os tipos de equipe que ela habilita.
		operacoes: operacoesLista,
		operacaoSelecionadaId: operacaoSelecionada?.id ?? null,
		modeloOperacional,
		modeloSeint,
		modeloAnteriorOperacional: parseAnterior(modeloOp?.config_anterior, 'operacional'),
		modeloAnteriorSeint: parseAnterior(modeloSeintRow?.config_anterior, 'seint')
	};
};

/**
 * Preparo comum às duas confirmações de presença (entrada/saída): parse do
 * form, política de dispositivo → 2FA → existência da escala → participação →
 * gate de presença → foto. Nada é persistido antes de todas as verificações
 * passarem, para que uma tentativa recusada não deixe rastro de presença.
 *
 * `tipo` só entra no gate — o RESTO é idêntico entre entrada e saída (FLW-AUT-
 * 006/007 exigem a mesma janela e imutabilidade do canal A3 nos dois). Cada
 * action ainda faz sua própria gravação (`salvarEntradaGise`/`salvarSaidaGise`
 * — a saída também confere que há entrada registrada) e sua própria auditoria.
 */
async function prepararConfirmacaoPresenca(event: RequestEvent, tipo: TipoPresenca) {
	const { request, locals, platform, cookies, getClientAddress } = event;
	const u = locals.usuario;
	if (!u) return { ok: false as const, resposta: fail(401, { error: 'Não autorizado' }) };
	if (!temCadastro(u))
		return { ok: false as const, resposta: fail(403, { error: 'Não autorizado' }) };

	const formData = await request.formData();
	const giseId = parseInt(formData.get('giseId') as string);
	const latitude = formData.get('latitude')
		? parseFloat(formData.get('latitude') as string)
		: undefined;
	const longitude = formData.get('longitude')
		? parseFloat(formData.get('longitude') as string)
		: undefined;
	const selfieBase64 = formData.get('selfieBase64') as string | null;
	const codigoEmail = formData.get('codigoEmail') as string | null;
	const desafioId = formData.get('desafioId') as string | null;
	const reauthId = formData.get('reauthId') as string | null;
	// Declaração de que a captura não foi possível. Lista FECHADA
	// (`lerMotivoSemEvidencia` devolve `null` para qualquer coisa fora dela), para
	// o campo não virar texto livre entrando na trilha por POST direto.
	const motivoSemGps = lerMotivoSemEvidencia(formData.get('motivoSemGps'));
	const motivoSemFoto = lerMotivoSemEvidencia(formData.get('motivoSemFoto'));

	if (isNaN(giseId)) {
		return { ok: false as const, resposta: fail(400, { error: 'Dados inválidos', giseId }) };
	}

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const db = getDB(platform);

	// Fonte ÚNICA das flags (mesma da UI e do signature-service): o cache
	// força exigirCodigoEmail=true independentemente da linha no banco —
	// requisito mínimo da assinatura avançada (Lei 14.063/2020 art. 4º II).
	// A leitura crua do banco (default '0' num banco recém-instalado)
	// deixava a presença pular o 2FA que a UI já coleta.
	const flagsAssinatura = await lerFlagsAssinatura(platform);

	// Política de dispositivo antes do 2FA: recusar aqui não consome uma
	// tentativa do código de quem vai ser barrado de qualquer forma. Estas
	// actions não passam pelo `validarEvidenciasAvancada` (checam o 2FA à
	// mão), então o gate precisa ser aplicado explicitamente — é o fluxo de
	// maior volume do sistema, e sem ele a recusa por dispositivo cobriria
	// só a minoria dos atos.
	if (recusadaPorPoliticaDispositivo(flagsAssinatura, ua)) {
		return {
			ok: false as const,
			resposta: fail(403, { error: ERRO_POLITICA_DISPOSITIVO, giseId })
		};
	}

	if (flagsAssinatura.exigirPasskeyAssinatura) {
		return { ok: false as const, resposta: fail(403, { error: ERRO_PASSKEY_UM_TIRO, giseId }) };
	}

	const reauth = await exigirJanelaReauth(db, u, reauthId, cookies.get('session_token'));
	if (!reauth.ok) {
		return { ok: false as const, resposta: fail(reauth.status, { error: reauth.error, giseId }) };
	}

	if (flagsAssinatura.exigirCodigoEmailAssinatura) {
		if (!codigoEmail || !desafioId) {
			return {
				ok: false as const,
				resposta: fail(400, { error: 'Código de verificação por e-mail é obrigatório.', giseId })
			};
		}
		const result2FA = await verificarDesafio2FA(db, desafioId, codigoEmail, ['assinatura']);
		if (result2FA === 'expirado')
			return {
				ok: false as const,
				resposta: fail(400, { error: 'O código de verificação expirou.', giseId })
			};
		if (result2FA === 'esgotado')
			return {
				ok: false as const,
				resposta: fail(400, { error: 'Muitas tentativas. Solicite um novo código.', giseId })
			};
		if (!result2FA)
			return {
				ok: false as const,
				resposta: fail(400, { error: 'Código de verificação inválido.', giseId })
			};
		if (result2FA.usuarioId !== u.id)
			return {
				ok: false as const,
				resposta: fail(403, { error: 'Código não pertence ao usuário logado.', giseId })
			};
	}

	const gise = await buscarGiseEscala(db, giseId);
	if (!gise)
		return { ok: false as const, resposta: fail(404, { error: 'Escala não encontrada', giseId }) };

	// Vínculo: só quem participa da GISE (membro de equipe, assessor/SEINT ou
	// supervisor DPC) registra a própria presença. A UI já esconde o botão de
	// quem não participa, mas a action precisa recusar por conta própria —
	// mesma regra que o endpoint do comprovante aplica. Sem isto, qualquer
	// policial autenticado gravava presença em qualquer GISE via POST direto.
	const part = await resolverParticipacaoGisePolicial(db, giseId, u.id);
	if (!part.participa)
		return {
			ok: false as const,
			resposta: fail(403, { error: 'Você não participa desta escala GISE.', giseId })
		};

	const gate = await gateDePresenca(db, { ...part, statusGise: gise.status }, giseId, u.id, tipo);
	if (!gate.ok) {
		const body = (await gate.resposta.clone().json()) as { error?: string };
		return {
			ok: false as const,
			resposta: fail(gate.resposta.status, { error: body.error ?? 'Presença não liberada', giseId })
		};
	}

	let selfieKey: string | undefined = undefined;
	if (selfieBase64) {
		// Sem bucket, a foto que o policial acabou de tirar não tem onde ser
		// gravada. Como `temSelfie` abaixo é `!!selfieKey`, cair no gate com a
		// flag ligada recusaria dizendo "permita o acesso à câmera e tente
		// novamente" — culpando a pessoa por uma falha de infraestrutura e
		// mandando repetir o que ela já fez. A alternativa que sobra para ela é
		// declarar um motivo falso, o que sujaria a trilha.
		//
		// Fail-closed continua certo (gravar presença sem a foto que a flag exige
		// produz termo afirmando evidência que não existe); o que muda é NOMEAR a
		// causa, para o policial saber que não é o aparelho dele.
		if (!hasR2(platform)) {
			return {
				ok: false as const,
				resposta: fail(503, {
					error:
						'O armazenamento de fotos está indisponível no momento. ' +
						'Avise a administração — não é problema do seu aparelho.',
					giseId
				})
			};
		}
		const r2 = getR2(platform);
		const [yyyy, mm, dd] = gise.data_inicio.split('-');
		const folder = `gise/${yyyy}-${mm}/${dd}/${giseId}/selfies`;
		// Helper compartilhado: valida magic bytes, limita 5 MB e usa UUID
		// na chave para esconder o `policial_id` da URL do R2.
		const r = await uploadSelfieDataUri(r2, folder, selfieBase64);
		// Selfie RECUSADA não segue em silêncio. `if (r.ok) selfieKey = r.key` sem
		// `else` gravava a presença sem foto quando o upload era rejeitado — e o
		// policial, que tirou a foto e viu a tela confirmar, ficava com um termo
		// assinado que diz "sem selfie". A UI legítima captura sempre
		// `canvas.toDataURL('image/jpeg')`, então chegar aqui recusado significa
		// conteúdo que aquela tela não produz: recusar é o certo, e nomear o
		// motivo é o que permite ao policial saber o que fazer.
		if (!r.ok) {
			const motivo =
				r.reason === 'too-large'
					? 'A foto excede o tamanho máximo (5 MB). Tente novamente.'
					: 'A foto enviada não é uma imagem válida (JPEG ou PNG). Tente novamente.';
			return { ok: false as const, resposta: fail(400, { error: motivo, giseId }) };
		}
		selfieKey = r.key;
	}

	// As flags de FOTO e GPS passam a recusar AQUI. Estas actions não passam por
	// `validarEvidenciasAvancada` (checam o 2FA à mão), e por isso as duas viviam
	// só no `SignaturePad`: um POST direto registrava presença sem nenhuma das
	// duas enquanto o painel do admin as anunciava obrigatórias.
	//
	// O gate é o de `$lib/assinatura-evidencia`, client-safe, para a tela pedir
	// pela MESMA regra — e ele aceita ausência DECLARADA, porque a presença tem
	// janela de horário e recusa seca deixaria de fora quem tem o GPS negado pelo
	// aparelho. O motivo declarado entra na trilha (ver `metadadosDeEvidenciaPresenca`).
	//
	// `coordenadaGeograficaValida`, e não "veio um número": o cliente manda texto
	// e isto é `parseFloat`, então `latitude=abc` chega como `NaN`.
	const evidencia = {
		gpsValido: coordenadaGeograficaValida(latitude, longitude),
		temSelfie: !!selfieKey,
		motivoSemGps,
		motivoSemFoto
	};
	const recusa = recusaPorEvidenciaDePresenca(flagsAssinatura, evidencia);
	if (recusa) {
		return { ok: false as const, resposta: fail(400, { error: recusa.error, giseId }) };
	}

	return {
		ok: true as const,
		db,
		u,
		giseId,
		ip,
		ua,
		// Coordenada implausível NÃO vira evidência, nem com a flag desligada. Com
		// a flag ligada o gate acima já recusou; sem ela, `latitude=999` seguia
		// para o banco e o termo de presença IMPRIMIA `999.0000` como o lugar onde
		// a pessoa estava. Ausência é registrada como ausência — "Não capturado" é
		// honesto, coordenada inventada apresentada como capturada não é.
		//
		// Mesma decisão que `validarEvidenciasAvancada` toma no caminho de
		// assinatura; era o caminho de presença que ficara de fora dela.
		latitude: evidencia.gpsValido ? latitude : undefined,
		longitude: evidencia.gpsValido ? longitude : undefined,
		selfieKey,
		evidencia
	};
}

export const actions: Actions = {
	/**
	 * Confirma a ENTRADA em serviço (assinatura avançada).
	 */
	salvarEntrada: async (event) => {
		const prep = await prepararConfirmacaoPresenca(event, 'entrada');
		if (!prep.ok) return prep.resposta;
		const { db, u, giseId, ip, ua, latitude, longitude, selfieKey, evidencia } = prep;

		const entrada = await salvarEntradaGise(
			db,
			giseId,
			u.id,
			ip,
			ua,
			latitude,
			longitude,
			selfieKey
		);
		if (!entrada.registrada) {
			return fail(409, { error: 'A saída já foi confirmada — a entrada não pode ser refeita.' });
		}
		await sincronizarStatusGiseAposPresencaRelatorios(db, giseId);
		await invalidarPapelGise(u.id);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'presenca_gise_entrada',
				usuario: u,
				entidade: 'gise',
				entidade_id: giseId,
				alvo_tipo: 'policial',
				alvo_id: u.id,
				alvo_nome: u.nome,
				detalhes: `Registro de entrada na GISE ${giseId}`,
				metadados: metadadosDeEvidenciaPresenca(evidencia),
				...contexto
			},
			{ env }
		);
		return { success: true, giseId };
	},

	/**
	 * Confirma a SAÍDA de serviço. Mesmas verificações da entrada — e é este
	 * carimbo que tira a escala da aba "Ativas" do policial e libera o relatório
	 * de extra da seccional.
	 */
	salvarSaida: async (event) => {
		const prep = await prepararConfirmacaoPresenca(event, 'saida');
		if (!prep.ok) return prep.resposta;
		const { db, u, giseId, ip, ua, latitude, longitude, selfieKey, evidencia } = prep;

		// A gravação exige a entrada no próprio `WHERE`: sem ela o UPDATE não
		// achava linha, o resultado era ignorado e a auditoria registrava uma
		// saída que nunca existiu (FLW-GISE-008).
		const saida = await salvarSaidaGise(db, giseId, u.id, ip, ua, latitude, longitude, selfieKey);
		if (!saida.registrada) {
			return fail(409, {
				error: 'A saída já foi confirmada, ou não há entrada registrada.',
				giseId
			});
		}

		await sincronizarStatusGiseAposPresencaRelatorios(db, giseId);
		await invalidarPapelGise(u.id);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'presenca_gise_saida',
				usuario: u,
				entidade: 'gise',
				entidade_id: giseId,
				alvo_tipo: 'policial',
				alvo_id: u.id,
				alvo_nome: u.nome,
				detalhes: `Registro de saída na GISE ${giseId}`,
				metadados: metadadosDeEvidenciaPresenca(evidencia),
				...contexto
			},
			{ env }
		);

		return { success: true, giseId };
	},

	/**
	 * Salva o MODELO do formulário de produtividade (perguntas), não as respostas.
	 * Restrito ao Admin Geral: vale para todas as escalas seguintes DAQUELA
	 * operação.
	 *
	 * O `operacaoId` vem do corpo do formulário, então é conferido aqui: precisa
	 * existir e precisa habilitar o tipo de equipe que está sendo salvo. Sem a
	 * segunda checagem, um POST direto gravaria o formulário operacional de uma
	 * operação que só tem equipe de inteligência — um modelo que nenhuma tela
	 * mostraria e que ninguém iria preencher.
	 */
	salvarModelo: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u || u.tipo !== 'admin') return fail(403, { error: 'Somente administradores gerais' });

		const formData = await request.formData();
		// A string CRUA é o que vai para a coluna (`salvarGiseModeloFormulario`
		// grava `configStr`, não o objeto parseado), então o teto tem de valer
		// sobre ela. Um formulário real fica na casa dos KB; 256 KB é folga larga
		// e ainda impede JSON de megabytes numa coluna de texto.
		const configStr = textoLimitado(formData, 'config', MAX_CONFIG_FORMULARIO);
		const tipo = formData.get('tipo') as 'operacional' | 'seint';
		const operacaoId = Number(formData.get('operacaoId'));

		if (!configStr || !tipo || !['operacional', 'seint'].includes(tipo)) {
			return fail(400, { error: 'Dados inválidos' });
		}
		if (!Number.isInteger(operacaoId) || operacaoId <= 0) {
			return fail(400, { error: 'Operação inválida' });
		}

		let perguntas: unknown;
		try {
			perguntas = JSON.parse(configStr);
		} catch (err) {
			logger.warn('[res-gise] salvarModelo: JSON inválido', { err: String(err) });
			return fail(400, { error: 'Configuração JSON inválida' });
		}
		if (!Array.isArray(perguntas)) {
			return fail(400, { error: 'Configuração deve ser uma lista de perguntas' });
		}
		// Cada item tem de ser OBJETO — é o que todo o resto assume ao ler `p.tipo`
		// e `p.chave`. Uma lista de strings passava pelo `Array.isArray` e ia
		// inteira para a coluna, quebrando a tela de quem fosse preencher depois.
		if (!perguntas.every((p) => !!p && typeof p === 'object' && !Array.isArray(p))) {
			return fail(400, { error: 'Configuração deve ser uma lista de perguntas' });
		}

		const db = getDB(platform);

		const operacao = await buscarOperacao(db, operacaoId);
		if (!operacao) return fail(404, { error: 'Operação não encontrada' });
		if (!operacaoAceitaTipoEquipe(operacao, tipo)) {
			return fail(400, {
				error: `A operação ${operacao.nome} não usa equipe do tipo ${tipo === 'seint' ? 'inteligência (SEINT)' : 'operacional'}.`
			});
		}

		await salvarGiseModeloFormulario(db, operacaoId, tipo, configStr);
		return { success: true };
	}
};
