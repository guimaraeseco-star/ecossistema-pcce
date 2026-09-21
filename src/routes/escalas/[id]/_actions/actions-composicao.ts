/**
 * Form actions de COMPOSIÇÃO de `/escalas/[id]` — quem está na escala.
 *
 * `adicionarPlantao` recebe as datas já projetadas pelo cliente (ciclo 1x3/2x6)
 * e insere uma linha por dia; as demais mexem numa linha de cada vez ou no lote
 * inteiro.
 *
 * Todas passam por `carregarEscalaComPermissao(..., 'conteudo')` — é o guard de
 * imutabilidade: escala assinada ou finalizada não tem a composição alterada.
 * Item de `escala_policiais` é sempre buscado por `id` **e** `escala_id`: sem o
 * par, um `item_id` de outra escala é aceito por quem só tem permissão nesta
 * (FLW-ESC-002).
 */
import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	listarPoliciaisEscala,
	listarPoliciaisEscalaQuery,
	adicionarMultiplasDatasPlantao,
	adicionarTodosPoliciais
} from '$lib/db';
import { logger } from '$lib/server/logger';
import { ehViolacaoUnique } from '$lib/server/db-errors';
import { eq, and, inArray } from 'drizzle-orm';
import { escalaPoliciais } from '$lib/server/schema';
import {
	verificarConflitoGlobal,
	verificarConflitoGlobalBatch
} from '$lib/server/escalas/conflict';
import { calcularDataSaida } from '$lib/rotacao';
import { dataISOValida } from '$lib/utils/datas';
import { erroDeDatasForaDoPeriodo } from '$lib/server/escalas/periodo';
import {
	afastadosNoPeriodo,
	afastamentosNasDatas,
	descreverAfastamento
} from '$lib/db/policiais/afastamento-escalas';
import { policiais as tabelaPoliciais } from '$lib/server/schema';
import { carregarEscalaComPermissao, lerEquipe, MAX_EQUIPE_ESCALA } from './shared';
import { registrarMudancaEscala, nomeDoPolicial } from './desfecho';
import { mensagemDeErro } from '$lib/utils/erro';
import {
	textoLimitado,
	horaDeCamposSeparados,
	horaOuPadrao,
	dataIso,
	informado,
	MAX_OBSERVACOES
} from '$lib/server/form-data';

/** O `event` das actions desta rota: `params.id` é a escala. */
type Event = RequestEvent<{ id: string }>;

export const actionsComposicao = {
	/** Inclui UM policial num dia (plantão avulso ou expediente). */
	adicionar: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const policial_id = Number(data.get('policial_id'));
		const data_plantao = data.get('data_plantao')?.toString() || '';
		// Hora e minuto vinham CRUS e eram concatenados: `hora_entrada=99` virava
		// `99:00` gravado na coluna e impresso no PDF assinado.
		const horaEnt = horaDeCamposSeparados(data, 'hora_entrada', 'minuto_entrada', 8, 0);
		const horaSai = horaDeCamposSeparados(data, 'hora_saida', 'minuto_saida', 8, 0);
		const equipe = lerEquipe(data);
		const observacoes = textoLimitado(data, 'observacoes', MAX_OBSERVACOES);
		const dataSaidaOverride = informado(data, 'data_saida_override')
			? dataIso(data, 'data_saida_override')
			: '';

		if (isNaN(policial_id) || !data_plantao) {
			return fail(400, { error: 'Dados inválidos' });
		}
		if (horaEnt === null || horaSai === null) {
			return fail(400, { error: 'Horário inválido — use hora 0–23 e minuto 0–59.' });
		}
		if (equipe === null) {
			return fail(400, { error: `Equipe inválida — informe de 1 a ${MAX_EQUIPE_ESCALA}.` });
		}
		if (dataSaidaOverride === null) {
			return fail(400, { error: 'Data de saída inválida — use AAAA-MM-DD.' });
		}

		// A data vem do cliente e o calendário é markup (FLW-ESC-005).
		const foraDoPeriodo = erroDeDatasForaDoPeriodo(escala, [data_plantao]);
		if (foraDoPeriodo) return fail(400, { error: foraDoPeriodo });

		const dataSaida = dataSaidaOverride || calcularDataSaida(data_plantao, horaEnt, horaSai);

		// Afastado não se escala (decisão dele, 20/09 — E60): férias em gozo ou
		// qualquer afastamento na data recusam.
		const afastado = (await afastamentosNasDatas(db, policial_id, [data_plantao])).get(
			data_plantao
		);
		if (afastado) {
			return fail(409, {
				error: `${await nomeDoPolicial(db, policial_id)} está afastado — ${descreverAfastamento(afastado)}.`
			});
		}

		// -1 = sem exclusão: verifica TODAS as escalas, inclusive a atual (impede duplicatas)
		const conflito = await verificarConflitoGlobal(
			db,
			policial_id,
			data_plantao,
			horaEnt,
			horaSai,
			-1
		);
		if (!conflito.ok) return fail(409, { error: conflito.motivo });

		try {
			// D1 batch: insert + listagem em 1 round-trip (antes: 2 round-trips serializados)
			const [, policiais] = await db.batch([
				db.insert(escalaPoliciais).values({
					escala_id: escalaId,
					policial_id,
					data_plantao,
					data_saida: dataSaida,
					hora_entrada: horaEnt,
					hora_saida: horaSai,
					observacoes,
					equipe
				}),
				listarPoliciaisEscalaQuery(db, escalaId)
			]);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'adicionar_policial_escala',
				alvo: { tipo: 'policial', id: policial_id, nome: await nomeDoPolicial(db, policial_id) },
				detalhes: `Escalado em ${data_plantao}, ${horaEnt} às ${horaSai}`,
				itens: 1,
				dados_depois: {
					data_plantao,
					data_saida: dataSaida,
					hora_entrada: horaEnt,
					hora_saida: horaSai,
					equipe,
					observacoes
				}
			});

			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao adicionar policial' });
		}
	},

	/**
	 * Inclui um policial em VÁRIOS dias de uma vez (as datas vêm do calendário
	 * do modal, num campo oculto JSON).
	 */
	adicionarPlantao: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const policial_id = Number(data.get('policial_id'));
		const he = horaDeCamposSeparados(data, 'hora_entrada', 'minuto_entrada', 8, 0);
		const hs = horaDeCamposSeparados(data, 'hora_saida', 'minuto_saida', 8, 0);
		const equipe = lerEquipe(data);

		// Parse datas selecionadas (JSON string no hidden field)
		const datasJson = data.get('datas')?.toString() || '[]';
		let datas: Array<{ data_plantao: string; data_saida: string }>;
		try {
			datas = JSON.parse(datasJson);
		} catch {
			return fail(400, { error: 'Datas inválidas' });
		}

		if (isNaN(policial_id) || datas.length === 0) {
			return fail(400, { error: 'Selecione pelo menos uma data' });
		}
		if (he === null || hs === null) {
			return fail(400, { error: 'Horário inválido — use hora 0–23 e minuto 0–59.' });
		}
		if (equipe === null) {
			return fail(400, { error: `Equipe inválida — informe de 1 a ${MAX_EQUIPE_ESCALA}.` });
		}

		// `data_plantao` de cada par é conferida contra o período logo abaixo; a
		// `data_saida` do MESMO par não era conferida por nada, e o JSON vem de
		// campo oculto — que é markup, não promessa.
		if (!datas.every((d) => dataISOValida(d?.data_saida))) {
			return fail(400, { error: 'Data de saída inválida — use AAAA-MM-DD.' });
		}

		const foraDoPeriodo = erroDeDatasForaDoPeriodo(
			escala,
			datas.map((d) => d.data_plantao)
		);
		if (foraDoPeriodo) return fail(400, { error: foraDoPeriodo });

		// Verifica conflitos em batch (-1 = sem exclusão, verifica inclusive a escala atual)
		const datasStr = datas.map((d) => d.data_plantao);
		const conflitosMap = await verificarConflitoGlobalBatch(db, policial_id, datasStr, he, hs, -1);
		// Afastado não se escala (E60): as datas cobertas por afastamento saem como
		// as de choque de horário — recusadas uma a uma, com o motivo.
		for (const [data, a] of await afastamentosNasDatas(db, policial_id, datasStr)) {
			conflitosMap.set(data, `afastado — ${descreverAfastamento(a)}`);
		}

		const datasLimpas = datas.filter((d) => !conflitosMap.has(d.data_plantao));
		const conflitantes = Array.from(conflitosMap.entries()).map(([data, motivo]) => ({
			data,
			motivo
		}));

		if (datasLimpas.length === 0) {
			const primeiro = conflitantes[0];
			return fail(409, {
				error: `Choque de horário em todas as datas. Ex: ${primeiro.data} — ${primeiro.motivo}`
			});
		}

		try {
			await adicionarMultiplasDatasPlantao(db, escalaId, policial_id, datasLimpas, he, hs, equipe);
			const policiais = await listarPoliciaisEscala(db, escalaId);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'adicionar_policial_escala',
				alvo: { tipo: 'policial', id: policial_id, nome: await nomeDoPolicial(db, policial_id) },
				detalhes: `Escalado em ${datasLimpas.length} dia(s) de plantão, ${he} às ${hs}`,
				itens: datasLimpas.length,
				// As datas RECUSADAS entram no evento: a tela avisa o operador e o
				// aviso some no reload; a trilha é onde ele volta a existir.
				metadados: { equipe, recusadas_por_conflito: conflitantes },
				dados_depois: { datas: datasLimpas.map((d) => d.data_plantao) }
			});

			return { success: true, policiais, conflitantes };
		} catch (e) {
			if (ehViolacaoUnique(e)) {
				return fail(409, { error: 'Este policial já está escalado neste dia.' });
			}
			return fail(500, { error: 'Erro ao adicionar policial à escala de plantão' });
		}
	},

	/**
	 * Preenche a escala com todos os policiais da lotação, no horário padrão da
	 * própria escala. Atalho do início do mês, antes dos ajustes individuais.
	 */
	adicionarTodos: async (event: Event) => {
		const { locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		if (escala.tipo !== 'plantao' && escala.tipo !== 'expediente') {
			return fail(400, { error: 'Operação inválida para este tipo de escala' });
		}

		const he = escala.hora_entrada || '08:00';
		const hs = escala.hora_saida || '08:00';
		const ds =
			escala.tipo === 'expediente'
				? escala.data_fim
				: calcularDataSaida(escala.data_inicio, he, hs);

		// Afastado não se escala (E60): quem tem afastamento tocando o período da
		// escala fica de fora, e o toast diz quem — o admin decide o resto dia a dia.
		const daLotacao = await db
			.select({ id: tabelaPoliciais.id, nome: tabelaPoliciais.nome })
			.from(tabelaPoliciais)
			.where(and(eq(tabelaPoliciais.ativo, 1), eq(tabelaPoliciais.lotacao, escala.lotacao)));
		const afastados = await afastadosNoPeriodo(
			db,
			daLotacao.map((p) => p.id),
			escala.data_inicio,
			escala.data_fim
		);
		const foraPorAfastamento = daLotacao
			.filter((p) => afastados.has(p.id))
			.map((p) => `${p.nome} (${descreverAfastamento(afastados.get(p.id)!)})`);

		try {
			const quantidade = await adicionarTodosPoliciais(
				db,
				escalaId,
				escala.lotacao,
				escala.tipo,
				escala.data_inicio,
				ds,
				he,
				hs,
				new Set(afastados.keys())
			);
			const policiais = await listarPoliciaisEscala(db, escalaId);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'adicionar_policial_escala',
				alvo: { tipo: 'escala', id: escalaId, nome: escala.titulo },
				detalhes: `${quantidade} servidor(es) da lotação ${escala.lotacao} incluídos de uma vez`,
				itens: quantidade,
				metadados: {
					lotacao: escala.lotacao,
					hora_entrada: he,
					hora_saida: hs,
					fora_por_afastamento: foraPorAfastamento
				}
			});

			return { success: true, quantidade, policiais, foraPorAfastamento };
		} catch (err) {
			if (ehViolacaoUnique(err)) {
				return fail(409, { error: 'Há servidor já escalado neste dia.' });
			}
			logger.error('[escalas/adicionarTodos] Erro ao adicionar servidores', {
				escalaId,
				lotacao: escala.lotacao,
				tipo: escala.tipo,
				error: mensagemDeErro(err),
				stack: err instanceof Error ? err.stack : undefined
			});
			return fail(500, { error: 'Erro ao adicionar servidores' });
		}
	},

	/** Edita uma linha (dia/horário/equipe/observações) de um policial. */
	editar: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const item_id = Number(data.get('item_id'));
		const data_plantao = data.get('data_plantao')?.toString() || '';
		// `data_plantao` é conferida contra o período mais abaixo; `data_saida` não
		// era conferida por NADA e ia direto para a coluna — o plantão podia sair
		// num dia que não existe.
		const data_saida = informado(data, 'data_saida') ? dataIso(data, 'data_saida') : '';
		// Aqui a convenção é o campo ÚNICO `HH:MM` — o mesmo ARQUIVO tem, em
		// `adicionar`, a leitura de hora e minuto separados. As duas grafias
		// convivem desde sempre; o que muda é que agora as duas passam por leitor.
		const hora_entrada = horaOuPadrao(data, 'hora_entrada', '');
		const hora_saida = horaOuPadrao(data, 'hora_saida', '');
		if (hora_entrada === null || hora_saida === null) {
			return fail(400, { error: 'Horário inválido — use HH:MM.' });
		}
		if (data_saida === null) {
			return fail(400, { error: 'Data de saída inválida — use AAAA-MM-DD.' });
		}
		const observacoes = textoLimitado(data, 'observacoes', MAX_OBSERVACOES);

		if (isNaN(item_id)) return fail(400, { error: 'ID inválido' });

		if (data_plantao) {
			const foraDoPeriodo = erroDeDatasForaDoPeriodo(escala, [data_plantao]);
			if (foraDoPeriodo) return fail(400, { error: foraDoPeriodo });
		}

		// Busca policial_id do registro para validar conflito
		const registro = await db
			.select({
				policial_id: escalaPoliciais.policial_id,
				data_plantao: escalaPoliciais.data_plantao,
				data_saida: escalaPoliciais.data_saida,
				hora_entrada: escalaPoliciais.hora_entrada,
				hora_saida: escalaPoliciais.hora_saida,
				observacoes: escalaPoliciais.observacoes
			})
			.from(escalaPoliciais)
			// `escala_id` junto do `id`: sem isso, um `item_id` de OUTRA escala é
			// aceito por quem só tem permissão nesta (FLW-ESC-002).
			.where(and(eq(escalaPoliciais.escala_id, escalaId), eq(escalaPoliciais.id, item_id)))
			.get();

		// Recusa explícita em vez de UPDATE que não acha linha e devolve sucesso:
		// item de outra escala tem de ser indistinguível de item inexistente.
		if (!registro) return fail(404, { error: 'Item não encontrado nesta escala' });

		if (hora_entrada && hora_saida && data_plantao) {
			const conflito = await verificarConflitoGlobal(
				db,
				registro.policial_id,
				data_plantao,
				hora_entrada,
				hora_saida,
				escalaId
			);
			if (!conflito.ok) return fail(409, { error: conflito.motivo });
		}

		try {
			// D1 batch: update + listagem em 1 round-trip
			const [, policiais] = await db.batch([
				db
					.update(escalaPoliciais)
					.set({
						data_plantao,
						data_saida,
						hora_entrada,
						hora_saida,
						observacoes
					})
					.where(and(eq(escalaPoliciais.escala_id, escalaId), eq(escalaPoliciais.id, item_id))),
				listarPoliciaisEscalaQuery(db, escalaId)
			]);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'editar_escala',
				alvo: {
					tipo: 'policial',
					id: registro.policial_id,
					nome: await nomeDoPolicial(db, registro.policial_id)
				},
				detalhes: `Plantão de ${registro.data_plantao} alterado para ${data_plantao}, ${hora_entrada} às ${hora_saida}`,
				itens: 1,
				metadados: { item_id },
				dados_antes: {
					data_plantao: registro.data_plantao,
					data_saida: registro.data_saida,
					hora_entrada: registro.hora_entrada,
					hora_saida: registro.hora_saida,
					observacoes: registro.observacoes
				},
				dados_depois: { data_plantao, data_saida, hora_entrada, hora_saida, observacoes }
			});

			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao salvar alterações' });
		}
	},

	/** Remove uma linha e devolve a listagem já atualizada, em um round-trip. */
	remover: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const item_id = Number(data.get('item_id'));

		if (isNaN(item_id)) return fail(400, { error: 'ID inválido' });

		// Estado ANTERIOR completo: depois do delete não há de onde tirar quem foi
		// desescalado nem de que dia.
		const alvo = await db
			.select({
				id: escalaPoliciais.id,
				policial_id: escalaPoliciais.policial_id,
				data_plantao: escalaPoliciais.data_plantao,
				hora_entrada: escalaPoliciais.hora_entrada,
				hora_saida: escalaPoliciais.hora_saida
			})
			.from(escalaPoliciais)
			.where(and(eq(escalaPoliciais.escala_id, escalaId), eq(escalaPoliciais.id, item_id)))
			.get();
		if (!alvo) return fail(404, { error: 'Item não encontrado nesta escala' });

		const nomeAlvo = await nomeDoPolicial(db, alvo.policial_id);

		try {
			// D1 batch: delete + listagem em 1 round-trip
			const [, policiais] = await db.batch([
				db
					.delete(escalaPoliciais)
					.where(and(eq(escalaPoliciais.escala_id, escalaId), eq(escalaPoliciais.id, item_id))),
				listarPoliciaisEscalaQuery(db, escalaId)
			]);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'remover_policial_escala',
				alvo: { tipo: 'policial', id: alvo.policial_id, nome: nomeAlvo },
				detalhes: `Retirado do plantão de ${alvo.data_plantao}`,
				itens: 1,
				metadados: { item_id },
				dados_antes: {
					data_plantao: alvo.data_plantao,
					hora_entrada: alvo.hora_entrada,
					hora_saida: alvo.hora_saida
				}
			});

			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao remover policial' });
		}
	},

	/** Esvazia a escala (recomeçar o mês do zero). */
	removerTodos: async (event: Event) => {
		const { locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		try {
			// Contado ANTES: depois do delete não há como saber quantos saíram, e
			// "esvaziou a escala" sem o número não distingue uma linha de trinta.
			const antes = await listarPoliciaisEscala(db, escalaId);
			await db.delete(escalaPoliciais).where(eq(escalaPoliciais.escala_id, escalaId));

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'remover_policial_escala',
				alvo: { tipo: 'escala', id: escalaId, nome: escala.titulo },
				detalhes: `Escala esvaziada: ${antes.length} servidor(es) retirados de uma vez`,
				itens: antes.length,
				dados_antes: { policiais: antes.map((p) => p.policial_id) }
			});

			return { success: true, policiais: [] };
		} catch {
			return fail(500, { error: 'Erro ao remover todos os servidores' });
		}
	},

	/** Remove em lote as linhas marcadas na tabela. */
	removerSelecionados: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const idsJson = data.get('ids')?.toString() || '[]';
		let ids: number[];
		try {
			ids = JSON.parse(idsJson);
			if (!Array.isArray(ids) || ids.length === 0) throw new Error('empty');
		} catch {
			return fail(400, { error: 'IDs inválidos' });
		}

		// Lidos ANTES do delete: `ids` é o que o cliente PEDIU para remover, e o
		// que a trilha precisa dizer é o que realmente saiu — um id de outra escala
		// no corpo do formulário não conta, e o `WHERE` já o descarta.
		const alvos = await db
			.select({
				policial_id: escalaPoliciais.policial_id,
				data_plantao: escalaPoliciais.data_plantao
			})
			.from(escalaPoliciais)
			.where(and(eq(escalaPoliciais.escala_id, escalaId), inArray(escalaPoliciais.id, ids)))
			.all();

		try {
			const [, policiais] = await db.batch([
				db
					.delete(escalaPoliciais)
					.where(and(eq(escalaPoliciais.escala_id, escalaId), inArray(escalaPoliciais.id, ids))),
				listarPoliciaisEscalaQuery(db, escalaId)
			]);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'remover_policial_escala',
				alvo: { tipo: 'escala', id: escalaId, nome: escala.titulo },
				detalhes: `${alvos.length} linha(s) removidas em lote`,
				itens: alvos.length,
				metadados: { ids_pedidos: ids.length },
				dados_antes: {
					removidos: alvos.map((a) => ({
						policial_id: a.policial_id,
						data_plantao: a.data_plantao
					}))
				}
			});

			return { success: true, policiais, removidos: ids.length };
		} catch {
			return fail(500, { error: 'Erro ao remover servidores selecionados' });
		}
	}
};
