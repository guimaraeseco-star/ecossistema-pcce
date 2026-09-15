/**
 * Importa a planilha "DADOS DAS DELEGACIAS, MUNICIPIO.xlsx" (fase 2 do
 * Ecossistema, migrações 0085/0086): as unidades do departamento com a ficha
 * (endereço, telefone, e-mail, foto, AIS, tira-gravame, xadrezes), os
 * municípios atendidos com a cobertura, quem responde por cada um e quem faz o
 * plantão.
 *
 * Uso:
 *   node scripts/importar-delegacias-municipios.mjs --planilha <arquivo.xlsx> --sql <saida.sql>
 *       gera o SQL (idempotente) e o relatório; NÃO toca em banco nenhum
 *   node scripts/importar-delegacias-municipios.mjs --carga <saida.sql> --local
 *   node scripts/importar-delegacias-municipios.mjs --carga <saida.sql> --remote   # produção (um dia só: limite do D1)
 *       executa o SQL pelo wrangler em lotes de ~60 KB — o D1 recusa um arquivo
 *       de 270 KB inteiro com SQLITE_TOOBIG
 *   node scripts/importar-delegacias-municipios.mjs --fotos --local|--remote
 *       depois da carga: baixa cada foto do link, confere que abre (HTTP 200 e
 *       `image/*`), sobe ao R2 em `unidades/{id}/foto.<ext>` e grava `foto_key`;
 *       só trata quem ainda não tem cópia — pode rodar de novo à vontade
 *
 * ## Regras que a planilha impõe (decisões do responsável, 14/09/2026)
 *
 * - A aba `MUNICÍPIOS_LINk` é a única referência para delegacias e AIS. As
 *   linhas "Não se aplica" não são municípios: são as seccionais e o
 *   departamento, e entram só como dados de unidade.
 * - Município ↔ unidade é N:N (Juazeiro do Norte tem duas delegacias).
 * - "Unidade de Atendimento de X" é tipo `unidade`, subordinada à seccional.
 * - A "AIS DA DP" repete a AIS do município em cada linha; a unidade tem UMA
 *   AIS, e ela é a da linha do município-SEDE (Farias Brito = AIS 02, Russas =
 *   AIS 01). A AIS de cada município fica em `municipios_cobertura`.
 * - Os dados de unidade (endereço, telefone…) também vêm da linha-sede; uma
 *   linha de outro município com dados diferentes (Piquet Carneiro → DP de
 *   Mombaça) é ignorada e listada no relatório.
 * - Plantão da semana: colunas PLANTONISTA/TIPO DE PLANTÃO; fim de semana:
 *   aba `RESUMO DOS PLANTÕES` ("As mesmas" = igual à semana).
 * - `nome` da unidade é a chave (é como `policiais.lotacao` se liga): o SQL
 *   faz upsert por nome e nunca renomeia.
 *
 * O script PARA (exit 1) em erro de dado — IBGE inválido, unidade com mais de
 * uma seccional, plantonista desconhecido — e só AVISA no que a decisão já
 * cobriu. A carga em produção nunca é feita por ele: ele emite o SQL, e quem
 * executa é o wrangler, conscientemente.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

const args = process.argv.slice(2);
const opt = (nome) => {
	const i = args.indexOf(nome);
	return i >= 0 ? args[i + 1] : undefined;
};
const flag = (nome) => args.includes(nome);

const DEPARTAMENTO_PADRAO = 'Departamento de Polícia do Interior Sul';
const BUCKET = 'escalas-docs';
const DB = 'escalas-db';

/* ── utilidades ─────────────────────────────────────────────────────────── */

const txt = (v) => {
	if (v == null) return '';
	if (v.richText)
		return v.richText
			.map((t) => t.text)
			.join('')
			.trim();
	if (v.result !== undefined) return String(v.result).trim();
	if (typeof v === 'object' && v.text) return String(v.text).trim();
	return String(v).trim();
};
const num = (v) => {
	// Célula numérica chega como número (258.788 = km²): tirar o ponto dela
	// multiplicava a área por mil (corrigido nos dados pela migração 0087).
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	const s = txt(v).replace(/\./g, '').replace(',', '.');
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
};
const sql = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const chave = (s) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const TIPO_PLANTAO = {
	'plantao virtual': 'virtual',
	virtual: 'virtual',
	'plantao fisico': 'fisico',
	fisico: 'fisico',
	'plantao fisico misto': 'fisico_misto',
	'fisico misto': 'fisico_misto',
	'sem atendimento': 'sem_atendimento'
};

/** O tipo de unidade a partir do nome (regra do organograma, decisão do responsável). */
function tipoPeloNome(nome) {
	if (/^Departamento .* - /.test(nome)) return 'sub_departamento';
	if (/^Departamento /.test(nome)) return 'departamento';
	if (/Seccional/.test(nome)) return 'seccional';
	if (/^Unidade de Atendimento/.test(nome)) return 'unidade';
	return 'delegacia';
}

/**
 * A coluna PLANTONISTA pode trazer os DOIS plantonistas com a divisão entre
 * parênteses: "DP de Iguatu (noturno durante a semana…) e DP de Icó (durante
 * os finais de semana)". O primeiro é o da semana, o segundo o do fim de
 * semana; a aba RESUMO diz o mesmo e prevalece quando divergir.
 */
function plantonistasDe(texto) {
	const partes = texto
		.split(/\)\s+e\s+(?=\S)/)
		.map((t) => t.replace(/\s*\(.*$/, '').trim())
		.filter(Boolean);
	return { semana: partes[0] || '', fds: partes[1] || '' };
}

/**
 * A coluna FOTO traz um link do Drive ou um texto ("Sem sede temporariamente").
 * Só URL vira `foto_url`; um `/view` colado no fim do id (erro de cópia) sai.
 */
function urlDeFoto(texto) {
	if (!/^https?:\/\//i.test(texto)) return null;
	return texto.replace(/\/view\/?$/, '');
}

/** O município-sede a partir do nome da unidade ("… de Farias Brito" → "Farias Brito"). */
function sedePeloNome(nome) {
	// o ÚLTIMO " de ": "Delegacia de Polícia Civil de Alto Santo" → "Alto Santo"
	const m = nome.match(/.* de (.+)$/);
	return m ? m[1].trim() : '';
}

/* ── leitura ────────────────────────────────────────────────────────────── */

async function lerPlanilha(caminho) {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.readFile(caminho);
	const aba = (nome) => {
		const ws = wb.getWorksheet(nome);
		if (!ws) throw new Error(`aba "${nome}" não existe na planilha`);
		const cab = ws.getRow(1).values.slice(1).map(txt);
		const linhas = [];
		for (let r = 2; r <= ws.rowCount; r++) {
			const v = ws.getRow(r).values.slice(1);
			if (!v.some((x) => txt(x) !== '')) continue;
			linhas.push(Object.fromEntries(cab.map((c, i) => [c, v[i]])));
		}
		return linhas;
	};
	return {
		municipios: aba('MUNICÍPIOS_LINk'),
		plantoes: aba('RESUMO DOS PLANTÕES'),
		ibge: new Map(aba('municipiosbrasil').map((l) => [String(txt(l.codigo_ibge)), txt(l.nome)]))
	};
}

/* ── modelo ─────────────────────────────────────────────────────────────── */

function montar({ municipios, plantoes, ibge }) {
	const erros = [];
	const avisos = [];
	const unidades = new Map(); // nome → { tipo, pai, sede, ficha, linhasDeOutros }
	const cobertura = []; // por município
	const vinculos = []; // unidade ↔ município
	const plantaoSemana = new Map(); // municipio (chave) → { ibge, plantonista, tipo }

	const garantirUnidade = (nome, pai) => {
		if (!nome) return;
		if (!unidades.has(nome)) {
			unidades.set(nome, {
				nome,
				tipo: tipoPeloNome(nome),
				pai: pai || null,
				sede: sedePeloNome(nome),
				ficha: null,
				linhasDeOutros: []
			});
		} else if (pai && unidades.get(nome).pai && unidades.get(nome).pai !== pai) {
			erros.push(
				`unidade "${nome}" aparece com dois superiores: "${unidades.get(nome).pai}" e "${pai}"`
			);
		} else if (pai && !unidades.get(nome).pai) unidades.get(nome).pai = pai;
	};

	for (const l of municipios) {
		const municipio = txt(l['Municípios atendidos']);
		const codigo = txt(l['Código do Município']);
		const responsavel = txt(l['UNIDADE POLICIAL RESPONSÁVEL']);
		const seccional = txt(l['SECCIONAL']);
		const departamento = txt(l['DEPARTAMENTO']) || DEPARTAMENTO_PADRAO;
		const ehLinhaDeUnidade = chave(municipio) === 'nao se aplica';

		// A árvore: departamento → (subdepartamento) → seccional → unidade.
		garantirUnidade(departamento, null);
		let pai = departamento;
		if (seccional && seccional !== departamento) {
			garantirUnidade(seccional, departamento);
			pai = seccional;
		}
		if (responsavel !== pai) garantirUnidade(responsavel, pai);
		else if (responsavel === departamento) garantirUnidade(responsavel, null);

		const ficha = {
			endereco: txt(l['ENDEREÇO DA DP']),
			telefone: txt(l['TELEFONE DA DP']),
			email: txt(l['EMAIL DA DP']),
			foto_url: urlDeFoto(txt(l['FOTO'])),
			ais: txt(l['AIS DA DP']),
			tira_gravame: chave(txt(l['TIRA GRAVAME'])) === 'sim' ? 1 : 0,
			xadrezes: Math.max(0, Math.trunc(num(l['Nª DE XADREZES']) ?? 0))
		};
		const u = unidades.get(responsavel);
		const municipioBase = municipio.replace(/\s*-\s*\d+ª$/, ''); // "Juazeiro do Norte - 1ª"
		const ehSede = ehLinhaDeUnidade || (u.sede && chave(u.sede) === chave(municipioBase));
		if (ehSede && !u.ficha) u.ficha = { ...ficha, cidade: ehLinhaDeUnidade ? '' : municipioBase };
		else if (!ehSede) u.linhasDeOutros.push({ municipio, ficha });

		if (ehLinhaDeUnidade) continue;

		// O município
		if (!/^\d{7}$/.test(codigo)) {
			erros.push(`"${municipio}": código IBGE inválido (${codigo || 'vazio'})`);
			continue;
		}
		if (!ibge.has(codigo))
			erros.push(`"${municipio}": IBGE ${codigo} não está na aba municipiosbrasil`);
		const tipoPlantao = TIPO_PLANTAO[chave(txt(l['TIPO DE PLANTÃO']))];
		if (!tipoPlantao)
			erros.push(`"${municipio}": tipo de plantão desconhecido "${txt(l['TIPO DE PLANTÃO'])}"`);
		const { semana: plantonista, fds: plantonistaFds } = plantonistasDe(txt(l['PLANTONISTA']));

		if (!cobertura.some((c) => c.ibge === codigo)) {
			cobertura.push({
				ibge: codigo,
				nome: municipioBase,
				departamento,
				area_km2: num(l['Área territórial']),
				populacao_2022: num(l['População estimada - pessoas [2022]']),
				ais: txt(l['AIS DO MUNICÍPIO']),
				nucleo_custodia: txt(l['NUCLEO DE CUSTÓDIA DO MUNICÍPIO']),
				risp: txt(l['RISP']),
				comando_pm: txt(l['COMANDO PM']),
				batalhao_pm: txt(l['BATALHÃO PM']),
				batalhao_bm: txt(l['BATALHÃO BM']),
				companhia_bm: txt(l['COMPANHIA BM']),
				pefoce: txt(l['PEFOCE']),
				macrorregiao: txt(l['MACRO REGIÃO'])
			});
			plantaoSemana.set(chave(municipioBase), {
				ibge: codigo,
				plantonista,
				tipo: tipoPlantao,
				plantonistaFds
			});
		}
		vinculos.push({ unidade: responsavel, ibge: codigo });
	}

	// Plantonista precisa ser uma unidade da planilha — conferido DEPOIS do laço,
	// porque a unidade plantonista pode aparecer em linha posterior.
	for (const s of plantaoSemana.values()) {
		for (const nome of [s.plantonista, s.plantonistaFds]) {
			if (nome && !unidades.has(nome))
				erros.push(`IBGE ${s.ibge}: plantonista "${nome}" não é uma unidade da aba principal`);
		}
	}

	// Plantão de fim de semana: o que a coluna PLANTONISTA já disse entre
	// parênteses, e depois a aba RESUMO (que prevalece). Só o que DIFERE da
	// semana vira linha própria.
	const plantaoFds = new Map(); // ibge → { plantonista, tipo }
	for (const s of plantaoSemana.values()) {
		if (s.plantonistaFds && s.plantonistaFds !== s.plantonista) {
			plantaoFds.set(s.ibge, { plantonista: s.plantonistaFds, tipo: s.tipo });
		}
	}
	for (const l of plantoes) {
		const plantonista = txt(l['PLANTONISTA']).replace(/^2°/, '2ª');
		if (!plantonista) continue;
		if (!unidades.has(plantonista)) {
			erros.push(
				`RESUMO DOS PLANTÕES: plantonista "${plantonista}" não é uma unidade da aba principal`
			);
			continue;
		}
		const tipo = TIPO_PLANTAO[chave(txt(l['TIPO DE PLANTÃO']))];
		const fds = txt(l['PLANTÃO DE FINAL DE SEMANA']);
		if (!fds || chave(fds) === 'as mesmas') continue;
		for (const nome of fds
			.split(/,| e /)
			.map((s) => s.trim())
			.filter(Boolean)) {
			const sem = plantaoSemana.get(chave(nome));
			if (!sem) {
				avisos.push(
					`RESUMO DOS PLANTÕES: município "${nome}" (fds de ${plantonista}) não está na aba principal — ignorado`
				);
				continue;
			}
			if (sem.plantonista !== plantonista || (tipo && sem.tipo !== tipo)) {
				plantaoFds.set(sem.ibge, { plantonista, tipo: tipo || sem.tipo });
			}
		}
	}

	// Avisos: unidade sem linha-sede, linhas de outros municípios com dados próprios.
	for (const u of unidades.values()) {
		if (!u.ficha && u.linhasDeOutros.length) {
			u.ficha = { ...u.linhasDeOutros[0].ficha, cidade: '' };
			avisos.push(
				`"${u.nome}": sem linha do município-sede; ficha tirada da linha de "${u.linhasDeOutros[0].municipio}"`
			);
		}
		for (const o of u.linhasDeOutros) {
			const f = u.ficha;
			if (!f) continue;
			const dif = ['endereco', 'telefone', 'email', 'foto_url', 'tira_gravame'].filter(
				(k) => o.ficha[k] && o.ficha[k] !== f[k]
			);
			if (dif.length)
				avisos.push(
					`"${u.nome}": a linha de "${o.municipio}" traz ${dif.join(', ')} diferentes da sede — ignorados`
				);
		}
	}
	// Ordem topológica: pais antes dos filhos.
	const ordem = [];
	const visitar = (u) => {
		if (ordem.includes(u)) return;
		if (u.pai && unidades.get(u.pai)) visitar(unidades.get(u.pai));
		ordem.push(u);
	};
	for (const u of unidades.values()) visitar(u);

	return { erros, avisos, unidades: ordem, cobertura, vinculos, plantaoSemana, plantaoFds };
}

/* ── SQL ────────────────────────────────────────────────────────────────── */

function gerarSql(m) {
	const out = [];
	out.push('-- Gerado por scripts/importar-delegacias-municipios.mjs — idempotente (upsert).');
	out.push('PRAGMA foreign_keys = ON;');
	const idDe = (nome) => `(SELECT id FROM unidades WHERE nome = ${sql(nome)})`;

	for (const u of m.unidades) {
		const f = u.ficha ?? {
			endereco: '',
			telefone: '',
			email: '',
			foto_url: null,
			ais: '',
			tira_gravame: 0,
			xadrezes: 0,
			cidade: ''
		};
		const sigla =
			u.tipo === 'departamento' && u.nome === DEPARTAMENTO_PADRAO
				? 'DPI SUL'
				: u.tipo === 'sub_departamento'
					? 'DPI SUL - JUAZEIRO'
					: '';
		out.push(
			`INSERT INTO unidades (nome, tipo, seccional_id, cidade, sigla, endereco, telefone, email, foto_url, ais, tira_gravame, xadrezes)` +
				` VALUES (${sql(u.nome)}, ${sql(u.tipo)}, ${u.pai ? idDe(u.pai) : 'NULL'}, ${sql(f.cidade)}, ${sql(sigla)}, ${sql(f.endereco)}, ${sql(f.telefone)}, ${sql(f.email)}, ${sql(f.foto_url)}, ${sql(f.ais)}, ${f.tira_gravame}, ${f.xadrezes})` +
				` ON CONFLICT(nome) DO UPDATE SET tipo = excluded.tipo, seccional_id = excluded.seccional_id,` +
				` cidade = CASE WHEN excluded.cidade <> '' THEN excluded.cidade ELSE unidades.cidade END,` +
				` sigla = CASE WHEN excluded.sigla <> '' THEN excluded.sigla ELSE unidades.sigla END,` +
				` endereco = excluded.endereco, telefone = excluded.telefone, email = excluded.email,` +
				` foto_url = excluded.foto_url, ais = excluded.ais, tira_gravame = excluded.tira_gravame, xadrezes = excluded.xadrezes;`
		);
	}
	for (const c of m.cobertura) {
		out.push(
			`INSERT INTO municipios_cobertura (ibge, departamento_id, area_km2, populacao_2022, ais, nucleo_custodia, risp, comando_pm, batalhao_pm, batalhao_bm, companhia_bm, pefoce, macrorregiao)` +
				` VALUES (${sql(c.ibge)}, ${idDe(c.departamento)}, ${c.area_km2 ?? 'NULL'}, ${c.populacao_2022 ?? 'NULL'}, ${sql(c.ais)}, ${sql(c.nucleo_custodia)}, ${sql(c.risp)}, ${sql(c.comando_pm)}, ${sql(c.batalhao_pm)}, ${sql(c.batalhao_bm)}, ${sql(c.companhia_bm)}, ${sql(c.pefoce)}, ${sql(c.macrorregiao)})` +
				` ON CONFLICT(ibge) DO UPDATE SET departamento_id = excluded.departamento_id, area_km2 = excluded.area_km2, populacao_2022 = excluded.populacao_2022,` +
				` ais = excluded.ais, nucleo_custodia = excluded.nucleo_custodia, risp = excluded.risp, comando_pm = excluded.comando_pm, batalhao_pm = excluded.batalhao_pm,` +
				` batalhao_bm = excluded.batalhao_bm, companhia_bm = excluded.companhia_bm, pefoce = excluded.pefoce, macrorregiao = excluded.macrorregiao, updated_at = datetime('now', '-3 hours');`
		);
	}
	for (const v of m.vinculos) {
		out.push(
			`INSERT OR IGNORE INTO unidade_municipios (unidade_id, ibge, principal) VALUES (${idDe(v.unidade)}, ${sql(v.ibge)}, 1);`
		);
	}
	for (const s of m.plantaoSemana.values()) {
		const fds = m.plantaoFds.get(s.ibge) ?? s;
		for (const [periodo, p] of [
			['semana', s],
			['fds', fds]
		]) {
			out.push(
				`INSERT INTO plantao_cobertura (ibge, periodo, plantonista_unidade_id, tipo) VALUES (${sql(s.ibge)}, '${periodo}', ${p.plantonista ? idDe(p.plantonista) : 'NULL'}, ${sql(p.tipo)})` +
					` ON CONFLICT(ibge, periodo) DO UPDATE SET plantonista_unidade_id = excluded.plantonista_unidade_id, tipo = excluded.tipo;`
			);
		}
	}
	return out.join('\n') + '\n';
}

/* ── carga em lotes ─────────────────────────────────────────────────────── */

/**
 * O `wrangler d1 execute --file` manda o arquivo inteiro numa requisição, e o
 * D1 recusa acima de ~100 KB (SQLITE_TOOBIG). Cada instrução do SQL gerado
 * ocupa uma linha, então dividir por linhas é dividir por instrução.
 */
function carregar(arquivo, alvo) {
	const linhas = readFileSync(arquivo, 'utf8')
		.split(/\r?\n/)
		.filter((l) => l.trim());
	const lotes = [];
	let atual = [];
	let tamanho = 0;
	for (const l of linhas) {
		if (tamanho + l.length > 60_000 && atual.length) {
			lotes.push(atual);
			atual = [];
			tamanho = 0;
		}
		atual.push(l);
		tamanho += l.length;
	}
	if (atual.length) lotes.push(atual);
	const dir = join(tmpdir(), 'carga-delegacias');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	lotes.forEach((lote, i) => {
		const f = join(dir, `lote-${i + 1}.sql`);
		writeFileSync(f, lote.join(String.fromCharCode(10)) + String.fromCharCode(10));
		wrangler(['d1', 'execute', DB, alvo, '--file', f]);
		console.log(`lote ${i + 1}/${lotes.length}: ${lote.length} instruções`);
	});
}

/* ── fotos → R2 ─────────────────────────────────────────────────────────── */

function wrangler(argsExtra) {
	// Sem shell: no Windows o cmd.exe reinterpreta `<>` e aspas do SQL.
	return execFileSync(
		process.execPath,
		[join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...argsExtra],
		{
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
}

async function importarFotos(alvo) {
	const json = wrangler([
		'd1',
		'execute',
		DB,
		alvo,
		'--json',
		'--command',
		"SELECT id, nome, foto_url, foto_key FROM unidades WHERE foto_url IS NOT NULL AND foto_url <> '' AND foto_key IS NULL"
	]);
	const linhas = JSON.parse(json)[0].results;
	const dir = join(tmpdir(), 'fotos-unidades');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const falhas = [];
	let ok = 0;
	for (const u of linhas) {
		try {
			const r = await fetch(u.foto_url, { redirect: 'follow' });
			const tipo = r.headers.get('content-type') || '';
			if (!r.ok || !tipo.startsWith('image/')) {
				falhas.push(`${u.nome}: HTTP ${r.status} ${tipo} — ${u.foto_url}`);
				continue;
			}
			const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : 'jpg';
			const arquivo = join(dir, `${u.id}.${ext}`);
			writeFileSync(arquivo, Buffer.from(await r.arrayBuffer()));
			const key = `unidades/${u.id}/foto.${ext}`;
			wrangler([
				'r2',
				'object',
				'put',
				`${BUCKET}/${key}`,
				'--file',
				arquivo,
				'--content-type',
				tipo,
				alvo
			]);
			wrangler([
				'd1',
				'execute',
				DB,
				alvo,
				'--command',
				`UPDATE unidades SET foto_key = ${sql(key)} WHERE id = ${u.id}`
			]);
			ok++;
			console.log(`foto ok: ${u.nome} → ${key}`);
		} catch (e) {
			falhas.push(`${u.nome}: ${e.message}`);
		}
	}
	console.log(`\nfotos copiadas: ${ok}/${linhas.length}`);
	if (falhas.length) {
		console.log('não abriram (ficam só com a URL):');
		for (const f of falhas) console.log('  - ' + f);
	}
}

/* ── main ───────────────────────────────────────────────────────────────── */

(async () => {
	const alvo = flag('--remote') ? '--remote' : '--local';
	if (flag('--fotos')) {
		await importarFotos(alvo);
		return;
	}
	if (opt('--carga')) {
		carregar(opt('--carga'), alvo);
		return;
	}
	const planilha = opt('--planilha');
	const saida = opt('--sql');
	if (!planilha || !saida) {
		console.error('uso: --planilha <xlsx> --sql <saida.sql>  |  --fotos [--local|--remote]');
		process.exit(2);
	}
	const dados = await lerPlanilha(planilha);
	const m = montar(dados);
	console.log(
		`unidades: ${m.unidades.length} | municípios: ${m.cobertura.length} | vínculos: ${m.vinculos.length} | plantões fds diferentes: ${m.plantaoFds.size}`
	);
	for (const a of m.avisos) console.log('AVISO  ' + a);
	for (const e of m.erros) console.log('ERRO   ' + e);
	if (m.erros.length) {
		console.error(`\n${m.erros.length} erro(s) de dado — corrija a planilha; nada foi gerado.`);
		process.exit(1);
	}
	writeFileSync(saida, gerarSql(m));
	console.log(`\nSQL gravado em ${saida}`);
})();
