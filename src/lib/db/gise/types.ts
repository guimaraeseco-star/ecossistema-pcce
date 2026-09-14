/**
 * Forma da GISE **montada** — o que `buscarGiseDetalhado` devolve e a página
 * `/operacoes/gise/[id]` consome.
 *
 * São tipos de VISTA, não de tabela: cada um estende a linha do schema com os
 * campos que só existem depois dos joins e da agregação em memória
 * (`policial_nome`, `presenca`, `temRespostas`, contadores). Manter isso à parte
 * do schema é o que impede que campo derivado seja confundido com coluna.
 *
 * A hierarquia espelha o banco — escala → seccionais → slots de unidade →
 * equipes → membros — com uma diferença: aqui os slots são a camada visível
 * (`GiseUnidadeSlot.equipes`), porque é assim que a tela agrupa. Equipe cujo
 * slot não existe mais não aparece em `unidades` (ver
 * `removerGiseSeccionalUnidade`).
 */
import type * as schema from '../../server/schema';

export type GiseMembro = schema.GiseMembro & {
	policial_nome: string;
	policial_cargo: string;
	policial_matricula: string;
	policial_telefone: string | null;
	policial_lotacao: string | null;
	policial_classe: string | null;
	presenca: schema.GisePresenca | null;
};

export type GiseEquipeComMembros = schema.GiseEquipe & { membros: GiseMembro[] };

export interface GiseUnidadeSlot {
	id: number;
	unidade_id: number | null;
	nome: string | null;
	equipes: GiseEquipeComMembros[];
}

export interface GiseDetalhado extends schema.GiseEscala {
	seccionais: Array<
		schema.GiseSeccional & {
			seccional_nome: string;
			temRespostas: boolean;
			unidades: GiseUnidadeSlot[];
		}
	>;
	supervisor_nome: string | null;
	supervisor_matricula: string | null;
	supervisor_telefone: string | null;
	assessor_nome: string | null;
	assessor_matricula: string | null;
	assessor_telefone: string | null;
	seint1_nome: string | null;
	seint1_matricula: string | null;
	seint1_telefone: string | null;
	seint2_nome: string | null;
	seint2_matricula: string | null;
	seint2_telefone: string | null;
	documento: schema.GiseDocumento | null;
	totalSeccionais: number;
	assinaturasRelatorioExtra: number;
	temSaidaConfirmada: boolean;
}
