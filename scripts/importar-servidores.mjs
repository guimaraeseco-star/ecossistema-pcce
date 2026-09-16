/**
 * Carga da planilha de pessoal do DPI Sul (`Servidores.xlsx`) — fase 2-C.
 *
 * Decisão do responsável (16/09/2026): a carga é OFFLINE — uma foto da
 * planilha do Apps Script agora e outra na implantação. O caminho é o mesmo
 * do sincronizador online: cada linha vira um item do webhook
 * `POST /api/webhook/sync-policiais`, que faz o upsert por matrícula, cifra o
 * CPF com a chave do ambiente (o script NÃO consegue fazer isso: a chave
 * mora no Worker) e aplica o complemento da fase 2-C (designação, datas,
 * afastamento legado, titular da unidade). Reexecutar é seguro.
 *
 * O que a planilha decide e o que ela NÃO decide está em
 * `01-planos/Fase2C-Servidores-proposta.md`: núcleos fora (coluna SETOR
 * ignorada); STATUS não se importa — o evento vem de INÍCIO/TÉRMINO e a
 * situação é calculada por data; regime = "Plantão" na designação → plantão;
 * papel/senha/e-mail pessoal nunca saem daqui.
 *
 * Uso:
 *   node scripts/importar-servidores.mjs --planilha X.xlsx --relatorio [--local|--remote]
 *       lê, valida e imprime o relatório de divergências (com --local/--remote
 *       confere também as lotações e a AIS/subordinação contra o banco)
 *   node scripts/importar-servidores.mjs --planilha X.xlsx --enviar --local|--remote
 *       envia ao webhook em lotes; token de `.dev.vars` (local) ou de
 *       `C:\Ecossistema-PCCE\segredos\pages-producao.json` (remote) — nunca impresso
 *   node scripts/importar-servidores.mjs --planilha X.xlsx --conferir --local|--remote
 *       lista quem está no banco e NÃO está mais na planilha (não desativa ninguém)
 *   node scripts/importar-servidores.mjs --historico HISTORICO.xlsx --relatorio|--enviar --local|--remote
 *       a planilha de HISTÓRICO (SERVIDOR · MATRICULA · CARGO · STA · LOT ·
 *       OBSERVAÇÕES): casa cada linha com um servidor do banco pelo NÚCLEO da
 *       matrícula (7 primeiros dígitos depois de completar o zero à esquerda —
 *       a planilha tem "X" no lugar do último dígito e matrículas sem o zero),
 *       aceitando nome diferente só se o primeiro nome coincide, e pelo nome
 *       completo como último recurso; extrai os eventos do texto
 *       (`src/lib/servidores/historico-texto.ts`) e envia `somente_historico`.
 *       Quem não está no banco (desvinculados) NÃO entra — só no relatório.
 *   node scripts/importar-servidores.mjs --afastamentos afastamentos.xlsx --relatorio|--enviar --local|--remote
 *       a planilha DEDICADA de afastamentos (SERVIDOR · DATA INICIAL · DIAS ·
 *       DATA FINAL · TIPO · CID · TIPO · STATUS · NUP). Casa pelo NOME
 *       SANITIZADO (sem acento, pontuação nem partículas — ela não traz
 *       matrícula) e manda sobre o histórico no que for o mesmo afastamento
 *       (período sobreposto). O campo TIPO é livre e também traz pedidos de
 *       movimentação e recados: só o que é afastamento vira afastamento
 *       (`src/lib/servidores/afastamentos-planilha.ts`).
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
// O Node 24 lê TypeScript sem passo de build (type stripping); o módulo não
// importa nada de `$lib` justamente para poder ser usado daqui.
const { extrairHistorico } = await import('../src/lib/servidores/historico-texto.ts');
const { classificarTipoAfastamento, nomeSanitizado } =
	await import('../src/lib/servidores/afastamentos-planilha.ts');

const DB = 'escalas-db';
const SEGREDOS = 'C:/Ecossistema-PCCE/segredos';
const TAMANHO_LOTE = 40;
/**
 * Produção responde por trás do Cloudflare: lote menor e pausa entre eles.
 * O lote de HISTÓRICO é ainda menor — cada servidor traz dezenas de eventos e
 * o Worker faz um DELETE mais N INSERTs por item; com 20 por requisição o D1
 * estourava o tempo e devolvia 503 (carga de produção de 16/09/2026).
 */
const TAMANHO_LOTE_REMOTO = 20;
/**
 * O tamanho do lote pesado é REGULÁVEL por `LOTE_PESADO=n` porque o teto não é
 * fixo: ele cai à medida que a base cresce. Com a tabela vazia, 4 servidores
 * por requisição passavam; com 3,7 mil eventos já gravados, o mesmo lote passou
 * a estourar o tempo do Worker e voltar 503 (16/09/2026). Quem retoma uma carga
 * interrompida abaixa o número em vez de editar o script.
 */
const TAMANHO_LOTE_REMOTO_PESADO = Number(process.env.LOTE_PESADO) || 4;
const TENTATIVAS = 5;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── utilitários ────────────────────────────────────────────────────────── */

const txt = (v) => {
	if (v == null) return '';
	if (v instanceof Date) return v.toISOString().slice(0, 10);
	if (typeof v === 'object') {
		if (v.richText)
			return v.richText
				.map((t) => t.text)
				.join('')
				.trim();
		if (v.result !== undefined) return txt(v.result);
		if (v.text) return String(v.text).trim();
	}
	return String(v).replace(/\s+/g, ' ').trim();
};
const dataISO = (v) => {
	if (v instanceof Date) return v.toISOString().slice(0, 10);
	const s = txt(v);
	const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (br) return `${br[3]}-${br[2]}-${br[1]}`;
	return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};
const soDigitos = (s) => txt(s).replace(/\D/g, '');
const chave = (s) =>
	txt(s)
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toUpperCase();

/**
 * CONFERENCIA STATUS (+ descrição) → subtipo do catálogo. Fechado com o
 * responsável em 16/09/2026 a partir do Estatuto (Lei 12.124/93):
 * LICENÇA genérica = LTS; "acompanhar familiar/filho" = doença em pessoa da
 * família; ELEITORAL com cargo = mandato eletivo, sem descrição = outros;
 * APOSENTADORIA (aguardando) = outros; CURSO = estudante; folga/dispensa de
 * ponto = dispensa_ponto. Nada de tipo novo.
 */
function subtipoDe(conferencia, descricao, tipoStatus = '') {
	// Sem CONFERENCIA (5 linhas na foto de 16/09), vale o TIPO STATUS.
	const c =
		chave(conferencia) ||
		(chave(tipoStatus) === 'FERIAS' ? 'FERIAS' : chave(tipoStatus) === 'AFASTADO' ? 'OUTRO' : '');
	const d = chave(descricao);
	if (c === 'FERIAS') return 'ferias';
	if (c === 'LICENCA') {
		if (/ACOMPANH/.test(d) || /FAMILI|FILH/.test(d)) return 'acompanhamento_familiar';
		if (/MATERNIDADE|GESTANTE/.test(d)) return 'maternidade';
		if (/PATERNIDADE/.test(d)) return 'paternidade';
		return 'lts';
	}
	if (c === 'CEDIDO' || c === 'CESSAO') return 'cessao';
	if (c === 'INTERESSE PARTICULAR' || c === 'LIP') return 'lip';
	if (c === 'ELEITORAL')
		return /PREFEIT|VEREADOR|DEPUTADO|MANDATO|ELEITO/.test(d) ? 'mandato_eletivo' : 'outros';
	if (c === 'CURSO') return 'estudante';
	if (c === 'OUTRO' || c === 'OUTROS') {
		if (/DISPENSA DE PONTO|FOLGA/.test(d)) return 'dispensa_ponto';
		return 'outros';
	}
	if (c === 'APOSENTADORIA') return 'outros';
	return null;
}

/** Descrição que vai para o histórico quando a planilha não dá o motivo com nome próprio. */
function descricaoDe(conferencia, descricao) {
	const c = chave(conferencia);
	const d = txt(descricao);
	if (c === 'APOSENTADORIA' && !/APOSENTADORIA/i.test(d))
		return `Aguardando aposentadoria. ${d}`.trim();
	if (c === 'ELEITORAL' && !d) return 'Afastamento eleitoral (planilha, sem descrição)';
	return d;
}

const NUP_RE = /\d{5}\.\d{6}\/\d{4}-\d{2}/;

/* ── leitura ────────────────────────────────────────────────────────────── */

async function lerPlanilha(caminho) {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.readFile(caminho);
	const ws = wb.worksheets[0];
	const cab = ws
		.getRow(1)
		.values.slice(1)
		.map((v) => chave(v));
	const col = (nome) => {
		const i = cab.indexOf(chave(nome));
		if (i < 0) throw new Error(`coluna "${nome}" não está na planilha (aba ${ws.name})`);
		return i + 1;
	};
	const idx = {
		nome: col('SERVIDOR'),
		cargo: col('CARGO'),
		matricula: col('MATRÍCULA'),
		telefone: col('TELEFONE'),
		cpf: col('CPF'),
		classe: col('CLASSE'),
		lotacao: col('LOTAÇÃO'),
		designacao: col('DESIGNAÇÃO'),
		subordinacao: col('SUBORDINAÇÃO'),
		ais: col('AIS'),
		status: col('STATUS'),
		cargoAntigo: col('CARGO ANTIGO'),
		nascimento: col('NASCIMENTO'),
		posse: col('POSSE'),
		email: col('EMAIL'),
		inicio: col('INÍCIO'),
		periodo: col('PERÍODO'),
		termino: col('TÉRMINO'),
		tipoStatus: col('TIPO STATUS'),
		conferencia: col('CONFERENCIA STATUS'),
		descricao: col('DESCRIÇÃO DO AFASTAMENTO')
	};
	const linhas = [];
	ws.eachRow((r, i) => {
		if (i === 1) return;
		const c = (k) => r.getCell(idx[k]).value;
		if (!txt(c('nome')) && !txt(c('matricula'))) return; // linha em branco
		linhas.push({
			linha: i,
			nome: txt(c('nome')),
			cargo: chave(c('cargo')),
			matricula: soDigitos(c('matricula')),
			matriculaOriginal: txt(c('matricula')),
			telefone: txt(c('telefone')),
			cpf: txt(c('cpf')),
			classe: txt(c('classe')),
			lotacao: txt(c('lotacao')),
			designacao: txt(c('designacao')),
			subordinacao: txt(c('subordinacao')),
			ais: txt(c('ais')),
			status: chave(c('status')),
			cargoAntigo: chave(c('cargoAntigo')),
			nascimento: dataISO(c('nascimento')),
			posse: dataISO(c('posse')),
			email: txt(c('email')).toLowerCase(),
			inicio: dataISO(c('inicio')),
			periodo: Number(txt(c('periodo'))) || 0,
			termino: dataISO(c('termino')),
			tipoStatus: chave(c('tipoStatus')),
			conferencia: txt(c('conferencia')),
			descricao: txt(c('descricao'))
		});
	});
	return linhas;
}

/* ── validação e montagem do payload ────────────────────────────────────── */

function montar(linhas, unidadesDoBanco) {
	const itens = [];
	const divergencias = [];
	const vistas = new Map();
	const nomesUnidades = unidadesDoBanco ? new Set(unidadesDoBanco.map((u) => u.nome)) : null;
	const porNome = unidadesDoBanco ? new Map(unidadesDoBanco.map((u) => [u.nome, u])) : null;

	for (const l of linhas) {
		const id = `linha ${l.linha} (${l.matriculaOriginal || l.nome})`;
		if (!l.matricula) divergencias.push(`${id}: sem matrícula — não enviada`);
		if (!l.nome) divergencias.push(`${id}: sem nome — não enviada`);
		if (!['DPC', 'OIP'].includes(l.cargo))
			divergencias.push(`${id}: cargo "${l.cargo}" — não enviada`);
		if (!l.matricula || !l.nome || !['DPC', 'OIP'].includes(l.cargo)) continue;
		if (vistas.has(l.matricula)) {
			divergencias.push(
				`${id}: matrícula repetida (linha ${vistas.get(l.matricula)}) — segunda ignorada`
			);
			continue;
		}
		vistas.set(l.matricula, l.linha);

		if (nomesUnidades && !nomesUnidades.has(l.lotacao))
			divergencias.push(`${id}: lotação "${l.lotacao}" não existe no banco`);
		if (porNome) {
			const u = porNome.get(l.lotacao);
			if (u && l.ais && u.ais && chave(u.ais) !== chave(l.ais))
				divergencias.push(`${id}: AIS ${l.ais} na planilha, ${u.ais} na unidade ${l.lotacao}`);
			if (
				u &&
				l.subordinacao &&
				u.pai &&
				chave(u.pai) !== chave(l.subordinacao) &&
				chave(u.nome) !== chave(l.subordinacao)
			)
				divergencias.push(
					`${id}: subordinação "${l.subordinacao}" na planilha, "${u.pai}" na árvore`
				);
		}
		if (!l.email) divergencias.push(`${id}: sem e-mail (entra sem; o sistema pede no 1º acesso)`);
		if (l.cpf && soDigitos(l.cpf).length !== 11)
			divergencias.push(`${id}: CPF com ${soDigitos(l.cpf).length} dígitos`);

		// O evento de afastamento da linha.
		const afastamentos = [];
		if (l.inicio || l.termino || l.conferencia) {
			const subtipo = subtipoDe(l.conferencia, l.descricao, l.tipoStatus);
			if (!l.inicio || !l.termino) {
				divergencias.push(
					`${id}: ${l.tipoStatus || l.status || 'afastamento'} sem início/término — evento não enviado`
				);
			} else if (!subtipo) {
				divergencias.push(
					`${id}: CONFERENCIA STATUS "${l.conferencia}" desconhecida — evento não enviado`
				);
			} else {
				if (l.termino < l.inicio) {
					divergencias.push(
						`${id}: término ${l.termino} antes do início ${l.inicio} — evento não enviado`
					);
				} else {
					const esperado = new Date(
						Date.parse(l.inicio + 'T00:00:00Z') + (l.periodo - 1) * 86400000
					)
						.toISOString()
						.slice(0, 10);
					if (l.periodo && esperado !== l.termino)
						divergencias.push(
							`${id}: período ${l.periodo} d não fecha com ${l.inicio}→${l.termino} (esperado ${esperado}); enviado com as datas`
						);
					const nup = (l.descricao.match(NUP_RE) || [''])[0];
					afastamentos.push({
						subtipo,
						data_inicio: l.inicio,
						data_fim: l.termino,
						descricao: descricaoDe(l.conferencia, l.descricao).slice(0, 500),
						nup
					});
				}
			}
		} else if (['FERIAS', 'AFASTADO'].includes(l.status)) {
			divergencias.push(`${id}: STATUS ${l.status} sem datas — entra como ativo`);
		}

		itens.push({
			matricula: l.matricula,
			nome: l.nome,
			cargo: l.cargo,
			telefone: l.telefone,
			cpf: l.cpf,
			classe: l.classe,
			lotacao: l.lotacao,
			email: l.email,
			regime: chave(l.designacao) === 'PLANTAO' ? 'plantao' : 'expediente',
			cargo_anterior: ['IPC', 'EPC', 'DPC', 'OIP'].includes(l.cargoAntigo) ? l.cargoAntigo : '',
			data_nascimento: l.nascimento || null,
			data_posse: l.posse || null,
			designacao: l.designacao,
			afastamentos
		});
	}
	return { itens, divergencias };
}

/* ── banco (wrangler, sem shell) ────────────────────────────────────────── */

function wrangler(argsExtra) {
	return execFileSync(
		process.execPath,
		[join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...argsExtra],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
	);
}

function consultar(alvo, sql) {
	const saida = wrangler(['d1', 'execute', DB, alvo, '--json', '--command', sql]);
	return JSON.parse(saida.slice(saida.indexOf('[')))[0].results;
}

function unidadesDoBanco(alvo) {
	return consultar(
		alvo,
		'SELECT u.nome AS nome, u.ais AS ais, p.nome AS pai FROM unidades u LEFT JOIN unidades p ON p.id = u.seccional_id WHERE u.ativo = 1'
	);
}

/* ── envio ao webhook ───────────────────────────────────────────────────── */

function segredoDoAlvo(alvo) {
	if (alvo === '--local') {
		const vars = readFileSync('.dev.vars', 'utf8');
		const m = vars.match(/^SYNC_TOKEN=(.*)$/m);
		if (!m) throw new Error('SYNC_TOKEN não está em .dev.vars');
		return { base: 'http://localhost:5173', token: m[1].trim().replace(/^"|"$/g, '') };
	}
	const json = JSON.parse(readFileSync(join(SEGREDOS, 'pages-producao.json'), 'utf8'));
	if (!json.SYNC_TOKEN) throw new Error('SYNC_TOKEN não está em pages-producao.json');
	return {
		base: (json.APP_ORIGIN || 'https://dpisul.com.br').replace(/\/$/, ''),
		token: json.SYNC_TOKEN
	};
}

/**
 * POST com repetição: o Worker devolve 503/502 esporádico quando um lote pega
 * um isolate frio ou o D1 está ocupado (visto na carga de produção de
 * 16/09/2026, lote 9 de 18). Repetir é seguro — todas as rotas de carga fazem
 * upsert e regravam por marca.
 *
 * As opções vêm de uma FUNÇÃO, não de um objeto: o anti-replay do webhook
 * recusa nonce repetido (401), então cada tentativa precisa de timestamp e
 * nonce novos — reenviar os mesmos headers transformava o 503 em 401.
 */
async function postComRepeticao(url, montarOpcoes, rotulo) {
	let ultimo = '';
	for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
		try {
			const r = await fetch(url, montarOpcoes());
			const resposta = await r.json().catch(() => ({}));
			if (r.status === 200 || r.status === 422) return resposta;
			ultimo = `HTTP ${r.status} ${JSON.stringify(resposta).slice(0, 200)}`;
		} catch (e) {
			ultimo = String(e.message ?? e).slice(0, 200);
		}
		if (tentativa < TENTATIVAS) {
			const pausa = 5000 * tentativa;
			console.log(`  ${rotulo}: ${ultimo} — tentando de novo em ${pausa / 1000}s`);
			await espera(pausa);
		}
	}
	throw new Error(`${rotulo}: ${ultimo}`);
}

async function enviar(itens, alvo) {
	const { base, token } = segredoDoAlvo(alvo);
	let importadas = 0;
	const erros = [];
	const avisos = [];
	const extras = {
		historicoGravado: 0,
		historicoRepetido: 0,
		afastamentosGravados: 0,
		afastamentosSuprimidos: 0
	};
	// "Pesado" = carga de eventos (histórico/afastamentos), não de cadastro.
	const pesado = itens.some((i) => Array.isArray(i.historico) && i.historico.length > 0);
	const tamanho =
		alvo === '--remote'
			? pesado
				? TAMANHO_LOTE_REMOTO_PESADO
				: TAMANHO_LOTE_REMOTO
			: TAMANHO_LOTE;
	const total = Math.ceil(itens.length / tamanho);
	for (let i = 0; i < itens.length; i += tamanho) {
		const lote = itens.slice(i, i + tamanho);
		const body = JSON.stringify(lote);
		const assinatura = createHmac('sha256', token).update(body).digest('hex');
		let resposta;
		try {
			resposta = await postComRepeticao(
				`${base}/api/webhook/sync-policiais`,
				() => ({
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Hub-Signature-256': `sha256=${assinatura}`,
						'X-Webhook-Timestamp': String(Math.floor(Date.now() / 1000)),
						'X-Webhook-Nonce': randomBytes(16).toString('hex')
					},
					body
				}),
				`lote ${Math.floor(i / tamanho) + 1}`
			);
		} catch (e) {
			// Lote que não passou nem com as repetições NÃO aborta a carga: os
			// outros entram, o relatório final diz quais faltaram, e reexecutar o
			// comando conserta (tudo é upsert/regravação por marca).
			erros.push(String(e.message ?? e));
			console.log(`lote ${Math.floor(i / tamanho) + 1}/${total}: FALHOU — segue para o próximo`);
			if (alvo === '--remote') await espera(2000);
			continue;
		}
		importadas += resposta.imported ?? 0;
		erros.push(...(resposta.errors ?? []));
		avisos.push(...(resposta.warnings ?? []));
		extras.historicoGravado += resposta.historicoGravado ?? 0;
		extras.historicoRepetido += resposta.historicoRepetido ?? 0;
		extras.afastamentosGravados += resposta.afastamentosGravados ?? 0;
		extras.afastamentosSuprimidos += resposta.afastamentosSuprimidos ?? 0;
		console.log(
			`lote ${Math.floor(i / tamanho) + 1}/${total}: ${resposta.imported ?? 0}/${lote.length} importadas` +
				(resposta.failed ? `, ${resposta.failed} com erro` : '')
		);
		if (alvo === '--remote') await espera(400);
	}
	return { importadas, erros, avisos, extras };
}

/* ── planilha de HISTÓRICO ──────────────────────────────────────────────── */

const nucleoDe = (m) =>
	String(m ?? '')
		.replace(/\D/g, '')
		.padStart(8, '0')
		.slice(0, 7);
const nomeNorm = (s) => chave(s).replace(/\s+/g, ' ');

async function lerHistorico(caminho) {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.readFile(caminho);
	const ws = wb.worksheets[0];
	const cab = ws
		.getRow(1)
		.values.slice(1)
		.map((v) => chave(v));
	const col = (n) => {
		const i = cab.findIndex((c) => c.startsWith(chave(n)));
		if (i < 0) throw new Error(`coluna "${n}" não está na planilha de histórico`);
		return i + 1;
	};
	const idx = {
		nome: col('SERVIDOR'),
		matricula: col('MATRICULA'),
		sta: col('STA'),
		obs: col('OBSERVA')
	};
	const linhas = [];
	ws.eachRow((r, i) => {
		if (i === 1) return;
		const nome = txt(r.getCell(idx.nome).value);
		if (!nome) return;
		linhas.push({
			linha: i,
			nome,
			matricula: txt(r.getCell(idx.matricula).value),
			sta: chave(r.getCell(idx.sta).value),
			obs: txt(r.getCell(idx.obs).value)
		});
	});
	return linhas;
}

/** Casa cada linha do histórico com um servidor do banco; devolve itens e o relatório. */
function casarHistorico(linhas, base) {
	const porNucleo = new Map();
	for (const b of base) {
		const k = nucleoDe(b.matricula);
		(porNucleo.get(k) ?? porNucleo.set(k, []).get(k)).push(b);
	}
	const porNome = new Map(base.map((b) => [nomeNorm(b.nome), b]));
	const itens = [];
	const foraDaBase = [];
	const avisos = [];
	const stats = { afastamento: 0, movimentacao: 0, observacao: 0 };
	for (const l of linhas) {
		const nome = nomeNorm(l.nome);
		const cand = porNucleo.get(nucleoDe(l.matricula)) ?? [];
		let alvo = null;
		if (cand.length === 1) {
			const b = cand[0];
			const mesmoNome = nomeNorm(b.nome) === nome;
			const mesmoPrimeiro = nomeNorm(b.nome).split(' ')[0] === nome.split(' ')[0];
			if (mesmoNome || mesmoPrimeiro) {
				alvo = b;
				if (!mesmoNome)
					avisos.push(
						`linha ${l.linha}: nome difere do cadastro (matrícula igual) — "${l.nome}" × "${b.nome}"`
					);
			} else {
				avisos.push(`linha ${l.linha}: matrícula casa com OUTRA pessoa ("${b.nome}") — ignorada`);
			}
		}
		if (!alvo && porNome.has(nome)) {
			alvo = porNome.get(nome);
			avisos.push(`linha ${l.linha}: casada pelo NOME (matrícula "${l.matricula}" não bate)`);
		}
		if (!alvo) {
			foraDaBase.push(l);
			continue;
		}
		const historico = extrairHistorico(l.obs);
		for (const e of historico) stats[e.tipo]++;
		itens.push({ matricula: alvo.matricula, somente_historico: true, historico });
	}
	return { itens, foraDaBase, avisos, stats };
}

/* ── planilha de AFASTAMENTOS ───────────────────────────────────────────── */

async function lerAfastamentos(caminho) {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.readFile(caminho);
	const ws = wb.worksheets[0];
	const cab = ws
		.getRow(1)
		.values.slice(1)
		.map((v) => chave(v));
	const col = (n, obrigatoria = true) => {
		const i = cab.findIndex((c) => c.startsWith(chave(n)));
		if (i < 0 && obrigatoria) throw new Error(`coluna "${n}" não está na planilha de afastamentos`);
		return i + 1;
	};
	const idx = {
		nome: col('SERVIDOR'),
		inicio: col('DATA INICIAL'),
		dias: col('DIAS'),
		fim: col('DATA FINAL'),
		tipo: col('TIPO DE AFASTAMENTO'),
		status: col('STATUS'),
		nup: col('NUP')
	};
	const linhas = [];
	ws.eachRow((r, i) => {
		if (i === 1) return;
		const nome = txt(r.getCell(idx.nome).value);
		if (!nome) return;
		linhas.push({
			linha: i,
			nome,
			inicio: dataISO(r.getCell(idx.inicio).value),
			dias: Number(txt(r.getCell(idx.dias).value)) || 0,
			fim: dataISO(r.getCell(idx.fim).value),
			tipo: txt(r.getCell(idx.tipo).value),
			status: chave(r.getCell(idx.status).value),
			// Uma célula traz DOIS NUPs (em linhas separadas): o campo fica com o
			// primeiro, e o texto inteiro vai para a descrição.
			nup: (txt(r.getCell(idx.nup).value).match(NUP_RE) ?? [''])[0],
			nupTexto: txt(r.getCell(idx.nup).value).replace(/\s+/g, ' ').trim()
		});
	});
	return linhas;
}

/** Casa pelo nome sanitizado e converte cada linha no evento correspondente. */
function casarAfastamentos(linhas, base) {
	const porNome = new Map();
	for (const b of base) {
		const k = nomeSanitizado(b.nome);
		(porNome.get(k) ?? porNome.set(k, []).get(k)).push(b);
	}
	const porMatricula = new Map();
	const foraDaBase = [];
	const ambiguos = [];
	const semData = [];
	const stats = { afastamento: 0, movimentacao: 0, observacao: 0 };
	const porSubtipo = {};
	const naoAfastamento = new Map();
	for (const l of linhas) {
		const cand = porNome.get(nomeSanitizado(l.nome)) ?? [];
		if (cand.length === 0) {
			foraDaBase.push(l);
			continue;
		}
		if (cand.length > 1) {
			ambiguos.push(l);
			continue;
		}
		if (!l.inicio) {
			semData.push(l);
			continue;
		}
		const c = classificarTipoAfastamento(l.tipo);
		stats[c.destino]++;
		if (c.destino === 'afastamento') porSubtipo[c.subtipo] = (porSubtipo[c.subtipo] ?? 0) + 1;
		else naoAfastamento.set(chave(l.tipo), (naoAfastamento.get(chave(l.tipo)) ?? 0) + 1);
		const descricao = [
			l.tipo,
			l.dias ? `${l.dias} dia(s)` : '',
			l.status ? `(${l.status})` : '',
			l.nupTexto && l.nupTexto !== l.nup ? `NUP: ${l.nupTexto}` : ''
		]
			.filter(Boolean)
			.join(' · ')
			.slice(0, 500);
		const evento =
			c.destino === 'afastamento'
				? {
						tipo: 'afastamento',
						subtipo: c.subtipo,
						data_inicio: l.inicio,
						...(l.fim ? { data_fim: l.fim } : {}),
						descricao,
						...(l.nup ? { nup: l.nup } : {})
					}
				: {
						tipo: c.destino,
						data_evento: l.inicio,
						descricao,
						...(l.nup ? { nup: l.nup } : {})
					};
		const mat = cand[0].matricula;
		const item = porMatricula.get(mat) ?? {
			matricula: mat,
			somente_afastamentos: true,
			historico: []
		};
		item.historico.push(evento);
		porMatricula.set(mat, item);
	}
	return {
		itens: [...porMatricula.values()],
		foraDaBase,
		ambiguos,
		semData,
		stats,
		porSubtipo,
		naoAfastamento
	};
}

/* ── main ───────────────────────────────────────────────────────────────── */

async function main() {
	const args = process.argv.slice(2);
	const opc = (n) => {
		const i = args.indexOf(n);
		return i >= 0 ? args[i + 1] : null;
	};
	const alvo = args.includes('--remote') ? '--remote' : args.includes('--local') ? '--local' : null;

	const afastamentos = opc('--afastamentos');
	if (afastamentos) {
		if (!alvo)
			throw new Error('--afastamentos exige --local ou --remote (o casamento é contra o banco)');
		const base = consultar(alvo, 'SELECT matricula, nome FROM policiais WHERE ativo = 1');
		const linhas = await lerAfastamentos(afastamentos);
		const r = casarAfastamentos(linhas, base);
		console.log(
			`afastamentos: ${linhas.length} linhas → ${r.itens.length} servidores casados pelo nome sanitizado`
		);
		console.log(
			`classificação: ${r.stats.afastamento} afastamentos · ${r.stats.movimentacao} movimentações · ${r.stats.observacao} anotações`
		);
		console.log('  por subtipo: ' + JSON.stringify(r.porSubtipo));
		if (r.naoAfastamento.size) {
			console.log(`  textos que NÃO são afastamento (${r.naoAfastamento.size} distintos):`);
			for (const [t, n] of [...r.naoAfastamento].sort((a, b) => b[1] - a[1]).slice(0, 25))
				console.log(`    - ${t} (${n})`);
		}
		const porStatus = {};
		for (const l of r.foraDaBase)
			porStatus[l.status || '?'] = (porStatus[l.status || '?'] ?? 0) + 1;
		console.log(
			`fora do banco (não entram): ${r.foraDaBase.length} — ${JSON.stringify(porStatus)}`
		);
		for (const l of r.foraDaBase.filter(
			(f) => f.status !== 'EXONERADO' && f.status !== 'TRANSFERIDO'
		))
			console.log(`  - linha ${l.linha}: ${l.status} ${l.nome} (${l.tipo})`);
		for (const l of r.ambiguos)
			console.log(`  ! linha ${l.linha}: nome casa com MAIS DE UM servidor — ignorada: ${l.nome}`);
		for (const l of r.semData)
			console.log(`  ! linha ${l.linha}: sem data inicial — ignorada: ${l.nome} (${l.tipo})`);
		if (args.includes('--enviar')) {
			const env = await enviar(r.itens, alvo);
			console.log(
				`\nservidores processados: ${env.importadas}/${r.itens.length} · eventos gravados: ${env.extras.afastamentosGravados} · suprimidos do histórico (mesmo afastamento): ${env.extras.afastamentosSuprimidos}`
			);
			if (env.erros.length) {
				console.log(`erros (${env.erros.length}):`);
				for (const e of env.erros) console.log('  - ' + e);
				process.exitCode = 1;
			}
		}
		return;
	}

	const historico = opc('--historico');
	if (historico) {
		if (!alvo)
			throw new Error('--historico exige --local ou --remote (o casamento é contra o banco)');
		const base = consultar(alvo, 'SELECT matricula, nome FROM policiais WHERE ativo = 1');
		const linhas = await lerHistorico(historico);
		const { itens, foraDaBase, avisos, stats } = casarHistorico(linhas, base);
		console.log(
			`histórico: ${linhas.length} linhas → ${itens.length} servidores casados com o banco`
		);
		console.log(
			`eventos extraídos: ${stats.afastamento} afastamentos · ${stats.movimentacao} movimentações · ${stats.observacao} anotações`
		);
		const porSta = {};
		for (const l of foraDaBase) porSta[l.sta || '?'] = (porSta[l.sta || '?'] ?? 0) + 1;
		console.log(`fora do banco (não entram): ${foraDaBase.length} — ${JSON.stringify(porSta)}`);
		for (const l of foraDaBase.filter((f) => f.sta === 'ATIVO' || f.sta === 'AFASTADO'))
			console.log(`  - linha ${l.linha}: ${l.sta} ${l.nome} (matrícula "${l.matricula}")`);
		if (avisos.length) {
			console.log(`avisos (${avisos.length}):`);
			for (const a of avisos) console.log('  - ' + a);
		}
		if (args.includes('--enviar')) {
			const r = await enviar(itens, alvo);
			console.log(
				`\nservidores processados: ${r.importadas}/${itens.length} · eventos gravados: ${r.extras.historicoGravado} · repetidos (já existiam): ${r.extras.historicoRepetido}`
			);
			if (r.erros.length) {
				console.log(`erros (${r.erros.length}):`);
				for (const e of r.erros) console.log('  - ' + e);
				process.exitCode = 1;
			}
		}
		return;
	}

	const planilha = opc('--planilha');
	if (!planilha)
		throw new Error('informe --planilha, --historico ou --afastamentos <arquivo.xlsx>');

	const linhas = await lerPlanilha(planilha);
	const unidades = alvo ? unidadesDoBanco(alvo) : null;
	const { itens, divergencias } = montar(linhas, unidades);

	console.log(`planilha: ${linhas.length} linhas → ${itens.length} servidores a enviar`);
	const comEvento = itens.filter((i) => i.afastamentos.length).length;
	const titulares = itens.filter((i) =>
		['Delegado Titular', 'Delegado Seccional', 'Diretor de Departamento'].includes(i.designacao)
	).length;
	console.log(`eventos de afastamento: ${comEvento} · titulares de unidade: ${titulares}`);
	if (divergencias.length) {
		console.log(`\ndivergências (${divergencias.length}):`);
		for (const d of divergencias) console.log('  - ' + d);
	}

	if (args.includes('--conferir')) {
		if (!alvo) throw new Error('--conferir exige --local ou --remote');
		const noBanco = consultar(
			alvo,
			'SELECT matricula, nome, lotacao FROM policiais WHERE ativo = 1'
		);
		const naPlanilha = new Set(itens.map((i) => i.matricula));
		const sumiram = noBanco.filter((p) => !naPlanilha.has(p.matricula));
		console.log(`\nno banco e fora da planilha (${sumiram.length}) — NÃO desativados:`);
		for (const p of sumiram) console.log(`  - ${p.matricula} ${p.nome} (${p.lotacao})`);
	}

	if (args.includes('--enviar')) {
		if (!alvo) throw new Error('--enviar exige --local ou --remote');
		const r = await enviar(itens, alvo);
		console.log(`\nimportadas: ${r.importadas}/${itens.length}`);
		if (r.avisos.length) {
			console.log(`avisos (${r.avisos.length}):`);
			for (const a of r.avisos) console.log('  - ' + a);
		}
		if (r.erros.length) {
			console.log(`erros (${r.erros.length}):`);
			for (const e of r.erros) console.log('  - ' + e);
			process.exitCode = 1;
		}
	}
}

main().catch((e) => {
	console.error('ERRO:', e.message);
	process.exit(1);
});
