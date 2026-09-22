/**
 * O catálogo de DESIGNAÇÕES — a função que o servidor exerce na unidade
 * (Delegado Titular, Chefe de seção de expedientes e cartório, Operacional,
 * Plantão…), com o símbolo da gratificação quando há (DAS/DNS).
 *
 * É catálogo parametrizado, e não enum no código, porque a lista veio da
 * planilha de pessoal do DPI Sul e muda por ato da corporação — quem inclui
 * uma função nova não deveria precisar de deploy. A tabela nasceu semeada na
 * migração 0088 com os 17 valores da planilha.
 *
 * Duas perguntas diferentes, dois lugares: aqui mora a LEITURA para a tela
 * (lista do `<select>` e do filtro); `idDaDesignacao`, que casa o TEXTO da
 * planilha com a linha do catálogo durante a carga, mora em `carga-planilha.ts`
 * junto do resto da importação.
 */
import { and, asc, eq } from 'drizzle-orm';
import { designacoes } from '../../server/schema';
import type { Database } from '../core';

/** Uma designação como a tela a consome. */
export interface DesignacaoDaTela {
	id: number;
	nome: string;
	simbolo: string;
}

/**
 * As designações ativas, na ordem de precedência funcional do catálogo
 * (direção primeiro, chefias de seção depois, funções de base por último) —
 * `ordem` existe para que a lista da tela não saia em ordem alfabética, que
 * misturaria "Cartório" com "Chefe de seção" e "Delegado Titular".
 */
export async function listarDesignacoes(db: Database): Promise<DesignacaoDaTela[]> {
	return db
		.select({ id: designacoes.id, nome: designacoes.nome, simbolo: designacoes.simbolo })
		.from(designacoes)
		.where(eq(designacoes.ativo, true))
		.orderBy(asc(designacoes.ordem), asc(designacoes.nome))
		.all();
}

/**
 * Existe e está ativa? É o que o servidor pergunta antes de gravar o
 * `designacao_id` que veio de um `<select>` — o POST direto pode mandar
 * qualquer número, e FK sem checagem devolveria 500 em vez de recusa legível.
 */
export async function designacaoAtiva(db: Database, id: number): Promise<boolean> {
	const linha = await db
		.select({ id: designacoes.id })
		.from(designacoes)
		.where(and(eq(designacoes.id, id), eq(designacoes.ativo, true)))
		.get();
	return !!linha;
}

/**
 * As designações que são DIREÇÃO da unidade — titular, adjunto e auxiliar — e
 * que por isso só cabem em delegado (E69, 22/09/2026).
 *
 * A distinção que a decisão fixou: administrar a unidade NO SISTEMA (o papel
 * `admin_unidade`) é acesso e pode ser DPC ou OIP; dirigir a unidade é função
 * da estrutura e é só de DPC. Chefe de seção fica de fora desta lista de
 * propósito: ele chefia uma seção DENTRO da unidade, não a unidade, e pode ser
 * OIP.
 *
 * Casa pelo NOME porque o catálogo é parametrizado (a corporação inclui função
 * nova sem deploy) e os ids seriam uma segunda fonte a manter sincronizada.
 */
const DESIGNACOES_DE_DIRECAO = ['delegado titular', 'delegado adjunto', 'delegado auxiliar'];

/**
 * A designação escolhida cabe neste cargo? Devolve o motivo da recusa, ou
 * `null` quando pode. `designacaoId` nulo (sem designação) sempre pode.
 */
export async function motivoParaRecusarDesignacao(
	db: Database,
	designacaoId: number | null,
	cargo: string
): Promise<string | null> {
	if (designacaoId == null || cargo === 'DPC') return null;
	const linha = await db
		.select({ nome: designacoes.nome })
		.from(designacoes)
		.where(eq(designacoes.id, designacaoId))
		.get();
	if (!linha) return null;
	if (!DESIGNACOES_DE_DIRECAO.includes(linha.nome.trim().toLowerCase())) return null;
	return `"${linha.nome}" é função de direção da unidade e só cabe em delegado (DPC). Chefia de seção, sim, pode ser OIP.`;
}
