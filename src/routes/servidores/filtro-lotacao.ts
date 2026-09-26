/**
 * Os valores especiais do filtro "Unidade de Lotação" de `/servidores`, num
 * lugar só para a tela e o `load`.
 *
 * Existe porque os dois discordavam: a tela oferecia "— Sem lotação —", mas
 * nunca mandava o pedido na URL, e o `load` nunca o lia — escolher a opção
 * mostrava TODOS os servidores (achado da E76, em 26/09). Com a constante
 * compartilhada, o que a tela manda é o que o `load` reconhece.
 */

/** Servidores sem unidade no sistema (`unidade_id` vazio). */
export const SEM_LOTACAO = '__sem_lotacao__';

/** Sem filtro de lotação — o mesmo sentinela que `listarPoliciais` entende. */
export const TODAS_UNIDADES = '__todas__';
