/**
 * `/unidade/[id]` — a FICHA da unidade (decisão E39, item 3.1): o que a
 * delegacia vê de si mesma, e o que seccional e departamento veem ao clicar
 * numa unidade da lista.
 *
 * O id vem da URL, e por isso a pergunta do guard: a unidade está no escopo
 * de quem chamou? Fora dele é 403 — a hierarquia decide o que se abre, e um id
 * chutado não abre a ficha de outra seccional.
 *
 * A ficha tem: identificação e contato (endereço, telefone, e-mail, foto —
 * migração 0085), posição na árvore, AIS, tira-gravame, xadrezes, regimes de
 * escala, efetivo por cargo e situação (com link para a lista de servidores),
 * os municípios atendidos com o plantão de cada um (0086) e as unidades
 * vinculadas. Veículos e armas (fase 4) seguem como campos previstos.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	ancestraisDe,
	auditar,
	contextoDeEvento,
	criarSolicitacaoAcao,
	type NoUnidade
} from '$lib/db';
import {
	registrarRespondenciaTemporaria,
	responsavelVigente,
	titularAberto,
	titularesAusentesSemRespondencia,
	historicoDaDirecao,
	registrarResponsavel,
	encerrarResponsavel,
	type RecusaDaDirecao
} from '$lib/db/unidades-responsaveis';
import {
	modoDaDirecao,
	modoDaRespondencia,
	RECUSA_DIRECAO,
	RECUSA_RESPONDENCIA
} from '$lib/server/unidades/direcao-permissao';
import { sugestaoDeRespondencia } from '$lib/db/policiais/designacoes';
import { pendenciasDeFeriasPorLotacao } from '$lib/db';
import { MAX_JUSTIFICATIVA } from '$lib/cadastro-campos';
import { dataIso, textoLimitado, inteiroNaFaixa } from '$lib/server/form-data';
import { unidades } from '$lib/server/schema';
import {
	efetivoPorLotacao,
	efetivoVazio,
	servidoresPorSituacao,
	somarEfetivos
} from '$lib/db/efetivo';
import { municipiosDaUnidade } from '$lib/db/cobertura';
import { escopoDeUnidades, unidadeNoEscopo } from '$lib/server/unidades/escopo';
import { nivelTipoUnidade, rotuloTipoUnidade } from '$lib/unidades/tipos';
import { hojeBrasilISO } from '$lib/utils/datas';
import { avisarOutroLado } from '$lib/server/avisos/emitir';
import { criarAvisos } from '$lib/db/avisos';
import {
	colaboradoresDaUnidade,
	definirAcessosDoColaborador,
	buscarColaborador
} from '$lib/db/colaboradores';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { diferencaDeAcessos, rotuloDoAcesso } from '$lib/colaboradores/acessos';

export const load: PageServerLoad = async ({ locals, platform, params }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'ID inválido');

	const db = getDB(platform);
	const escopo = await escopoDeUnidades(db, u);
	if (!escopo) error(403, 'Você não administra nenhuma unidade.');
	if (!unidadeNoEscopo(escopo, id)) error(403, 'Esta unidade está fora do seu escopo.');

	const unidade = await db.select().from(unidades).where(eq(unidades.id, id)).get();
	if (!unidade) error(404, 'Unidade não encontrada');

	const [
		efetivos,
		municipiosAtendidos,
		direcao,
		sucessao,
		pendenciasPorLotacao,
		ausencias,
		servidores,
		colaboradores
	] = await Promise.all([
		efetivoPorLotacao(db, hojeBrasilISO()),
		municipiosDaUnidade(db, id),
		responsavelVigente(db, id),
		historicoDaDirecao(db, id),
		pendenciasDeFeriasPorLotacao(db),
		// E68: o titular está fora, ou sai em até cinco dias, sem ninguém
		// respondendo? É a mesma consulta da pendência ao vivo (E59) — a ficha
		// mostra o que a caixa de avisos cobra.
		titularesAusentesSemRespondencia(db, hojeBrasilISO()),
		// A lista de quem trabalha AQUI (E66): inclui quem é lotado noutra
		// unidade e fica num posto desta, e exclui quem é lotado aqui mas
		// trabalha num posto — a ficha responde "quem está nesta unidade".
		servidoresPorSituacao(db, [unidade.nome], hojeBrasilISO()),
		// O bloco "Colaboradores" (E61): só para quem administra a unidade —
		// o colaborador não vê os colegas nem o que cada um pode.
		podeGerirColaboradores(u) ? colaboradoresDaUnidade(db, id) : Promise.resolve(null)
	]);
	// A ausência DESTA unidade, e quem a casa indicaria para cobrir: o Delegado
	// Adjunto e, na falta dele, o Auxiliar. Sem nenhum dos dois a indicação é da
	// seccional (E68) — e é o `null` que a tela usa para dizer isso.
	const ausencia = ausencias.find((a) => a.unidade_id === id) ?? null;
	const sugestao = ausencia
		? await sugestaoDeRespondencia(db, unidade.nome, ausencia.titular_id)
		: null;

	const porNome = (n: NoUnidade) => efetivos.get(n.nome) ?? efetivoVazio();
	const efetivo = porNome({ ...unidade });
	const populacaoAtendida = municipiosAtendidos.reduce((n, m) => n + (m.populacao ?? 0), 0);

	const filhas = escopo.nos
		.filter((n) => n.seccional_id === id)
		.sort(
			(a, b) =>
				nivelTipoUnidade(a.tipo) - nivelTipoUnidade(b.tipo) || a.nome.localeCompare(b.nome, 'pt-BR')
		);
	// Tudo abaixo desta unidade, dentro do escopo (a subárvore dela é subconjunto).
	const descendentes: NoUnidade[] = [];
	const fila = [...filhas];
	while (fila.length) {
		const n = fila.shift() as NoUnidade;
		descendentes.push(n);
		fila.push(...escopo.nos.filter((f) => f.seccional_id === n.id));
	}

	// O pai pode estar FORA do escopo (a seccional vê o departamento acima
	// dela): vai como texto, e só vira link quando está dentro.
	const pai = ancestraisDe(escopo.arvore, id)[0] ?? null;

	return {
		usuario: u,
		unidade: {
			id: unidade.id,
			nome: unidade.nome,
			sigla: unidade.sigla,
			tipo: unidade.tipo,
			tipoRotulo: rotuloTipoUnidade(unidade.tipo),
			cidade: unidade.cidade,
			abrangencia: unidade.abrangencia,
			tem_plantao: unidade.tem_plantao,
			tem_expediente: unidade.tem_expediente,
			tem_fds: unidade.tem_fds,
			endereco: unidade.endereco,
			telefone: unidade.telefone,
			email: unidade.email,
			/** A foto sai por `/api/unidades/[id]/foto` (R2, ou o link de origem). */
			temFoto: !!(unidade.foto_key || unidade.foto_url),
			ais: unidade.ais,
			tira_gravame: unidade.tira_gravame,
			xadrezes: unidade.xadrezes
		},
		municipios: municipiosAtendidos,
		populacaoAtendida,
		habPorPolicial:
			populacaoAtendida > 0 && efetivo.total > 0
				? Math.round(populacaoAtendida / efetivo.total)
				: null,
		pai: pai
			? {
					id: pai.id,
					nome: pai.nome,
					tipoRotulo: rotuloTipoUnidade(pai.tipo),
					noEscopo: unidadeNoEscopo(escopo, pai.id)
				}
			: null,
		ehRaizDoEscopo: escopo.raiz.id === id,
		/**
		 * A direção da unidade (fase 2-C): quem dirige hoje e a sucessão.
		 *
		 * `modo` é a MESMA distinção da ficha do servidor: o Admin Geral registra
		 * direto, o admin de seccional propõe e ele homologa; quem não é nenhum dos
		 * dois apenas consulta. Quem recusa o POST é a action, não esta flag.
		 */
		direcao,
		sucessao,
		/** Quem trabalha nesta unidade, com a situação de hoje (E66). */
		servidores: servidores.map((s) => ({
			id: s.id,
			nome: s.nome,
			matricula: s.matricula,
			cargo: s.cargo,
			designacao: s.designacao,
			situacao: s.situacao,
			/** Preenchido só quando ele é lotado em OUTRA unidade e trabalha aqui. */
			lotacaoDeOrigem: s.lotacao === unidade.nome ? null : s.lotacao
		})),
		modoDirecao: modoDaDirecao(u),
		/**
		 * A respondência temporária (E68): a ausência do titular que ninguém
		 * cobriu ainda, a indicação sugerida e o que esta sessão pode fazer —
		 * o DPI SUL registra direto; a unidade e a seccional indicam.
		 */
		respondencia: {
			modo: modoDaRespondencia(u),
			ausencia,
			sugestao
		},
		/**
		 * Os colaboradores lotados aqui e o que a unidade liberou a cada um (E61).
		 * `null` = esta sessão não gere colaboradores (o bloco não aparece).
		 */
		colaboradores:
			colaboradores?.map((c) => ({
				id: c.id,
				nome: c.nome,
				vinculo: c.vinculo,
				ativo: c.ativo === 1,
				acessos: c.acessos
			})) ?? null,
		/**
		 * Pendências de férias desta unidade e das vinculadas — alerta no topo
		 * da ficha até a unidade resolver (pedido homologado, abono com ciência).
		 */
		pendenciasFerias: [unidade, ...descendentes].reduce(
			(acc, d) => {
				const p = pendenciasPorLotacao.get(d.nome);
				if (p) {
					acc.reprogramacoesPendentes += p.reprogramacoesPendentes;
					acc.abonosSemCiencia += p.abonosSemCiencia;
				}
				return acc;
			},
			{ reprogramacoesPendentes: 0, abonosSemCiencia: 0 }
		),
		efetivo,
		subtotal: somarEfetivos([porNome({ ...unidade }), ...descendentes.map(porNome)]),
		filhas: filhas.map((f) => ({
			id: f.id,
			nome: f.nome,
			sigla: f.sigla,
			tipoRotulo: rotuloTipoUnidade(f.tipo),
			efetivo: porNome(f)
		})),
		totalVinculadas: descendentes.length
	};
};

/** Mensagem legível para cada recusa da camada de dados. */
const MOTIVO: Record<RecusaDaDirecao, string> = {
	unidade_inexistente: 'Unidade não encontrada.',
	policial_inexistente: 'Servidor não encontrado.',
	policial_inativo: 'Este servidor está inativo.',
	nao_e_delegado: 'Só delegado (DPC) dirige unidade.',
	ja_e_o_vigente: 'Este servidor já é quem dirige a unidade, no mesmo papel.',
	inicio_antes_do_vigente: 'O início não pode ser anterior ao da direção vigente.'
};

/**
 * O portão das três actions, numa função só: sessão, escopo e MODO.
 *
 * As três perguntam o mesmo, e escrever isso três vezes é como um dos três
 * acabaria com a régua errada — a forma exata dos bugs de cópia divergente
 * catalogados no `CLAUDE.md`. O escopo é reconferido contra o id da URL: a
 * lista só mostra o que a pessoa alcança, mas o id chega de fora.
 */
async function portaoDaDirecao(event: Parameters<Actions[string]>[0]) {
	const u = event.locals.usuario;
	if (!u) return { erro: fail(401, { error: 'Não autorizado' }) };

	const id = Number(event.params.id);
	if (!Number.isInteger(id) || id <= 0) return { erro: fail(400, { error: 'ID inválido' }) };

	const db = getDB(event.platform);
	const escopo = await escopoDeUnidades(db, u);
	if (!escopo || !unidadeNoEscopo(escopo, id)) {
		return { erro: fail(403, { error: 'Esta unidade está fora do seu escopo.' }) };
	}

	const unidade = await db.select().from(unidades).where(eq(unidades.id, id)).get();
	if (!unidade) return { erro: fail(404, { error: 'Unidade não encontrada' }) };

	return { u, db, id, unidade, modo: modoDaDirecao(u) };
}

/**
 * Quem define o que o colaborador da unidade pode (E61): o admin da unidade,
 * o da seccional acima (com aviso à unidade) e o Admin Geral. O escopo é
 * conferido pelo portão da unidade, como nas demais actions desta rota.
 */
function podeGerirColaboradores(u: { tipo: string; papel?: string | null }) {
	return (
		isAdminGeral(u as Parameters<typeof isAdminGeral>[0]) ||
		isAdminSeccional(u as Parameters<typeof isAdminSeccional>[0]) ||
		isAdminUnidade(u as Parameters<typeof isAdminUnidade>[0])
	);
}

/** Os campos que os dois caminhos (registrar e propor) leem igual. */
function lerDadosDaDirecao(fd: FormData) {
	const policialId = inteiroNaFaixa(fd, 'policial_id', 1, 99_999_999);
	const papelBruto = String(fd.get('papel') ?? '');
	// Domínio fechado de duas opções: o que não for `respondente` é titular, e
	// não há terceira grafia possível vinda do POST.
	const papel: 'titular' | 'respondente' = papelBruto === 'respondente' ? 'respondente' : 'titular';
	const dataInicio = dataIso(fd, 'data_inicio');
	// NUP do processo que PEDE a designação (decisão de 16/09/2026): é texto
	// livre limitado, não o PDF que movimentação e afastamento exigem.
	const nup = textoLimitado(fd, 'nup', 40);
	const observacao = textoLimitado(fd, 'observacao', MAX_JUSTIFICATIVA);
	return { policialId, papel, dataInicio, nup, observacao };
}

/** Os campos da respondência temporária, lidos igual nos dois caminhos. */
function lerDadosDaRespondencia(fd: FormData) {
	const policialId = inteiroNaFaixa(fd, 'policial_id', 1, 99_999_999);
	const eventoId = inteiroNaFaixa(fd, 'evento_id', 1, 99_999_999);
	return {
		policialId,
		eventoId: eventoId || null,
		dataInicio: dataIso(fd, 'data_inicio'),
		dataFim: dataIso(fd, 'data_fim') || null,
		/** O 1º dia do afastamento, para a fila reencontrar o evento. */
		inicioDoAfastamento: dataIso(fd, 'inicio_afastamento') || null,
		nup: textoLimitado(fd, 'nup', 40),
		observacao: textoLimitado(fd, 'observacao', MAX_JUSTIFICATIVA)
	};
}

/** O que a camada de dados recusou, em português de tela. */
const MOTIVO_RESPONDENCIA: Record<string, string> = {
	unidade_inexistente: 'Unidade não encontrada.',
	policial_inexistente: 'Servidor não encontrado.',
	policial_inativo: 'Servidor inativo não responde por unidade.',
	nao_e_delegado: 'Só delegado (DPC) responde por unidade.',
	sem_nup: 'Informe o NUP do processo.',
	periodo_invertido: 'O último dia é anterior ao primeiro.',
	responde_a_si_mesmo: 'O titular não responde por si mesmo.',
	nao_substitui_o_titular: 'A cobertura não corresponde ao titular atual da unidade.',
	ja_ha_temporaria: 'Já há respondência registrada nesse período.'
};

export const actions: Actions = {
	/** Admin Geral: registra e vale na hora. */
	registrarDirecao: async (event) => {
		const auth = await portaoDaDirecao(event);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, unidade, modo } = auth;
		if (modo !== 'direto') return fail(403, { error: RECUSA_DIRECAO });

		const fd = await event.request.formData();
		const { policialId, papel, dataInicio, nup, observacao } = lerDadosDaDirecao(fd);
		if (!policialId) return fail(400, { error: 'Escolha o delegado.' });
		if (!dataInicio) return fail(400, { error: 'Informe a data de início (AAAA-MM-DD).' });
		// NUP obrigatório desde a E68: a portaria saiu do formulário (é o ato, vem
		// depois), então o processo que PEDE a designação é o único documento que
		// amarra o registro. Os 51 registros antigos, vindos da planilha, ficam
		// como estão — a exigência vale para quem registra pela tela daqui em diante.
		if (!nup.trim())
			return fail(400, { error: 'Informe o NUP do processo que pede a designação.' });

		const r = await registrarResponsavel(db, {
			unidade_id: id,
			policial_id: policialId,
			papel,
			data_inicio: dataInicio,
			nup,
			observacao,
			registrado_por_id: u.id,
			registrado_por_nome: u.nome
		});
		if (!r.ok) return fail(400, { error: MOTIVO[r.motivo] });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'registrar_direcao_unidade',
				usuario: u,
				entidade: 'unidade',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: policialId,
				alvo_nome: unidade.nome,
				detalhes: `${papel === 'titular' ? 'Titular' : 'Respondente'} de ${unidade.nome} desde ${dataInicio}${nup ? ` (NUP ${nup})` : ''}`,
				metadados: { papel, substituiu: r.substituiu, nup },
				...contexto
			},
			{ env }
		);
		// A unidade fica sabendo de quem passou a dirigi-la (E59).
		await avisarOutroLado(db, u, {
			cartao: 'unidade',
			tipo: 'direcao_registrada',
			titulo: `${papel === 'titular' ? 'Titular' : 'Respondente'} de ${unidade.nome} registrado pelo DPI SUL`,
			texto: `Desde ${dataInicio}${nup ? ` · NUP ${nup}` : ''}`,
			link: `/unidade/${id}`,
			lotacoes: [unidade.nome]
		});
		return { success: true };
	},

	/**
	 * Admin Geral: registra a respondência temporária e vale na hora (E68).
	 *
	 * O titular NÃO é encerrado — ele continua titular e volta sozinho no fim
	 * do período. Quem ela cobre não vem do formulário: é o titular aberto da
	 * unidade, lido aqui, para que a tela não possa indicar a cobertura de um
	 * titular que já saiu.
	 */
	registrarRespondencia: async (event) => {
		const auth = await portaoDaDirecao(event);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, unidade } = auth;
		if (modoDaRespondencia(u) !== 'direto') return fail(403, { error: RECUSA_RESPONDENCIA });

		const fd = await event.request.formData();
		const dados = lerDadosDaRespondencia(fd);
		if (!dados.policialId) return fail(400, { error: 'Escolha quem responde.' });
		if (!dados.dataInicio) return fail(400, { error: 'Informe o primeiro dia (AAAA-MM-DD).' });

		const titular = await titularAberto(db, id);
		if (!titular) {
			return fail(400, {
				error: 'Esta unidade não tem titular. Sem titular, a respondência é permanente.'
			});
		}

		const r = await registrarRespondenciaTemporaria(db, {
			unidade_id: id,
			policial_id: dados.policialId,
			substitui_policial_id: titular.policial_id,
			evento_id: dados.eventoId,
			data_inicio: dados.dataInicio,
			data_fim: dados.dataFim,
			nup: dados.nup,
			observacao: dados.observacao,
			registrado_por_id: u.id,
			registrado_por_nome: u.nome
		});
		if (!r.ok) return fail(400, { error: MOTIVO_RESPONDENCIA[r.motivo] });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'registrar_respondencia_temporaria',
				usuario: u,
				entidade: 'unidade',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: dados.policialId,
				alvo_nome: unidade.nome,
				detalhes: `Respondência temporária em ${unidade.nome} de ${dados.dataInicio}${dados.dataFim ? ` a ${dados.dataFim}` : ''} (NUP ${dados.nup})`,
				metadados: { substitui: titular.policial_id, evento_id: dados.eventoId },
				...contexto
			},
			{ env }
		);
		await avisarOutroLado(db, u, {
			cartao: 'unidade',
			tipo: 'respondencia_registrada',
			titulo: `Respondência temporária em ${unidade.nome} registrada pelo DPI SUL`,
			texto: `De ${dados.dataInicio}${dados.dataFim ? ` a ${dados.dataFim}` : ''} · NUP ${dados.nup}`,
			link: `/unidade/${id}`,
			lotacoes: [unidade.nome]
		});
		return { success: true };
	},

	/**
	 * A unidade (quando tem adjunto ou auxiliar) ou a seccional INDICA quem
	 * responde; o DPI SUL homologa em `/solicitacoes` (E68).
	 *
	 * `data_evento` leva o primeiro dia do AFASTAMENTO — é por ele que a
	 * homologação reencontra o evento, a mesma convenção do retorno antecipado.
	 */
	indicarRespondencia: async (event) => {
		const auth = await portaoDaDirecao(event);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, unidade } = auth;
		if (modoDaRespondencia(u) !== 'indicacao') return fail(403, { error: RECUSA_RESPONDENCIA });

		const fd = await event.request.formData();
		const dados = lerDadosDaRespondencia(fd);
		if (!dados.policialId) return fail(400, { error: 'Escolha quem responde.' });
		if (!dados.dataInicio) return fail(400, { error: 'Informe o primeiro dia (AAAA-MM-DD).' });
		if (!dados.nup.trim()) return fail(400, { error: 'Informe o NUP do processo.' });
		if (!dados.observacao.trim()) return fail(400, { error: 'A justificativa é obrigatória.' });

		await criarSolicitacaoAcao(db, {
			policial_id: dados.policialId,
			tipo: 'direcao',
			subtipo: 'respondencia_temporaria',
			unidade_destino: unidade.nome,
			data_inicio: dados.dataInicio,
			data_fim: dados.dataFim ?? undefined,
			data_evento: dados.inicioDoAfastamento ?? undefined,
			nup: dados.nup,
			justificativa: dados.observacao,
			solicitante_id: u.id,
			solicitante_nome: u.nome
		});

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'indicar_respondencia_temporaria',
				usuario: u,
				entidade: 'unidade',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: dados.policialId,
				alvo_nome: unidade.nome,
				detalhes: `Indicação de respondência em ${unidade.nome} a partir de ${dados.dataInicio}`,
				metadados: { nup: dados.nup },
				...contexto
			},
			{ env }
		);
		return { success: true, indicacao: true };
	},

	/**
	 * A proposta de direção pela seccional ACABOU (E67): a indicação é do DPI
	 * SUL. A action fica, e só recusa, porque aba aberta antes do deploy ainda
	 * posta aqui — melhor a recusa explicando do que o 404 de action inexistente.
	 */
	proporDirecao: async (event) => {
		const auth = await portaoDaDirecao(event);
		if ('erro' in auth) return auth.erro;
		return fail(403, { error: RECUSA_DIRECAO });
	},

	/**
	 * Admin Geral: encerra a direção sem pôr ninguém no lugar.
	 *
	 * A unidade passa a constar SEM titular, que é o estado que a consulta de
	 * respondência procura — não é apagar o registro, é fechar a vigência.
	 */
	encerrarDirecao: async (event) => {
		const auth = await portaoDaDirecao(event);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, unidade, modo } = auth;
		if (modo !== 'direto') return fail(403, { error: RECUSA_DIRECAO });

		const fd = await event.request.formData();
		const dataFim = dataIso(fd, 'data_fim');
		if (!dataFim) return fail(400, { error: 'Informe a data de término (AAAA-MM-DD).' });

		const ok = await encerrarResponsavel(db, id, dataFim);
		if (!ok) {
			return fail(400, {
				error: 'Não há direção vigente, ou o término é anterior ao início dela.'
			});
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'encerrar_direcao_unidade',
				usuario: u,
				entidade: 'unidade',
				entidade_id: id,
				alvo_tipo: 'unidade',
				alvo_id: id,
				alvo_nome: unidade.nome,
				detalhes: `Direção de ${unidade.nome} encerrada em ${dataFim}`,
				...contexto
			},
			{ env }
		);
		return { success: true };
	},

	/**
	 * A unidade marca o que o colaborador pode (E61). Substitui o conjunto
	 * inteiro pelo que veio marcado; o que mudou vai para a auditoria e, quando
	 * quem mudou foi a seccional, vira notícia à unidade (decisão dele:
	 * "o seccional pode liberar/retirar com aviso à unidade").
	 */
	definirAcessosColaborador: async (event) => {
		const auth = await portaoDaDirecao(event);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, unidade } = auth;
		if (!podeGerirColaboradores(u)) {
			return fail(403, { error: 'Só quem administra a unidade define os acessos do colaborador.' });
		}

		const fd = await event.request.formData();
		const colaboradorId = inteiroNaFaixa(fd, 'colaborador_id', 1, 99_999_999);
		if (!colaboradorId) return fail(400, { error: 'Colaborador inválido.' });
		const alvo = await buscarColaborador(db, colaboradorId);
		if (!alvo || alvo.unidade_id !== id) {
			return fail(404, { error: 'Este colaborador não está lotado nesta unidade.' });
		}
		// As chaves marcadas: só texto curto, e só o que o catálogo conhece.
		const marcadas = fd
			.getAll('acesso')
			.map((v) => (typeof v === 'string' ? v.slice(0, 40) : ''))
			.filter(Boolean);

		const { antes, depois } = await definirAcessosDoColaborador(db, colaboradorId, marcadas, {
			id: u.id,
			nome: u.nome
		});
		const { concedidas, retiradas } = diferencaDeAcessos(antes, depois);
		const mudou = concedidas.length + retiradas.length > 0;
		const resumo = [
			...concedidas.map((c) => `+ ${rotuloDoAcesso(c)}`),
			...retiradas.map((c) => `− ${rotuloDoAcesso(c)}`)
		].join('; ');

		const { contexto, env } = contextoDeEvento(event);
		if (mudou) {
			await auditar(
				db,
				{
					acao: 'definir_acessos_colaborador',
					usuario: u,
					entidade: 'colaborador',
					entidade_id: colaboradorId,
					alvo_tipo: 'colaborador',
					alvo_id: colaboradorId,
					alvo_nome: alvo.nome,
					detalhes: `Acessos de ${alvo.nome} na ${unidade.nome}: ${resumo}`,
					dados_antes: { acessos: antes },
					dados_depois: { acessos: depois },
					...contexto
				},
				{ env }
			);
			// A seccional mexeu no que é da unidade: a unidade fica sabendo.
			if (!isAdminUnidade(u)) {
				await criarAvisos(db, [
					{
						destinatario: { tipo: 'lotacao', lotacao: unidade.nome },
						cartao: 'unidade',
						tipo: 'acessos_colaborador',
						titulo: `Acessos do colaborador ${alvo.nome} alterados`,
						texto: `${u.nome} (${isAdminGeral(u) ? 'Admin Geral' : 'seccional'}) alterou: ${resumo}.`,
						link: `/unidade/${id}`,
						autor: { id: u.id, nome: u.nome }
					}
				]);
			}
		}
		return { success: true, acessos: depois };
	}
};
