/**
 * Helpers PUROS da tela `/operacoes/gise/[id]` — derivam da GISE já montada
 * (`GiseDetalhado`) as respostas que o markup precisa, sem tocar o banco.
 *
 * Existem fora dos componentes por dois motivos: são compartilhados por
 * `GiseSeccional` e `GiseSupervisao`, e são testáveis sem renderizar nada
 * (`page-helpers.test.ts`). Toda função aqui tolera árvore incompleta —
 * `undefined` em `unidades`/`equipes`/`membros` — porque o `load` degrada quando
 * a migração de slots ainda não rodou no ambiente.
 */
import type {
	GiseDetalhado,
	GiseEquipeComMembros,
	GiseMembro,
	GiseUnidadeSlot
} from '$lib/db/gise';
import type { Unidade } from '$lib/server/schema';

/** Seccional agregada na árvore GISE (equipes e membros). */
type GiseSecComMembros = {
	unidades?: GiseUnidadeSlot[];
};

/** Tipos de equipe com relatório de produtividade, na ordem exibida na UI. */
type GiseEquipeTipo = 'operacional' | 'seint';

const ORDEM_TIPOS: readonly GiseEquipeTipo[] = ['operacional', 'seint'];

/**
 * Coleta `operacional` / `seint` presentes nas equipes da seccional.
 * Lê `unidades[].equipes` (modelo atual) e `equipes` no topo (legado).
 * Se ainda não houver equipe, retorna `['operacional']` para exibir o botão desabilitado.
 */
export function tiposEquipeNaSeccional(sec: {
	unidades?: GiseUnidadeSlot[];
	equipes?: GiseEquipeComMembros[];
}): GiseEquipeTipo[] {
	const fromUnidades = (sec.unidades ?? []).flatMap((u) => u.equipes ?? []);
	const legacy = sec.equipes ?? [];
	const present = new Set<GiseEquipeTipo>();
	for (const eq of [...fromUnidades, ...legacy]) {
		if (eq.tipo === 'operacional' || eq.tipo === 'seint') present.add(eq.tipo);
	}
	if (present.size > 0) {
		return ORDEM_TIPOS.filter((t) => present.has(t));
	}
	return ['operacional'];
}

/**
 * Achata a seccional em uma lista plana de membros (slots → equipes → membros).
 * É a base de `checkAllSigned` e `getFaltandoPresenca`; a tela pergunta sobre "a
 * seccional", não sobre cada equipe.
 */
export function getMembrosFromSec(sec: GiseSecComMembros): GiseMembro[] {
	return (sec.unidades ?? []).flatMap((u: GiseUnidadeSlot) =>
		(u.equipes ?? []).flatMap((eq: GiseEquipeComMembros) => eq.membros ?? [])
	);
}

/**
 * Todos os membros da seccional já confirmaram ENTRADA **e** SAÍDA?
 *
 * Seccional sem membro devolve `false`, não `true`: "vazia" não é "concluída", e
 * o `every` de lista vazia diria o contrário — é exatamente o tipo de resposta
 * que liberaria o encerramento de uma seccional que ninguém preencheu.
 */
export function checkAllSigned(sec: GiseSecComMembros): boolean {
	const members = getMembrosFromSec(sec);
	if (members.length === 0) return false;
	return members.every((m) => m.presenca?.entrada_timestamp && m.presenca?.saida_timestamp);
}

/**
 * Mensagem pronta com quem ainda não confirmou, ou `''` quando não falta ninguém
 * (o chamador testa a string vazia para decidir se mostra o aviso).
 *
 * Só o PRIMEIRO nome de cada faltante: o texto vai num tooltip estreito, e a
 * lista completa de nomes de policiais numa tela compartilhada seria exposição
 * desnecessária.
 */
export function getFaltandoPresenca(sec: GiseSecComMembros): string {
	const members = getMembrosFromSec(sec);
	const faltantes = members.filter(
		(m) => !m.presenca?.entrada_timestamp || !m.presenca?.saida_timestamp
	);
	if (faltantes.length === 0) return '';
	return (
		'Faltando confirmação de: ' + faltantes.map((m) => m.policial_nome.split(' ')[0]).join(', ')
	);
}

const SECCIONAL_TARJA_FORTE: readonly string[] = [
	'border-l-blue-700',
	'border-l-emerald-700',
	'border-l-indigo-700',
	'border-l-violet-700',
	'border-l-amber-700',
	'border-l-rose-700',
	'border-l-cyan-700',
	'border-l-teal-700',
	'border-l-sky-700',
	'border-l-slate-700'
];

const SECCIONAL_TARJA_MEDIA: readonly string[] = [
	'border-l-blue-500',
	'border-l-emerald-500',
	'border-l-indigo-500',
	'border-l-violet-500',
	'border-l-amber-500',
	'border-l-rose-500',
	'border-l-cyan-500',
	'border-l-teal-500',
	'border-l-sky-500',
	'border-l-slate-500'
];

const SECCIONAL_TARJA_SUAVE: readonly string[] = [
	'border-l-blue-300',
	'border-l-emerald-300',
	'border-l-indigo-300',
	'border-l-violet-300',
	'border-l-amber-300',
	'border-l-rose-300',
	'border-l-cyan-300',
	'border-l-teal-300',
	'border-l-sky-300',
	'border-l-slate-300'
];

const SECCIONAL_TARJA_POR_INTENSIDADE = {
	forte: SECCIONAL_TARJA_FORTE,
	media: SECCIONAL_TARJA_MEDIA,
	suave: SECCIONAL_TARJA_SUAVE
} as const;

/** Intensidade da tarja lateral: seccional (forte) → slot DP (média) → equipe (suave). */
export type SeccionalTarjaIntensidade = keyof typeof SECCIONAL_TARJA_POR_INTENSIDADE;

/**
 * Cor de borda estável para a seccional — o mesmo id sempre recebe a mesma cor,
 * em qualquer GISE, o que ajuda a reconhecer a seccional de relance.
 *
 * `intensidade` diferencia o aninhamento visual (quadro externo mais saturado,
 * interiores mais leves) sem mudar o matiz por id.
 *
 * As classes são LITERAIS completas, não montadas por interpolação: o Tailwind
 * varre o código-fonte, e `border-l-${cor}-600` não geraria CSS nenhum.
 *
 * O fundo (`bg-white` / dark) fica no call site — a tarja só pinta a borda
 * esquerda, para não sobrescrever o fundo de slots/equipes.
 */
export function getSeccionalColorClass(
	seccionalId: number,
	intensidade: SeccionalTarjaIntensidade = 'forte'
): string {
	const cores = SECCIONAL_TARJA_POR_INTENSIDADE[intensidade];
	return cores[seccionalId % cores.length];
}

/**
 * Seccionais que ainda PODEM ser adicionadas: as do tipo `seccional` que já não
 * participam desta GISE. Alimenta o `<select>` de "adicionar seccional", e é o
 * que impede o admin de escolher uma duplicata.
 */
export function filtrarSeccionaisDisponiveis(
	gise: GiseDetalhado | null | undefined,
	todasUnidades: Unidade[]
): Unidade[] {
	if (!gise) return [];
	return todasUnidades.filter(
		(u) => u.tipo === 'seccional' && !gise.seccionais.some((s) => s.seccional_id === u.id)
	);
}

/**
 * Só as delegacias — opções de unidade para um slot. Diferente de
 * `filtrarSeccionaisDisponiveis`, NÃO exclui as já escolhidas: a mesma delegacia
 * pode ocupar slots de seccionais diferentes na mesma GISE.
 */
export function filtrarDelegacias(todasUnidades: Unidade[]): Unidade[] {
	return todasUnidades.filter((u) => u.tipo === 'delegacia');
}

/** O que a ABA de uma unidade mostra sem que ninguém precise abri-la. */
export interface ResumoSlot {
	/** Quantas equipes esta unidade tem no quadro. */
	equipes: number;
	/** Vagas (DPC + OIP) ainda sem policial, somadas as equipes da unidade. */
	vagasAbertas: number;
}

/**
 * O resumo que vai na aba da unidade — contador de equipes e vaga em aberto.
 *
 * Existe por causa da troca que as abas impõem: com uma unidade por vez na
 * tela, "onde ainda falta gente" deixaria de ser visível de relance. O resumo é
 * o que devolve essa leitura sem abrir aba por aba.
 *
 * A conta é por TOTAL de vagas, não por cargo: `gise_membros` não guarda cargo
 * (ele vem do policial), então DPC × OIP aqui seria uma segunda interpretação do
 * mesmo dado — e a aba só precisa responder "falta alguém?".
 */
export function resumoDoSlot(
	slot: Pick<GiseUnidadeSlot, 'equipes'> | null | undefined
): ResumoSlot {
	const equipes = slot?.equipes ?? [];
	const vagasAbertas = equipes.reduce((total, e) => {
		const vagas = (e.slots_dpc ?? 0) + (e.slots_oip ?? 0);
		return total + Math.max(0, vagas - (e.membros?.length ?? 0));
	}, 0);
	return { equipes: equipes.length, vagasAbertas };
}

/**
 * Rótulo curto da unidade para a aba — "Delegacia de Polícia Civil de Iguatu"
 * não cabe numa barra com seis delegacias.
 *
 * Corta o prefixo genérico e deixa o que distingue: o MUNICÍPIO. Nome que não
 * começa com o prefixo volta inteiro — encurtar no escuro é como se perde a
 * única parte que identifica a unidade. O nome completo continua no `title` da
 * aba e no topo do painel.
 */
export function rotuloCurtoUnidade(nome: string | null | undefined): string {
	if (!nome) return '';
	const semPrefixo = nome.replace(
		/^delegacia\s+(de\s+)?(pol[íi]cia\s+civil\s+)?(d[eoa]s?\s+)?/i,
		''
	);
	return semPrefixo.trim() || nome;
}
