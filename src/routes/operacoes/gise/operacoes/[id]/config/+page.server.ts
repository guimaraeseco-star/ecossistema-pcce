/**
 * `/operacoes/gise/operacoes/[id]/config` — aposentada.
 *
 * A configuração de escala da operação (vagas padrão, horários e textos do breve
 * relatório) deixou de ter tela própria: ela é metade do formulário da operação,
 * junto da identidade, em `/operacoes/gise/operacoes`. Separá-las nunca correspondeu a
 * nada — descrevem a mesma operação —, e quem criava uma operação nova saía da
 * tela com metade dela por preencher.
 *
 * Continua respondendo, e com `308`, porque o endereço circulou: era o destino
 * do botão "Configurações" de cada linha e pode estar salvo em favorito. O
 * redirecionamento leva direto ao painel de edição daquela operação, que é onde
 * os mesmos campos vivem agora.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const id = Number(params.id);
	redirect(
		308,
		Number.isInteger(id) && id > 0
			? `/operacoes/gise/operacoes?form=${id}`
			: '/operacoes/gise/operacoes'
	);
};
