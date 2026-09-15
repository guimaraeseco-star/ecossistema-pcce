/**
 * Extração de EVENTOS do texto livre da planilha de histórico dos servidores
 * (coluna OBSERVAÇÕES: todas as anotações de um servidor numa célula só) —
 * fase 2-C, decisão do responsável em 15/09/2026.
 *
 * O texto tem padrões estáveis para o que mais importa, e é isso que vira
 * evento estruturado:
 *   - "FÉRIAS DE 02 A 16/01/2023" / "DE 27/02 A 08/03/2023" / "DE 26/12/2022 A
 *     04/01/2023" (várias faixas na mesma frase, separadas por ";" ou "E");
 *   - "LICENÇA MÉDICA (DE) 60 DIAS(,) A CONTAR|PARTIR DE 27/02/2025", "ATESTADO
 *     15 DIAS A PARTIR DE 18/04/22", "LICENÇA PATERNIDADE DE 16/10 A 04/11/2025";
 *   - "TRANSFERIDO DA X PARA A Y EM 18/02/22. PORTARIA 189/22", "REMOVIDO …
 *     PARA A …, CONFORME PORTARIA Nº 244/2025-GAB/PCCE, DE 20/05/2025";
 *   - "CEDIDO À POLÍCIA FEDERAL, PORTARIA …, DE 09/02/2021"; "CURSO … (01/11/2022
 *     A 10/03/2023)".
 * O que não casa vira ANOTAÇÃO (tipo `observacao`) com o texto original e a
 * primeira data encontrada — nada se perde, e a linha do tempo mostra o texto.
 * "CARGO ANTIGO: EPC." é descartado: já está no cadastro (`cargo_anterior`).
 *
 * Sustação e reprogramação de férias ficam como anotação de propósito: o texto
 * traz as datas velhas e as novas, e decidir qual vale é trabalho de gente.
 *
 * Sem dependência de `$lib` nem de servidor: o script de carga
 * (`scripts/importar-servidores.mjs`) importa este arquivo direto pelo Node.
 */

type TipoEventoTexto = 'afastamento' | 'movimentacao' | 'observacao';

export interface EventoDoTexto {
	tipo: TipoEventoTexto;
	/** Subtipo do catálogo de afastamentos; só para `afastamento`. */
	subtipo?: string;
	data_inicio?: string;
	data_fim?: string;
	data_evento?: string;
	unidade_destino?: string;
	nup?: string;
	/** O texto original da anotação — sempre presente. */
	descricao: string;
}

const NUP_RE = /\d{5}\.\d{6}\/\d{4}-\d{2}/;
const DATA_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/g;

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** `dd/mm/aaaa` ou `dd/mm/aa` → ISO; inválida → null. */
function dataISO(d: string, m: string, a: string): string | null {
	const dia = Number(d);
	const mes = Number(m);
	const ano = a.length === 2 ? 2000 + Number(a) : Number(a);
	if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || ano < 1990 || ano > 2100) return null;
	return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function somarDias(iso: string, dias: number): string {
	const t = Date.parse(iso + 'T00:00:00Z') + dias * 86400000;
	return new Date(t).toISOString().slice(0, 10);
}

/** Primeira data completa da frase, em ISO. */
function primeiraData(frase: string): string | undefined {
	const m = new RegExp(DATA_RE.source).exec(frase);
	return m ? (dataISO(m[1], m[2], m[3]) ?? undefined) : undefined;
}

/**
 * Faixas "A|ATÉ|– dd/mm/aaaa" com o início podendo omitir mês e ano ("02 A
 * 16/01/2023", "27/02 A 08/03/2023", "29/09/2026 ATÉ 08/10/2026"). O que falta
 * no início vem do fim.
 */
function faixas(frase: string): Array<{ inicio: string; fim: string }> {
	const saida: Array<{ inicio: string; fim: string }> = [];
	const re =
		/(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{4}|\d{2}))?\s*(?:[Aa][Tt][ÉéEe]|[Aa]|-|–)\s*(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(frase))) {
		const fim = dataISO(m[4], m[5], m[6]);
		const inicio = dataISO(m[1], m[2] ?? m[5], m[3] ?? m[6]);
		if (inicio && fim && inicio <= fim) saida.push({ inicio, fim });
	}
	return saida;
}

/** Subtipo de licença pelo texto; LTS quando é médica/atestado ou genérica. */
function subtipoDeLicenca(f: string): string {
	if (/MATERNIDADE|GESTANTE/.test(f)) return 'maternidade';
	if (/PATERN/.test(f)) return 'paternidade';
	if (/ADOTANTE|ADOCAO/.test(f)) return 'adotante';
	if (/CASAMENTO|GALA/.test(f)) return 'casamento';
	if (/LUTO|NOJO|FALECIMENTO/.test(f)) return 'luto';
	if (/INTERESSE PARTICULAR|LIP\b/.test(f)) return 'lip';
	if (/ACOMPANH|PESSOA DA FAMILIA|FAMILIAR/.test(f)) return 'acompanhamento_familiar';
	if (/PREMIO|ESPECIAL/.test(f)) return 'outros';
	return 'lts';
}

/**
 * Quebra a célula em anotações: por linha e por ". " seguido de maiúscula ou
 * de outra data — o texto foi digitado como frases, mas sem quebra de linha
 * regular.
 */
export function quebrarAnotacoes(texto: string): string[] {
	return texto
		.split(/\r?\n|(?<=\d{4})\.\s+|(?<=[a-zà-ú)])\.\s+(?=[A-ZÀ-Ú])/)
		.map((s) => s.replace(/\s+/g, ' ').trim())
		.filter((s) => s.length > 3);
}

/** Uma anotação → zero, um ou vários eventos. */
export function extrairEventos(anotacao: string): EventoDoTexto[] {
	const f = semAcento(anotacao);
	const nup = (anotacao.match(NUP_RE) ?? [undefined])[0];
	const descricao = anotacao.slice(0, 1000);
	const base = { descricao, ...(nup ? { nup } : {}) };

	if (/^CARGO ANTIGO\s*:/.test(f)) return [];

	// Sustação/reprogramação: as datas do texto são as velhas E as novas.
	const anotacaoComData = (): EventoDoTexto[] => [
		{ tipo: 'observacao', ...base, data_evento: primeiraData(anotacao) }
	];
	if (/SUSTA|REPROGRAM|CANCELAD|ALTERAD/.test(f)) return anotacaoComData();

	// Férias: uma faixa por período citado.
	if (/^.{0,40}FERIAS/.test(f) && !/LICENCA|ATESTADO/.test(f)) {
		const fx = faixas(anotacao);
		if (fx.length)
			return fx.map((x) => ({
				tipo: 'afastamento',
				subtipo: 'ferias',
				data_inicio: x.inicio,
				data_fim: x.fim,
				...base
			}));
		return anotacaoComData();
	}

	// Licenças e atestados: "N DIAS A CONTAR/PARTIR DE data" ou faixa.
	if (/LICENCA|ATESTADO|\bLTS\b/.test(f)) {
		const subtipo = subtipoDeLicenca(f);
		const dias = /(\d{1,4})\s*DIAS?/.exec(f);
		const contar = /(?:A (?:CONTAR|PARTIR) DE|DESDE|EM)\s+(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/.exec(
			f
		);
		if (dias && contar) {
			const inicio = dataISO(contar[1], contar[2], contar[3]);
			if (inicio)
				return [
					{
						tipo: 'afastamento',
						subtipo,
						data_inicio: inicio,
						data_fim: somarDias(inicio, Number(dias[1]) - 1),
						...base
					}
				];
		}
		const fx = faixas(anotacao);
		if (fx.length === 1)
			return [
				{ tipo: 'afastamento', subtipo, data_inicio: fx[0].inicio, data_fim: fx[0].fim, ...base }
			];
		return anotacaoComData();
	}

	// Curso com faixa de datas.
	if (/CURSO|CAPACITACAO|POS-GRADUACAO|MESTRADO/.test(f)) {
		const fx = faixas(anotacao);
		if (fx.length === 1)
			return [
				{
					tipo: 'afastamento',
					subtipo: 'estudante',
					data_inicio: fx[0].inicio,
					data_fim: fx[0].fim,
					...base
				}
			];
		return anotacaoComData();
	}

	// Cessão: com data de início quando há; fim aberto.
	if (/CEDID|A DISPOSICAO|CESSAO/.test(f)) {
		const inicio = primeiraData(anotacao);
		if (inicio) return [{ tipo: 'afastamento', subtipo: 'cessao', data_inicio: inicio, ...base }];
		return anotacaoComData();
	}

	// Movimentação: transferência/remoção/lotação com data.
	if (/TRANSFERID|REMOVID|REMOCAO|LOTAD|MOVIMENTAD|APRESENTOU-SE|APRESENTACAO/.test(f)) {
		const data = primeiraData(anotacao);
		const destino =
			/PARA (?:A |O |AS |OS )?([^,.;]{3,80}?)(?=,| EM \d|\. | CONFORME| A PARTIR| ATRAVES|$)/i.exec(
				anotacao
			);
		return [
			{
				tipo: 'movimentacao',
				...(data ? { data_evento: data } : {}),
				...(destino ? { unidade_destino: destino[1].trim().slice(0, 120) } : {}),
				...base
			}
		];
	}

	return anotacaoComData();
}

/** A célula inteira → a lista de eventos, na ordem do texto. */
export function extrairHistorico(celula: string): EventoDoTexto[] {
	return quebrarAnotacoes(celula).flatMap(extrairEventos);
}
