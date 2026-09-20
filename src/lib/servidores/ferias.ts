/**
 * As REGRAS de férias do policial civil, puras — sem banco, sem tela.
 *
 * Fonte de cada regra, para quem precisar conferir: o art. 60 do Estatuto
 * (Lei 12.124/93), o Decreto 32.907/2018 com as alterações dos Decretos
 * 33.216/2019, 33.739/2020 e 34.495/2021, e — para o abono — a Lei 19.472/2025
 * com o Decreto 37.363/2026. A leitura está em
 * `C:\Ecossistema-PCCE\01-planos\Fase2C-Ferias-Abono-proposta.md`.
 *
 * O que este módulo NÃO faz, por decisão do responsável (17/09/2026): a
 * programação anual — ela é feita no GUARDIÃO, sistema do Governo, e entra
 * aqui já homologada. O sistema recebe as frações, prepara os pedidos de
 * REPROGRAMAÇÃO à COGEP e registra o abono.
 *
 * A pergunta central, e a razão de este arquivo existir: **sustação ou
 * suspensão?** Os servidores confundem os dois e o pedido chega errado à
 * COGEP. A régua, na prática da COGEP e confirmada pelo responsável, é UMA:
 *
 *   - a fração **ainda não começou** → SUSTAÇÃO. Não exige motivo.
 *   - a fração **já começou** → SUSPENSÃO. Exige imperiosa necessidade do
 *     serviço, ao menos 7 dias gozados e reprogramação em até 10 dias.
 *
 * E as férias são UM período, ainda que fracionado (decisão dele, 17/09/2026):
 * a programação entra pela divisão escolhida (uma das cinco formas) mais o 1º
 * dia de cada fração — o último sai da regra —, a sustação alcança todas as
 * frações não iniciadas de uma vez e pode redividi-las, e a suspensão é a
 * exceção, porque o servidor já está de férias. O § 13 do Dec. 33.739/2020
 * (suspender a 2ª antes de começar, com a 1ª gozada) fica fora: na prática da
 * COGEP o que não começou se susta.
 */
import { adicionarDias, diffDiasInclusivo, formatarData } from '$lib/utils/datas';
import type { SubtipoAfastamento } from './afastamentos';

/* ── Frações ─────────────────────────────────────────────────────────────── */

/**
 * O estado de uma fração da programação.
 *
 * `sustada` e `suspensa` são estados FINAIS da fração antiga: a nova entra
 * como `programada`. O par fica na sucessão, que é o que a COGEP e a ficha
 * querem ver.
 */
export type StatusFracao = 'programada' | 'em_gozo' | 'gozada' | 'sustada' | 'suspensa';

export const ROTULO_STATUS_FRACAO: Record<StatusFracao, string> = {
	programada: 'Programada',
	em_gozo: 'Em gozo',
	gozada: 'Gozada',
	sustada: 'Sustada',
	suspensa: 'Suspensa'
};

/** Uma fração como as regras a enxergam — o recorte da linha do banco. */
export interface Fracao {
	ordem: 1 | 2 | 3;
	data_inicio: string;
	data_fim: string;
	status: StatusFracao;
	/**
	 * Dias VENDIDOS (abono deferido) dentro da fração. Não se gozam nem se
	 * sustam: o que resta à sustação é o que sobra deles (decisão dele,
	 * 20/09). Ausente = nenhum.
	 */
	diasAbonados?: number;
}

/**
 * As cinco formas de fracionar 30 dias (Dec. 32.907, art. 3º § 1º). Lista
 * FECHADA; a ordem importa (10+20 e 20+10 são opções distintas).
 */
const FRACIONAMENTOS_VALIDOS: readonly (readonly number[])[] = [
	[30],
	[10, 20],
	[20, 10],
	[15, 15],
	[10, 10, 10]
];

// O mínimo de 10 dias por fração (Dec. 33.216/2019, art. 11, p. único) não
// precisa de checagem própria: toda divisão nasce de uma das cinco formas
// acima, e a única fração menor que isso é o que resta de uma SUSPENSÃO —
// que não é escolha de ninguém, é o que sobrou.

/** As frações de um exercício formam uma das cinco formas? */
export function fracionamentoValido(diasPorFracao: readonly number[]): boolean {
	return FRACIONAMENTOS_VALIDOS.some(
		(f) => f.length === diasPorFracao.length && f.every((d, i) => d === diasPorFracao[i])
	);
}

/** Dias de uma fração, inclusivos ("01/07 a 15/07" = 15). */
export function diasDaFracao(f: Pick<Fracao, 'data_inicio' | 'data_fim'>): number {
	return diffDiasInclusivo(f.data_inicio, f.data_fim);
}

/** Os dias que ainda se GOZAM (e, portanto, se sustam): a fração menos os vendidos. */
export function diasAGozar(f: Pick<Fracao, 'data_inicio' | 'data_fim' | 'diasAbonados'>): number {
	return Math.max(0, diasDaFracao(f) - (f.diasAbonados ?? 0));
}

/**
 * O status que a data de hoje dá a uma fração programada. `sustada` e
 * `suspensa` são decididos por ato, nunca pela data — e por isso passam
 * intactos.
 */
export function statusPelaData(f: Fracao, hojeISO: string): StatusFracao {
	if (f.status === 'sustada' || f.status === 'suspensa') return f.status;
	if (hojeISO < f.data_inicio) return 'programada';
	if (hojeISO > f.data_fim) return 'gozada';
	return 'em_gozo';
}

/* ── Período aquisitivo ──────────────────────────────────────────────────── */

/**
 * O período aquisitivo de um exercício, contado da posse (Dec. 32.907, art.
 * 3º: 12 meses de efetivo exercício a partir do ingresso).
 *
 * `exercicio` é o ANO EM QUE O PERÍODO AQUISITIVO SE COMPLETA — a convenção
 * da Seplag ("férias do exercício 2026" = o aquisitivo que fechou em 2026).
 * Posse em 15/03/2019: exercício 2020 = 15/03/2019 a 14/03/2020; exercício
 * 2026 = 15/03/2025 a 14/03/2026.
 *
 * Devolve `null` quando o exercício é anterior ao primeiro aquisitivo possível.
 * Suspensões do aquisitivo por afastamento que não conta como efetivo
 * exercício (§ 4º) NÃO entram aqui — decisão de 17/09: o responsável mandou
 * contar da posse, e é o que se conta.
 */
export function periodoAquisitivo(
	dataPosseISO: string,
	exercicio: number
): { inicio: string; fim: string } | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPosseISO)) return null;
	const [anoPosse, mes, dia] = dataPosseISO.split('-').map(Number);
	const n = exercicio - anoPosse;
	if (n < 1) return null;
	const inicio = isoSeguro(anoPosse + n - 1, mes, dia);
	const fim = adicionarDias(isoSeguro(anoPosse + n, mes, dia), -1);
	return { inicio, fim };
}

/**
 * A janela em que o gozo é devido: os 11 meses seguintes ao mês em que o
 * aquisitivo se completou (art. 3º § 5º). Fora dela não é proibido — é o que
 * o decreto chama de acumulação, que só avisa.
 */
export function janelaDeGozo(aquisitivo: { fim: string }): { inicio: string; fim: string } {
	const [ano, mes] = aquisitivo.fim.split('-').map(Number);
	// Primeiro dia do mês seguinte ao do fim; onze meses depois, o último dia.
	const inicio = isoSeguro(mes === 12 ? ano + 1 : ano, mes === 12 ? 1 : mes + 1, 1);
	const [a2, m2] = inicio.split('-').map(Number);
	const mesFim = m2 + 10;
	const anoFim = a2 + Math.floor((mesFim - 1) / 12);
	const mesFimNorm = ((mesFim - 1) % 12) + 1;
	const proximo = isoSeguro(
		mesFimNorm === 12 ? anoFim + 1 : anoFim,
		mesFimNorm === 12 ? 1 : mesFimNorm + 1,
		1
	);
	return { inicio, fim: adicionarDias(proximo, -1) };
}

/** `YYYY-MM-DD` com dia ajustado ao mês (29/02 numa posse em ano bissexto vira 28/02). */
function isoSeguro(ano: number, mes: number, dia: number): string {
	const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
	const d = Math.min(dia, ultimo);
	return `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* ── As férias são UM período: a divisão e o 1º dia de cada fração ──────── */

/**
 * As divisões possíveis para `dias` — o que o formulário oferece.
 *
 * Para 30 dias, as cinco formas. Para o que RESTA depois de uma sustação
 * parcial (a 1ª fração já gozada, por exemplo), os sufixos das cinco formas
 * que somam o restante: 20 → [20] ou [10, 10]; 15 → [15]; 10 → [10]. É a
 * regra que se adapta, por construção — não há uma segunda tabela para
 * manter (pedido dele, 17/09: "as férias são um período só, mesmo
 * fracionadas").
 */
export function divisoesPossiveis(dias: number): readonly (readonly number[])[] {
	const vistas = new Set<string>();
	const saida: (readonly number[])[] = [];
	for (const forma of FRACIONAMENTOS_VALIDOS) {
		for (let i = 0; i < forma.length; i++) {
			const sufixo = forma.slice(i);
			if (sufixo.reduce((a, b) => a + b, 0) !== dias) continue;
			const chave = sufixo.join('+');
			if (vistas.has(chave)) continue;
			vistas.add(chave);
			saida.push(sufixo);
		}
	}
	return saida;
}

/** "10 + 20" — como a divisão aparece na tela e viaja no formulário. */
export function rotuloDaDivisao(divisao: readonly number[]): string {
	return divisao.join(' + ');
}

/** O último dia de uma fração de `dias` a partir do 1º ("01/10" + 10 = "10/10"). */
export function fimDaFracao(inicioISO: string, dias: number): string {
	return adicionarDias(inicioISO, dias - 1);
}

/**
 * O 1º dia de uma fração tem de ser dia útil: nem fim de semana, nem feriado
 * nacional (regra do Guardião, que a unidade reproduz ao digitar aqui — o
 * lançamento de 01/11/2026, um domingo, passou antes desta checagem).
 */
export function conferirPrimeiroDia(inicioISO: string, feriados: readonly string[]): Checagem {
	const diaSemana = new Date(inicioISO + 'T00:00:00Z').getUTCDay();
	const fimDeSemana = diaSemana === 0 || diaSemana === 6;
	const feriado = feriados.includes(inicioISO);
	return {
		ok: !fimDeSemana && !feriado,
		nivel: 'erro',
		texto: fimDeSemana
			? `${formatarData(inicioISO)} cai em fim de semana: o primeiro dia precisa ser dia útil.`
			: feriado
				? `${formatarData(inicioISO)} é feriado: o primeiro dia precisa ser dia útil.`
				: `${formatarData(inicioISO)} é dia útil.`
	};
}

/** Um período montado a partir do 1º dia e da quantidade de dias. */
export interface PeriodoMontado {
	inicio: string;
	fim: string;
	dias: number;
}

/**
 * Monta os períodos de uma divisão a partir do 1º dia de cada fração, e
 * confere o que o Guardião conferiria: cada 1º dia é dia útil, e as frações
 * vêm em ordem, sem se sobrepor. Devolve os períodos e as checagens; com
 * erro, o chamador não grava.
 */
export function montarPeriodos(
	divisao: readonly number[],
	inicios: readonly string[],
	feriados: readonly string[]
): { periodos: PeriodoMontado[]; checagens: Checagem[] } {
	// Alinhado à divisão (`null` onde falta o 1º dia), para a sobreposição
	// comparar cada fração com a ANTERIOR dela e não com a última válida.
	const montados: (PeriodoMontado | null)[] = [];
	const checagens: Checagem[] = [];
	for (let i = 0; i < divisao.length; i++) {
		const inicio = inicios[i] ?? '';
		if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) {
			checagens.push({ ok: false, nivel: 'erro', texto: `Informe o 1º dia da ${i + 1}ª fração.` });
			montados.push(null);
			continue;
		}
		const dias = divisao[i];
		const fim = fimDaFracao(inicio, dias);
		montados.push({ inicio, fim, dias });
		const primeiroDia = conferirPrimeiroDia(inicio, feriados);
		checagens.push({ ...primeiroDia, texto: `${i + 1}ª fração: ${primeiroDia.texto}` });
		const anterior = montados[i - 1];
		if (anterior && inicio <= anterior.fim) {
			checagens.push({
				ok: false,
				nivel: 'erro',
				texto: `A ${i + 1}ª fração (${formatarData(inicio)}) começa antes de a ${i}ª terminar (${formatarData(anterior.fim)}).`
			});
		}
	}
	return { periodos: montados.filter((p): p is PeriodoMontado => p !== null), checagens };
}

/**
 * Na SUSPENSÃO, o que resta da fração em gozo depois do retorno ao serviço:
 * é isso que a fração nova precisa ter — não a quantidade original.
 */
export function diasRestantesNaSuspensao(
	fracao: Pick<Fracao, 'data_inicio' | 'data_fim'>,
	dataSuspensaoISO: string
): { gozados: number; restantes: number } {
	const gozados = diffDiasInclusivo(fracao.data_inicio, adicionarDias(dataSuspensaoISO, -1));
	return { gozados, restantes: Math.max(0, diasDaFracao(fracao) - gozados) };
}

/* ── O pedido gravado: os JSONs da linha ────────────────────────────────── */

/**
 * Os períodos pedidos, lidos do JSON de `ferias_reprogramacoes.novos_periodos`.
 * Mora aqui, e não na camada de dados, porque o cartão da ficha lê o pedido
 * no NAVEGADOR — `$lib/db` é módulo de servidor e não pode ir para lá.
 */
export function periodosDoPedido(pedido: { novos_periodos: string }): PeriodoMontado[] {
	try {
		const lista = JSON.parse(pedido.novos_periodos) as unknown;
		if (!Array.isArray(lista)) return [];
		return lista.filter(
			(p): p is PeriodoMontado =>
				typeof p === 'object' &&
				p !== null &&
				typeof (p as PeriodoMontado).inicio === 'string' &&
				typeof (p as PeriodoMontado).fim === 'string' &&
				typeof (p as PeriodoMontado).dias === 'number'
		);
	} catch {
		return [];
	}
}

/** As frações alcançadas pelo pedido: a suspensa (`fracao_id`) ou as sustadas (`fracoes_ids`, JSON). */
export function fracoesDoPedido(pedido: {
	fracoes_ids: string;
	fracao_id: number | null;
}): number[] {
	if (pedido.fracao_id) return [pedido.fracao_id];
	try {
		const lista = JSON.parse(pedido.fracoes_ids) as unknown;
		return Array.isArray(lista) ? lista.filter((n): n is number => Number.isInteger(n)) : [];
	} catch {
		return [];
	}
}

/* ── Reprogramação: sustação × suspensão ─────────────────────────────────── */

export type TipoReprogramacao = 'sustacao' | 'suspensao';

export const ROTULO_TIPO_REPROGRAMACAO: Record<TipoReprogramacao, string> = {
	sustacao: 'Sustação',
	suspensao: 'Suspensão'
};

/** Uma checagem, com o resultado e o texto que a tela mostra. */
export interface Checagem {
	ok: boolean;
	/** `aviso` deixa passar; `erro` recusa. */
	nivel: 'erro' | 'aviso';
	texto: string;
}

/** Fundamento legal de cada instituto, para o texto do NUP. */
const BASE_LEGAL: Record<TipoReprogramacao, string> = {
	sustacao: 'Dec. 32.907/2018, art. 3º §§ 10 e 14 (red. Dec. 34.495/2021)',
	suspensao:
		'Dec. 32.907/2018, art. 3º § 12 (red. Dec. 33.739/2020) e art. 6º III (red. Dec. 34.495/2021)'
};

/** O que cabe pedir num exercício HOJE — decidido pelos fatos, não por escolha. */
export interface SituacaoDaReprogramacao {
	/**
	 * SUSTAÇÃO: as frações ainda não iniciadas, todas de uma vez — as férias
	 * são UM período. `diasRestantes` é o que a nova divisão redistribui;
	 * `divisoes` traz a divisão atual primeiro e depois as outras formas do
	 * decreto que somam o mesmo. `null` quando nada resta por começar.
	 */
	sustacao: {
		fracoes: Fracao[];
		diasRestantes: number;
		divisoes: readonly (readonly number[])[];
		motivo: string;
	} | null;
	/**
	 * SUSPENSÃO: a fração em gozo hoje — a única exceção à regra do período
	 * único, porque o servidor já está de férias. `null` quando ninguém
	 * está em gozo.
	 */
	suspensao: { fracao: Fracao; motivo: string } | null;
}

/**
 * Sustação ou suspensão? Decide pelos FATOS — as datas das frações e a data
 * de hoje —, não por escolha do usuário. É o que impede o pedido errado: o
 * chefe imediato vê o nome do caso e o motivo antes de escrever o NUP.
 *
 * A sustação alcança TODAS as frações que ainda não começaram (decisão do
 * responsável, 17/09/2026: "as férias são um período só, mesmo fracionadas;
 * precisam ser sustadas juntas"), e pode redividi-las. A suspensão mira só a
 * fração em gozo; as futuras ficam como estão.
 */
export function situacaoDaReprogramacao(
	fracoesDoExercicio: readonly Fracao[],
	hojeISO: string
): SituacaoDaReprogramacao {
	const vivas = fracoesDoExercicio.filter((f) => f.status === 'programada');
	// Fração inteira vendida (abono sobre todos os dias) não se susta: já está
	// resolvida em pecúnia. Com venda parcial, entra só o que resta a gozar.
	const sustaveis = vivas.filter(
		(f) => statusPelaData(f, hojeISO) === 'programada' && diasAGozar(f) > 0
	);
	const emGozo = vivas.find((f) => statusPelaData(f, hojeISO) === 'em_gozo') ?? null;

	let sustacao: SituacaoDaReprogramacao['sustacao'] = null;
	if (sustaveis.length > 0) {
		const diasRestantes = sustaveis.reduce((n, f) => n + diasAGozar(f), 0);
		const atual = sustaveis.map(diasAGozar);
		const igual = (d: readonly number[]) => d.join('+') === atual.join('+');
		// A divisão atual sempre cabe (mesmo quando não é uma das cinco formas —
		// o que resta depois de uma suspensão pode somar 22, por exemplo); as
		// outras são as formas do decreto que somam o mesmo.
		const divisoes = [atual, ...divisoesPossiveis(diasRestantes).filter((d) => !igual(d))];
		const lista = sustaveis.map((f) => `${f.ordem}ª (${formatarData(f.data_inicio)})`).join(', ');
		const vendidos = sustaveis.reduce((n, f) => n + (f.diasAbonados ?? 0), 0);
		const notaVenda = vendidos > 0 ? ` Os ${vendidos} dias vendidos (abono) ficam vendidos.` : '';
		sustacao = {
			fracoes: sustaveis,
			diasRestantes,
			divisoes,
			motivo:
				sustaveis.length === 1
					? `A ${lista} fração ainda não começou: é SUSTAÇÃO. Não precisa de motivo, e os ${diasRestantes} dias podem voltar divididos de outro jeito.${notaVenda}`
					: `As frações ${lista} ainda não começaram: é SUSTAÇÃO, das ${sustaveis.length} juntas — as férias são um período só. Não precisa de motivo, e os ${diasRestantes} dias podem voltar divididos de outro jeito.${notaVenda}`
		};
	}

	const suspensao: SituacaoDaReprogramacao['suspensao'] = emGozo
		? {
				fracao: emGozo,
				motivo: `A ${emGozo.ordem}ª fração começou em ${formatarData(emGozo.data_inicio)} e está em gozo: só cabe SUSPENSÃO, por imperiosa necessidade do serviço. As frações seguintes não mudam.`
			}
		: null;

	return { sustacao, suspensao };
}

/**
 * O que a COGEP confere numa SUSPENSÃO (art. 6º III, red. Dec. 34.495/2021):
 * ao menos 7 dias gozados até a data da suspensão, e reprogramação em até 10
 * dias. `dataSuspensao` é o dia em que o servidor volta ao serviço.
 */
export function criteriosDaSuspensao(
	fracao: Pick<Fracao, 'data_inicio'>,
	dataSuspensaoISO: string,
	novoInicioISO: string
): Checagem[] {
	const gozados = diffDiasInclusivo(fracao.data_inicio, adicionarDias(dataSuspensaoISO, -1));
	const prazo = diffDiasInclusivo(dataSuspensaoISO, novoInicioISO) - 1;
	return [
		{
			ok: gozados >= 7,
			nivel: 'erro',
			texto:
				gozados >= 7
					? `${gozados} dias gozados antes da suspensão (mínimo 7).`
					: `Só ${gozados} dia(s) gozado(s) antes da suspensão — o decreto exige ao menos 7 (art. 6º III).`
		},
		{
			ok: prazo <= 10,
			nivel: 'aviso',
			texto:
				prazo <= 10
					? `Reprogramação ${prazo} dia(s) após a suspensão (prazo de 10).`
					: `Reprogramação ${prazo} dias após a suspensão — o decreto pede até 10 (art. 6º III).`
		}
	];
}

/** Teto de servidores em férias no mês (art. 6º I). Só avisa, e só no 1º período. */
export const TETO_PERCENTUAL_EM_FERIAS = 15;

export function percentualEmFerias(emFerias: number, efetivo: number): number {
	return efetivo > 0 ? Math.round((emFerias / efetivo) * 1000) / 10 : 0;
}

/**
 * O teto de 15 % da unidade no mês do 1º período (art. 6º I) — AVISO, nunca
 * recusa: o decreto tem exceções e a decisão é do gestor. Só se aplica ao
 * PRIMEIRO período, porque é assim que a COGEP confere (segundo o
 * responsável). `null` quando não há o que dizer.
 */
export function avisoDoTeto(entrada: {
	ordem: number;
	/** Quantos da unidade já estarão em férias no mês, contando este. */
	emFeriasNoMes: number;
	efetivoDaUnidade: number;
}): Checagem | null {
	if (entrada.ordem !== 1 || entrada.efetivoDaUnidade <= 0) return null;
	const pct = percentualEmFerias(entrada.emFeriasNoMes, entrada.efetivoDaUnidade);
	return {
		ok: pct <= TETO_PERCENTUAL_EM_FERIAS,
		nivel: 'aviso',
		texto:
			pct <= TETO_PERCENTUAL_EM_FERIAS
				? `${pct} % da unidade em férias no mês (teto ${TETO_PERCENTUAL_EM_FERIAS} %).`
				: `${pct} % da unidade em férias no mês — acima do teto de ${TETO_PERCENTUAL_EM_FERIAS} % (art. 6º I). A COGEP confere isto no 1º período.`
	};
}

/** Há erro que impede? (Avisos deixam passar.) */
export function temErro(checagens: readonly Checagem[]): boolean {
	return checagens.some((c) => !c.ok && c.nivel === 'erro');
}

/* ── O texto do NUP ──────────────────────────────────────────────────────── */

export interface DadosDoOficio {
	servidor: { nome: string; matricula: string; cargo: string; lotacao: string };
	tipo: TipoReprogramacao;
	/** As frações alcançadas: todas as sustadas, ou só a suspensa. */
	fracoesOriginais: readonly Fracao[];
	novosPeriodos: readonly PeriodoMontado[];
	/** Obrigatória na suspensão: a imperiosa necessidade do serviço. */
	justificativa?: string;
	dataSuspensao?: string;
}

/**
 * O ofício pronto para o NUP — o que o chefe imediato hoje escreve à mão, e
 * onde o instituto sai trocado. Sai com o nome certo, o fundamento e as datas.
 */
export function textoDoOficio(d: DadosDoOficio): string {
	const s = d.servidor;
	const tipo = ROTULO_TIPO_REPROGRAMACAO[d.tipo].toUpperCase();
	const periodo = (inicio: string, fim: string, dias: number) =>
		`de ${formatarData(inicio)} a ${formatarData(fim)} (${dias} dias)`;
	const plural = (n: number) => (n === 1 ? '' : 's');
	const linhas = [
		`Assunto: ${tipo} de férias — ${s.nome}`,
		'',
		`Servidor(a): ${s.nome}, ${s.cargo}, matrícula ${s.matricula}, lotado(a) na ${s.lotacao}.`,
		'',
		`Período${plural(d.fracoesOriginais.length)} programado${plural(d.fracoesOriginais.length)}:`,
		...d.fracoesOriginais.map(
			(f) => `  - ${f.ordem}ª fração, ${periodo(f.data_inicio, f.data_fim, diasDaFracao(f))}`
		),
		`Período${plural(d.novosPeriodos.length)} de reprogramação:`,
		...d.novosPeriodos.map((p, k) => `  - ${k + 1}º período, ${periodo(p.inicio, p.fim, p.dias)}`),
		''
	];
	if (d.tipo === 'sustacao') {
		linhas.push(
			`Trata-se de SUSTAÇÃO: o período programado ainda não teve início.`,
			...(d.justificativa?.trim() ? [`Observação: ${d.justificativa.trim()}`] : [])
		);
	} else {
		const f = d.fracoesOriginais[0];
		const gozados =
			d.dataSuspensao && f ? diasRestantesNaSuspensao(f, d.dataSuspensao).gozados : null;
		linhas.push(
			`Trata-se de SUSPENSÃO de férias já iniciadas${d.dataSuspensao ? `, com retorno ao serviço em ${formatarData(d.dataSuspensao)}` : ''}${gozados != null ? ` (${gozados} dias gozados)` : ''}, por imperiosa necessidade do serviço.`,
			`Justificativa: ${d.justificativa?.trim() || '(informar a necessidade do serviço)'}`
		);
	}
	linhas.push('', `Fundamento: ${BASE_LEGAL[d.tipo]}.`);
	return linhas.join('\n');
}

/* ── Abono pecuniário ────────────────────────────────────────────────────── */

/** Dias convertíveis: 1/3 de 30 (Lei 19.472/2025; Dec. 37.363/2026, art. 1º). */
const DIAS_DO_ABONO = 10;

export type PosicaoDoAbono = 'iniciais' | 'finais';

/**
 * Subtipos de afastamento que impedem o abono (Dec. 37.363/2026, art. 13), e
 * como cada um se apura no histórico. O inciso III (sanção disciplinar grave)
 * não está no sistema e fica declarado como não verificável.
 */
const IMPEDE_SE_VIGENTE: readonly SubtipoAfastamento[] = [
	'lip', // II — interesse particular / acompanhar cônjuge
	'afastamento_preventivo', // IV
	'prisao_denuncia', // V
	'condenacao', // VI
	'dispensa_ponto' // VII (aguardando aposentadoria/exoneração cai em `outros` com descrição)
];

/** Inciso I: LTS ou acompanhamento de familiar somando mais de 60 dias nos últimos 12 meses. */
const IMPEDE_SE_SOMAR_60_DIAS: readonly SubtipoAfastamento[] = [
	'lts',
	'licenca_medica',
	'acompanhamento_familiar'
];

export interface AfastamentoParaAbono {
	subtipo: SubtipoAfastamento | string;
	data_inicio: string;
	data_fim: string | null;
}

/**
 * Os impedimentos do art. 13 que o histórico revela na data do requerimento.
 * Devolve a lista de textos; vazia = nenhum impedimento apurável.
 */
export function impedimentosDoAbono(
	historico: readonly AfastamentoParaAbono[],
	dataRequerimentoISO: string
): string[] {
	const impedimentos: string[] = [];
	const umAnoAntes = adicionarDias(dataRequerimentoISO, -365);

	let diasDeSaude = 0;
	for (const a of historico) {
		const fim = a.data_fim || dataRequerimentoISO;
		if (fim < umAnoAntes || a.data_inicio > dataRequerimentoISO) continue;
		if (IMPEDE_SE_SOMAR_60_DIAS.includes(a.subtipo as SubtipoAfastamento)) {
			const ini = a.data_inicio < umAnoAntes ? umAnoAntes : a.data_inicio;
			const fimJanela = fim > dataRequerimentoISO ? dataRequerimentoISO : fim;
			diasDeSaude += diffDiasInclusivo(ini, fimJanela);
		}
	}
	if (diasDeSaude > 60) {
		impedimentos.push(
			`${diasDeSaude} dias de licença para tratamento de saúde ou acompanhamento de familiar nos últimos 12 meses (limite 60 — art. 13, I; salvo lesão em missão policial).`
		);
	}

	for (const a of historico) {
		const vigente =
			a.data_inicio <= dataRequerimentoISO && (!a.data_fim || a.data_fim >= dataRequerimentoISO);
		if (vigente && IMPEDE_SE_VIGENTE.includes(a.subtipo as SubtipoAfastamento)) {
			impedimentos.push(`Afastamento vigente que impede o abono: ${a.subtipo} (art. 13).`);
		}
	}
	return impedimentos;
}

/**
 * Confere o registro de um abono contra o Dec. 37.363/2026: posição dos 10
 * dias numa fração maior (art. 4º), uma vez por ano (art. 11) e os
 * impedimentos do art. 13, apurados em `hojeISO` (a data do registro). A
 * janela de 60–90 dias do requerimento (art. 3º) NÃO é conferida: o DPI SUL
 * recebe só a decisão, sem a data do pedido — quem apreciou a janela foi a
 * COGEP (decisão dele, 17/09).
 */
export function conferirAbono(entrada: {
	fracao: Fracao;
	hojeISO: string;
	posicao: PosicaoDoAbono | null;
	abonosJaDeferidosNoAno: number;
	historico: readonly AfastamentoParaAbono[];
}): Checagem[] {
	const { fracao, posicao } = entrada;
	const checagens: Checagem[] = [];

	const dias = diasDaFracao(fracao);
	if (dias > DIAS_DO_ABONO) {
		checagens.push({
			ok: posicao !== null,
			nivel: 'erro',
			texto:
				posicao !== null
					? `Convertidos os ${DIAS_DO_ABONO} dias ${posicao} da fração de ${dias}.`
					: `Fração de ${dias} dias: indique se converte os ${DIAS_DO_ABONO} iniciais ou os ${DIAS_DO_ABONO} finais (art. 4º).`
		});
	} else {
		checagens.push({
			ok: dias === DIAS_DO_ABONO,
			nivel: 'erro',
			texto:
				dias === DIAS_DO_ABONO
					? `A fração inteira (${dias} dias) é convertida.`
					: `Fração de ${dias} dias não comporta ${DIAS_DO_ABONO} dias de abono.`
		});
	}

	checagens.push({
		ok: entrada.abonosJaDeferidosNoAno === 0,
		nivel: 'erro',
		texto:
			entrada.abonosJaDeferidosNoAno === 0
				? 'Primeiro abono do ano.'
				: 'Já há abono deferido neste ano — o decreto limita a uma vez por ano (art. 11).'
	});

	for (const imp of impedimentosDoAbono(entrada.historico, entrada.hojeISO)) {
		checagens.push({ ok: false, nivel: 'erro', texto: imp });
	}

	return checagens;
}

/**
 * Os dias da fração que o servidor de fato GOZA depois do abono: os 10
 * convertidos ele trabalha. É o que faz a unidade ver "em abono" e o efetivo
 * contá-lo como ativo nesses dias.
 */
export function periodoGozadoComAbono(
	fracao: Pick<Fracao, 'data_inicio' | 'data_fim'>,
	posicao: PosicaoDoAbono
): { gozo: { inicio: string; fim: string } | null; abono: { inicio: string; fim: string } } {
	const dias = diasDaFracao(fracao);
	if (dias <= DIAS_DO_ABONO) {
		return { gozo: null, abono: { inicio: fracao.data_inicio, fim: fracao.data_fim } };
	}
	if (posicao === 'iniciais') {
		const fimAbono = adicionarDias(fracao.data_inicio, DIAS_DO_ABONO - 1);
		return {
			abono: { inicio: fracao.data_inicio, fim: fimAbono },
			gozo: { inicio: adicionarDias(fimAbono, 1), fim: fracao.data_fim }
		};
	}
	const inicioAbono = adicionarDias(fracao.data_fim, -(DIAS_DO_ABONO - 1));
	return {
		abono: { inicio: inicioAbono, fim: fracao.data_fim },
		gozo: { inicio: fracao.data_inicio, fim: adicionarDias(inicioAbono, -1) }
	};
}
