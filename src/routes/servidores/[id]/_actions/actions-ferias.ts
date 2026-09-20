/**
 * As actions de FÉRIAS da ficha do servidor (`/servidores/[id]`) — o que a
 * unidade faz com a programação que veio do Guardião e com os pedidos à
 * COGEP, e o que só o DPI SUL faz com o abono.
 *
 * Quem pode (decisões do responsável, 17/09/2026):
 *
 *   - **lançar, excluir, sustar, suspender, anotar o NUP e homologar a
 *     resposta da COGEP**: qualquer perfil que abre a ficha dentro do escopo —
 *     a unidade em primeiro lugar, porque é ela quem monta o pedido; a
 *     seccional e o Admin Geral também. O portão é `carregarFichaDoPolicial`,
 *     o mesmo das ações de RH, e é ele que recusa o id de outra seccional;
 *   - **registrar o abono**: só o Admin Geral, porque o servidor pede direto à
 *     COGEP e é o DPI SUL que recebe a decisão;
 *   - **dar ciência do abono**: a unidade (o Admin Geral também).
 *
 * As férias são UM período, ainda que fracionado: a programação entra
 * inteira (a divisão escolhida + o 1º dia de cada fração; o último dia sai da
 * regra), a sustação alcança todas as frações não iniciadas de uma vez e pode
 * redividi-las, e a suspensão é a exceção — mira a fração em gozo. As REGRAS
 * (`$lib/servidores/ferias`) rodam AQUI de novo, ainda que a tela já as tenha
 * mostrado: o POST direto não passa pela tela. O tipo do pedido nunca vem do
 * formulário — vem dos fatos, e é isso que impede o pedido errado.
 */
import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	auditar,
	contextoDeEvento,
	abrirReprogramacao,
	anotarNupDaReprogramacao,
	buscarFracao,
	contagemParaTeto,
	darCienciaDoAbono,
	decidirReprogramacao,
	excluirProgramacao,
	listarFeriasDoPolicial,
	listarHistoricoPolicial,
	registrarAbono,
	registrarProgramacao
} from '$lib/db';
import { feriadosNoIntervalo } from '$lib/db/diarias/feriados';
import { isAdminGeral } from '$lib/auth';
import { carregarFichaDoPolicial } from '$lib/server/policiais/ficha-permissao';
import { dataIso, inteiroNaFaixa, textoLimitado } from '$lib/server/form-data';
import { MAX_JUSTIFICATIVA } from '$lib/cadastro-campos';
import {
	avisoDoTeto,
	conferirAbono,
	criteriosDaSuspensao,
	diasRestantesNaSuspensao,
	divisoesPossiveis,
	montarPeriodos,
	periodosDoPedido,
	ROTULO_TIPO_REPROGRAMACAO,
	situacaoDaReprogramacao,
	statusPelaData,
	temErro,
	textoDoOficio,
	type Checagem,
	type Fracao,
	type PeriodoMontado,
	type PosicaoDoAbono
} from '$lib/servidores/ferias';
import { adicionarDias, hojeBrasilISO } from '$lib/utils/datas';
import { avisarOutroLado } from '$lib/server/avisos/emitir';

type Event = RequestEvent<{ id: string }>;

/**
 * O aviso de férias ao OUTRO LADO (E59): a unidade lançou/pediu/homologou →
 * o DPI SUL fica sabendo; o DPI SUL lançou/registrou → a unidade fica
 * sabendo. O texto termina com quem fez.
 */
function avisoDeFerias(
	db: ReturnType<typeof getDB>,
	u: Event['locals']['usuario'] & object,
	alvo: { lotacao: string },
	id: number,
	tipo: string,
	titulo: string,
	texto: string
) {
	return avisarOutroLado(db, u, {
		cartao: 'servidores',
		tipo,
		titulo,
		texto: `${texto} — por ${u.nome}`,
		link: `/servidores/${id}`,
		lotacoes: [alvo.lotacao]
	});
}

/** A fração do banco na forma que as regras leem. */
function comoFracao(f: {
	ordem: number;
	data_inicio: string;
	data_fim: string;
	status: 'programada' | 'sustada' | 'suspensa';
}): Fracao {
	return {
		ordem: f.ordem as 1 | 2 | 3,
		data_inicio: f.data_inicio,
		data_fim: f.data_fim,
		status: f.status
	};
}

/** A primeira checagem com erro, como mensagem — ou `null`. */
function primeiroErro(checagens: Checagem[]): string | null {
	return checagens.find((c) => !c.ok && c.nivel === 'erro')?.texto ?? null;
}

/**
 * A divisão escolhida (`divisao`, "10+20") e os primeiros dias (`inicio_1`,
 * `inicio_2`, `inicio_3`) viram períodos montados pela regra — dia útil no 1º
 * dia, sem sobreposição. A divisão precisa estar entre as `admitidas`: é o
 * que impede o POST direto de inventar "5+25".
 */
async function lerPeriodos(
	db: ReturnType<typeof getDB>,
	fd: FormData,
	admitidas: readonly (readonly number[])[]
): Promise<{ periodos: PeriodoMontado[] } | { erro: ReturnType<typeof fail> }> {
	const divisaoBruta = textoLimitado(fd, 'divisao', 20);
	const divisao = admitidas.find((d) => d.join('+') === divisaoBruta.replace(/\s/g, ''));
	if (!divisao) return { erro: fail(400, { error: 'Escolha como dividir as férias.' }) };
	const inicios = divisao.map((_, k) => dataIso(fd, `inicio_${k + 1}`) ?? '');
	const validos = inicios.filter(Boolean).sort();
	const feriados =
		validos.length > 0
			? await feriadosNoIntervalo(db, validos[0], adicionarDias(validos[validos.length - 1], 1))
			: [];
	const { periodos, checagens } = montarPeriodos(
		divisao,
		inicios,
		feriados.map((f) => f.data)
	);
	if (temErro(checagens) || periodos.length !== divisao.length) {
		return {
			erro: fail(400, { error: primeiroErro(checagens) ?? 'Informe o 1º dia de cada fração.' })
		};
	}
	return { periodos };
}

/** O aviso do teto de 15 % no mês em que o 1º período começa — só avisa. */
async function avisoDoTetoNoMes(
	db: ReturnType<typeof getDB>,
	lotacao: string,
	ordem: number,
	inicioISO: string
): Promise<Checagem | null> {
	const teto = await contagemParaTeto(db, lotacao, inicioISO.slice(0, 7));
	return avisoDoTeto({
		ordem,
		emFeriasNoMes: teto.emFerias + 1,
		efetivoDaUnidade: teto.efetivo
	});
}

export const actionsFerias = {
	/** A unidade lança a programação de um exercício, homologada no Guardião. */
	registrarProgramacao: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const fd = await event.request.formData();
		const exercicio = inteiroNaFaixa(fd, 'exercicio', 2000, 2100);
		const observacao = textoLimitado(fd, 'observacao', MAX_JUSTIFICATIVA);
		if (!exercicio) return fail(400, { error: 'Informe o exercício.' });
		const lidos = await lerPeriodos(db, fd, divisoesPossiveis(30));
		if ('erro' in lidos) return lidos.erro;
		const { periodos } = lidos;

		const r = await registrarProgramacao(
			db,
			{ policial_id: id, exercicio, periodos, observacao },
			{ id: u.id, nome: u.nome }
		);
		if (!r.ok) {
			return fail(409, {
				error: `O exercício ${exercicio} já está lançado. Para mudar, exclua a programação ou reprograme.`
			});
		}
		const aviso = await avisoDoTetoNoMes(db, alvo.lotacao, 1, periodos[0].inicio);
		const avisos = aviso && !aviso.ok ? [aviso.texto] : [];

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'ferias_lancar_fracao',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `Exercício ${exercicio}: ${periodos.map((p) => `${p.inicio} a ${p.fim} (${p.dias})`).join('; ')}`,
				metadados: { avisos },
				...contexto
			},
			{ env }
		);
		await avisoDeFerias(
			db,
			u,
			alvo,
			id,
			'ferias_programada',
			`Férias de ${alvo.nome} programadas para ${exercicio}`,
			periodos.map((p) => `${p.inicio} a ${p.fim}`).join(' · ')
		);
		return { success: true, ferias: await listarFeriasDoPolicial(db, id), avisos };
	},

	/** Programação digitada errada: some, com os eventos junto. Só sem vínculo. */
	excluirProgramacao: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const fd = await event.request.formData();
		const exercicio = inteiroNaFaixa(fd, 'exercicio', 2000, 2100);
		if (!exercicio) return fail(400, { error: 'Informe o exercício.' });

		const r = await excluirProgramacao(db, id, exercicio);
		if (!r.ok) {
			return fail(409, {
				error:
					r.motivo === 'tem_vinculo'
						? 'Este exercício tem pedido ou abono ligado a ele e não pode ser excluído.'
						: 'Só uma programação ainda intacta (sem sustação nem suspensão) pode ser excluída.'
			});
		}
		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'ferias_excluir_fracao',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `Programação do exercício ${exercicio} excluída`,
				...contexto
			},
			{ env }
		);
		await avisoDeFerias(
			db,
			u,
			alvo,
			id,
			'ferias_excluida',
			`Programação de férias de ${alvo.nome} (${exercicio}) excluída`,
			'a programação inteira'
		);
		return { success: true, ferias: await listarFeriasDoPolicial(db, id) };
	},

	/**
	 * SUSTAÇÃO: a unidade abre o pedido à COGEP para TODAS as frações ainda não
	 * iniciadas do exercício, com a nova divisão e os novos primeiros dias. As
	 * frações alcançadas não vêm do formulário — vêm dos fatos
	 * (`situacaoDaReprogramacao`), como a lista de divisões admitidas.
	 */
	sustar: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const fd = await event.request.formData();
		const exercicio = inteiroNaFaixa(fd, 'exercicio', 2000, 2100);
		const justificativa = textoLimitado(fd, 'justificativa', MAX_JUSTIFICATIVA);
		if (!exercicio) return fail(400, { error: 'Informe o exercício.' });

		const hoje = hojeBrasilISO();
		const { fracoes } = await listarFeriasDoPolicial(db, id);
		const doExercicio = fracoes.filter((f) => f.exercicio === exercicio);
		const situacao = situacaoDaReprogramacao(doExercicio.map(comoFracao), hoje);
		if (!situacao.sustacao) {
			return fail(409, { error: 'Não há fração por começar neste exercício: nada a sustar.' });
		}
		const alvos = doExercicio.filter(
			(f) => f.status === 'programada' && statusPelaData(comoFracao(f), hoje) === 'programada'
		);
		const lidos = await lerPeriodos(db, fd, situacao.sustacao.divisoes);
		if ('erro' in lidos) return lidos.erro;
		const { periodos } = lidos;

		const aviso = await avisoDoTetoNoMes(db, alvo.lotacao, alvos[0].ordem, periodos[0].inicio);
		const avisos = aviso && !aviso.ok ? [aviso.texto] : [];
		const texto = textoDoOficio({
			servidor: {
				nome: alvo.nome,
				matricula: alvo.matricula,
				cargo: alvo.cargo,
				lotacao: alvo.lotacao
			},
			tipo: 'sustacao',
			fracoesOriginais: alvos.map(comoFracao),
			novosPeriodos: periodos,
			justificativa
		});

		const r = await abrirReprogramacao(
			db,
			{
				policial_id: id,
				exercicio,
				tipo: 'sustacao',
				fracoes_ids: alvos.map((f) => f.id),
				novos_periodos: periodos,
				justificativa,
				texto_oficio: texto
			},
			{ id: u.id, nome: u.nome }
		);
		if (!r.ok) return fail(409, { error: MOTIVO_RECUSA[r.motivo] });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'ferias_reprogramar',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `sustação do exercício ${exercicio}: ${alvos.map((f) => `${f.ordem}ª ${f.data_inicio}–${f.data_fim}`).join(', ')} → ${periodos.map((p) => `${p.inicio}–${p.fim}`).join(', ')}`,
				metadados: { tipo: 'sustacao', avisos },
				...contexto
			},
			{ env }
		);
		await avisoDeFerias(
			db,
			u,
			alvo,
			id,
			'ferias_sustacao',
			`Sustação das férias de ${alvo.nome} (${exercicio}) pedida à COGEP`,
			`novos períodos: ${periodos.map((p) => `${p.inicio} a ${p.fim}`).join(' · ')}`
		);
		return { success: true, ferias: await listarFeriasDoPolicial(db, id), texto, avisos };
	},

	/**
	 * SUSPENSÃO: a fração em gozo é interrompida por imperiosa necessidade do
	 * serviço, e o que RESTA dela volta num período novo. Exige o dia do
	 * retorno, a justificativa e os critérios do art. 6º III. As frações
	 * seguintes não mudam.
	 */
	suspender: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const fd = await event.request.formData();
		const fracaoId = inteiroNaFaixa(fd, 'fracao_id', 1, 99_999_999);
		const dataSuspensao = dataIso(fd, 'data_suspensao');
		const novoInicio = dataIso(fd, 'novo_inicio');
		const justificativa = textoLimitado(fd, 'justificativa', MAX_JUSTIFICATIVA);
		if (!fracaoId) return fail(400, { error: 'Fração inválida.' });
		if (!dataSuspensao) {
			return fail(400, { error: 'Na suspensão, informe o dia do retorno ao serviço.' });
		}
		if (!novoInicio) return fail(400, { error: 'Informe o 1º dia do período que resta.' });
		if (!justificativa.trim()) {
			return fail(400, {
				error: 'A suspensão exige a imperiosa necessidade do serviço, justificada.'
			});
		}
		// Posse: a fração precisa ser deste servidor.
		const fracao = await buscarFracao(db, fracaoId);
		if (!fracao || fracao.policial_id !== id) {
			return fail(404, { error: 'Fração não encontrada para este servidor.' });
		}
		const hoje = hojeBrasilISO();
		const { fracoes } = await listarFeriasDoPolicial(db, id);
		const situacao = situacaoDaReprogramacao(
			fracoes.filter((f) => f.exercicio === fracao.exercicio).map(comoFracao),
			hoje
		);
		if (!situacao.suspensao || situacao.suspensao.fracao.data_inicio !== fracao.data_inicio) {
			return fail(409, {
				error: 'Só a fração em gozo hoje pode ser suspensa. Fração ainda por começar se SUSTA.'
			});
		}

		const erro = primeiroErro(criteriosDaSuspensao(fracao, dataSuspensao, novoInicio));
		if (erro) return fail(400, { error: erro });
		const { restantes } = diasRestantesNaSuspensao(fracao, dataSuspensao);
		if (restantes < 1) return fail(400, { error: 'Não resta dia a reprogramar.' });
		const lidos = await lerPeriodosDaSuspensao(db, novoInicio, restantes);
		if ('erro' in lidos) return lidos.erro;
		const { periodos } = lidos;

		const texto = textoDoOficio({
			servidor: {
				nome: alvo.nome,
				matricula: alvo.matricula,
				cargo: alvo.cargo,
				lotacao: alvo.lotacao
			},
			tipo: 'suspensao',
			fracoesOriginais: [comoFracao(fracao)],
			novosPeriodos: periodos,
			justificativa,
			dataSuspensao
		});
		const r = await abrirReprogramacao(
			db,
			{
				policial_id: id,
				exercicio: fracao.exercicio,
				tipo: 'suspensao',
				fracao_id: fracao.id,
				novos_periodos: periodos,
				data_suspensao: dataSuspensao,
				justificativa,
				texto_oficio: texto
			},
			{ id: u.id, nome: u.nome }
		);
		if (!r.ok) return fail(409, { error: MOTIVO_RECUSA[r.motivo] });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'ferias_reprogramar',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `suspensão da ${fracao.ordem}ª fração ${fracao.exercicio} em ${dataSuspensao}: ${fracao.data_inicio}–${fracao.data_fim} → ${periodos[0].inicio}–${periodos[0].fim} (${restantes} dias)`,
				metadados: { tipo: 'suspensao' },
				...contexto
			},
			{ env }
		);
		await avisoDeFerias(
			db,
			u,
			alvo,
			id,
			'ferias_suspensao',
			`Suspensão das férias de ${alvo.nome} (${fracao.exercicio}) pedida à COGEP`,
			`retorno em ${dataSuspensao}; ${restantes} dias voltam em ${periodos[0].inicio}`
		);
		return { success: true, ferias: await listarFeriasDoPolicial(db, id), texto };
	},

	/** O número do processo, depois de protocolado. */
	anotarNup: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { db, id } = auth;

		const fd = await event.request.formData();
		const reprogId = inteiroNaFaixa(fd, 'reprogramacao_id', 1, 99_999_999);
		const nup = textoLimitado(fd, 'nup', 40);
		if (!reprogId || !nup.trim()) return fail(400, { error: 'Informe o NUP.' });
		// Posse: o pedido precisa ser deste servidor.
		const { pedidos } = await listarFeriasDoPolicial(db, id);
		if (!pedidos.some((r) => r.id === reprogId)) {
			return fail(404, { error: 'Pedido não encontrado para este servidor.' });
		}

		await anotarNupDaReprogramacao(db, reprogId, nup.trim());
		return { success: true, ferias: await listarFeriasDoPolicial(db, id) };
	},

	/** A unidade homologa a resposta da COGEP — favorável ou não. */
	decidirReprogramacao: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const fd = await event.request.formData();
		const reprogId = inteiroNaFaixa(fd, 'reprogramacao_id', 1, 99_999_999);
		const decisao = String(fd.get('decisao') ?? '');
		if (!reprogId || (decisao !== 'deferida' && decisao !== 'indeferida')) {
			return fail(400, { error: 'Informe a decisão da COGEP.' });
		}
		const { pedidos } = await listarFeriasDoPolicial(db, id);
		if (!pedidos.some((r) => r.id === reprogId)) {
			return fail(404, { error: 'Pedido não encontrado para este servidor.' });
		}

		const r = await decidirReprogramacao(
			db,
			reprogId,
			decisao === 'deferida',
			{ id: u.id, nome: u.nome },
			hojeBrasilISO()
		);
		if (!r) return fail(409, { error: 'Este pedido já foi homologado.' });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'ferias_homologar_reprogramacao',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `${r.tipo} ${decisao} pela COGEP${r.nup ? ` (NUP ${r.nup})` : ''}: ${periodosDoPedido(
					r
				)
					.map((p) => `${p.inicio} a ${p.fim}`)
					.join(', ')}`,
				...contexto
			},
			{ env }
		);
		await avisoDeFerias(
			db,
			u,
			alvo,
			id,
			'ferias_homologada',
			`${ROTULO_TIPO_REPROGRAMACAO[r.tipo]} das férias de ${alvo.nome} ${decisao.toUpperCase()} pela COGEP`,
			r.nup ? `NUP ${r.nup}` : 'sem NUP anotado'
		);
		return { success: true, ferias: await listarFeriasDoPolicial(db, id) };
	},

	/**
	 * Só o Admin Geral: o abono chega da COGEP ao DPI SUL, não à unidade — e
	 * chega só a DECISÃO, sem data de requerimento nem de decisão (por isso o
	 * formulário não as pede). As checagens do Dec. 37.363 rodam e vão para a
	 * auditoria; impedimento apurável é aviso — o registro é do que foi
	 * decidido, não do que deveria ter sido.
	 */
	registrarAbono: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;
		if (!isAdminGeral(u)) {
			return fail(403, {
				error: 'Só o Administrador Geral registra abono — a decisão chega ao DPI SUL.'
			});
		}

		const fd = await event.request.formData();
		const fracaoId = inteiroNaFaixa(fd, 'fracao_id', 1, 99_999_999);
		if (!fracaoId) return fail(400, { error: 'Fração inválida.' });
		const fracao = await buscarFracao(db, fracaoId);
		if (!fracao || fracao.policial_id !== id) {
			return fail(404, { error: 'Fração não encontrada para este servidor.' });
		}
		const posicaoBruta = String(fd.get('posicao') ?? '');
		const posicao: PosicaoDoAbono | null =
			posicaoBruta === 'iniciais' || posicaoBruta === 'finais' ? posicaoBruta : null;
		const status = String(fd.get('status') ?? '') === 'indeferido' ? 'indeferido' : 'deferido';
		const nup = textoLimitado(fd, 'nup', 40);
		if (!posicao)
			return fail(400, { error: 'Indique se converte os 10 dias iniciais ou os finais.' });
		if (statusPelaData(comoFracao(fracao), hojeBrasilISO()) === 'gozada') {
			return fail(409, { error: 'Fração já gozada: o abono não retroage (art. 12).' });
		}

		const historico = await listarHistoricoPolicial(db, id);
		const { fracoes } = await listarFeriasDoPolicial(db, id);
		const anoDaFracao = fracao.data_inicio.slice(0, 4);
		const abonosNoAno = fracoes.filter(
			(f) => f.abono?.status === 'deferido' && f.data_inicio.startsWith(anoDaFracao)
		).length;
		const checagens = conferirAbono({
			fracao: comoFracao(fracao),
			hojeISO: hojeBrasilISO(),
			posicao,
			abonosJaDeferidosNoAno: abonosNoAno,
			historico: historico
				.filter((h) => h.tipo === 'afastamento' && h.data_inicio)
				.map((h) => ({
					subtipo: h.subtipo ?? 'outros',
					data_inicio: h.data_inicio as string,
					data_fim: h.data_fim
				}))
		});

		const r = await registrarAbono(
			db,
			{
				fracao_id: fracao.id,
				policial_id: id,
				posicao,
				nup,
				status
			},
			{ id: u.id, nome: u.nome }
		);
		if (!r.ok) {
			return fail(409, {
				error:
					r.motivo === 'ja_tem'
						? 'Esta fração já tem abono registrado.'
						: 'Esta fração não está mais programada.'
			});
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'ferias_registrar_abono',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `Abono ${status} — ${fracao.ordem}ª fração ${fracao.exercicio}, 10 dias ${posicao}${nup ? ` (NUP ${nup})` : ''}`,
				metadados: { avisos: checagens.filter((c) => !c.ok).map((c) => c.texto) },
				...contexto
			},
			{ env }
		);
		// A unidade fica sabendo — e ainda precisa dar ciência (pendência).
		await avisoDeFerias(
			db,
			u,
			alvo,
			id,
			'abono_registrado',
			`Abono de férias de ${alvo.nome} ${status} — ${fracao.ordem}ª fração ${fracao.exercicio}`,
			`10 dias ${posicao}${nup ? ` · NUP ${nup}` : ''}. Nesses dias o servidor TRABALHA: dê ciência na ficha`
		);
		return {
			success: true,
			ferias: await listarFeriasDoPolicial(db, id),
			avisos: checagens.filter((c) => !c.ok).map((c) => c.texto)
		};
	},

	/** A unidade toma ciência: naqueles dias o servidor trabalha. O alerta some. */
	cienciaAbono: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const fd = await event.request.formData();
		const abonoId = inteiroNaFaixa(fd, 'abono_id', 1, 99_999_999);
		if (!abonoId) return fail(400, { error: 'Abono inválido.' });
		const { fracoes } = await listarFeriasDoPolicial(db, id);
		if (!fracoes.some((f) => f.abono?.id === abonoId)) {
			return fail(404, { error: 'Abono não encontrado para este servidor.' });
		}

		await darCienciaDoAbono(db, abonoId, { id: u.id, nome: u.nome }, hojeBrasilISO());
		await avisoDeFerias(
			db,
			u,
			alvo,
			id,
			'abono_ciencia',
			`Ciência do abono de férias de ${alvo.nome} registrada pela unidade`,
			'a unidade sabe que nesses dias o servidor trabalha'
		);
		return { success: true, ferias: await listarFeriasDoPolicial(db, id) };
	}
};

const MOTIVO_RECUSA = {
	ja_pendente: 'Já há um pedido deste exercício aguardando a COGEP.',
	fracao_fechada: 'Alguma das frações não está mais programada.',
	tem_abono: 'Há abono registrado numa das frações: resolva o abono antes de reprogramar.'
} as const;

/**
 * Na suspensão o período novo é UM só, com os dias que restam — não passa
 * pela escolha de divisão. Mesma conferência do 1º dia (dia útil).
 */
async function lerPeriodosDaSuspensao(
	db: ReturnType<typeof getDB>,
	novoInicio: string,
	restantes: number
): Promise<{ periodos: PeriodoMontado[] } | { erro: ReturnType<typeof fail> }> {
	const feriados = await feriadosNoIntervalo(db, novoInicio, novoInicio);
	const { periodos, checagens } = montarPeriodos(
		[restantes],
		[novoInicio],
		feriados.map((f) => f.data)
	);
	if (temErro(checagens) || periodos.length !== 1) {
		return { erro: fail(400, { error: primeiroErro(checagens) ?? 'Período inválido.' }) };
	}
	return { periodos };
}
