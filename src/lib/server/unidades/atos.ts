/**
 * Os ATOS de estrutura que o guia executa (E73) — desativar/reativar uma
 * unidade e trocar a unidade-mãe —, num lugar só.
 *
 * A decisão dele para a E73 divide as coisas assim: o assistente EXECUTA o ato
 * cadastral, avisando antes; e CONDUZ ao formulário certo o ato de RH (lotar,
 * movimentar), que continua assinado por quem tem competência, com NUP. Os dois
 * atos daqui são cadastrais, e por isso o guia os executa no último passo.
 *
 * Existem como funções, e não como mais um trecho dentro da rota do guia, para
 * que a tela `/unidades` e o guia passem pelo MESMO caminho: as mesmas travas,
 * o mesmo registro de auditoria. Um guia com caminho próprio seria uma porta ao
 * lado da porta — e a primeira coisa que a E73 fechou foi justamente uma porta
 * ao lado (a sincronização com a planilha, que trocava a mãe por fora da tela).
 */
import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import {
	auditar,
	contextoDeEvento,
	definirUnidadeAtiva,
	descreverVinculosUnidade,
	motivoParaRecusarSuperior,
	vinculosDaUnidade,
	type Database
} from '$lib/db';
import { unidades } from '$lib/server/schema';
import type { UsuarioLogado } from '$lib/auth';
import { travaDaDesativacao, travaDaTrocaDeMae } from './travas';

/** O desfecho de um ato: feito, ou a recusa com o status HTTP que a explica. */
export type DesfechoDoAto = { ok: true } | { ok: false; status: number; erro: string };

/**
 * Desativa ou reativa a unidade. Desativar passa pela trava (E73): com gente ou
 * unidade viva dependendo dela, é recusado com os passos. Reativar nunca trava.
 *
 * **Não existe excluir** — ver o cabeçalho de `/unidades`: apagar a linha
 * destruiria prova de documento assinado. Desativar preserva o passado.
 */
export async function alternarAtivoDaUnidade(
	event: RequestEvent,
	db: Database,
	u: UsuarioLogado,
	unidadeId: number,
	ativo: boolean
): Promise<DesfechoDoAto> {
	const unidade = await db.select().from(unidades).where(eq(unidades.id, unidadeId)).get();
	if (!unidade) return { ok: false, status: 404, erro: 'Unidade não encontrada' };

	if (!ativo) {
		const trava = await travaDaDesativacao(db, unidadeId);
		if (trava) return { ok: false, status: 409, erro: trava };
	}

	await definirUnidadeAtiva(db, unidadeId, ativo);

	const vinculos = ativo ? null : await vinculosDaUnidade(db, unidadeId);
	const resumo = vinculos ? descreverVinculosUnidade(vinculos) : null;
	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: ativo ? 'reativar_unidade' : 'desativar_unidade',
			usuario: u,
			entidade: 'unidade',
			entidade_id: unidadeId,
			alvo_tipo: 'unidade',
			alvo_id: unidadeId,
			alvo_nome: unidade.nome,
			detalhes: ativo
				? `Unidade reativada: ${unidade.nome}`
				: `Unidade desativada: ${unidade.nome}${resumo ? ` (mantém ${resumo})` : ''}`,
			dados_antes: unidade,
			dados_depois: { ...unidade, ativo },
			...contexto
		},
		{ env }
	);
	return { ok: true };
}

/**
 * Troca só a unidade-mãe — o ato do guia de transferência. A edição completa da
 * unidade (nome, regimes, contato) continua na tela `/unidades`, e passa pelas
 * mesmas duas recusas que estão aqui: o ciclo na árvore e a trava do "trabalha
 * em" (E73).
 */
export async function trocarMaeDaUnidade(
	event: RequestEvent,
	db: Database,
	u: UsuarioLogado,
	unidadeId: number,
	novaMaeId: number | null
): Promise<DesfechoDoAto> {
	const antes = await db.select().from(unidades).where(eq(unidades.id, unidadeId)).get();
	if (!antes) return { ok: false, status: 404, erro: 'Unidade não encontrada' };
	if (antes.seccional_id === novaMaeId) {
		return { ok: false, status: 400, erro: 'Essa já é a unidade-mãe desta unidade.' };
	}

	const ciclo = await motivoParaRecusarSuperior(db, unidadeId, novaMaeId);
	if (ciclo) return { ok: false, status: 400, erro: ciclo };
	const trava = await travaDaTrocaDeMae(db, unidadeId, novaMaeId);
	if (trava) return { ok: false, status: 409, erro: trava };

	const nomeDe = async (id: number | null) =>
		id == null
			? 'nenhuma'
			: ((await db.select({ nome: unidades.nome }).from(unidades).where(eq(unidades.id, id)).get())
					?.nome ?? `#${id}`);
	const [maeAntiga, maeNova] = await Promise.all([nomeDe(antes.seccional_id), nomeDe(novaMaeId)]);

	await db.update(unidades).set({ seccional_id: novaMaeId }).where(eq(unidades.id, unidadeId));

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'editar_unidade',
			usuario: u,
			entidade: 'unidade',
			entidade_id: unidadeId,
			alvo_tipo: 'unidade',
			alvo_id: unidadeId,
			alvo_nome: antes.nome,
			detalhes: `Unidade-mãe trocada pelo guia: ${maeAntiga} → ${maeNova}`,
			dados_antes: antes,
			dados_depois: { ...antes, seccional_id: novaMaeId },
			...contexto
		},
		{ env }
	);
	return { ok: true };
}
