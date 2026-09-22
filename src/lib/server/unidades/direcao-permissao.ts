/**
 * Quem pode mexer na DIREÇÃO de uma unidade — o portão da ficha de unidade,
 * irmão de `$lib/server/policiais/ficha-permissao`.
 *
 * **A direção é indicação do DPI SUL (decisão E67, 22/09/2026): só o Admin
 * Geral registra.** Até então o admin de seccional PROPUNHA o titular ou o
 * respondente e o Admin Geral decidia na fila (tipo `direcao`) — a régua de
 * dois poderes que a ficha do servidor usa. Ele encerrou isso: a escolha de
 * quem dirige uma delegacia não nasce na seccional, nasce no departamento.
 * Ninguém mais escreve — o admin de seccional e o de unidade continuam VENDO
 * a direção na ficha, porque ver não é mexer.
 *
 * A exceção declarada é a respondência TEMPORÁRIA (E68), que tem caminho
 * próprio: a unidade indica quando tem Delegado Adjunto ou Auxiliar, a
 * seccional indica quando não tem, e o DPI SUL homologa. Ela não passa por
 * aqui — este portão é o da direção permanente.
 *
 * Como em todo portão do projeto, esconder o botão não é autorização: quem
 * recusa o POST direto é a action, chamando `modoDaDirecao` de novo.
 */
import { isAdminGeral, isAdminSeccional, isAdminUnidade, type UsuarioLogado } from '$lib/auth';

/** O que esta sessão pode fazer com a direção da unidade. */
export type ModoDirecao = 'direto' | 'leitura';

/** O modo desta sessão. Decidido UMA vez, conferido em cada action. */
export function modoDaDirecao(u: UsuarioLogado | null): ModoDirecao {
	return isAdminGeral(u) ? 'direto' : 'leitura';
}

/** A mensagem de recusa, uma só, para as actions não divergirem. */
export const RECUSA_DIRECAO =
	'A direção da unidade é indicação do DPI SUL: só o Administrador Geral a registra.';

/**
 * O que esta sessão pode fazer com a respondência TEMPORÁRIA (E68) — a
 * exceção declarada à E67, e por isso um modo próprio em vez de reaproveitar
 * `modoDaDirecao`.
 *
 * A diferença está no ato: a direção permanente o DPI SUL decide; a cobertura
 * de umas férias quem conhece é a casa. Então a unidade e a seccional
 * **indicam** — a unidade quando tem Delegado Adjunto ou Auxiliar ("em geral é
 * o adjunto que responde, mas precisa de confirmação"), a seccional quando não
 * tem —, o pedido vai para a fila e o DPI SUL homologa. O Admin Geral também
 * registra direto, sem passar pela fila.
 */
export type ModoRespondencia = 'direto' | 'indicacao' | 'leitura';

export function modoDaRespondencia(u: UsuarioLogado | null): ModoRespondencia {
	if (isAdminGeral(u)) return 'direto';
	if (isAdminSeccional(u) || isAdminUnidade(u)) return 'indicacao';
	return 'leitura';
}

/** A recusa da respondência — separada porque a régua é outra. */
export const RECUSA_RESPONDENCIA =
	'Seu perfil não indica respondência. A unidade ou a seccional indica; o DPI SUL homologa.';
