/**
 * Marca em `municipios` a REGIÃO METROPOLITANA de cada um, a partir do IBGE.
 *
 * Uso:
 *   node scripts/gerar-regioes-metropolitanas.mjs           # emite a migração
 *   node scripts/gerar-regioes-metropolitanas.mjs --diff    # só mostra o que MUDOU
 *
 * ## Para que serve
 *
 * O Decreto Estadual nº 35.922/2024, art. 4º, §1º, II, veda a diária quando o
 * deslocamento rodoviário ocorre DENTRO da mesma região metropolitana, com
 * distância de até 120 km e sem extrapolação de jornada. Sem saber a que região
 * cada município pertence, essa regra não tem como ser sequer conferida.
 *
 * A do Cariri é a que importa para o DPI SUL: Juazeiro do Norte, Crato e
 * Barbalha estão nela, e Juazeiro ↔ Crato dá 12 km.
 *
 * ## O código ALERTA, não bloqueia
 *
 * A vedação tem três condições, e a terceira ("sem extrapolação de jornada")
 * depende de horário, não de geografia — a operação das 04h sempre extrapola,
 * então na prática ela quase nunca fecha. Barrar a diária só pela região seria
 * recusar o que a lei permite. Ver `alertasDaViagem` em `$lib/diarias/vedacoes`.
 *
 * ## Por que script de geração, e não consulta em runtime
 *
 * Mesma razão da matriz de distâncias (ver `gerar-distancias.mjs`): o dado
 * decide dinheiro, então precisa ser REPRODUTÍVEL, estar DISPONÍVEL com o IBGE
 * fora do ar, e ser AUDITÁVEL. A composição muda por lei estadual — raramente, e
 * quando muda alguém precisa olhar, que é o que o `--diff` serve.
 *
 * ## Chaveado por CÓDIGO, nunca por nome
 *
 * O IBGE devolve o código de 7 dígitos de cada município da região. Casar por
 * nome é o que quase pôs "Guaiuba" (sem acento, grafia do Wikidata) na matriz
 * de distâncias — e Guaiúba é justamente um município da Região Metropolitana
 * de Fortaleza.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

/** Prefixo IBGE do Ceará. */
const PREFIXO_IBGE = '23';
const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades';
const UA = 'escalas-pcce/1.0 (geracao de regioes metropolitanas)';
const DESTINO = 'migrations/0074_municipios_regiao_metropolitana.sql';

/**
 * O id do IBGE de cada região metropolitana do Ceará, e a sigla que a coluna
 * guarda.
 *
 * Mapa EXPLÍCITO, e não sigla derivada do nome: região nova que o IBGE passe a
 * publicar aborta a geração em vez de entrar como `null` em silêncio — e uma
 * região a menos na tabela é um alerta que deixa de aparecer, que é o modo caro
 * de errar aqui.
 */
const SIGLAS = new Map([
	['01401', 'RMF'],
	['01501', 'RMC'],
	['01601', 'RMS']
]);

const modoDiff = process.argv.slice(2).includes('--diff');

/** Escapa aspas simples para literal SQL. */
const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** `Map<sigla, { nome, municipios: Array<{ ibge, nome }> }>`, do IBGE. */
async function buscarRegioes() {
	const res = await fetch(`${IBGE}/estados/${PREFIXO_IBGE}/regioes-metropolitanas`, {
		headers: { 'User-Agent': UA }
	});
	if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
	const dados = await res.json();

	const regioes = new Map();
	const desconhecidas = [];
	for (const r of dados) {
		const sigla = SIGLAS.get(String(r.id));
		if (!sigla) {
			desconhecidas.push(`${r.nome} (id ${r.id})`);
			continue;
		}
		regioes.set(sigla, {
			nome: r.nome,
			municipios: r.municipios.map((m) => ({ ibge: String(m.id), nome: m.nome }))
		});
	}
	if (desconhecidas.length > 0) {
		throw new Error(
			`região metropolitana sem sigla em SIGLAS: ${desconhecidas.join(', ')}. ` +
				'Acrescente-a ao mapa antes de gerar — sem sigla, o alerta da vedação some.'
		);
	}
	return regioes;
}

/** `Map<ibge, sigla>` da migração já commitada, para o `--diff`. */
function anterior() {
	if (!existsSync(DESTINO)) return null;
	const sql = readFileSync(DESTINO, 'utf8');
	const atual = new Map();
	// Cada UPDATE lista os códigos de uma sigla: `= 'RMC' WHERE ... IN ('2301901',…)`.
	for (const bloco of sql.matchAll(/=\s*'(RM[FCS])'[^;]*?IN\s*\(([^)]*)\)/g)) {
		for (const cod of bloco[2].matchAll(/'(\d{7})'/g)) atual.set(cod[1], bloco[1]);
	}
	return atual.size > 0 ? atual : null;
}

/** Mostra entradas e saídas — cada uma liga ou desliga um alerta de vedação. */
function mostrarDiff(antes, regioes) {
	const agora = new Map();
	const nomes = new Map();
	for (const [sigla, r] of regioes) {
		for (const m of r.municipios) {
			agora.set(m.ibge, sigla);
			nomes.set(m.ibge, m.nome);
		}
	}

	const mudancas = [];
	for (const [ibge, sigla] of agora) {
		const era = antes.get(ibge);
		if (era !== sigla) mudancas.push(`  + ${nomes.get(ibge)} (${ibge}): ${era ?? '—'} → ${sigla}`);
	}
	for (const [ibge, sigla] of antes) {
		if (!agora.has(ibge)) mudancas.push(`  − ${ibge}: ${sigla} → —`);
	}

	console.log(`\n[regioes] ${agora.size} municípios em região metropolitana.`);
	if (mudancas.length === 0) {
		console.log('Nada mudou — a composição no repositório continua válida.');
		return;
	}
	console.log(`\n⚠ ${mudancas.length} mudança(s). Cada uma LIGA ou DESLIGA o alerta da vedação do`);
	console.log('  art. 4º, §1º, II para todo plano futuro naquele município:');
	for (const l of mudancas) console.log(l);
}

/** A migração: a coluna, o índice e um UPDATE por região. */
function gerarMigracao(regioes) {
	const updates = [...regioes]
		.map(([sigla, r]) => {
			const codigos = r.municipios
				.map((m) => m.ibge)
				.sort()
				.map((c) => `'${c}'`)
				.join(',');
			const lista = r.municipios
				.map((m) => m.nome)
				.sort((a, b) => a.localeCompare(b, 'pt-BR'))
				.join(', ');
			return `-- ${r.nome} — ${r.municipios.length} municípios:\n-- ${lista}.\nUPDATE \`municipios\` SET \`regiao_metropolitana\` = ${sq(sigla)}\n WHERE \`ibge\` IN (${codigos});`;
		})
		.join('\n--> statement-breakpoint\n');

	return `-- A REGIÃO METROPOLITANA de cada município do Ceará.
--
-- Gerado por \`node scripts/gerar-regioes-metropolitanas.mjs\` — não edite à mão.
-- Fonte: IBGE (\`/localidades/estados/23/regioes-metropolitanas\`), a mesma de
-- onde saem os nomes em \`municipios\`. Chaveado por CÓDIGO, nunca por nome.
--
-- Serve à vedação do Decreto nº 35.922/2024, art. 4º, §1º, II: deslocamento
-- DENTRO da mesma região metropolitana, até 120 km e sem extrapolação de
-- jornada, não gera diária. As três condições precisam ocorrer juntas, e a
-- terceira depende de horário — por isso o código ALERTA em vez de bloquear
-- (ver \`alertasDaViagem\` em \`$lib/diarias/vedacoes\`).
--
-- NULL é o estado da maioria: dos 184 municípios do Ceará, 46 estão em alguma
-- região. Fora delas a vedação não tem como se aplicar.
ALTER TABLE \`municipios\` ADD COLUMN \`regiao_metropolitana\` text;
--> statement-breakpoint
${updates}
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS \`idx_municipios_rm\` ON \`municipios\` (\`regiao_metropolitana\`);
`;
}

const regioes = await buscarRegioes();
const total = [...regioes.values()].reduce((s, r) => s + r.municipios.length, 0);
for (const [sigla, r] of regioes) {
	console.error(`[regioes] ${sigla}: ${r.municipios.length} municípios (${r.nome}).`);
}
if (regioes.size !== SIGLAS.size) {
	console.error(
		`⚠ esperava ${SIGLAS.size} regiões e vieram ${regioes.size} — confira antes de usar.`
	);
}

if (modoDiff) {
	const antes = anterior();
	if (!antes) {
		console.error('Não há composição no repositório para comparar. Rode sem --diff para gerar.');
		process.exit(1);
	}
	mostrarDiff(antes, regioes);
	process.exit(0);
}

writeFileSync(DESTINO, gerarMigracao(regioes));
console.error(`\n[regioes] ${DESTINO} — ${total} municípios em ${regioes.size} regiões.`);
