/**
 * `/valores` — os valores de hora extra e diária do plano operacional
 * ("Atualização de valores", em Gestão de pessoal). **Aberta ao Admin Geral**
 * (sessão de admin — Super Admin incluso), no `load` E na action.
 *
 * Até set/2026 era `/config-custos`, restrita ao Super Admin, pela divisão
 * "quem monta a operação não fixa quanto vale a hora". A decisão E39 (13/09/2026)
 * abriu a tela de departamento para cima: quem atualiza os valores é o
 * departamento (Gabinete e CEFIN — a restrição a essas designações entra com
 * a tabela de designações, fase 2). O que protege contra o mau uso é o
 * versionamento abaixo, não o papel: toda gravação fica no histórico com autor.
 *
 * ## Salvar cria uma VERSÃO, nunca sobrescreve
 *
 * `custo_parametros` é append-only. Cada gravação insere uma linha nova, e o
 * plano guarda qual delas aplicou — é o que faz o PDF de um plano de março,
 * reemitido depois de um reajuste, sair com os mesmos totais. A tela mostra o
 * histórico justamente para o operador conseguir responder "por que aquele
 * plano soma diferente?" sem abrir o banco.
 *
 * ## O signatário NÃO mora aqui
 *
 * Quem assina é campo do PLANO (`/gise/planos`), escolhido na criação e
 * editável depois. Já esteve nesta tela como padrão global e saiu: quem assina
 * varia por operação — o Titular assina umas, o Adjunto outras —, então um
 * padrão único ou seria ignorado na maioria das vezes ou induziria a trocar a
 * configuração de TODOS os planos seguintes para acertar um.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	criarCustoParametros,
	listarCustoParametros,
	buscarCustoParametrosVigente,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { lerBRL } from '$lib/planos/rotulos';
import { hojeBrasilISO } from '$lib/utils/datas';
import { logger } from '$lib/server/logger';

/**
 * Os dez campos de DINHEIRO, na ordem em que a tela os apresenta.
 *
 * O limite de km da diária NÃO entra aqui, embora apareça no mesmo formulário:
 * esta lista é percorrida por um laço que valida com `lerBRL` e grava centavos.
 *
 * Uma lista só, consumida pelo `load`, pela action e pelo `.svelte`: é ela que
 * garante que um campo novo apareça nos três lugares. Três listas escritas à
 * mão divergiriam, e o sintoma seria um valor que a tela mostra e a action não
 * grava — silencioso, porque o campo faltante simplesmente fica zero.
 */
/**
 * Limites do campo de quilômetros, em km.
 *
 * `1` porque zero pagaria diária a quem não sai da cidade, e `2000` porque o
 * Ceará inteiro cabe em menos de 800 km — o teto existe contra o dedo pesado,
 * não contra uma regra.
 */
const KM_MINIMO = 1;
const KM_MAXIMO = 2000;

const CAMPOS_VALOR = [
	{ chave: 'oip_cd_normal', rotulo: 'OIP classes D e C', grupo: 'normal' },
	{ chave: 'oip_ab_normal', rotulo: 'OIP classes B e A', grupo: 'normal' },
	{ chave: 'dpc_12_normal', rotulo: 'DPC 1ª e 2ª classe', grupo: 'normal' },
	{ chave: 'dpc_3e_normal', rotulo: 'DPC 3ª classe e especial', grupo: 'normal' },
	{ chave: 'oip_cd_plus', rotulo: 'OIP classes D e C', grupo: 'plus' },
	{ chave: 'oip_ab_plus', rotulo: 'OIP classes B e A', grupo: 'plus' },
	{ chave: 'dpc_12_plus', rotulo: 'DPC 1ª e 2ª classe', grupo: 'plus' },
	{ chave: 'dpc_3e_plus', rotulo: 'DPC 3ª classe e especial', grupo: 'plus' },
	{ chave: 'diaria_estadual', rotulo: 'Diária estadual', grupo: 'diaria' },
	{ chave: 'diaria_interestadual', rotulo: 'Diária interestadual', grupo: 'diaria' }
] as const;

type ChaveValor = (typeof CAMPOS_VALOR)[number]['chave'];

export const load: PageServerLoad = async ({ locals, platform }) => {
	// Sessão de admin = Admin Geral (bootstrap ou vinculado) ou Super Admin.
	if (locals.usuario?.tipo !== 'admin') redirect(302, '/');

	const db = getDB(platform);
	const [vigente, historico] = await Promise.all([
		buscarCustoParametrosVigente(db),
		listarCustoParametros(db)
	]);

	return {
		vigente,
		// O histórico já vem do mais recente para o mais antigo; a tela mostra os
		// últimos para caber sem paginação — quem precisa de mais consulta a
		// auditoria, onde cada gravação está registrada com autor.
		historico: historico.slice(0, 10),
		hoje: hojeBrasilISO()
	};
};

export const actions: Actions = {
	/**
	 * Grava uma versão nova dos dez valores.
	 *
	 * Valida os dez ANTES de inserir: um campo mal digitado não pode deixar
	 * metade dos valores gravados numa versão que o próximo plano aplicaria.
	 */
	salvarValores: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (u?.tipo !== 'admin') return fail(403, { error: 'Acesso restrito ao Administrador Geral' });

		const fd = await request.formData();

		const valores = {} as Record<ChaveValor, number>;
		for (const campo of CAMPOS_VALOR) {
			const bruto = String(fd.get(campo.chave) ?? '').trim();

			// Campo vazio é ERRO, não zero.
			//
			// Tratar o vazio como 0 grava uma faixa a custo zero sem ninguém ter
			// decidido isso, e o sintoma aparece semanas depois: um DPC 3ª classe
			// escalado numa operação noturna sai custando R$ 0,00 no Anexo II, com o
			// documento parecendo completo. É a mesma classe de defeito que
			// `pendencias` impede no efetivo — aqui, um nível acima.
			//
			// Zero continua sendo valor legítimo (a corporação pode não pagar diária
			// interestadual); mas tem de ser DIGITADO, para virar decisão em vez de
			// esquecimento.
			if (bruto === '') {
				return fail(400, {
					error: `Preencha "${campo.rotulo}". Para não pagar essa faixa, digite 0,00.`,
					campo: campo.chave
				});
			}

			const centavos = lerBRL(bruto);
			if (centavos === null || centavos < 0) {
				return fail(400, {
					error: `Valor inválido em "${campo.rotulo}". Use o formato 27,30.`,
					campo: campo.chave
				});
			}
			valores[campo.chave] = centavos;
		}

		// FORA do laço acima de propósito: `CAMPOS_VALOR` tem contrato de dinheiro
		// (valida com `lerBRL`, grava centavos). Quilômetro é inteiro e tem faixa
		// própria — enfiá-lo naquela lista faria `lerBRL('120')` gravar 12000.
		const kmBruto = String(fd.get('distancia_minima_diaria_km') ?? '').trim();
		if (kmBruto === '') {
			return fail(400, {
				error: 'Preencha a distância mínima para diária.',
				campo: 'distancia_minima_diaria_km'
			});
		}
		const distanciaMinima = Number(kmBruto.replace(',', '.'));
		if (
			!Number.isInteger(distanciaMinima) ||
			distanciaMinima < KM_MINIMO ||
			distanciaMinima > KM_MAXIMO
		) {
			return fail(400, {
				error: `Distância mínima inválida. Use um número inteiro de ${KM_MINIMO} a ${KM_MAXIMO} km.`,
				campo: 'distancia_minima_diaria_km'
			});
		}

		const vigenteDesde = String(fd.get('vigente_desde') ?? '').trim();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenteDesde)) {
			return fail(400, { error: 'Informe a data de vigência (AAAA-MM-DD).' });
		}

		const db = getDB(platform);
		let novoId: number;
		try {
			novoId = await criarCustoParametros(db, {
				...valores,
				distancia_minima_diaria_km: distanciaMinima,
				vigente_desde: vigenteDesde,
				// Sessão de admin: o id gravado é o do policial vinculado (Admin Geral
				// promovido); bootstrap e Super Admin não têm cadastro → só o nome.
				criado_por_id: u.adminPolicialId ?? null,
				criado_por_nome: u.nome ?? ''
			});
		} catch (e) {
			logger.error('[valores] salvar valores', { error: String(e) });
			return fail(500, { error: 'Erro ao gravar os valores.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'salvar_custo_parametros',
				usuario: u,
				entidade: 'configuracao',
				entidade_id: novoId,
				detalhes: `Nova versão de valores de custo (vigente desde ${vigenteDesde})`,
				dados_depois: {
					...valores,
					distancia_minima_diaria_km: distanciaMinima,
					vigente_desde: vigenteDesde
				},
				...contexto
			},
			{ env }
		);

		return { success: true, versao: novoId };
	}
};
