/**
 * Unidades (departamentos, seccionais e delegacias).
 *
 * Ponto central do modelo: policiais e escalas referenciam a unidade pelo
 * NOME (`policiais.lotacao`, `escalas.lotacao`), não por chave estrangeira —
 * herança da planilha que originou o sistema. As duas consequências disso são
 * as duas operações perigosas deste arquivo:
 *
 * - **renomear cascateia** (`atualizarUnidade` propaga o nome novo para
 *   policiais e escalas na mesma operação);
 * - **não existe exclusão de unidade** (`definirUnidadeAtiva` desativa; nunca
 *   apaga). O D1 aplica FK real em `gise_assinaturas_relatorios`, e as duas
 *   ligações por nome (escala/lotação) não têm FK nenhuma — um DELETE
 *   quebraria evidência de assinatura ou deixaria RBAC falhando em silêncio.
 *   Ver `definirUnidadeAtiva` para o raciocínio completo.
 */
import { sql, and, eq, asc } from 'drizzle-orm';
import { unidades, policiais, escalas, giseSeccionais } from '../server/schema';
import type * as schema from '../server/schema';
import { linhasAfetadas, type Database } from './core';
import type { TipoUnidade } from '$lib/unidades/tipos';

/** Campos editáveis de uma unidade (mesmo shape em criar e atualizar). */
type DadosUnidade = {
	nome: string;
	tipo: TipoUnidade;
	seccional_id: number | null;
	tem_plantao: boolean;
	tem_expediente: boolean;
	tem_fds: boolean;
	cidade: string;
	sigla: string;
	/** O código da unidade na COTIC (0101); vazio enquanto não se sabe. */
	id_cotic?: string;
	// A ficha (0085) — opcionais para quem só cria a estrutura (o modal de cadastro).
	endereco?: string;
	telefone?: string;
	email?: string;
	ais?: string;
	xadrezes?: number;
	tira_gravame?: boolean;
	foto_url?: string | null;
};

/** As colunas da ficha, como vão ao INSERT/UPDATE (ausente = valor padrão da coluna). */
function colunasDaFicha(data: DadosUnidade) {
	return {
		id_cotic: (data.id_cotic ?? '').trim(),
		endereco: data.endereco ?? '',
		telefone: data.telefone ?? '',
		email: data.email ?? '',
		ais: data.ais ?? '',
		xadrezes: data.xadrezes ?? 0,
		tira_gravame: data.tira_gravame ?? false,
		foto_url: data.foto_url ?? null
	};
}

/**
 * Unidades ATIVAS, em ordem alfabética — é a lista de ESCOLHA (combo de nova
 * escala, lotação de policial, seccional da GISE).
 *
 * Desativada não aparece aqui de propósito: o objetivo de desativar é sumir das
 * opções sem deixar de existir. Para telas que precisam ver o histórico
 * completo — a própria gestão de unidades, e qualquer resolução de nome de
 * registro antigo — use `listarTodasUnidades`.
 */
export async function listarUnidades(db: Database): Promise<schema.Unidade[]> {
	return db.select().from(unidades).where(eq(unidades.ativo, true)).orderBy(asc(unidades.nome));
}

/**
 * O ID da unidade a partir do NOME — o tradutor da E51.
 *
 * Toda escrita que guarda lotação por nome passa por aqui para guardar o id
 * junto. Devolve `null` quando o nome não corresponde a unidade nenhuma, e
 * isso é resposta e não falha: a carga da planilha traz nomes de unidades de
 * fora do DPI SUL, e o histórico guarda nomenclatura antiga. Nesses casos o
 * texto continua valendo e o id fica vazio, que é a verdade.
 *
 * Aceita a unidade DESATIVADA de propósito: um servidor lotado numa unidade
 * que acabou de ser desativada não pode perder o vínculo por causa disso.
 */
export async function idDaUnidadePeloNome(
	db: Database,
	nome: string | null | undefined
): Promise<number | null> {
	const limpo = (nome ?? '').trim();
	if (!limpo) return null;
	const linha = await db
		.select({ id: unidades.id })
		.from(unidades)
		.where(eq(unidades.nome, limpo))
		.get();
	return linha?.id ?? null;
}

/** Todas as unidades, ativas e desativadas. Para a tela de gestão. */
export async function listarTodasUnidades(db: Database): Promise<schema.Unidade[]> {
	return db.select().from(unidades).orderBy(asc(unidades.nome));
}

/**
 * Cria a unidade. O `nome` é a chave real do modelo (é por ele que policiais e
 * escalas se ligam) e vai `trim()`ado por isso: espaço sobrando cria uma unidade
 * que parece existir mas não casa com nenhuma lotação.
 *
 * As flags `tem_*` definem quais tipos de escala a unidade aceita e são o que a
 * tela de nova escala consulta.
 */
export async function criarUnidade(db: Database, data: DadosUnidade) {
	return db.insert(unidades).values({
		nome: data.nome.trim(),
		tipo: data.tipo,
		tem_plantao: data.tem_plantao,
		tem_expediente: data.tem_expediente,
		tem_fds: data.tem_fds,
		cidade: data.cidade || '',
		sigla: data.sigla || '',
		seccional_id: data.seccional_id ?? null,
		...colunasDaFicha(data)
	});
}

/**
 * Atualiza a unidade e, se o nome mudou, propaga a troca para `policiais.lotacao`
 * e `escalas.lotacao` — sem isso os vínculos por nome se perderiam em silêncio.
 * Devolve o nome anterior para o diff da auditoria.
 */
/**
 * Outra requisição renomeou a unidade entre a leitura e a gravação desta.
 *
 * `unidades.nome` é DENORMALIZADO em `policiais.lotacao` e `escalas.lotacao` —
 * não há FK, a propagação é manual. Duas renomeações partindo do mesmo estado
 * produziam o pior desfecho possível (FLW-UNIDADE-004): a primeira levava a
 * unidade de "A" para "B" e propagava; a segunda gravava "C" na unidade e
 * propagava `WHERE lotacao = 'A'`, que já não achava ninguém. Resultado:
 * unidade chamada "C" e um efetivo inteiro lotado em "B", uma unidade que não
 * existe. Ninguém percebe até alguém montar uma escala.
 *
 * Recusar a segunda é a resposta certa — a pessoa relê a tela e decide de novo,
 * sabendo que o nome mudou.
 */
export class ConflitoDeRenomeacaoUnidade extends Error {
	constructor(nomeEsperado: string) {
		super(
			`A unidade foi renomeada por outra pessoa enquanto esta edição estava aberta ` +
				`(o nome deixou de ser "${nomeEsperado}"). Recarregue a página e tente de novo.`
		);
		this.name = 'ConflitoDeRenomeacaoUnidade';
	}
}

/**
 * Renomeia a unidade e propaga o nome novo para `policiais.lotacao` e
 * `escalas.lotacao` na mesma transação.
 *
 * A gravação é condicionada ao nome lido (`WHERE nome = nomeAntigo`): duas
 * renomeações a partir do mesmo estado — a perdedora vê 0 linhas e lança
 * `ConflitoDeRenomeacaoUnidade`. Sem isso, a cascata da segunda gravava
 * lotação órfã em cima da primeira.
 *
 * @returns o nome anterior, para o caller auditar a troca
 */
export async function atualizarUnidade(
	db: Database,
	id: number,
	data: DadosUnidade
): Promise<{ nomeAntigo: string }> {
	const unidade = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.where(eq(unidades.id, id))
		.get();
	if (!unidade) throw new Error('Unidade não encontrada');
	const nomeAntigo = unidade.nome;
	const nomeTrimmed = data.nome.trim();

	// A gravação é CONDICIONADA ao nome que acabou de ser lido, e as três
	// escritas vão na MESMA transação. Ver `ConflitoDeRenomeacaoUnidade`: sem
	// isso, duas renomeações a partir do mesmo estado deixavam lotação órfã.
	const alterarUnidade = db
		.update(unidades)
		.set({
			nome: nomeTrimmed,
			tipo: data.tipo,
			seccional_id: data.seccional_id,
			tem_plantao: data.tem_plantao,
			tem_expediente: data.tem_expediente,
			tem_fds: data.tem_fds,
			cidade: data.cidade || '',
			sigla: data.sigla || '',
			...colunasDaFicha(data)
		})
		.where(and(eq(unidades.id, id), eq(unidades.nome, nomeAntigo)));

	/**
	 * "O UPDATE da unidade, nesta transação, pegou?" — a unidade `id` já está
	 * com o nome NOVO. Usada para condicionar a cascata do texto.
	 */
	const renomeouNesta = sql`EXISTS (SELECT 1 FROM unidades u WHERE u.id = ${id} AND u.nome = ${nomeTrimmed})`;

	if (nomeTrimmed === nomeAntigo) {
		// Sem troca de nome não há cascata a fazer, mas a condição continua: se
		// outra requisição renomeou no meio, esta edição escreveria os demais
		// campos por cima de um nome que ela não viu.
		const r = await alterarUnidade;
		if (linhasAfetadas(r) === 0) throw new ConflitoDeRenomeacaoUnidade(nomeAntigo);
		return { nomeAntigo };
	}

	// Cascata manual (não há FK): tudo que apontava para o nome antigo passa a
	// apontar para o novo. As duas cascatas são condicionadas ao MESMO nome
	// antigo, então a requisição perdedora vira um no-op de três statements —
	// e é a contagem de linhas do primeiro que a denuncia.
	const [resUnidade] = await db.batch([
		alterarUnidade,
		// Por ID desde a E51, e não mais pelo nome antigo: o vínculo real é
		// `unidade_id`, e o texto só acompanha para a tela não mostrar o nome
		// velho. Se esta atualização falhasse, antes o servidor sumia do escopo;
		// agora o pior que acontece é a tela exibir o nome anterior até a próxima
		// gravação — e o escopo continua certo.
		//
		// A condição `renomeouNesta` é o que faltava ao trocar nome por id: mirando
		// o id, a cascata da renomeação RECUSADA (a segunda de duas concorrentes)
		// ainda encontrava as linhas e gravava nelas um nome que a unidade nunca
		// chegou a ter. Amarrada ao nome NOVO, ela só corre se o UPDATE da unidade,
		// na mesma transação, tiver valido.
		db
			.update(policiais)
			.set({ lotacao: nomeTrimmed })
			.where(and(eq(policiais.unidade_id, id), renomeouNesta)),
		db
			.update(escalas)
			.set({ lotacao: nomeTrimmed })
			.where(and(eq(escalas.unidade_id, id), renomeouNesta))
	]);

	if (linhasAfetadas(resUnidade) === 0) throw new ConflitoDeRenomeacaoUnidade(nomeAntigo);

	return { nomeAntigo };
}

/**
 * Por que `superiorId` NÃO pode ser a unidade superior de `id` — ou `null`
 * quando pode. Trocar o pai pela tela de estrutura é a única operação que
 * consegue fechar um ciclo (A abaixo de B abaixo de A); `ancestraisDe` e
 * `subarvoreDe` se protegem com `vistos`, mas um ciclo gravado faria a
 * Gestão de unidade e a barra do topo mostrarem uma árvore sem raiz. Lê TODAS
 * as unidades (desativadas inclusive): pai desativado continua sendo pai.
 */
export async function motivoParaRecusarSuperior(
	db: Database,
	id: number,
	superiorId: number | null
): Promise<string | null> {
	if (superiorId == null) return null;
	if (superiorId === id) return 'A unidade não pode ser superior de si mesma';
	const linhas = await db
		.select({ id: unidades.id, seccional_id: unidades.seccional_id })
		.from(unidades);
	const paiDe = new Map(linhas.map((l) => [l.id, l.seccional_id]));
	if (!paiDe.has(superiorId)) return 'Unidade superior não encontrada';
	// Sobe a partir do superior escolhido: se chega em `id`, ele está abaixo dela.
	const vistos = new Set<number>();
	let atual: number | null | undefined = superiorId;
	while (atual != null && !vistos.has(atual)) {
		if (atual === id) return 'A unidade superior não pode ser uma unidade vinculada a ela';
		vistos.add(atual);
		atual = paiDe.get(atual);
	}
	return null;
}

/**
 * Quantos registros ainda apontam para a unidade, por tipo de vínculo.
 *
 * São cinco caminhos, e desde a E51 todos ligam por ID — antes escalas e
 * policiais lotados ligavam pelo NOME, herança da planilha:
 *
 * | vínculo             | como liga                       |
 * | ------------------- | ------------------------------- |
 * | escalas             | `escalas.unidade_id`            |
 * | policiais lotados   | `policiais.unidade_id`          |
 * | policiais com papel | `policiais.papel_unidade_id`    |
 * | unidades filhas     | `unidades.seccional_id`         |
 * | GISE                | `gise_seccionais.seccional_id`  |
 *
 * Desde a E51 tudo se conta pelo ID, então o nome deixou de ser necessário: a
 * janela que o parâmetro evitava (checar um nome e apagar outro) fechou
 * sozinha quando o vínculo deixou de ser textual.
 */
async function contarVinculosUnidade(db: Database, id: number): Promise<VinculosUnidade> {
	const [escalasVinc, lotados, comPapel, filhas, gises] = await Promise.all([
		db.select({ id: escalas.id }).from(escalas).where(eq(escalas.unidade_id, id)),
		db.select({ id: policiais.id }).from(policiais).where(eq(policiais.unidade_id, id)),
		db.select({ id: policiais.id }).from(policiais).where(eq(policiais.papel_unidade_id, id)),
		db.select({ id: unidades.id }).from(unidades).where(eq(unidades.seccional_id, id)),
		db
			.select({ id: giseSeccionais.id })
			.from(giseSeccionais)
			.where(eq(giseSeccionais.seccional_id, id))
	]);
	return {
		escalas: escalasVinc.length,
		policiaisLotados: lotados.length,
		policiaisComPapel: comPapel.length,
		unidadesFilhas: filhas.length,
		gises: gises.length
	};
}

/** Contagem de registros que apontam para uma unidade, por tipo de vínculo. */
export interface VinculosUnidade {
	escalas: number;
	policiaisLotados: number;
	policiaisComPapel: number;
	unidadesFilhas: number;
	gises: number;
}

/**
 * Frase legível com TODOS os vínculos da unidade, ou `null` se não houver
 * nenhum. Pura, para que a matriz de casos seja testável sem banco.
 *
 * É INFORMAÇÃO, não bloqueio: desativar uma unidade é sempre permitido, e os
 * vínculos continuam válidos depois (é justamente o ponto de desativar em vez
 * de excluir). A frase existe para quem confirma saber o tamanho do que está
 * mexendo — e lista tudo de uma vez, não um item por tentativa.
 */
export function descreverVinculosUnidade(v: VinculosUnidade): string | null {
	const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;
	const partes: string[] = [];
	if (v.escalas) partes.push(plural(v.escalas, 'escala', 'escalas'));
	if (v.policiaisLotados)
		partes.push(plural(v.policiaisLotados, 'servidor lotado', 'servidores lotados'));
	if (v.policiaisComPapel)
		partes.push(
			plural(
				v.policiaisComPapel,
				'servidor com papel administrativo',
				'servidores com papel administrativo'
			)
		);
	if (v.unidadesFilhas)
		partes.push(plural(v.unidadesFilhas, 'unidade subordinada', 'unidades subordinadas'));
	if (v.gises) partes.push(plural(v.gises, 'GISE', 'GISEs'));
	if (partes.length === 0) return null;

	return partes.length === 1
		? partes[0]
		: `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/**
 * Vínculos da unidade, para a tela de confirmação de desativação.
 *
 * Não impede nada — quem chama usa só para exibir. Ver
 * `descreverVinculosUnidade` para a frase pronta.
 */
export async function vinculosDaUnidade(db: Database, id: number): Promise<VinculosUnidade | null> {
	const unidade = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.where(eq(unidades.id, id))
		.get();
	if (!unidade) return null;
	return contarVinculosUnidade(db, id);
}

/**
 * Desativa (ou reativa) a unidade. **Não existe exclusão de unidade** — este é
 * o substituto, e é irreversível apenas no sentido de precisar de outra ação
 * para voltar.
 *
 * Por que não há DELETE, e por que isso não é excesso de zelo: o D1 aplica
 * chave estrangeira de verdade (verificado empiricamente), e
 * `gise_assinaturas_relatorios.seccional_id` referencia `unidades(id)`. Apagar
 * uma unidade levava junto o registro do ato de assinar — nome do assinante,
 * CPF, selfie, IP, GPS, hash do arquivo e a chave do PDF no R2 — e o
 * portal público `/validar` passava a responder "documento não encontrado" para
 * um papel que alguém já tinha em mãos, indistinguível de documento falso.
 *
 * Os outros dois vínculos (escala e lotação) são por NOME, sem FK: ali o DELETE
 * não daria erro nenhum, só deixaria registros apontando para um nome que não
 * existe mais, com o RBAC falhando fechado em silêncio.
 *
 * Unidade desativada some das listas de ESCOLHA (`listarUnidades`), mas continua
 * existindo para todo o resto: escala antiga, lotação de policial e assinatura
 * de relatório seguem resolvendo normalmente.
 */
export async function definirUnidadeAtiva(db: Database, id: number, ativo: boolean) {
	return db.update(unidades).set({ ativo }).where(eq(unidades.id, id));
}

/**
 * Usada pelo webhook de sincronização: cria ou atualiza pelo nome.
 *
 * Os regimes (`tem_*`) só entram na criação, com tudo habilitado; num conflito
 * eles são preservados, para não desfazer o que o Super Admin configurou na
 * tela a cada sincronização.
 *
 * `ativo` segue a mesma regra, e a omissão no `set` é DELIBERADA: unidade
 * desativada continua desativada depois de sincronizar. Acrescentar `ativo`
 * ali faria a planilha reativar, a cada execução, tudo que a corporação tinha
 * decidido tirar de circulação.
 */
export async function upsertUnidade(
	db: Database,
	data: {
		nome: string;
		tipo: TipoUnidade;
		seccional_id: number | null;
		cidade: string;
	}
) {
	return db
		.insert(unidades)
		.values({
			nome: data.nome.trim(),
			tipo: data.tipo,
			seccional_id: data.seccional_id,
			cidade: data.cidade || '',
			tem_plantao: true,
			tem_expediente: true,
			tem_fds: true
		})
		.onConflictDoUpdate({
			target: unidades.nome,
			set: {
				tipo: data.tipo,
				seccional_id: data.seccional_id,
				cidade: data.cidade || ''
			}
		});
}

/**
 * Resolve nome → unidade, aplicando o mesmo `trim()` da gravação. É o caminho
 * usado para transformar a `lotacao` (texto) de um policial na unidade de
 * verdade; `null` significa lotação órfã — nome que não corresponde a nenhuma
 * unidade cadastrada, situação normal em registros vindos do sync.
 */
export async function buscarUnidadePorNome(db: Database, nome: string) {
	if (!nome) return null;
	const trimmedNome = nome.trim();
	return db.select().from(unidades).where(eq(unidades.nome, trimmedNome)).get();
}

/** O departamento que responde pelos documentos: sigla para a interface, nome por extenso para o cargo. */
export type Departamento = { id: number; nome: string; sigla: string };

/**
 * O departamento ATIVO — hoje há um só (o DPI SUL, semeado pela migração 0006),
 * e é dele que saem a sigla do plano e os cargos do signatário
 * (`cargosSignatario`). Com mais de um, devolve o mais antigo: escolher o
 * departamento por plano é a extensão prevista para quando o módulo servir
 * outros (plano do módulo de diárias, seção 15), e aí este ponto vira seletor.
 *
 * `null` só se ninguém cadastrou departamento; quem chama decide o fallback.
 */
export async function buscarDepartamentoPadrao(db: Database): Promise<Departamento | null> {
	const linha = await db
		.select({ id: unidades.id, nome: unidades.nome, sigla: unidades.sigla })
		.from(unidades)
		.where(and(eq(unidades.tipo, 'departamento'), eq(unidades.ativo, true)))
		.orderBy(asc(unidades.id))
		.get();
	return linha ?? null;
}

/** Apenas as unidades do tipo seccional (montagem da GISE e vínculo de delegacias). */
export async function buscarSeccionaisUnidades(db: Database) {
	return db
		.select()
		.from(unidades)
		.where(eq(unidades.tipo, 'seccional'))
		.orderBy(asc(unidades.nome))
		.all();
}

// ---- A árvore (fase 1 do Ecossistema, decisões E23 e E24) ----------------

/** O que a caminhada na árvore precisa de cada unidade. */
export type NoUnidade = Pick<
	schema.Unidade,
	'id' | 'nome' | 'tipo' | 'seccional_id' | 'sigla' | 'abrangencia' | 'ativo'
>;

/**
 * Carrega a árvore inteira (unidades ativas) indexada por id. São poucas
 * dezenas de linhas por departamento e algumas centenas na corporação toda:
 * uma consulta e caminhar em memória é mais simples e mais barato que uma
 * consulta recursiva por chamada, e dispensa caminho materializado.
 */
export async function arvoreUnidades(db: Database): Promise<Map<number, NoUnidade>> {
	const linhas = await db
		.select({
			id: unidades.id,
			nome: unidades.nome,
			tipo: unidades.tipo,
			seccional_id: unidades.seccional_id,
			sigla: unidades.sigla,
			abrangencia: unidades.abrangencia,
			ativo: unidades.ativo
		})
		.from(unidades)
		.where(eq(unidades.ativo, true));
	return new Map(linhas.map((u) => [u.id, u]));
}

/**
 * Do pai imediato até a raiz, nessa ordem. Para em ciclo (defesa contra dado
 * corrompido: `a.pai = b, b.pai = a` não pode travar um `load()`) e em pai
 * inexistente ou desativado — a unidade vira raiz do que sobrou.
 */
export function ancestraisDe(arvore: Map<number, NoUnidade>, unidadeId: number): NoUnidade[] {
	const saida: NoUnidade[] = [];
	const vistos = new Set<number>([unidadeId]);
	let atual = arvore.get(unidadeId);
	while (atual?.seccional_id != null) {
		const pai = arvore.get(atual.seccional_id);
		if (!pai || vistos.has(pai.id)) break;
		vistos.add(pai.id);
		saida.push(pai);
		atual = pai;
	}
	return saida;
}

/** A unidade e tudo abaixo dela — o ESCOPO de quem a administra (decisão E25). */
export function subarvoreDe(arvore: Map<number, NoUnidade>, unidadeId: number): NoUnidade[] {
	const raiz = arvore.get(unidadeId);
	if (!raiz) return [];
	const saida: NoUnidade[] = [raiz];
	const vistos = new Set<number>([unidadeId]);
	for (let i = 0; i < saida.length; i++) {
		for (const u of arvore.values()) {
			if (u.seccional_id === saida[i].id && !vistos.has(u.id)) {
				vistos.add(u.id);
				saida.push(u);
			}
		}
	}
	return saida;
}

/**
 * O departamento de uma unidade: ela mesma, se for departamento, senão o
 * ancestral mais próximo desse tipo. Subdepartamento conta como o departamento
 * que o contém — o subdepartamento de Juazeiro emite documento em nome do DPI
 * SUL. `null` para unidade fora de qualquer departamento (órgãos corporativos,
 * raiz).
 *
 * É a substituta de `buscarDepartamentoPadrao` sempre que há uma unidade de
 * contexto (decisão E24): "o único departamento ativo" só existe enquanto o
 * sistema serve um departamento.
 */
export function departamentoDe(
	arvore: Map<number, NoUnidade>,
	unidadeId: number
): Departamento | null {
	const propria = arvore.get(unidadeId);
	if (!propria) return null;
	const candidatos = [propria, ...ancestraisDe(arvore, unidadeId)];
	const dep = candidatos.find((u) => u.tipo === 'departamento');
	return dep ? { id: dep.id, nome: dep.nome, sigla: dep.sigla } : null;
}
