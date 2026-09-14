/**
 * Guard de CI: **campo lido de `FormData` tem limite, ou está declarado.**
 *
 * Rota de API já tem trilho: o padrão obrigatório é `validateBody` com Zod, que
 * traz `.max()`, faixa e enum de graça — hoje 40 dos 52 handlers de mutação
 * validam por schema e NENHUM lê corpo sem schema. Form action não tem
 * equivalente: lê `FormData` na mão, e cada autor decidiu sozinho o que
 * conferir. A maioria decidiu por truthiness.
 *
 * Não é hipótese. Toda falha de ENTRADA da auditoria de set/2026 caiu desse
 * lado, e sempre com a mesma forma — a regra certa num caminho, ausente no
 * irmão:
 *
 *   - `mes=99` / `ano=-5` produzindo escala com `MESES_PT[98]` (`undefined` no
 *     título) enquanto o `criar` ao lado passava por `escalaSchema`;
 *   - vagas de equipe sem faixa, com `999999` desarmando o `COUNT(*) < slots`
 *     que decide a alocação;
 *   - `observacoes` sem cap, indo para dentro de PDF ASSINADO, enquanto duas
 *     outras telas tinham o mesmo cap copiado;
 *   - `data_inicio='banana'` anulando o portão da janela de presença, porque
 *     `horarioGiseLiberado` falha ABERTO em data que não parseia — a mesma
 *     coluna que `escalaSchema` e `policial-historico` já validavam.
 *
 * Nenhum foi descuido isolado: foi ausência de padrão. Fechar os buracos um a
 * um não impede o próximo — este guard é a tentativa de fechar a FÁBRICA deles.
 *
 * ## O que conta como limite
 *
 * O guard não exige um helper específico (seria a lista que nunca está
 * completa, e o campo novo com validação nova passaria batido justamente por
 * ser novo). Ele aceita QUALQUER uma destas cinco formas, que é o conjunto
 * observável de "este valor não entra cru":
 *
 *   1. a action roda um schema Zod (`safeParse` / `.parse(`);
 *   2. o campo é lido por um LEITOR LIMITADO (`$lib/server/form-data`), e o
 *      nome do campo aparece na chamada;
 *   3. a leitura é BOOLEANA (`=== 'true'`, `=== 'on'`, `!= null`) — o valor
 *      colapsa para dois estados antes de chegar a qualquer lugar;
 *   4. o campo é IDENTIFICADOR (`id`, `*_id`, `*Id`). Id não se valida por
 *      formato, se valida por POSSE, e essa é a pergunta de
 *      `guard-autorizacao.mjs` — foi assim que membro de outra escala virava
 *      editável por id (FLW-ESC-002). Cobrar formato aqui daria a impressão de
 *      que o id está tratado quando o que importa é outro guard;
 *   5. a variável derivada do campo é COMPARADA contra valores no corpo
 *      (`mes < 1 || mes > 12`, `t === 'plantao'`) — faixa e enum escritos à
 *      mão contam. Ver `comparadaNoCorpo`.
 *
 * ## Limites conhecidos (silêncio daqui NÃO é aprovação)
 *
 * - **(1) é por ACTION, não por campo.** Action que roda um schema cobrindo
 *   três campos e lê um quarto na mão passa. Preferi isso a exigir o mapa
 *   campo-a-campo, que erraria em todo `safeParse` de objeto montado — e um
 *   guard que dá falso VERMELHO é desligado na primeira semana.
 * - **(4) é heurística de NOME.** Campo chamado `unidade_id` que na verdade
 *   carregasse texto livre passaria. Aceito porque o custo do erro é baixo (id
 *   alheio é problema de autorização, que tem guard próprio) e a alternativa
 *   seria inferir tipo, que este parser não faz.
 * - Só enxerga `+page.server.ts` e `_actions/actions-*.ts`. Action escondida em
 *   outro arquivo é ponto cego — e é por isso que a contagem abaixo reprova
 *   quando o parser lê menos actions do que o arquivo declara.
 *
 * Uso: node scripts/guard-entrada.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Campos que legitimamente entram sem limite de formato, com o motivo.
 * Chave: `<arquivo> → <action> → <campo>`.
 *
 * Encolher esta lista é progresso. Crescer, sem um motivo desta natureza, é o
 * que o guard existe para pegar. Declarar é o ponto: a diferença entre "cru de
 * propósito" e "esqueceram o limite" não está no código.
 */
export const DECLARADOS = {};

/**
 * Campos limitados por uma FUNÇÃO DE DOMÍNIO, com o nome dela.
 * Chave: `<arquivo> → <action> → <campo>` → nome que precisa aparecer no corpo.
 *
 * Existe porque limite nem sempre é comparação nem schema: `data_plantao` é
 * conferida por `erroDeDatasForaDoPeriodo`, que recusa data fora do período da
 * escala — limite melhor que qualquer regex de formato, e invisível para o
 * classificador. Enumerar todas essas funções numa lista global seria a lista
 * que nunca está completa (o erro que `guard-autorizacao.mjs` descreve no
 * cabeçalho); nomeá-las POR CAMPO, e conferir que a chamada existe, não tem
 * esse problema — se alguém remover a função, o guard reprova em vez de
 * continuar dando verde por uma entrada que virou promessa vazia.
 *
 * Diferente de `DECLARADOS`, isto NÃO é dispensa: é o limite, dito por nome.
 *
 * **Limite conhecido, e ele já me mordeu.** O guard confere que a função é
 * CHAMADA no corpo, não que é chamada NAQUELE campo. Ao montar esta lista eu
 * declarei `editar → data_saida` limitada por `erroDeDatasForaDoPeriodo`; a
 * função está no corpo, mas recebe `data_plantao` — `data_saida` ia crua para a
 * coluna. O guard deu verde para um atestado falso MEU. Amarrar função a campo
 * exigiria seguir o argumento até a chamada, que este parser não faz; então a
 * regra prática é: entrada aqui se escreve LENDO a chamada, não confiando no
 * nome estar por perto.
 */
export const LIMITADO_POR = {
	// `lotacaoNoEscopo` recusa lotação fora do escopo administrado de quem chama
	// (FLW-AUT-002). Limite melhor que formato: não é "parece uma lotação", é
	// "esta pessoa pode criar escala nesta lotação".
	'src/routes/escalas/+page.server.ts → criarComBase → lotacao': 'lotacaoNoEscopo',

	// A data do plantão é conferida contra o PERÍODO da escala — o calendário da
	// tela é markup, e a data vem do cliente (FLW-ESC-005).
	'src/routes/escalas/[id]/_actions/actions-composicao.ts → adicionar → data_plantao':
		'erroDeDatasForaDoPeriodo',
	'src/routes/escalas/[id]/_actions/actions-composicao.ts → editar → data_plantao':
		'erroDeDatasForaDoPeriodo',

	// `motivoParaRecusarValor` conferre CADA campo solicitável, `cargo` inclusive
	// (`valor === 'DPC' || valor === 'OIP'`). O `cargoAlvo` lido aqui só escolhe
	// a regra dos outros campos, e um cargo inválido reprova no laço antes de
	// qualquer gravação.
	'src/routes/servidores/[id]/+page.server.ts → solicitarAlteracao → cargo':
		'motivoParaRecusarValor',

	// Conversor booleano de verdade (`'1' | 'true' | 'on'`), só não é o literal
	// que o classificador reconhece.
	'src/routes/servidores/[id]/+page.server.ts → toggleModuloAdmin → ativar': 'formData2Bool',

	// Parser estrito do JSON de respostas: recusa o que não casa com o formulário.
	'src/routes/res-gise/relatorio/[giseId]/+page.server.ts → salvarResposta → respostas':
		'parseRespostasFormularioJsonStrict',

	// `datas` é JSON de campo oculto — markup, não promessa. Nos três primeiros o
	// conjunto é conferido contra o PERÍODO da escala; no `editarDiasEscala` não
	// há período contra o que comparar (é ele que está sendo redefinido), então
	// o que se exige é o formato de cada item.
	'src/routes/escalas/[id]/_actions/actions-composicao.ts → adicionarPlantao → datas':
		'erroDeDatasForaDoPeriodo',
	'src/routes/escalas/[id]/_actions/actions-datas.ts → editarPlantaoAgrupado → datas':
		'erroDeDatasForaDoPeriodo',
	'src/routes/escalas/[id]/_actions/actions-datas.ts → repetir → datas': 'erroDeDatasForaDoPeriodo',
	'src/routes/escalas/[id]/_actions/actions-datas.ts → editarDiasEscala → datas': 'dataISOValida',

	// Parser local que confere JSON, array, objeto por item, formato ISO de cada
	// data, e ainda deduplica — limite melhor que qualquer regex de campo.
	'src/routes/gise/+page.server.ts → criar → datas_json': 'parseDatasCriacaoGise',

	// Identificador da escala de ORIGEM. Não se valida por formato e sim por
	// existência, que é o que `clonarGiseParaData` faz ao carregar a GISE e
	// lançar 'GISE não encontrada'. A action é só do Admin Geral, cujo escopo é
	// global — não há posse a conferir além de a escala existir.
	'src/routes/gise/+page.server.ts → criar → clonar_de': 'clonarGiseParaData'
};

/**
 * **Dívida pré-existente**: leituras sem limite que já estavam aqui quando o
 * guard nasceu (set/2026). Só o que é NOVO reprova.
 *
 * A forma é a mesma de `scripts/duplicacao-baseline.json`, e a advertência dele
 * vale inteira: encher esta lista para o guard passar troca um achado por uma
 * linha de código, que é a versão automatizada de não corrigir. Ela existe
 * porque a alternativa era pior — introduzir o guard exigindo 34 correções de
 * uma vez, em código que grava documento ASSINADO, sem teste que cubra a
 * mudança. Guard que não entra não protege nada.
 *
 * **Hoje ela está VAZIA**, e essa é a única forma boa de uma baseline terminar.
 * Foram duas levas em set/2026: primeiro as 22 entradas da escala ordinária
 * (hora, minuto, equipe, datas), com `horaDeCamposSeparados`, `horaOuPadrao` e
 * `lerEquipe`; depois as cinco restantes, que já não eram família — `papel`
 * ganhou leitura de lista fechada, `codigo` passou a usar o MESMO schema da
 * rota de API, `config` ganhou teto e checagem de item, e `datas_json` e
 * `clonar_de` foram para `LIMITADO_POR` porque já tinham limite.
 *
 * Vazia ela continua útil: é o lugar declarado para a próxima dívida que
 * alguém precise assumir conscientemente — e a advertência acima vale para
 * quem for usá-la.
 */
export const BASELINE = new Set([]);

/** Leitores limitados de `$lib/server/form-data`. */
const LEITORES = ['textoLimitado', 'textoLimitadoOuNulo', 'inteiroNaFaixa', 'dataIso', 'horaHhMm'];

/** Nome de campo que é identificador — validado por POSSE, não por formato. */
const RE_ID = /^(id|ids|.*_id|.*_ids|.*Id|.*Ids)$/;

/** A action roda um schema Zod? */
const RE_SCHEMA = /\.safeParse\(|\bSchema\.parse\(|\bschema\.parse\(/;

/**
 * A variável derivada do campo é COMPARADA contra valores?
 *
 * É a quinta forma de limite, e a que quase deixei de fora: `criarComBase`
 * valida `mes` com `mes < 1 || mes > 12` escrito à mão, sem helper e sem
 * schema — foi assim que a auditoria de set/2026 a consertou. Um guard que não
 * enxergasse isso reprovaria código correto, e guard que dá falso VERMELHO é
 * desligado na primeira semana.
 *
 * `RE.test(valor)`, `LISTA.includes(valor)` e `SET.has(valor)` contam: os três
 * são a pergunta "este valor está dentro do permitido?", que é justamente o que
 * se quer. `.test` entrou depois de o guard reprovar `vigente_desde`, que já
 * era conferida por `/^\d{4}-\d{2}-\d{2}$/.test(...)` na linha seguinte.
 *
 * O índice (`TABELA[valor]`) exige IDENTIFICADOR antes do colchete: consulta em
 * tabela fechada valida; `[data_plantao]` é array LITERAL e não valida nada — e
 * essa colisão dava verde de graça na primeira versão deste guard.
 *
 * Exige COMPARAÇÃO DE VALOR, não truthiness: `if (papel)` só prova que veio
 * algo, e `papel` ali é um `as 'admin_seccional' | 'admin_unidade'` — cast de
 * TypeScript, que não existe em runtime. Aceitar truthiness aqui daria verde a
 * exatamente a classe de bug que este guard procura.
 */
function comparadaNoCorpo(nome, corpo) {
	if (!nome) return false;
	const n = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(
		`\\b${n}\\b\\s*(===|!==|==|!=|<=|>=|<|>)|(===|!==|==|!=)\\s*${n}\\b` +
			`|\\.(includes|test|has)\\(\\s*${n}\\b|\\w\\s*\\[\\s*${n}\\s*\\]`
	).test(corpo);
}

/** O nome da variável que recebe a leitura, quando há um `const`/`let` na frente. */
function variavelDaLeitura(trecho, iLeitura) {
	const inicio = Math.max(0, trecho.lastIndexOf('\n', iLeitura));
	const linha = trecho.slice(inicio, iLeitura);
	const m = linha.match(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*[^=]*$/);
	return m ? m[1] : null;
}

/** Lista `+page.server.ts` e os módulos de form action, sem `find` do Unix. */
function listarArquivosDeAction(raizRoutes) {
	const saida = [];
	function andar(dir) {
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, ent.name);
			if (ent.isDirectory()) {
				if (ent.name === '_actions') {
					for (const f of readdirSync(full, { withFileTypes: true })) {
						if (f.isFile() && f.name.startsWith('actions-') && f.name.endsWith('.ts')) {
							saida.push(relative('.', join(full, f.name)).replaceAll('\\', '/'));
						}
					}
				} else {
					andar(full);
				}
				continue;
			}
			if (ent.name === '+page.server.ts') saida.push(relative('.', full).replaceAll('\\', '/'));
		}
	}
	andar(raizRoutes);
	return saida.sort();
}

/** Do índice da chave `{`, devolve o bloco balanceado. */
function blocoBalanceado(src, iAbre) {
	let profundidade = 0;
	for (let i = iAbre; i < src.length; i++) {
		if (src[i] === '{') profundidade++;
		else if (src[i] === '}') {
			profundidade--;
			if (profundidade === 0) return src.slice(iAbre, i + 1);
		}
	}
	return src.slice(iAbre);
}

/** Extrai as form actions de um arquivo: `{ nome, corpo }[]`. */
function actionsDe(src) {
	const achadas = [];
	const decl = src.match(/export const (?:actions\w*)[^=]*=\s*\{/);
	if (!decl) return achadas;
	const bloco = blocoBalanceado(src, src.indexOf('{', decl.index + decl[0].length - 1));
	let profundidade = 0;
	for (let i = 0; i < bloco.length; i++) {
		if (bloco[i] === '{') profundidade++;
		else if (bloco[i] === '}') profundidade--;
		else if (profundidade === 1) {
			const nm = bloco.slice(i).match(/^(\w+):\s*async\s*\(/);
			if (nm) {
				const iAbre = bloco.indexOf('{', bloco.indexOf('=>', i));
				const corpo = blocoBalanceado(bloco, iAbre);
				achadas.push({ nome: nm[1], corpo });
				i = iAbre + corpo.length - 1;
				profundidade = 1;
			}
		}
	}
	return achadas;
}

/**
 * Os campos lidos de `FormData` no trecho, e como. Devolve
 * `Map<campo, { booleano: boolean }>`.
 */
function camposLidos(trecho) {
	const campos = new Map();
	for (const m of trecho.matchAll(/(?:formData|fd|data|form)\.get\(\s*'([A-Za-z0-9_]+)'\s*\)/g)) {
		const campo = m[1];
		// O que vem LOGO DEPOIS da leitura decide se ela colapsa para booleano.
		const cauda = trecho.slice(m.index + m[0].length, m.index + m[0].length + 40);
		const booleano = /^\s*(===\s*'(true|on|1)'|!==?\s*null|!=\s*null)/.test(cauda);
		const variavel = variavelDaLeitura(trecho, m.index);
		const antes = campos.get(campo);
		// Um campo lido em dois pontos só é booleano se TODAS as leituras forem;
		// já a comparação basta em UMA — validar uma vez e reusar é legítimo.
		campos.set(campo, {
			booleano: antes ? antes.booleano && booleano : booleano,
			variaveis: [...(antes?.variaveis ?? []), variavel].filter(Boolean)
		});
	}
	return campos;
}

function principal() {
	const arquivos = listarArquivosDeAction(resolve('src/routes'));
	const problemas = [];
	let nActions = 0;
	let nCampos = 0;
	let nCobertos = 0;
	let declaradosVistos = new Set();
	let limitadosPorFn = new Set();
	let baselineVistos = new Set();
	let declaradosPorParser = 0;

	for (const arquivo of arquivos) {
		const src = readFileSync(arquivo, 'utf8');
		if (!/export const actions\w*\b/.test(src)) continue;

		// Ponto cego: o arquivo declara N actions e o parser leu M.
		declaradosPorParser += [...src.matchAll(/^\s+([a-zA-Z][\w]*): async/gm)].length;

		const iPrimeiro = src.search(/export const actions\w*\b/);
		const preambulo = iPrimeiro > 0 ? src.slice(0, iPrimeiro) : '';

		for (const { nome, corpo } of actionsDe(src)) {
			nActions++;
			const visivel = corpo + preambulo;
			const temSchema = RE_SCHEMA.test(visivel);

			for (const [campo, { booleano, variaveis }] of camposLidos(corpo)) {
				nCampos++;
				const chave = `${arquivo} → ${nome} → ${campo}`;

				const porLeitor = LEITORES.some((h) => new RegExp(`${h}\\([^)]*'${campo}'`).test(visivel));
				const inline = variaveis.some((v) => comparadaNoCorpo(v, corpo));
				const fn = LIMITADO_POR[chave];
				if (fn) {
					limitadosPorFn.add(chave);
					if (!corpo.includes(fn)) {
						problemas.push({
							arquivo,
							msg:
								`"${nome}" declara "${campo}" limitado por ${fn}(), mas a chamada não ` +
								'está no corpo — a entrada em LIMITADO_POR virou promessa vazia'
						});
					}
					nCobertos++;
					continue;
				}
				const coberto = temSchema || porLeitor || booleano || inline || RE_ID.test(campo);

				if (coberto) {
					nCobertos++;
					// Lista velha mentindo: campo agora coberto e ainda dispensado.
					if (chave in DECLARADOS) {
						problemas.push({
							arquivo,
							msg: `"${nome}" já limita "${campo}" — remova a dispensa de DECLARADOS`
						});
					}
					continue;
				}

				if (BASELINE.has(chave)) {
					baselineVistos.add(chave);
					continue;
				}

				declaradosVistos.add(chave);
				if (!(chave in DECLARADOS)) {
					problemas.push({
						arquivo,
						msg:
							`"${nome}" lê "${campo}" de FormData sem limite — use um leitor de ` +
							'$lib/server/form-data (textoLimitado / inteiroNaFaixa / dataIso / horaHhMm), ' +
							'um schema Zod, ou declare o motivo em scripts/guard-entrada.mjs'
					});
				}
			}
		}
	}

	// Dívida que sarou: sai da baseline. Sem isso a lista só cresce, e uma
	// entrada que já não corresponde a nada dá a impressão de dívida maior do
	// que a real — o oposto do que ela existe para mostrar.
	for (const chave of BASELINE) {
		if (!baselineVistos.has(chave)) {
			problemas.push({
				arquivo: chave.split(' → ')[0],
				msg:
					`"${chave}" saiu da dívida (ganhou limite ou sumiu) — ` +
					'remova de BASELINE em scripts/guard-entrada.mjs'
			});
		}
	}

	// Entrada de LIMITADO_POR que não corresponde a leitura nenhuma.
	for (const chave of Object.keys(LIMITADO_POR)) {
		if (!limitadosPorFn.has(chave)) {
			problemas.push({
				arquivo: chave.split(' → ')[0],
				msg: `entrada obsoleta em LIMITADO_POR: "${chave}" não existe mais`
			});
		}
	}

	// Dispensa que não corresponde a leitura nenhuma.
	for (const chave of Object.keys(DECLARADOS)) {
		if (!declaradosVistos.has(chave)) {
			problemas.push({
				arquivo: chave.split(' → ')[0],
				msg: `dispensa obsoleta em DECLARADOS: "${chave}" não existe mais`
			});
		}
	}

	// Silêncio não é aprovação: action que o parser não leu é action sem guard.
	if (nActions !== declaradosPorParser) {
		problemas.push({
			arquivo: 'scripts/guard-entrada.mjs',
			msg:
				`o parser leu ${nActions} form actions, mas há ${declaradosPorParser} declaradas — ` +
				'alguma escapou; ajuste o parser antes de confiar neste resultado'
		});
	}

	if (problemas.length > 0) {
		console.error('\n[guard-entrada] campo de FormData sem limite no servidor:\n');
		for (const { arquivo, msg } of problemas) {
			console.error(`::error file=${arquivo}::${msg}`);
			console.error(`  ${arquivo} — ${msg}`);
		}
		console.error(
			'\n`maxlength` e `min`/`max` da tela são dica de digitação: somem num POST\n' +
				'direto. Ver README → "Erros de API" e $lib/server/form-data.\n'
		);
		process.exit(1);
	}

	console.log(
		`[guard-entrada] ${nActions} form actions, ${nCampos} leituras de FormData — ` +
			`${nCobertos} com limite (${limitadosPorFn.size} por função nomeada), ` +
			`${declaradosVistos.size} dispensadas com motivo declarado, ` +
			`${baselineVistos.size} na dívida pré-existente a encolher.`
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	principal();
}
