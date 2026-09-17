/**
 * As actions de FÉRIAS da ficha do servidor (`/servidores/[id]`) — o que a
 * unidade faz com as frações que vieram do Guardião e com os pedidos à COGEP,
 * e o que só o DPI SUL faz com o abono.
 *
 * Quem pode (decisões do responsável, 17/09/2026):
 *
 *   - **lançar, excluir, reprogramar, anotar o NUP e homologar a resposta da
 *     COGEP**: qualquer perfil que abre a ficha dentro do escopo — a unidade
 *     em primeiro lugar, porque é ela quem monta o pedido; a seccional e o
 *     Admin Geral também. O portão é `carregarFichaDoPolicial`, o mesmo das
 *     ações de RH, e é ele que recusa o id de outra seccional;
 *   - **registrar o abono**: só o Admin Geral, porque o servidor pede direto à
 *     COGEP e é o DPI SUL que recebe a decisão;
 *   - **dar ciência do abono**: a unidade (o Admin Geral também).
 *
 * As REGRAS (sustação × suspensão, critérios, ofício) são de
 * `$lib/servidores/ferias` e rodam AQUI de novo, ainda que a tela já as tenha
 * mostrado: o POST direto não passa pela tela. A classificação nunca vem do
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
	excluirFracao,
	listarFeriasDoPolicial,
	listarHistoricoPolicial,
	registrarAbono,
	registrarFracao
} from '$lib/db';
import { feriadosNoIntervalo } from '$lib/db/diarias/feriados';
import { isAdminGeral } from '$lib/auth';
import { carregarFichaDoPolicial } from '$lib/server/policiais/ficha-permissao';
import { dataIso, inteiroNaFaixa, textoLimitado } from '$lib/server/form-data';
import { MAX_JUSTIFICATIVA } from '$lib/cadastro-campos';
import {
	classificarReprogramacao,
	conferirAbono,
	conferirNovoPeriodo,
	criteriosDaSuspensao,
	statusPelaData,
	temErro,
	textoDoOficio,
	type Checagem,
	type Fracao,
	type PosicaoDoAbono
} from '$lib/servidores/ferias';
import { hojeBrasilISO } from '$lib/utils/datas';

type Event = RequestEvent<{ id: string }>;

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

/** Fração pertence ao servidor da URL? Id de fração também chega de fora. */
async function fracaoDoServidor(db: ReturnType<typeof getDB>, fd: FormData, policialId: number) {
	const fracaoId = inteiroNaFaixa(fd, 'fracao_id', 1, 99_999_999);
	if (!fracaoId) return { erro: fail(400, { error: 'Fração inválida.' }) };
	const fracao = await buscarFracao(db, fracaoId);
	if (!fracao || fracao.policial_id !== policialId) {
		return { erro: fail(404, { error: 'Fração não encontrada para este servidor.' }) };
	}
	return { fracao };
}

export const actionsFerias = {
	/** A unidade lança uma fração homologada no Guardião. */
	registrarFracao: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const fd = await event.request.formData();
		const exercicio = inteiroNaFaixa(fd, 'exercicio', 2000, 2100);
		const ordem = inteiroNaFaixa(fd, 'ordem', 1, 3);
		const inicio = dataIso(fd, 'data_inicio');
		const fim = dataIso(fd, 'data_fim');
		const observacao = textoLimitado(fd, 'observacao', MAX_JUSTIFICATIVA);
		if (!exercicio || !ordem || !inicio || !fim) {
			return fail(400, { error: 'Informe exercício, fração, início e fim.' });
		}
		if (fim < inicio) return fail(400, { error: 'O fim não pode ser anterior ao início.' });

		const r = await registrarFracao(
			db,
			{
				policial_id: id,
				exercicio,
				ordem: ordem as 1 | 2 | 3,
				data_inicio: inicio,
				data_fim: fim,
				observacao
			},
			{ id: u.id, nome: u.nome }
		);
		if (!r.ok) {
			return fail(409, { error: `A ${ordem}ª fração de ${exercicio} já está lançada.` });
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
				detalhes: `${ordem}ª fração ${exercicio}: ${inicio} a ${fim}`,
				...contexto
			},
			{ env }
		);
		return { success: true, ferias: await listarFeriasDoPolicial(db, id) };
	},

	/** Fração digitada errada: some, com o evento junto. Só enquanto programada e sem vínculo. */
	excluirFracao: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const fd = await event.request.formData();
		const achada = await fracaoDoServidor(db, fd, id);
		if ('erro' in achada) return achada.erro;

		const r = await excluirFracao(db, achada.fracao.id);
		if (!r.ok) {
			return fail(409, {
				error:
					r.motivo === 'tem_vinculo'
						? 'Esta fração tem pedido ou abono ligado a ela e não pode ser excluída.'
						: 'Só uma fração ainda programada pode ser excluída.'
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
				detalhes: `${achada.fracao.ordem}ª fração ${achada.fracao.exercicio} excluída (${achada.fracao.data_inicio} a ${achada.fracao.data_fim})`,
				...contexto
			},
			{ env }
		);
		return { success: true, ferias: await listarFeriasDoPolicial(db, id) };
	},

	/**
	 * A unidade abre o pedido à COGEP. O TIPO não vem do formulário: sai de
	 * `classificarReprogramacao`, pelos fatos. As datas novas passam por
	 * `conferirNovoPeriodo`; na suspensão, também por `criteriosDaSuspensao`.
	 * Aviso deixa passar; erro recusa.
	 */
	reprogramar: async (event: Event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;

		const fd = await event.request.formData();
		const achada = await fracaoDoServidor(db, fd, id);
		if ('erro' in achada) return achada.erro;
		const { fracao } = achada;
		const novoInicio = dataIso(fd, 'novo_inicio');
		const novoFim = dataIso(fd, 'novo_fim');
		const dataSuspensao = dataIso(fd, 'data_suspensao');
		const justificativa = textoLimitado(fd, 'justificativa', MAX_JUSTIFICATIVA);
		if (!novoInicio || !novoFim) return fail(400, { error: 'Informe o novo período.' });

		const hoje = hojeBrasilISO();
		const todas = (await listarFeriasDoPolicial(db, id))
			.filter((f) => f.exercicio === fracao.exercicio)
			.map(comoFracao);
		let classificacao;
		try {
			classificacao = classificarReprogramacao(comoFracao(fracao), hoje, todas);
		} catch (e) {
			return fail(409, { error: e instanceof Error ? e.message : 'Fração não reprogramável.' });
		}

		if (classificacao.tipo === 'suspensao') {
			if (!dataSuspensao) {
				return fail(400, { error: 'Na suspensão, informe o dia do retorno ao serviço.' });
			}
			if (!justificativa.trim()) {
				return fail(400, {
					error: 'A suspensão exige a imperiosa necessidade do serviço, justificada.'
				});
			}
			const erro = primeiroErro(criteriosDaSuspensao(fracao, dataSuspensao, novoInicio));
			if (erro) return fail(400, { error: erro });
		}

		const anoMes = novoInicio.slice(0, 7);
		const [feriados, teto] = await Promise.all([
			feriadosNoIntervalo(db, novoInicio, novoInicio),
			contagemParaTeto(db, alvo.lotacao, anoMes)
		]);
		const checagens = conferirNovoPeriodo({
			fracaoOriginal: comoFracao(fracao),
			novoInicio,
			novoFim,
			feriados: feriados.map((f) => f.data),
			emFeriasNoMes: teto.emFerias + 1,
			efetivoDaUnidade: teto.efetivo
		});
		if (temErro(checagens))
			return fail(400, { error: primeiroErro(checagens) ?? 'Período inválido.' });

		const texto = textoDoOficio({
			servidor: {
				nome: alvo.nome,
				matricula: alvo.matricula,
				cargo: alvo.cargo,
				lotacao: alvo.lotacao
			},
			classificacao,
			fracaoOriginal: comoFracao(fracao),
			novoInicio,
			novoFim,
			justificativa,
			dataSuspensao: dataSuspensao ?? undefined
		});

		const r = await abrirReprogramacao(
			db,
			{
				fracao_id: fracao.id,
				policial_id: id,
				tipo: classificacao.tipo,
				novo_inicio: novoInicio,
				novo_fim: novoFim,
				data_suspensao: dataSuspensao,
				justificativa,
				texto_oficio: texto
			},
			{ id: u.id, nome: u.nome }
		);
		if (!r.ok) {
			return fail(409, {
				error:
					r.motivo === 'ja_pendente'
						? 'Já há um pedido desta fração aguardando a COGEP.'
						: 'Esta fração não está mais programada.'
			});
		}

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
				detalhes: `${classificacao.tipo} da ${fracao.ordem}ª fração ${fracao.exercicio}: ${fracao.data_inicio}–${fracao.data_fim} → ${novoInicio}–${novoFim}`,
				metadados: {
					tipo: classificacao.tipo,
					avisos: checagens.filter((c) => !c.ok).map((c) => c.texto)
				},
				...contexto
			},
			{ env }
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
		const ferias = await listarFeriasDoPolicial(db, id);
		const dono = ferias.some((f) => f.reprogramacoes.some((r) => r.id === reprogId));
		if (!dono) return fail(404, { error: 'Pedido não encontrado para este servidor.' });

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
		const ferias = await listarFeriasDoPolicial(db, id);
		const dono = ferias.some((f) => f.reprogramacoes.some((r) => r.id === reprogId));
		if (!dono) return fail(404, { error: 'Pedido não encontrado para este servidor.' });

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
				detalhes: `${r.tipo} ${decisao} pela COGEP${r.nup ? ` (NUP ${r.nup})` : ''}: ${r.novo_inicio} a ${r.novo_fim}`,
				...contexto
			},
			{ env }
		);
		return { success: true, ferias: await listarFeriasDoPolicial(db, id) };
	},

	/**
	 * Só o Admin Geral: o abono chega da COGEP ao DPI SUL, não à unidade. As
	 * checagens do Dec. 37.363 rodam e vão para a auditoria; janela fora do
	 * prazo é aviso (a decisão já foi do DG), impedimento apurável é aviso
	 * também — o registro é do que foi decidido, não do que deveria ter sido.
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
		const achada = await fracaoDoServidor(db, fd, id);
		if ('erro' in achada) return achada.erro;
		const { fracao } = achada;
		const posicaoBruta = String(fd.get('posicao') ?? '');
		const posicao: PosicaoDoAbono | null =
			posicaoBruta === 'iniciais' || posicaoBruta === 'finais' ? posicaoBruta : null;
		const status = String(fd.get('status') ?? '') === 'indeferido' ? 'indeferido' : 'deferido';
		const nup = textoLimitado(fd, 'nup', 40);
		const dataRequerimento = dataIso(fd, 'data_requerimento');
		const decididoEm = dataIso(fd, 'decidido_em');
		if (!posicao)
			return fail(400, { error: 'Indique se converte os 10 dias iniciais ou os finais.' });
		if (statusPelaData(comoFracao(fracao), hojeBrasilISO()) === 'gozada') {
			return fail(409, { error: 'Fração já gozada: o abono não retroage (art. 12).' });
		}

		const historico = await listarHistoricoPolicial(db, id);
		const ferias = await listarFeriasDoPolicial(db, id);
		const anoDaFracao = fracao.data_inicio.slice(0, 4);
		const abonosNoAno = ferias.filter(
			(f) => f.abono?.status === 'deferido' && f.data_inicio.startsWith(anoDaFracao)
		).length;
		const checagens = conferirAbono({
			fracao: comoFracao(fracao),
			dataRequerimentoISO: dataRequerimento ?? hojeBrasilISO(),
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
				data_requerimento: dataRequerimento,
				status,
				decidido_em: decididoEm
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
		const { u, db, id } = auth;

		const fd = await event.request.formData();
		const abonoId = inteiroNaFaixa(fd, 'abono_id', 1, 99_999_999);
		if (!abonoId) return fail(400, { error: 'Abono inválido.' });
		const ferias = await listarFeriasDoPolicial(db, id);
		const dono = ferias.some((f) => f.abono?.id === abonoId);
		if (!dono) return fail(404, { error: 'Abono não encontrado para este servidor.' });

		await darCienciaDoAbono(db, abonoId, { id: u.id, nome: u.nome }, hojeBrasilISO());
		return { success: true, ferias: await listarFeriasDoPolicial(db, id) };
	}
};
