/**
 * `POST /api/webhook/sync-policiais` — espelha a folha de pessoal vinda do
 * sistema institucional (mesmo emissor de `sync-unidades`).
 *
 * Aceita objeto único ou array, e processa item a item: um registro inválido
 * NÃO aborta o lote. O retorno traz `successCount` + a lista de erros por
 * linha, porque uma matrícula com cargo errado no meio de sete mil não pode
 * impedir a sincronização das outras.
 *
 * Três defesas, nesta ordem:
 *   1. HMAC/Bearer (`validarWebhookSync`);
 *   2. anti-replay (timestamp + nonce), DEPOIS do HMAC — não se gasta D1 com
 *      payload não autenticado;
 *   3. **safe-default de PAPEL (M-4)**: o sync não altera `papel` nem
 *      `papel_unidade_id` a menos que `WEBHOOK_ALLOW_PAPEL_CHANGES` esteja
 *      ligado. Sem isso, um SYNC_TOKEN comprometido promoveria qualquer
 *      matrícula a admin. Tentativa de trocar papel com a flag desligada é
 *      registrada em log para perícia.
 *
 * O upsert é por MATRÍCULA e preserva o que a fonte externa não é dona:
 * senha, `primeiro_acesso` e contatos já cadastrados (ver `upsertPolicial`).
 *
 * Fase 2-C: a linha pode trazer o COMPLEMENTO da planilha de pessoal
 * (`$lib/schemas/carga-planilha`): cargo anterior, nascimento, posse,
 * designação e o evento de afastamento — aplicados por
 * `$lib/db/policiais/carga-planilha` depois do upsert. Designação de titular
 * (Delegado Titular/Seccional, Diretor) grava o responsável pela unidade.
 * O que não pôde ser aplicado sem ser erro (titular já cadastrado pela tela)
 * volta em `warnings`.
 */
import type { RequestHandler } from './$types';
import { linhaVazia, respostaDeSync } from '$lib/server/sync/resultado';
import { getDB, auditar, contextoDeEvento } from '$lib/db';
import { upsertPolicial, buscarPolicialPorMatricula } from '$lib/db/policiais';
import {
	DESIGNACOES_DE_TITULAR,
	idDaDesignacao,
	regravarAfastamentosLegados,
	regravarHistoricoDaPlanilha,
	regravarTitularDaPlanilha
} from '$lib/db/policiais/carga-planilha';
import { complementoDaPlanilhaSchema, temComplemento } from '$lib/schemas/carga-planilha';
import { hojeBrasilISO } from '$lib/utils/datas';
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';
import {
	validarWebhookSync,
	validarReplayProtection,
	replayEnforceLigado,
	logFaltaReplayHeaders
} from '$lib/server/auth/webhook-auth';
import { logger } from '$lib/server/logger';
import { apiError, ErrorCode, unauthorized } from '$lib/server/api';
import { mensagemDeErro } from '$lib/utils/erro';

/**
 * Safe-default contra escalada de privilégio via webhook (M-4 da auditoria):
 * o sync NÃO altera `papel`/`papel_unidade_id` a menos que
 * `WEBHOOK_ALLOW_PAPEL_CHANGES` esteja explicitamente ligado. Sem isso,
 * SYNC_TOKEN comprometido só consegue editar dados não-privilegiados
 * (nome, matrícula, lotação, e-mail, etc.) — não consegue promover ninguém
 * a admin_seccional/admin_unidade. O caminho legítimo permanece sendo o
 * endpoint dedicado `salvarPapel` em /servidores/[id] (Admin Geral via UI).
 */
function papelChangesAllowed(
	env: Pick<Env, 'WEBHOOK_ALLOW_PAPEL_CHANGES'> | null | undefined
): boolean {
	const raw = env?.WEBHOOK_ALLOW_PAPEL_CHANGES;
	if (typeof raw !== 'string') return false;
	const v = raw.trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export const POST: RequestHandler = async (event) => {
	const { request, platform, getClientAddress } = event;
	const env = platform?.env as Env | undefined;
	const SYNC_TOKEN = env?.SYNC_TOKEN;
	const rawBody = await request.text();
	const auth = await validarWebhookSync(SYNC_TOKEN, request, rawBody);
	if (!auth.ok) {
		logger.warn('[sync-policiais] auth rejeitada', {
			ip: getClientAddress(),
			reason: auth.reason
		});
		return unauthorized();
	}

	// Replay protection (P1.3): roda APÓS HMAC para não gastar D1 com payloads
	// não autenticados. Headers ausentes → comportamento controlado pela env
	// WEBHOOK_REPLAY_ENFORCE (rollout staged: log only → enforce).
	const replay = await validarReplayProtection(getDB(platform), request);
	if (!replay.ok) {
		const ctx = { ip: getClientAddress(), reason: replay.reason };
		if (replay.reason === 'missing-headers' && !replayEnforceLigado(env)) {
			logFaltaReplayHeaders('sync-policiais', ctx, import.meta.env.PROD);
		} else {
			logger.warn('[sync-policiais] replay protection rejeitou', ctx);
			return unauthorized();
		}
	}

	try {
		const payload = JSON.parse(rawBody);
		const db = getDB(platform);
		const papelLiberado = papelChangesAllowed(env);

		// O payload pode ser um objeto (linha única) ou um array (bulk)
		const data = Array.isArray(payload) ? payload : [payload];
		let successCount = 0;
		let vazias = 0;
		const errors: string[] = [];
		const avisos: string[] = [];
		const hoje = hojeBrasilISO();
		let historicoGravado = 0;
		let historicoRepetido = 0;

		for (const item of data) {
			const rowId = item.matricula || item.nome || 'Linha desconhecida';
			try {
				// Linha em branco no fim da faixa da planilha: descarte legítimo, e o
				// contador a expõe. Linha com ALGUM dado e sem matrícula/nome é outra
				// coisa — alguém digitou ali esperando ver o registro importado, e o
				// `continue` silencioso fazia a sincronização "dar certo" sem ele
				// (FLW-WEBHOOK-002).
				if (linhaVazia(item as Record<string, unknown>)) {
					vazias++;
					continue;
				}
				if (!item.matricula || String(item.matricula).trim() === '') {
					throw new Error('Linha sem matrícula');
				}
				// Só histórico (planilha de histórico, fase 2-C): NÃO faz upsert — a
				// planilha traz nome e cargo antigos — e exige que a matrícula exista.
				if (item.somente_historico === true) {
					const alvo = await buscarPolicialPorMatricula(db, String(item.matricula));
					if (!alvo)
						throw new Error('Matrícula não cadastrada; histórico exige servidor existente');
					const so = complementoDaPlanilhaSchema.parse(item);
					const r = await regravarHistoricoDaPlanilha(
						db,
						alvo.id,
						so.historico ?? [],
						'planilha de histórico'
					);
					historicoGravado += r.gravados;
					historicoRepetido += r.repetidos;
					successCount++;
					continue;
				}
				if (!item.nome || String(item.nome).trim() === '') {
					throw new Error('Linha sem nome');
				}

				const cargo = String(item.cargo || '')
					.toUpperCase()
					.trim();
				if (!['DPC', 'OIP'].includes(cargo)) {
					throw new Error(`Cargo inválido: "${cargo}". Use DPC ou OIP.`);
				}

				// Normalização de telefone: Pega apenas o primeiro número se houver vários
				let telefoneMap = String(item.telefone || '').trim();
				const phoneMatch = telefoneMap.match(/\(?\d{2}\)?\s?\d{4,5}-?\d{4}/);
				if (phoneMatch) {
					telefoneMap = phoneMatch[0];
				} else if (telefoneMap.length > 15) {
					// Fallback: se não deu match mas é longo, pega os primeiros 15 caracteres
					telefoneMap = telefoneMap.substring(0, 15).trim();
				}

				// FLW-AUT-005: NÃO forçar ativo=1 em todo sync — desativação
				// disciplinar no UI durava só até a próxima folha. Novos ficam
				// ativos; existentes preservam o `ativo` já gravado (omitido no
				// upsert = coluna intocada).
				const existente = await buscarPolicialPorMatricula(db, String(item.matricula).trim());

				// Complemento da planilha de pessoal (fase 2-C): validado antes do
				// upsert para a linha falhar inteira, não pela metade.
				const complemento = temComplemento(item as Record<string, unknown>)
					? complementoDaPlanilhaSchema.parse(item)
					: null;
				const designacaoId =
					complemento?.designacao !== undefined
						? await idDaDesignacao(db, complemento.designacao)
						: undefined;
				const regimeMap = item.regime?.toLowerCase() === 'expediente' ? 'expediente' : 'plantao';

				let papelMap: string | null = null;
				let papelUnidadeId: number | null = null;
				const lotacaoMap = String(item.lotacao || '').trim();

				if (papelLiberado) {
					// Modo legado/explícito: planilha é canônica também para papel.
					const papelLower = item.papel?.toLowerCase() || '';
					if (papelLower.includes('seccional')) papelMap = 'admin_seccional';
					else if (papelLower.includes('unidade')) papelMap = 'admin_unidade';
					// Admin Geral NÃO vem pela planilha: é uma conta vinculada em
					// `administradores`, concedida manualmente em /servidores/[id].

					if (papelMap) {
						const papelUnidadeNome = String(item.papel_unidade || lotacaoMap).trim();
						if (!papelUnidadeNome) {
							throw new Error('Papel administrativo informado sem lotação/unidade de exercício.');
						}
						const unidade = await db
							.select({ id: unidades.id })
							.from(unidades)
							.where(eq(unidades.nome, papelUnidadeNome))
							.get();
						if (!unidade) {
							throw new Error(
								`Unidade de exercício do papel não encontrada: "${papelUnidadeNome}". ` +
									'Garanta que a lotação exista em DB_UNIDADES e esteja sincronizada.'
							);
						}
						papelUnidadeId = unidade.id;
					}
				} else {
					// Safe-default (M-4): preserva o `papel`/`papel_unidade_id` atual.
					// Se o registro existe, lê do DB; se não existe, fica null. Sem isto,
					// SYNC_TOKEN comprometido conseguia promover qualquer matrícula a admin.
					const atual = await buscarPolicialPorMatricula(db, String(item.matricula));
					if (atual) {
						papelMap = atual.papel ?? null;
						papelUnidadeId = atual.papel_unidade_id ?? null;
					}
					// Se o payload TENTOU trocar papel, registra para forense.
					const payloadTentaTrocar =
						(item.papel || item.papel_unidade) &&
						(!atual ||
							(item.papel ?? null) !== (atual.papel ?? null) ||
							String(item.papel_unidade ?? '') !== (atual.papel_unidade_id == null ? '' : '*'));
					if (payloadTentaTrocar) {
						logger.warn(
							'[sync-policiais] tentativa de alterar papel via webhook ignorada (WEBHOOK_ALLOW_PAPEL_CHANGES off)',
							{
								matricula: String(item.matricula),
								papelTentado: item.papel ?? null,
								papelUnidadeTentado: item.papel_unidade ?? null
							}
						);
					}
				}

				await upsertPolicial(
					db,
					{
						matricula: String(item.matricula).trim(),
						nome: String(item.nome).trim(),
						cargo: cargo as 'DPC' | 'OIP',
						telefone: telefoneMap,
						cpf: String(item.cpf || '').trim(),
						classe: String(item.classe || '').trim(),
						lotacao: lotacaoMap,
						...(existente ? {} : { ativo: 1 }),
						email: String(item.email || '')
							.toLowerCase()
							.trim(),
						regime: regimeMap,
						papel: papelMap,
						papel_unidade_id: papelUnidadeId,
						...(complemento
							? {
									cargo_anterior: complemento.cargo_anterior,
									data_nascimento: complemento.data_nascimento,
									data_posse: complemento.data_posse,
									designacao_id: designacaoId
								}
							: {})
					},
					env
				);
				if (complemento) {
					const gravado = await buscarPolicialPorMatricula(db, String(item.matricula));
					if (!gravado) throw new Error('Servidor não encontrado depois do upsert');
					if (complemento.afastamentos) {
						await regravarAfastamentosLegados(
							db,
							gravado.id,
							complemento.afastamentos,
							'carga da planilha'
						);
					}
					const designacao = complemento.designacao?.trim() ?? '';
					if (
						(DESIGNACOES_DE_TITULAR as readonly string[]).includes(designacao) &&
						cargo !== 'DPC'
					) {
						// Só delegado responde por unidade (decisão de 14/09/2026): um OIP com
						// designação de direção é erro da planilha, não titularidade.
						avisos.push(
							`${rowId}: designação "${designacao}" em servidor ${cargo}; só DPC é titular — ignorado`
						);
					} else if ((DESIGNACOES_DE_TITULAR as readonly string[]).includes(designacao)) {
						const r = await regravarTitularDaPlanilha(db, gravado.id, lotacaoMap, hoje);
						if (r.acao === 'unidade_desconhecida') {
							avisos.push(`${rowId}: titular de "${lotacaoMap}", unidade não cadastrada`);
						} else if (r.acao === 'vigente_do_sistema') {
							avisos.push(
								`${rowId}: "${lotacaoMap}" já tem titular cadastrado pela tela (id ${r.vigentePolicialId}); a planilha não substitui`
							);
						}
					}
				}
				successCount++;
			} catch (err: unknown) {
				errors.push(`${rowId}: ${mensagemDeErro(err)}`);
			}
		}

		const { contexto, env: cryptoEnv } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'sync_policiais',
				usuario: null,
				actor_tipo: 'webhook',
				entidade: 'policial',
				resultado: errors.length === 0 ? 'sucesso' : 'falha',
				detalhes: `Sync de policiais: ${successCount}/${data.length} importados, ${errors.length} falha(s)`,
				metadados: {
					processed: data.length,
					imported: successCount,
					skippedEmpty: vazias,
					failed: errors.length,
					papelLiberado
				},
				...contexto
			},
			{ env: cryptoEnv }
		);

		return respostaDeSync({
			processadas: data.length,
			importadas: successCount,
			vazias,
			erros: errors,
			avisos,
			extras: { historicoGravado, historicoRepetido }
		});
	} catch (err: unknown) {
		// 400 (não 500): payload do webhook é input inválido do caller, não bug
		// interno. Preserva o behavior anterior + adiciona errorType VALIDATION.
		return apiError(
			`Erro crítico no processamento: ${mensagemDeErro(err)}`,
			400,
			ErrorCode.VALIDATION
		);
	}
};
