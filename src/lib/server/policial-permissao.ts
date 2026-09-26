/**
 * Helpers de escopo administrativo sobre o cadastro de policiais.
 *
 * Desde a E75 o recorte NÃO se calcula aqui: as duas funções abaixo delegam
 * para `escopoDeUnidades` (`$lib/server/unidades/escopo`), a régua única de
 * "quem administra o quê", e só mudam a MOEDA da resposta — nomes para o que
 * ainda compara por nome, ids para o que já migrou (E51). O modelo é o de lá:
 *  - Super Admin: irrestrito (caller recebe `null`) — ele não é usuário
 *    operacional, e travá-lo no recorte fecharia a porta de quem conserta.
 *  - Admin Geral: a subárvore do NÓ da conta (E65) e, no chapéu de unidade,
 *    só a casa (E71).
 *  - admin_seccional: a subárvore INTEIRA da seccional (E75) — "se enxerga a
 *    mãe, enxerga a filha", inclusive o posto que tem direção própria; no
 *    chapéu de unidade, só a casa.
 *  - admin_unidade: a unidade do PAPEL (`papel_unidade_id`, não a lotação) e
 *    os postos dela SEM direção própria (E75).
 *  - colaborador com acesso: SOMENTE a sua unidade (E75).
 *  - Demais (policial sem papel, papel sem unidade): nada.
 *
 * Use em conjunto com `isAnyAdmin` para guarda de rota; este módulo cuida
 * apenas do recorte de "quais lotações o admin pode tocar".
 */

import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';
import { isAdminGeral } from '$lib/auth';
import { escopoDeUnidades } from '$lib/server/unidades/escopo';
import type { Database } from '$lib/db';

/**
 * Os NOMES das unidades que o usuário administra. `null` = sem restrição
 * (Super Admin); conjunto vazio = não administra nada. Trocar um pelo outro
 * inverte o gate.
 *
 * **O escopo vem do PAPEL, não da lotação** (FLW-RBAC-003). Até ago/2026
 * `admin_unidade` recebia `new Set([u.lotacao])`, ignorando o
 * `papel_unidade_id` que a concessão exige e persiste. O papel então SEGUIA a
 * pessoa: quem foi nomeado administrador da DP 1 e depois transferido para a
 * DP 5 passava a administrar a DP 5 — uma autoridade que ninguém concedeu.
 * `escopoDeUnidades` mantém a regra: a raiz sai do papel.
 *
 * Até a E75 esta função tinha a SUA régua — a seccional expandida uma volta
 * só, o admin de unidade com a própria unidade e nada mais —, e a Gestão de
 * unidade tinha outra. As duas discordavam sobre quem a 1ª Seccional alcança.
 * Agora esta é só a tradução em nomes da régua única.
 */
export async function lotacoesAdministradas(
	db: Database,
	u: NonNullable<App.Locals['usuario']>
): Promise<Set<string> | null> {
	if (isAdminGeral(u) && u.isSuperAdmin) return null;
	const escopo = await escopoDeUnidades(db, u);
	return new Set((escopo?.nos ?? []).map((n) => n.nome));
}

/**
 * O MESMO escopo, em ids de unidade (E51) — as consultas que já migraram
 * comparam `policiais.unidade_id` e `escalas.unidade_id`, que sobrevivem a uma
 * renomeação. Quando a última consulta por nome sair, `lotacoesAdministradas`
 * some e fica só esta.
 *
 * As duas são gêmeas por CONSTRUÇÃO desde a E75 — a mesma chamada, em moedas
 * diferentes. Antes eram gêmeas por esforço, e já tinham divergido uma vez
 * (E51 parte 2b); `__tests__/escopo-duas-reguas.test.ts` trava o par.
 */
export async function unidadesAdministradas(
	db: Database,
	u: NonNullable<App.Locals['usuario']>
): Promise<Set<number> | null> {
	if (isAdminGeral(u) && u.isSuperAdmin) return null;
	const escopo = await escopoDeUnidades(db, u);
	return new Set((escopo?.nos ?? []).map((n) => n.id));
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
