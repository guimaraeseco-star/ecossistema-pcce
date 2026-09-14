/**
 * Guard de CI: **toda operação material do servidor recusa alguém.**
 *
 * Operação material = handler de mutação de API (`POST`/`PUT`/`PATCH`/`DELETE`
 * em `+server.ts`) ou form action do SvelteKit. São 117 hoje, e a decisão de
 * autorização é tomada de treze formas diferentes — `requireAdmin`,
 * `exigirAdminGeral`, `isAdminGeral`, `verificarPermissaoEscala`, `resolverParticipacaoGisePolicial`,
 * comparação de lotação escrita à mão, além de preâmbulos locais a um arquivo
 * só (`autorizarAcao`, `carregarEscalaComPermissao`).
 *
 * Por isso o guard NÃO procura o nome de um helper: procuraria uma lista que
 * nunca está completa, e um handler novo com um resolvedor novo passaria batido
 * justamente por ser novo. Ele olha o RESULTADO observável, que é fechado:
 *
 *   nível 2 — recusa por PERMISSÃO (`fail(403)`, `forbidden()`, `requireAdmin`, `exigirAdminGeral`…)
 *   nível 1 — só exige SESSÃO (`fail(401)`, `unauthorized()`, `requireAuth`)
 *   nível 0 — não recusa ninguém
 *
 * Nível 0 e 1 existem legitimamente: login não tem sessão para exigir, trocar a
 * própria senha não tem segundo sujeito para autorizar, e webhook se autentica
 * por segredo compartilhado, não por cookie. O que o guard exige é que cada um
 * desses esteja DECLARADO abaixo com o motivo. A diferença entre "público de
 * propósito" e "esqueceram o guard" não está no código — só na cabeça de quem
 * escreveu. Aqui ela fica escrita.
 *
 * Reprova em três situações:
 *   1. operação nível 0/1 que não está na lista → gap novo;
 *   2. entrada da lista que virou nível 2 ou sumiu → lista velha mentindo;
 *   3. handler declarado que o parser não conseguiu ler → ponto cego.
 *
 * (3) é o que impede o guard de dar falso verde: rota que ele não enxerga é
 * rota que ele não protege, e silêncio não é aprovação.
 *
 * Uso: node scripts/guard-autorizacao.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lista rotas de mutação sem `find` Unix — no Windows o `FIND.EXE` nativo
 * interpreta a mesma linha e quebra o guard (FLW-AUT nota operacional).
 */
function listarArquivosMutacao(raizRoutes) {
	const saida = [];
	function andar(dir) {
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, ent.name);
			if (ent.isDirectory()) {
				if (ent.name === '_actions') {
					for (const f of readdirSync(full, { withFileTypes: true })) {
						// Só os módulos de form action. `shared.ts` / `desfecho.ts` não
						// exportam mutação.
						if (f.isFile() && f.name.startsWith('actions-') && f.name.endsWith('.ts')) {
							saida.push(relative('.', join(full, f.name)).replaceAll('\\', '/'));
						}
					}
				} else {
					andar(full);
				}
				continue;
			}
			if (ent.name === '+server.ts' || ent.name === '+page.server.ts') {
				saida.push(relative('.', full).replaceAll('\\', '/'));
			}
		}
	}
	andar(raizRoutes);
	return saida.sort();
}

/**
 * Operações que legitimamente NÃO recusam por permissão, com o motivo.
 * Chave: `<arquivo> → <nome>`.
 *
 * Encolher esta lista é progresso. Crescer, sem um motivo desta natureza, é o
 * que o guard existe para pegar.
 *
 * Exportada porque `e2e/autorizacao-negativa.spec.ts` a consome: o teste que
 * exige 401 de todo mutador anônimo precisa saber exatamente quais rotas são
 * públicas de propósito. Duas listas divergiriam — e a que divergisse em
 * silêncio seria a do teste.
 */
export const DECLARADAS = {
	// ---- Pré-autenticação: não há sessão para exigir ----
	'src/routes/api/auth/login/+server.ts → POST': 'login: cria a sessão',
	'src/routes/api/auth/logout/+server.ts → POST': 'logout: destrói a própria sessão',
	'src/routes/api/auth/reenviar-codigo/+server.ts → POST': 'reenvia o 2FA do login em curso',
	'src/routes/api/auth/solicitar-redefinicao/+server.ts → POST': 'esqueci a senha: sem sessão',
	'src/routes/api/auth/confirmar-redefinicao/+server.ts → POST':
		'redefinição por token de uso único; o token É a credencial',
	'src/routes/api/auth/certificado/iniciar/+server.ts → POST':
		'desafio de login por Token A3: antes de saber quem é',
	'src/routes/login/+page.server.ts → login': 'login: cria a sessão',
	'src/routes/login/+page.server.ts → solicitarPrimeiroAcesso': 'primeiro acesso: antes da senha',
	'src/routes/redefinir-senha/+page.server.ts → redefinir':
		'redefinição por token de uso único; o token É a credencial',

	// ---- Autosserviço: o recurso é o próprio usuário, não há segundo sujeito ----
	'src/routes/aceitar-termo/+page.server.ts → aceitar': 'aceita o próprio termo de uso',
	'src/routes/alterar-senha/+page.server.ts → alterar': 'troca a própria senha (confere a atual)',
	'src/routes/alterar-senha/+page.server.ts → sair':
		'logout: destrói a própria sessão (primeiro acesso sem sidebar)',
	// `/perfil` não tem mais form action: pedir correção do cadastro virou ato do
	// administrador da unidade/seccional, na ficha do servidor. O que sobrou na
	// página (e-mail pessoal, passkey) vai por API, e cada uma dessas rotas já
	// está declarada aqui por conta própria.
	'src/routes/api/auth/solicitar-codigo-assinatura/+server.ts → POST':
		'envia o código 2FA para o e-mail do próprio usuário logado',
	// As rotas do TITULAR (LGPD, reautenticação de assinatura, passkey própria)
	// saíram desta lista em set/2026: com a terceira identidade, elas passaram a
	// recusar COLABORADOR por `requireAuthComCadastro` — quem não tem cadastro
	// não tem passkey, e-mail pessoal nem cerimônia de assinatura. A credencial
	// continua sendo sempre a de `credencialDoUsuario(u)`, nunca um id vindo do
	// corpo: registrar passkey PARA OUTRA PESSOA segue sendo operação que não
	// existe (Lei 14.063/2020 art. 4º II "b" — controle exclusivo).

	// ---- Webhook: autenticado por segredo compartilhado + HMAC, não por sessão ----
	'src/routes/api/webhook/limpeza-retencao/+server.ts → POST': 'segredo compartilhado (cron)',
	'src/routes/api/webhook/reset-policiais/+server.ts → POST':
		'segredo compartilhado + 2ª credencial de reset',
	'src/routes/api/webhook/sync-policiais/+server.ts → POST': 'segredo compartilhado (Apps Script)',
	'src/routes/api/webhook/sync-unidades/+server.ts → POST': 'segredo compartilhado (Apps Script)'
};

/**
 * Rotas de API que o ANÔNIMO pode alcançar. Pergunta diferente da de
 * `DECLARADAS`, e a diferença já produziu confusão uma vez:
 *
 * - `DECLARADAS` responde "esta operação recusa alguém por permissão?";
 * - `PUBLICAS` responde "quem ainda não tem sessão pode bater aqui?".
 *
 * `verificar-2fa` e `certificado/verificar` respondem SIM às duas: recusam o
 * código errado com 403 (por isso ficam fora de `DECLARADAS`) e existem
 * justamente para quem ainda não tem sessão. Fundir as listas classificaria uma
 * das duas errado.
 *
 * Consumida por `e2e/autorizacao-negativa.spec.ts`, que exige 401/403 de todo
 * mutador anônimo fora desta lista.
 */
export const PUBLICAS = [
	'src/routes/api/auth/login/+server.ts',
	'src/routes/api/auth/logout/+server.ts',
	'src/routes/api/auth/reenviar-codigo/+server.ts',
	'src/routes/api/auth/verificar-2fa/+server.ts',
	'src/routes/api/auth/solicitar-redefinicao/+server.ts',
	'src/routes/api/auth/confirmar-redefinicao/+server.ts',
	'src/routes/api/auth/certificado/iniciar/+server.ts',
	'src/routes/api/auth/certificado/verificar/+server.ts',
	// Telas de login e de redefinição por link: as form actions são o próprio
	// caminho de quem ainda não tem sessão.
	'src/routes/login/+page.server.ts',
	'src/routes/redefinir-senha/+page.server.ts'
];

/**
 * Além do "há um 403", a operação TEM de citar o helper certo (FLW-AUT-001 /
 * FLW-AUT-010 / 002 / 006 / 009). O guard de nível só pega "recusa alguém";
 * esta lista pega "recusa com a regra errada" quando alguém troca
 * `podeAssinarEscala` por `verificarPermissaoEscala` (ainda 403, ACL de leitura).
 *
 * Chave = caminho do arquivo → todas as operações daquele arquivo.
 * Chave = `arquivo → nome` → só aquela operação (ganha da chave de arquivo).
 * Valor = nomes aceitos (basta UM no CORPO do handler — import no preâmbulo
 * não conta; era assim que o arquivo inteiro passava com o helper numa action
 * só).
 *
 * Em membros/equipe, os wrappers já invocam `carregarGiseEditavel`.
 *
 * Lista FECHADA das regressões conhecidas: crescer só com achado novo.
 */
export const HELPERS_OBRIGATORIOS = {
	// FLW-AUT-001 — assinar escala é DPC admin, não "mesma lotação".
	// As cinco rotas de assinatura entram por `carregarEscalaParaAssinatura`, que
	// encapsula ACL + `podeAssinarEscala` + FDS + documento já assinado. Exigir o
	// nome do PORTÃO, e não o de `podeAssinarEscala`, é o que impede a rota de
	// montar o gate à mão de novo — foi a cópia à mão que perdeu o FDS numa delas.
	'src/routes/api/escalas/[id]/assinar-simples/+server.ts': ['carregarEscalaParaAssinatura'],
	'src/routes/api/escalas/[id]/preparar-assinatura/+server.ts': ['carregarEscalaParaAssinatura'],
	'src/routes/api/escalas/[id]/finalizar-assinatura/+server.ts': ['carregarEscalaParaAssinatura'],
	'src/routes/api/escalas/[id]/preparar-assinatura-avancada/+server.ts': [
		'carregarEscalaParaAssinatura'
	],
	'src/routes/api/escalas/[id]/finalizar-assinatura-avancada/+server.ts': [
		'carregarEscalaParaAssinatura'
	],
	// Revogar não passa pelo portão (não há o que conflitar): gate direto.
	'src/routes/api/escalas/[id]/documento-assinado/+server.ts': ['podeAssinarEscala'],

	// FLW-AUT-010 — assinar GISE é o supervisor DESIGNADO, e só em status que
	// admite assinatura. Admin Geral não assina (a UI nunca ofereceu; as cópias
	// que aceitavam `u.tipo === 'admin'` foram unificadas no portão). As cinco
	// rotas entram pelo mesmo portão. Exigir o nome do portão é o que impede
	// remontá-lo à mão.
	'src/routes/api/gise/[id]/assinar-simples/+server.ts': ['carregarGiseParaAssinatura'],
	'src/routes/api/gise/[id]/preparar-assinatura/+server.ts': ['carregarGiseParaAssinatura'],
	'src/routes/api/gise/[id]/finalizar-assinatura/+server.ts': ['carregarGiseParaAssinatura'],
	'src/routes/api/gise/[id]/preparar-assinatura-avancada/+server.ts': [
		'carregarGiseParaAssinatura'
	],
	'src/routes/api/gise/[id]/finalizar-assinatura-avancada/+server.ts': [
		'carregarGiseParaAssinatura'
	],

	// Relatório extraordinário: só o supervisor DESIGNADO. As cinco rotas da
	// família aceitavam `u.tipo === 'admin'` e nenhuma tela oferecia isso — a
	// sessão de admin não tem CPF nem matrícula, então o documento sairia com a
	// identidade que o cliente mandasse. Removido em ago/2026, como já se tinha
	// feito no portão da escala GISE.
	//
	// As três AVANÇADAS entram por `carregarRelatorioExtraParaAssinatura`; exigir
	// o nome aqui é o que impede remontar o gate à mão. O par QUALIFICADO usa
	// outro loader e valida seccional/saída pela intenção, então mantém o gate
	// no corpo — quem garante que os cinco concordam é o teste que os nomeia
	// junto, em `e2e/relatorio-extra-gise.spec.ts`.
	'src/routes/api/gise/[id]/relatorios/[seccionalId]/assinar/+server.ts': [
		'carregarRelatorioExtraParaAssinatura'
	],
	'src/routes/api/gise/[id]/relatorios/[seccionalId]/preparar-assinatura-avancada/+server.ts': [
		'carregarRelatorioExtraParaAssinatura'
	],
	'src/routes/api/gise/[id]/relatorios/[seccionalId]/finalizar-assinatura-avancada/+server.ts': [
		'carregarRelatorioExtraParaAssinatura'
	],

	// FLW-AUT-010 — GISE `finalizada` não muta pela porta dos fundos
	'src/routes/gise/[id]/_actions/actions-escala.ts': ['carregarGiseEditavel'],
	'src/routes/gise/[id]/_actions/actions-escala.ts → reabrirEscala': ['exigirAdminGeral'],
	'src/routes/gise/[id]/_actions/actions-escala.ts → excluirGise': ['exigirAdminGeral'],
	'src/routes/gise/[id]/_actions/actions-escala.ts → reenviarBaseEquipePlanilha': [
		'exigirAdminGeral'
	],
	'src/routes/gise/[id]/_actions/actions-seccional.ts': ['carregarGiseEditavel'],
	'src/routes/gise/[id]/_actions/actions-membros.ts': [
		'carregarGiseEditavel',
		'carregarMembroDaGise',
		'carregarSeccionalDaGise',
		'carregarEquipeDaGise'
	],
	'src/routes/gise/[id]/_actions/actions-equipe.ts': [
		'carregarEquipeDaGise',
		'carregarSeccionalDaGise'
	],
	'src/routes/gise/[id]/_actions/actions-unidade.ts': ['carregarSeccionalDaGise'],

	// PLANO OPERACIONAL: um portão só (`carregarPlanoParaEdicao`) decide quem
	// mexe no plano, e as duas conferências de posse provam que o id vindo do
	// FORMULÁRIO pertence ao plano da URL. Exigir o nome aqui é o que impede uma
	// action nova de se contentar com `isAdminGeral` e aceitar equipe de outro
	// plano por POST direto — a classe do FLW-ESC-002.
	'src/routes/gise/planos/+page.server.ts': ['carregarPlanoParaEdicao'],

	// O editor: cada action entra pelo preâmbulo do seu assunto. As que recebem
	// um id de equipe ou de membro pelo FORMULÁRIO usam o preâmbulo que PROVA a
	// posse — `planoDaRota` sozinho autorizaria o plano e deixaria a equipe de
	// outro plano passar.
	'src/routes/gise/planos/[id]/_actions/actions-plano.ts': ['planoDaRota'],
	'src/routes/gise/planos/[id]/_actions/actions-equipe.ts': ['planoDaRota', 'equipeDaRota'],
	'src/routes/gise/planos/[id]/_actions/actions-membros.ts': ['equipeDaRota', 'membroDaRota'],

	// FLW-AUT-002 / 009 — lotação do FormData no escopo administrado
	'src/routes/escalas/+page.server.ts → criarComBase': ['lotacaoNoEscopo'],
	'src/routes/escalas/+page.server.ts → excluir': ['lotacaoNoEscopo'],

	// FLW-ESC-003 — escala assinada/finalizada não muda de composição, e a
	// restrição por lotação vale mesmo para o DPC que já pode LER e ASSINAR.
	// As duas regras moram só em `carregarEscalaComPermissao`.
	'src/routes/escalas/[id]/_actions/actions-composicao.ts': ['carregarEscalaComPermissao'],
	'src/routes/escalas/[id]/_actions/actions-datas.ts': ['carregarEscalaComPermissao'],
	'src/routes/escalas/[id]/_actions/actions-ciclo.ts': ['carregarEscalaComPermissao'],
	'src/routes/escalas/[id]/_actions/actions-projecao.ts': ['carregarEscalaComPermissao'],

	// Ficha do servidor: o escopo é conferido contra o ALVO, cujo id chega pela
	// URL. `carregarFichaDoPolicial` é o único lugar que decide (a) se o usuário
	// administra aquele servidor e (b) se ele EXECUTA ou apenas SOLICITA. Exigir
	// o nome do portão, e não um 403 qualquer, é o que impede uma das actions de
	// remontar o gate à mão e cair no modo errado — que aqui significa um admin
	// de unidade movimentando servidor sem passar pelo Admin Geral.
	'src/routes/servidores/[id]/+page.server.ts → salvar': ['carregarFichaDoPolicial'],
	'src/routes/servidores/[id]/+page.server.ts → solicitarAlteracao': ['carregarFichaDoPolicial'],
	'src/routes/servidores/[id]/+page.server.ts → registrarMovimentacao': ['carregarFichaDoPolicial'],
	'src/routes/servidores/[id]/+page.server.ts → registrarAfastamento': ['carregarFichaDoPolicial'],
	'src/routes/servidores/[id]/+page.server.ts → registrarDesvinculacao': ['carregarFichaDoPolicial'],

	// FLW-AUT-006 / 007 — presença: janela de horário + GISE não finalizada.
	// `gateDePresenca` mora dentro de `prepararConfirmacaoPresenca` (preparo
	// comum extraído de salvarEntrada/salvarSaida em ago/2026) — o corpo das
	// duas actions chama o preparo, não o gate direto.
	'src/routes/res-gise/+page.server.ts → salvarEntrada': ['prepararConfirmacaoPresenca'],
	'src/routes/res-gise/+page.server.ts → salvarSaida': ['prepararConfirmacaoPresenca'],
	'src/routes/api/gise/[id]/presenca/preparar-assinatura/+server.ts': ['gateDePresenca'],
	'src/routes/api/gise/[id]/presenca/finalizar-assinatura/+server.ts': ['gateDePresenca']
};

/** Nomes aceitos para uma operação: chave específica ganha da chave de arquivo. */
function helpersDaOperacao(arquivo, nome) {
	const chaveOp = `${arquivo} → ${nome}`;
	if (Object.hasOwn(HELPERS_OBRIGATORIOS, chaveOp)) return HELPERS_OBRIGATORIOS[chaveOp];
	if (Object.hasOwn(HELPERS_OBRIGATORIOS, arquivo)) return HELPERS_OBRIGATORIOS[arquivo];
	return null;
}

// `exigirAdminGeral` é o requireAdmin das form actions GISE: devolve
// `fail(403)` no helper, não no corpo. Sem o nome aqui, extrair o 403
// (achado 2.1) deixava o guard cego — "não recusa ninguém" com o POST
// já morrendo no servidor.
//
// `carregarEscalaComPermissao` é o mesmo caso, em `/escalas/[id]`: devolve
// `{ erro: fail(403) }` e a action só repassa. Enquanto as catorze viviam em
// `+page.server.ts` o 403 entrava pelo PREÂMBULO — o helper estava definido
// acima delas, no mesmo arquivo —, e por isso todas passavam mesmo que uma
// esquecesse de chamá-lo. Com as actions em `_actions/`, o preâmbulo não
// carrega mais o helper, e o par nome-aqui + HELPERS_OBRIGATORIOS abaixo passa
// a exigir a chamada no corpo de CADA uma.
//
// `carregarPlanoParaEdicao` é o portão do PLANO OPERACIONAL, e segue o mesmo
// desenho: devolve a `Response` de recusa (403 de quem não é Admin Geral, 404
// de plano inexistente) e a action repassa com `fail(acesso.status, …)`. O
// status vem de variável, então o `fail(403)` literal nunca aparece no corpo —
// sem o nome aqui, o guard leria "não recusa ninguém" com o POST já morrendo no
// servidor.
//
// `planoDaRota` / `equipeDaRota` / `membroDaRota` são os PREÂMBULOS do editor
// (`/gise/planos/[id]/_actions/shared.ts`): cada um chama o portão acima e, nos
// dois últimos, ainda amarra o id vindo do FORMULÁRIO ao plano da URL. É por
// eles que as nove actions do editor entram, e é o nome deles que
// `HELPERS_OBRIGATORIOS` exige no corpo de cada uma — exigir só
// `carregarPlanoParaEdicao` deixaria passar uma action que carregasse o plano e
// esquecesse de provar a posse da equipe (a classe do FLW-ESC-002).
const RE_403 =
	/fail\(403|forbidden\(|status:\s*403|error\(403|requireAdmin\(|requireSuperAdmin\(|requireAuthComCadastro\(|exigirAdminGeral\(|carregarEscalaComPermissao\(|carregarEscalaParaAssinatura\(|carregarGiseParaAssinatura\(|carregarRelatorioExtraParaAssinatura\(|carregarFichaDoPolicial\(|carregarPlanoParaEdicao\(|planoDaRota\(|equipeDaRota\(|membroDaRota\(/;
const RE_401 = /fail\(401|unauthorized\(|requireAuth\(|error\(401/;

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

/**
 * A varredura e o veredito. Fica numa função porque
 * `e2e/autorizacao-negativa.spec.ts` importa as listas deste arquivo — e um
 * `process.exit(1)` disparado no import mataria o worker do Playwright, com o
 * erro aparecendo como falha do teste errado.
 */
function principal() {
	const arquivos = listarArquivosMutacao(resolve('src/routes'));

	const operacoes = [];
	/** Contagem frouxa das DECLARAÇÕES, para conferir contra o que foi lido. */
	let declaradas = 0;

	for (const arquivo of arquivos) {
		const src = readFileSync(arquivo, 'utf8');
		declaradas += [...src.matchAll(/export const (?:POST|PUT|PATCH|DELETE)\b/g)].length;
		// `: async` só é form action. Em `+server.ts` o mesmo padrão aparece em
		// callback interno (`gerarRascunho: async () =>` em documento-assinado) e
		// o parser não lê esses — contar inflava o total e disparava ponto cego.
		if (/export const actions\w*\b/.test(src)) {
			declaradas += [...src.matchAll(/^\s+([a-zA-Z][\w]*): async/gm)].length;
		}

		// O preâmbulo (helpers acima do primeiro handler) conta: é onde moram
		// `autorizarAcao` e `carregarEscalaComPermissao`, cujo `fail(403)` vale para
		// todas as actions que os chamam. `actions\w*` pega `actionsEquipe` etc.
		const iPrimeiro = src.search(/export const (?:actions\w*|POST|PUT|PATCH|DELETE)\b/);
		const preambulo = iPrimeiro > 0 ? src.slice(0, iPrimeiro) : '';

		for (const m of src.matchAll(/export const (POST|PUT|PATCH|DELETE)[^=]*=\s*async\s*\(/g)) {
			const iAbre = src.indexOf('{', src.indexOf('=>', m.index));
			operacoes.push({
				arquivo,
				nome: m[1],
				corpo: blocoBalanceado(src, iAbre),
				preambulo
			});
		}

		const decl = src.match(/export const (?:actions\w*)[^=]*=\s*\{/);
		if (decl) {
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
						operacoes.push({ arquivo, nome: nm[1], corpo, preambulo });
						i = iAbre + corpo.length - 1;
						profundidade = 1;
					}
				}
			}
		}
	}

	const problemas = [];

	// (3) Ponto cego: declaração que o parser não leu.
	if (operacoes.length !== declaradas) {
		problemas.push({
			arquivo: 'scripts/guard-autorizacao.mjs',
			msg:
				`o parser leu ${operacoes.length} operações, mas há ${declaradas} declaradas — ` +
				'alguma escapou. Rota que o guard não enxerga é rota que ele não protege; ' +
				'ajuste o parser antes de confiar neste resultado'
		});
	}

	const vistas = new Set();
	for (const op of operacoes) {
		const chave = `${op.arquivo} → ${op.nome}`;
		const visivel = op.corpo + op.preambulo;
		const nivel = RE_403.test(visivel) ? 2 : RE_401.test(visivel) ? 1 : 0;
		if (nivel === 2) {
			// (2) Promovida a nível 2 e ainda na lista: a lista mente.
			if (chave in DECLARADAS) {
				problemas.push({
					arquivo: op.arquivo,
					msg: `"${op.nome}" agora recusa por permissão — remova a dispensa de DECLARADAS`
				});
			}
			continue;
		}
		vistas.add(chave);
		// (1) Gap novo.
		if (!(chave in DECLARADAS)) {
			problemas.push({
				arquivo: op.arquivo,
				msg:
					`"${op.nome}" ${nivel === 0 ? 'não recusa ninguém' : 'só exige sessão'} — ` +
					'autorize a operação ou declare o motivo em scripts/guard-autorizacao.mjs'
			});
		}
	}

	// (2) Entrada da lista que não corresponde a operação nenhuma.
	for (const chave of Object.keys(DECLARADAS)) {
		if (!vistas.has(chave)) {
			problemas.push({
				arquivo: chave.split(' → ')[0],
				msg: `dispensa obsoleta em DECLARADAS: "${chave}" não existe mais`
			});
		}
	}

	// Idem para PUBLICAS: rota pública que sumiu deixaria o spec de autorização
	// negativa dispensando um alvo que não existe — e um alvo a menos exercitado.
	const arquivosVistos = new Set(operacoes.map((o) => o.arquivo));
	for (const arquivo of PUBLICAS) {
		if (!arquivosVistos.has(arquivo)) {
			problemas.push({
				arquivo,
				msg: `rota pública obsoleta em PUBLICAS: "${arquivo}" não existe mais`
			});
		}
	}

	// Helper certo no CORPO (não só "tem 403" / não só import no arquivo).
	const chavesOp = new Set(operacoes.map((o) => `${o.arquivo} → ${o.nome}`));
	for (const chave of Object.keys(HELPERS_OBRIGATORIOS)) {
		if (chave.includes(' → ')) {
			if (!chavesOp.has(chave)) {
				problemas.push({
					arquivo: chave.split(' → ')[0],
					msg: `HELPERS_OBRIGATORIOS obsoleto: "${chave}" não existe mais`
				});
			}
			continue;
		}
		if (!arquivos.includes(chave)) {
			problemas.push({
				arquivo: chave,
				msg: `HELPERS_OBRIGATORIOS obsoleto: "${chave}" não existe mais`
			});
		}
	}
	let helpersChecados = 0;
	for (const op of operacoes) {
		const nomes = helpersDaOperacao(op.arquivo, op.nome);
		if (!nomes) continue;
		helpersChecados++;
		if (!nomes.some((n) => op.corpo.includes(n))) {
			problemas.push({
				arquivo: op.arquivo,
				msg:
					`"${op.nome}" falta helper obrigatório — espere um de [${nomes.join(', ')}] ` +
					'no corpo (ACL larga com 403 genérico / import sem chamada não basta)'
			});
		}
	}

	if (problemas.length > 0) {
		console.error('\n[guard-autorizacao] operação material sem decisão de autorização:\n');
		for (const { arquivo, msg } of problemas) {
			console.error(`::error file=${arquivo}::${msg}`);
			console.error(`  ${arquivo} — ${msg}`);
		}
		console.error(
			'\nEsconder o botão na tela não é autorização: o POST direto tem de morrer no\n' +
				'servidor. Ver README → "Autorização das operações materiais".\n'
		);
		process.exit(1);
	}

	console.log(
		`[guard-autorizacao] ${operacoes.length} operações materiais — ` +
			`${operacoes.length - vistas.size} recusam por permissão, ` +
			`${vistas.size} dispensadas com motivo declarado; ` +
			`${helpersChecados} operações com helper obrigatório no corpo.`
	);
}

// Só executa quando chamado direto (`node scripts/guard-autorizacao.mjs`).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	principal();
}
