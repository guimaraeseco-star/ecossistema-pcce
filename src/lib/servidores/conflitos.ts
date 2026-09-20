/**
 * Conflito entre AFASTAMENTO e FÉRIAS no mesmo servidor (decisão do
 * responsável, 20/09/2026): um afastamento não pode abranger férias
 * programadas, e um período de férias — lançado ou reprogramado — não pode
 * cair dentro de um afastamento já registrado. Nos dois sentidos IMPEDE,
 * não só avisa.
 *
 * A fonte dos dois lados é a linha do tempo (`policial_historico`): as
 * férias são os eventos de subtipo `ferias` (já reduzidos ao gozo pelo
 * abono), e os afastamentos são os demais. Um afastamento sem data final é
 * aberto: ocupa do início em diante.
 *
 * Os dias VENDIDOS (abono deferido) entram como `abono`: não impedem — o
 * servidor trabalha neles —, mas um afastamento ali AVISA, porque o Dec.
 * 37.363/2026, art. 16, manda restituir o valor dos dias recebidos e não
 * trabalhados quando o afastamento não é de efetivo exercício.
 *
 * Mora em `lib/` porque o modal de afastamento, o cartão de férias e as
 * actions leem a mesma regra.
 */
import { formatarData } from '$lib/utils/datas';
import { rotuloAfastamento } from './afastamentos';
import type { Checagem } from './ferias';

/** Um período ocupado: início e fim ISO; fim `null` = em aberto. */
export interface PeriodoOcupado {
	inicio: string;
	fim: string | null;
	/** O que ocupa: subtipo do afastamento, `ferias`, ou `abono` (dias vendidos). */
	subtipo: string;
}

/** Os dias vendidos das frações com abono deferido, como períodos `abono`. */
export function ocupadosDoAbono(
	fracoes: readonly { abono: { status: string; abono_inicio: string; abono_fim: string } | null }[]
): PeriodoOcupado[] {
	return fracoes
		.filter((f) => f.abono?.status === 'deferido')
		.map((f) => ({ inicio: f.abono!.abono_inicio, fim: f.abono!.abono_fim, subtipo: 'abono' }));
}

/** Dois períodos inclusivos se tocam? `null` no fim é "em aberto". */
export function periodosSobrepoem(
	a: { inicio: string; fim: string | null },
	b: { inicio: string; fim: string | null }
): boolean {
	const fimA = a.fim ?? '9999-12-31';
	const fimB = b.fim ?? '9999-12-31';
	return a.inicio <= fimB && b.inicio <= fimA;
}

/** Os eventos da linha do tempo na forma que a regra lê. */
export function ocupadosDoHistorico(
	historico: readonly {
		tipo: string;
		subtipo?: string | null;
		data_inicio?: string | null;
		data_fim?: string | null;
	}[]
): PeriodoOcupado[] {
	return historico
		.filter((h) => h.tipo === 'afastamento' && !!h.data_inicio)
		.map((h) => ({
			inicio: h.data_inicio as string,
			fim: h.data_fim || null,
			subtipo: h.subtipo ?? 'outros'
		}));
}

const rotulo = (p: PeriodoOcupado) =>
	`${p.subtipo === 'ferias' ? 'férias' : p.subtipo === 'abono' ? 'dias vendidos (abono)' : rotuloAfastamento(p.subtipo)} de ${formatarData(p.inicio)}${p.fim ? ` a ${formatarData(p.fim)}` : ' (em aberto)'}`;

/**
 * Um AFASTAMENTO novo contra a linha do tempo: ERRO para cada fração de
 * férias que ele abrange; AVISO para os dias vendidos (art. 16).
 */
export function conflitosDoAfastamento(
	novo: { inicio: string; fim: string | null },
	ocupados: readonly PeriodoOcupado[]
): Checagem[] {
	return ocupados
		.filter((o) => (o.subtipo === 'ferias' || o.subtipo === 'abono') && periodosSobrepoem(novo, o))
		.map((o) =>
			o.subtipo === 'abono'
				? {
						ok: false,
						nivel: 'aviso' as const,
						texto: `O afastamento alcança ${rotulo(o)}: pelo Dec. 37.363/2026, art. 16, afastamento não considerado de efetivo exercício nesses dias implica a restituição do valor recebido e não trabalhado.`
					}
				: {
						ok: false,
						nivel: 'erro' as const,
						texto: `O afastamento abrange ${rotulo(o)}: reprograme as férias antes, ou ajuste o período.`
					}
		);
}

/**
 * Períodos de FÉRIAS novos (lançados ou reprogramados) contra os
 * afastamentos já na linha do tempo: erro para cada coincidência. As férias
 * já registradas não contam — as frações que o pedido substitui estariam
 * sempre "em conflito" consigo mesmas.
 */
export function conflitosDasFerias(
	periodos: readonly { inicio: string; fim: string }[],
	ocupados: readonly PeriodoOcupado[]
): Checagem[] {
	const erros: Checagem[] = [];
	periodos.forEach((p, k) => {
		for (const o of ocupados) {
			if (o.subtipo === 'ferias' || o.subtipo === 'abono' || !periodosSobrepoem(p, o)) continue;
			erros.push({
				ok: false,
				nivel: 'erro',
				texto: `${k + 1}ª fração (${formatarData(p.inicio)} a ${formatarData(p.fim)}) coincide com ${rotulo(o)}.`
			});
		}
	});
	return erros;
}
