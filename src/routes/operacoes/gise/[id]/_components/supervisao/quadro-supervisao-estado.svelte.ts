/**
 * Estado compartilhado do QUADRO DE SUPERVISÃO da GISE — a designação dos
 * quatro papéis, os documentos (escala assinada e relatório de extra) e tudo
 * que a página fornece aos dois blocos.
 *
 * Publicado com `setContext` em `+page.svelte` (`publicarQuadroSupervisao`) e
 * lido com `getContext` pelas folhas (`quadroSupervisao`). É o PRIMEIRO uso da
 * API de contexto do Svelte no projeto, então a escolha precisa ficar
 * justificada aqui:
 *
 * Este quadro já foi um componente de 1028 linhas. Ele foi fatiado em seis, e o
 * que sobrou no topo virou um repassador puro de 38 props — o maior contrato do
 * repositório — porque o ESTADO não se moveu junto com o markup: cada corte
 * transformou variável local em interface entre arquivos. Acrescentar um campo
 * ao quadro passou a custar quatro arquivos (página, orquestrador, um `types.ts`
 * só para nomear o contrato, e a folha), sendo que nenhum dos intermediários
 * LIA o valor — só repassava. Fatiar arquivo sem mover o estado junto troca uma
 * dívida (arquivo grande) por outra (contrato grande), e a segunda é pior: não
 * aparece em contagem de linhas, então parece progresso.
 *
 * Contexto resolve isso porque a profundidade da árvore deixa de custar — a
 * folha declara o que usa, quem está no meio não declara nada. O preço é que a
 * dependência some da tag do componente; por isso `quadroSupervisao()` lança
 * erro nomeado quando a folha é montada fora do quadro, que é a única forma de
 * errar aqui.
 *
 * O molde da classe `$state` única é `../gise-seccional-estado.svelte.ts`. A
 * diferença: aquela carrega só estado de UI e é passada por prop; esta também
 * expõe o que vem do `load` e os fluxos de assinatura da página, e é por isso
 * que vai por contexto em vez de prop.
 *
 * `isMobile` NÃO está aqui de propósito. `useMobile()` é a fonte única desde
 * ago/2026, e quem decide layout por ele (`SupervisaoDocumentoCard`) chama
 * direto — um prop drilado por quatro níveis a menos.
 */

import { getContext, setContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import type { SubmitFunction } from '@sveltejs/kit';
import { apiFetch } from '$lib/api-fetch';
import { buscarPoliciaisOptions } from '$lib/busca-policiais';
import { quadroSupervisaoExtraExigeRelatorio } from '$lib/gise/supervisao-extra';
import type { GiseAssinaturaRelatorio } from '$lib/server/schema';

export type PresencaGiseLinha = {
	policial_id: number;
	entrada_timestamp: string | null;
	saida_timestamp: string | null;
};

export interface GiseSupervisaoGise {
	id: number;
	data_inicio: string;
	supervisor_id: number | null;
	supervisor_nome: string | null;
	assessor_id: number | null;
	assessor_email_notificacao?: string | null;
	assessor_nome?: string | null;
	seint1_id: number | null;
	seint1_nome?: string | null;
	seint2_id: number | null;
	seint2_nome?: string | null;
	status: string;
	seccionais?: { status: string; seccional_nome: string }[];
}

export interface PolicialOpcao {
	id: number;
	nome: string;
	matricula: string;
	cargo: string;
	email?: string | null;
	email_pessoal?: string | null;
}

interface DocumentoAssinadoInfo {
	existe: boolean;
	assinante_nome: string;
	/** Quem assinou (policiais.id) — decide a visibilidade do "C/ manifesto". */
	assinante_id?: number | null;
}

export type SelectedOption = { value: number | null; label: string } | null;

/** Os quatro papéis designáveis no quadro (edição é por papel). */
export type PapelSupervisao = 'supervisor' | 'assessor' | 'seint1' | 'seint2';

/**
 * A fatia de `useGiseAssinatura` que o quadro toca — os bindables do painel de
 * token da escala. Declarada estreita de propósito: o composable tem 20+
 * membros e nenhuma folha do quadro precisa dos outros.
 */
interface AssinaturaDoQuadro {
	painelTokenGise: { assinarComSerpro: () => Promise<void> } | null;
	serproSignerName: string;
	serproSignerCpf: string;
}

/**
 * O que o quadro LÊ da página. Declarada com getters no call site (objeto
 * literal em `+page.svelte`), para que cada acesso reavalie o `$derived` de
 * origem — mesmo contrato de `useGiseEstado({ getData })`.
 */
export interface FonteQuadroSupervisao {
	readonly gise: GiseSupervisaoGise | null;
	readonly policiais: PolicialOpcao[];
	readonly isAdminGeral: boolean;
	readonly isSeccional: boolean;
	readonly isSupervisor: boolean;
	readonly podeEditar: boolean;
	readonly podeDownload: boolean;
	readonly modoEdicaoGeral: boolean;
	readonly pendingCrud: boolean;
	readonly documentoAssinadoInfo: DocumentoAssinadoInfo | null;
	/** Presenças da GISE (entrada/saída) para os marcadores de rodagem. */
	readonly presencasGise: PresencaGiseLinha[] | null;
	/** Policiais SEINT do quadro que já enviaram relatório SEINT (sem `equipe_id`). */
	readonly seintSupervisaoComRelatorio: number[];
	/** Relatório de extra do quadro (unidade sintética). */
	readonly supervisaoExtraUnidadeId: number | null;
	readonly assinaturasRelatorios: GiseAssinaturaRelatorio[] | null;
	/** Exibe o painel de assinatura da escala (supervisor) dentro do quadro. */
	readonly mostrarPainelAssinaturaEscala: boolean;
	readonly assinaturaEscalaSignerEmail: string | undefined;
	/** E-mail do assessor vindo do `load` — consulta direta, sem o filtro `ativo=1` da lista. */
	readonly assessorEmailSugerido: string | undefined;
	readonly assinatura: AssinaturaDoQuadro;
	readonly onSubmitDesignacao: SubmitFunction;
	assinarExtraManual(): void;
	assinarExtraDigital(): void;
	abrirAssinaturaEscalaManual(): void;
	aoAssinarEscalaDigital(): Promise<void>;
}

export class QuadroSupervisaoEstado {
	readonly #fonte: FonteQuadroSupervisao;

	/**
	 * Ids em edição dos quatro papéis, indexados PELO papel — é o que permite
	 * `bind:value={quadro.ids[papel]}` nos dois slots SEINT, que são o mesmo
	 * componente parametrizado. (Antes eram quatro props `$bindable` e um objeto
	 * de accessors só para contorná-las dentro de snippets.)
	 */
	ids = $state<Record<PapelSupervisao, number | null>>({
		supervisor: null,
		assessor: null,
		seint1: null,
		seint2: null
	});

	/** E-mail onde o assessor recebe aviso quando uma seccional envia a GISE. */
	assessorEmailNotificacao = $state('');

	/** Papel com a edição inline aberta — a edição é EXCLUSIVA entre os quatro. */
	editandoPapel = $state<PapelSupervisao | null>(null);
	removendoPapel = $state<PapelSupervisao | null>(null);

	papelParaRemover = $state<PapelSupervisao | null>(null);
	confirmarRemocaoOpen = $state(false);

	/** Bookkeeping do efeito de sugestão de e-mail — não é estado de UI. */
	#prevAssessorParaEmail: number | null = null;

	readonly buscarDpcs = buscarPoliciaisOptions({
		cargo: 'DPC',
		rotulo: 'matricula',
		valorNumerico: true
	});
	readonly buscarOips = buscarPoliciaisOptions({
		cargo: 'OIP',
		rotulo: 'matricula',
		valorNumerico: true
	});

	constructor(fonte: FonteQuadroSupervisao) {
		this.#fonte = fonte;
	}

	// --- leitura da página -------------------------------------------------

	/**
	 * A página só monta o quadro dentro do `{#if gise}`; o erro abaixo existe
	 * para que montar fora dele falhe alto em vez de renderizar campos vazios.
	 */
	get gise(): GiseSupervisaoGise {
		const g = this.#fonte.gise;
		if (!g) {
			throw new Error('QuadroSupervisaoEstado.gise lido antes da GISE carregar.');
		}
		return g;
	}

	get policiais() {
		return this.#fonte.policiais;
	}
	get isAdminGeral() {
		return this.#fonte.isAdminGeral;
	}
	get isSeccional() {
		return this.#fonte.isSeccional;
	}
	get isSupervisor() {
		return this.#fonte.isSupervisor;
	}
	get podeEditar() {
		return this.#fonte.podeEditar;
	}
	get podeDownload() {
		return this.#fonte.podeDownload;
	}
	get modoEdicaoGeral() {
		return this.#fonte.modoEdicaoGeral;
	}
	get pendingCrud() {
		return this.#fonte.pendingCrud;
	}
	get documentoAssinadoInfo() {
		return this.#fonte.documentoAssinadoInfo;
	}
	get presencasGise() {
		return this.#fonte.presencasGise;
	}
	get supervisaoExtraUnidadeId() {
		return this.#fonte.supervisaoExtraUnidadeId;
	}
	get assinaturasRelatorios() {
		return this.#fonte.assinaturasRelatorios;
	}
	get mostrarPainelAssinaturaEscala() {
		return this.#fonte.mostrarPainelAssinaturaEscala;
	}
	get assinaturaEscalaSignerEmail() {
		return this.#fonte.assinaturaEscalaSignerEmail;
	}
	get assinatura() {
		return this.#fonte.assinatura;
	}
	get onSubmitDesignacao() {
		return this.#fonte.onSubmitDesignacao;
	}

	// --- derivações do quadro ----------------------------------------------

	/** Getter e não `$derived`: a lista tem no máximo dois ids e é lida duas vezes por render. */
	get seintRelatorioSet() {
		return new SvelteSet(this.#fonte.seintSupervisaoComRelatorio);
	}

	/** Há edição inline aberta em algum dos quatro papéis. */
	get editando() {
		return this.editandoPapel !== null;
	}

	/**
	 * Existe relatório de extra do quadro a exibir. Não depende de
	 * `podeDownload` — o bloco aparece para o DPC mesmo sem permissão de baixar;
	 * o que a permissão controla é o BOTÃO.
	 */
	get exigeRelatorioExtra() {
		return quadroSupervisaoExtraExigeRelatorio(this.gise);
	}

	/** Admin Geral vê o card da escala pendente sem poder assiná-la. */
	get painelAssinaturaEscalaReadonly() {
		return this.isAdminGeral && !this.documentoAssinadoInfo?.existe;
	}

	// --- helpers de policial ------------------------------------------------

	/**
	 * `data.policiais` contém APENAS os supports já vinculados (≤ 4 registros),
	 * para servir de label-resolver dos selects. A busca de novos nomes vai para
	 * `/api/policiais/search` sob demanda — antes: até 10 000 linhas no load.
	 */
	opcaoSelecionada(id: number | null): SelectedOption {
		if (id == null) return null;
		const p = this.policiais.find((x) => x.id === id);
		return p ? { value: p.id, label: `${p.nome} (${p.matricula})` } : null;
	}

	nomeDe(id: number | null | undefined): string | null {
		if (id == null) return null;
		return this.policiais.find((p) => p.id === id)?.nome ?? null;
	}

	// --- transições da designação ------------------------------------------

	iniciarEdicao(papel: PapelSupervisao) {
		this.editandoPapel = papel;
		this.#prevAssessorParaEmail = this.ids.assessor;
		if (this.ids.assessor != null) {
			const salvo = this.gise.assessor_email_notificacao?.trim();
			if (salvo) this.assessorEmailNotificacao = salvo;
			else void this.preencherEmailAssessorSugerido(this.ids.assessor);
		} else {
			this.assessorEmailNotificacao = '';
		}
	}

	cancelarEdicao() {
		const papel = this.editandoPapel;
		if (papel) {
			this.ids[papel] = this.#idPersistido(papel);
			if (papel === 'assessor') {
				this.assessorEmailNotificacao = this.gise.assessor_email_notificacao ?? '';
			}
		}
		this.editandoPapel = null;
		this.#prevAssessorParaEmail = null;
	}

	solicitarRemocao(papel: PapelSupervisao) {
		this.papelParaRemover = papel;
		this.confirmarRemocaoOpen = true;
	}

	/** Valor persistido (do `gise`) de cada papel, para cancelamento de edição. */
	#idPersistido(papel: PapelSupervisao): number | null {
		const g = this.gise;
		switch (papel) {
			case 'supervisor':
				return g.supervisor_id ?? null;
			case 'assessor':
				return g.assessor_id ?? null;
			case 'seint1':
				return g.seint1_id ?? null;
			case 'seint2':
				return g.seint2_id ?? null;
		}
	}

	// --- sincronização com a página ----------------------------------------

	/** Recarrega os ids do formulário a partir da GISE persistida. */
	sincronizarIdsComGise() {
		const g = this.#fonte.gise;
		if (!g) return;
		this.ids.supervisor = g.supervisor_id ?? null;
		this.ids.assessor = g.assessor_id ?? null;
		this.ids.seint1 = g.seint1_id ?? null;
		this.ids.seint2 = g.seint2_id ?? null;
	}

	/**
	 * Sugere o e-mail do assessor quando ele muda DURANTE a edição — o
	 * `SearchableSelect` só faz `bind:value`, então não há callback de troca.
	 */
	sincronizarEmailAssessor() {
		if (!this.editando) {
			this.#prevAssessorParaEmail = null;
			return;
		}
		const atual = this.ids.assessor;
		if (atual !== this.#prevAssessorParaEmail) {
			void this.preencherEmailAssessorSugerido(atual);
		}
		this.#prevAssessorParaEmail = atual;
	}

	/**
	 * Quem veio da busca (`/api/policiais/search`) não está na lista enxuta do
	 * load (sem e-mails). Admin geral: busca e-mails via endpoint dedicado.
	 */
	async preencherEmailAssessorSugerido(id: number | null) {
		if (id == null) {
			this.assessorEmailNotificacao = '';
			return;
		}
		const p = this.policiais.find((x) => x.id === id);
		const local = (p?.email_pessoal?.trim() || p?.email?.trim() || '') ?? '';
		if (local) {
			this.assessorEmailNotificacao = local;
			return;
		}
		const doLoad =
			id === this.#fonte.gise?.assessor_id ? (this.#fonte.assessorEmailSugerido?.trim() ?? '') : '';
		if (doLoad) {
			this.assessorEmailNotificacao = doLoad;
			return;
		}
		try {
			const d = await apiFetch<{ email_pessoal?: string | null; email?: string | null }>(
				`/api/policiais/${id}/email-aviso`
			);
			if (this.ids.assessor !== id) return;
			this.assessorEmailNotificacao = (d.email_pessoal?.trim() || d.email?.trim() || '') ?? '';
		} catch {
			/* preenchimento é best-effort — ignora falha de rede/servidor */
		}
	}

	// --- ações que a página executa ----------------------------------------

	assinarExtraManual() {
		this.#fonte.assinarExtraManual();
	}
	assinarExtraDigital() {
		this.#fonte.assinarExtraDigital();
	}
	abrirAssinaturaEscalaManual() {
		this.#fonte.abrirAssinaturaEscalaManual();
	}
	aoAssinarEscalaDigital() {
		return this.#fonte.aoAssinarEscalaDigital();
	}
}

const CHAVE_QUADRO_SUPERVISAO = Symbol('quadro-supervisao');

/** Cria e publica o estado do quadro. Só pode ser chamada na init da página. */
export function publicarQuadroSupervisao(fonte: FonteQuadroSupervisao): QuadroSupervisaoEstado {
	const estado = new QuadroSupervisaoEstado(fonte);
	setContext(CHAVE_QUADRO_SUPERVISAO, estado);
	return estado;
}

/** Lê o estado do quadro. Só funciona dentro de `<GiseSupervisao>`. */
export function quadroSupervisao(): QuadroSupervisaoEstado {
	const estado = getContext<QuadroSupervisaoEstado | undefined>(CHAVE_QUADRO_SUPERVISAO);
	if (!estado) {
		throw new Error(
			'quadroSupervisao() exige o contexto publicado por publicarQuadroSupervisao() na página da GISE.'
		);
	}
	return estado;
}
