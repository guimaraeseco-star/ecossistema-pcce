/**
 * Toda action de composição da GISE registra o que fez — FLW-GISE-003.
 *
 * `desfecho.test.ts` prova que o registro está CERTO. Este arquivo prova que
 * ele EXISTE em todas — e é o que impede o achado de voltar, porque o achado
 * nunca foi uma action instrumentada errado: eram treze sem instrumentação
 * nenhuma. Testar as treze uma a uma reproduziria exatamente a duplicação que
 * deixou o buraco; ler os arquivos, não.
 *
 * A leitura é textual de propósito. Um teste que CHAMASSE cada action precisaria
 * de RequestEvent, FormData, sessão, cache de papel e D1 para cada uma das
 * treze — e o que ele mediria no fim é o que está escrito aqui: que a chamada
 * está lá. Quando a action muda de assinatura, este teste continua valendo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR_ACTIONS = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * As actions de um arquivo `actions-*.ts`, pelo formato que todas seguem:
 * `nomeDaAction: async (` no primeiro nível do objeto exportado.
 *
 * Se alguém escrever uma action de outro jeito, ela não aparece aqui e passa
 * despercebida — por isso o teste também confere o TOTAL: dezesseis. Um número
 * cravado obriga quem acrescentar (ou remover) uma action a passar por este
 * arquivo, que é onde a regra está escrita.
 */
function actionsDe(arquivo: string): string[] {
	const fonte = readFileSync(join(DIR_ACTIONS, arquivo), 'utf8');
	return [...fonte.matchAll(/^\t(\w+): async \(/gm)].map((m) => m[1]);
}

/** O corpo de uma action, do `nome: async (` até o começo da seguinte. */
function corpoDaAction(arquivo: string, nome: string): string {
	const fonte = readFileSync(join(DIR_ACTIONS, arquivo), 'utf8');
	const inicio = fonte.indexOf(`\t${nome}: async (`);
	const resto = fonte.slice(inicio + 1);
	const proxima = resto.search(/^\t\w+: async \(/m);
	return proxima === -1 ? resto : resto.slice(0, proxima);
}

/** Os arquivos de composição. `actions-escala.ts` audita por conta própria. */
const ARQUIVOS = [
	'actions-membros.ts',
	'actions-equipe.ts',
	'actions-unidade.ts',
	'actions-seccional.ts'
];

const TODAS = ARQUIVOS.flatMap((a) => actionsDe(a).map((nome) => [a, nome] as const));

describe('cobertura da varredura', () => {
	it('os quatro arquivos de composição existem', () => {
		const presentes = readdirSync(DIR_ACTIONS).filter((f) => f.startsWith('actions-'));
		expect(presentes.sort()).toEqual([...ARQUIVOS, 'actions-escala.ts'].sort());
	});

	it('treze actions de composição, nem mais nem menos', () => {
		// Mudou o número? Instrumente a action nova (ou apague esta linha junto com
		// a que saiu) — não ajuste o total para o teste voltar ao verde.
		expect(TODAS.map(([, nome]) => nome)).toHaveLength(13);
	});
});

describe('cada action fecha com o desfecho', () => {
	it.each(TODAS)('%s › %s chama concluirMudancaGise', (arquivo, nome) => {
		expect(corpoDaAction(arquivo, nome)).toContain('concluirMudancaGise(');
	});

	it.each(TODAS)('%s › %s recebe o event inteiro', (arquivo, nome) => {
		// `contextoDeEvento` precisa de `request`, `url`, `getClientAddress` e
		// `locals` — desestruturar só `{ request, locals, platform, params }` na
		// assinatura deixaria o evento sem IP, rota e request_id.
		expect(corpoDaAction(arquivo, nome)).toMatch(/async \(event: Event\)/);
	});
});
