/**
 * Quem pode escrever a linha de base de qual unidade.
 *
 * A regra de negócio, em uma frase: **o admin informa a base das unidades que
 * ele administra E que participam daquela operação.** As duas condições são
 * necessárias — administrar uma delegacia não dá acesso a uma operação de que
 * ela não faz parte, e participar da operação não torna a unidade escrevível por
 * quem não a administra.
 *
 * Existe como resolvedor próprio, e não como mais um `if` na rota, pelo motivo
 * registrado no `CLAUDE.md`: a `unidade_id` chega no CORPO do POST, não na URL.
 * Um handler que confia nesse valor deixa qualquer admin autenticado reescrever
 * a base de qualquer delegacia — o mesmo formato do FLW-ESC-002, em que membro
 * de outra escala virava editável por ID.
 *
 * Espelha `adminParticipaDaGise` (`$lib/server/gise/permissao`), estendido ao
 * SLOT de unidade: na CRAJUBAR são as delegacias do Crato e de Barbalha que
 * entram por slot, e ignorá-los deixaria de fora justamente quem o plano nomeia.
 */
import { inArray } from 'drizzle-orm';
import { giseModeloFormulario } from '$lib/server/schema';
import { unidadesAdministradas } from '$lib/server/policial-permissao';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { unidadesParticipantesDaOperacao, listarOperacoes } from '$lib/db/operacoes';
import { extrairIndicadoresDeModelos, indicadoresComLinhaBase } from '$lib/gise/indicadores';
import { logger } from '$lib/server/logger';
import type { GiseModeloPerguntaConfig } from '$lib/types';
import type { Database } from '$lib/db';

/**
 * As unidades cuja base este usuário pode ler e escrever nesta operação.
 *
 * Set VAZIO significa "nenhuma" — e é o resultado correto para o policial sem
 * papel, para o admin de uma unidade que não participa, e para quem tem papel
 * mas está sem `papel_unidade_id`. O chamador transforma vazio em 403; nunca em
 * "então mostra tudo".
 *
 * O "administra" é a régua única de escopo (E75), e não uma cópia dela. Até a
 * E75 havia uma aqui dentro: a seccional expandida uma volta só, o admin de
 * unidade com a própria unidade e nada mais, e o Admin Geral com TODAS as
 * participantes em qualquer chapéu. Isso contrariava duas decisões dele — a
 * seccional vê tudo abaixo (E75) e, no chapéu de unidade, o Admin Geral vê só
 * os dados da unidade (E71) — sem que ninguém notasse, porque uma cópia de
 * regra não quebra teste nenhum quando a original muda.
 *
 * O Super Admin recebe todas as participantes (não `null`): a tela precisa da
 * lista concreta para renderizar as linhas, e um `null` de "irrestrito" só
 * empurraria a expansão para cada call site.
 */
export async function unidadesLinhaBaseAdministradas(
	db: Database,
	u: App.Locals['usuario'],
	operacaoId: number
): Promise<Set<number>> {
	if (!u) return new Set();

	const participantes = await unidadesParticipantesDaOperacao(db, operacaoId);
	const idsParticipantes = participantes.map((p) => p.id);

	// Em ids, porque o alvo é `operacao_linha_base.unidade_id`. O escopo vem do
	// PAPEL e não da lotação (FLW-RBAC-003) — a régua única já cuida disso, e de
	// devolver vazio a quem tem papel sem unidade.
	const escopo = await unidadesAdministradas(db, u);
	if (escopo === null) return new Set(idsParticipantes);
	return new Set(idsParticipantes.filter((id) => escopo.has(id)));
}

/**
 * O usuário pode escrever a base desta unidade nesta operação?
 *
 * Atalho para o caso de UMA unidade — a gravação vinda do formulário de
 * produtividade, em que a unidade já foi resolvida no servidor. A pergunta é a
 * mesma; só o formato da resposta muda.
 */
export async function podeInformarLinhaBase(
	db: Database,
	u: App.Locals['usuario'],
	operacaoId: number,
	unidadeId: number
): Promise<boolean> {
	const permitidas = await unidadesLinhaBaseAdministradas(db, u, operacaoId);
	return permitidas.has(unidadeId);
}

/** `config` JSON em árvore de perguntas; `[]` quando ausente ou corrompido. */
function parseModelo(raw: string | null | undefined): GiseModeloPerguntaConfig[] {
	if (!raw) return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v : [];
	} catch (err) {
		logger.warn('[operacoes/permissao] modelo JSON inválido', { err: String(err) });
		return [];
	}
}

/**
 * Quais destas operações PEDEM linha de base.
 *
 * Uma operação pede base quando o formulário dela tem ao menos um indicador de
 * meta PERCENTUAL — só ele é relativo a um valor anterior. Meta absoluta e meta
 * de cobertura não pedem nada à delegacia, e uma operação sem indicador nenhum
 * (o caso da GISE) também não.
 *
 * Existe como função porque a resposta é precisa em dois lugares que não se
 * conhecem: o BOTÃO "Dados base" na linha de cada operação em `/operacoes/gise/operacoes`
 * e a flag do menu (`temLinhaBaseAPreencher`, logo abaixo). Se os dois critérios
 * divergissem, o botão apareceria numa operação em que a tela não tem o que
 * pedir — ou sumiria de uma que tem.
 *
 * Uma consulta só para todos os modelos: a alternativa era duas por operação, e
 * um dos chamadores roda a cada navegação.
 */
export async function operacoesComLinhaBase(
	db: Database,
	operacoes: ReadonlyArray<{ id: number }>
): Promise<Set<number>> {
	if (operacoes.length === 0) return new Set();

	const modelos = await db
		.select({ operacao_id: giseModeloFormulario.operacao_id, config: giseModeloFormulario.config })
		.from(giseModeloFormulario)
		.where(
			inArray(
				giseModeloFormulario.operacao_id,
				operacoes.map((o) => o.id)
			)
		)
		.all();

	const porOperacao = new Map<number, string[]>();
	for (const m of modelos) {
		if (m.operacao_id == null) continue;
		const lista = porOperacao.get(m.operacao_id);
		if (lista) lista.push(m.config);
		else porOperacao.set(m.operacao_id, [m.config]);
	}

	const comBase = new Set<number>();
	for (const op of operacoes) {
		const configs = porOperacao.get(op.id) ?? [];
		const indicadores = indicadoresComLinhaBase(
			extrairIndicadoresDeModelos(configs.map(parseModelo))
		);
		if (indicadores.length > 0) comBase.add(op.id);
	}
	return comBase;
}

/**
 * As operações ATIVAS em que este usuário tem base a informar.
 *
 * Duas condições, e as duas precisam valer ao mesmo tempo para a MESMA operação:
 *
 * 1. a operação pede base (`operacoesComLinhaBase`);
 * 2. o usuário administra ao menos uma unidade participante dela.
 *
 * Sem a segunda, a lista incluiria operações de delegacias que o usuário não
 * administra; sem a primeira, incluiria operações em que não há o que preencher.
 * É a resposta que o índice de `/operacoes/dados-base` usa para decidir entre redirecionar
 * (uma só) e oferecer a escolha (mais de uma).
 *
 * Só ATIVAS: base de operação encerrada não é trabalho pendente.
 */
export async function operacoesComLinhaBasePendente(
	db: Database,
	u: App.Locals['usuario']
): Promise<Array<{ id: number; nome: string }>> {
	if (!u) return [];

	const ativas = await listarOperacoes(db, { somenteAtivas: true });
	if (ativas.length === 0) return [];

	// Filtra por modelo ANTES de consultar participação: descartar por leitura de
	// JSON já carregado é barato; a participação é um join de três tabelas por
	// operação.
	const comBase = await operacoesComLinhaBase(db, ativas);

	const minhas: Array<{ id: number; nome: string }> = [];
	for (const op of ativas) {
		if (!comBase.has(op.id)) continue;
		const permitidas = await unidadesLinhaBaseAdministradas(db, u, op.id);
		if (permitidas.size > 0) minhas.push({ id: op.id, nome: op.nome });
	}
	return minhas;
}

/**
 * Este admin de unidade/seccional tem alguma base a informar?
 *
 * É o que decide se a aba **Dados base** aparece na barra lateral.
 *
 * Devolve `false` para o Admin Geral — não por falta de permissão, mas porque
 * para ele a conferência é por operação e vive no botão de cada linha de
 * `/operacoes/gise/operacoes`. Quem chama isto é o menu; a autorização de `/operacoes/dados-base`
 * continua sendo `unidadesLinhaBaseAdministradas`, no servidor, para todo mundo.
 */
export async function temLinhaBaseAPreencher(
	db: Database,
	u: App.Locals['usuario']
): Promise<boolean> {
	if (!u || isAdminGeral(u)) return false;
	if (!isAdminSeccional(u) && !isAdminUnidade(u)) return false;
	if (u.papel_unidade_id == null) return false;

	return (await operacoesComLinhaBasePendente(db, u)).length > 0;
}
