/**
 * Os carregadores de opção dos `SearchableSelect` do plano operacional.
 *
 * **Usado por DUAS telas da família `/operacoes/planos`:** a criação
 * (`novo/+page.svelte`) e o editor (`[id]/+page.svelte` e o
 * `[id]/_components/EquipeCard.svelte`). Editar aqui mexe nas três — é o que a
 * regra de "pasta de família" do `CLAUDE.md` exige que esteja escrito no
 * cabeçalho, porque pasta de família sem essa declaração parece privada e não é.
 *
 * Mora no `_components/` do diretório que CONTÉM as duas rotas, e não em
 * `$lib/composables/`: só esta família consome. Subir alegaria alcance de app
 * inteiro para três call sites vizinhos.
 *
 * Existe porque o `guard:duplicacao` pegou as duas cópias — e nesse caso ele
 * está certo: são funções idênticas, sem prop nenhuma a parametrizar, e a
 * divergência que duas cópias produziriam apareceria como uma tela achando
 * servidor que a outra não acha.
 *
 * A forma da resposta difere entre os dois endpoints, e é fácil errar:
 * `/api/policiais/search` devolve `{ policiais }`, `/api/unidades/search`
 * devolve `{ items }`.
 */
import { apiFetch } from '$lib/api-fetch';

/** Mínimo de caracteres antes de ir ao servidor — o mesmo dos três call sites. */
export const MIN_BUSCA = 2;

/** Uma opção do `SearchableSelect`. */
export interface OpcaoBusca {
	value: number;
	label: string;
}

/**
 * DPCs, para o coordenador da operação.
 *
 * Filtra por `cargo=DPC` porque o item 8 do documento pede um delegado —
 * oferecer OIP ali produziria um plano com coordenador que a corporação não
 * reconhece nesse papel.
 */
export async function buscarCoordenadores(termo: string): Promise<OpcaoBusca[]> {
	const q = termo.trim();
	if (q.length < MIN_BUSCA) return [];
	const r = await apiFetch<{ policiais: Array<{ id: number; nome: string; matricula: string }> }>(
		`/api/policiais/search?q=${encodeURIComponent(q)}&cargo=DPC&limit=20`
	);
	return r.policiais.map((p) => ({ value: p.id, label: `${p.nome} — Mat. ${p.matricula}` }));
}

/** Unidades, para a delegacia/seccional demandante. */
export async function buscarUnidades(termo: string): Promise<OpcaoBusca[]> {
	const q = termo.trim();
	if (q.length < MIN_BUSCA) return [];
	const r = await apiFetch<{ items: Array<{ id: number; nome: string }> }>(
		`/api/unidades/search?q=${encodeURIComponent(q)}&limit=20`
	);
	return r.items.map((u) => ({ value: u.id, label: u.nome }));
}

/**
 * Qualquer servidor, para o efetivo das equipes.
 *
 * Sem filtro de cargo: a equipe leva DPC e OIP. O `q` do endpoint casa nome E
 * matrícula, que é o que o pedido descreve ("adicionado pelo nome ou pela
 * matrícula") — não é preciso um segundo campo de busca.
 */
export async function buscarServidores(termo: string): Promise<OpcaoBusca[]> {
	const q = termo.trim();
	if (q.length < MIN_BUSCA) return [];
	const r = await apiFetch<{
		policiais: Array<{ id: number; nome: string; matricula: string; cargo: string }>;
	}>(`/api/policiais/search?q=${encodeURIComponent(q)}&limit=20`);
	return r.policiais.map((p) => ({
		value: p.id,
		label: `${p.nome} — ${p.cargo} Mat. ${p.matricula}`
	}));
}
