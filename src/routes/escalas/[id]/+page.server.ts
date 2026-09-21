/**
 * `load` da tela de UMA ESCALA, e a composição das actions.
 *
 * Quase toda a densidade do módulo vem de uma coisa só: o tipo da escala muda o
 * que cada operação significa — e é por isso que as actions foram para
 * `_actions/`, agrupadas pelo que decidem.
 *
 * **Todas as actions começam por `carregarEscalaComPermissao`**, declarando o
 * que vão fazer (`'conteudo'` ou `'ciclo'`). É o preâmbulo único: autentica,
 * valida o id, confere permissão e — para conteúdo — que a escala ainda POSSA
 * mudar. Duas regras moram só ali:
 *
 *   - DPC admin com solicitação de assinatura pode VER e ASSINAR, mas não
 *     MUTAR; por isso a restrição por lotação continua valendo mesmo depois de
 *     a leitura ter passado;
 *   - escala assinada ou finalizada não tem o conteúdo alterado. Voltar a
 *     editar exige revogar a assinatura ou reabrir o FDS — os dois caminhos
 *     explícitos e auditados (FLW-ESC-003).
 *
 * Item de `escala_policiais` é sempre buscado por `id` **e** `escala_id`: sem
 * o par, um `item_id` de outra escala é aceito por quem só tem permissão nesta
 * (FLW-ESC-002).
 *
 * As catorze actions moram em `_actions/`, um arquivo por grupo do que decidem
 * — e o preâmbulo comum em `_actions/shared.ts`:
 *
 * - **composição** (`actions-composicao.ts`) — quem está na escala:
 *   `adicionar`, `adicionarPlantao`, `adicionarTodos`, `editar`, `remover`,
 *   `removerTodos`, `removerSelecionados`;
 * - **datas e horários** (`actions-datas.ts`) — `editarPlantaoAgrupado`,
 *   `editarDiasEscala`, `repetir`: mexem nas linhas existentes sem trocar quem
 *   serve;
 * - **ciclo de vida do FDS** (`actions-ciclo.ts`) — `finalizar`,
 *   `desfinalizar`, `reenviarEmail`: a escala de fim de semana não é assinada,
 *   é ENVIADA por e-mail com o `.docx` anexo;
 * - **projeção** (`actions-projecao.ts`) — `gerarProximoMes`, que cria a escala
 *   do mês seguinte a partir desta.
 *
 * O que NÃO está aqui: assinar. A assinatura é dos endpoints
 * `/api/escalas/[id]/*`, porque envolve R2, CMS e carimbo de tempo — fluxo que
 * não cabe em form action.
 */
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { cpfAssinanteParaExibir } from '$lib/server/assinatura/cpf-assinante';
import {
	getDB,
	buscarEscala,
	listarPoliciaisEscala,
	buscarDocumentoEscala,
	buscarSolicitacaoAssinatura
} from '$lib/db';
import {
	verificarPermissaoEscala,
	podeMexerNaEscala,
	podeOIPSolicitarAssinatura
} from '$lib/server/escalas/permissao';
import { actionsComposicao } from './_actions/actions-composicao';
import { actionsDatas } from './_actions/actions-datas';
import { actionsCiclo } from './_actions/actions-ciclo';
import { actionsProjecao } from './_actions/actions-projecao';
import { desfalquesDaEscala } from '$lib/db/policiais/afastamento-escalas';

/**
 * Tela de uma escala (`/escalas/[id]`) — o núcleo do módulo de escalas.
 *
 * Um mesmo arquivo atende os TRÊS tipos, que têm ciclos de vida diferentes:
 *
 * - **plantão mensal**: cada policial ocupa vários dias do mês, em rotação
 *   (24×72 h etc.). Actions próprias: `adicionarPlantao`, `repetir`,
 *   `editarPlantaoAgrupado`, `gerarProximoMes`;
 * - **expediente mensal**: uma linha por policial no mês, com horário próprio;
 * - **FDS**: escala de fim de semana/feriado, que se ENCERRA por e-mail
 *   (`finalizar` → `reenviarEmail` → `desfinalizar`) em vez de assinatura.
 *
 * Todas as mutações passam por `carregarEscalaComPermissao`, que concentra o
 * guard de edição: Admin Geral em qualquer escala, ou dono da lotação. Só a
 * LEITURA é mais ampla (ver comentários no `load`), e assinar é fluxo à parte.
 *
 * Convenção herdada da planilha original: hora padrão '08' quando o formulário
 * não manda nada, e `calcularDataSaida` resolve o turno que vira o dia.
 */
export const load: PageServerLoad = async ({ locals, platform, params, depends }) => {
	const escalaId = Number(params.id);
	if (!isNaN(escalaId)) depends(`escala:${escalaId}`);

	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const db = getDB(platform);
	if (isNaN(escalaId)) redirect(302, '/escalas');

	const [escala, policiaisEscala, docInfo] = await Promise.all([
		buscarEscala(db, escalaId),
		listarPoliciaisEscala(db, escalaId),
		buscarDocumentoEscala(db, escalaId).then(async (d) =>
			d
				? {
						existe: true,
						assinante_nome: d.assinante_nome,
						// Mascarado para quem não é Super Admin, igual à API que serve o
						// MESMO campo (`/api/gise/[id]/documento-assinado/info`) e à página
						// pública `/validar`. Este `load` decifrava e devolvia o CPF
						// COMPLETO no payload de hidratação — para qualquer um que alcance
						// a escala, inclusive policial comum da lotação — enquanto nenhuma
						// tela o renderiza. Ver `cpf-assinante.ts`.
						assinante_cpf: await cpfAssinanteParaExibir(d.assinante_cpf, platform?.env, u),
						data: d.created_at
					}
				: { existe: false }
		)
	]);

	if (!escala) redirect(302, '/escalas');

	// Permissão de LEITURA fora da própria lotação. Um admin_seccional/admin_unidade
	// é um POLICIAL (u.tipo === 'policial') com u.papel definido — por isso a regra
	// depende do PAPEL/escopo, não do tipo. `verificarPermissaoEscala` concentra
	// tudo: Admin Geral irrestrito; mesma lotação; escopo do papel cobre a lotação
	// da escala (a seccional vê as escalas das suas unidades); DPC admin com
	// solicitação direcionada. Vale para qualquer tipo de escala (fds/plantão/
	// expediente). Policial comum continua restrito à própria lotação.
	if (u.tipo !== 'admin' && escala.lotacao !== u.lotacao) {
		const perm = await verificarPermissaoEscala(db, escalaId, escala.lotacao, u);
		if (!perm.permitido) redirect(302, '/escalas');
	}

	// Permissão de EDIÇÃO (mutar servidores/finalizar). É a MESMA função que as
	// actions usam — não uma cópia que espelha o guard, como era antes: a tela
	// recalculava a regra e a aplicava em um dos sete componentes de edição.
	// Um admin_seccional que apenas VÊ a escala de uma unidade sob seu escopo NÃO
	// edita — mas continua podendo ASSINAR (fluxo próprio, cross-unidade).
	const podeEditarEscala = await podeMexerNaEscala(db, u, escala.lotacao);

	const oipPodeSolicitar = podeOIPSolicitarAssinatura(u);
	const jaAssinada = docInfo.existe;
	const solicitacaoAtual =
		oipPodeSolicitar && (escala.tipo === 'plantao' || escala.tipo === 'expediente') && !jaAssinada
			? await buscarSolicitacaoAssinatura(db, escalaId)
			: null;

	// A lista completa de policiais NÃO é mais carregada no load (era até 10 000
	// linhas em todo acesso). O `<SearchableSelect>` agora consulta
	// `/api/policiais/search` sob demanda com debounce, paginado.

	return {
		escala,
		policiaisEscala,
		/** Quem está escalado em dia de afastamento — a faixa "desfalcada" (E60). */
		desfalques: await desfalquesDaEscala(db, escalaId),
		documentoAssinadoInfo: docInfo,
		escalaId,
		podeEditarEscala,
		podeOIPSolicitar: oipPodeSolicitar,
		solicitacaoAtual: solicitacaoAtual
			? {
					tipo: solicitacaoAtual.tipo,
					destinatario_id: solicitacaoAtual.destinatario_id ?? undefined
				}
			: null
	};
};

export const actions: Actions = {
	...actionsComposicao,
	...actionsDatas,
	...actionsCiclo,
	...actionsProjecao
};
