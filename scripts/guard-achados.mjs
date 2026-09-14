/**
 * Guard de CI: **sigla de achado citada no código precisa ter onde ser lida.**
 *
 * O projeto arquiva auditoria fora do working tree — o relatório sai, o
 * `HISTORICO.md` fica com o `git show` que o recupera. Isso funciona enquanto o
 * catálogo souber de TODAS as siglas. Quando não sabe, o comentário
 * `// FLW-RBAC-003` vira exatamente o que ninguém quer: um ponteiro que promete
 * rastreabilidade e não entrega. Quem lê procura no `HISTORICO.md`, não acha, e
 * conclui que a regra ao lado é folclore.
 *
 * Foi o que a varredura de ago/2026 encontrou. O `HISTORICO.md` descrevia a
 * auditoria de fluxos como "achados FLW-AUT-001…020"; o documento define DOZE
 * famílias, e 130 referências no código apontavam para as onze não nomeadas. E
 * quatro siglas (`M-6`, `M-8`, `M-10`, `I-6`) não existem em documento NENHUM
 * deste repositório — `git log -S` não acha commit que as tenha introduzido.
 *
 * O guard reprova quando uma família citada no código não aparece no
 * `HISTORICO.md` e não está declarada em `SEM_DOCUMENTO` abaixo. Declarar é o
 * ponto: a diferença entre "órfã e ninguém sabe" e "órfã, sabemos, e o
 * comentário ao lado é o registro inteiro" não está no código.
 *
 * Uso: node scripts/guard-achados.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZES = ['src', 'e2e', 'scripts'];
const EXTENSOES = new Set(['.ts', '.svelte', '.mjs', '.js']);
const CATALOGO = 'docs/HISTORICO.md';

/**
 * **Limite conhecido: famílias de UMA LETRA ficam de fora.** `B-2`, `I-3`,
 * `L-1`, `M-1`, `U-1` são achados reais, mas a verificação aqui é
 * `catalogo.includes(familia)` — e `includes('M')` casa com qualquer parágrafo
 * do `HISTORICO.md`, então elas passariam sempre, provando nada. Verificá-las
 * de verdade exigiria conferir cada ID contra a FAIXA que o catálogo declara
 * (`M-3/M-4`, `I-1…I-4`), o que é intervalo, não substring.
 *
 * Foram conferidas à mão em ago/2026 e o resultado está no `HISTORICO.md`: as
 * faixas documentadas batem, salvo as quatro de `SEM_DOCUMENTO` abaixo.
 *
 * Famílias que aparecem no código e **não têm documento neste repositório**.
 * Não são dívida a pagar com arquivo novo: o relatório de origem nunca foi
 * commitado. O que as mantém úteis é o comentário ao lado delas — e é por isso
 * que cada uma nomeia aqui o arquivo onde vive.
 */
const SEM_DOCUMENTO = {
	'M-6': 'e2e/auth.spec.ts — /api/health público virou binário {status}',
	'M-8':
		'src/lib/server/termo/__tests__/sanitize.test.ts — href protocol-relative e teto anti-ReDoS',
	'M-10': 'src/lib/db/lgpd/retencao.ts — audit_log crescia sem limite de retenção',
	'I-6': 'src/lib/schemas/__tests__/schemas.test.ts — expansão da blocklist de senha'
};

/**
 * As famílias de achado que EXISTEM. Lista fechada, e é o que faz o guard
 * funcionar: a primeira versão casava `[A-Z]{1,3}-\d+` e acusava `SHA-256`,
 * `RSA-2048`, `WGS-84`, `TEST-NET-1`, `%PDF-1.7` e `DOC-ICP-15` — 30 falsos
 * positivos contra 13 achados reais. Sigla de norma e de primitiva
 * criptográfica tem exatamente a mesma forma que sigla de auditoria; só a lista
 * separa as duas.
 *
 * Família nova entra aqui junto com a auditoria que a criou.
 */
const FAMILIAS = [
	'FLW-ACL',
	'FLW-AUDIT',
	'FLW-AUT',
	'FLW-AUTH',
	'FLW-DOC',
	'FLW-ESC',
	'FLW-GISE',
	'FLW-LGPD',
	'FLW-POLICIAL',
	'FLW-R2',
	'FLW-RBAC',
	'FLW-UNIDADE',
	'FLW-WEBHOOK',
	'SEC',
	'VIS',
	'DUP',
	'FLX',
	'R2'
];

/**
 * Ordena por comprimento decrescente para `FLW-AUTH` casar antes de `FLW-AUT`.
 * Sem isso, toda referência a `FLW-AUTH-002` seria contada como `FLW-AUT`.
 */
const PADRAO = new RegExp(
	`\\b(${[...FAMILIAS].sort((a, b) => b.length - a.length).join('|')})-\\d+\\b`,
	'g'
);

function arquivos(dir) {
	const saida = [];
	for (const nome of readdirSync(dir)) {
		if (nome === 'node_modules' || nome.startsWith('.')) continue;
		const caminho = join(dir, nome);
		if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
		else if (EXTENSOES.has(extname(nome))) saida.push(caminho);
	}
	return saida;
}

const catalogo = readFileSync(CATALOGO, 'utf8');
const ocorrencias = new Map();

for (const raiz of RAIZES) {
	for (const arquivo of arquivos(raiz)) {
		const texto = readFileSync(arquivo, 'utf8');
		for (const [, fam] of texto.matchAll(PADRAO)) {
			if (!ocorrencias.has(fam)) ocorrencias.set(fam, new Set());
			ocorrencias.get(fam).add(arquivo);
		}
	}
}

const orfas = [];
for (const [fam, arqs] of [...ocorrencias].sort()) {
	if (Object.hasOwn(SEM_DOCUMENTO, fam)) continue;
	if (catalogo.includes(fam)) continue;
	orfas.push({ fam, arqs: [...arqs] });
}

if (orfas.length > 0) {
	console.error('\n[guard-achados] sigla citada no código sem entrada no catálogo:\n');
	for (const { fam, arqs } of orfas) {
		console.error(`::error::${fam} não aparece em ${CATALOGO} (${arqs.length} arquivo(s))`);
		for (const a of arqs.slice(0, 5)) console.error(`  ${fam} — ${a}`);
	}
	console.error(
		`\nDuas saídas legítimas:\n` +
			`  1. a auditoria de origem existe → nomeie a família na linha dela em ${CATALOGO};\n` +
			`  2. o relatório nunca foi commitado → declare em SEM_DOCUMENTO, com o arquivo\n` +
			`     onde a sigla vive, porque aí o comentário ao lado É o registro inteiro.\n` +
			`Ver CLAUDE.md → "Mapa da documentação".\n`
	);
	process.exit(1);
}

const total = [...ocorrencias.values()].reduce((n, s) => n + s.size, 0);
console.log(
	`[guard-achados] ${ocorrencias.size} família(s) de achado citadas em ${total} arquivo(s) — ` +
		`${Object.keys(SEM_DOCUMENTO).length} declaradas sem documento, o resto no catálogo.`
);
