/**
 * Seccionais participantes de uma GISE e os SLOTS de unidade que pendem delas.
 *
 * Um "slot" (`gise_seccional_unidades`) é a vaga de uma unidade dentro da
 * seccional: nasce em branco (`unidade_id = null`) e o Adm Seccional escolhe
 * depois qual unidade vai ocupá-la. Todo slot carrega o par fixo de equipes
 * — uma `operacional` e uma `seint` — porque é assim que o serviço é composto:
 * quem preenche o formulário é a EQUIPE, não a unidade.
 *
 * Corolário: seccional sem slot é seccional impossível de preencher. Por isso
 * todos os caminhos de criação passam por `criarSlotComEquipesPadrao`.
 */
import { eq, and, ne, inArray } from 'drizzle-orm';
import { buscarVagasPadraoEquipesGise } from './vagas-padrao';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	giseDocumentos,
	gisePresencas,
	giseAssinaturasRelatorios,
	giseSeccionalUnidades,
	policiais
} from '../../server/schema';
import type { Database } from '../core';
import { decifrarCpfDoDB, type CpfCriptoEnv } from '../../crypto/cpf-cripto';

type VagasPadrao = Awaited<ReturnType<typeof buscarVagasPadraoEquipesGise>>;

/**
 * A operação da escala a que esta seccional pertence, ou `null` (escala anterior
 * à migração 0048, ou seccional que não existe mais).
 */
async function operacaoDaSeccional(db: Database, giseSeccionalId: number): Promise<number | null> {
	const row = await db
		.select({ operacao_id: giseEscalas.operacao_id })
		.from(giseSeccionais)
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(eq(giseSeccionais.id, giseSeccionalId))
		.get();
	return row?.operacao_id ?? null;
}

/**
 * Cria um slot de unidade na seccional JÁ COM o par de equipes padrão
 * (operacional + SEINT, com as vagas configuradas na OPERAÇÃO da escala) e
 * devolve o id do slot.
 *
 * Slot e equipes nascem juntos de propósito: slot sem equipe não aparece para
 * preenchimento nenhum, então separar as duas escritas só criaria estados
 * intermediários inúteis. Os três caminhos que criam slot — abrir seccional,
 * acrescentar unidade e clonar GISE — chamam esta função para que a composição
 * padrão seja definida em um lugar só.
 *
 * A operação é DERIVADA da seccional (`gise_seccionais` → `gise_escalas`), e não
 * recebida por parâmetro: dois dos três chamadores não a têm em mãos, e um
 * parâmetro que eles teriam de buscar só para repassar é um parâmetro que uma
 * hora vai chegar errado. Derivar aqui torna impossível montar a equipe com o
 * tamanho padrão de outra operação.
 *
 * `vagas` existe para quem cria vários slots em laço passar a configuração já
 * lida e não repetir a consulta a cada iteração — nesse caso a derivação é
 * pulada, porque quem passou já resolveu a operação.
 */
export async function criarSlotComEquipesPadrao(
	db: Database,
	giseSeccionalId: number,
	unidadeId: number | null = null,
	vagas?: VagasPadrao
): Promise<number> {
	const v =
		vagas ??
		(await buscarVagasPadraoEquipesGise(db, await operacaoDaSeccional(db, giseSeccionalId)));

	const [slot] = await db
		.insert(giseSeccionalUnidades)
		.values({ gise_seccional_id: giseSeccionalId, unidade_id: unidadeId })
		.returning({ id: giseSeccionalUnidades.id });

	await db.insert(giseEquipes).values([
		{
			gise_seccional_id: giseSeccionalId,
			gise_unidade_id: slot.id,
			tipo: 'operacional' as const,
			slots_dpc: v.operacional.dpc,
			slots_oip: v.operacional.oip
		},
		{
			gise_seccional_id: giseSeccionalId,
			gise_unidade_id: slot.id,
			tipo: 'seint' as const,
			slots_dpc: v.seint.dpc,
			slots_oip: v.seint.oip
		}
	]);

	return slot.id;
}

/**
 * Garante que a seccional participe da GISE e devolve o id de
 * `gise_seccionais` — idempotente, é o que permite a `/operacoes/gise` chamar em laço
 * para todas as seccionais ao criar uma escala "completa".
 *
 * Assimetria importante: no INSERT a seccional ganha um slot em branco com as
 * equipes padrão; no ramo já-existe, NADA é recriado — só a
 * `unidade_operacional_id` é atualizada, e apenas se o parâmetro tiver sido
 * passado (`undefined` = "não mexe", distinto de `null` = "limpa"). Recriar
 * slots aqui duplicaria a composição de quem já preencheu.
 */
export async function upsertGiseSeccional(
	db: Database,
	giseId: number,
	seccionalId: number,
	unidadeOperacionalId?: number | null
): Promise<number> {
	const existing = await db
		.select({ id: giseSeccionais.id })
		.from(giseSeccionais)
		.where(and(eq(giseSeccionais.gise_id, giseId), eq(giseSeccionais.seccional_id, seccionalId)))
		.get();

	if (existing) {
		if (unidadeOperacionalId !== undefined) {
			await db
				.update(giseSeccionais)
				.set({ unidade_operacional_id: unidadeOperacionalId })
				.where(eq(giseSeccionais.id, existing.id));
		}
		return existing.id;
	}

	const result = await db
		.insert(giseSeccionais)
		.values({
			gise_id: giseId,
			seccional_id: seccionalId,
			unidade_operacional_id: unidadeOperacionalId ?? null
		})
		.returning({ id: giseSeccionais.id });

	const secId = result[0].id;
	await criarSlotComEquipesPadrao(db, secId, null);
	return secId;
}

/**
 * Patch da participação da seccional. `status` é o que a supervisão enxerga na
 * tela de acompanhamento: `pendente` (ainda não enviou) → `preenchida`;
 * `retificada` marca que a supervisão devolveu para correção e
 * `preenchida_retificada`, que a seccional reenviou depois da devolução — a
 * distinção existe para o supervisor saber o que já foi conferido uma vez.
 *
 * `hora_entrada`/`hora_saida` sobrescrevem o horário da GISE só para esta
 * seccional; `null` volta a valer o horário geral.
 */
export async function atualizarGiseSeccional(
	db: Database,
	id: number,
	data: Partial<{
		unidade_operacional_id: number | null;
		status: 'pendente' | 'preenchida' | 'retificada' | 'preenchida_retificada';
		hora_entrada: string | null;
		hora_saida: string | null;
	}>
) {
	return db.update(giseSeccionais).set(data).where(eq(giseSeccionais.id, id));
}

/**
 * Remove a seccional da GISE. Slots, equipes e membros descem junto por
 * `ON DELETE CASCADE` do schema — mas presenças e assinaturas de relatório NÃO,
 * porque referenciam a GISE e o policial, não a seccional. Quem exclui uma
 * seccional já preenchida deve passar antes por `revogarAssinaturasSeccional`.
 */
export async function excluirGiseSeccional(db: Database, id: number) {
	return db.delete(giseSeccionais).where(eq(giseSeccionais.id, id));
}

/**
 * Membros escalados na seccional, com nome e CPF do policial — a lista que
 * alimenta o termo de presença e o relatório.
 *
 * O CPF sai DECIFRADO (o banco guarda cifrado); passe `env` com as chaves
 * quando o valor for usado. Chamador que só precisa dos ids pode passar
 * `undefined` e ignorar o campo, como faz `revogarAssinaturasSeccional`.
 */
export async function buscarGiseSeccionalMembros(
	db: Database,
	giseId: number,
	seccionalId: number,
	env: CpfCriptoEnv | undefined
) {
	const rows = await db
		.select({
			id: giseMembros.id,
			equipe_id: giseMembros.equipe_id,
			policial_id: giseMembros.policial_id,
			policial_nome: policiais.nome,
			policial_cpf: policiais.cpf
		})
		.from(giseMembros)
		.innerJoin(policiais, eq(giseMembros.policial_id, policiais.id))
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.where(and(eq(giseSeccionais.gise_id, giseId), eq(giseSeccionais.seccional_id, seccionalId)))
		.all();
	// CPF cifrado em repouso (LGPD) — decifra para assinatura/exibição.
	return Promise.all(
		rows.map(async (r) => ({
			...r,
			policial_cpf: (await decifrarCpfDoDB(r.policial_cpf, env)) || null
		}))
	);
}

/**
 * Revoga as assinaturas de policiais e relatórios de uma seccional específica.
 * Usado quando há alteração na escala que invalida as assinaturas anteriores.
 *
 * Uma assinatura vale para o documento que existia no momento em que foi feita;
 * mexer na composição da seccional muda esse documento, então manter as
 * assinaturas antigas significaria exibir como assinado um conteúdo que ninguém
 * assinou. O alcance é deliberadamente maior que a seccional: a assinatura
 * PRINCIPAL da GISE (`gise_documentos`, uma por escala) também cai, porque o
 * documento consolidado contém a seccional alterada.
 *
 * O status volta a `em_preenchimento` para forçar o novo ciclo de assinaturas —
 * exceto se a GISE já estiver `finalizada`, caso em que reabrir é ato
 * deliberado do admin, não efeito colateral de uma edição.
 *
 * Só apaga LINHAS: os blobs no R2 precisam ser limpos pelo chamador.
 *
 * **Recebe o id da LINHA `gise_seccionais`** — a participação daquela seccional
 * NAQUELA escala — e resolve a unidade por dentro. Até ago/2026 o parâmetro se
 * chamava `seccionalId` e era usado direto como `unidades.id`, enquanto as sete
 * chamadas passavam o id da linha de participação. Dois inteiros, mesmo nome,
 * espaços de id que se sobrepõem: os passos 1 e 3 não achavam nada (ou achavam
 * a seccional ERRADA, se algum `unidades.id` coincidisse), e os relatórios
 * assinados sobreviviam à mudança de composição que os invalidava. Ninguém
 * notou porque os passos 4 e 5 não usam o parâmetro — o efeito visível na tela,
 * "a escala voltou para preenchimento", acontecia de qualquer jeito
 * (FLW-GISE-011).
 */
export async function revogarAssinaturasSeccional(
	db: Database,
	giseId: number,
	giseSeccionalId: number
) {
	// A unidade por trás da participação. Sem ela não há o que revogar: as duas
	// tabelas de assinatura apontam para `unidades`, não para `gise_seccionais`.
	const participacao = await db
		.select({ seccional_id: giseSeccionais.seccional_id })
		.from(giseSeccionais)
		.where(and(eq(giseSeccionais.id, giseSeccionalId), eq(giseSeccionais.gise_id, giseId)))
		.get();
	const seccionalId = participacao?.seccional_id;

	if (seccionalId != null) {
		// 1. Limpar as assinaturas dos relatórios de extra/produtividade do supervisor desta seccional
		await db
			.delete(giseAssinaturasRelatorios)
			.where(
				and(
					eq(giseAssinaturasRelatorios.gise_id, giseId),
					eq(giseAssinaturasRelatorios.seccional_id, seccionalId)
				)
			);
	}

	// 2. Localizar todos os policiais vinculados a esta seccional na GISE
	// env undefined: aqui só usamos policial_id (não o CPF), sem decifrar.
	const membros =
		seccionalId == null ? [] : await buscarGiseSeccionalMembros(db, giseId, seccionalId, undefined);
	const policialIds = membros.map((m) => m.policial_id);

	if (policialIds.length > 0) {
		// 3. Limpar as assinaturas de entrada/saída (presenças) desses policiais na GISE
		await db
			.delete(gisePresencas)
			.where(
				and(eq(gisePresencas.gise_id, giseId), inArray(gisePresencas.policial_id, policialIds))
			);
	}

	// 4. Se a escala do GISE já estiver assinada, revogar também a assinatura principal
	// (Pois a integridade do documento final foi alterada)
	// giseDocumentos tem gise_id como PK/Unique
	await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));

	// 5. Garantir que o status da escala volte para 'em_preenchimento' para forçar novas assinaturas
	await db
		.update(giseEscalas)
		.set({ status: 'em_preenchimento' })
		.where(
			and(
				eq(giseEscalas.id, giseId),
				ne(giseEscalas.status, 'finalizada') // Não reabrir se já estiver finalizada (isso é manual)
			)
		);
}
/**
 * Acrescenta mais um slot à seccional — usado quando uma segunda unidade entra
 * na mesma seccional no plantão. `unidadeId` pode ser `null` para deixar a
 * escolha da unidade para o Adm Seccional.
 */
export async function adicionarGiseSeccionalUnidade(
	db: Database,
	giseSeccionalId: number,
	unidadeId: number | null
): Promise<number> {
	return criarSlotComEquipesPadrao(db, giseSeccionalId, unidadeId);
}

/**
 * Atualiza a unidade de um slot (usado pelo Adm Seccional para preencher um slot em branco).
 */
export async function atualizarGiseSeccionalUnidade(
	db: Database,
	slotId: number,
	unidadeId: number
) {
	return db
		.update(giseSeccionalUnidades)
		.set({ unidade_id: unidadeId })
		.where(eq(giseSeccionalUnidades.id, slotId));
}

/**
 * Remove o slot E as equipes penduradas nele (os membros descem por cascade da
 * FK `gise_membros.equipe_id`).
 *
 * Apagar as equipes é obrigatório porque `gise_equipes.gise_unidade_id` NÃO tem
 * foreign key para o slot — só a coluna e um índice. Removendo apenas a linha
 * do slot, as equipes viravam órfãs: sumiam da tela (o load agrupa equipes por
 * slot existente) mas continuavam sendo contadas por `verificarTodosEntraram`,
 * que caminha membro → equipe → seccional sem passar pelo slot. Resultado: a
 * GISE nunca alcançava "todos entraram" por causa de policiais que ninguém
 * conseguia ver para remover.
 *
 * Não revoga assinatura — quem remove slot de seccional já preenchida chama
 * `revogarAssinaturasSeccional` em seguida.
 */
export async function removerGiseSeccionalUnidade(db: Database, giseSeccionalUnidadeId: number) {
	await db.delete(giseEquipes).where(eq(giseEquipes.gise_unidade_id, giseSeccionalUnidadeId));
	return db
		.delete(giseSeccionalUnidades)
		.where(eq(giseSeccionalUnidades.id, giseSeccionalUnidadeId));
}
