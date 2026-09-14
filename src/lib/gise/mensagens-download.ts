/**
 * O texto dos diálogos de DOWNLOAD da listagem GISE, em um lugar só.
 *
 * A tela `/operacoes/gise` oferece o mesmo par de diálogos para dois documentos — a
 * escala e o relatório de serviço extraordinário —, e o "assinado" ainda se
 * divide por permissão. Isso montava SEIS objetos de diálogo à mão em
 * `gise/+page.svelte`: três da via assinada (escala, supervisão extra,
 * seccional) e três da não assinada. Os dois últimos de cada trio eram
 * idênticos, diferindo só em qual id de seccional entra na URL.
 *
 * O que a duplicação escondia não era o texto: era o `podeManifesto`. As três
 * cópias da via assinada ramificavam na MESMA aproximação de permissão
 * (`podeManifestoProvavel`), e apertar essa regra em uma delas deixaria as
 * outras oferecendo a folha de auditoria a quem o servidor vai recusar. O
 * usuário veria "Com manifesto", clicaria, e receberia a cópia de conferência
 * sem entender por quê.
 *
 * **O servidor continua sendo quem decide.** `podeManifesto` aqui é só o que a
 * TELA arrisca oferecer; quem não passa em `podeBaixarComManifesto` recebe a
 * via de conferência de qualquer forma. Errar para mais aqui não vaza nada —
 * só produz um botão que promete o que não entrega.
 *
 * Módulo PURO: devolve DESCRITOR (títulos, linhas e URLs), nunca closure. A
 * ação de abrir a URL e fechar o diálogo é da tela, que é quem tem o estado.
 * É o que torna o texto testável sem montar componente.
 *
 * As frases ficam INTEIRAS na tabela `TEXTOS`, e não montadas por concatenação
 * com sufixo de gênero ("Assinad" + "a"/"o"): a escala é feminina e o relatório
 * é masculino, e um terceiro documento com outra regra de concordância faria a
 * montagem produzir português errado em silêncio. Repetir a palavra é mais
 * barato que consertar isso depois.
 */

/** Um botão do diálogo: o rótulo e para onde ele leva. */
interface AcaoDownload {
	label: string;
	url: string;
}

/** O diálogo pronto para a tela vestir com os handlers dela. */
export interface DialogoDownload {
	titulo: string;
	linhas: string[];
	principal: AcaoDownload;
	/** Só existe quando a tela pode oferecer a folha de auditoria. */
	secundaria?: AcaoDownload;
}

export type DocumentoGise = 'escala' | 'relatorioExtra';

const TEXTOS: Record<
	DocumentoGise,
	{
		tituloAssinado: string;
		tituloNaoAssinado: string;
		jaAssinado: string;
		aindaNaoAssinado: string;
		/** Rótulo do botão único, quando não há variante com manifesto. */
		rotuloSimples: string;
	}
> = {
	escala: {
		tituloAssinado: 'Download de Escala Assinada',
		tituloNaoAssinado: 'Download de Escala não Assinada',
		jaAssinado: 'Esta escala já foi assinada digitalmente.',
		aindaNaoAssinado: 'Esta escala ainda não foi assinada digitalmente pelo supervisor.',
		rotuloSimples: 'Baixar PDF'
	},
	relatorioExtra: {
		tituloAssinado: 'Download de Relatório de Extra Assinado',
		tituloNaoAssinado: 'Download de Relatório de Extra não Assinado',
		jaAssinado: 'Este relatório de serviço extraordinário já foi assinado digitalmente.',
		aindaNaoAssinado:
			'Este relatório de serviço extraordinário ainda não foi assinado digitalmente.',
		rotuloSimples: 'Baixar Rel. Extra'
	}
};

/**
 * Documento já assinado digitalmente.
 *
 * Com `podeManifesto`, os dois botões são "Sem manifesto" (o que circula) e
 * "Com manifesto" (a folha de auditoria, com CPF/IP/GPS/selfie). Sem ele é um
 * botão só, e o texto NÃO menciona manifesto nenhum — oferecer e negar depois
 * é pior que não oferecer.
 */
export function dialogoDownloadAssinado(opcoes: {
	documento: DocumentoGise;
	url: string;
	urlComManifesto: string;
	podeManifesto: boolean;
}): DialogoDownload {
	const { documento, url, urlComManifesto, podeManifesto } = opcoes;
	const t = TEXTOS[documento];

	if (!podeManifesto) {
		return {
			titulo: t.tituloAssinado,
			linhas: [t.jaAssinado, 'O download gera o documento assinado para impressão e distribuição.'],
			principal: { label: t.rotuloSimples, url }
		};
	}

	return {
		titulo: t.tituloAssinado,
		linhas: [
			t.jaAssinado,
			'"Sem manifesto" gera o documento para impressão e distribuição.',
			'"Com manifesto" inclui a folha de auditoria (evidências da assinatura).'
		],
		principal: { label: 'Sem manifesto', url },
		secundaria: { label: 'Com manifesto', url: urlComManifesto }
	};
}

/**
 * Documento ainda sem assinatura: sai RASCUNHO, e o diálogo diz isso antes do
 * clique. Não há variante com manifesto — não existe assinatura para
 * documentar.
 */
export function dialogoDownloadNaoAssinado(opcoes: {
	documento: DocumentoGise;
	url: string;
}): DialogoDownload {
	const { documento, url } = opcoes;
	const t = TEXTOS[documento];

	return {
		titulo: t.tituloNaoAssinado,
		linhas: [t.aindaNaoAssinado, 'O download será de uma via preliminar (sem assinaturas).'],
		principal: { label: 'Confirmar Download', url }
	};
}
