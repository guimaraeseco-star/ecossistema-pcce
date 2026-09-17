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
	responsavelVigente,
	historicoDaDirecao,
	registrarResponsavel,
	encerrarResponsavel,
	type RecusaDaDirecao
} from '$lib/db/unidades-responsaveis';
import { modoDaDirecao, RECUSA_DIRECAO } from '$lib/server/unidades/direcao-permissao';
import { pendenciasDeFeriasPorLotacao } from '$lib/db';
import { MAX_JUSTIFICATIVA } from '$lib/cadastro-campos';
import { dataIso, textoLimitado, inteiroNaFaixa } from '$lib/server/form-data';
import { unidades } from '$lib/server/schema';
import { efetivoPorLotacao, efetivoVazio, somarEfetivos } from '$lib/db/efetivo';
import { municipiosDaUnidade } from '$lib/db/cobertura';
import { escopoDeUnidades, unidadeNoEscopo } from '$lib/server/unidades/escopo';
import { nivelTipoUnidade, rotuloTipoUnidade } from '$lib/unidades/tipos';
import { hojeBrasilISO } from '$lib/utils/datas';

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

	const [efetivos, municipiosAtendidos, direcao, sucessao, pendenciasPorLotacao] =
		await Promise.all([
			efetivoPorLotacao(db, hojeBrasilISO()),
			municipiosDaUnidade(db, id),
			responsavelVigente(db, id),
			historicoDaDirecao(db, id),
			pendenciasDeFeriasPorLotacao(db)
		]);
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
		modoDirecao: modoDaDirecao(u),
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
		return { success: true };
	},

	/** Admin de seccional: propõe, e o Admin Geral decide em `/solicitacoes`. */
	proporDirecao: async (event) => {
		const auth = await portaoDaDirecao(event);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, unidade, modo } = auth;
		if (modo !== 'proposta') return fail(403, { error: RECUSA_DIRECAO });

		const fd = await event.request.formData();
		const { policialId, papel, dataInicio, nup, observacao } = lerDadosDaDirecao(fd);
		if (!policialId) return fail(400, { error: 'Escolha o delegado.' });
		if (!dataInicio) return fail(400, { error: 'Informe a data de início (AAAA-MM-DD).' });
		if (!observacao.trim()) return fail(400, { error: 'A justificativa é obrigatória.' });

		// A unidade vai pelo NOME porque é assim que `policial_acao_solicitacoes`
		// guarda destino hoje — a dívida que a decisão E51 vai pagar.
		await criarSolicitacaoAcao(db, {
			policial_id: policialId,
			tipo: 'direcao',
			subtipo: papel,
			unidade_destino: unidade.nome,
			data_inicio: dataInicio,
			nup,
			justificativa: observacao,
			solicitante_id: u.id,
			solicitante_nome: u.nome
		});

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'propor_direcao_unidade',
				usuario: u,
				entidade: 'unidade',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: policialId,
				alvo_nome: unidade.nome,
				detalhes: `Proposta de ${papel} para ${unidade.nome} a partir de ${dataInicio}`,
				metadados: { papel, nup },
				...contexto
			},
			{ env }
		);
		return { success: true, proposta: true };
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
	}
};
