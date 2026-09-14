/**
 * Grava a ORDEM dos cards do painel de produtividade — o que o Admin Geral
 * acabou de arrastar em `/operacoes/produtividade`.
 *
 * Endpoint próprio, e não uma form action de `/operacoes/produtividade`, por duas razões:
 * a tela é um `load` sem `<form>` nenhum, e o corpo é uma lista de ids montada
 * pelo JavaScript do arraste. É o caso que o `CLAUDE.md` reserva para
 * `apiFetch` — form action existe para POST de `FormData`.
 *
 * ## Quem pode
 *
 * `/operacoes/produtividade` é visível para Admin Geral, admin de seccional e admin de
 * unidade (estes dois com os dados recortados às unidades que administram —
 * eles informam a linha de base dos indicadores). ORGANIZAR o painel é outra
 * coisa: a ordem é única, vale para todo mundo que abre a operação, e é
 * configuração do mesmo tipo que o formulário — cujo editor já é exclusivo do
 * Admin Geral. Por isso `requireAdmin`, e não `isAnyAdmin`: o painel escopado é
 * uma LEITURA recortada, não uma cópia do painel que cada admin pudesse arrumar
 * para si.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarOperacao,
	operacaoAceitaTipoEquipe,
	salvarOrdemPainelProdutividade
} from '$lib/db';
import { painelOrdemSchema } from '$lib/schemas';
import { requireAdmin, validateBody, notFound, badRequest, serverError } from '$lib/server/api';

export const PUT: RequestHandler = async ({ request, locals, platform }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const v = await validateBody(request, painelOrdemSchema);
	if (!v.ok) return v.response;
	const { operacaoId, tipo, ordem } = v.data;

	const db = getDB(platform);

	const operacao = await buscarOperacao(db, operacaoId);
	if (!operacao) return notFound('Operação');
	// O mesmo gate da action que salva o modelo: a tela esconde o tipo que a
	// operação não usa, e quem recusa o PUT direto é isto.
	if (!operacaoAceitaTipoEquipe(operacao, tipo)) {
		return badRequest(
			`A operação ${operacao.nome} não usa equipe do tipo ${
				tipo === 'seint' ? 'inteligência (SEINT)' : 'operacional'
			}.`
		);
	}

	try {
		const gravou = await salvarOrdemPainelProdutividade(db, operacaoId, tipo, ordem);
		// Sem modelo salvo não há card no painel, logo não há ordem que se perca —
		// mas devolver 200 faria a tela dizer "ordem salva" sobre nada. 404 é a
		// leitura honesta, e a mensagem aponta onde é o conserto.
		if (!gravou) return notFound('Formulário desta operação');
		return json({ success: true });
	} catch (err) {
		return serverError('[api/produtividade/ordem] falha ao gravar a ordem do painel', err);
	}
};
