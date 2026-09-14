/**
 * A FAIXA de custo de um servidor: o par (cargo, classe) traduzido na coluna de
 * `custo_parametros` que vale para ele.
 *
 * A corporação paga hora extra em quatro faixas, e não uma por classe: as
 * classes andam em pares. OIP D e C valem o mesmo; OIP B e A, outro; DPC 1ª e
 * 2ª, outro; DPC 3ª e ESPECIAL, o quarto. Diária não tem faixa — é valor único
 * para todos, e por isso não passa por aqui.
 *
 * ## `null` é resposta, não falha
 *
 * `policiais.classe` é `text NOT NULL DEFAULT ''`: existe servidor cadastrado
 * sem classe, e não é raro. Se esta função "resolvesse" isso escolhendo a faixa
 * mais barata, ou devolvesse 0, o plano sairia com o efetivo inteiro na tela e
 * um custo menor do que o real — errado de um jeito que nada no PDF denuncia.
 *
 * Por isso o não-classificável devolve `null`, e quem chama é obrigado a
 * decidir o que fazer com ele. Nesta entrega, a tela marca a pendência e o
 * endpoint de download RECUSA a emissão (ver `custoDoPlano` e
 * `/api/planos/[id]/download`). Um documento orçado a menor circula melhor do
 * que um erro na tela, e é exatamente por isso que ele não pode existir.
 *
 * O domínio das classes é o mesmo de `classesDoCargo()`
 * (`$lib/cadastro-campos`) — DPC = `1ª 2ª 3ª ESPECIAL`, OIP = `A B C D`. Não é
 * reimplementado aqui: é dele que o cadastro valida, e duas listas divergiriam.
 */

/** As quatro faixas de hora extra. Cada uma é um par de colunas em `custo_parametros`. */
export type FaixaCusto = 'oip_cd' | 'oip_ab' | 'dpc_12' | 'dpc_3e';

/**
 * Normaliza a classe para comparação: caixa alta e sem espaço nas pontas.
 *
 * O cadastro grava o que o `<select>` ofereceu, mas a sincronização com a
 * planilha da corporação (`webhook/sync-policiais`) não passa por esse select —
 * `especial` em minúsculas chega de lá.
 */
function normalizar(v: string | null | undefined): string {
	return (v ?? '').trim().toUpperCase();
}

/**
 * A faixa deste servidor, ou `null` quando o par (cargo, classe) não é
 * classificável — classe em branco, classe fora do domínio do cargo, ou cargo
 * que não é DPC nem OIP.
 *
 * Nunca "chuta" uma faixa: ver o cabeçalho do módulo.
 */
export function faixaDoPolicial(
	cargo: string | null | undefined,
	classe: string | null | undefined
): FaixaCusto | null {
	const c = normalizar(cargo);
	const k = normalizar(classe);

	if (c === 'DPC') {
		if (k === '1ª' || k === '2ª') return 'dpc_12';
		if (k === '3ª' || k === 'ESPECIAL') return 'dpc_3e';
		return null;
	}

	if (c === 'OIP') {
		if (k === 'C' || k === 'D') return 'oip_cd';
		if (k === 'A' || k === 'B') return 'oip_ab';
		return null;
	}

	return null;
}

/** Rótulo da faixa para a tela de valores (`/valores`). */
export const ROTULO_FAIXA: Record<FaixaCusto, string> = {
	oip_cd: 'OIP — classes D e C',
	oip_ab: 'OIP — classes B e A',
	dpc_12: 'DPC — 1ª e 2ª classe',
	dpc_3e: 'DPC — 3ª classe e especial'
};

/** As quatro faixas na ordem em que a tela de valores as apresenta. */
export const FAIXAS: readonly FaixaCusto[] = ['oip_cd', 'oip_ab', 'dpc_12', 'dpc_3e'];

/**
 * A CATEGORIA do Anexo II — o consolidado financeiro agrupa por cargo, não por
 * faixa: o modelo imprime "Delegados (DPC)" e "Agentes (OIP)", duas linhas.
 */
export type CategoriaAnexo = 'dpc' | 'oip';

/** Rótulos do Anexo II, na grafia do documento. */
export const ROTULO_CATEGORIA: Record<CategoriaAnexo, string> = {
	dpc: 'Delegados (DPC)',
	oip: 'Agentes (OIP)'
};

/** A categoria do Anexo II correspondente a uma faixa. */
export function categoriaDaFaixa(faixa: FaixaCusto): CategoriaAnexo {
	return faixa === 'dpc_12' || faixa === 'dpc_3e' ? 'dpc' : 'oip';
}
