/**
 * `/operacoes/gise/operacoes` — o cadastro das operações extraordinárias (Admin Geral).
 *
 * É a tela que torna "operação" um dado e não uma constante do código: GISE,
 * OPERAÇÃO CRAJUBAR, EDGE, e as que vierem. Três decisões dela valem registro:
 *
 * - **criar pede em qual operação basear o formulário.** Começar do zero é uma
 *   opção, não o padrão — o formulário de produtividade tem dezenas de perguntas
 *   e reescrevê-las a cada operação nova seria o caminho para operações
 *   incomparáveis entre si;
 * - **excluir só o que nunca foi usado.** Operação COM escala não se exclui:
 *   escala histórica e PDF assinado continuam apontando para ela, e apagá-la
 *   deixaria documento entregue sem origem (mesma regra de `unidades`). O que
 *   some é a operação sem escala nenhuma — a criada por engano, a de teste. A
 *   contagem é refeita no SERVIDOR na hora de excluir: a que a tela mostrou pode
 *   ter envelhecido;
 * - **o clone só acontece na CRIAÇÃO.** Editar uma operação existente não
 *   reclona: isso sobrescreveria em silêncio um formulário que já está em uso,
 *   e as respostas gravadas continuariam com as `key` antigas.
 *
 * ## Identidade e configuração no MESMO formulário
 *
 * Até ago/2026 havia dois lugares: "Editar" (nome, ciclo, tipos de equipe) e
 * "Configurações", numa rota à parte (vagas, horários, textos do breve
 * relatório). A separação não correspondia a nada — as duas metades descrevem a
 * mesma operação, e quem criava uma operação nova saía da tela com metade dela
 * por preencher, sem nada indicando isso. Agora é um formulário só, usado tanto
 * na criação quanto na edição, e `/operacoes/gise/operacoes/[id]/config` redireciona
 * para cá.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	listarOperacoes,
	buscarOperacao,
	criarOperacao,
	atualizarOperacao,
	definirAtivoOperacao,
	excluirOperacao,
	contarEscalasPorOperacao,
	clonarModelosFormulario,
	buscarVagasPadraoEquipesGise,
	normalizarTiposEquipe,
	tiposEquipeDaOperacao,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { operacoesComLinhaBase } from '$lib/server/operacoes/permissao';
import { buscarConfiguracao } from '$lib/db/configuracoes';
import { getBreveRelatorioEnvMergido } from '$lib/server/gise/breve-relatorio-env';
import {
	resolveBreveRelatorioTitulo,
	resolveBreveRelatorioConteudoSeccional,
	resolveBreveRelatorioConteudoSupervisao
} from '$lib/gise/breve-relatorio';
import { validarHora, normalizarHora } from '$lib/gise/horarios';
import { ehViolacaoUnique } from '$lib/server/db-errors';
import { logger } from '$lib/server/logger';
import { textoLimitado, textoLimitadoOuNulo } from '$lib/server/form-data';

/**
 * GISE "vazia" passada aos resolvedores do breve relatório: com os três campos
 * nulos eles caem na cadeia de baixo (operação → config → constante), que é
 * justamente o valor HERDADO que o formulário mostra como placeholder.
 */
const semSobrescritaDeEscala = {
	breve_relatorio_titulo: null,
	breve_relatorio_texto_seccional: null,
	breve_relatorio_texto_supervisao: null
} as const;

export const load: PageServerLoad = async ({ locals, platform, depends }) => {
	depends('app:operacoes');
	if (!isAdminGeral(locals.usuario)) redirect(302, '/operacoes/gise');

	const db = getDB(platform);
	// Os valores HERDADOS entram como placeholder de cada campo vazio: o admin
	// precisa saber o que vai valer se não escrever nada, senão "em branco" vira
	// um salto no escuro. São do sistema (operação `null`), não de operação
	// nenhuma — é a camada de baixo da cadeia.
	const [operacoes, contagem, vagasGlobais, envGlobal, horaEntradaGlobal, horaSaidaGlobal] =
		await Promise.all([
			listarOperacoes(db),
			contarEscalasPorOperacao(db),
			buscarVagasPadraoEquipesGise(db, null),
			getBreveRelatorioEnvMergido(db, null),
			buscarConfiguracao(db, 'gise_default_hora_entrada'),
			buscarConfiguracao(db, 'gise_default_hora_saida')
		]);

	// Quais operações têm indicador PERCENTUAL — só elas pedem linha de base, e só
	// nelas o botão "Dados base" faz sentido. O mesmo critério da flag do menu
	// (`temLinhaBaseAPreencher`), por ser a mesma função: divergir aqui poria o
	// botão numa operação em que a tela não tem o que pedir.
	const pedemBase = await operacoesComLinhaBase(db, operacoes);

	return {
		operacoes: operacoes.map((o) => ({
			...o,
			// Quantas escalas já usam a operação — é o que explica ao admin por que
			// desativar é a única saída disponível.
			escalas: contagem.get(o.id) ?? 0,
			pedeLinhaBase: pedemBase.has(o.id)
		})),
		/** O que vale quando o campo correspondente do formulário fica vazio. */
		herdado: {
			vagas: vagasGlobais,
			horaEntrada: horaEntradaGlobal ?? '08:00',
			horaSaida: horaSaidaGlobal ?? '16:00',
			breveTitulo: resolveBreveRelatorioTitulo(semSobrescritaDeEscala, envGlobal),
			breveTextoSeccional: resolveBreveRelatorioConteudoSeccional(
				semSobrescritaDeEscala,
				envGlobal
			),
			breveTextoSupervisao: resolveBreveRelatorioConteudoSupervisao(
				semSobrescritaDeEscala,
				envGlobal
			)
		}
	};
};

/**
 * Texto do formulário, aparado e limitado. Vazio vira `''`, nunca `undefined`.
 *
 * A implementação mora em `$lib/server/form-data` — este arquivo e
 * `planos/novo/+page.server.ts` tinham cada um a sua cópia idêntica, e foi com a
 * regra sem casa própria que `salvarBreveRelatorio` nasceu sem cap nenhum.
 */
const texto = textoLimitado;

/** Checkbox do HTML: presente = ligado. */
function marcado(fd: FormData, campo: string): boolean {
	return fd.get(campo) != null;
}

/** `YYYY-MM-DD` ou `null`. Formato inválido vira `null` em vez de erro: o ciclo é opcional. */
function dataOuNulo(fd: FormData, campo: string): string | null {
	const v = texto(fd, campo, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Inteiro de 0 a 999, ou `null` quando o campo veio vazio.
 *
 * `null` e `0` são respostas DIFERENTES: vazio herda o padrão do sistema, zero
 * é uma equipe sem aquela vaga. Confundir os dois faria "0 DPC" virar "1 DPC" no
 * próximo salvamento.
 */
function inteiroOuHerda(fd: FormData, campo: string): number | null | 'invalido' {
	const s = String(fd.get(campo) ?? '').trim();
	if (s === '') return null;
	const n = Number(s);
	if (!Number.isInteger(n) || n < 0 || n > 999) return 'invalido';
	return n;
}

/** Texto aparado, ou `null` quando vazio (herda). Ver `texto` acima. */
const textoOuHerda = textoLimitadoOuNulo;

/** As nove colunas de configuração de escala, prontas para `atualizarOperacao`. */
type ConfigEscala = {
	vagas_operacional_dpc: number | null;
	vagas_operacional_oip: number | null;
	vagas_seint_dpc: number | null;
	vagas_seint_oip: number | null;
	hora_entrada_padrao: string | null;
	hora_saida_padrao: string | null;
	breve_relatorio_titulo: string | null;
	breve_relatorio_texto_seccional: string | null;
	breve_relatorio_texto_supervisao: string | null;
};

/**
 * Lê o bloco de configuração do formulário — o mesmo em `criar` e em `editar`.
 *
 * Existe como função porque as duas actions gravam EXATAMENTE os mesmos nove
 * campos com as mesmas regras: vazio é `null` (herda), zero é zero, horário só
 * entra normalizado. Duas cópias divergiriam na primeira correção feita numa
 * delas — é a duplicação que o `CLAUDE.md` cataloga.
 */
function lerConfigEscala(
	fd: FormData
): { ok: true; dados: ConfigEscala } | { ok: false; erro: string } {
	const vagas = {
		vagas_operacional_dpc: inteiroOuHerda(fd, 'op_dpc'),
		vagas_operacional_oip: inteiroOuHerda(fd, 'op_oip'),
		vagas_seint_dpc: inteiroOuHerda(fd, 'seint_dpc'),
		vagas_seint_oip: inteiroOuHerda(fd, 'seint_oip')
	};
	if (Object.values(vagas).includes('invalido')) {
		return { ok: false, erro: 'As vagas devem ser números inteiros de 0 a 999.' };
	}

	// Horário: vazio herda; preenchido tem de ser HH:MM válido. `validarHora('')`
	// é `true` (o campo é opcional em outras telas), então o teste de vazio
	// acontece ANTES — é ele que separa "herda" de "digitou errado".
	const horarios: Pick<ConfigEscala, 'hora_entrada_padrao' | 'hora_saida_padrao'> = {
		hora_entrada_padrao: null,
		hora_saida_padrao: null
	};
	for (const [campo, coluna, rotulo] of [
		['hora_entrada', 'hora_entrada_padrao', 'entrada'],
		['hora_saida', 'hora_saida_padrao', 'saída']
	] as const) {
		const bruto = String(fd.get(campo) ?? '').trim();
		if (bruto === '') continue;
		const normalizada = normalizarHora(bruto);
		if (!normalizada || !validarHora(normalizada)) {
			return { ok: false, erro: `Horário de ${rotulo} inválido. Use o formato HH:MM.` };
		}
		horarios[coluna] = normalizada;
	}

	return {
		ok: true,
		dados: {
			...(vagas as Pick<
				ConfigEscala,
				'vagas_operacional_dpc' | 'vagas_operacional_oip' | 'vagas_seint_dpc' | 'vagas_seint_oip'
			>),
			...horarios,
			breve_relatorio_titulo: textoOuHerda(fd, 'breve_titulo', 200),
			breve_relatorio_texto_seccional: textoOuHerda(fd, 'breve_texto_seccional', 2000),
			breve_relatorio_texto_supervisao: textoOuHerda(fd, 'breve_texto_supervisao', 2000)
		}
	};
}

export const actions: Actions = {
	/**
	 * Cria a operação e, se pedido, clona o formulário de outra.
	 *
	 * Ordem obrigatória: valida → cria → clona. O clone depende do id novo, e
	 * falhar depois de criar deixa a operação existindo com formulário padrão —
	 * estado recuperável pelo editor. O inverso (clonar antes de existir) não é
	 * representável.
	 */
	criar: async (event) => {
		const { request, locals, platform } = event;
		if (!isAdminGeral(locals.usuario)) return fail(403, { error: 'Somente Administrador Geral' });

		const fd = await request.formData();
		const nome = texto(fd, 'nome', 120);
		if (!nome) return fail(400, { error: 'O nome da operação é obrigatório.' });

		const tipos = normalizarTiposEquipe(marcado(fd, 'usa_operacional'), marcado(fd, 'usa_seint'));
		if (!tipos) {
			return fail(400, {
				error: 'Selecione ao menos um tipo de equipe — sem nenhum, a operação não escala ninguém.'
			});
		}

		// A config é validada ANTES de inserir: um horário mal digitado não pode
		// deixar a operação criada pela metade, com o formulário já clonado e o
		// admin de volta ao começo sem saber o que sobrou gravado.
		const config = lerConfigEscala(fd);
		if (!config.ok) return fail(400, { error: config.erro });

		const baseIdBruto = Number(fd.get('basear_em'));
		const baseId = Number.isInteger(baseIdBruto) && baseIdBruto > 0 ? baseIdBruto : null;

		const db = getDB(platform);

		// A operação-base precisa existir. Um id inválido é recusado em vez de
		// ignorado: o admin pediu para basear em algo, e criar em branco calado
		// entregaria uma operação diferente da que ele pediu.
		if (baseId != null && !(await buscarOperacao(db, baseId))) {
			return fail(400, { error: 'A operação escolhida como base não existe.' });
		}

		let novoId: number;
		try {
			novoId = await criarOperacao(db, {
				nome,
				sigla: texto(fd, 'sigla', 30),
				descricao: texto(fd, 'descricao', 500),
				usaEquipeOperacional: tipos.usa_equipe_operacional,
				usaEquipeSeint: tipos.usa_equipe_seint,
				dataInicio: dataOuNulo(fd, 'data_inicio'),
				dataFim: dataOuNulo(fd, 'data_fim')
			});
		} catch (e) {
			if (ehViolacaoUnique(e)) {
				return fail(409, { error: `Já existe uma operação chamada "${nome}".` });
			}
			logger.error('[gise/operacoes] criar', { error: String(e) });
			return fail(500, { error: 'Erro ao criar a operação.' });
		}

		// Config num segundo write, e não no INSERT: é a MESMA chamada que a edição
		// faz, com o mesmo objeto. Falhar aqui deixa a operação existindo com tudo
		// herdado — estado válido e corrigível pelo próprio formulário —, que é a
		// mesma escolha já feita para o clone logo abaixo.
		try {
			await atualizarOperacao(db, novoId, config.dados);
		} catch (e) {
			logger.error('[gise/operacoes] config na criação', { error: String(e), novoId });
		}

		let clonados: string[] = [];
		if (baseId != null) {
			try {
				clonados = await clonarModelosFormulario(db, baseId, novoId, tiposEquipeDaOperacao(tipos));
			} catch (e) {
				// A operação já existe e é utilizável — o editor resolve o formulário.
				// Derrubar a requisição aqui só esconderia isso do admin.
				logger.error('[gise/operacoes] clonar formulário', { error: String(e), baseId, novoId });
			}
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'criar_operacao',
				usuario: locals.usuario,
				entidade: 'operacao',
				entidade_id: novoId,
				detalhes: `Operação "${nome}" criada`,
				dados_depois: {
					nome,
					tipos: tiposEquipeDaOperacao(tipos),
					baseadaEm: baseId,
					formulariosClonados: clonados
				},
				...contexto
			},
			{ env }
		);

		return { success: true, criada: nome, clonados };
	},

	/** Patch dos campos editáveis. Não reclona formulário — ver o cabeçalho. */
	editar: async (event) => {
		const { request, locals, platform } = event;
		if (!isAdminGeral(locals.usuario)) return fail(403, { error: 'Somente Administrador Geral' });

		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Operação inválida' });

		const nome = texto(fd, 'nome', 120);
		if (!nome) return fail(400, { error: 'O nome da operação é obrigatório.' });

		const tipos = normalizarTiposEquipe(marcado(fd, 'usa_operacional'), marcado(fd, 'usa_seint'));
		if (!tipos) {
			return fail(400, { error: 'Selecione ao menos um tipo de equipe.' });
		}

		const config = lerConfigEscala(fd);
		if (!config.ok) return fail(400, { error: config.erro });

		const db = getDB(platform);
		const antes = await buscarOperacao(db, id);
		if (!antes) return fail(404, { error: 'Operação não encontrada' });

		try {
			// Identidade e configuração no mesmo UPDATE — são a mesma operação, e
			// gravá-las em dois passos abriria a janela em que a tela mostra metade
			// salva e metade não.
			await atualizarOperacao(db, id, {
				nome,
				sigla: texto(fd, 'sigla', 30),
				descricao: texto(fd, 'descricao', 500),
				data_inicio: dataOuNulo(fd, 'data_inicio'),
				data_fim: dataOuNulo(fd, 'data_fim'),
				...tipos,
				...config.dados
			});
		} catch (e) {
			if (ehViolacaoUnique(e)) {
				return fail(409, { error: `Já existe uma operação chamada "${nome}".` });
			}
			logger.error('[gise/operacoes] editar', { error: String(e) });
			return fail(500, { error: 'Erro ao salvar a operação.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_operacao',
				usuario: locals.usuario,
				entidade: 'operacao',
				entidade_id: id,
				detalhes: `Operação "${nome}" alterada`,
				dados_antes: {
					nome: antes.nome,
					usa_equipe_operacional: antes.usa_equipe_operacional,
					usa_equipe_seint: antes.usa_equipe_seint
				},
				dados_depois: { nome, ...tipos, ...config.dados },
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/**
	 * Exclui de vez — só a operação que nunca recebeu escala.
	 *
	 * Quem decide é `excluirOperacao`, que reconta as escalas antes de apagar: o
	 * botão só aparece na tela quando a contagem é zero, mas essa contagem veio do
	 * `load` e pode ter envelhecido. Esconder o botão não é autorização, e uma
	 * contagem de dez segundos atrás também não é.
	 */
	excluir: async (event) => {
		const { request, locals, platform } = event;
		if (!isAdminGeral(locals.usuario)) return fail(403, { error: 'Somente Administrador Geral' });

		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Operação inválida' });

		const db = getDB(platform);
		const operacao = await buscarOperacao(db, id);
		if (!operacao) return fail(404, { error: 'Operação não encontrada' });

		let apagou: boolean;
		try {
			apagou = await excluirOperacao(db, id);
		} catch (e) {
			logger.error('[gise/operacoes] excluir', { error: String(e), id });
			return fail(500, { error: 'Erro ao excluir a operação.' });
		}

		if (!apagou) {
			return fail(409, {
				error: `A operação "${operacao.nome}" já tem escalas e não pode ser excluída. Desative-a.`
			});
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'excluir_operacao',
				usuario: locals.usuario,
				entidade: 'operacao',
				entidade_id: id,
				detalhes: `Operação "${operacao.nome}" excluída (não tinha escalas)`,
				dados_antes: {
					nome: operacao.nome,
					sigla: operacao.sigla,
					usa_equipe_operacional: operacao.usa_equipe_operacional,
					usa_equipe_seint: operacao.usa_equipe_seint
				},
				...contexto
			},
			{ env }
		);

		return { success: true, excluida: operacao.nome };
	},

	/**
	 * Ativa/desativa. É o que resta para a operação que JÁ tem escala: ela some
	 * das listas de escolha e continua resolvendo nome e id em todo o histórico.
	 */
	alternarAtivo: async (event) => {
		const { request, locals, platform } = event;
		if (!isAdminGeral(locals.usuario)) return fail(403, { error: 'Somente Administrador Geral' });

		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Operação inválida' });

		const db = getDB(platform);
		const operacao = await buscarOperacao(db, id);
		if (!operacao) return fail(404, { error: 'Operação não encontrada' });

		const novoAtivo = !operacao.ativo;
		await definirAtivoOperacao(db, id, novoAtivo);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: novoAtivo ? 'ativar_operacao' : 'desativar_operacao',
				usuario: locals.usuario,
				entidade: 'operacao',
				entidade_id: id,
				detalhes: `Operação "${operacao.nome}" ${novoAtivo ? 'reativada' : 'desativada'}`,
				...contexto
			},
			{ env }
		);

		return { success: true, ativo: novoAtivo };
	}
};
