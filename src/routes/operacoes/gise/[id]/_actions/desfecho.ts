/**
 * O DESFECHO de uma mudança de composição da GISE: invalidar o que a mudança
 * derruba e registrar na trilha quem mudou o quê.
 *
 * `shared.ts` guarda o PREÂMBULO — carregar a GISE, recusar `finalizada`,
 * amarrar o id filho à GISE da URL. Este arquivo guarda o outro lado, e existe
 * pelo mesmo motivo: as treze actions de composição escreviam as duas metades à
 * mão, e a metade escrita à mão é a que falta em alguma cópia.
 *
 * No preâmbulo, o que faltava era a recusa (FLW-GISE-006/007). Aqui, o que
 * faltava era a trilha inteira: mexer em membro, equipe, unidade ou seccional
 * muda quem está de serviço e pode derrubar documento e assinatura — e nenhuma
 * das treze gravava evento nenhum (FLW-GISE-003). O histórico não permitia
 * atribuir a ninguém uma alteração de presença, escopo ou validade documental.
 *
 * As duas metades ficam JUNTAS de propósito. O achado pede "informação sobre
 * revogação" no evento, e o único jeito de o evento não mentir sobre o que foi
 * revogado é a revogação e o registro saírem da mesma chamada:
 * `invalidar*` devolve o que derrubou, e `concluirMudancaGise` EXIGE esse
 * valor. Quem instrumentar a décima quarta action não tem como registrar uma
 * revogação que não houve, nem omitir a que houve.
 */
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { atualizarGiseEscala, revogarAssinaturasSeccional } from '$lib/db';
import type { Database } from '$lib/db';
import { auditarDoEvento, type AcaoAudit } from '$lib/db/audit';
import {
	coletarChavesR2DaRevogacaoSeccional,
	coletarChavesR2DoDocumentoGise,
	deletarChavesR2,
	type R2CleanupBucket
} from '$lib/server/r2-cleanup';
import { giseDocumentos } from '$lib/server/schema';
import { saiuDaFaseDeEdicao } from './shared';

/**
 * O que a mudança derrubou. Vai para o evento, e é o que o operador procura.
 *
 * As duas não são alternativas: a segunda CONTÉM a primeira. Toda mudança de
 * composição depois da assinatura descarta o PDF consolidado; a de alcance
 * seccional descarta também os relatórios assinados daquela seccional e as
 * presenças dos seus membros. Os nomes dizem isso porque a versão anterior
 * dizia o contrário — os comentários prometiam "revoga só as assinaturas dela,
 * sem derrubar o resto da escala", e o código sempre derrubou o documento.
 */
export type Invalidacao = 'nada' | 'documento_da_escala' | 'documento_e_assinaturas_da_seccional';

/**
 * Mudança que altera a escala INTEIRA: o PDF gerado deixa de descrevê-la, então
 * é descartado e a GISE volta para preenchimento.
 *
 * Na fase de rascunho não há o que derrubar — devolve `'nada'` sem tocar em
 * nada, que é o comportamento que as três cópias já tinham.
 */
export async function invalidarDocumentoDaEscala(
	db: Database,
	r2: R2CleanupBucket | null,
	giseId: number,
	status: string
): Promise<Invalidacao> {
	if (!saiuDaFaseDeEdicao(status)) return 'nada';

	// R2 ANTES do D1, e a ordem é o ponto: é a LINHA que diz quais objetos
	// existem. Apagando-a primeiro, o PDF assinado e sua cópia de conferência
	// ficam no bucket sem nenhuma referência — irrastreáveis (FLW-DOC-003).
	if (r2) {
		await deletarChavesR2(
			db,
			r2,
			await coletarChavesR2DoDocumentoGise(db, giseId),
			'invalidacao-documento-gise'
		);
	}

	await db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId));
	await atualizarGiseEscala(db, giseId, { status: 'em_preenchimento' });
	return 'documento_da_escala';
}

/**
 * Mudança dentro de uma seccional. Além do documento consolidado, caem os
 * relatórios de extra assinados por ela e as presenças dos seus membros.
 *
 * `giseSeccionalId` é o id da linha `gise_seccionais` — a participação daquela
 * seccional NESTA escala, não a `unidades.id`. A distinção custou caro: ver
 * `revogarAssinaturasSeccional` e FLW-GISE-011.
 */
export async function invalidarAssinaturasDaSeccional(
	db: Database,
	r2: R2CleanupBucket | null,
	giseId: number,
	giseSeccionalId: number,
	status: string
): Promise<Invalidacao> {
	if (!saiuDaFaseDeEdicao(status)) return 'nada';

	// Mesma ordem, mesmo motivo. O conjunto aqui é maior: além do documento
	// consolidado, saem os relatórios de extra assinados pela seccional e as
	// selfies de presença dos seus membros — biometria (LGPD art. 11), que não
	// pode ficar no bucket depois que a linha some.
	if (r2) {
		await deletarChavesR2(
			db,
			r2,
			await coletarChavesR2DaRevogacaoSeccional(db, giseId, giseSeccionalId),
			'revogacao-seccional'
		);
	}

	await revogarAssinaturasSeccional(db, giseId, giseSeccionalId);
	return 'documento_e_assinaturas_da_seccional';
}

/** O que a action precisa dizer sobre a mudança que acabou de gravar. */
export interface MudancaGise {
	db: Database;
	/** Sempre presente: é a entidade da trilha, e o filtro do console. */
	giseId: number;
	usuario: NonNullable<App.Locals['usuario']>;
	acao: AcaoAudit;
	/** A entidade filha efetivamente tocada (equipe, membro, seccional, slot). */
	alvo: { tipo: string; id: number | null; nome?: string | null };
	/** Frase que o operador lê na listagem, sem precisar abrir os metadados. */
	detalhes: string;
	/** Obrigatório: ver o cabeçalho — é o que impede o evento de mentir. */
	invalidacao: Invalidacao;
	metadados?: Record<string, unknown> | null;
	dados_antes?: Record<string, unknown> | null;
	dados_depois?: Record<string, unknown> | null;
}

/**
 * Grava o evento da mudança. Chamada DEPOIS da mutação e da invalidação.
 *
 * A severidade sobe para `aviso` quando a mudança derrubou documento ou
 * assinatura: mexer na composição de um rascunho é rotina, mexer na de uma
 * escala que já foi assinada não é — e essa é a distinção que o operador
 * precisa enxergar na listagem sem abrir cada evento. Derivada aqui, e não
 * declarada em cada action, porque cada action teria de acertá-la sozinha.
 */
export async function concluirMudancaGise(
	event: RequestEvent,
	m: MudancaGise
): Promise<Invalidacao> {
	await auditarDoEvento(event, m.db, {
		acao: m.acao,
		usuario: m.usuario,
		entidade: 'gise',
		entidade_id: m.giseId,
		alvo_tipo: m.alvo.tipo,
		alvo_id: m.alvo.id,
		alvo_nome: m.alvo.nome ?? null,
		severidade: m.invalidacao === 'nada' ? 'info' : 'aviso',
		detalhes: m.detalhes,
		metadados: { ...(m.metadados ?? {}), invalidacao: m.invalidacao },
		dados_antes: m.dados_antes ?? null,
		dados_depois: m.dados_depois ?? null
	});
	return m.invalidacao;
}
