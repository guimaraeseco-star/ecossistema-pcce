/**
 * O nome da corporação e dos órgãos, na grafia oficial — fonte única.
 *
 * Mora em `lib/` e não em `lib/server/` porque a página do DPO também o exibe,
 * e são strings puras: importar daqui no cliente não arrasta nada.
 *
 * Existe porque a divergência é o estado natural destas strings. Em ago/2026
 * havia **quatro** grafias da corporação espalhadas por cabeçalho de PDF, DOCX,
 * planilha, carimbo de assinatura, dois e-mails e uma página web — mais um
 * "DEPARTAMENTO DE POLÍCIA JUDICIÁRIA DO INTERIOR SUL", órgão que não existe,
 * sobrevivendo num documento impresso e assinado. Cada artefato nascia de um
 * copiar-colar do anterior, então a correção de um nunca chegava aos outros.
 *
 * São documentos oficiais e comunicação institucional: a grafia é a que consta
 * do organograma da corporação, não uma escolha de estilo. Mudar aqui muda em
 * todos os lugares de uma vez — que é o ponto — e exige regravar os goldens de
 * PDF (`UPDATE_PDF_GOLDENS=1`) e de e-mail (`UPDATE_EMAIL_GOLDENS=1`).
 */

/** Timbre de documento e carimbo — caixa alta. */
export const CORPORACAO = 'POLÍCIA CIVIL DO ESTADO DO CEARÁ';
export const DELEGACIA_GERAL = 'DELEGACIA GERAL DE POLÍCIA CIVIL';
export const DEPARTAMENTO = 'DEPARTAMENTO DE POLÍCIA DO INTERIOR SUL - DPI SUL';

/** A mesma corporação em texto corrido: e-mails e páginas. */
export const CORPORACAO_PROSA = 'Polícia Civil do Estado do Ceará';

/**
 * Nome do sistema — cabeçalho e remetente de e-mail, tela de login, título
 * padrão do layout e página do DPO. Decisão E30 do plano do Ecossistema
 * (set/2026): o sistema deixa de ser "Sistema de Escalas" e vira a plataforma
 * modular da corporação; o departamento aparece como DADO (E19), nunca no nome.
 *
 * Os `<title>` das páginas usam o sufixo literal `| Ecossistema PCCE` em vez
 * de importar esta constante: são 40 arquivos `.svelte` para um único token, e
 * o sufixo não entra em documento assinado nem em golden.
 */
export const SISTEMA_NOME = 'Ecossistema PCCE';

/**
 * Endereço e contato do DPI SUL — o rodapé que o plano operacional repete em
 * todas as páginas.
 *
 * Aqui pelo mesmo motivo das linhas acima: é texto institucional que aparece em
 * documento oficial, e literal no gerador é como as quatro grafias divergentes
 * da corporação nasceram.
 */
export const DPI_SUL_ENDERECO =
	'Rua Professor Guilhon, 2º andar, Aeroporto, Fortaleza-CE, CEP 60415-330';
export const DPI_SUL_EMAIL = 'dpis@pc.ce.gov.br';

/** Nome do departamento em texto corrido, como o rodapé o imprime. */
export const DEPARTAMENTO_PROSA = 'Departamento de Polícia do Interior Sul (DPI SUL)';

/** Cidade da emissão — o fecho do documento ("Fortaleza, 30 de agosto de 2026."). */
export const CIDADE_EMISSAO = 'Fortaleza';
