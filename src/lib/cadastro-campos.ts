/**
 * O domínio dos campos cadastrais do policial que entram numa SOLICITAÇÃO de
 * alteração — quais são, como se chamam na tela e o que cada um aceita.
 *
 * Quem pede é o administrador de seccional ou de unidade, na ficha do servidor
 * (`/servidores/[id]`); quem decide é o Admin Geral, em `/solicitacoes`. O
 * próprio servidor NÃO pede alteração do próprio cadastro — em "Meu perfil" ele
 * só troca o e-mail pessoal, que tem fluxo próprio com código de verificação.
 *
 * Duas ausências desta lista são decisões, não esquecimento:
 *
 * - **`email_pessoal`** não é solicitável por ninguém além do titular. Ele é o
 *   canal de recuperação da conta: quem consegue trocá-lo para um endereço seu
 *   assume a identidade da pessoa no próximo "esqueci a senha". Por isso a troca
 *   exige a senha do titular MAIS um código enviado ao novo endereço, e nenhum
 *   administrador entra nesse caminho.
 * - **`lotacao`** saiu daqui em ago/2026: transferir servidor é MOVIMENTAÇÃO, e
 *   movimentação tem data, NUP e portaria anexa — coisas que `valor_novo` não
 *   guarda. O pedido vai pelo quadro "Afastar / Movimentar Servidor", que grava
 *   o evento na linha do tempo funcional. Deixar os dois caminhos abertos
 *   produziria transferência sem portaria, indistinguível de uma com portaria
 *   depois de gravada.
 *
 * Mora em `$lib/` (não em `$lib/server/`) porque a tela precisa das MESMAS
 * regras que o servidor aplica: rótulo, domínio de valor e o teto da
 * justificativa. Duas listas divergiriam, e a que divergisse em silêncio seria a
 * do cliente.
 */

/** Classes válidas por cargo. */
export function classesDoCargo(cargo: string): string[] {
	return cargo === 'DPC' ? ['1ª', '2ª', '3ª', 'ESPECIAL'] : ['A', 'B', 'C', 'D'];
}

/**
 * Telefone: dígitos e separadores usuais, 8–20 caracteres.
 *
 * Privado ao módulo: quem valida é `motivoParaRecusarValor`, e é ele que devolve
 * a MENSAGEM junto. Exportar o regex convidaria um call site a testá-lo e
 * escrever a própria recusa — que é como duas telas passam a dizer coisas
 * diferentes sobre o mesmo número.
 */
const TELEFONE_RE = /^[0-9()+\-\s]{8,20}$/;

/**
 * Teto da justificativa que acompanha TODO pedido de alteração — cadastral ou
 * de RH. Vale nos dois lados: o `maxlength` do textarea e o corte do servidor.
 */
export const MAX_JUSTIFICATIVA = 300;

/**
 * Os campos que uma solicitação pode alterar. `lotacao` continua no tipo por
 * causa das linhas anteriores a ago/2026 (ver o cabeçalho) — ele é exibível,
 * mas não é ofertado em pedido novo: `CAMPOS_SOLICITAVEIS` é a lista viva.
 */
export type CampoSolicitacao =
	'nome' | 'matricula' | 'cargo' | 'cpf' | 'telefone' | 'classe' | 'regime' | 'email' | 'lotacao';

/** Rótulos de exibição — a mesma palavra na ficha, na fila e no histórico. */
export const ROTULO_CAMPO: Record<CampoSolicitacao, string> = {
	nome: 'Nome completo',
	matricula: 'Matrícula',
	cargo: 'Cargo',
	cpf: 'CPF',
	telefone: 'Telefone',
	classe: 'Classe',
	regime: 'Regime de trabalho',
	email: 'E-mail funcional',
	lotacao: 'Lotação'
};

/**
 * O que um pedido NOVO pode conter, na ordem em que a ficha os apresenta.
 * Fonte única: o formulário monta os campos a partir dela e o servidor recusa
 * qualquer nome fora dela.
 */
export const CAMPOS_SOLICITAVEIS = [
	'nome',
	'matricula',
	'cargo',
	'cpf',
	'telefone',
	'classe',
	'regime',
	'email'
] as const satisfies readonly CampoSolicitacao[];

export type CampoSolicitavel = (typeof CAMPOS_SOLICITAVEIS)[number];

/**
 * O valor pedido serve para o campo? Devolve `null` quando serve, ou a mensagem
 * de recusa.
 *
 * `cargo` decide as classes válidas — por isso ele entra como parâmetro em vez
 * de a função ler o cadastro: quando o pedido troca cargo E classe na mesma
 * submissão, a classe precisa ser conferida contra o cargo PEDIDO, não contra o
 * que ainda está gravado.
 */
export function motivoParaRecusarValor(
	campo: CampoSolicitavel,
	valor: string,
	cargoAlvo: string
): string | null {
	switch (campo) {
		case 'nome':
			return valor.length <= 200 ? null : 'Nome muito longo (máx. 200 caracteres).';
		case 'matricula':
			return /^\d{1,20}$/.test(valor.replace(/\D/g, '')) && valor.length <= 20
				? null
				: 'Matrícula inválida — use apenas números (máx. 20).';
		case 'cargo':
			return valor === 'DPC' || valor === 'OIP' ? null : 'Cargo deve ser DPC ou OIP.';
		case 'cpf':
			return /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(valor)
				? null
				: 'CPF inválido (use 11 dígitos ou o formato ###.###.###-##).';
		case 'telefone':
			return TELEFONE_RE.test(valor)
				? null
				: 'Telefone inválido — use apenas números, espaços, ( ) + -.';
		case 'classe':
			return classesDoCargo(cargoAlvo).includes(valor)
				? null
				: `Classe inválida para o cargo ${cargoAlvo}.`;
		case 'regime':
			return valor === 'plantao' || valor === 'expediente' ? null : 'Regime inválido.';
		case 'email':
			return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor) ? null : 'E-mail funcional inválido.';
	}
}
