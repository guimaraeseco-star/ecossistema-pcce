/**
 * Colaboradores — a terceira identidade (servidora administrativa e
 * colaboradora terceirizada), criada pelo Admin Geral.
 *
 * O que este módulo NÃO faz, de propósito: não abre sessão, não autentica e
 * não decide o que um colaborador alcança. Isso é `$lib/auth` (tipo de sessão
 * `colaborador`) e a designação do módulo de diárias. Aqui é só o cadastro.
 *
 * O CPF é o identificador de login (E55, migração 0094) — numérico como a
 * matrícula do servidor. Passa por `prepararCpfParaDB`, o MESMO caminho de
 * `policiais` (cifra + índice cego), e é pelo índice que o login (senha e
 * e-CPF) acha a conta. Sem chave configurada (dev) o índice é nulo e a busca
 * cai no `cpf` em texto — é o que `certificado/verificar` já faz.
 *
 * O e-mail pessoal é o canal do 2FA e da senha provisória; gravado
 * NORMALIZADO (minúsculas, sem espaços). O de recuperação é opcional e a
 * própria pessoa informa no primeiro acesso.
 */
import { and, asc, eq } from 'drizzle-orm';
import { colaboradores, sessoes } from '../server/schema';
import type { Colaborador } from '../server/schema';
import { cpfKeys, indiceCPF, prepararCpfParaDB, type CpfCriptoEnv } from '../crypto/cpf-cripto';
import { limparCPF } from '../utils/formato';
import { linhasAfetadas, type Database } from './core';

/** O que a tela do Admin Geral informa ao criar. A senha já vem em hash. */
export type NovoColaborador = {
	nome: string;
	cpf: string;
	emailPessoal: string;
	/** Hash PBKDF2 (ver `hashSenha`) — nunca a senha em claro. */
	senhaHash: string;
	vinculo?: string;
	criadoPor: { id: number; nome: string };
};

/** O colaborador sem os campos sensíveis — o que listagens e telas recebem. */
export type ColaboradorResumo = Omit<Colaborador, 'senha' | 'cpf' | 'cpf_index'>;

/**
 * CPF já cadastrado. É erro próprio, e não a violação do índice único, porque
 * sem chave configurada o `cpf_index` é nulo e o banco não acusa a duplicata
 * — a conferência tem de vir do cadastro nos dois ambientes.
 */
export class CpfDeColaboradorJaCadastrado extends Error {
	constructor() {
		super('Já existe um colaborador com este CPF');
		this.name = 'CpfDeColaboradorJaCadastrado';
	}
}

/** E-mail como o banco o guarda. */
export function normalizarEmailColaborador(email: string): string {
	return email.trim().toLowerCase();
}

function semSensiveis(c: Colaborador): ColaboradorResumo {
	const resto: Partial<Colaborador> = { ...c };
	delete resto.senha;
	delete resto.cpf;
	delete resto.cpf_index;
	return resto as ColaboradorResumo;
}

/** Todos, ativos e desativados, por nome — a tela de gestão mostra os dois. */
export async function listarColaboradores(db: Database): Promise<ColaboradorResumo[]> {
	const linhas = await db.select().from(colaboradores).orderBy(asc(colaboradores.nome)).all();
	return linhas.map(semSensiveis);
}

/** Por id, sem os campos sensíveis. */
export async function buscarColaborador(
	db: Database,
	id: number
): Promise<ColaboradorResumo | null> {
	const c = await db.select().from(colaboradores).where(eq(colaboradores.id, id)).get();
	return c ? semSensiveis(c) : null;
}

/** O filtro do CPF: pelo índice cego com chave; pelo texto, sem. */
async function filtroDeCpf(cpf: string, env: CpfCriptoEnv | undefined) {
	const limpo = limparCPF(cpf);
	const { indexKey } = cpfKeys(env);
	return indexKey
		? eq(colaboradores.cpf_index, await indiceCPF(limpo, indexKey))
		: eq(colaboradores.cpf, limpo);
}

/**
 * Por CPF, linha COMPLETA — é o caminho do login, que precisa do hash da
 * senha. Só ativos: desativado não autentica, como em `policiais`. CPF que
 * não tem 11 dígitos não consulta o banco.
 */
export async function buscarColaboradorAtivoPorCpf(
	db: Database,
	cpf: string,
	env: CpfCriptoEnv | undefined
): Promise<Colaborador | null> {
	if (limparCPF(cpf).length !== 11) return null;
	const c = await db
		.select()
		.from(colaboradores)
		.where(and(await filtroDeCpf(cpf, env), eq(colaboradores.ativo, 1)))
		.get();
	return c ?? null;
}

/**
 * Cria a conta. `primeiro_acesso = 1`: a pessoa troca a senha provisória e
 * aceita o termo antes de qualquer outra coisa, pelo mesmo portão dos
 * policiais. CPF repetido — ativo ou não — recusa com
 * `CpfDeColaboradorJaCadastrado`.
 */
export async function criarColaborador(
	db: Database,
	dados: NovoColaborador,
	env: CpfCriptoEnv | undefined
): Promise<ColaboradorResumo> {
	const existente = await db
		.select({ id: colaboradores.id })
		.from(colaboradores)
		.where(await filtroDeCpf(dados.cpf, env))
		.get();
	if (existente) throw new CpfDeColaboradorJaCadastrado();

	const { cpf, cpf_index } = await prepararCpfParaDB(dados.cpf, env);
	const inserido = await db
		.insert(colaboradores)
		.values({
			nome: dados.nome.trim(),
			cpf: cpf ?? '',
			cpf_index,
			email_pessoal: normalizarEmailColaborador(dados.emailPessoal),
			senha: dados.senhaHash,
			vinculo: (dados.vinculo ?? '').trim(),
			criado_por_id: dados.criadoPor.id,
			criado_por_nome: dados.criadoPor.nome
		})
		.returning()
		.get();
	return semSensiveis(inserido);
}

/**
 * O e-mail de recuperação — o que a pessoa informa no primeiro acesso.
 * `null` apaga: o código de recuperação volta a ir para o pessoal.
 */
export async function definirEmailRecuperacao(
	db: Database,
	id: number,
	email: string | null
): Promise<void> {
	await db
		.update(colaboradores)
		.set({ email_recuperacao: email ? normalizarEmailColaborador(email) : null })
		.where(eq(colaboradores.id, id));
}

/**
 * Desativa ou reativa. Desativar também APAGA as sessões da conta: a validação
 * de sessão já recusa conta inativa no próximo request, mas o cache de edge
 * pode servir a sessão por até um TTL — apagar a linha encurta essa janela ao
 * mínimo que o cache permite, como `definirAtivo` faz com policial.
 *
 * @returns `false` quando o id não existe
 */
export async function definirColaboradorAtivo(
	db: Database,
	id: number,
	ativo: boolean
): Promise<boolean> {
	const r = await db
		.update(colaboradores)
		.set({ ativo: ativo ? 1 : 0 })
		.where(eq(colaboradores.id, id));
	if (linhasAfetadas(r) === 0) return false;
	if (!ativo) {
		await db
			.delete(sessoes)
			.where(and(eq(sessoes.tipo, 'colaborador'), eq(sessoes.usuario_id, id)));
	}
	return true;
}
