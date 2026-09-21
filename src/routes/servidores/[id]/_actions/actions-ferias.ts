/**
 * As actions de FÉRIAS da ficha do servidor (`/servidores/[id]`) — o que a
 * unidade faz com a programação que veio do Guardião e com os pedidos à
 * COGEP, e o que só o DPI SUL faz com o abono.
 *
 * Quem pode (decisões do responsável, 17/09/2026):
 *
 *   - **lançar, excluir, reprogramar, anotar o NUP e homologar a
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
 * regra), e a reprogramação alcança tudo o que resta do exercício: sustação
 * se as férias não começaram, suspensão se já começaram (a fração em gozo
 * devolve só o restante quebrado; as futuras, os dias inteiros). As REGRAS
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
	corrigirFracao,
	darCienciaDoAbono,
	decidirReprogramacao,
	excluirProgramacao,
	listarFeriasDoPolicial,
	listarHistoricoPolicial,
	registrarAbono,
	registrarProgramacao
} from '$lib/db';
import { feriadosNoIntervalo } from '$lib/db/diarias/feriados';
import { isAdminGeral, nomeParaRastro } from '$lib/auth';
import { carregarFichaDoPolicial } from '$lib/server/policiais/ficha-permissao';
import { dataIso, inteiroNaFaixa, textoLimitado } from '$lib/server/form-data';
import { MAX_JUSTIFICATIVA } from '$lib/cadastro-campos';
import {
	avisoDoTeto,
	conferirAbono,
	diasDaFracao,
	criteriosDaSuspensao,
	divisoesPossiveis,
	montarPeriodos,
	planoDaReprogramacao,
	periodoGozadoComAbono,
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
import { avisarDesfalques } from '$lib/server/avisos/desfalques';
import { conflitosDasFerias, ocupadosDoHistorico } from '$lib/servidores/conflitos';

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
	abono?: { status: string; abono_inicio: string; abono_fim: string } | null;
}): Fracao {
	return {
		ordem: f.ordem as 1 | 2 | 3,
		data_inicio: f.data_inicio,
		data_fim: f.data_fim,
		status: f.status,
		diasAbonados: diasVendidos(f.abono)
	};
}

/** Os dias vendidos de uma fração: o abono deferido, se houver. */
function diasVendidos(
	abono: { status: string; abono_inicio: string; abono_fim: string } | null | undefined
): number {
	return abono?.status === 'deferido'
		? diasDaFracao({ data_inicio: abono.abono_inicio, data_fim: abono.abono_fim })
		: 0;
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
		iniciandoNoMes: teto.iniciando + 1,
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
			event.params.id,
			'servidores.ferias'
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
		// Férias não caem dentro de afastamento (decisão dele, 20/09): impede.
		const ocupados = ocupadosDoHistorico(await listarHistoricoPolicial(db, id));
		const conflito = primeiroErro(conflitosDasFerias(periodos, ocupados));
		if (conflito) return fail(400, { error: conflito });

		const r = await registrarProgramacao(
			db,
			{ policial_id: id, exercicio, periodos, observacao },
			{ id: u.id, nome: nomeParaRastro(u) }
		);
		if (!r.ok) {
			return fail(409, {
				error: `O exercício ${exercicio} já está lançado. Para mudar, exclua a programação ou reprograme.`
			});
		}
		const aviso = await avisoDoTetoNoMes(db, alvo.lotacao, 1, periodos[0].inicio);
		const avisos = aviso && !aviso.ok ? [aviso.texto] : [];
		// Escala desfalcada (E60): as férias caem sobre datas já escaladas?
		for (const p of periodos) {
			avisos.push(
				...(await avisarDesfalques(
					db,
					u,
					{ id, nome: alvo.nome, lotacao: alvo.lotacao },
					{ rotulo: 'férias', inicio: p.inicio, fim: p.fim }
				))
			);
		}

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
			event.params.id,
			null
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const fd = await event.request.formData();
		const exercicio = inteiroNaFaixa(fd, 'exercicio', 2000, 2100);
		if (!exercicio) return fail(400, { error: 'Informe o exercício.' });

		// `forcado`: o Admin Geral apaga o exercício inteiro, com pedidos e abono
		// — a exceção para lançamento errado (decisão dele, 20/09).
		const forcado = fd.get('forcado') === '1';
		if (forcado && !isAdminGeral(u)) {
			return fail(403, { error: 'Só o Administrador Geral exclui uma programação com vínculos.' });
		}
		const r = await excluirProgramacao(db, id, exercicio, forcado);
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
				detalhes: `Programação do exercício ${exercicio} excluída${forcado ? ` pelo Admin Geral (${r.apagadas} frações, com pedidos e abono)` : ''}`,
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
	 * A unidade abre o pedido à COGEP para tudo o que resta do exercício. O
	 * TIPO não vem do formulário: sai de `situacaoDaReprogramacao`, pelos fatos
	 * das FÉRIAS (não da fração) — nenhuma começou → sustação; a 1ª já começou
	 * → suspensão. Com fração em gozo, o retorno é obrigatório e os 7 dias
	 * gozados são erro (art. 6º III); as futuras entram inteiras. A lista de
	 * divisões admitidas também sai da regra.
	 */
	reprogramar: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id,
			'servidores.ferias'
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const fd = await event.request.formData();
		const exercicio = inteiroNaFaixa(fd, 'exercicio', 2000, 2100);
		const dataSuspensao = dataIso(fd, 'data_suspensao');
		const justificativa = textoLimitado(fd, 'justificativa', MAX_JUSTIFICATIVA);
		if (!exercicio) return fail(400, { error: 'Informe o exercício.' });

		const hoje = hojeBrasilISO();
		const { fracoes } = await listarFeriasDoPolicial(db, id);
		const doExercicio = fracoes.filter((f) => f.exercicio === exercicio);
		const situacao = situacaoDaReprogramacao(doExercicio.map(comoFracao), hoje);
		if (!situacao.tipo) {
			return fail(409, { error: 'Não há fração por gozar neste exercício: nada a reprogramar.' });
		}
		if (situacao.tipo === 'suspensao' && !justificativa.trim()) {
			return fail(400, {
				error: 'A suspensão exige a imperiosa necessidade do serviço, justificada.'
			});
		}
		if (situacao.emGozo && !dataSuspensao) {
			return fail(400, { error: 'Há fração em gozo: informe o dia do retorno ao serviço.' });
		}
		const plano = planoDaReprogramacao(situacao, dataSuspensao);
		if (plano.diasRestantes < 1) return fail(400, { error: 'Não resta dia a reprogramar.' });
		const lidos = await lerPeriodos(db, fd, plano.divisoes);
		if ('erro' in lidos) return lidos.erro;
		const { periodos } = lidos;
		// Férias não caem dentro de afastamento (decisão dele, 20/09): impede.
		const ocupados = ocupadosDoHistorico(await listarHistoricoPolicial(db, id));
		const conflito = primeiroErro(conflitosDasFerias(periodos, ocupados));
		if (conflito) return fail(400, { error: conflito });
		if (situacao.emGozo && dataSuspensao) {
			const erro = primeiroErro(
				criteriosDaSuspensao(situacao.emGozo, dataSuspensao, periodos[0].inicio)
			);
			if (erro) return fail(400, { error: erro });
		}

		// As frações alcançadas, pelos ids do banco: as que a REGRA disse.
		const chaves = new Set(plano.fracoes.map((f) => `${f.ordem}|${f.data_inicio}`));
		const alvos = doExercicio.filter(
			(f) => f.status === 'programada' && chaves.has(`${f.ordem}|${f.data_inicio}`)
		);
		const emGozoId = situacao.emGozo
			? alvos.find((f) => f.data_inicio === situacao.emGozo?.data_inicio)?.id
			: undefined;

		const aviso = await avisoDoTetoNoMes(
			db,
			alvo.lotacao,
			alvos[0]?.ordem ?? 1,
			periodos[0].inicio
		);
		const avisos = aviso && !aviso.ok ? [aviso.texto] : [];
		const texto = textoDoOficio({
			servidor: {
				nome: alvo.nome,
				matricula: alvo.matricula,
				cargo: alvo.cargo,
				lotacao: alvo.lotacao
			},
			tipo: situacao.tipo,
			fracoesOriginais: plano.fracoes,
			novosPeriodos: periodos,
			justificativa,
			emGozo: situacao.emGozo,
			dataSuspensao
		});

		const r = await abrirReprogramacao(
			db,
			{
				policial_id: id,
				exercicio,
				tipo: situacao.tipo,
				fracoes_ids: alvos.map((f) => f.id),
				fracao_id: emGozoId,
				novos_periodos: periodos,
				data_suspensao: situacao.emGozo ? dataSuspensao : null,
				justificativa,
				texto_oficio: texto
			},
			{ id: u.id, nome: nomeParaRastro(u) }
		);
		if (!r.ok) return fail(409, { error: MOTIVO_RECUSA[r.motivo] });

		const rotulo = ROTULO_TIPO_REPROGRAMACAO[situacao.tipo];
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
				detalhes: `${rotulo.toLowerCase()} do exercício ${exercicio}: ${alvos.map((f) => `${f.ordem}ª ${f.data_inicio}–${f.data_fim}`).join(', ')} → ${periodos.map((p) => `${p.inicio}–${p.fim}`).join(', ')}${dataSuspensao && situacao.emGozo ? ` (retorno ${dataSuspensao})` : ''}`,
				metadados: { tipo: situacao.tipo, avisos },
				...contexto
			},
			{ env }
		);
		await avisoDeFerias(
			db,
			u,
			alvo,
			id,
			`ferias_${situacao.tipo}`,
			`${rotulo} das férias de ${alvo.nome} (${exercicio}) pedida à COGEP`,
			`novos períodos: ${periodos.map((p) => `${p.inicio} a ${p.fim}`).join(' · ')}`
		);
		return { success: true, ferias: await listarFeriasDoPolicial(db, id), texto, avisos };
	},

	/**
	 * CORRIGIR as datas de uma fração lançada errada — só o Admin Geral
	 * (decisão dele, 20/09). Só fração intacta (sem abono, sem pedido pendente):
	 * o que já tem sucessão se apaga (forçado) e relança.
	 */
	corrigirFracao: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id,
			null
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;
		if (!isAdminGeral(u))
			return fail(403, { error: 'Só o Administrador Geral corrige lançamentos.' });

		const fd = await event.request.formData();
		const fracaoId = inteiroNaFaixa(fd, 'fracao_id', 1, 99_999_999);
		const inicio = dataIso(fd, 'data_inicio');
		const dias = inteiroNaFaixa(fd, 'dias', 1, 30);
		if (!fracaoId || !inicio || !dias)
			return fail(400, { error: 'Informe a fração, o 1º dia e os dias.' });
		const fracao = await buscarFracao(db, fracaoId);
		if (!fracao || fracao.policial_id !== id) {
			return fail(404, { error: 'Fração não encontrada para este servidor.' });
		}
		const feriados = await feriadosNoIntervalo(db, inicio, inicio);
		const { periodos, checagens } = montarPeriodos(
			[dias],
			[inicio],
			feriados.map((f) => f.data)
		);
		if (temErro(checagens) || periodos.length !== 1) {
			return fail(400, { error: primeiroErro(checagens) ?? 'Período inválido.' });
		}
		const ocupados = ocupadosDoHistorico(await listarHistoricoPolicial(db, id));
		const conflito = primeiroErro(conflitosDasFerias(periodos, ocupados));
		if (conflito) return fail(400, { error: conflito });

		const r = await corrigirFracao(db, fracaoId, {
			data_inicio: periodos[0].inicio,
			data_fim: periodos[0].fim
		});
		if (!r.ok) {
			return fail(409, {
				error:
					r.motivo === 'tem_vinculo'
						? 'Fração com abono ou pedido pendente não se corrige: exclua a programação e relance.'
						: 'Só uma fração ainda programada pode ser corrigida.'
			});
		}
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
				detalhes: `${fracao.ordem}ª fração ${fracao.exercicio} corrigida pelo Admin Geral: ${r.antes.data_inicio}–${r.antes.data_fim} → ${periodos[0].inicio}–${periodos[0].fim}`,
				dados_antes: { data_inicio: r.antes.data_inicio, data_fim: r.antes.data_fim },
				dados_depois: { data_inicio: periodos[0].inicio, data_fim: periodos[0].fim },
				...contexto
			},
			{ env }
		);
		await avisoDeFerias(
			db,
			u,
			alvo,
			id,
			'ferias_corrigida',
			`${fracao.ordem}ª fração de férias de ${alvo.nome} (${fracao.exercicio}) corrigida pelo DPI SUL`,
			`${periodos[0].inicio} a ${periodos[0].fim}`
		);
		return { success: true, ferias: await listarFeriasDoPolicial(db, id) };
	},

	/** O número do processo, depois de protocolado. */
	anotarNup: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id,
			'servidores.ferias'
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
			event.params.id,
			'servidores.ferias'
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
			{ id: u.id, nome: nomeParaRastro(u) },
			hojeBrasilISO()
		);
		if (!r) return fail(409, { error: 'Este pedido já foi homologado.' });
		// Escala desfalcada (E60): os períodos novos, deferidos, caem sobre escalas?
		const desfalques: string[] = [];
		if (decisao === 'deferida') {
			for (const p of periodosDoPedido(r)) {
				desfalques.push(
					...(await avisarDesfalques(
						db,
						u,
						{ id, nome: alvo.nome, lotacao: alvo.lotacao },
						{ rotulo: 'férias', inicio: p.inicio, fim: p.fim }
					))
				);
			}
		}

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
		return { success: true, ferias: await listarFeriasDoPolicial(db, id), avisos: desfalques };
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
			event.params.id,
			null
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
		// E62 (resposta da COGEP): uma venda por EXERCÍCIO e uma por ANO CIVIL —
		// o ano é o do período vendido, não o da fração (uma fração que vira o
		// ano pode ter os 10 finais em janeiro).
		const anoDoAbono = periodoGozadoComAbono(fracao, posicao).abono.inicio.slice(0, 4);
		const deferidos = fracoes.filter((f) => f.abono?.status === 'deferido' && f.id !== fracao.id);
		const abonosNoAno = deferidos.filter((f) =>
			f.abono?.abono_inicio.startsWith(anoDoAbono)
		).length;
		const abonosNoExercicio = deferidos.filter((f) => f.exercicio === fracao.exercicio).length;
		if (status === 'deferido' && abonosNoExercicio > 0) {
			return fail(409, {
				error: `O exercício ${fracao.exercicio} já teve abono deferido — só uma venda por exercício (art. 11; COGEP).`
			});
		}
		if (status === 'deferido' && abonosNoAno > 0) {
			return fail(409, {
				error: `Já há abono deferido em ${anoDoAbono}, ainda que de outro exercício — só uma venda por ano civil (art. 11; COGEP).`
			});
		}
		const checagens = conferirAbono({
			fracao: comoFracao(fracao),
			hojeISO: hojeBrasilISO(),
			posicao,
			abonosJaDeferidosNoAno: abonosNoAno,
			abonosJaDeferidosNoExercicio: abonosNoExercicio,
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
			{ id: u.id, nome: nomeParaRastro(u) }
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
			event.params.id,
			'servidores.ferias'
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

		await darCienciaDoAbono(db, abonoId, { id: u.id, nome: nomeParaRastro(u) }, hojeBrasilISO());
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
	com_abono:
		'Uma das frações tem abono deferido: não pode ser sustada, suspensa nem redividida (art. 4º § 1º do Dec. 37.363).'
} as const;
