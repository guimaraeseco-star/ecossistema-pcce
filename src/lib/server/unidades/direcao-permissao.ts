/**
 * Quem pode mexer na DIREÇÃO de uma unidade — o portão da ficha de unidade,
 * irmão de `$lib/server/policiais/ficha-permissao`.
 *
 * A mesma régua de dois poderes que a ficha do servidor usa, e pelo mesmo
 * motivo (decisão do responsável em 16/09/2026):
 *
 * - **`direto`** (Admin Geral): registra e encerra a direção, e vale na hora.
 *   Ele não depende de pedido de ninguém — homologar o que a seccional propõe
 *   é UMA das portas dele, não a única;
 * - **`proposta`** (admin de seccional): propõe quem dirige as unidades da
 *   subárvore dele, com justificativa, e quem decide é o Admin Geral. É o
 *   seccional quem sabe qual delegado está respondendo por qual delegacia;
 * - **ninguém mais escreve.** O admin de UNIDADE fica de fora de propósito:
 *   designar o próprio dirigente não é algo que a unidade propõe sobre si
 *   mesma. Ele continua vendo a ficha e a direção — ver não é mexer.
 *
 * Como em todo portão do projeto, esconder o botão não é autorização: quem
 * recusa o POST direto é a action, chamando `modoDaDirecao` de novo.
 */
import { isAdminGeral, isAdminSeccional, type UsuarioLogado } from '$lib/auth';

/** O que esta sessão pode fazer com a direção da unidade. */
export type ModoDirecao = 'direto' | 'proposta' | 'leitura';

/** O modo desta sessão. Decidido UMA vez, conferido em cada action. */
export function modoDaDirecao(u: UsuarioLogado | null): ModoDirecao {
	if (isAdminGeral(u)) return 'direto';
	if (isAdminSeccional(u)) return 'proposta';
	return 'leitura';
}

/** A mensagem de recusa, uma só, para as três actions não divergirem. */
export const RECUSA_DIRECAO =
	'Seu perfil não registra a direção da unidade. O admin de seccional propõe; quem decide é o Administrador Geral.';
