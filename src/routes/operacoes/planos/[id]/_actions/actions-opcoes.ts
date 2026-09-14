/**
 * Form actions das OPÇÕES do plano — as listas de local de briefing e de
 * cidade de destino que alimentam os seletores das equipes.
 *
 * Entram todas pelo mesmo preâmbulo (`planoDaRota`) das demais: o id da opção
 * vem do FORMULÁRIO, e é a camada de dados que confere se ela pertence ao plano
 * da URL antes de tocar em qualquer linha. Sem essa amarra, ser Admin Geral
 * bastaria para trocar a opção padrão de OUTRO plano por POST direto — a classe
 * do FLW-ESC-002.
 *
 * A repetição de valor é recusada pelo ÍNDICE, e não por um `SELECT` antes: ver
 * o cabeçalho de `$lib/db/planos/opcoes.ts`.
 */
import { fail } from '@sveltejs/kit';
import {
	adicionarOpcao,
	definirOpcaoPadrao,
	removerOpcao,
	auditar,
	contextoDeEvento,
	type TipoOpcao
} from '$lib/db';
import { planoDaRota, getInt, getTexto, type EventoPlano } from './shared';

/** Os três tipos aceitos. Qualquer outro valor no corpo é recusado. */
const TIPOS: readonly TipoOpcao[] = ['briefing', 'origem', 'destino'];

/**
 * Como a lista se chama nas mensagens ao usuário.
 *
 * A frase é montada como "… na lista de X" em vez de "Este X já está…" porque
 * os dois nomes têm GÊNEROS diferentes — "este local" e "esta cidade" — e um
 * artigo fixo produziria "Este cidade de destino", que foi o que a primeira
 * versão exibiu.
 */
const LISTA: Record<TipoOpcao, string> = {
	briefing: 'locais de briefing',
	origem: 'cidades de origem',
	destino: 'cidades de destino'
};

/** O tipo pedido, ou `null` quando o corpo trouxe outra coisa. */
function tipoDoCorpo(fd: FormData): TipoOpcao | null {
	const bruto = String(fd.get('tipo') ?? '');
	return (TIPOS as readonly string[]).includes(bruto) ? (bruto as TipoOpcao) : null;
}

export const actionsOpcoes = {
	/** Acrescenta uma opção à lista do tipo. A primeira de cada tipo vira padrão. */
	adicionarOpcao: async (event: EventoPlano) => {
		const ctx = await planoDaRota(event);
		if ('erro' in ctx) return ctx.erro;
		const { db, plano } = ctx;

		const fd = await event.request.formData();
		const tipo = tipoDoCorpo(fd);
		if (!tipo) return fail(400, { error: 'Tipo de opção inválido.' });

		const valor = getTexto(fd, 'valor', 200);
		if (!valor) return fail(400, { error: `Preencha antes de acrescentar à lista.` });

		// O município é OPCIONAL: briefing sem cidade informada é estado válido (a
		// tela avisa), e sem ele o trajeto da equipe é medido de ponta a ponta.
		const municipio = getTexto(fd, 'municipio_ibge', 7) || null;

		const r = await adicionarOpcao(db, plano.id, tipo, valor, municipio);
		if (!r.ok) {
			return fail(409, {
				error:
					r.motivo === 'repetida'
						? `"${valor}" já está na lista de ${LISTA[tipo]}.`
						: `Não foi possível acrescentar à lista de ${LISTA[tipo]}.`
			});
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Opção "${valor}" acrescentada à lista de ${LISTA[tipo]}`,
				dados_depois: { tipo, valor, municipio },
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/** Marca a opção como padrão do tipo dela, tirando a marca da anterior. */
	definirOpcaoPadrao: async (event: EventoPlano) => {
		const ctx = await planoDaRota(event);
		if ('erro' in ctx) return ctx.erro;
		const { db, plano } = ctx;

		const fd = await event.request.formData();
		const opcaoId = getInt(fd, 'opcao_id');
		if (!Number.isInteger(opcaoId)) return fail(400, { error: 'Opção inválida.' });

		const ok = await definirOpcaoPadrao(db, plano.id, opcaoId);
		if (!ok) return fail(404, { error: 'Opção não encontrada neste plano.' });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Opção #${opcaoId} definida como padrão`,
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/**
	 * Remove a opção da lista.
	 *
	 * Não toca no que as equipes já escolheram: elas guardam o TEXTO, não uma
	 * referência. Apagar a opção não pode esvaziar o destino de uma equipe
	 * montada, muito menos o de um plano cujo documento já circulou.
	 */
	removerOpcao: async (event: EventoPlano) => {
		const ctx = await planoDaRota(event);
		if ('erro' in ctx) return ctx.erro;
		const { db, plano } = ctx;

		const fd = await event.request.formData();
		const opcaoId = getInt(fd, 'opcao_id');
		if (!Number.isInteger(opcaoId)) return fail(400, { error: 'Opção inválida.' });

		const ok = await removerOpcao(db, plano.id, opcaoId);
		if (!ok) return fail(404, { error: 'Opção não encontrada neste plano.' });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_plano_operacional',
				usuario: event.locals.usuario,
				entidade: 'plano_operacional',
				entidade_id: plano.id,
				detalhes: `Opção #${opcaoId} removida da lista`,
				...contexto
			},
			{ env }
		);

		return { success: true };
	}
};
