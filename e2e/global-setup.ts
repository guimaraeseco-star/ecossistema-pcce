import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VERSAO as TERMO_VERSAO, calcularHashTermo } from '../src/lib/server/termo/termo-vigente';
// Mesma função de hash do app (módulo PURO) — sem cópia local que divergiria
// do formato real (item C6 da auditoria). Sem pepper → emite v2.
import { hashSenha } from '../src/lib/crypto/password-hash';
import { execD1LocalComErro } from './d1-local';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Fixture compartilhada entre o global-setup e as specs cross-lotação. IDs
 * são bem fora da faixa de produção (99xxx) pra não colidir com sync da
 * planilha que costuma usar IDs pequenos. `password` é fixo e em texto
 * claro PROPOSITALMENTE — é uma conta sintética que existe só no D1 local,
 * nunca em produção.
 */
export const FIXTURE = {
	password: 'fixture-cross-lotacao-2026!',
	/**
	 * O departamento das fixtures (E65): a conta de Admin Geral administra um
	 * NÓ, e o alcance dela é a subárvore dele. Sem este nó a conta não
	 * enxergaria as duas delegacias abaixo — e os specs que entram como Admin
	 * Geral veriam tela vazia.
	 */
	departamento: { id: 99000, nome: 'DEPARTAMENTO E2E FIXTURE' },
	unidadeA: { id: 99001, nome: 'DELEGACIA E2E FIXTURE A' },
	unidadeB: { id: 99002, nome: 'DELEGACIA E2E FIXTURE B' },
	/** CPF em claro (sem CPF_ENC_KEY local o app trata como legado) — precisa
	 *  bater com TITULAR_TESTE do e2e/ca-teste/gerar-ca.ts (fluxo A3). */
	policialA: { id: 99001, matricula: 'EE990001', nome: 'Policial Fixture A', cpf: '39053344705' },
	policialB: { id: 99002, matricula: 'EE990002' },
	/** Policial promovido a admin de unidade (boas-vindas/RBAC). */
	adminUnidade: { id: 99005, matricula: 'EE990005', nome: 'Admin Unidade Fixture' },
	/** Admin Geral standalone (linha em `administradores`, sessão tipo 'admin'). */
	adminGeral: { id: 99001, login: 'e2e-admin-geral' },
	/** Super Admin: login precisa bater com SUPER_ADMIN_LOGIN (o servidor-e2e o
	 *  garante em `.dev.vars`); isSuperAdmin é derivado dessa igualdade. */
	superAdmin: { id: 99002, login: 'e2e-super-admin' },
	escalaA: { id: 99001 },
	/** Escala de DEL-A COM policial escalado e SEM documento — alvo do spec de assinatura. */
	escalaAssinavel: { id: 99002 },
	/** Idem, exclusiva do spec do fluxo A3 (assinatura-qualificada-a3) — cada
	 *  spec assina a SUA escala para não invalidar asserções do outro. */
	escalaAssinavelA3: { id: 99003 },
	// ── GISE ativa (telas /operacoes/gise/[id] e /operacoes/presenca) ─────────────────────────
	seccional: { id: 99010, nome: 'SECCIONAL E2E FIXTURE' },
	/** cpf precisa bater com SUPERVISOR_TESTE do e2e/ca-teste/gerar-ca.ts
	 *  (assina o relatório extraordinário via CA de teste). */
	supervisor: {
		id: 99003,
		matricula: 'EE990003',
		nome: 'Supervisor Fixture DPC',
		cpf: '11144477735'
	},
	membroGise: { id: 99004, matricula: 'EE990004', nome: 'Membro Fixture GISE' },
	gise: { id: 99001, dataInicio: '2026-06-01' },
	giseSeccional: { id: 99001 },
	giseEquipe: { id: 99001 }
} as const;

function execSqlSafe(sql: string, rotulo = 'seed'): boolean {
	// Via `--file` (e2e/d1-local.ts): `--command` multilinha/hash quebra no Windows.
	const r = execD1LocalComErro(sql);
	if (!r.ok) {
		// O motivo IMPORTA. Este catch mudo escondeu por semanas uma violação de
		// FK que derrubava o seed GISE inteiro a partir da 2ª execução local: o
		// operador via só "specs vão pular" e os specs rodavam sobre o estado do
		// run anterior. Reportar aqui é o que torna a próxima falha diagnosticável.
		console.warn(`[global-setup] SQL de ${rotulo} falhou: ${r.erro ?? '(sem detalhe)'}`);
	}
	return r.ok;
}

/**
 * Aplica as migrations pendentes no D1 LOCAL antes de semear. Sem isto, num
 * ambiente limpo (CI, container novo) o banco não tem NENHUMA tabela: os
 * seeds abaixo falham silenciosamente (execSqlSafe → false), specs
 * autenticados pulam e o login estoura 500 ("no such table: login_attempts")
 * em vez dos 401/403 que o auth.spec espera. Em máquina de dev já migrada é
 * um no-op rápido (controle em `_migrations_aplicadas`). No CI o passo
 * `wrangler d1 migrations apply` grava em `d1_migrations`; o `migrate.ts`
 * une as duas tabelas para não reexecutar a 0038 por cima da 0060.
 */
function aplicarMigracoesLocais(): boolean {
	try {
		execSync('npx tsx scripts/migrate.ts', { cwd: ROOT, stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

export default async function globalSetup() {
	if (!aplicarMigracoesLocais()) {
		console.warn(
			'[global-setup] Falha ao aplicar migrations no D1 local — specs que dependem do banco vão falhar/pular.'
		);
	}

	// Limpa tentativas de login no D1 local para e2e não herdarem rate limit
	// de execuções anteriores (preview reutiliza o mesmo arquivo de estado
	// com `reuseExistingServer`). Sessões semeadas (e2e/session.ts) das contas
	// fixture também são purgadas — após o primeiro uso o token é re-gravado
	// hasheado, então a limpeza é por usuario_id, não por prefixo.
	// `recovery_attempts` entra junto pelo mesmo motivo que `login_attempts`: é
	// contador de rate-limit e a tabela não é recriada entre execuções. Sem a
	// limpeza, as contas fixture chegariam à suíte seguinte já com tentativas na
	// janela — e o teto de geração pesada (`rate-limit-pesado.ts`) recusaria
	// downloads legítimos, com a falha aparecendo num spec que não tem nada a ver.
	execSqlSafe(
		'DELETE FROM login_attempts; DELETE FROM recovery_attempts;' +
			' DELETE FROM sessoes WHERE usuario_id BETWEEN 99000 AND 99999;'
	);

	// ── Fixture cross-lotação ────────────────────────────────────────────
	// Cria 2 unidades + 2 policiais (cada um numa unidade) + 1 escala em
	// DEL-A com documento assinado fake. Os specs usam isso para verificar
	// que o policial de DEL-B NÃO consegue baixar o documento de DEL-A
	// (regressão P0.1 da auditoria de segurança).
	//
	// email=NULL: o 2FA fail-closed BLOQUEIA o login por senha dessas contas
	// (403) — os specs autenticam via sessão semeada (e2e/session.ts).
	// primeiro_acesso=0 pula redirect para /alterar-senha.
	const senhaHash = await hashSenha(FIXTURE.password);
	const fixtureSeed = `
		INSERT INTO unidades (id, nome, tipo, seccional_id) VALUES
			(${FIXTURE.departamento.id}, '${FIXTURE.departamento.nome}', 'departamento', NULL),
			(${FIXTURE.unidadeA.id}, '${FIXTURE.unidadeA.nome}', 'delegacia', ${FIXTURE.departamento.id}),
			(${FIXTURE.unidadeB.id}, '${FIXTURE.unidadeB.nome}', 'delegacia', ${FIXTURE.departamento.id})
		ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, tipo = excluded.tipo,
			seccional_id = excluded.seccional_id;
		INSERT INTO policiais
			(id, matricula, nome, cargo, lotacao, senha, primeiro_acesso, email, ativo, cpf)
		VALUES
			(${FIXTURE.policialA.id}, '${FIXTURE.policialA.matricula}', '${FIXTURE.policialA.nome}', 'OIP', '${FIXTURE.unidadeA.nome}', '${senhaHash}', 0, NULL, 1, '${FIXTURE.policialA.cpf}'),
			(${FIXTURE.policialB.id}, '${FIXTURE.policialB.matricula}', 'Policial Fixture B', 'OIP', '${FIXTURE.unidadeB.nome}', '${senhaHash}', 0, NULL, 1, NULL)
		ON CONFLICT(id) DO UPDATE SET matricula = excluded.matricula, nome = excluded.nome,
			cargo = excluded.cargo, lotacao = excluded.lotacao, senha = excluded.senha,
			primeiro_acesso = excluded.primeiro_acesso, email = excluded.email,
			ativo = excluded.ativo, cpf = excluded.cpf;
		INSERT INTO policiais
			(id, matricula, nome, cargo, lotacao, senha, primeiro_acesso, email, ativo, papel, papel_unidade_id)
		VALUES
			(${FIXTURE.adminUnidade.id}, '${FIXTURE.adminUnidade.matricula}', '${FIXTURE.adminUnidade.nome}', 'DPC', '${FIXTURE.unidadeA.nome}', '${senhaHash}', 0, NULL, 1, 'admin_unidade', ${FIXTURE.unidadeA.id})
		ON CONFLICT(id) DO UPDATE SET matricula = excluded.matricula, nome = excluded.nome,
			cargo = excluded.cargo, lotacao = excluded.lotacao, senha = excluded.senha,
			primeiro_acesso = excluded.primeiro_acesso, email = excluded.email,
			ativo = excluded.ativo, papel = excluded.papel, papel_unidade_id = excluded.papel_unidade_id;
		INSERT INTO administradores (id, login, senha, nome, email, primeiro_acesso, unidade_id)
		VALUES
			(${FIXTURE.adminGeral.id}, '${FIXTURE.adminGeral.login}', '${senhaHash}', 'Admin Geral Fixture', NULL, 0, ${FIXTURE.departamento.id}),
			(${FIXTURE.superAdmin.id}, '${FIXTURE.superAdmin.login}', '${senhaHash}', 'Super Admin Fixture', NULL, 0, NULL)
		ON CONFLICT(id) DO UPDATE SET login = excluded.login, senha = excluded.senha,
			nome = excluded.nome, email = excluded.email, primeiro_acesso = excluded.primeiro_acesso,
			unidade_id = excluded.unidade_id;
		INSERT INTO escalas (id, titulo, cidade, tipo, lotacao, data_inicio, data_fim)
		VALUES
			(${FIXTURE.escalaA.id}, 'Escala E2E Fixture A', 'Fortaleza', 'plantao', '${FIXTURE.unidadeA.nome}', '2026-01-01', '2026-01-01')
		ON CONFLICT(id) DO UPDATE SET titulo = excluded.titulo, cidade = excluded.cidade,
			tipo = excluded.tipo, lotacao = excluded.lotacao,
			data_inicio = excluded.data_inicio, data_fim = excluded.data_fim;
		DELETE FROM escala_documentos WHERE escala_id = ${FIXTURE.escalaA.id};
		INSERT INTO escala_documentos (escala_id, r2_key, assinante_nome, verificacao_hash)
		VALUES (${FIXTURE.escalaA.id}, 'test/fixture-${FIXTURE.escalaA.id}.pdf', 'Policial Fixture A', 'fixture-hash-${FIXTURE.escalaA.id}');
		INSERT INTO escalas (id, titulo, cidade, tipo, lotacao, data_inicio, data_fim)
		VALUES
			(${FIXTURE.escalaAssinavel.id}, 'Escala E2E Assinável', 'Fortaleza', 'plantao', '${FIXTURE.unidadeA.nome}', '2026-02-01', '2026-02-28'),
			(${FIXTURE.escalaAssinavelA3.id}, 'Escala E2E Assinável A3', 'Fortaleza', 'plantao', '${FIXTURE.unidadeA.nome}', '2026-03-01', '2026-03-31')
		ON CONFLICT(id) DO UPDATE SET titulo = excluded.titulo, cidade = excluded.cidade,
			tipo = excluded.tipo, lotacao = excluded.lotacao,
			data_inicio = excluded.data_inicio, data_fim = excluded.data_fim;
		DELETE FROM escala_policiais WHERE escala_id IN (${FIXTURE.escalaAssinavel.id}, ${FIXTURE.escalaAssinavelA3.id});
		INSERT INTO escala_policiais (escala_id, policial_id, data_plantao, hora_entrada, hora_saida, equipe)
		VALUES
			(${FIXTURE.escalaAssinavel.id}, ${FIXTURE.policialA.id}, '2026-02-01', '08:00', '20:00', '1'),
			(${FIXTURE.escalaAssinavelA3.id}, ${FIXTURE.policialA.id}, '2026-03-01', '08:00', '20:00', '1');
		DELETE FROM escala_documentos WHERE escala_id IN (${FIXTURE.escalaAssinavel.id}, ${FIXTURE.escalaAssinavelA3.id});
	`;

	const fixtureOk = execSqlSafe(fixtureSeed, 'fixture base');

	// ── Fixture GISE ativa ───────────────────────────────────────────────
	// Uma GISE 'em_andamento' (= "ativa": status != finalizada) com seccional
	// preenchida, 1 equipe operacional e 1 membro; supervisor DPC designado.
	// Destrava as telas /operacoes/gise/[id] (supervisor/admin) e /operacoes/presenca (membro).
	const giseSeed = `
		INSERT INTO unidades (id, nome, tipo) VALUES
			(${FIXTURE.seccional.id}, '${FIXTURE.seccional.nome}', 'seccional')
		ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, tipo = excluded.tipo;
		INSERT INTO policiais
			(id, matricula, nome, cargo, lotacao, senha, primeiro_acesso, email, ativo, cpf)
		VALUES
			(${FIXTURE.supervisor.id}, '${FIXTURE.supervisor.matricula}', '${FIXTURE.supervisor.nome}', 'DPC', '${FIXTURE.seccional.nome}', '${senhaHash}', 0, NULL, 1, '${FIXTURE.supervisor.cpf}'),
			(${FIXTURE.membroGise.id}, '${FIXTURE.membroGise.matricula}', '${FIXTURE.membroGise.nome}', 'OIP', '${FIXTURE.unidadeA.nome}', '${senhaHash}', 0, NULL, 1, NULL)
		ON CONFLICT(id) DO UPDATE SET matricula = excluded.matricula, nome = excluded.nome,
			cargo = excluded.cargo, lotacao = excluded.lotacao, senha = excluded.senha,
			primeiro_acesso = excluded.primeiro_acesso, email = excluded.email,
			ativo = excluded.ativo, cpf = excluded.cpf;
		-- \`operacao_id\` sai do nome, não de um id fixo: quem cria a operação GISE é
		-- a migração 0048, e o id dela depende da ordem de inserção do banco. Sem
		-- esta coluna a fixture ficaria como uma escala pré-migração, que é
		-- justamente o estado que o backfill eliminou em produção — e o filtro por
		-- operação de \`/operacoes/produtividade\` a deixaria de fora.
		INSERT INTO gise_escalas (id, data_inicio, status, hora_entrada, hora_saida, supervisor_id, operacao_id)
		VALUES (${FIXTURE.gise.id}, '${FIXTURE.gise.dataInicio}', 'em_andamento', '08:00', '16:00', ${FIXTURE.supervisor.id},
			(SELECT id FROM operacoes WHERE nome = 'GISE'))
		ON CONFLICT(id) DO UPDATE SET data_inicio = excluded.data_inicio, status = excluded.status,
			hora_entrada = excluded.hora_entrada, hora_saida = excluded.hora_saida,
			supervisor_id = excluded.supervisor_id, operacao_id = excluded.operacao_id;
		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status, hora_entrada, hora_saida)
		VALUES (${FIXTURE.giseSeccional.id}, ${FIXTURE.gise.id}, ${FIXTURE.seccional.id}, 'preenchida', '08:00', '16:00')
		ON CONFLICT(id) DO UPDATE SET gise_id = excluded.gise_id, seccional_id = excluded.seccional_id,
			status = excluded.status, hora_entrada = excluded.hora_entrada,
			hora_saida = excluded.hora_saida;
		INSERT INTO gise_equipes (id, gise_seccional_id, tipo, slots_dpc, slots_oip)
		VALUES (${FIXTURE.giseEquipe.id}, ${FIXTURE.giseSeccional.id}, 'operacional', 1, 4)
		ON CONFLICT(id) DO UPDATE SET gise_seccional_id = excluded.gise_seccional_id,
			tipo = excluded.tipo, slots_dpc = excluded.slots_dpc, slots_oip = excluded.slots_oip;
		DELETE FROM gise_membros WHERE equipe_id = ${FIXTURE.giseEquipe.id};
		INSERT INTO gise_membros (equipe_id, policial_id)
		VALUES (${FIXTURE.giseEquipe.id}, ${FIXTURE.membroGise.id});
		DELETE FROM gise_presencas WHERE gise_id = ${FIXTURE.gise.id};
		DELETE FROM gise_respostas_formulario WHERE gise_id = ${FIXTURE.gise.id};
		-- Zera o modelo DO GISE para que os specs caiam no
		-- \`DEFAULT_QUESTIONS_FORM_OPERACIONAL\` do código. Escopado de propósito: sem
		-- o WHERE, levava junto o modelo da CRAJUBAR semeado pela migração 0050.
		DELETE FROM gise_modelo_formulario
			WHERE operacao_id = (SELECT id FROM operacoes WHERE nome = 'GISE');
	`;
	const giseOk = execSqlSafe(giseSeed, 'fixture GISE');
	if (!giseOk) {
		console.warn('[global-setup] Fixture GISE não foi seedada — specs de GISE vão pular.');
	}

	// Aceite do Termo de Uso vigente para os dois fixture-users. Sem isto, o
	// `handleAuth` em hooks.server.ts redireciona/bloqueia tudo com 403
	// ("Aceite o Termo de Uso vigente antes de continuar") antes dos
	// handlers de API rodarem.
	const termoHash = await calcularHashTermo();
	const idsFixture = [
		FIXTURE.policialA.id,
		FIXTURE.policialB.id,
		FIXTURE.supervisor.id,
		FIXTURE.membroGise.id,
		FIXTURE.adminUnidade.id
	];
	const idsAdmin = [FIXTURE.adminGeral.id, FIXTURE.superAdmin.id];
	const aceitesSeed = `
		DELETE FROM aceites_termos
		WHERE (usuario_tipo = 'policial' AND usuario_id IN (${idsFixture.join(', ')}))
			OR (usuario_tipo = 'admin' AND usuario_id IN (${idsAdmin.join(', ')}));
		INSERT INTO aceites_termos
			(usuario_tipo, usuario_id, versao_termo, hash_termo, aceitou_lgpd, aceitou_uso_email, aceitou_uso_localizacao)
		VALUES
			${idsFixture.map((id) => `('policial', ${id}, '${TERMO_VERSAO}', '${termoHash}', 1, 1, 1)`).join(',\n\t\t\t')},
			${idsAdmin.map((id) => `('admin', ${id}, '${TERMO_VERSAO}', '${termoHash}', 1, 1, 1)`).join(',\n\t\t\t')};
	`;
	// Política de assinatura em estado conhecido. `restringir_smartphone` deixou
	// de ser enfeite de interface e passou a RECUSAR no servidor: com ela ligada,
	// todo spec que assina via API (UA de runner, que não é móvel) levaria 403.
	// O mesmo vale para `exigir_passkey_assinatura`: o caminho de um tiro
	// (`assinar-simples`) morre com 403. Os dois valores são globais e
	// persistem entre execuções — sem este reset, um spec que ligasse e
	// morresse antes de restaurar envenenaria a suíte inteira, com falha em
	// outro arquivo. Quem precisa delas ligadas liga e restaura.
	execSqlSafe(
		`INSERT INTO configuracoes (chave, valor) VALUES ('restringir_smartphone', '0')
			ON CONFLICT(chave) DO UPDATE SET valor = '0';`,
		'política restringir_smartphone'
	);
	execSqlSafe(
		`INSERT INTO configuracoes (chave, valor) VALUES ('exigir_passkey_assinatura', '0')
			ON CONFLICT(chave) DO UPDATE SET valor = '0';`,
		'política exigir_passkey'
	);

	execSqlSafe(aceitesSeed);
	if (!fixtureOk) {
		console.warn(
			'[global-setup] Fixture cross-lotação não foi seedada (D1 local indisponível). ' +
				'Specs que dependem dela vão pular via test.skip().'
		);
	}
}
