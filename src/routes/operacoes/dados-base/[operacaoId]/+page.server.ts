/**
 * `/operacoes/dados-base/[operacaoId]` — onde a unidade informa a LINHA DE BASE de cada
 * indicador DAQUELA operação.
 *
 * É o denominador que faltava. "Redução mínima de 20% do acervo de inquéritos
 * pendentes" não é calculável sem saber o acervo de partida, e esse número só a
 * delegacia tem — o próprio Plano Operacional da CRAJUBAR lista a ausência dele
 * como risco, com a mitigação de "levantamento do acervo atual em cada unidade
 * nos primeiros 10 dias".
 *
 * Quem entra: Admin Geral, admin seccional e admin de unidade. O que cada um vê
 * e pode gravar sai de `unidadesLinhaBaseAdministradas` — nunca da tela. A
 * `unidade_id` chega no corpo do POST, então a action a confere contra o mesmo
 * conjunto antes de escrever; sem isso, qualquer admin autenticado reescreveria
 * a base de qualquer delegacia, e a base é parâmetro de resultado divulgado.
 *
 * Os indicadores vêm dos DOIS formulários da operação (operacional e SEINT),
 * unificados por `key`: a base é da UNIDADE, não da equipe, então pedir o mesmo
 * número duas vezes seria pedir duas vezes a mesma coisa.
 *
 * ## A operação está no CAMINHO, não num seletor
 *
 * Até ago/2026 ela vinha de `?operacaoId=` e a tela trazia um `<select>` ao lado
 * dos campos. O valor aqui é o denominador de um percentual divulgado: digitá-lo
 * sob a operação errada muda o atingimento de uma unidade sem tocar em relatório
 * nenhum, e um seletor convivendo com os campos é exatamente o convite a esse
 * erro. Com a operação no caminho não há controle a errar — trocar de operação é
 * navegar, e o índice (`/operacoes/dados-base`) é quem oferece a escolha, ANTES dos campos.
 *
 * ## O destino do "Voltar" vem do SERVIDOR
 *
 * Ele não pode ser fixo em `/operacoes/dados-base`: o índice REDIRECIGE para cá quando há
 * uma pendência só, então o Voltar fixo devolvia a pessoa à mesma tela. Quem
 * calcula é o `load`, porque só ele sabe quantas pendências existem e por qual
 * porta o usuário entrou — ver `destinoDeVolta`.
 */
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	listarOperacoes,
	buscarOperacao,
	buscarGiseModeloFormulario,
	listarLinhaBase,
	upsertLinhaBase,
	unidadesParticipantesDaOperacao,
	auditar,
	contextoDeEvento
} from '$lib/db';
import type { Database } from '$lib/db';
import { isAdminGeral, isAnyAdmin } from '$lib/auth';
import {
	unidadesLinhaBaseAdministradas,
	operacoesComLinhaBasePendente
} from '$lib/server/operacoes/permissao';
import { extrairIndicadoresDeModelos, indicadoresComLinhaBase } from '$lib/gise/indicadores';
import { logger } from '$lib/server/logger';
import type { GiseModeloPerguntaConfig } from '$lib/types';

/**
 * Bases já informadas, indexadas por unidade e por indicador — a forma que a
 * grade da tela consome sem varrer uma lista a cada célula.
 */
type ValoresPorUnidade = Record<
	number,
	Record<string, { valor: number; observacao: string; informadoPor: string; em: string }>
>;

/** JSON do `config` em árvore de perguntas; `[]` quando ausente ou corrompido. */
function parseModelo(raw: string | null | undefined, rotulo: string): GiseModeloPerguntaConfig[] {
	if (!raw) return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v : [];
	} catch (err) {
		logger.warn(`[dados-base] modelo ${rotulo} JSON inválido`, { err: String(err) });
		return [];
	}
}

/**
 * Para onde o "Voltar" desta tela leva — ou `null` quando não há para onde.
 *
 * O destino depende de por qual porta se entrou, e nenhuma das duas é
 * `/operacoes/dados-base` incondicionalmente:
 *
 * - **Admin Geral** chega pelo botão "Dados base" da linha da operação em
 *   `/operacoes/gise/operacoes`, e é para lá que ele volta. A aba lateral nem existe para
 *   ele (`temLinhaBaseAPreencher` devolve `false`), então esta é a única porta;
 * - **admin de unidade/seccional** chega pela aba lateral, que passa pelo índice
 *   `/operacoes/dados-base`. Só que o índice REDIRECIONA para cá quando há uma pendência
 *   só — voltar para ele seria voltar para esta mesma tela. Com mais de uma
 *   pendência o índice é uma tela de verdade e o botão faz sentido; com uma só,
 *   `null`, e o caminho de volta é a barra lateral.
 *
 * Um "Voltar" que não sai do lugar é pior que nenhum: a pessoa clica, a tela
 * pisca, e ela conclui que o botão está quebrado — que foi exatamente o que
 * aconteceu quando o `href` era fixo.
 */
async function destinoDeVolta(
	db: Database,
	u: NonNullable<App.Locals['usuario']>
): Promise<{ href: string; rotulo: string } | null> {
	if (isAdminGeral(u)) return { href: '/operacoes/gise/operacoes', rotulo: 'Voltar às operações' };

	const pendentes = await operacoesComLinhaBasePendente(db, u);
	return pendentes.length > 1 ? { href: '/operacoes/dados-base', rotulo: 'Voltar' } : null;
}

export const load: PageServerLoad = async ({ locals, platform, params, depends }) => {
	depends('app:dados-base');

	const u = locals.usuario;
	if (!u || !isAnyAdmin(u)) error(403, 'Acesso restrito a administradores');

	const db = getDB(platform);

	// Operação inexistente ou inativa é 404, não "cai na primeira": um id velho
	// num favorito abriria a tela de OUTRA operação com o mesmo visual, e o admin
	// preencheria sem perceber a troca.
	const operacaoId = Number(params.operacaoId);
	if (!Number.isInteger(operacaoId) || operacaoId <= 0) error(404, 'Operação não encontrada');

	const operacoesLista = await listarOperacoes(db, { somenteAtivas: true });
	const operacao = operacoesLista.find((o) => o.id === operacaoId);
	if (!operacao) error(404, 'Operação não encontrada ou já encerrada');

	const [permitidas, participantes, modeloOp, modeloSeint, voltar] = await Promise.all([
		unidadesLinhaBaseAdministradas(db, u, operacao.id),
		unidadesParticipantesDaOperacao(db, operacao.id),
		buscarGiseModeloFormulario(db, operacao.id, 'operacional'),
		buscarGiseModeloFormulario(db, operacao.id, 'seint'),
		destinoDeVolta(db, u)
	]);

	// Só indicador PERCENTUAL aparece: meta absoluta ("mínimo de 1 por
	// unidade/mês") não tem base a informar, e listá-la aqui pediria à delegacia
	// um número que nada usaria.
	const indicadores = indicadoresComLinhaBase(
		extrairIndicadoresDeModelos([
			parseModelo(modeloOp?.config, 'operacional'),
			parseModelo(modeloSeint?.config, 'seint')
		])
	).map((i) => ({
		key: i.key,
		texto: i.texto,
		rotulo: i.config.rotuloBase?.trim() || i.texto,
		unidadeMedida: i.config.unidadeMedida ?? '',
		objetivo: i.config.objetivo,
		metaValor: i.config.metaValor
	}));

	const unidadesEditaveis = participantes.filter((p) => permitidas.has(p.id));
	const linhas = await listarLinhaBase(
		db,
		operacao.id,
		unidadesEditaveis.map((x) => x.id)
	);

	const valores: ValoresPorUnidade = {};
	for (const l of linhas) {
		(valores[l.unidade_id] ??= {})[l.indicador_key] = {
			valor: l.valor,
			observacao: l.observacao,
			informadoPor: l.informado_por_nome,
			em: l.updated_at
		};
	}

	return {
		operacao: { id: operacao.id, nome: operacao.nome },
		indicadores,
		unidades: unidadesEditaveis,
		valores,
		voltar
	};
};

export const actions: Actions = {
	/**
	 * Grava as bases de UMA unidade.
	 *
	 * Recusa por permissão antes de escrever: a `unidadeId` do corpo tem de estar
	 * no conjunto que este usuário administra NESTA operação. E cada `key` é
	 * confrontada com os indicadores do modelo — chave inventada não vira linha,
	 * senão a tabela viraria depósito de chaves que nenhum gráfico leria.
	 *
	 * Auditado: o valor é o denominador de um percentual divulgado, e mudá-lo
	 * altera o atingimento de uma unidade sem tocar em relatório nenhum.
	 */
	salvar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !isAnyAdmin(u)) return fail(403, { error: 'Acesso restrito a administradores' });

		const fd = await request.formData();
		const operacaoId = Number(fd.get('operacaoId'));
		const unidadeId = Number(fd.get('unidadeId'));
		if (!Number.isInteger(operacaoId) || operacaoId <= 0) {
			return fail(400, { error: 'Operação inválida' });
		}
		if (!Number.isInteger(unidadeId) || unidadeId <= 0) {
			return fail(400, { error: 'Unidade inválida' });
		}

		const db = getDB(platform);

		const operacao = await buscarOperacao(db, operacaoId);
		if (!operacao) return fail(404, { error: 'Operação não encontrada' });

		const permitidas = await unidadesLinhaBaseAdministradas(db, u, operacaoId);
		if (!permitidas.has(unidadeId)) {
			return fail(403, {
				error: 'Você não administra esta unidade nesta operação.'
			});
		}

		const [modeloOp, modeloSeint] = await Promise.all([
			buscarGiseModeloFormulario(db, operacaoId, 'operacional'),
			buscarGiseModeloFormulario(db, operacaoId, 'seint')
		]);
		const chavesValidas = new Set(
			indicadoresComLinhaBase(
				extrairIndicadoresDeModelos([
					parseModelo(modeloOp?.config, 'operacional'),
					parseModelo(modeloSeint?.config, 'seint')
				])
			).map((i) => i.key)
		);

		// Campos vêm como `valor__<key>` e `obs__<key>`. Prefixo em vez de um JSON
		// no corpo para o formulário funcionar sem JavaScript, como os demais desta
		// aplicação.
		const gravados: string[] = [];
		for (const [campo, bruto] of fd.entries()) {
			if (!campo.startsWith('valor__')) continue;
			const key = campo.slice('valor__'.length);
			if (!chavesValidas.has(key)) continue;

			const texto = String(bruto).trim();
			// Campo em branco = "ainda não sei", e não zero. Zerar um acervo por
			// engano faria a meta de redução parecer cumprida.
			if (texto === '') continue;

			const valor = Number(texto.replace(',', '.'));
			if (!Number.isFinite(valor) || valor < 0) {
				return fail(400, { error: `Valor inválido para "${key}".` });
			}

			await upsertLinhaBase(db, {
				operacaoId,
				unidadeId,
				indicadorKey: key,
				valor,
				observacao: String(fd.get(`obs__${key}`) ?? '')
					.trim()
					.slice(0, 500),
				informadoPorId: u.id,
				informadoPorNome: u.nome,
				origem: 'aba'
			});
			gravados.push(key);
		}

		if (gravados.length === 0) {
			return fail(400, { error: 'Informe ao menos um valor.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'informar_linha_base',
				usuario: u,
				entidade: 'operacao',
				entidade_id: operacaoId,
				alvo_tipo: 'unidade',
				alvo_id: unidadeId,
				detalhes: `Linha de base informada em ${operacao.nome} (${gravados.length} indicador(es))`,
				dados_depois: { indicadores: gravados },
				...contexto
			},
			{ env }
		);

		return { success: true, gravados: gravados.length };
	}
};
