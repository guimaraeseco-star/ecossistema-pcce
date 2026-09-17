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
 * O decreto ainda admite suspender a 2ª fração antes de ela começar, quando a
 * 1ª já foi gozada (art. 3º § 13, Dec. 33.739/2020) — o classificador aponta
 * isso como alternativa, sem trocar a resposta padrão.
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
}

/**
 * As cinco formas de fracionar 30 dias (Dec. 32.907, art. 3º § 1º). Lista
 * FECHADA; a ordem importa (10+20 e 20+10 são opções distintas).
 */
export const FRACIONAMENTOS_VALIDOS: readonly (readonly number[])[] = [
	[30],
	[10, 20],
	[20, 10],
	[15, 15],
	[10, 10, 10]
];

/** Nenhuma fração pode ter menos que isto (Dec. 33.216/2019, art. 11, p. único). */
export const MINIMO_DIAS_POR_FRACAO = 10;

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

export interface Classificacao {
	tipo: TipoReprogramacao;
	/** Por que é este e não o outro — a frase que o usuário precisa ler. */
	motivo: string;
	/** Fundamento legal, para o texto do NUP. */
	base: string;
	/**
	 * A 2ª fração antes de começar, com a 1ª já gozada, admite SUSPENSÃO
	 * também (art. 3º § 13). Não troca a resposta: informa a alternativa.
	 */
	admiteSuspensaoPeloParagrafo13: boolean;
}

/**
 * Sustação ou suspensão? Decide pelos FATOS — a data de início da fração e a
 * data de hoje —, não por escolha do usuário. É o que impede o pedido errado.
 *
 * Lança para fração já gozada, sustada ou suspensa: não há o que reprogramar.
 */
export function classificarReprogramacao(
	fracao: Fracao,
	hojeISO: string,
	fracoesDoExercicio: readonly Fracao[] = []
): Classificacao {
	const status = statusPelaData(fracao, hojeISO);
	if (status === 'gozada') throw new Error('Fração já gozada: não há o que reprogramar.');
	if (status === 'sustada' || status === 'suspensa') {
		throw new Error(`Fração já ${status}: reprograme a fração que a substituiu.`);
	}

	if (status === 'em_gozo') {
		return {
			tipo: 'suspensao',
			motivo: `A fração começou em ${formatarData(fracao.data_inicio)} e está em gozo: só cabe SUSPENSÃO, por imperiosa necessidade do serviço.`,
			base: 'Dec. 32.907/2018, art. 3º § 12 (red. Dec. 33.739/2020) e art. 6º III (red. Dec. 34.495/2021)',
			admiteSuspensaoPeloParagrafo13: false
		};
	}

	const anteriorGozada = fracoesDoExercicio.some(
		(f) => f.ordem < fracao.ordem && statusPelaData(f, hojeISO) === 'gozada'
	);
	return {
		tipo: 'sustacao',
		motivo: `A fração só começa em ${formatarData(fracao.data_inicio)} e ainda não iniciou: é SUSTAÇÃO. Não precisa de motivo.`,
		base: 'Dec. 32.907/2018, art. 3º §§ 10 e 14 (red. Dec. 34.495/2021)',
		admiteSuspensaoPeloParagrafo13: anteriorGozada
	};
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
 * Confere as NOVAS datas de uma reprogramação — o que a COGEP olharia e o
 * que o Guardião exigiria:
 *
 * - a mesma quantidade de dias da fração original (não se ganha nem se perde
 *   dia ao reprogramar);
 * - primeiro dia útil: não cai em fim de semana nem em feriado (regra do
 *   Guardião, informada pelo responsável); `feriados` é a lista de datas ISO
 *   que o chamador tem — hoje, o calendário nacional;
 * - fração de ao menos 10 dias;
 * - o teto de 15 % da unidade no mês — AVISO, e só quando é o 1º período
 *   (é assim que a COGEP aplica, segundo o responsável).
 */
export function conferirNovoPeriodo(entrada: {
	fracaoOriginal: Fracao;
	novoInicio: string;
	novoFim: string;
	feriados: readonly string[];
	/** Quantos da unidade já estarão em férias no mês do novo início, contando este. */
	emFeriasNoMes?: number;
	efetivoDaUnidade?: number;
}): Checagem[] {
	const { fracaoOriginal, novoInicio, novoFim, feriados } = entrada;
	const diasOriginais = diasDaFracao(fracaoOriginal);
	const diasNovos = diffDiasInclusivo(novoInicio, novoFim);
	const checagens: Checagem[] = [];

	checagens.push({
		ok: diasNovos === diasOriginais,
		nivel: 'erro',
		texto:
			diasNovos === diasOriginais
				? `${diasNovos} dias, como a fração original.`
				: `${diasNovos} dia(s) no novo período, mas a fração original tem ${diasOriginais}: reprogramar não muda a quantidade.`
	});

	const diaSemana = new Date(novoInicio + 'T00:00:00Z').getUTCDay();
	const fimDeSemana = diaSemana === 0 || diaSemana === 6;
	const feriado = feriados.includes(novoInicio);
	checagens.push({
		ok: !fimDeSemana && !feriado,
		nivel: 'erro',
		texto: fimDeSemana
			? `${formatarData(novoInicio)} cai em fim de semana: o primeiro dia precisa ser dia útil.`
			: feriado
				? `${formatarData(novoInicio)} é feriado: o primeiro dia precisa ser dia útil.`
				: `${formatarData(novoInicio)} é dia útil.`
	});

	checagens.push({
		ok: diasNovos >= MINIMO_DIAS_POR_FRACAO,
		nivel: 'erro',
		texto:
			diasNovos >= MINIMO_DIAS_POR_FRACAO
				? `Fração de ${diasNovos} dias (mínimo ${MINIMO_DIAS_POR_FRACAO}).`
				: `Fração de ${diasNovos} dia(s) — o mínimo é ${MINIMO_DIAS_POR_FRACAO} (Dec. 33.216/2019, art. 11).`
	});

	if (
		fracaoOriginal.ordem === 1 &&
		entrada.emFeriasNoMes != null &&
		entrada.efetivoDaUnidade != null &&
		entrada.efetivoDaUnidade > 0
	) {
		const pct = percentualEmFerias(entrada.emFeriasNoMes, entrada.efetivoDaUnidade);
		checagens.push({
			ok: pct <= TETO_PERCENTUAL_EM_FERIAS,
			nivel: 'aviso',
			texto:
				pct <= TETO_PERCENTUAL_EM_FERIAS
					? `${pct} % da unidade em férias no mês (teto ${TETO_PERCENTUAL_EM_FERIAS} %).`
					: `${pct} % da unidade em férias no mês — acima do teto de ${TETO_PERCENTUAL_EM_FERIAS} % (art. 6º I). A COGEP confere isto no 1º período.`
		});
	}

	return checagens;
}

/** Há erro que impede? (Avisos deixam passar.) */
export function temErro(checagens: readonly Checagem[]): boolean {
	return checagens.some((c) => !c.ok && c.nivel === 'erro');
}

/* ── O texto do NUP ──────────────────────────────────────────────────────── */

export interface DadosDoOficio {
	servidor: { nome: string; matricula: string; cargo: string; lotacao: string };
	classificacao: Classificacao;
	fracaoOriginal: Fracao;
	novoInicio: string;
	novoFim: string;
	/** Obrigatória na suspensão: a imperiosa necessidade do serviço. */
	justificativa?: string;
	/** Na sustação por licença, o afastamento que coincide (opcional). */
	afastamentoQueCoincide?: { rotulo: string; inicio: string; fim: string | null };
	dataSuspensao?: string;
}

/**
 * O ofício pronto para o NUP — o que o chefe imediato hoje escreve à mão, e
 * onde o instituto sai trocado. Sai com o nome certo, o fundamento e as datas.
 */
export function textoDoOficio(d: DadosDoOficio): string {
	const s = d.servidor;
	const tipo = ROTULO_TIPO_REPROGRAMACAO[d.classificacao.tipo].toUpperCase();
	const dias = diasDaFracao(d.fracaoOriginal);
	const linhas = [
		`Assunto: ${tipo} de férias — ${s.nome}`,
		'',
		`Servidor(a): ${s.nome}, ${s.cargo}, matrícula ${s.matricula}, lotado(a) na ${s.lotacao}.`,
		'',
		`Período programado: ${d.fracaoOriginal.ordem}ª fração, de ${formatarData(d.fracaoOriginal.data_inicio)} a ${formatarData(d.fracaoOriginal.data_fim)} (${dias} dias).`,
		`Período de reprogramação: de ${formatarData(d.novoInicio)} a ${formatarData(d.novoFim)} (${diffDiasInclusivo(d.novoInicio, d.novoFim)} dias).`,
		''
	];
	if (d.classificacao.tipo === 'sustacao') {
		linhas.push(
			`Trata-se de SUSTAÇÃO: o período programado ainda não teve início.`,
			...(d.afastamentoQueCoincide
				? [
						`Motivo: ${d.afastamentoQueCoincide.rotulo} de ${formatarData(d.afastamentoQueCoincide.inicio)}${d.afastamentoQueCoincide.fim ? ` a ${formatarData(d.afastamentoQueCoincide.fim)}` : ' (em curso)'}, coincidente com o período programado.`
					]
				: []),
			...(d.justificativa?.trim() ? [`Observação: ${d.justificativa.trim()}`] : [])
		);
	} else {
		const gozados = d.dataSuspensao
			? diffDiasInclusivo(d.fracaoOriginal.data_inicio, adicionarDias(d.dataSuspensao, -1))
			: null;
		linhas.push(
			`Trata-se de SUSPENSÃO de férias já iniciadas${d.dataSuspensao ? `, com retorno ao serviço em ${formatarData(d.dataSuspensao)}` : ''}${gozados != null ? ` (${gozados} dias gozados)` : ''}, por imperiosa necessidade do serviço.`,
			`Justificativa: ${d.justificativa?.trim() || '(informar a necessidade do serviço)'}`
		);
	}
	linhas.push('', `Fundamento: ${d.classificacao.base}.`);
	return linhas.join('\n');
}

/* ── Abono pecuniário ────────────────────────────────────────────────────── */

/** Dias convertíveis: 1/3 de 30 (Lei 19.472/2025; Dec. 37.363/2026, art. 1º). */
export const DIAS_DO_ABONO = 10;

/** Janela do requerimento: entre 60 e 90 dias antes do início (art. 3º). */
export const JANELA_ABONO_DIAS = { minimo: 60, maximo: 90 } as const;

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
 * Confere um pedido de abono contra o Dec. 37.363/2026: janela de 60–90 dias
 * antes do início (art. 3º), posição dos 10 dias numa fração maior (art. 4º),
 * uma vez por ano (art. 11) e os impedimentos do art. 13.
 */
export function conferirAbono(entrada: {
	fracao: Fracao;
	dataRequerimentoISO: string;
	posicao: PosicaoDoAbono | null;
	abonosJaDeferidosNoAno: number;
	historico: readonly AfastamentoParaAbono[];
}): Checagem[] {
	const { fracao, dataRequerimentoISO, posicao } = entrada;
	const checagens: Checagem[] = [];
	const antecedencia = diffDiasInclusivo(dataRequerimentoISO, fracao.data_inicio) - 1;

	const naJanela =
		antecedencia >= JANELA_ABONO_DIAS.minimo && antecedencia <= JANELA_ABONO_DIAS.maximo;
	checagens.push({
		ok: naJanela,
		nivel: 'aviso',
		texto: naJanela
			? `Requerido ${antecedencia} dias antes do início (janela de ${JANELA_ABONO_DIAS.minimo} a ${JANELA_ABONO_DIAS.maximo}).`
			: `Requerido ${antecedencia} dias antes do início — fora da janela de ${JANELA_ABONO_DIAS.minimo} a ${JANELA_ABONO_DIAS.maximo} dias (art. 3º); o pedido pode não ser apreciado (art. 5º).`
	});

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

	for (const imp of impedimentosDoAbono(entrada.historico, dataRequerimentoISO)) {
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
