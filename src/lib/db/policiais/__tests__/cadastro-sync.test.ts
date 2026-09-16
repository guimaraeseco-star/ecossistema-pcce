/**
 * `criarPolicial` (tela de cadastro) e `upsertPolicial` (webhook de pessoal)
 * têm de gravar a MESMA linha para a mesma entrada — e diferir só onde a
 * diferença é deliberada.
 *
 * As duas montavam os mesmos 17 campos em blocos separados, e já haviam
 * divergido: `papel_unidade_id` usava `|| null` num e `?? null` no outro. Uma
 * divergência de uma tecla, numa coluna que define ESCOPO DE PERMISSÃO.
 *
 * O que é deliberadamente diferente, e este arquivo trava junto:
 *   - o UPDATE do sync não toca `senha` nem `primeiro_acesso` — uma rodada de
 *     sincronização não pode derrubar o acesso de quem já usa o sistema;
 *   - o UPDATE não reativa `ativo=0` quando o campo vem omitido (FLW-AUT-005);
 *   - o UPDATE não apaga contato: e-mail vazio no payload MANTÉM o valor atual,
 *     porque a folha de pessoal não é dona do e-mail pessoal;
 *   - e-mail pessoal NOVO zera `email_pessoal_verificado`.
 *
 * Contra SQLite real: o `ON CONFLICT DO UPDATE` e os `sql\`email\`` de
 * autorreferência são SQL, e um mock do query builder não os executaria.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import { criarPolicial, upsertPolicial, type DadosPolicial } from '../cadastro';
import { bancoMigrado, drizzleSobre } from '../../__tests__/sqlite-migrado';

let sqlite: DatabaseSync;
let db: Database;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

const BASE: DadosPolicial = {
	nome: 'FULANO DE TAL',
	matricula: '301.095-1',
	cargo: 'OIP',
	telefone: '85999990000',
	lotacao: '1ª Delegacia de Juazeiro do Norte',
	regime: 'plantao',
	classe: '1ª CLASSE',
	email: 'fulano@pc.ce.gov.br',
	email_pessoal: 'fulano@pessoal.com'
};

function linha(matricula = '3010951'): Record<string, unknown> {
	return sqlite.prepare('SELECT * FROM policiais WHERE matricula = ?').get(matricula) as Record<
		string,
		unknown
	>;
}

/** Campos voláteis por natureza — comparar linhas exige tirá-los da frente. */
function semVolateis(l: Record<string, unknown>) {
	const { id, senha, created_at, updated_at, ...resto } = l;
	void id;
	void senha;
	void created_at;
	void updated_at;
	return resto;
}

describe('criarPolicial × upsertPolicial', () => {
	it('gravam linhas idênticas para a mesma entrada', async () => {
		await criarPolicial(db, BASE);
		const doCadastro = semVolateis(linha());

		sqlite.exec('DELETE FROM policiais');
		await upsertPolicial(db, BASE);
		const doSync = semVolateis(linha());

		// `cpf` sai da comparação: sem chave configurada vai em claro e é igual,
		// mas o envelope AES-GCM leva IV aleatório e divergiria por construção.
		delete doCadastro.cpf;
		delete doSync.cpf;
		expect(doSync).toEqual(doCadastro);
	});

	it('normalizam a matrícula do mesmo jeito', async () => {
		await criarPolicial(db, BASE);
		expect(linha().matricula).toBe('3010951');
	});

	it('`papel_unidade_id: 0` é preservado nos dois — não vira null em um só', async () => {
		// A divergência real que existia: `|| null` no cadastro e `?? null` no
		// sync. `0` não é id de unidade nenhuma, mas convertê-lo em `null` apaga
		// um escopo de permissão em silêncio em vez de deixar o valor inválido
		// aparecer.
		await criarPolicial(db, { ...BASE, papel: 'admin_unidade', papel_unidade_id: 0 });
		const doCadastro = linha().papel_unidade_id;

		sqlite.exec('DELETE FROM policiais');
		await upsertPolicial(db, { ...BASE, papel: 'admin_unidade', papel_unidade_id: 0 });

		expect(doCadastro).toBe(0);
		expect(linha().papel_unidade_id).toBe(doCadastro);
	});

	it('nascem sempre com primeiro_acesso = 1 e senha inutilizável', async () => {
		await criarPolicial(db, BASE);
		const l = linha();
		expect(l.primeiro_acesso).toBe(1);
		// Hash de senha aleatória: ninguém — nem quem cadastrou — sabe a senha.
		expect(String(l.senha)).toMatch(/^pbkdf2v[23]:/);
	});
});

describe('upsertPolicial — o que a rodada de sync NÃO pode fazer', () => {
	it('não derruba senha nem primeiro_acesso de quem já entrou', async () => {
		await upsertPolicial(db, BASE);
		sqlite.exec("UPDATE policiais SET senha = 'ja-trocada', primeiro_acesso = 0");

		await upsertPolicial(db, { ...BASE, nome: 'FULANO DE TAL E QUAL' });

		const l = linha();
		expect(l.senha).toBe('ja-trocada');
		expect(l.primeiro_acesso).toBe(0);
		expect(l.nome).toBe('FULANO DE TAL E QUAL'); // o que a folha É dona muda
	});

	it('payload sem e-mail MANTÉM o contato cadastrado', async () => {
		await upsertPolicial(db, BASE);

		await upsertPolicial(db, { ...BASE, email: null, email_pessoal: null });

		const l = linha();
		expect(l.email).toBe('fulano@pc.ce.gov.br');
		expect(l.email_pessoal).toBe('fulano@pessoal.com');
	});

	it('e-mail pessoal NOVO volta a exigir confirmação', async () => {
		await upsertPolicial(db, BASE);
		sqlite.exec('UPDATE policiais SET email_pessoal_verificado = 1');

		await upsertPolicial(db, { ...BASE, email_pessoal: 'outro@pessoal.com' });

		const l = linha();
		expect(l.email_pessoal).toBe('outro@pessoal.com');
		expect(l.email_pessoal_verificado).toBe(0);
	});

	it('e-mail pessoal INALTERADO preserva a verificação', async () => {
		await upsertPolicial(db, BASE);
		sqlite.exec('UPDATE policiais SET email_pessoal_verificado = 1');

		await upsertPolicial(db, { ...BASE, email_pessoal: null });

		expect(linha().email_pessoal_verificado).toBe(1);
	});

	it('omitir ativo no UPDATE preserva desativação (FLW-AUT-005)', async () => {
		await upsertPolicial(db, BASE);
		sqlite.exec('UPDATE policiais SET ativo = 0');

		await upsertPolicial(db, { ...BASE, nome: 'FULANO ATUALIZADO' });

		const l = linha();
		expect(l.ativo).toBe(0);
		expect(l.nome).toBe('FULANO ATUALIZADO');
	});

	it('ativo explícito no upsert prevalece', async () => {
		await upsertPolicial(db, BASE);
		sqlite.exec('UPDATE policiais SET ativo = 0');

		await upsertPolicial(db, { ...BASE, ativo: 1 });
		expect(linha().ativo).toBe(1);
	});

	it('grava papel COMO RECEBIDO — preservá-lo é do chamador (M-4)', async () => {
		// O webhook lê o papel atual antes de chamar; se não lesse, um
		// SYNC_TOKEN vazado promoveria qualquer matrícula a admin. A função não
		// tem como saber, e o teste registra que ela realmente não filtra.
		await upsertPolicial(db, { ...BASE, papel: 'admin_seccional', papel_unidade_id: 71 });
		expect(linha().papel).toBe('admin_seccional');

		await upsertPolicial(db, { ...BASE, papel: null });
		expect(linha().papel).toBeNull();
	});
});

/**
 * A DESIGNAÇÃO tem dois donos possíveis, e a coluna `designacao_origem` (0089)
 * é o que diz qual deles vale naquela linha. O teste existe porque a preservação
 * é feita por um `CASE` dentro do `ON CONFLICT DO UPDATE` — SQL que nenhum mock
 * de query builder executaria.
 */
describe('upsertPolicial — designação: a tela vence a planilha (0089)', () => {
	it('regrava a designação quando ela veio da planilha', async () => {
		await upsertPolicial(db, { ...BASE, designacao_id: 14 });
		expect(linha().designacao_id).toBe(14);

		await upsertPolicial(db, { ...BASE, designacao_id: 15 });
		expect(linha().designacao_id).toBe(15);
		expect(linha().designacao_origem).toBe('planilha');
	});

	it('NÃO desfaz a designação escolhida na tela', async () => {
		await upsertPolicial(db, { ...BASE, designacao_id: 14 });
		// O que a ficha do servidor grava quando o Admin Geral troca a função.
		sqlite.exec("UPDATE policiais SET designacao_id = 3, designacao_origem = 'sistema'");

		await upsertPolicial(db, { ...BASE, designacao_id: 15 });

		const l = linha();
		expect(l.designacao_id).toBe(3);
		expect(l.designacao_origem).toBe('sistema');
	});

	it('payload SEM designação não zera a coluna', async () => {
		await upsertPolicial(db, { ...BASE, designacao_id: 14 });
		// O Apps Script antigo manda a folha sem o complemento da fase 2-C.
		await upsertPolicial(db, { ...BASE, nome: 'FULANO ATUALIZADO' });
		expect(linha().designacao_id).toBe(14);
	});

	it('quem nasce pelo sync nasce com a designação da planilha', async () => {
		await upsertPolicial(db, { ...BASE, designacao_id: 16 });
		expect(linha().designacao_origem).toBe('planilha');
	});
});
