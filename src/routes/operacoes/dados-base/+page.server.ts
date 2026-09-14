/**
 * `/operacoes/dados-base` — o ÍNDICE, não o preenchimento.
 *
 * Existe para responder uma pergunta antes de qualquer campo aparecer: **de qual
 * operação?** O preenchimento em si vive em `/operacoes/dados-base/[operacaoId]`, com a
 * operação no caminho.
 *
 * A separação é a correção de um risco concreto: o valor que se digita ali é o
 * denominador de um percentual divulgado, e a tela antiga trazia um seletor de
 * operação ao lado dos campos. Trocar de operação sem perceber — ou voltar ao
 * histórico com outro `?operacaoId=` — fazia o acervo de uma delegacia ser
 * gravado sob a operação errada, mudando o atingimento dela sem tocar em
 * relatório nenhum.
 *
 * Com uma pendência só — o caso comum do admin de unidade — nem escolha há:
 * redireciona direto, e a pessoa nunca vê esta tela.
 */
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDB } from '$lib/db';
import { isAnyAdmin } from '$lib/auth';
import { operacoesComLinhaBasePendente } from '$lib/server/operacoes/permissao';

export const load: PageServerLoad = async ({ locals, platform, depends }) => {
	depends('app:dados-base');

	const u = locals.usuario;
	if (!u || !isAnyAdmin(u)) error(403, 'Acesso restrito a administradores');

	const db = getDB(platform);
	const pendentes = await operacoesComLinhaBasePendente(db, u);

	// Uma só: a escolha não existe, então não se pergunta. `302` e não `308` — a
	// resposta muda quando outra operação ganhar indicador ou a unidade entrar
	// noutra escala, e um redirecionamento permanente ficaria cacheado no
	// navegador para sempre.
	if (pendentes.length === 1) redirect(302, `/operacoes/dados-base/${pendentes[0].id}`);

	return { pendentes };
};
