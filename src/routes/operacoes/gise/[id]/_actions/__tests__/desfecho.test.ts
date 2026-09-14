/**
 * O desfecho de uma mudança de composição da GISE — FLW-GISE-003.
 *
 * O achado é "as actions não geram evento". A correção não é "passei a chamar
 * `auditar` treze vezes" — é que invalidar e registrar viraram a mesma chamada,
 * de modo que o evento não tem como discordar do que a invalidação fez. É essa
 * amarração que os casos abaixo cobrem; que cada action a use é verificado por
 * `actions-auditadas.test.ts`, que lê os quatro arquivos.
 *
 * Banco de verdade porque o append é ENCADEADO (`seq`, `hash_anterior`): contar
 * linhas num fake do drizzle provaria que a função foi chamada, não que o
 * evento entrou na trilha.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { vi } from 'vitest';
import type { R2CleanupBucket } from '$lib/server/r2-cleanup';
import {
	concluirMudancaGise,
	invalidarAssinaturasDaSeccional,
	invalidarDocumentoDaEscala
} from '../desfecho';

/** Bucket que registra o que foi apagado, na ordem. */
function bucketEspiao() {
	const apagadas: string[] = [];
	const bucket: R2CleanupBucket = {
		delete: vi.fn(async (k) => {
			apagadas.push(k as string);
		}),
		list: vi.fn(async () => ({ objects: [], truncated: false }))
	};
	return { bucket, apagadas };
}

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const GISE = 61001;
const SECCIONAL_GISE = 61002;
const UNIDADE = 61003;

const USUARIO = {
	id: 4242,
	nome: 'Admin Geral',
	tipo: 'admin' as const,
	papel: null,
	primeiro_acesso: false
} as NonNullable<App.Locals['usuario']>;

/** O mínimo de um RequestEvent que `contextoDeEvento` consome. */
function eventoFalso(): RequestEvent {
	return {
		request: { method: 'POST', headers: new Headers({ 'user-agent': 'vitest' }) },
		url: new URL(`http://localhost/operacoes/gise/${GISE}`),
		getClientAddress: () => '203.0.113.7',
		locals: { requestId: 'req-desfecho' },
		platform: { env: {} }
	} as unknown as RequestEvent;
}

interface LinhaAudit {
	acao: string;
	usuario_id: number | null;
	usuario_nome: string | null;
	entidade: string;
	entidade_id: number | null;
	alvo_tipo: string | null;
	alvo_id: number | null;
	alvo_nome: string | null;
	severidade: string;
	detalhes: string | null;
	metadados: string | null;
	rota: string | null;
	metodo: string | null;
}

const trilha = () =>
	sqlite.prepare('SELECT * FROM audit_log ORDER BY seq').all() as unknown as LinhaAudit[];
const documentos = () =>
	(
		sqlite.prepare(`SELECT COUNT(*) AS n FROM gise_documentos WHERE gise_id = ${GISE}`).get() as {
			n: number;
		}
	).n;
const statusDaGise = () =>
	(sqlite.prepare(`SELECT status FROM gise_escalas WHERE id = ${GISE}`).get() as { status: string })
		.status;

/** GISE com um documento gerado e uma seccional com relatório assinado. */
function semear(status: string) {
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (${UNIDADE}, 'SECCIONAL TESTE', 'seccional');

		INSERT INTO gise_escalas (id, data_inicio, status)
		VALUES (${GISE}, '2026-08-10', '${status}');

		INSERT INTO gise_seccionais (id, gise_id, seccional_id, status)
		VALUES (${SECCIONAL_GISE}, ${GISE}, ${UNIDADE}, 'preenchida');

		INSERT INTO gise_documentos (gise_id, r2_key, verificacao_hash)
		VALUES (${GISE}, 'gise/${GISE}.pdf', 'hash-doc');
	`);
}

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('invalidação: o que a mudança derruba depende da fase', () => {
	it('em rascunho não há o que derrubar', () => {
		semear('em_preenchimento');
		// O documento acima é artifício do teste: em `em_preenchimento` real ele
		// não existiria. O ponto é que a função não o toca — decide pela FASE, não
		// pela presença do arquivo.
		return Promise.all([
			expect(invalidarDocumentoDaEscala(db, null, GISE, 'em_preenchimento')).resolves.toBe('nada'),
			expect(
				invalidarAssinaturasDaSeccional(db, null, GISE, SECCIONAL_GISE, 'em_definicao_supervisor')
			).resolves.toBe('nada')
		]).then(() => {
			expect(documentos()).toBe(1);
			expect(statusDaGise()).toBe('em_preenchimento');
		});
	});

	it('fora do rascunho, o documento da escala é descartado e a GISE volta a preencher', async () => {
		semear('aguardando_assinatura');
		await expect(invalidarDocumentoDaEscala(db, null, GISE, 'aguardando_assinatura')).resolves.toBe(
			'documento_da_escala'
		);
		expect(documentos()).toBe(0);
		expect(statusDaGise()).toBe('em_preenchimento');
	});

	it('mudança na seccional derruba o documento TAMBÉM', async () => {
		// A leitura intuitiva — "mexeu só na seccional, só a seccional cai" — é
		// falsa, e estava escrita nos comentários das actions até ago/2026. O
		// documento consolidado contém a seccional alterada, então ele cai junto.
		semear('em_andamento');
		await expect(
			invalidarAssinaturasDaSeccional(db, null, GISE, SECCIONAL_GISE, 'em_andamento')
		).resolves.toBe('documento_e_assinaturas_da_seccional');
		expect(documentos()).toBe(0);
		expect(statusDaGise()).toBe('em_preenchimento');
	});
});

describe('os BYTES saem junto com as LINHAS — FLW-DOC-003', () => {
	it('o PDF da escala e sua cópia de conferência saem do bucket', async () => {
		// O caminho por form action apagava só a linha. Depois disso o blob fica
		// no bucket sem nenhuma referência: não aparece na tela, não é alcançado
		// pelo expurgo de retenção, e é PDF com manifesto forense.
		semear('aguardando_assinatura');
		const { bucket, apagadas } = bucketEspiao();

		await invalidarDocumentoDaEscala(db, bucket, GISE, 'aguardando_assinatura');

		expect(apagadas).toContain(`gise/${GISE}.pdf`);
		expect(
			apagadas.some((k) => k.startsWith('conferencia/')),
			'a conferência tem prefixo PLANO e escapa da varredura por prefixo'
		).toBe(true);
		expect(documentos(), 'e a linha some depois').toBe(0);
	});

	it('a revogação seccional leva relatório assinado e selfie de presença', async () => {
		semear('em_andamento');
		sqlite.exec(`
			INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha)
			VALUES (61501, 'M61501', 'Membro', 'OIP', 'SECCIONAL TESTE', 'h');

			INSERT INTO gise_equipes (id, gise_seccional_id, tipo)
			VALUES (61601, ${SECCIONAL_GISE}, 'operacional');

			INSERT INTO gise_membros (equipe_id, policial_id) VALUES (61601, 61501);

			INSERT INTO gise_presencas (gise_id, policial_id, entrada_selfie_key, saida_selfie_key)
			VALUES (${GISE}, 61501, 'selfies/entrada.jpg', 'selfies/saida.jpg');

			INSERT INTO gise_assinaturas_relatorios
				(gise_id, seccional_id, tipo, tipo_assinatura, assinante_nome, verification_hash, r2_key, selfie_key)
			VALUES (${GISE}, ${UNIDADE}, 'extraordinario', 'simples', 'Supervisor', 'HR', 'relat.pdf', 'selfies/rel.jpg');
		`);
		const { bucket, apagadas } = bucketEspiao();

		await invalidarAssinaturasDaSeccional(db, bucket, GISE, SECCIONAL_GISE, 'em_andamento');

		// Biometria (LGPD art. 11): é o que não pode sobreviver à linha.
		expect(apagadas).toContain('selfies/entrada.jpg');
		expect(apagadas).toContain('selfies/saida.jpg');
		expect(apagadas).toContain('selfies/rel.jpg');
		expect(apagadas).toContain('relat.pdf');
		// E o documento consolidado, que a revogação seccional também derruba.
		expect(apagadas).toContain(`gise/${GISE}.pdf`);
	});

	it('em rascunho não apaga byte nenhum', async () => {
		semear('em_preenchimento');
		const { bucket, apagadas } = bucketEspiao();
		await invalidarDocumentoDaEscala(db, bucket, GISE, 'em_preenchimento');
		expect(apagadas).toEqual([]);
	});
});

describe('o evento diz quem, o quê e o que caiu', () => {
	beforeEach(() => semear('em_preenchimento'));

	it('uma mudança, exatamente um evento, com ator e alvo', async () => {
		await concluirMudancaGise(eventoFalso(), {
			db,
			giseId: GISE,
			usuario: USUARIO,
			acao: 'gise_membro_removido',
			alvo: { tipo: 'policial', id: 777, nome: 'Sicrano' },
			detalhes: 'Sicrano desalocado da equipe 5',
			invalidacao: 'nada'
		});

		const linhas = trilha();
		expect(linhas).toHaveLength(1);
		expect(linhas[0].acao).toBe('gise_membro_removido');
		expect(linhas[0].usuario_id, 'sem ator não há a quem atribuir').toBe(USUARIO.id);
		expect(linhas[0].usuario_nome).toBe(USUARIO.nome);
		expect(linhas[0].entidade_id, 'a GISE é a entidade — é por ela que se filtra').toBe(GISE);
		expect(linhas[0].alvo_tipo).toBe('policial');
		expect(linhas[0].alvo_id).toBe(777);
		expect(linhas[0].alvo_nome).toBe('Sicrano');
		expect(linhas[0].rota).toBe(`/operacoes/gise/${GISE}`);
		expect(linhas[0].metodo).toBe('POST');
	});

	it('a invalidação vai gravada, sempre', async () => {
		// Sem isso, a trilha registra "removeu equipe" e cala que a remoção
		// derrubou as assinaturas da seccional — que é a parte com consequência.
		await concluirMudancaGise(eventoFalso(), {
			db,
			giseId: GISE,
			usuario: USUARIO,
			acao: 'gise_equipe_removida',
			alvo: { tipo: 'gise_equipe', id: 9 },
			detalhes: 'Equipe 9 removida',
			invalidacao: 'documento_e_assinaturas_da_seccional',
			metadados: { gise_seccional_id: SECCIONAL_GISE }
		});

		const meta = JSON.parse(trilha()[0].metadados ?? '{}');
		expect(meta.invalidacao).toBe('documento_e_assinaturas_da_seccional');
		expect(meta.gise_seccional_id, 'os metadados da action não são perdidos').toBe(SECCIONAL_GISE);
	});

	it('mexer no que já foi assinado é `aviso`; mexer no rascunho é `info`', async () => {
		// A severidade é o que separa rotina de exceção na listagem do console. Se
		// cada action a declarasse, cada action teria de acertá-la sozinha.
		await concluirMudancaGise(eventoFalso(), {
			db,
			giseId: GISE,
			usuario: USUARIO,
			acao: 'gise_membro_adicionado',
			alvo: { tipo: 'policial', id: 1 },
			detalhes: 'rascunho',
			invalidacao: 'nada'
		});
		await concluirMudancaGise(eventoFalso(), {
			db,
			giseId: GISE,
			usuario: USUARIO,
			acao: 'gise_membro_adicionado',
			alvo: { tipo: 'policial', id: 2 },
			detalhes: 'já assinada',
			invalidacao: 'documento_da_escala'
		});

		const [rascunho, assinada] = trilha();
		expect(rascunho.severidade).toBe('info');
		expect(assinada.severidade).toBe('aviso');
	});

	it('devolve a invalidação, para a action responder ao cliente', async () => {
		await expect(
			concluirMudancaGise(eventoFalso(), {
				db,
				giseId: GISE,
				usuario: USUARIO,
				acao: 'gise_seccional_removida',
				alvo: { tipo: 'unidade', id: UNIDADE },
				detalhes: 'removida',
				invalidacao: 'documento_da_escala'
			})
		).resolves.toBe('documento_da_escala');
	});
});
