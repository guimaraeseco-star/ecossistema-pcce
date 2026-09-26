/**
 * As TRAVAS da estrutura (E73) — o que o sistema recusa ao mexer na árvore de
 * unidades, e o que diz para a pessoa fazer antes.
 *
 * Nasceram de dois buracos achados em 25/09 com o caso de Fortim, um posto sob
 * Aracati onde quatro servidores lotados em Aracati TRABALHAM:
 *
 * 1. **Trocar a unidade-mãe** de Fortim (para Russas, digamos) deixava esses
 *    quatro com o "trabalha em" fora da lotação — a combinação que a ficha do
 *    servidor recusa, criada pela porta dos fundos.
 * 2. **Desativar** Fortim era permitido com os quatro apontando para ela. Na
 *    verdade, desativar era permitido com QUALQUER coisa dependendo da unidade:
 *    os vínculos eram só contados para o registro de auditoria, depois do fato.
 *
 * A decisão dele para a E73 é BARRAR e APONTAR O PASSO: "barre até ele fazer o
 * passo correto pelo guia indicativo". A ordem que ele corrigiu para a promoção
 * de posto vale aqui também: primeiro mover as pessoas, só depois mexer na
 * estrutura.
 *
 * **Uma fonte só para a recusa e para o guia.** O que impede um ato é calculado
 * uma vez, como PENDÊNCIAS estruturadas (quem, com a ficha de cada um), e as
 * duas saídas partem delas: o texto curto que a trava devolve (parte 1) e a
 * lista de passos com links que o guia mostra (parte 2). Se a recusa e o guia
 * calculassem cada um o seu, um dia um diria "pode" e o outro "não pode".
 *
 * As duas portas passam por aqui: a tela `/unidades` (editar e desativar) e a
 * sincronização com a planilha (`/api/webhook/sync-unidades`), que também troca
 * a unidade-mãe. E o guia (`/unidades/[id]/guia`) executa o ato no fim pelas
 * mesmas travas — ele não tem um caminho próprio que as contorne.
 */
import { and, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm';
import { arvoreUnidades, subarvoreDe, type Database } from '$lib/db';
import { escalas, policiais, unidades } from '$lib/server/schema';
import { quemPerdeOLocal } from '$lib/unidades/locais';
import { hojeBrasilISO } from '$lib/utils/datas';

/** Limite de 100 parâmetros por consulta do D1. */
const FATIA_D1 = 90;
/** Quantos nomes a mensagem lista antes de resumir em "e mais N". */
const MAX_NOMES = 10;

/** Um servidor que precisa de um ato de RH antes que a estrutura possa mudar. */
interface ServidorPendente {
	id: number;
	nome: string;
	lotacao: string;
}

/** Uma unidade que precisa ser resolvida antes (transferida ou desativada). */
interface UnidadePendente {
	id: number;
	nome: string;
}

/** O que impede, hoje, trocar a unidade-mãe de uma unidade. */
export interface PendenciasDaTrocaDeMae {
	unidade: { id: number; nome: string };
	/** Quem ficaria com o "trabalha em" fora da lotação. */
	perdemOLocal: ServidorPendente[];
}

/** O que impede, hoje, desativar uma unidade — e o que só se AVISA. */
export interface PendenciasDaDesativacao {
	unidade: { id: number; nome: string };
	lotados: ServidorPendente[];
	/** Trabalham nela sendo lotados em outra (o buraco de Fortim). */
	trabalhando: ServidorPendente[];
	filhasAtivas: UnidadePendente[];
	/**
	 * Escalas que ainda não terminaram. AVISO, não trava — decisão dele em
	 * 26/09, perguntado se a escala FUTURA deveria impedir a desativação:
	 * "avisa". O guia mostra quantas são e diz que continuam valendo.
	 */
	escalasNaoEncerradas: number;
}

const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

/** O que ainda depende da unidade, em uma palavra só. */
function quemDepende(gente: boolean, filhas: boolean): string {
	if (gente && filhas) return 'gente e unidades';
	return gente ? 'gente' : 'unidades';
}

/** Os nomes, sem repetição, em ordem, e resumidos quando são muitos. */
function listaDeNomes(nomes: readonly string[]): string {
	const unicos = [...new Set(nomes)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
	if (unicos.length <= MAX_NOMES) return unicos.join(', ');
	return `${unicos.slice(0, MAX_NOMES).join(', ')} e mais ${unicos.length - MAX_NOMES}`;
}

const porNome = <T extends { nome: string }>(lista: T[]) =>
	[...lista].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

/**
 * O que impede trocar a mãe de `unidadeId` para `novaMaeId`. `null` quando não
 * há o que avaliar: a unidade não existe na árvore ativa, ou a mãe não muda.
 *
 * Olha a unidade E tudo abaixo dela: ao trocar a mãe de uma delegacia, os
 * postos dela vão junto, e quem trabalha num desses postos também é afetado.
 */
export async function pendenciasDaTrocaDeMae(
	db: Database,
	unidadeId: number,
	novaMaeId: number | null
): Promise<PendenciasDaTrocaDeMae | null> {
	const arvore = await arvoreUnidades(db);
	const no = arvore.get(unidadeId);
	if (!no || no.seccional_id === novaMaeId) return null;

	const ids = subarvoreDe(arvore, unidadeId).map((n) => n.id);
	const servidores: (ServidorPendente & { unidade_id: number | null; local_id: number | null })[] =
		[];
	for (let i = 0; i < ids.length; i += FATIA_D1) {
		servidores.push(
			...(await db
				.select({
					id: policiais.id,
					nome: policiais.nome,
					lotacao: policiais.lotacao,
					unidade_id: policiais.unidade_id,
					local_id: policiais.local_id
				})
				.from(policiais)
				.where(
					and(eq(policiais.ativo, 1), inArray(policiais.local_id, ids.slice(i, i + FATIA_D1)))
				))
		);
	}

	const perdem = quemPerdeOLocal(arvore, unidadeId, novaMaeId, servidores).map(
		({ id, nome, lotacao }) => ({ id, nome, lotacao })
	);
	return { unidade: { id: no.id, nome: no.nome }, perdemOLocal: porNome(perdem) };
}

/**
 * O que impede desativar `unidadeId`. `null` só quando a unidade não existe.
 *
 * Três coisas impedem, todas "coisa viva dependendo da unidade":
 * - servidor ATIVO lotado nela;
 * - servidor ATIVO que trabalha nela sendo lotado em outra (o buraco de Fortim);
 * - unidade ATIVA abaixo dela — desativar a mãe tiraria a filha da árvore que
 *   o resto do sistema enxerga, e ela sumiria do escopo de todo mundo.
 *
 * O que NÃO impede: escalas, GISE e registros antigos. São o passado da
 * unidade, e desativar existe justamente para preservá-lo — a unidade nunca é
 * excluída. Nem o papel de administrador: quem administrava uma unidade
 * desativada só perde o alcance sobre ela.
 */
export async function pendenciasDaDesativacao(
	db: Database,
	unidadeId: number
): Promise<PendenciasDaDesativacao | null> {
	const unidade = await db
		.select({ id: unidades.id, nome: unidades.nome })
		.from(unidades)
		.where(eq(unidades.id, unidadeId))
		.get();
	if (!unidade) return null;

	const servidor = { id: policiais.id, nome: policiais.nome, lotacao: policiais.lotacao };
	const [lotados, trabalhando, filhas, abertas] = await Promise.all([
		db
			.select(servidor)
			.from(policiais)
			.where(and(eq(policiais.ativo, 1), eq(policiais.unidade_id, unidadeId))),
		db
			.select(servidor)
			.from(policiais)
			.where(
				and(
					eq(policiais.ativo, 1),
					eq(policiais.local_id, unidadeId),
					// Quem é lotado aqui e trabalha na sede já entrou como lotado.
					or(isNull(policiais.unidade_id), ne(policiais.unidade_id, unidadeId))
				)
			),
		db
			.select({ id: unidades.id, nome: unidades.nome })
			.from(unidades)
			.where(and(eq(unidades.seccional_id, unidadeId), eq(unidades.ativo, true))),
		db
			.select({ id: escalas.id })
			.from(escalas)
			.where(and(eq(escalas.unidade_id, unidadeId), gte(escalas.data_fim, hojeBrasilISO())))
	]);
	return {
		unidade,
		lotados: porNome(lotados),
		trabalhando: porNome(trabalhando),
		filhasAtivas: porNome(filhas),
		escalasNaoEncerradas: abertas.length
	};
}

/** A desativação tem alguma pendência que TRAVA (o aviso das escalas não trava). */
function desativacaoTravada(p: PendenciasDaDesativacao): boolean {
	return p.lotados.length + p.trabalhando.length + p.filhasAtivas.length > 0;
}

/** O texto curto da recusa da troca de mãe — as mesmas pendências que o guia lista. */
function textoDaRecusaDaTroca(p: PendenciasDaTrocaDeMae): string {
	const afetados = p.perdemOLocal;
	const um = afetados.length === 1;
	return [
		`Não é possível trocar a unidade-mãe de "${p.unidade.nome}" agora.`,
		`${plural(afetados.length, 'servidor trabalha', 'servidores trabalham')} ali sendo ${um ? 'lotado' : 'lotados'} em ${listaDeNomes(afetados.map((s) => s.lotacao))}. Com a troca, o local de trabalho ${um ? 'dele' : 'deles'} deixaria de pertencer à lotação, e o sistema não permite isso.`,
		'O que fazer, nesta ordem:',
		`1. Na ficha de ${um ? 'o servidor' : 'cada servidor'}, mude o "trabalha em" — ou mova a lotação (ato de RH, com NUP).`,
		'2. Depois, troque a unidade-mãe.',
		`${um ? 'Servidor' : 'Servidores'}: ${listaDeNomes(afetados.map((s) => s.nome))}.`
	].join('\n');
}

/** O texto curto da recusa da desativação — as mesmas pendências que o guia lista. */
function textoDaRecusaDaDesativacao(p: PendenciasDaDesativacao): string {
	const { lotados, trabalhando, filhasAtivas: filhas } = p;
	const passos: string[] = [];
	if (lotados.length > 0) {
		passos.push(
			`Mova a lotação ${lotados.length === 1 ? 'do servidor lotado' : `dos ${lotados.length} servidores lotados`} aqui (ato de RH, com NUP, na ficha de cada um): ${listaDeNomes(lotados.map((l) => l.nome))}.`
		);
	}
	if (trabalhando.length > 0) {
		passos.push(
			`Mude o "trabalha em" ${trabalhando.length === 1 ? 'do servidor que trabalha' : `dos ${trabalhando.length} servidores que trabalham`} aqui sendo lotado${trabalhando.length === 1 ? '' : 's'} em outra unidade: ${listaDeNomes(trabalhando.map((t) => t.nome))}.`
		);
	}
	if (filhas.length > 0) {
		passos.push(
			`Transfira para outra unidade-mãe, ou desative, ${filhas.length === 1 ? 'a unidade que fica abaixo desta' : `as ${filhas.length} unidades que ficam abaixo desta`}: ${listaDeNomes(filhas.map((f) => f.nome))}.`
		);
	}
	return [
		`Não é possível desativar "${p.unidade.nome}" agora: ainda há ${quemDepende(lotados.length + trabalhando.length > 0, filhas.length > 0)} dependendo dela.`,
		'O que fazer antes, nesta ordem:',
		...passos.map((passo, i) => `${i + 1}. ${passo}`),
		`${passos.length + 1}. Depois, desative.`
	].join('\n');
}

/**
 * A troca da unidade-mãe de `unidadeId` para `novaMaeId` deixaria alguém com o
 * "trabalha em" fora da lotação? Devolve o texto da recusa, ou `null` se pode.
 */
export async function travaDaTrocaDeMae(
	db: Database,
	unidadeId: number,
	novaMaeId: number | null
): Promise<string | null> {
	const p = await pendenciasDaTrocaDeMae(db, unidadeId, novaMaeId);
	return p && p.perdemOLocal.length > 0 ? textoDaRecusaDaTroca(p) : null;
}

/** Pode desativar `unidadeId`? Devolve o texto da recusa, ou `null` se pode. */
export async function travaDaDesativacao(db: Database, unidadeId: number): Promise<string | null> {
	const p = await pendenciasDaDesativacao(db, unidadeId);
	return p && desativacaoTravada(p) ? textoDaRecusaDaDesativacao(p) : null;
}

/**
 * A mesma trava da troca de mãe, para a sincronização com a planilha, que
 * identifica a unidade pelo NOME. Unidade que ainda não existe não tem quem
 * perder o local; e, se a mãe não muda, nem a árvore é carregada.
 */
export async function travaDaSincronizacao(
	db: Database,
	nome: string,
	novaMaeId: number | null
): Promise<string | null> {
	const existente = await db
		.select({ id: unidades.id, seccional_id: unidades.seccional_id })
		.from(unidades)
		.where(eq(unidades.nome, nome.trim()))
		.get();
	if (!existente || existente.seccional_id === novaMaeId) return null;
	return travaDaTrocaDeMae(db, existente.id, novaMaeId);
}
