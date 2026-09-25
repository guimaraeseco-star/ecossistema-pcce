/**
 * Helpers de escopo administrativo sobre o cadastro de policiais.
 *
 * Modelo:
 *  - Super Admin: irrestrito (caller recebe `null`) — ele não é usuário
 *    operacional, e travá-lo no recorte fecharia a porta de quem conserta.
 *  - Admin Geral: a subárvore do NÓ da conta (E65) e, no chapéu de unidade,
 *    só a casa (E71). Deixou de ser irrestrito em 23/09: era `null`, e
 *    `null` numa base com dois departamentos é o admin de um vendo o outro.
 *  - admin_seccional: administra a própria seccional + todas as unidades
 *    cuja `seccional_id` é a dela.
 *  - admin_unidade: administra apenas a unidade do PAPEL
 *    (`papel_unidade_id`) — não a lotação atual.
 *  - Demais (policial sem papel): nada — caller deve barrar antes.
 *
 * Use em conjunto com `isAnyAdmin` para guarda de rota; este módulo cuida
 * apenas do recorte de "quais lotações o admin pode tocar".
 */

import { eq, or } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';
import { colaboradorComAcesso, isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { escopoDeUnidades } from '$lib/server/unidades/escopo';
import type { Database } from '$lib/db';

/**
 * Nomes da unidade `seccionalId` MAIS os das unidades subordinadas a ela — o
 * recorte de "a seccional e as delegacias abaixo dela".
 *
 * Devolve NOME, não id, porque é assim que policiais e escalas se ligam à
 * unidade (`policiais.lotacao`, `escalas.lotacao` — ver o cabeçalho de
 * `$lib/db/unidades`). Um id sem correspondência devolve `[]`.
 *
 * Existe separado de `lotacoesAdministradas` porque os call sites divergem no
 * que fazem com os OUTROS papéis — a listagem de escalas converte
 * `admin_unidade` num filtro de lotação única, e o poll de `/api/sync/estado`
 * nem precisa dele —, mas todos precisam desta mesma expansão. Antes de ser
 * extraída, ela estava reescrita em três lugares além daqui.
 */
export async function lotacoesDaSeccional(db: Database, seccionalId: number): Promise<string[]> {
	const rows = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.where(or(eq(unidades.id, seccionalId), eq(unidades.seccional_id, seccionalId)))
		.all();
	return rows.map((r) => r.nome);
}

/**
 * Os IDS da unidade `seccionalId` e das subordinadas a ela — irmã exata de
 * `lotacoesDaSeccional`, com a MESMA expansão de uma volta.
 *
 * É "uma volta", não a subárvore: o posto pendurado numa delegacia da
 * seccional NÃO entra. Isso difere de `escopoDeUnidades`, que desce a árvore
 * inteira — divergência conhecida e coberta em
 * `__tests__/escopo-duas-reguas.test.ts`, onde está escrito por que ela existe
 * e o que decidir sobre ela.
 */
async function idsDaSeccional(db: Database, seccionalId: number): Promise<number[]> {
	const rows = await db
		.select({ id: unidades.id })
		.from(unidades)
		.where(or(eq(unidades.id, seccionalId), eq(unidades.seccional_id, seccionalId)))
		.all();
	return rows.map((r) => r.id);
}

/** O nome da unidade, ou `null` se o id não existe. */
async function nomeDaUnidade(db: Database, unidadeId: number): Promise<string | null> {
	const r = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.where(eq(unidades.id, unidadeId))
		.get();
	return r?.nome ?? null;
}

/**
 * Retorna o conjunto de `lotacao` (nomes de unidade) que o usuário pode
 * administrar. `null` significa "sem restrição" (Admin Geral). Set vazio
 * significa que o usuário não tem escopo algum.
 *
 * **O escopo vem do PAPEL, não da lotação** (FLW-RBAC-003). Até ago/2026
 * `admin_unidade` recebia `new Set([u.lotacao])`, ignorando o
 * `papel_unidade_id` que a concessão exige e persiste. O papel então SEGUIA a
 * pessoa: quem foi nomeado administrador da DP 1 e depois transferido para a
 * DP 5 passava a administrar a DP 5 — uma autoridade que ninguém concedeu, e
 * que aparece sozinha numa movimentação de rotina.
 *
 * Sem `papel_unidade_id` o escopo é VAZIO, não a lotação: cair na lotação é
 * exatamente o defeito. Papel sem unidade é papel sem alcance, e a concessão
 * já recusa criá-lo assim.
 */
export async function lotacoesAdministradas(
	db: Database,
	u: NonNullable<App.Locals['usuario']>
): Promise<Set<string> | null> {
	if (isAdminGeral(u)) {
		if (u.isSuperAdmin) return null;
		// O MESMO escopo da Gestão de unidade, de propósito: duas réguas para "o
		// que este admin alcança" é como nasce a divergência entre telas. O
		// chapéu (E71) já está aplicado lá dentro.
		const escopo = await escopoDeUnidades(db, u);
		return new Set((escopo?.nos ?? []).map((n) => n.nome));
	}
	if (u.papel_unidade_id == null) return new Set();

	// Colaborador lotado (E61): a unidade dele, e só ela — o que ele pode
	// fazer nela é conferido chave a chave por quem chama.
	if (colaboradorComAcesso(u)) {
		const nome = await nomeDaUnidade(db, u.papel_unidade_id);
		return new Set(nome ? [nome] : []);
	}

	if (isAdminSeccional(u)) {
		// No chapéu de unidade a seccional é só uma casa: administra os próprios
		// servidores, não os das delegacias (E71).
		if (u.atuandoComo === 'unidade') {
			const escopo = await escopoDeUnidades(db, u);
			return new Set((escopo?.nos ?? []).map((n) => n.nome));
		}
		return new Set(await lotacoesDaSeccional(db, u.papel_unidade_id));
	}
	if (isAdminUnidade(u)) {
		const nome = await nomeDaUnidade(db, u.papel_unidade_id);
		return new Set(nome ? [nome] : []);
	}
	return new Set();
}

/**
 * O MESMO escopo de `lotacoesAdministradas`, em ids de unidade (E51).
 *
 * Existe ao lado do de nomes porque a migração é gradual: as consultas passam
 * a comparar `policiais.unidade_id` e `escalas.unidade_id`, que sobrevivem a
 * uma renomeação, enquanto o que ainda lê por nome continua funcionando.
 * Quando a última consulta por nome sair, `lotacoesAdministradas` some e fica
 * só esta.
 *
 * **Espelha a irmã galho por galho, de propósito.** A primeira versão desta
 * função (E51 parte 1) delegava TUDO a `escopoDeUnidades`, que desce a árvore
 * inteira — e isso não é o que a régua de nomes faz para `admin_seccional`
 * (uma volta) nem para `admin_unidade` (só a própria unidade). Trocar uma pela
 * outra numa consulta, portanto, não era migrar de nome para id: era ALARGAR
 * escopo de carona. Enquanto as duas convivem, elas têm de responder a mesma
 * coisa, e `__tests__/escopo-duas-reguas.test.ts` trava isso par a par.
 *
 * Qual das duas réguas é a CERTA é outra pergunta, e é dele: o comentário da
 * E71 diz que quem administra uma unidade administra "aquela unidade e os
 * postos dela", o que aponta para a árvore. Está registrado no ESTADO como
 * decisão pendente — e não se decide por efeito colateral de uma migração.
 *
 * `null` significa o mesmo de lá: sem restrição (Super Admin).
 */
export async function unidadesAdministradas(
	db: Database,
	u: NonNullable<App.Locals['usuario']>
): Promise<Set<number> | null> {
	if (isAdminGeral(u)) {
		if (u.isSuperAdmin) return null;
		const escopo = await escopoDeUnidades(db, u);
		return new Set((escopo?.nos ?? []).map((n) => n.id));
	}
	if (u.papel_unidade_id == null) return new Set();

	// Colaborador lotado (E61) e admin de unidade: a unidade do PAPEL, e só
	// ela. A conferência de existência não é zelo: a irmã de nomes devolve
	// vazio quando o id não existe, e sem isto o gêmeo devolveria um id órfão.
	if (colaboradorComAcesso(u) || isAdminUnidade(u)) {
		const existe = await nomeDaUnidade(db, u.papel_unidade_id);
		return new Set(existe ? [u.papel_unidade_id] : []);
	}

	if (isAdminSeccional(u)) {
		// No chapéu de unidade a seccional é só uma casa (E71).
		if (u.atuandoComo === 'unidade') {
			const escopo = await escopoDeUnidades(db, u);
			return new Set((escopo?.nos ?? []).map((n) => n.id));
		}
		return new Set(await idsDaSeccional(db, u.papel_unidade_id));
	}
	return new Set();
}

/** Aceita `null` (sem restrição) e retorna true para qualquer lotação nesse caso. */
export function lotacaoNoEscopo(escopo: Set<string> | null, lotacao: string): boolean {
	return escopo === null || escopo.has(lotacao);
}

/**
 * A unidade escolhida serve para o papel que está sendo concedido?
 *
 * `papel_unidade_id` é exigido pela tela, mas nunca foi validado: nem que a
 * unidade EXISTA, nem que o tipo dela faça sentido para o papel
 * (FLW-RBAC-003). Um id inexistente produz escopo vazio silencioso — o admin
 * é nomeado, a tela mostra o papel, e ele não administra nada. Um
 * `admin_seccional` apontando para uma DELEGACIA produz escopo de uma unidade
 * só, que é o de `admin_unidade` com outro nome.
 *
 * A regra de tipo é mínima de propósito: só recusa DELEGACIA para
 * `admin_seccional`. Delegacia não tem unidades subordinadas, então o papel
 * não teria o alcance que o nome promete — e para administrar uma unidade
 * isolada já existe `admin_unidade`. Departamento e sub-departamento são
 * aceitos porque a hierarquia os coloca acima da seccional, e há corporação
 * que organiza assim.
 *
 * Devolve `null` quando pode; a mensagem de recusa quando não.
 */
/**
 * Os papéis administrativos que existem. Lista FECHADA — a coluna tem três
 * estados possíveis: um destes dois, ou `null` (sem papel).
 */
export const PAPEIS_ADMINISTRATIVOS = ['admin_seccional', 'admin_unidade'] as const;

export type PapelAdministrativo = (typeof PAPEIS_ADMINISTRATIVOS)[number];

/**
 * Lê o papel de um valor cru, ou `undefined` quando ele não é papel nenhum.
 *
 * `null` e `undefined` são respostas DIFERENTES aqui: `null` é "sem papel", que
 * é escolha legítima (é assim que se remove o papel de alguém); `undefined` é
 * "isto não é um papel", que a action recusa.
 *
 * Existe porque `salvarPapel` fazia
 * `formData.get('papel')?.toString() || null as 'admin_seccional' | 'admin_unidade' | null`
 * — e `as` é CAST de TypeScript, que não existe em runtime. Um POST direto com
 * `papel=qualquer_coisa` atravessava: `motivoParaRecusarPapel` só confere a
 * UNIDADE (existe? serve ao papel?) e devolve `null` para papel desconhecido,
 * porque a única regra de papel que ela tem é sobre `admin_seccional`.
 *
 * Sendo preciso sobre o que isso era e o que não era: **não era escalada de
 * privilégio**. Todo consumidor compara por igualdade estrita contra os dois
 * nomes (`escalas/permissao.ts`, `gise/permissao.ts`, `sync-estado.ts`,
 * `useAutorizacao`), então papel desconhecido não concede nada — falha fechado
 * em toda parte. Era integridade: a coluna de RBAC aceitava valor que o sistema
 * não entende, gravado com linha no histórico e evento de auditoria dizendo
 * "papel alterado para <lixo>". Permissão que ninguém consegue explicar depois
 * é exatamente o que o histórico existe para evitar.
 */
export function lerPapelAdministrativo(bruto: unknown): PapelAdministrativo | null | undefined {
	// AUSENTE e LIXO não são a mesma coisa: `FormData.get` devolve `null` quando
	// o campo não veio (sem papel, legítimo) e um `File` quando alguém posta um
	// arquivo naquele nome (não é papel). Tratar os dois como `null` faria o
	// segundo REMOVER o papel de quem tinha — a versão anterior desta função
	// fazia isso, e o teste ao lado a pegou.
	if (bruto === null || bruto === undefined) return null;
	if (typeof bruto !== 'string') return undefined;
	const v = bruto.trim();
	if (v === '') return null;
	return (PAPEIS_ADMINISTRATIVOS as readonly string[]).includes(v)
		? (v as PapelAdministrativo)
		: undefined;
}

export async function motivoParaRecusarPapel(
	db: Database,
	papel: 'admin_seccional' | 'admin_unidade',
	unidadeId: number
): Promise<string | null> {
	const unidade = await db
		.select({ nome: unidades.nome, tipo: unidades.tipo })
		.from(unidades)
		.where(eq(unidades.id, unidadeId))
		.get();

	if (!unidade) {
		return 'A unidade de responsabilidade escolhida não existe.';
	}
	if (papel === 'admin_seccional' && unidade.tipo === 'delegacia') {
		return (
			`"${unidade.nome}" é uma delegacia e não tem unidades subordinadas — ` +
			'o papel de Admin de Seccional não teria alcance. Use Admin de Unidade.'
		);
	}
	return null;
}
