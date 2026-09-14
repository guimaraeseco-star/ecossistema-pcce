/**
 * CRUD da escala GISE — a linha de `gise_escalas` e a árvore que pende dela:
 *
 *     gise_escalas
 *       └── gise_seccionais            (uma por seccional participante)
 *             └── gise_seccional_unidades  ("slots": qual unidade ocupa a vaga)
 *                   └── gise_equipes       (operacional | seint, com nº de vagas)
 *                         └── gise_membros (os policiais)
 *
 * **Várias GISEs não finalizadas coexistem, e isso é o normal.** Uma GISE é de
 * um DIA: o formulário de criação recebe uma lista de datas e cria uma escala
 * por data, todas em `em_definicao_supervisor`. A tela lista as ativas
 * paginadas ("N escalas ativas — página X de Y").
 *
 * Este cabeçalho afirmava o contrário até ago/2026 — "só existe uma GISE não
 * finalizada por vez" —, e o achado FLW-GISE-010 pedia uma constraint de
 * unicidade para proteger a regra. **A regra não existe**: a constraint
 * quebraria a criação em lote por datas, que é a forma normal de uso. O que
 * havia era uma `buscarGiseAtiva` que escolhia a mais recente por `data_inicio`
 * e escondia as demais em silêncio — cujo resultado, ao final, a página nem
 * lia. Foi removida com o comentário que a justificava.
 *
 * O ciclo de status (`em_definicao_supervisor` → `em_preenchimento` →
 * `aguardando_assinatura` → `em_andamento` → `aguardando_relatorios` →
 * `aguardando_assinatura_relat` → `pronta_para_finalizar` → `finalizada`) é
 * dirigido por `escalas-status.ts`; aqui só se GRAVA o status que aquele módulo
 * decidiu.
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseSeccionalUnidades,
	giseDocumentos,
	giseAssinaturasRelatorios,
	gisePresencas,
	unidades
} from '../../server/schema';
import type * as schema from '../../server/schema';
import { linhasAfetadas, type Database } from '../core';
import { STATUS_FINALIZAVEIS } from '$lib/gise/finalizacao';
import { buscarVagasPadraoEquipesGise } from './vagas-padrao';
import { criarSlotComEquipesPadrao } from './seccionais';

/** Linha crua de `gise_escalas`, sem nada da árvore de seccionais/equipes. */
export async function buscarGiseEscala(
	db: Database,
	id: number
): Promise<schema.GiseEscala | undefined> {
	return db.select().from(giseEscalas).where(eq(giseEscalas.id, id)).get();
}

/**
 * Cria a escala VAZIA e devolve o id — sem seccionais, sem equipes. Montar a
 * árvore é do chamador (`/operacoes/gise` cria as seccionais em seguida no modo
 * "completa"), ou de `clonarGiseParaData`, que faz as duas coisas.
 *
 * `feriado` é `boolean` na API e `0|1` na coluna; a conversão fica aqui para
 * que nenhum chamador precise saber disso.
 *
 * **INSERT livre, sem unique em `(operacao_id, data_inicio)` — e isso é
 * decisão, não esquecimento (SEC-38).** O produto admite duas escalas da mesma
 * operação no mesmo dia: é para isso que existem `hora_entrada`/`hora_saida`
 * como parâmetro, e é o que cobre dois turnos ou duas frentes na mesma data.
 * Um unique ali recusaria operação legítima.
 *
 * A consequência assumida é que duplicata por duplo clique também passa. Quem
 * cria pela UI vê a escala nova na lista e apaga a sobra; não há efeito
 * colateral irreversível na criação (a árvore nasce vazia, sem documento nem
 * presença). Se algum dia o produto passar a exigir uma por dia, o unique
 * precisa de índice PARCIAL — `WHERE operacao_id IS NOT NULL` —, porque o
 * SQLite trata cada `NULL` como distinto e GISE sem operação escaparia dele.
 */
export async function criarGiseEscala(
	db: Database,
	dataInicio: string,
	horaEntrada: string,
	horaSaida: string,
	statusInicial: 'em_definicao_supervisor' | 'em_preenchimento' = 'em_definicao_supervisor',
	feriado = false,
	/**
	 * A operação da escala (GISE, CRAJUBAR, EDGE…). É o que decide qual
	 * formulário de produtividade as equipes vão preencher e sob quais
	 * indicadores a escala é medida.
	 */
	operacaoId?: number | null
): Promise<number> {
	const result = await db
		.insert(giseEscalas)
		.values({
			data_inicio: dataInicio,
			feriado: feriado ? 1 : 0,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida,
			status: statusInicial,
			operacao_id: operacaoId ?? null
		})
		.returning({ id: giseEscalas.id });
	return result[0].id;
}

/**
 * Patch da linha da escala: escreve exatamente os campos recebidos. É por onde
 * passam tanto o avanço de status quanto a designação do quadro de supervisão
 * (`supervisor_id`, `assessor_id`, `seint1_id`, `seint2_id`).
 *
 * Não valida a transição de status — quem decide é `escalas-status.ts`. Chamar
 * com um status arbitrário coloca a escala nesse estado sem checagem alguma.
 */
export async function atualizarGiseEscala(
	db: Database,
	id: number,
	data: Partial<{
		data_inicio: string;
		hora_entrada: string;
		hora_saida: string;
		status:
			| 'em_definicao_supervisor'
			| 'em_preenchimento'
			| 'aguardando_assinatura'
			| 'em_andamento'
			| 'aguardando_relatorios'
			| 'aguardando_assinatura_relat'
			| 'pronta_para_finalizar'
			| 'finalizada';
		supervisor_id: number | null;
		assessor_id: number | null;
		seint1_id: number | null;
		seint2_id: number | null;
		assessor_email_notificacao: string | null;
		breve_relatorio_titulo: string | null;
		breve_relatorio_texto_seccional: string | null;
		breve_relatorio_texto_supervisao: string | null;
		planilha_base_equipe_alimentada_em: string | null;
	}>
) {
	return db.update(giseEscalas).set(data).where(eq(giseEscalas.id, id));
}

/**
 * Encerra a escala em UMA operação atômica: só grava `finalizada` se o status
 * ainda for um dos finalizáveis.
 *
 * Existe separada de `atualizarGiseEscala` porque aquela é o patch GENÉRICO da
 * linha — grava `supervisor_id`, `assessor_id`, `seint*` e datas —, e um
 * `WHERE` de status dentro dela quebraria todos os outros usos.
 *
 * **Por que CAS e não "ler o status e depois gravar" (SEC-35):** as duas
 * entradas de finalização (a rota `POST /api/gise/[id]/finalizar` e a action
 * `finalizarGise`) liam o status, decidiam, e só então gravavam. O estado final
 * é idempotente — `finalizada` duas vezes é `finalizada` —, mas os EFEITOS
 * colaterais não são: duas requisições simultâneas gravavam dois eventos de
 * auditoria e disparavam `agendarSyncBaseEquipeAposFinalizar` duas vezes, ou
 * seja, dois envios da base de equipe para a planilha institucional.
 *
 * O chamador usa `{ finalizada }` para recusar a corrida perdida com 409
 * **antes** de auditar e de agendar o sync.
 */
export async function finalizarGiseEscala(
	db: Database,
	id: number
): Promise<{ finalizada: boolean }> {
	const r = await db
		.update(giseEscalas)
		.set({ status: 'finalizada' })
		.where(and(eq(giseEscalas.id, id), inArray(giseEscalas.status, STATUS_FINALIZAVEIS)));
	return { finalizada: linhasAfetadas(r) > 0 };
}

/**
 * DESFAZ o encerramento da escala: apaga documentos assinados, assinaturas de
 * relatório e presenças, e volta o status para `em_preenchimento`.
 *
 * É destrutivo por desenho — reabrir significa que a escala vai ser refeita e
 * reassinada, então as evidências do ciclo anterior não podem sobreviver e
 * confundir a conferência.
 *
 * **Apaga apenas as LINHAS.** Os blobs correspondentes no R2 (PDF assinado,
 * cópias de conferência e selfies de presença) ficam órfãos se o chamador não
 * limpar antes — ver `limparR2DaGise` no endpoint de revogação (R2-2/R2-3).
 * A ordem importa: R2 primeiro, banco depois, porque é a linha que diz quais
 * objetos existem.
 *
 * As seccionais e equipes NÃO são tocadas: a composição continua montada, é o
 * preenchimento que recomeça.
 */
export async function reabrirGiseEscala(db: Database, giseId: number) {
	// Todas as operações são independentes — executa em paralelo
	await Promise.all([
		db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)),
		db.delete(giseAssinaturasRelatorios).where(eq(giseAssinaturasRelatorios.gise_id, giseId)),
		db.delete(gisePresencas).where(eq(gisePresencas.gise_id, giseId)),
		atualizarGiseEscala(db, giseId, {
			status: 'em_preenchimento',
			planilha_base_equipe_alimentada_em: null
		})
	]);
}

/**
 * Cria uma GISE nova para `novaData` reaproveitando a estrutura de outra — o
 * caminho normal de abrir a escala do próximo plantão, já que a composição
 * costuma repetir.
 *
 * Dois modos:
 * - `'clonada'` — copia as seccionais da GISE de origem com seus slots e
 *   equipes (tipo e número de vagas). **Membros e presenças não vêm junto**: a
 *   escala nova nasce vazia de gente, para ser preenchida do zero;
 * - `'completa'` — ignora a origem e cria uma seccional para CADA unidade do
 *   tipo `seccional` cadastrada.
 *
 * A parte delicada é o remapeamento de ids. Equipe aponta para slot
 * (`gise_unidade_id`), e slot aponta para seccional; copiar os ids antigos
 * faria a escala nova apontar para a árvore da velha. Daí os dois mapas
 * `old id → new id` (`secIdMap`, `slotIdMap`) e os inserts SEQUENCIAIS: cada
 * `returning` precisa ser conhecido antes do insert que o referencia, e o D1
 * não permite aninhar transações em `batch`.
 *
 * Fechamento de lacuna: seccional que terminar sem nenhum slot (sempre no modo
 * `'completa'`, ou na origem incompleta) ganha um slot vazio e o par de equipes
 * padrão operacional + SEINT, com as vagas de `buscarVagasPadraoEquipesGise`.
 * Assim nenhuma seccional nasce impossível de preencher.
 *
 * A escala nova nasce sempre em `em_definicao_supervisor`, independentemente do
 * status da origem, e herda hora de entrada/saída e feriado quando os
 * parâmetros correspondentes não são passados.
 */
export async function clonarGiseParaData(
	db: Database,
	giseId: number,
	novaData: string,
	modo: 'clonada' | 'completa' = 'clonada',
	horaEntrada?: string,
	horaSaida?: string,
	feriado?: boolean
): Promise<number> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (!gise) throw new Error('GISE não encontrada');

	const feriadoNovo = feriado ?? !!gise.feriado;
	// A cópia herda a OPERAÇÃO do original — clonar uma escala da CRAJUBAR não
	// pode produzir uma escala do GISE, porque o formulário e os indicadores
	// mudariam junto sem ninguém pedir.
	const novoId = await criarGiseEscala(
		db,
		novaData,
		horaEntrada ?? gise.hora_entrada,
		horaSaida ?? gise.hora_saida,
		'em_definicao_supervisor',
		feriadoNovo,
		gise.operacao_id
	);

	const secsParaClonar: { seccional_id: number; id?: number }[] =
		modo === 'clonada'
			? await db.select().from(giseSeccionais).where(eq(giseSeccionais.gise_id, giseId)).all()
			: (await db.select().from(unidades).where(eq(unidades.tipo, 'seccional')).all()).map((s) => ({
					seccional_id: s.id
				}));

	if (secsParaClonar.length === 0) return novoId;

	// Insert seccionais sequencialmente (D1 não suporta transações aninhadas com batch)
	const secsInsert: { id: number; seccional_id: number }[] = [];
	for (const sec of secsParaClonar) {
		const [inserted] = await db
			.insert(giseSeccionais)
			.values({
				gise_id: novoId,
				seccional_id: sec.seccional_id,
				unidade_operacional_id: null,
				status: 'pendente' as const
			})
			.returning({ id: giseSeccionais.id, seccional_id: giseSeccionais.seccional_id });
		secsInsert.push(inserted);
	}

	// Build map: old seccional id -> new seccional id
	const secIdMap = new Map<number, number>();
	if (modo === 'clonada') {
		for (let i = 0; i < secsParaClonar.length; i++) {
			const oldId = secsParaClonar[i].id;
			if (oldId !== undefined) {
				secIdMap.set(oldId, secsInsert[i].id);
			}
		}
	}

	// Clonar slots e equipes (modo clonada) ou criar slot padrão (modo completa)
	if (modo === 'clonada') {
		const oldSecIds = secsParaClonar.filter((s) => s.id).map((s) => s.id as number);
		if (oldSecIds.length > 0) {
			// Clona slots de unidade
			const slotsOriginais = await db
				.select()
				.from(giseSeccionalUnidades)
				.where(inArray(giseSeccionalUnidades.gise_seccional_id, oldSecIds));

			const slotIdMap = new Map<number, number>(); // old slot id -> new slot id

			for (const slot of slotsOriginais) {
				const newSecId = secIdMap.get(slot.gise_seccional_id);
				if (newSecId) {
					const [newSlot] = await db
						.insert(giseSeccionalUnidades)
						.values({
							gise_seccional_id: newSecId,
							unidade_id: slot.unidade_id
						})
						.returning({ id: giseSeccionalUnidades.id });
					slotIdMap.set(slot.id, newSlot.id);
				}
			}

			// Clona equipes com gise_unidade_id remapeado
			const equipesOriginais = await db
				.select()
				.from(giseEquipes)
				.where(inArray(giseEquipes.gise_seccional_id, oldSecIds));

			for (const eq_ of equipesOriginais) {
				const newSecId = secIdMap.get(eq_.gise_seccional_id);
				if (newSecId) {
					const newUnidadeId =
						eq_.gise_unidade_id !== null ? (slotIdMap.get(eq_.gise_unidade_id) ?? null) : null;
					await db.insert(giseEquipes).values({
						gise_seccional_id: newSecId,
						gise_unidade_id: newUnidadeId,
						tipo: eq_.tipo,
						slots_dpc: eq_.slots_dpc,
						slots_oip: eq_.slots_oip
					});
				}
			}
		}
	}

	// Criar slot + equipe padrão para seccionais sem slots (modo completa ou fallback)
	const novasSecIds = secsInsert.map((s) => s.id);
	if (novasSecIds.length > 0) {
		const slotsExistentes = await db
			.select({ gise_seccional_id: giseSeccionalUnidades.gise_seccional_id })
			.from(giseSeccionalUnidades)
			.where(inArray(giseSeccionalUnidades.gise_seccional_id, novasSecIds));

		const secIdsSemSlot = novasSecIds.filter(
			(id) => !slotsExistentes.some((s) => s.gise_seccional_id === id)
		);

		// Vagas lidas uma vez só: são as mesmas para todos os slots do laço. Vêm da
		// operação do ORIGINAL, que é a mesma da cópia (ver `criarGiseEscala` acima).
		const v = await buscarVagasPadraoEquipesGise(db, gise.operacao_id);
		for (const secId of secIdsSemSlot) {
			await criarSlotComEquipesPadrao(db, secId, null, v);
		}
	}

	return novoId;
}
