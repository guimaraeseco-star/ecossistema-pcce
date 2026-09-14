/**
 * Quais tipos de equipe uma operação habilita — a versão de CLIENTE.
 *
 * Existe separada de `tiposEquipeDaOperacao` (`$lib/db/operacoes/crud`) porque
 * aquela importa `$lib/server/schema` e não pode atravessar para o navegador. A
 * regra em si é a mesma, e ela tem dois call sites de tela: o editor de
 * formulário em `/operacoes/presenca` e o filtro de tipo de equipe em `/operacoes/produtividade`.
 *
 * O fallback quando a operação não habilita nada NÃO é lista vazia: o banco
 * aceita `(0,0)` e a aplicação não — operação sem tipo de equipe não escala
 * ninguém e deixaria a tela sem aba nenhuma para mostrar. Cai em `operacional`,
 * que é o histórico.
 *
 * Isto NÃO é autorização: quem recusa a gravação de um tipo desabilitado é a
 * action no servidor. Aqui é só o que a tela oferece.
 */

/** Os tipos de equipe, na ordem em que a UI os apresenta. */
export type TipoEquipe = 'operacional' | 'seint';

/**
 * Teto de vagas (DPC ou OIP) de UMA equipe — o `max` dos campos de vaga em
 * `GiseEquipeCard` e `GiseSlotUnidade`, e a faixa que o servidor impõe.
 *
 * Mora aqui porque o número estava escrito à mão em quatro `max="20"` de tela e
 * em NENHUM lugar do servidor: `salvarSlotsEquipe` e `adicionarEquipe` faziam só
 * `parseInt` + `isNaN`. As vagas entram na comparação `COUNT(*) < e.slots_dpc`
 * que decide a alocação ATOMICAMENTE (FLW-GISE-009) — com `slots_dpc=999999` por
 * POST direto o controle de lotação deixava de existir, e com `-1` a equipe
 * passava a recusar todo mundo respondendo "vagas esgotadas" para uma equipe
 * vazia. O nível equivalente em `/operacoes/gise/operacoes` (vagas padrão da operação) JÁ
 * validava 0..999 no servidor; era este que não validava.
 */
export const MAX_VAGAS_EQUIPE = 20;

/** Os tipos que ESTA operação usa. `null`/indefinida devolve os dois. */
export function tiposEquipeHabilitados(
	op: { usa_equipe_operacional: boolean; usa_equipe_seint: boolean } | null | undefined
): TipoEquipe[] {
	if (!op) return ['operacional', 'seint'];
	const t: TipoEquipe[] = [];
	if (op.usa_equipe_operacional) t.push('operacional');
	if (op.usa_equipe_seint) t.push('seint');
	return t.length > 0 ? t : ['operacional'];
}
