/**
 * `/operacoes/gise/config` — aposentada.
 *
 * O que ela editava (vagas padrão das equipes, horário e os textos do breve
 * relatório) passou a ser POR OPERAÇÃO, em `/operacoes/gise/operacoes/[id]/config`. Global
 * fazia sentido com uma operação só; com CRAJUBAR e EDGE convivendo, o tamanho
 * da equipe e o parágrafo do PDF são da força-tarefa, não do sistema.
 *
 * A rota sobrevive só como redirecionamento: ela esteve no menu por meses e
 * está em favoritos e em documentação impressa. Um 404 aqui seria a resposta
 * certa para o roteador e a errada para quem clicou.
 *
 * As chaves em `configuracoes` que ela gravava continuam existindo — passaram a
 * ser o valor HERDADO por toda operação que não sobrescreve.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	redirect(308, '/operacoes/gise/operacoes');
};
