/**
 * Formulário de produtividade da GISE: o MODELO (quais perguntas existem) e as
 * RESPOSTAS de cada equipe.
 *
 * Três conceitos que se confundem facilmente:
 *
 * - **modelo** — árvore de perguntas em JSON, versionada em
 *   `gise_modelo_formulario` por `tipo` (`operacional` | `seint`) e editável
 *   pelo assessor. Se a linha não existir, valem as constantes DEFAULT deste
 *   arquivo;
 * - **respostas** — um blob JSON por equipe em `gise_respostas_formulario`,
 *   com chaves soltas (`{ km_inicial: '10', drogas_detalhe: {...} }`). Não há
 *   FK entre resposta e pergunta: o casamento é por `key`, em tempo de leitura;
 * - **relatório** — a versão achatada `(pergunta, resposta)` que
 *   `buscarRespostasProdutividadeSeccional` produz para o PDF/XLSX.
 *
 * Consequência prática: modelo e respostas evoluem em ritmos diferentes. Uma
 * resposta gravada em janeiro é lida com o modelo de hoje, então toda leitura é
 * tolerante (chave ausente = pergunta some do relatório, nunca quebra) e o
 * parse do blob usa a variante *loose* do schema.
 */
import { eq, and, desc, sql, inArray, type SQL } from 'drizzle-orm';
import {
	giseEscalas,
	giseSeccionais,
	giseSeccionalUnidades,
	giseEquipes,
	giseMembros,
	giseModeloFormulario,
	giseRespostasFormulario,
	unidades
} from '../../server/schema';
import type { Database } from '../core';
import {
	DEFAULT_QUESTIONS,
	DEFAULT_SEINT_QUESTIONS,
	type PerguntaModelo
} from './respostas-modelo-padrao';

import { logger } from '../../server/logger';

import { parseRespostasFormularioJsonLoose } from '../../schemas/gise-respostas-form';
import { TIPO_LISTA_REUTILIZAVEL, chavesLista, chavesProporcao } from '../../gise/tipos-pergunta';

// ---- Formulário de Produtividade ----
/**
 * Achata as respostas de TODAS as equipes de uma seccional em uma lista
 * `(equipe_id, pergunta, resposta)` — o formato que o PDF e o XLSX de
 * produtividade consomem, linha a linha.
 *
 * Regras de tradução do blob para linhas, todas deliberadas:
 *
 * - **Pergunta some se não houver resposta.** `undefined`, `null` e `''` não
 *   viram linha; o relatório mostra o que foi feito, não o que ficou em branco.
 * - **Detalhe só aparece sob um "sim".** Trocar a resposta para "não" na tela
 *   não apaga as listas já digitadas no blob; expandir independentemente do
 *   pai faria o relatório declarar apreensões que a equipe negou. `filhos`
 *   segue a mesma regra — subpergunta de um "não" nem é visitada. A exceção é
 *   `operacoes_seint_pura`, que não tem pai sim/não: sua lista é sempre
 *   expandida.
 * - **Detalhe vem de chave FIXA, não da `key` da pergunta.** Os widgets
 *   complexos sempre gravam em `mandados_lista`, `armas_detalhe`,
 *   `drogas_selecionadas` etc., independentemente de onde a pergunta esteja no
 *   modelo. Por isso o `if` por `p.tipo` + chave literal, em vez de derivar de
 *   `p.key`: renomear a pergunta no editor não pode perder o detalhe já gravado.
 * - **`  ↳` é indentação visual**, não markup — o relatório é uma tabela plana
 *   de duas colunas e essa é a única forma de mostrar aninhamento nela.
 *
 * O modelo aplicado é o customizado da seccional (por `equipe_tipo`) e, na
 * falta dele, o DEFAULT do tipo. Aqui usa-se `DEFAULT_QUESTIONS` (rótulos
 * curtos), não a variante de formulário.
 *
 * Modelo com JSON corrompido é registrado e IGNORADO — a equipe cai no default
 * em vez de derrubar a geração do relatório inteiro.
 */
export async function buscarRespostasProdutividadeSeccional(
	db: Database,
	giseId: number,
	seccionalId: number
) {
	const [configRows, rows] = await Promise.all([
		db.select().from(giseModeloFormulario).all(),
		db
			.select({
				equipe_id: giseRespostasFormulario.equipe_id,
				respostas: giseRespostasFormulario.respostas,
				equipe_tipo: giseEquipes.tipo
			})
			.from(giseRespostasFormulario)
			.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
			.where(
				and(
					eq(giseRespostasFormulario.gise_id, giseId),
					eq(giseEquipes.gise_seccional_id, seccionalId)
				)
			)
			.all()
	]);
	const modelosMap = new Map<string, PerguntaModelo[]>();
	configRows.forEach((row) => {
		try {
			modelosMap.set(row.tipo, JSON.parse(row.config));
		} catch (err) {
			logger.error('[gise] parse modelo formulário', { tipo: row.tipo, err: String(err) });
		}
	});

	const allResults: { equipe_id: number; pergunta: string; resposta: string }[] = [];

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- resps is a dynamic untyped JSON blob; narrowing every access would change logic
	const processarPerguntas = (listaPerguntas: PerguntaModelo[], resps: any, eqId: number) => {
		for (const p of listaPerguntas) {
			// Cobertura grava em DUAS chaves derivadas e nada em `p.key`, então o
			// lookup padrão abaixo não a encontraria — a pergunta simplesmente sumiria
			// do relatório assinado, sem erro nenhum. Vira uma linha só, com a razão
			// já resolvida: é assim que ela se lê no papel.
			const chavesP = chavesProporcao(p);
			if (chavesP) {
				const total = Number(resps[chavesP.total]);
				const parte = Number(resps[chavesP.parte]);
				if (Number.isFinite(total) && Number.isFinite(parte)) {
					const cobertura =
						total > 0
							? ` (${((parte / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)`
							: '';
					allResults.push({
						equipe_id: eqId,
						pergunta: p.texto,
						resposta: `${parte} de ${total}${cobertura}`
					});
				}
				if (p.filhos?.length) processarPerguntas(p.filhos, resps, eqId);
				continue;
			}

			// Três tentativas de lookup por compatibilidade: blobs antigos indexavam
			// a resposta pelo ID da pergunta (como string ou como número); os atuais
			// usam a `key`. Ler pelas três mantém legível o histórico já gravado.
			const resp = resps[p.key] ?? resps[String(p.id)] ?? resps[p.id];
			if (resp !== undefined && resp !== null && resp !== '') {
				allResults.push({ equipe_id: eqId, pergunta: p.texto, resposta: String(resp) });

				const isSim = String(resp).toLowerCase() === 'sim' || resp === true;

				if (isSim || p.tipo === 'operacoes_seint_pura') {
					if (p.tipo === 'mandados_maiores' && resps.mandados_lista) {
						(resps.mandados_lista as { nome?: string; mandado?: string }[]).forEach((item, idx) => {
							if (item.nome || item.mandado) {
								allResults.push({
									equipe_id: eqId,
									pergunta: `  ↳ Mandado ${idx + 1}`,
									resposta: `${item.nome} - ${item.mandado}`
								});
							}
						});
					}
					// Tipo REUTILIZÁVEL: a lista dele não tem chave fixa — sai da `key`
					// da pergunta (`chavesLista`), que é o que permite haver várias no
					// mesmo formulário sem uma sobrescrever a outra.
					//
					// O rótulo da linha vem da pergunta (`subtexto_item`) porque o tipo
					// não sabe do que a lista é. Os tipos de chave fixa traziam o nome
					// embutido ("Procedimento", "Mandado", "Apreensão"); o genérico serve
					// a qualquer pergunta, e sem este campo ele não teria como substituir
					// os três no PDF assinado. Vazio cai em "Item", que é o que ele
					// sempre usou — relatório antigo sai idêntico.
					if (p.tipo === TIPO_LISTA_REUTILIZAVEL) {
						const lista = resps[chavesLista(p)!.lista];
						const rotulo = p.subtexto_item?.trim() || 'Item';
						if (Array.isArray(lista)) {
							(lista as { nome?: string; mandado?: string }[]).forEach((item, idx) => {
								if (item.nome || item.mandado) {
									allResults.push({
										equipe_id: eqId,
										pergunta: `  ↳ ${rotulo} ${idx + 1}`,
										resposta: `${item.nome} - ${item.mandado}`
									});
								}
							});
						}
					}
					if (p.tipo === 'prisoes_maiores' && resps.prisoes_lista) {
						(resps.prisoes_lista as { nome?: string; mandado?: string }[]).forEach((item, idx) => {
							if (item.nome || item.mandado) {
								allResults.push({
									equipe_id: eqId,
									pergunta: `  ↳ Procedimento ${idx + 1}`,
									resposta: `${item.nome} - ${item.mandado}`
								});
							}
						});
					}
					if (p.tipo === 'armas_complex' && resps.armas_detalhe) {
						Object.entries(resps.armas_detalhe).forEach(([tipo, qtd]) => {
							if (Number(qtd) > 0) {
								allResults.push({
									equipe_id: eqId,
									pergunta: `  ↳ Arma: ${tipo}`,
									resposta: `${qtd}`
								});
							}
						});
					}
					if (p.tipo === 'apreensoes_menores' && resps.apreensoes_lista) {
						(resps.apreensoes_lista as { nome?: string; mandado?: string }[]).forEach(
							(item, idx) => {
								if (item.nome || item.mandado) {
									allResults.push({
										equipe_id: eqId,
										pergunta: `  ↳ Apreensão ${idx + 1}`,
										resposta: `${item.nome} - ${item.mandado}`
									});
								}
							}
						);
					}
					if (p.tipo === 'drogas_complex' && resps.drogas_selecionadas) {
						resps.drogas_selecionadas.forEach((d: string) => {
							const peso = resps.drogas_detalhe?.[d] || '0';
							const unid = resps.drogas_unidade?.[d] || 'g';
							allResults.push({
								equipe_id: eqId,
								pergunta: `  ↳ Droga: ${d}`,
								resposta: `${peso}${unid}`
							});
						});
					}
					// SEINT Complex Types
					if (p.tipo === 'celulares_complex' && resps.celulares_lista) {
						(resps.celulares_lista as { modelo?: string; n_proc?: string }[]).forEach(
							(item, idx) => {
								if (item.modelo || item.n_proc) {
									allResults.push({
										equipe_id: eqId,
										pergunta: `  ↳ Aparelho ${idx + 1}`,
										resposta:
											`${item.modelo || ''} ${item.n_proc ? '(Proc: ' + item.n_proc + ')' : ''}`.trim()
									});
								}
							}
						);
					}
					if (p.tipo === 'analise_complex' && resps.analise_lista) {
						(
							resps.analise_lista as { modelo?: string; n_proc?: string; tamanho?: string }[]
						).forEach((item, idx) => {
							if (item.modelo || item.n_proc) {
								allResults.push({
									equipe_id: eqId,
									pergunta: `  ↳ Análise ${idx + 1}`,
									resposta:
										`${item.modelo || ''} ${item.tamanho ? '[' + item.tamanho + ']' : ''} ${item.n_proc ? '(Proc: ' + item.n_proc + ')' : ''}`.trim()
								});
							}
						});
					}
					if (p.tipo === 'relatorios_seint_complex' && resps.relatorios_seint_lista) {
						(resps.relatorios_seint_lista as { n_relat?: string; q_alvos?: string }[]).forEach(
							(item, idx) => {
								if (item.n_relat || item.q_alvos) {
									allResults.push({
										equipe_id: eqId,
										pergunta: `  ↳ Relatório ${idx + 1}`,
										resposta:
											`${item.n_relat || ''} ${item.q_alvos ? '(' + item.q_alvos + ' alvos)' : ''}`.trim()
									});
								}
							}
						);
					}
					if (p.tipo === 'foragidos_complex' && resps.foragidos_lista) {
						(resps.foragidos_lista as { nome?: string; resultado?: string }[]).forEach(
							(item, idx) => {
								if (item.nome || item.resultado) {
									allResults.push({
										equipe_id: eqId,
										pergunta: `  ↳ Alvo ${idx + 1}`,
										resposta: `${item.nome || ''} - Status: ${item.resultado || 'N/I'}`.trim()
									});
								}
							}
						);
					}
					if (
						(p.tipo === 'operacoes_seint_complex' || p.tipo === 'operacoes_seint_pura') &&
						resps.operacoes_seint_lista
					) {
						(resps.operacoes_seint_lista as { nome?: string; delegacia?: string }[]).forEach(
							(item, idx) => {
								if (item.nome || item.delegacia) {
									allResults.push({
										equipe_id: eqId,
										pergunta: `  ↳ Operação ${idx + 1}`,
										resposta: `${item.nome || ''} (${item.delegacia || ''})`.trim()
									});
								}
							}
						);
					}

					if (p.filhos && p.filhos.length > 0) {
						processarPerguntas(p.filhos, resps, eqId);
					}
				}
			}
		}
	};

	for (const r of rows) {
		const resps = parseRespostasFormularioJsonLoose(r.respostas) as Record<string, unknown>;

		const modeloPerguntas =
			modelosMap.get(r.equipe_tipo) ||
			(r.equipe_tipo === 'seint' ? DEFAULT_SEINT_QUESTIONS : DEFAULT_QUESTIONS);

		processarPerguntas(modeloPerguntas, resps, r.equipe_id!);
	}

	return allResults;
}

/**
 * Modelo customizado de UMA operação, no tipo de equipe pedido — ou `undefined`
 * se nunca foi salvo (o chamador cai no DEFAULT correspondente).
 *
 * `operacaoId` é obrigatório e sem valor padrão de propósito. Um default
 * silencioso aqui faria uma tela nova ler "o modelo global" por esquecimento, e
 * o sintoma seria o formulário da CRAJUBAR aparecendo com as perguntas do GISE —
 * sem erro nenhum.
 *
 * Devolve `null` em caso de FALHA de query em vez de propagar: o modelo é
 * enfeite comparado ao resto da página — quebrar o `load` inteiro porque a
 * customização não pôde ser lida seria pior do que exibir o formulário padrão.
 */
export async function buscarGiseModeloFormulario(
	db: Database,
	operacaoId: number,
	tipo: 'operacional' | 'seint' = 'operacional'
) {
	try {
		return db
			.select()
			.from(giseModeloFormulario)
			.where(
				and(eq(giseModeloFormulario.operacao_id, operacaoId), eq(giseModeloFormulario.tipo, tipo))
			)
			.get();
	} catch (err) {
		logger.error('[buscarGiseModeloFormulario] falha na query', {
			operacaoId,
			tipo,
			err: String(err)
		});
		return null;
	}
}

/**
 * Grava o modelo de uma operação (upsert manual: uma linha por `operação` ×
 * `tipo`, imposta pelo índice `uq_gise_modelo_operacao_tipo`). `config` é o JSON
 * da árvore de perguntas, já validado pelo chamador.
 *
 * Substitui o modelo INTEIRO: as respostas antigas continuam no banco com as
 * `key` velhas e simplesmente deixam de aparecer no relatório se a `key` sumir
 * do modelo. É o preço de guardar resposta como blob — trocar a `key` de uma
 * pergunta é, na prática, apagá-la do histórico.
 *
 * O que existe de versionamento é UM nível: o `config` vigente é copiado para
 * `config_anterior` antes de ser sobrescrito, alimentando o "Restaurar
 * anterior" do editor. Gravar o MESMO conteúdo não mexe no anterior — senão
 * salvar duas vezes seguidas sem editar nada destruiria o ponto de retorno.
 * O par vigente/anterior é POR OPERAÇÃO: editar a CRAJUBAR não consome o
 * desfazer do GISE.
 */
export async function salvarGiseModeloFormulario(
	db: Database,
	operacaoId: number,
	tipo: 'operacional' | 'seint',
	config: string
) {
	const existente = await db
		.select({ id: giseModeloFormulario.id, config: giseModeloFormulario.config })
		.from(giseModeloFormulario)
		.where(
			and(eq(giseModeloFormulario.operacao_id, operacaoId), eq(giseModeloFormulario.tipo, tipo))
		)
		.get();

	if (existente) {
		const semMudanca = existente.config === config;
		return db
			.update(giseModeloFormulario)
			.set({
				config,
				...(semMudanca ? {} : { config_anterior: existente.config }),
				updated_at: sql`datetime('now', '-3 hours')`
			})
			.where(eq(giseModeloFormulario.id, existente.id));
	}

	return db.insert(giseModeloFormulario).values({
		operacao_id: operacaoId,
		tipo,
		config,
		updated_at: sql`datetime('now', '-3 hours')`
	});
}

/**
 * Grava a ordem dos cards do painel de produtividade desta (operação, tipo) —
 * o array JSON de ids que o Admin Geral montou arrastando em `/operacoes/produtividade`.
 *
 * Escreve SÓ a coluna `painel_ordem`, deliberadamente:
 *
 * - o `config` não é tocado, então organizar o painel não renumera pergunta nem
 *   reordena o formulário que o policial preenche. Era exatamente isso que a
 *   ordem própria existe para evitar (migração 0064);
 * - o `config_anterior` também não. Ele é o desfazer do EDITOR DE PERGUNTAS, e
 *   consumi-lo aqui faria arrastar um card destruir o ponto de retorno de quem
 *   estava editando o formulário em outra aba.
 *
 * Modelo inexistente para o par (operação, tipo) é no-op silencioso, não erro: a
 * operação pode ter o tipo habilitado sem nunca ter tido formulário salvo, e
 * nesse caso não há card nenhum no painel — não há ordem que se perca. Inserir
 * uma linha aqui criaria um modelo VAZIO que o editor mostraria como formulário
 * apagado.
 *
 * @returns `true` se a linha foi atualizada; `false` quando não há modelo.
 */
export async function salvarOrdemPainelProdutividade(
	db: Database,
	operacaoId: number,
	tipo: 'operacional' | 'seint',
	ordem: string[]
): Promise<boolean> {
	const existente = await db
		.select({ id: giseModeloFormulario.id })
		.from(giseModeloFormulario)
		.where(
			and(eq(giseModeloFormulario.operacao_id, operacaoId), eq(giseModeloFormulario.tipo, tipo))
		)
		.get();

	if (!existente) return false;

	await db
		.update(giseModeloFormulario)
		.set({
			painel_ordem: JSON.stringify(ordem),
			updated_at: sql`datetime('now', '-3 hours')`
		})
		.where(eq(giseModeloFormulario.id, existente.id));
	return true;
}

// ---- Respostas ----

/**
 * Resposta já gravada de uma equipe nesta GISE, para reabrir o formulário
 * preenchido. Resolve o alvo nesta ordem:
 *
 *   1. `equipeId` explícito — o caminho normal; a UI sempre manda qual equipe
 *      está sendo preenchida (o policial pode compor equipes diferentes);
 *   2. a equipe do policial em `gise_membros` — fallback para quando a tela
 *      abre sem `equipeId` na URL. Cuidado: `gise_membros` não guarda
 *      `gise_id`, então esse lookup pega uma membresia QUALQUER do policial. Se
 *      ele participou de mais de uma GISE, a equipe encontrada pode ser de
 *      outra e o filtro por `gise_id` devolve vazio — daí os chamadores
 *      passarem `equipeId` em vez de confiar neste ramo;
 *   3. sem equipe alguma, procura pela resposta individual (`policial_id`),
 *      formato das GISEs antigas, anteriores às equipes.
 */
export async function buscarRespostaGise(
	db: Database,
	giseId: number,
	policialId: number | null,
	equipeId?: number
) {
	let targetEquipeId = equipeId;

	if (!targetEquipeId && policialId) {
		const meuMembro = await db
			.select({ equipe_id: giseMembros.equipe_id })
			.from(giseMembros)
			.where(eq(giseMembros.policial_id, policialId))
			.get();
		if (meuMembro) targetEquipeId = meuMembro.equipe_id;
	}

	if (targetEquipeId) {
		return db
			.select()
			.from(giseRespostasFormulario)
			.where(
				and(
					eq(giseRespostasFormulario.gise_id, giseId),
					eq(giseRespostasFormulario.equipe_id, targetEquipeId)
				)
			)
			.get();
	} else if (policialId) {
		return db
			.select()
			.from(giseRespostasFormulario)
			.where(
				and(
					eq(giseRespostasFormulario.gise_id, giseId),
					eq(giseRespostasFormulario.policial_id, policialId)
				)
			)
			.get();
	}

	return null;
}

/**
 * Salva o formulário da equipe — UPDATE se já existir resposta (mesma regra de
 * resolução de `buscarRespostaGise`), INSERT caso contrário.
 *
 * `respostas` chega como STRING JSON já validada pelo chamador; esta camada não
 * inspeciona o conteúdo. `policial_id` grava quem enviou por último, mas a
 * resposta pertence à EQUIPE: outro membro que salvar depois sobrescreve o
 * mesmo registro, por desenho — o relatório é da equipe, não de cada policial.
 */
export async function salvarRespostaGise(
	db: Database,
	giseId: number,
	policialId: number,
	respostas: string,
	equipeId?: number
) {
	const existente = await buscarRespostaGise(db, giseId, policialId, equipeId);

	if (existente) {
		const targetId = existente.id;
		return db
			.update(giseRespostasFormulario)
			.set({ respostas, updated_at: sql`datetime('now', '-3 hours')` })
			.where(eq(giseRespostasFormulario.id, targetId));
	}

	return db.insert(giseRespostasFormulario).values({
		gise_id: giseId,
		policial_id: policialId,
		equipe_id: equipeId ?? null,
		respostas,
		updated_at: sql`datetime('now', '-3 hours')`
	});
}

/**
 * Todas as respostas do sistema, paginadas, com a GISE, a seccional e o tipo de
 * equipe já resolvidos — a base do painel de produtividade, que agrega os blobs
 * em memória.
 *
 * Detalhes que o chamador precisa saber:
 * - os `innerJoin` fazem esta consulta ignorar respostas sem equipe (o formato
 *   individual antigo) e respostas cuja seccional não casa com uma unidade;
 * - `inicio`/`fim` recortam pela `data_inicio` da GISE, não pelo `updated_at`
 *   da resposta: o que interessa é o período do SERVIÇO, não quando alguém
 *   preencheu. Os dois são inclusivos, e omitir um deixa aquele lado aberto;
 * - `limit` é limitado a 500 por página. O painel pagina em laço até esgotar,
 *   então mudar esse teto muda o número de idas ao banco, não o resultado;
 * - `operacaoId` recorta à operação (os indicadores e as metas são dela);
 * - `unidadeIds` é o ESCOPO do admin de unidade/seccional, e é filtro de
 *   SERVIDOR. Lista vazia significa "nenhuma unidade" e devolve zero linhas —
 *   nunca "sem filtro". Casa pela mesma cadeia de precedência que resolve a
 *   unidade de uma equipe: slot → unidade operacional → seccional;
 * - `totalConhecido` pula o `count(*)`. Ver o parâmetro.
 */
export async function listarTodasRespostasGise(
	db: Database,
	opts?: {
		page?: number;
		limit?: number;
		/** Início da janela, `YYYY-MM-DD` inclusivo. Sem ele, não há piso. */
		inicio?: string;
		/** Fim da janela, `YYYY-MM-DD` inclusivo. Sem ele, não há teto. */
		fim?: string;
		operacaoId?: number;
		unidadeIds?: number[];
		/**
		 * Total já sabido para ESTE mesmo filtro — pula o `count(*)`.
		 *
		 * O painel de produtividade lê a página 1, descobre `totalPages` e busca
		 * as demais em paralelo. Sem isto, cada uma dessas chamadas refaz um
		 * `count(*)` sobre a junção de cinco tabelas para chegar ao número que a
		 * página 1 já devolveu: seis páginas custavam doze consultas, seis delas
		 * idênticas e descartadas.
		 *
		 * Só passe o total obtido com os MESMOS `inicio`/`fim`/`operacaoId`/
		 * `unidadeIds`. Um total de outro filtro não erra a página devolvida (o
		 * `WHERE` é o que recorta), mas mente no `total`/`totalPages`.
		 *
		 * Não relaxa consistência: contar uma vez e paginar é MAIS coerente que
		 * contar de novo a cada página, que já podia devolver números diferentes
		 * entre si se uma escrita caísse no meio do laço.
		 */
		totalConhecido?: number;
	}
): Promise<{
	respostas: Array<{
		id: number;
		gise_id: number;
		policial_id: number;
		respostas: string;
		updated_at: string;
		data_inicio: string;
		seccional_id: number;
		seccional_nome: string;
		equipe_id: number;
		equipe_tipo: string;
		operacao_id: number | null;
		unidade_id: number | null;
	}>;
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const page = Math.max(1, opts?.page ?? 1);
	const limit = Math.min(500, Math.max(1, opts?.limit ?? 200));
	const offset = (page - 1) * limit;

	// A unidade da equipe, na mesma precedência de toda a aplicação: o slot é o
	// nível mais específico (é ele que distingue Crato de Barbalha dentro da 2ª
	// Seccional), depois a unidade operacional, e por fim a própria seccional.
	const unidadeDaEquipe = sql<number>`COALESCE(
		${giseSeccionalUnidades.unidade_id},
		${giseSeccionais.unidade_operacional_id},
		${giseSeccionais.seccional_id}
	)`;

	// Build dynamic conditions
	const conditions: SQL[] = [];
	// Janela por INTERVALO, não por `strftime`. Duas razões, e a segunda é a que
	// motivou a troca (B-1):
	//
	//  - `strftime('%Y', data_inicio) = '2026'` é função sobre a coluna, e função
	//    sobre coluna anula o índice. É a mesma lição que `verificarEscalaExistente`
	//    já carrega escrita: lá a comparação mensal virou intervalo justamente
	//    "para que o índice de `data_inicio` seja usado".
	//  - Ano e mês não expressam a janela que a tela oferece. O filtro de
	//    produtividade tem modo `personalizado`, com date pickers livres que
	//    podem cruzar anos; `ano` recortaria ao ano e o usuário veria menos do
	//    que pediu, sem erro nenhum.
	//
	// `data_inicio` é TEXT em `YYYY-MM-DD`, então a comparação lexicográfica é a
	// cronológica — o mesmo contrato que o resto do projeto usa em coluna de data.
	if (opts?.inicio) {
		conditions.push(sql`${giseEscalas.data_inicio} >= ${opts.inicio}`);
	}
	if (opts?.fim) {
		conditions.push(sql`${giseEscalas.data_inicio} <= ${opts.fim}`);
	}
	if (opts?.operacaoId != null) {
		conditions.push(sql`${giseEscalas.operacao_id} = ${opts.operacaoId}`);
	}
	if (opts?.unidadeIds) {
		// Lista VAZIA = nenhuma unidade permitida, e o predicado tem de refletir
		// isso. `IN ()` é SQL inválido, e omitir a condição devolveria TUDO — o
		// oposto exato do que "escopo vazio" significa, num filtro que existe para
		// impedir um admin de ver a produtividade de outra unidade.
		conditions.push(
			opts.unidadeIds.length === 0 ? sql`1 = 0` : inArray(unidadeDaEquipe, opts.unidadeIds)
		);
	}
	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	// Count total — pulado quando o chamador já sabe o total deste mesmo filtro
	// (ver `totalConhecido`). É a consulta cara do par: a mesma junção de cinco
	// tabelas da página, sem `LIMIT` para recortá-la.
	let total: number;
	if (opts?.totalConhecido !== undefined) {
		total = opts.totalConhecido;
	} else {
		const countResult = await db
			.select({ count: sql<number>`count(*)` })
			.from(giseRespostasFormulario)
			.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			// LEFT: equipe legada pode não ter slot. O join precisa estar aqui também,
			// e não só no SELECT, porque `unidadeDaEquipe` participa do WHERE — sem ele
			// a contagem e a página divergiriam e a paginação perderia linhas.
			.leftJoin(giseSeccionalUnidades, eq(giseEquipes.gise_unidade_id, giseSeccionalUnidades.id))
			.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
			.where(whereClause)
			.get();
		total = Number(countResult?.count ?? 0);
	}
	const totalPages = Math.ceil(total / limit);

	const resultados = await db
		.select({
			id: giseRespostasFormulario.id,
			gise_id: giseRespostasFormulario.gise_id,
			policial_id: giseRespostasFormulario.policial_id,
			respostas: giseRespostasFormulario.respostas,
			updated_at: giseRespostasFormulario.updated_at,
			data_inicio: giseEscalas.data_inicio,
			seccional_id: giseSeccionais.seccional_id,
			seccional_nome: unidades.nome,
			equipe_id: giseEquipes.id,
			equipe_tipo: giseEquipes.tipo,
			operacao_id: giseEscalas.operacao_id,
			unidade_id: unidadeDaEquipe
		})
		.from(giseRespostasFormulario)
		.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.leftJoin(giseSeccionalUnidades, eq(giseEquipes.gise_unidade_id, giseSeccionalUnidades.id))
		.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(whereClause)
		.orderBy(desc(giseEscalas.data_inicio))
		.limit(limit)
		.offset(offset);

	return { respostas: resultados, total, page, limit, totalPages };
}

export type GiseRespostaListagemItem = Awaited<
	ReturnType<typeof listarTodasRespostasGise>
>['respostas'][number];
