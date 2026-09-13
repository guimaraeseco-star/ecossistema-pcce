/**
 * `load` do editor de plano operacional e o ponto de junção das suas actions.
 *
 * O `load` monta a árvore inteira (plano → equipes → membros) e já devolve o
 * CUSTO calculado. Calcular no servidor, e não na tela, é o que garante que o
 * número que o admin confere seja o mesmo que o PDF imprime: são a mesma
 * chamada a `custoDoPlano`, com os mesmos valores congelados.
 *
 * As actions estão divididas por ASSUNTO em `_actions/` — plano, equipe e
 * membros — e espalhadas aqui num objeto só, como em `/gise/[id]`. O preâmbulo
 * que todas repetem (carregar, autorizar, amarrar o id filho ao plano) mora em
 * `_actions/shared.ts`.
 *
 * `depends('planos:detalhe')` é a chave que as actions invalidam: a página se
 * recarrega sem `invalidateAll()`, que derrubaria o layout junto.
 */
import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	janelaDaEquipe,
	briefingDaEquipe,
	origemDaEquipe,
	destinoDaEquipe,
	opcoesDoPlano,
	valorPadrao,
	listarMunicipios,
	matrizDoPlano,
	procedenciaDaMedicao,
	lancamentosMensais,
	piorExtratoDaEquipe,
	buscarPolicial
} from '$lib/db';
import { unidades } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { carregarPlanoParaEdicao } from '$lib/server/planos/permissao';
import { montarCustoDoPlano, versaoDeValores } from '$lib/server/planos/custo-do-plano';
import { podeEmitir } from '$lib/planos/custo';
import { classificarJanela } from '$lib/planos/horas-extras';
import { distanciaDoTrajeto } from '$lib/planos/distancia';
import { DISTANCIA_MINIMA_DIARIA_KM } from '$lib/planos/custeio';
import { analisarDiaria } from '$lib/diarias/parecer';
import { mesesAcimaDoTeto } from '$lib/diarias/contagem';
import { departamentoDoPlano } from '$lib/server/planos/departamento';
import { actionsPlano } from './_actions/actions-plano';
import { actionsEquipe } from './_actions/actions-equipe';
import { actionsMembros } from './_actions/actions-membros';
import { actionsOpcoes } from './_actions/actions-opcoes';

export const load: PageServerLoad = async ({ locals, params, platform, depends }) => {
	depends('planos:detalhe');

	const db = getDB(platform);
	const id = Number(params.id);
	const acesso = await carregarPlanoParaEdicao(db, id, locals.usuario);
	if (acesso instanceof Response) {
		// O portão devolve 403 para quem não é Admin Geral e 404 para plano
		// inexistente. Aqui vira redirect no primeiro caso (a barra lateral nem
		// mostra o item, então cair na lista é o comportamento esperado) e `error`
		// no segundo, que é a página de fato inexistente.
		if (acesso.status === 404) error(404, 'Plano operacional não encontrado');
		redirect(302, '/gise');
	}
	const { plano } = acesso;

	// A MESMA montagem que o PDF usa — ver `custo-do-plano.ts`. É o que impede o
	// documento de imprimir um total diferente do que o admin conferiu aqui.
	const { equipes, porEquipe, parametros, custo } = await montarCustoDoPlano(db, plano);

	// Os rótulos de quem JÁ está escolhido, para os `SearchableSelect` abrirem
	// mostrando a seleção em vez de um campo vazio. Sem eles, um plano com
	// coordenador designado parece não ter nenhum — e salvar por cima apagaria a
	// designação sem que ninguém tivesse pedido isso.
	const opcoes = await opcoesDoPlano(db, plano.id);
	// A matriz vai REDUZIDA aos municípios deste plano — algumas dezenas de pares
	// em vez de 16.836. É ela que deixa o card recalcular a distância enquanto o
	// admin troca os seletores, sem uma ida ao servidor por clique.
	const [municipios, matriz, medicao] = await Promise.all([
		listarMunicipios(db),
		matrizDoPlano(db, plano.id),
		procedenciaDaMedicao(db)
	]);
	/**
	 * Código IBGE por VALOR de opção.
	 *
	 * A equipe guarda o texto ("Acopiara"), não o id da opção — é o que permite
	 * remover uma opção sem esvaziar equipe montada. Para medir o trajeto é
	 * preciso voltar do texto ao município, e é este mapa que faz isso.
	 */
	const ibgePorValor = new Map(
		[...opcoes.briefing, ...opcoes.origem, ...opcoes.destino]
			.filter((o) => o.municipio_ibge)
			.map((o) => [o.valor, o.municipio_ibge as string])
	);

	/**
	 * Região metropolitana por código IBGE — entrada da vedação do art. 4º, §1º,
	 * II. Sai da lista que já foi carregada; não custa consulta nova.
	 */
	const rmPorIbge = new Map(municipios.map((m) => [m.ibge, m.regiao_metropolitana]));

	/**
	 * Quanto cada servidor já tem lançado em cada mês, para o teto de 15 diárias
	 * do art. 13.
	 *
	 * ESTE plano fica de fora da soma (`plano.id`): a equipe que estou reavaliando
	 * não pode contar contra si mesma — ela apareceria estourando o teto por causa
	 * da diária que ela própria já concedeu.
	 */
	const idsDosMembros = [...porEquipe.values()].flat().map((m) => m.policial_id);
	const lancamentos = await lancamentosMensais(db, idsDosMembros, plano.id);

	/** O limite de km CONGELADO na versão de valores que este plano aplica. */
	const limiteKm = parametros?.distancia_minima_diaria_km ?? DISTANCIA_MINIMA_DIARIA_KM;

	const briefingPadrao = valorPadrao(opcoes.briefing);
	const origemPadrao = valorPadrao(opcoes.origem);
	const destinoPadrao = valorPadrao(opcoes.destino);

	const [coordenador, demandante, depto] = await Promise.all([
		plano.coordenador_id ? buscarPolicial(db, plano.coordenador_id) : Promise.resolve(null),
		plano.demandante_unidade_id
			? db
					.select({ nome: unidades.nome })
					.from(unidades)
					.where(eq(unidades.id, plano.demandante_unidade_id))
					.get()
			: Promise.resolve(undefined),
		departamentoDoPlano(db, plano.demandante_unidade_id)
	]);

	return {
		/** Os cargos aceitos para o signatário — a mesma lista que a action confere. */
		cargos: depto.cargos,
		coordenadorNome: coordenador?.nome ?? '',
		demandanteNome: demandante?.nome ?? '',
		/**
		 * As listas que alimentam os seletores das equipes, e o valor da padrão de
		 * cada tipo — que é o que a equipe nova recebe pré-preenchido.
		 */
		opcoes,
		municipios,
		/** Serializável: `Map` não sobrevive ao `load`. A tela remonta o `Map`. */
		matrizDistancias: Object.fromEntries(matriz),
		medicao,
		briefingPadrao,
		origemPadrao,
		destinoPadrao,
		plano,
		/**
		 * Cada equipe com o que a tela precisa: os membros, a janela EFETIVA (já
		 * resolvida pela cascata equipe → plano), o destino efetivo e a sugestão
		 * de horas daquela janela.
		 *
		 * A sugestão é calculada aqui, e não no `.svelte`, porque depende da mesma
		 * cascata que o PDF usa — duas resoluções do horário efetivo divergiriam,
		 * e a divergência sairia como hora extra a mais ou a menos no documento.
		 */
		equipes: equipes.map((e) => {
			const janela = janelaDaEquipe(e, plano);
			// A medida do trajeto pela MESMA função que a tela usa. Vem daqui para a
			// tela poder distinguir "este número é o medido" de "alguém corrigiu à
			// mão" — sem isso, reabrir o editor sobrescreveria a correção.
			const trajeto = distanciaDoTrajeto(
				{
					origem: ibgePorValor.get(origemDaEquipe(e, origemPadrao)) ?? null,
					briefing: ibgePorValor.get(briefingDaEquipe(e, briefingPadrao)) ?? null,
					destino: ibgePorValor.get(destinoDaEquipe(e, destinoPadrao)) ?? null
				},
				matriz
			);
			const membros = porEquipe.get(e.id) ?? [];
			const origemIbge = ibgePorValor.get(origemDaEquipe(e, origemPadrao)) ?? null;
			const destinoIbge = ibgePorValor.get(destinoDaEquipe(e, destinoPadrao)) ?? null;
			const dataFim = janela.dataFim ?? janela.dataInicio;

			// O parecer é do SERVIDOR pelo mesmo motivo do custo: ele cita
			// dispositivo legal e vai virar linha de documento. Recalculá-lo na tela
			// deixaria duas versões da mesma análise circulando.
			const parecer = analisarDiaria({
				dataInicio: janela.dataInicio,
				dataFim,
				feriado: janela.feriado,
				horaInicio: janela.horaInicio,
				horaFim: janela.horaFim,
				regiaoOrigem: (origemIbge && rmPorIbge.get(origemIbge)) || null,
				regiaoDestino: (destinoIbge && rmPorIbge.get(destinoIbge)) || null,
				mesmaCidade: Boolean(origemIbge && origemIbge === destinoIbge),
				// A distância GRAVADA, não a medida: é ela que o Anexo II usa, e a
				// vedação dos 120 km precisa olhar o mesmo número.
				distanciaKm: e.distancia_km ?? trajeto?.km ?? null,
				mesesAcimaDoTeto: mesesAcimaDoTeto(
					janela.dataInicio,
					dataFim,
					piorExtratoDaEquipe(
						lancamentos,
						membros.map((m) => m.policial_id)
					)
				)
			});

			return {
				...e,
				membros,
				janela,
				distanciaMedida: trajeto,
				destinoEfetivo: destinoDaEquipe(e, destinoPadrao),
				sugestaoHoras: classificarJanela(janela),
				parecer,
				custo: custo.equipes.find((c) => c.equipe.id === e.id)?.total ?? 0
			};
		}),
		custo,
		limiteKm,
		podeEmitir: podeEmitir(custo),
		/** A versão aplicada, para a tela dizer de onde vêm os números. */
		versaoValores: versaoDeValores(parametros)
	};
};

export const actions: Actions = {
	...actionsPlano,
	...actionsEquipe,
	...actionsMembros,
	...actionsOpcoes
};
