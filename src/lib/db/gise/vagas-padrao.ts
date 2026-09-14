/**
 * Vagas padrão das equipes GISE (quantos DPC e OIP cada equipe nova recebe).
 *
 * Guardadas como JSON numa única chave de `configuracoes` em vez de colunas
 * próprias: são um preset de UI, editado por operação em
 * `/operacoes/gise/operacoes/[id]/config`, e não entram em
 * consulta nenhuma. Toda leitura passa pelo parser tolerante abaixo, porque o
 * valor pode ter sido gravado por uma versão anterior ou editado à mão.
 */
import { eq } from 'drizzle-orm';
import { buscarConfiguracao, salvarConfiguracao } from '../configuracoes';
import { operacoes } from '../../server/schema';
import type { Database } from '../core';

/** Uma chave em `configuracoes` com JSON: `{"op":{"dpc":1,"oip":3},"seint":{"dpc":0,"oip":2}}` */
const GISE_EQUIPES_VAGAS_JSON_KEY = 'gise_equipes_vagas';

/** Configuração histórica da corporação, usada quando não há nada salvo. */
const VAGAS_EQUIPES_FALLBACK = {
	operacional: { dpc: 1, oip: 3 },
	seint: { dpc: 0, oip: 2 }
} as const;

/** Inteiro de 0 a 999, aceitando número ou string; qualquer outra coisa cai no padrão. */
function n(v: unknown, fallback: number): number {
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 999) return Math.floor(v);
	if (typeof v === 'string' && /^\d{1,3}$/.test(v)) {
		const k = parseInt(v, 10);
		if (k >= 0 && k <= 999) return k;
	}
	return fallback;
}

/**
 * JSON → objeto de vagas, nunca lançando: chave ausente, JSON quebrado ou campo
 * fora de faixa recaem no fallback. As cópias com spread evitam devolver a
 * constante compartilhada, que o chamador poderia mutar.
 */
function parseVagasEquipesGiseJson(raw: string | null): {
	operacional: { dpc: number; oip: number };
	seint: { dpc: number; oip: number };
} {
	if (!raw?.trim())
		return {
			...VAGAS_EQUIPES_FALLBACK,
			operacional: { ...VAGAS_EQUIPES_FALLBACK.operacional },
			seint: { ...VAGAS_EQUIPES_FALLBACK.seint }
		};
	try {
		const j = JSON.parse(raw) as {
			op?: { dpc?: unknown; oip?: unknown };
			seint?: { dpc?: unknown; oip?: unknown };
		};
		return {
			operacional: {
				dpc: n(j?.op?.dpc, VAGAS_EQUIPES_FALLBACK.operacional.dpc),
				oip: n(j?.op?.oip, VAGAS_EQUIPES_FALLBACK.operacional.oip)
			},
			seint: {
				dpc: n(j?.seint?.dpc, VAGAS_EQUIPES_FALLBACK.seint.dpc),
				oip: n(j?.seint?.oip, VAGAS_EQUIPES_FALLBACK.seint.oip)
			}
		};
	} catch {
		return {
			...VAGAS_EQUIPES_FALLBACK,
			operacional: { ...VAGAS_EQUIPES_FALLBACK.operacional },
			seint: { ...VAGAS_EQUIPES_FALLBACK.seint }
		};
	}
}

/**
 * Vagas padrão a aplicar numa equipe nova — as da OPERAÇÃO quando ela definiu,
 * senão as globais, senão o fallback histórico. Nunca lança, nunca devolve nulo.
 *
 * Cada um dos quatro campos cai por conta própria: uma operação pode fixar só as
 * vagas de OIP da equipe operacional e herdar o resto. `null` na coluna é o que
 * significa "herda"; `0` é uma escolha legítima (equipe sem DPC) e por isso não
 * pode ser tratado como ausência.
 *
 * `operacaoId` é obrigatório, `null` inclusive — mesma razão do resolvedor do
 * breve relatório: um default silencioso montaria a equipe com o tamanho de
 * outra operação, e o erro só apareceria como vaga sobrando na escala.
 */
export async function buscarVagasPadraoEquipesGise(db: Database, operacaoId: number | null) {
	const [raw, op] = await Promise.all([
		buscarConfiguracao(db, GISE_EQUIPES_VAGAS_JSON_KEY),
		operacaoId != null
			? db
					.select({
						opDpc: operacoes.vagas_operacional_dpc,
						opOip: operacoes.vagas_operacional_oip,
						seDpc: operacoes.vagas_seint_dpc,
						seOip: operacoes.vagas_seint_oip
					})
					.from(operacoes)
					.where(eq(operacoes.id, operacaoId))
					.get()
			: Promise.resolve(undefined)
	]);

	const global = parseVagasEquipesGiseJson(raw);
	return {
		operacional: {
			dpc: op?.opDpc ?? global.operacional.dpc,
			oip: op?.opOip ?? global.operacional.oip
		},
		seint: {
			dpc: op?.seDpc ?? global.seint.dpc,
			oip: op?.seOip ?? global.seint.oip
		}
	};
}

/**
 * Grava as vagas padrão, saneando cada campo (0–999) antes de serializar — o
 * valor vem de `<input>` da tela de configuração.
 *
 * Só afeta equipes CRIADAS DEPOIS: as existentes guardam suas próprias
 * `slots_dpc`/`slots_oip`. Mudar aqui não redimensiona a GISE em andamento.
 */
export async function salvarVagasPadraoEquipesGise(
	db: Database,
	v: { operacional: { dpc: number; oip: number }; seint: { dpc: number; oip: number } }
): Promise<void> {
	const body = {
		op: { dpc: n(v.operacional.dpc, 1), oip: n(v.operacional.oip, 3) },
		seint: { dpc: n(v.seint.dpc, 0), oip: n(v.seint.oip, 2) }
	};
	await salvarConfiguracao(db, GISE_EQUIPES_VAGAS_JSON_KEY, JSON.stringify(body));
}
