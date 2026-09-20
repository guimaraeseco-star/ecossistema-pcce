/**
 * Ficha do POLICIAL (`/servidores/[id]`) — a tela de vida funcional: dados
 * cadastrais, papel administrativo, vínculo de Admin Geral e a linha do tempo
 * de movimentações, afastamentos e desvinculação.
 *
 * **A mesma tela serve a dois poderes diferentes**, e a distinção é o assunto
 * central do arquivo (ver `$lib/server/policiais/ficha-permissao`):
 *
 *   - **Admin Geral — modo `direto`.** Escopo irrestrito; o que ele salva ou
 *     registra vale na hora.
 *   - **Admin de seccional / de unidade — modo `solicitacao`.** Vê a mesma
 *     ficha, restrita aos servidores do escopo dele, e nada do que submete muda
 *     o cadastro: vira pedido para o Admin Geral decidir em `/solicitacoes`.
 *     Papel administrativo e Admin Geral são informativos para ele — as três
 *     actions que os alteram continuam exigindo `isAdminGeral`, porque conceder
 *     permissão não é "corrigir um dado".
 *
 * O modo é decidido UMA vez, no portão, e cada action confere o que precisa.
 * Não é redundância inútil: a tela esconde botões, mas POST direto tem de morrer
 * no servidor.
 *
 * As três ações de RH têm a mesma forma, e a ordem importa:
 *
 *   autorizar → validar (Zod) → **upload do PDF** → executar OU registrar pedido
 *   → auditar
 *
 * O upload vem ANTES de qualquer gravação de propósito: anexo inválido
 * (não-PDF, > 10 MB, R2 fora do ar) aborta com 400 sem ter mexido em nada.
 * Invertido, um policial ficaria movimentado com a portaria faltando. No modo
 * `solicitacao` o PDF sobe do mesmo jeito, e é por isso que o Admin Geral
 * consegue BAIXAR a portaria antes de aprovar.
 *
 * O EFEITO dos três atos não mora aqui: mora em
 * `$lib/server/policiais/acoes-rh`, porque a aprovação do pedido executa
 * exatamente o mesmo ato. Enquanto morava dentro destas actions, o caminho da
 * aprovação teria de reescrevê-lo — a forma exata dos bugs de cópia divergente
 * catalogados no `CLAUDE.md`.
 *
 * O que cada ação decide:
 *
 * - `salvar` — dados cadastrais, modo `direto`. Matrícula duplicada vira 409
 *   legível (`ehViolacaoUnique`), não 500 com SQL cru;
 * - `solicitarAlteracao` — os mesmos dados, modo `solicitacao`: uma linha por
 *   campo que de fato mudou, todas com a mesma justificativa. **Lotação não
 *   entra**: transferir servidor é movimentação, com data, NUP e portaria;
 * - `salvarPapel` — concede/revoga papel. Papel SEM unidade de
 *   responsabilidade é recusado: papel sem alcance deixa o escopo do RBAC
 *   indefinido;
 * - `toggleAdminGeral` — cria ou remove a conta administrativa VINCULADA ao
 *   policial. É a concessão mais forte do sistema, e por isso é a única
 *   auditada com `metadados` do estado alvo. Ao criar, os dois consoles
 *   (Escalas e GISE) nascem liberados; `toggleModuloAdmin` recorta depois.
 *
 *   **O gate é `isAdminGeral`, não Super Admin, e isso é decisão registrada**
 *   (auditoria ago/2026, achado I1). Quer dizer que o papel é AUTOPROPAGÁVEL:
 *   qualquer Admin Geral nomeia outro. Fechá-lo para Super Admin foi
 *   considerado e recusado — passaria a exigir o login de bootstrap
 *   (`SUPER_ADMIN_LOGIN`/`SENHA`) para toda promoção, o que empurra na direção
 *   errada: manter credencial root em uso diário é pior que a autopropagação.
 *
 *   O que sustenta a decisão: a concessão é auditada (`toggle_admin_geral`, com
 *   o estado alvo em `metadados`), o Super Admin de bootstrap NÃO é alcançável
 *   por aqui (`desvincularAdminGeral` recebe id de policial, e a linha do Super
 *   Admin é standalone, sem `policial_id`), e os poderes exclusivos dele
 *   — trilha de auditoria, configuração de assinatura — seguem em
 *   `requireSuperAdmin`. Reabrir a discussão exige mudar essa relação, não só
 *   este gate;
 * - `registrarMovimentacao` — troca a lotação E registra na linha do tempo.
 *   Recusa destino igual à origem, que só sujaria o histórico;
 * - `registrarAfastamento` — férias/licença. NÃO altera o cadastro: afastado
 *   continua ativo e escalável, e é `afastamentoVigente` que diz à tela quem
 *   está fora hoje;
 * - `registrarDesvinculacao` — inativa (`ativo: 0`), nunca apaga. O histórico
 *   de escalas continua apontando para o policial.
 */
import { redirect, fail, error } from '@sveltejs/kit';
import { ehViolacaoUnique } from '$lib/server/db-errors';
import { ePdf } from '$lib/server/assinatura/selfie-upload';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	getR2,
	hasR2,
	buscarPolicial,
	atualizarPolicial,
	listarLotacoes,
	listarUnidades,
	listarDesignacoes,
	designacaoAtiva,
	vincularAdminGeral,
	desvincularAdminGeral,
	buscarModulosAdminVinculado,
	atualizarModuloAdminVinculado,
	atualizarPolicialComHistorico,
	listarHistoricoPolicial,
	buscarEventoHistorico,
	buscarSolicitacaoAcao,
	encurtarAfastamento,
	corrigirAfastamento,
	excluirAfastamento,
	afastamentoVigente,
	criarSolicitacoesCadastro,
	criarSolicitacaoAcao,
	listarSolicitacoesDoPolicial,
	listarSolicitacoesAcaoDoPolicial,
	auditar,
	contextoDeEvento,
	listarCredenciaisDoDono,
	listarFeriasDoPolicial,
	type MudancaSolicitada
} from '$lib/db';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { nomeProvedorAaguid } from '$lib/server/assinatura/webauthn/aaguid-provedores';
import { abreviarCredencial } from '$lib/chave-assinatura-ui';
import { deletarChavesR2 } from '$lib/server/r2-cleanup';
import { logger } from '$lib/server/logger';
import { policialUpdateSchema } from '$lib/schemas/policial';
import {
	movimentacaoSchema,
	afastamentoSchema,
	desvinculacaoSchema,
	LABEL_SUBTIPO_AFASTAMENTO
} from '$lib/schemas/policial-historico';
import { AFASTAMENTOS, conferirNup, regraDePrazo } from '$lib/servidores/afastamentos';
import {
	conflitosDoAfastamento,
	ocupadosDoAbono,
	ocupadosDoHistorico
} from '$lib/servidores/conflitos';
import { isAdminGeral } from '$lib/auth';
import { dataIso, inteiroNaFaixa, textoLimitado } from '$lib/server/form-data';
import {
	lotacoesAdministradas,
	lotacaoNoEscopo,
	motivoParaRecusarPapel,
	lerPapelAdministrativo
} from '$lib/server/policial-permissao';
import {
	carregarFichaDoPolicial,
	modoDaFicha,
	podeAbrirFichaDePolicial,
	type FichaAutorizada
} from '$lib/server/policiais/ficha-permissao';
import { executarAcaoRH, type AcaoRH } from '$lib/server/policiais/acoes-rh';
import {
	CAMPOS_SOLICITAVEIS,
	MAX_JUSTIFICATIVA,
	ROTULO_CAMPO,
	motivoParaRecusarValor,
	type CampoSolicitavel
} from '$lib/cadastro-campos';
import { decifrarCpfDoDB } from '$lib/crypto/cpf-cripto';
import { limparCPF, limparMatricula, limparTelefone } from '$lib/utils/formato';
import { resolverCredencial } from '$lib/server/auth/credencial';
import { adicionarDias, diffDiasInclusivo, hojeBrasilISO } from '$lib/utils/datas';
import { avisarOutroLado } from '$lib/server/avisos/emitir';
import { feriadosNoIntervalo } from '$lib/db/diarias/feriados';
import type { RequestEvent } from './$types';
import { mensagemDeErro } from '$lib/utils/erro';
import { actionsFerias } from './_actions/actions-ferias';

const TAMANHO_MAX_PDF = 10 * 1024 * 1024; // 10 MB

/**
 * A persistência falhou depois do upload: apaga o anexo órfão e devolve 500.
 *
 * O PDF sobe ANTES da mutação de propósito (ver o cabeçalho), e é isso que
 * abria a outra ponta: falhando a gravação, o objeto ficava no bucket sem
 * nenhuma linha apontando para ele — invisível para a tela, invisível para o
 * expurgo de retenção, e contando como dado pessoal armazenado sem base
 * (FLW-RBAC-005).
 *
 * A limpeza é best-effort: `deletarChavesR2` não lança, e o erro que importa
 * para o usuário é o da gravação, não o da faxina.
 */
async function abortarComLimpezaR2(
	event: RequestEvent,
	doc: { key: string; nome: string } | null,
	erro: unknown,
	contexto: string
) {
	logger.error(`[policiais/${contexto}] Falha ao persistir; anexo será removido do R2`, {
		r2_key: doc?.key ?? null,
		error: mensagemDeErro(erro)
	});
	if (doc && hasR2(event.platform)) {
		await deletarChavesR2(
			getDB(event.platform),
			getR2(event.platform),
			[doc.key],
			'anexo-policial'
		);
	}
	return fail(500, { error: 'Não foi possível registrar a operação. Tente novamente.' });
}

/**
 * Faz upload best-effort de um PDF anexo (Portaria/Documento) para o R2 e
 * devolve `{ key, nome }`, ou `null` quando nenhum arquivo foi enviado.
 * Lança `Error` com mensagem amigável em caso de arquivo inválido.
 */
async function uploadDocumento(
	event: RequestEvent,
	formData: FormData,
	policialId: number
): Promise<{ key: string; nome: string } | null> {
	const arquivo = formData.get('documento');
	if (!(arquivo instanceof File) || arquivo.size === 0) return null;

	if (arquivo.type && arquivo.type !== 'application/pdf') {
		throw new Error('O documento deve ser um PDF.');
	}
	if (arquivo.size > TAMANHO_MAX_PDF) {
		throw new Error('O documento excede o tamanho máximo de 10 MB.');
	}
	if (!hasR2(event.platform)) {
		throw new Error('Armazenamento de documentos indisponível no momento.');
	}

	const key = `policial-historico/${policialId}/${crypto.randomUUID()}.pdf`;
	const bytes = new Uint8Array(await arquivo.arrayBuffer());
	if (!ePdf(bytes)) {
		throw new Error('O documento deve ser um PDF.');
	}
	await getR2(event.platform).put(key, bytes, {
		httpMetadata: { contentType: 'application/pdf' }
	});
	const nome = arquivo.name?.slice(0, 200) || 'documento.pdf';
	return { key, nome };
}

/**
 * A justificativa que acompanha TODO pedido: obrigatória e limitada.
 * Devolve o texto pronto para gravar, ou a mensagem de recusa.
 */
function lerJustificativa(formData: FormData): { texto: string } | { erro: string } {
	const texto = (formData.get('justificativa')?.toString() ?? '').trim();
	if (!texto) return { erro: 'Informe a justificativa do pedido.' };
	if (texto.length > MAX_JUSTIFICATIVA) {
		return { erro: `A justificativa deve ter no máximo ${MAX_JUSTIFICATIVA} caracteres.` };
	}
	return { texto };
}

export const load: PageServerLoad = async ({ locals, params, platform, depends }) => {
	const id = Number(params.id);
	if (!isNaN(id)) depends(`policial:${id}`);

	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	if (!podeAbrirFichaDePolicial(u)) {
		redirect(302, '/');
	}

	if (isNaN(id)) error(400, 'ID inválido');

	const db = getDB(platform);
	const policial = await buscarPolicial(db, id);
	if (!policial) error(404, 'Policial não encontrado');

	const isAdm = isAdminGeral(u);
	const modo = modoDaFicha(u);

	// O escopo é reconferido contra o ALVO: a lista só mostra quem o admin
	// alcança, mas o id chega pela URL. Sem isto, trocar o número na barra de
	// endereço abriria a ficha de um servidor de outra seccional.
	const escopo = await lotacoesAdministradas(db, u);
	if (!lotacaoNoEscopo(escopo, policial.lotacao)) {
		error(403, 'Este servidor não está sob a sua administração');
	}

	const [
		lotacoes,
		todasUnidades,
		designacoes,
		modulosAdmin,
		historico,
		credenciaisPasskey,
		solicitacoesCampo,
		solicitacoesAcao,
		ferias,
		feriados
	] = await Promise.all([
		// A lista de destinos de MOVIMENTAÇÃO é a corporação inteira nos dois
		// modos, e para o admin com escopo isso é deliberado: transferir servidor
		// para FORA da unidade é o caso comum, e no modo `solicitacao` quem decide
		// é o Admin Geral. Restringir aos destinos que ele já administra tornaria
		// impossível pedir a saída de alguém da unidade.
		listarLotacoes(db),
		listarUnidades(db),
		listarDesignacoes(db),
		buscarModulosAdminVinculado(db, id),
		listarHistoricoPolicial(db, id),
		// A credencial pertence à PESSOA: quem tem conta admin vinculada tem duas
		// linhas, e consultar pelo par cru mostraria "sem chave" para quem tem.
		resolverCredencial(db, 'policial', id).then((c) => listarCredenciaisDoDono(db, c.dono)),
		listarSolicitacoesDoPolicial(db, id),
		listarSolicitacoesAcaoDoPolicial(db, id),
		listarFeriasDoPolicial(db, id),
		// Os feriados dos próximos 18 meses, para o assistente de reprogramação
		// conferir o primeiro dia na tela — a action confere de novo no envio.
		feriadosNoIntervalo(db, hojeBrasilISO(), adicionarDias(hojeBrasilISO(), 540))
	]);
	const ehAdminGeral = modulosAdmin != null;

	const credencialPasskey = credenciaisPasskey.find((c) => c.revogadoEm == null) ?? null;

	// CPF é cifrado em repouso (LGPD) e só é decifrado para quem EDITA o cadastro
	// direto — o Admin Geral. Quem apenas pede a correção informa o CPF novo e
	// nunca precisou ler o atual para isso (minimização, LGPD art. 6º III); a
	// ficha mostra para ele apenas se há CPF cadastrado.
	const cpfClaro = isAdm ? await decifrarCpfDoDB(policial.cpf, platform?.env) : null;

	const afastamentoAtual = afastamentoVigente(historico, hojeBrasilISO());

	return {
		policial: {
			...policial,
			cpf: cpfClaro || null,
			temCpfCadastrado: !!policial.cpf,
			papel: policial.papel ?? null,
			papel_unidade_id: policial.papel_unidade_id ?? null
		},
		lotacoes,
		unidades: todasUnidades,
		designacoes,
		modo,
		isAdmin: isAdm,
		ehAdminGeral,
		modulosAdmin,
		historico,
		solicitacoesCampo,
		solicitacoesAcao,
		/** Férias: frações, pedidos à COGEP e abono (fase 2-C). */
		ferias,
		/** Os períodos ocupados da linha do tempo: o modal de afastamento e o cartão de férias conferem conflito na hora. */
		ocupados: [...ocupadosDoHistorico(historico), ...ocupadosDoAbono(ferias.fracoes)],
		feriados: feriados.map((f) => f.data),
		dataPosse: policial.data_posse,
		afastamentoVigenteId: afastamentoAtual?.id ?? null,
		/** Para o selo no cabeçalho: tipo e período em curso hoje (fase 2-C). */
		afastamentoAtual: afastamentoAtual
			? {
					subtipo: afastamentoAtual.subtipo ?? 'outros',
					data_inicio: afastamentoAtual.data_inicio ?? '',
					data_fim: afastamentoAtual.data_fim || null
				}
			: null,
		// Recorte do manifesto, não o id completo nem a chave pública. Chaves
		// revogadas entram em `chavesAnteriores` para confrontar PDF antigo.
		passkey: credencialPasskey
			? {
					identificador: abreviarCredencial(credencialPasskey.credentialId),
					criadoEm: credencialPasskey.criadoEm,
					ultimoUso: credencialPasskey.ultimoUso,
					vinculo: descreverVinculoCredencial(credencialPasskey),
					// Apelido e provedor: DECLARADOS pelo titular/aparelho no cadastro,
					// não verificados — a mesma ressalva do manifesto do PDF.
					apelido: credencialPasskey.apelido,
					provedor: nomeProvedorAaguid(credencialPasskey.aaguid)
				}
			: null,
		chavesAnteriores: credenciaisPasskey
			.filter((c) => c.revogadoEm != null)
			.map((c) => ({
				identificador: abreviarCredencial(c.credentialId),
				criadoEm: c.criadoEm,
				revogadoEm: c.revogadoEm as string,
				apelido: c.apelido,
				provedor: nomeProvedorAaguid(c.aaguid)
			}))
	};
};

/** Remove campos sensíveis (CPF/senha) antes de gravar um snapshot no log. */
function semCamposSensiveis(o: Record<string, unknown>): Record<string, unknown> {
	const copia: Record<string, unknown> = { ...o };
	delete copia.cpf;
	delete copia.senha;
	delete copia.cpf_index;
	return copia;
}

/**
 * Campos que mudam com frequência técnica e não interessam ao histórico
 * funcional. `designacao_origem` entra aqui porque é MARCA de procedência, não
 * fato da vida funcional: quem lê a linha do tempo quer "designação: Operacional
 * → Chefe de seção de cartório", não "origem: planilha → sistema". A mudança
 * continua no log de auditoria, que guarda o snapshot inteiro.
 */
const CAMPOS_IGNORAR_DIFF = new Set(['updated_at', 'created_at', 'id', 'designacao_origem']);

/**
 * Compara dois snapshots e devolve apenas os campos cujo valor mudou, em dois
 * objetos paralelos (`antes`/`depois`). Usado para não registrar "edições" que
 * não alteraram nada e para deixar o histórico legível.
 */
function camposAlterados(
	antes: Record<string, unknown>,
	depois: Record<string, unknown>
): { antes: Record<string, unknown>; depois: Record<string, unknown> } {
	const difAntes: Record<string, unknown> = {};
	const difDepois: Record<string, unknown> = {};
	for (const chave of Object.keys(depois)) {
		if (CAMPOS_IGNORAR_DIFF.has(chave)) continue;
		const va = antes[chave] ?? null;
		const vd = depois[chave] ?? null;
		if (va !== vd) {
			difAntes[chave] = va;
			difDepois[chave] = vd;
		}
	}
	return { antes: difAntes, depois: difDepois };
}

/**
 * O valor de um campo do cadastro na forma COMPARÁVEL — a mesma normalização
 * dos dois lados da comparação.
 *
 * Sem isto, um pedido de mudança só de classe geraria também uma "solicitação de
 * telefone" porque o banco guarda `85 9999-0000` e o formulário envia
 * `8599990000`: o mesmo número, com outra formatação. É o mesmo cuidado que a
 * antiga tela de perfil tomava com `limparTelefone`, estendido aos campos que
 * ganharam máscara (CPF) ou normalização própria (matrícula).
 */
function normalizarCampo(campo: CampoSolicitavel, valor: string | null | undefined): string {
	const bruto = (valor ?? '').trim();
	if (campo === 'telefone') return limparTelefone(bruto);
	if (campo === 'cpf') return limparCPF(bruto);
	if (campo === 'matricula') return limparMatricula(bruto);
	return bruto;
}

export const actions: Actions = {
	salvar: async (event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo, modo, escopo } = auth;

		const { request, platform } = event;
		if (modo !== 'direto') {
			return fail(403, { error: 'Use "Solicitar alteração" — seu perfil não edita direto.' });
		}

		const formData = await request.formData();
		const data = {
			nome: formData.get('nome')?.toString() || '',
			matricula: formData.get('matricula')?.toString() || '',
			cargo: formData.get('cargo')?.toString() as 'DPC' | 'OIP',
			cpf: formData.get('cpf')?.toString() || '',
			telefone: formData.get('telefone')?.toString() || '',
			lotacao: formData.get('lotacao')?.toString() || '',
			regime: formData.get('regime')?.toString() as 'plantao' | 'expediente' | 'ambos',
			classe: formData.get('classe')?.toString() || '',
			email: formData.get('email')?.toString() || null
		};

		const parsed = policialUpdateSchema.safeParse(data);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message, fields: data });
		}

		// Designação: campo próprio, fora do schema cadastral, porque o domínio
		// dele é uma TABELA — o valor válido é a linha do catálogo, e quem
		// responde isso é o banco. Vazio = "sem designação" (limpa a coluna).
		//
		// `seguir a planilha` é a VOLTA: sem ela, o primeiro salvamento tirava o
		// servidor da folha para sempre naquele campo, e a única saída seria SQL.
		const seguirPlanilha = ['1', 'true', 'on'].includes(
			String(formData.get('designacao_seguir_planilha') ?? '').toLowerCase()
		);
		const designacaoBruta = formData.get('designacao_id')?.toString() ?? '';
		const designacaoId = designacaoBruta === '' ? null : Number(designacaoBruta);
		if (designacaoId !== null && (!Number.isInteger(designacaoId) || designacaoId <= 0)) {
			return fail(400, { error: 'Designação inválida.', fields: data });
		}
		if (designacaoId !== null && !(await designacaoAtiva(db, designacaoId))) {
			return fail(400, { error: 'Designação inexistente ou desativada.', fields: data });
		}

		// Bloqueia transferência para fora do escopo do administrador. Para o Admin
		// Geral (`escopo === null`) não recusa nada; a checagem fica porque o modo
		// é decidido no portão e não no tipo de sessão — quem vier a ganhar modo
		// `direto` com escopo recortado já entra protegido.
		if (!lotacaoNoEscopo(escopo, data.lotacao)) {
			return fail(403, {
				error: 'Não é possível transferir o policial para fora das unidades sob sua administração',
				fields: data
			});
		}

		try {
			// O campo da tela entrega o telefone SÓ COM DÍGITOS (`limparTelefone` no
			// `oninput`), e o cadastro guarda a forma que a origem gravou — a carga
			// de pessoal traz "88 99661-9881". Sem esta comparação por dígitos, todo
			// salvamento reescrevia o número só para tirar a máscara e registrava
			// "Telefone: 88 99661-9881 → 88996619881" na linha do tempo, uma edição
			// que ninguém fez. Mesmos dígitos = mantém o que está gravado.
			// (`solicitarAlteracao` já comparava assim, por `normalizarCampo`.)
			const telefoneGravado = alvo.telefone ?? '';
			const mesmoTelefone =
				limparTelefone(parsed.data.telefone) === limparTelefone(telefoneGravado);

			// `designacao_origem: 'sistema'` só entra quando a designação MUDA: é a
			// marca de "a tela decidiu isto", e é ela que faz a próxima carga da
			// planilha preservar o valor em vez de regravá-lo (0089). Gravá-la em
			// todo salvamento congelaria a folha para quem só corrigiu o telefone.
			// Marcar "seguir a planilha" devolve a caneta à folha e vence a troca:
			// o valor escolhido fica até a próxima carga, que então o regrava.
			const trocouDesignacao = (alvo.designacao_id ?? null) !== designacaoId;
			const origemDaDesignacao = seguirPlanilha
				? ('planilha' as const)
				: trocouDesignacao
					? ('sistema' as const)
					: undefined;
			const mudanca = {
				...parsed.data,
				...(mesmoTelefone ? { telefone: telefoneGravado } : {}),
				email: data.email ?? undefined,
				designacao_id: designacaoId,
				...(origemDaDesignacao ? { designacao_origem: origemDaDesignacao } : {})
			};
			const antes = semCamposSensiveis(alvo);
			const depois = semCamposSensiveis(mudanca);

			// Registra no histórico funcional apenas os campos que de fato mudaram,
			// para a linha do tempo não poluir com "edições" sem alteração real.
			const diff = camposAlterados(antes, depois);
			if (Object.keys(diff.antes).length > 0) {
				await atualizarPolicialComHistorico(
					db,
					id,
					mudanca,
					{
						policial_id: id,
						tipo: 'edicao',
						descricao: `Cadastro editado: ${Object.keys(diff.depois).join(', ')}`,
						dados_antes: diff.antes,
						dados_depois: diff.depois,
						registrado_por_id: u.id,
						registrado_por_nome: u.nome
					},
					platform?.env
				);
			} else {
				// Nada mudou de fato: grava só o cadastro (o UPDATE é idempotente) e
				// não suja a linha do tempo com uma "edição" vazia.
				await atualizarPolicial(db, id, mudanca, platform?.env);
			}

			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'editar_policial',
					usuario: u,
					entidade: 'policial',
					entidade_id: id,
					alvo_tipo: 'policial',
					alvo_id: id,
					alvo_nome: parsed.data.nome,
					detalhes: `Policial editado: ${parsed.data.nome} (mat. ${parsed.data.matricula})`,
					dados_antes: antes,
					dados_depois: depois,
					...contexto
				},
				{ env }
			);
			// A delegacia fica sabendo do que o DPI SUL mudou no cadastro dela (E59).
			const camposMudados = Object.keys(diff.depois);
			if (camposMudados.length > 0) {
				await avisarOutroLado(db, u, {
					cartao: 'servidores',
					tipo: 'cadastro_editado',
					titulo: `Cadastro de ${parsed.data.nome} alterado pelo DPI SUL`,
					texto: `Campos: ${camposMudados.join(', ')}`,
					link: `/servidores/${id}`,
					lotacoes: [alvo.lotacao, parsed.data.lotacao]
				});
			}
			return { success: true };
		} catch (e: unknown) {
			// A violação de índice único fica em `e.cause` (ver `db-errors.ts`).
			if (ehViolacaoUnique(e)) {
				return fail(409, { error: 'Matrícula já cadastrada', fields: data });
			}
			return fail(500, { error: 'Erro interno ao atualizar policial', fields: data });
		}
	},

	/**
	 * Pedido de correção cadastral (modo `solicitacao`): uma linha por campo que
	 * de fato mudou, todas com a mesma justificativa.
	 *
	 * Campo em branco = "não quero mudar isto", não "apagar o valor" — a mesma
	 * convenção da antiga tela de perfil. E como o cargo decide quais classes
	 * valem, a classe é conferida contra o cargo PEDIDO, não contra o gravado:
	 * quem promove de OIP para DPC pede as duas coisas na mesma submissão.
	 */
	solicitarAlteracao: async (event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo, modo } = auth;

		if (modo !== 'solicitacao') {
			return fail(403, { error: 'Seu perfil edita o cadastro direto, sem solicitação.' });
		}

		const formData = await event.request.formData();
		const justificativa = lerJustificativa(formData);
		if ('erro' in justificativa) return fail(400, { error: justificativa.erro });

		const cargoAlvo = (formData.get('cargo')?.toString() || alvo.cargo).trim() || alvo.cargo;
		const mudancas: MudancaSolicitada[] = [];

		for (const campo of CAMPOS_SOLICITAVEIS) {
			const enviado = (formData.get(campo)?.toString() ?? '').trim();
			if (!enviado) continue;

			const recusa = motivoParaRecusarValor(campo, enviado, cargoAlvo);
			if (recusa) return fail(400, { error: recusa });

			// `designacao_id` é referência a uma TABELA: a forma o schema confere,
			// a existência só o banco responde. Sem isto, um POST direto enfileiraria
			// um pedido que só falharia na hora em que o Admin Geral aprovasse.
			if (campo === 'designacao_id' && !(await designacaoAtiva(db, Number(enviado)))) {
				return fail(400, { error: 'Designação inexistente ou desativada.' });
			}

			// Nem toda coluna do cadastro é texto (`designacao_id` é número), e a
			// comparação e a fila trabalham com a forma de texto.
			const bruto = (alvo as unknown as Record<string, unknown>)[campo];
			const atual = bruto == null || bruto === '' ? null : String(bruto);
			if (normalizarCampo(campo, enviado) === normalizarCampo(campo, atual)) continue;

			mudancas.push({ campo, valorAtual: campo === 'cpf' ? null : atual, valorNovo: enviado });
		}

		if (mudancas.length === 0) {
			return fail(400, { error: 'Nenhuma alteração em relação ao cadastro atual.' });
		}

		try {
			await criarSolicitacoesCadastro(db, id, mudancas, justificativa.texto, {
				id: u.id,
				nome: u.nome
			});
		} catch (e) {
			logger.error('[policiais/solicitarAlteracao] Falha ao registrar solicitação', {
				policial_id: id,
				error: mensagemDeErro(e)
			});
			return fail(500, { error: 'Erro ao registrar a solicitação. Tente novamente.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'solicitar_alteracao_cadastro',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes:
					`Solicitação de alteração cadastral de ${alvo.nome} (mat. ${alvo.matricula}): ` +
					mudancas.map((m) => ROTULO_CAMPO[m.campo]).join(', '),
				// O CPF pedido NÃO entra na trilha: a auditoria é lida por operador e o
				// número já está protegido no cadastro (cifra + índice cego).
				metadados: {
					campos: mudancas.map((m) => m.campo),
					justificativa: justificativa.texto
				},
				...contexto
			},
			{ env }
		);

		const solicitacoesCampo = await listarSolicitacoesDoPolicial(db, id);
		return { success: true, solicitacoesCampo };
	},

	salvarPapel: async (event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u || !isAdminGeral(u))
			return fail(403, { error: 'Apenas o Admin Geral pode alterar papéis' });

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const formData = await request.formData();
		// Lista fechada conferida em RUNTIME: o `as` que havia aqui é cast de
		// TypeScript e não existe depois do build. `undefined` = não é papel;
		// `null` = sem papel, que é escolha legítima (é assim que se remove).
		const papel = lerPapelAdministrativo(formData.get('papel'));
		if (papel === undefined) {
			return fail(400, { error: 'Papel administrativo inválido.' });
		}
		const papelUnidadeIdStr = formData.get('papel_unidade_id')?.toString();
		const papelUnidadeId = papelUnidadeIdStr ? Number(papelUnidadeIdStr) : null;

		// Papel administrativo exige a unidade/seccional de responsabilidade.
		if (papel && !papelUnidadeId) {
			return fail(400, {
				error: 'Selecione a unidade de responsabilidade para o papel escolhido.'
			});
		}

		const db = getDB(platform);

		// A unidade de responsabilidade existe e serve para o papel? Era exigida
		// mas nunca validada: id inexistente produzia escopo vazio silencioso — o
		// admin é nomeado, a tela mostra o papel, e ele não administra nada
		// (FLW-RBAC-003).
		if (papel && papelUnidadeId != null) {
			const recusa = await motivoParaRecusarPapel(db, papel, papelUnidadeId);
			if (recusa) return fail(400, { error: recusa });
		}

		const alvo = await buscarPolicial(db, id);

		// Papel e registro na mesma transação: um RBAC concedido sem linha no
		// histórico é uma permissão que ninguém consegue explicar depois.
		await atualizarPolicialComHistorico(
			db,
			id,
			{ papel, papel_unidade_id: papelUnidadeId },
			{
				policial_id: id,
				tipo: 'papel',
				descricao: `Papel administrativo alterado para ${papel ?? 'nenhum'}`,
				dados_antes: {
					papel: alvo?.papel ?? null,
					papel_unidade_id: alvo?.papel_unidade_id ?? null
				},
				dados_depois: { papel, papel_unidade_id: papelUnidadeId },
				registrado_por_id: u.id,
				registrado_por_nome: u.nome
			}
		);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'mudar_papel',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo?.nome ?? null,
				detalhes: `Papel alterado para ${papel ?? 'nenhum'}${papelUnidadeId ? ` (unidade ${papelUnidadeId})` : ''}`,
				dados_antes: {
					papel: alvo?.papel ?? null,
					papel_unidade_id: alvo?.papel_unidade_id ?? null
				},
				dados_depois: { papel, papel_unidade_id: papelUnidadeId },
				...contexto
			},
			{ env }
		);
		return { success: true };
	},

	// Admin Geral agora é uma conta VINCULADA em `administradores` (login pela
	// matrícula, sem senha própria). O policial passa a poder logar escolhendo
	// "Administrador" com a mesma matrícula/senha. Cumulativo com o `papel`.
	toggleAdminGeral: async (event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u || !isAdminGeral(u))
			return fail(403, { error: 'Apenas o Admin Geral pode conceder Admin Geral' });

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const ativar = formData2Bool((await request.formData()).get('ativar'));
		const db = getDB(platform);
		const policial = await buscarPolicial(db, id);
		if (!policial) return fail(404, { error: 'Policial não encontrado' });

		try {
			if (ativar) {
				await vincularAdminGeral(db, policial);
			} else {
				await desvincularAdminGeral(db, id);
			}
		} catch (e: unknown) {
			if (ehViolacaoUnique(e)) {
				return fail(409, {
					error: 'Já existe um administrador com este login/matrícula.'
				});
			}
			return fail(500, { error: 'Erro ao atualizar a condição de Admin Geral' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'toggle_admin_geral',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: policial.nome,
				resultado: 'sucesso',
				detalhes: `${ativar ? 'Concedido' : 'Removido'} Admin Geral para ${policial.nome} (mat. ${policial.matricula})`,
				metadados: { ativar },
				...contexto
			},
			{ env }
		);
		return { success: true };
	},

	// Liga/desliga um console (Escalas ou GISE) na conta Admin Geral vinculada.
	// Recusa zerar os dois — nesse caso remova o vínculo pelo toggle principal.
	toggleModuloAdmin: async (event) => {
		const { request, locals, platform, params } = event;
		const u = locals.usuario;
		if (!u || !isAdminGeral(u))
			return fail(403, { error: 'Apenas o Admin Geral pode alterar módulos' });

		const id = Number(params.id);
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });

		const form = await request.formData();
		const moduloRaw = String(form.get('modulo') ?? '');
		if (moduloRaw !== 'escalas' && moduloRaw !== 'gise') {
			return fail(400, { error: 'Módulo inválido' });
		}
		const ativar = formData2Bool(form.get('ativar'));
		const db = getDB(platform);
		const policial = await buscarPolicial(db, id);
		if (!policial) return fail(404, { error: 'Policial não encontrado' });

		const resultado = await atualizarModuloAdminVinculado(db, id, moduloRaw, ativar);
		if (resultado === 'nao_vinculado') {
			return fail(409, {
				error: 'Este policial ainda não é Admin Geral. Ligue o vínculo antes de liberar módulos.'
			});
		}
		if (resultado === 'sem_modulos') {
			return fail(400, {
				error: 'Mantenha ao menos um módulo liberado, ou remova o Admin Geral.'
			});
		}

		const rotulo = moduloRaw === 'escalas' ? 'Escalas ordinárias' : 'GISE (extra)';
		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'toggle_modulo_admin',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: policial.nome,
				resultado: 'sucesso',
				detalhes: `${ativar ? 'Liberado' : 'Bloqueado'} módulo ${rotulo} para ${policial.nome} (mat. ${policial.matricula})`,
				metadados: { modulo: moduloRaw, ativar },
				...contexto
			},
			{ env }
		);
		return { success: true };
	},

	// ---- Movimentação: transfere a lotação e registra no histórico ----
	// Movimentação e desvinculação são do ADMIN GERAL (decisão dele, 20/09): a
	// unidade e a seccional não as propõem mais — só o afastamento segue no
	// modo solicitação. O botão some da tela e a action recusa o POST direto.
	registrarMovimentacao: async (event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { alvo, modo } = auth;
		if (modo !== 'direto') {
			return fail(403, { error: 'Movimentação e desvinculação são feitas pelo DPI SUL.' });
		}

		const formData = await event.request.formData();
		const parsed = movimentacaoSchema.safeParse({
			unidade_destino: formData.get('unidade_destino')?.toString() || '',
			data_evento: formData.get('data_evento')?.toString() || '',
			nup: formData.get('nup')?.toString() || ''
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		const origem = alvo.lotacao || '';
		if (parsed.data.unidade_destino === origem) {
			return fail(400, { error: 'A unidade de destino é igual à unidade atual.' });
		}

		return concluirAcaoRH(event, auth, formData, {
			acao: {
				tipo: 'movimentacao',
				unidade_origem: origem,
				unidade_destino: parsed.data.unidade_destino,
				data_evento: parsed.data.data_evento,
				nup: parsed.data.nup || null
			},
			resumo: `${origem || '—'} → ${parsed.data.unidade_destino}`,
			metadados: { nup: parsed.data.nup || null, data: parsed.data.data_evento },
			// Modo direto só: nada a recarregar ao lado do painel.
			recarregar: () => Promise.resolve(null)
		});
	},

	// ---- Afastamento: férias/licenças (apenas registra na linha do tempo) ----
	// A regra de cada tipo (prazo fixo, sem prazo, CID, só gestão) vem do
	// catálogo e é reaplicada aqui — a tela já a mostrou, mas o POST direto não
	// passa pela tela. NUP obrigatório em todo afastamento (17 dígitos).
	registrarAfastamento: async (event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { db, id, modo } = auth;

		const formData = await event.request.formData();
		const qtdRaw = formData.get('qtd_dias')?.toString() || '';
		const nup = conferirNup(formData.get('nup')?.toString() || '', true);
		if (!nup.ok) return fail(400, { error: nup.erro });
		const parsed = afastamentoSchema.safeParse({
			subtipo: formData.get('subtipo')?.toString() || '',
			descricao: formData.get('descricao')?.toString() || '',
			data_inicio: formData.get('data_inicio')?.toString() || '',
			data_fim: formData.get('data_fim')?.toString() || '',
			qtd_dias: qtdRaw === '' ? undefined : qtdRaw,
			nup: nup.formatado,
			tipo_cid: formData.get('tipo_cid')?.toString() || '',
			adicional: formData.get('adicional')?.toString() === 'on'
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const { subtipo, data_inicio } = parsed.data;
		// Férias entram só pelo cartão Férias (E56): o modal não as oferece, e o
		// POST direto não passa por aqui.
		if (!AFASTAMENTOS[subtipo].cadastravel) {
			return fail(400, {
				error:
					subtipo === 'ferias'
						? 'Férias são lançadas pelo cartão Férias, não como afastamento.'
						: 'Este tipo de afastamento não é lançado pela tela.'
			});
		}
		const regra = regraDePrazo(subtipo, parsed.data.adicional === true);
		if (regra.soGestao && modo !== 'direto') {
			return fail(403, { error: 'Medidas disciplinares e processuais são lançadas pelo DPI SUL.' });
		}
		if (regra.exigeCid && !parsed.data.tipo_cid) {
			return fail(400, { error: 'Na LTS, informe a classificação do CID (CID-F ou CID-Outras).' });
		}
		const tipoCid = regra.exigeCid ? parsed.data.tipo_cid || null : null;

		// O prazo: fixo → o fim sai do catálogo; sem prazo → pode faltar; senão,
		// o que veio, coerente.
		let dataFim: string | null = parsed.data.data_fim || null;
		let qtdDias: number | null;
		if (regra.diasFixos != null) {
			qtdDias = regra.diasFixos;
			dataFim = adicionarDias(data_inicio, regra.diasFixos - 1);
		} else if (!dataFim) {
			if (!regra.semPrazo)
				return fail(400, { error: 'Informe a quantidade de dias ou a data final.' });
			qtdDias = null;
		} else {
			if (dataFim < data_inicio) {
				return fail(400, { error: 'A data final não pode ser anterior à data inicial.' });
			}
			qtdDias = diffDiasInclusivo(data_inicio, dataFim);
		}
		const descricao =
			[
				parsed.data.descricao?.trim() || null,
				subtipo === 'maternidade' && parsed.data.adicional ? 'Com a prorrogação de 60 dias.' : null
			]
				.filter(Boolean)
				.join(' ') || null;
		// Afastamento não abrange férias programadas (decisão dele, 20/09): impede.
		const ocupados = [
			...ocupadosDoHistorico(await listarHistoricoPolicial(db, id)),
			...ocupadosDoAbono((await listarFeriasDoPolicial(db, id)).fracoes)
		];
		const conflitos = conflitosDoAfastamento({ inicio: data_inicio, fim: dataFim }, ocupados);
		const conflito = conflitos.find((c) => c.nivel === 'erro');
		if (conflito) return fail(400, { error: conflito.texto });
		const avisosArt16 = conflitos.filter((c) => c.nivel === 'aviso').map((c) => c.texto);
		const rotulo = LABEL_SUBTIPO_AFASTAMENTO[subtipo];
		const periodo = dataFim
			? `${data_inicio} a ${dataFim}`
			: `a partir de ${data_inicio} (sem prazo)`;

		return concluirAcaoRH(event, auth, formData, {
			acao: {
				tipo: 'afastamento',
				subtipo,
				descricao,
				data_inicio,
				data_fim: dataFim,
				qtd_dias: qtdDias,
				nup: nup.formatado,
				tipo_cid: tipoCid
			},
			resumo: `${rotulo}${tipoCid ? ` (${tipoCid})` : ''}: ${periodo}`,
			// O tipo, o período e o NUP são o pedido; não há motivo à parte a escrever.
			justificativaDispensada: true,
			metadados: {
				subtipo,
				nup: nup.formatado,
				tipo_cid: tipoCid,
				// CID-F: a Portaria 39/2026 obriga o recolhimento do armamento — fica
				// na auditoria e é o que o aviso ao DPI SUL vai ler.
				portaria_39: tipoCid === 'CID-F',
				avisos: avisosArt16
			},
			avisos: avisosArt16,
			recarregar: () =>
				modo === 'solicitacao' ? listarSolicitacoesAcaoDoPolicial(db, id) : Promise.resolve(null)
		});
	},

	/**
	 * RETORNO ANTECIPADO (decisão dele, 20/09): o servidor voltou antes do
	 * previsto — o afastamento encurta até a véspera, com a data e o NUP do
	 * retorno. Segue o rito dos outros atos: a unidade PEDE (pedido
	 * `retorno_antecipado`, pendente até o Admin Geral aprovar) e o DPI SUL
	 * registra direto. Férias não passam por aqui (têm a suspensão).
	 */
	retornoAntecipado: async (event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo, modo } = auth;

		const formData = await event.request.formData();
		const solicitacaoId = inteiroNaFaixa(formData, 'solicitacao_id', 1, 99_999_999);
		const retorno = dataIso(formData, 'data_retorno');
		const nup = conferirNup(textoLimitado(formData, 'nup', 40), false);
		if (!solicitacaoId || !retorno)
			return fail(400, { error: 'Informe o pedido de afastamento e a data do retorno.' });
		if (!nup.ok) return fail(400, { error: nup.erro });
		// O pedido aprovado não guarda o id do evento que gerou: acha-se pelo que
		// os dois têm em comum (servidor, tipo, subtipo, 1º dia).
		const pedido = await buscarSolicitacaoAcao(db, solicitacaoId);
		if (!pedido || pedido.policial_id !== id || pedido.status !== 'aprovada') {
			return fail(404, { error: 'Pedido de afastamento aprovado não encontrado.' });
		}
		const ev = (await listarHistoricoPolicial(db, id)).find(
			(h) =>
				h.tipo === 'afastamento' &&
				h.subtipo === pedido.subtipo &&
				h.data_inicio === pedido.data_inicio
		);
		if (!ev) return fail(404, { error: 'Afastamento não encontrado na linha do tempo.' });
		const eventoId = ev.id;
		if (retorno <= ev.data_inicio! || (ev.data_fim && retorno > ev.data_fim)) {
			return fail(409, {
				error: 'O retorno precisa cair dentro do afastamento (depois do início e até o fim).'
			});
		}
		const rotuloAf =
			LABEL_SUBTIPO_AFASTAMENTO[ev.subtipo as keyof typeof LABEL_SUBTIPO_AFASTAMENTO] ?? ev.subtipo;

		if (modo === 'solicitacao') {
			// Um pedido por afastamento: enquanto um está pendente, o botão some.
			const jaPedido = (await listarSolicitacoesAcaoDoPolicial(db, id)).some(
				(p) =>
					p.tipo === 'retorno_antecipado' &&
					p.status === 'pendente' &&
					p.subtipo === ev.subtipo &&
					p.data_inicio === ev.data_inicio
			);
			if (jaPedido)
				return fail(409, {
					error: 'Já há um pedido de retorno antecipado aguardando o Admin Geral.'
				});
			await criarSolicitacaoAcao(db, {
				policial_id: id,
				tipo: 'retorno_antecipado',
				subtipo: ev.subtipo,
				descricao: `Retorno antecipado — ${rotuloAf} de ${ev.data_inicio}`,
				data_inicio: ev.data_inicio,
				data_fim: ev.data_fim,
				data_evento: retorno,
				nup: nup.formatado || null,
				justificativa: '',
				solicitante_id: u.id,
				solicitante_nome: u.nome
			});
			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'solicitar_acao_policial',
					usuario: u,
					entidade: 'policial',
					entidade_id: id,
					alvo_tipo: 'policial',
					alvo_id: id,
					alvo_nome: alvo.nome,
					detalhes: `Solicitação de retorno antecipado em ${retorno}: ${rotuloAf} de ${ev.data_inicio}${nup.formatado ? ` (NUP ${nup.formatado})` : ''}`,
					metadados: {
						tipo: 'retorno_antecipado',
						historico_id: eventoId,
						retorno,
						nup: nup.formatado
					},
					...contexto
				},
				{ env }
			);
			return { success: true, solicitacoesAcao: await listarSolicitacoesAcaoDoPolicial(db, id) };
		}

		const r = await encurtarAfastamento(db, eventoId, retorno, nup.formatado);
		if (!r) {
			return fail(409, {
				error:
					'O retorno precisa cair dentro do afastamento (depois do início e até o fim); férias voltam pela suspensão.'
			});
		}
		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'registrar_afastamento',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `Retorno antecipado em ${retorno}: ${LABEL_SUBTIPO_AFASTAMENTO[ev.subtipo as keyof typeof LABEL_SUBTIPO_AFASTAMENTO] ?? ev.subtipo} de ${ev.data_inicio} passou a terminar em ${r.data_fim}${nup.formatado ? ` (NUP ${nup.formatado})` : ''}`,
				metadados: {
					historico_id: eventoId,
					retorno,
					nup: nup.formatado,
					fim_anterior: ev.data_fim
				},
				...contexto
			},
			{ env }
		);
		await avisarOutroLado(db, u, {
			cartao: 'servidores',
			tipo: 'retorno_antecipado',
			titulo: `Retorno antecipado de ${alvo.nome} em ${retorno}`,
			texto: `${LABEL_SUBTIPO_AFASTAMENTO[ev.subtipo as keyof typeof LABEL_SUBTIPO_AFASTAMENTO] ?? ev.subtipo} encurtado até ${r.data_fim}${nup.formatado ? ` · NUP ${nup.formatado}` : ''} — por ${u.nome}`,
			link: `/servidores/${id}`,
			lotacoes: [alvo.lotacao]
		});
		return { success: true };
	},

	/**
	 * CORRIGIR um afastamento lançado errado — só o Admin Geral (decisão dele,
	 * 20/09). As mesmas regras do lançamento (prazo fixo, CID na LTS, NUP);
	 * o antes e o depois vão para a auditoria e a unidade recebe a notícia.
	 */
	corrigirAfastamento: async (event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;
		if (!isAdminGeral(u))
			return fail(403, { error: 'Só o Administrador Geral corrige lançamentos.' });

		const formData = await event.request.formData();
		const eventoId = inteiroNaFaixa(formData, 'historico_id', 1, 99_999_999);
		if (!eventoId) return fail(400, { error: 'Afastamento inválido.' });
		const qtdRaw = formData.get('qtd_dias')?.toString() || '';
		const nup = conferirNup(textoLimitado(formData, 'nup', 40), false);
		if (!nup.ok) return fail(400, { error: nup.erro });
		const parsed = afastamentoSchema.safeParse({
			subtipo: formData.get('subtipo')?.toString() || '',
			descricao: formData.get('descricao')?.toString() || '',
			data_inicio: formData.get('data_inicio')?.toString() || '',
			data_fim: formData.get('data_fim')?.toString() || '',
			qtd_dias: qtdRaw === '' ? undefined : qtdRaw,
			nup: nup.formatado,
			tipo_cid: formData.get('tipo_cid')?.toString() || '',
			adicional: formData.get('adicional')?.toString() === 'on'
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const { subtipo, data_inicio } = parsed.data;
		if (!AFASTAMENTOS[subtipo].cadastravel) {
			return fail(400, { error: 'Este tipo de afastamento não é lançado pela tela.' });
		}
		const regra = regraDePrazo(subtipo, parsed.data.adicional === true);
		if (regra.exigeCid && !parsed.data.tipo_cid) {
			return fail(400, { error: 'Na LTS, informe a classificação do CID (CID-F ou CID-Outras).' });
		}
		let dataFim: string | null = parsed.data.data_fim || null;
		let qtdDias: number | null;
		if (regra.diasFixos != null) {
			qtdDias = regra.diasFixos;
			dataFim = adicionarDias(data_inicio, regra.diasFixos - 1);
		} else if (!dataFim) {
			if (!regra.semPrazo)
				return fail(400, { error: 'Informe a quantidade de dias ou a data final.' });
			qtdDias = null;
		} else {
			if (dataFim < data_inicio) {
				return fail(400, { error: 'A data final não pode ser anterior à data inicial.' });
			}
			qtdDias = diffDiasInclusivo(data_inicio, dataFim);
		}
		const antes = await corrigirAfastamento(db, eventoId, {
			subtipo,
			descricao: parsed.data.descricao?.trim() || null,
			data_inicio,
			data_fim: dataFim,
			qtd_dias: qtdDias,
			nup: nup.formatado || null,
			tipo_cid: regra.exigeCid ? parsed.data.tipo_cid || null : null
		});
		if (!antes || antes.policial_id !== id)
			return fail(404, { error: 'Afastamento não encontrado.' });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'registrar_afastamento',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `Afastamento corrigido: ${LABEL_SUBTIPO_AFASTAMENTO[subtipo]} ${data_inicio} a ${dataFim ?? '(sem prazo)'}`,
				dados_antes: {
					subtipo: antes.subtipo,
					data_inicio: antes.data_inicio,
					data_fim: antes.data_fim,
					nup: antes.nup,
					tipo_cid: antes.tipo_cid
				},
				dados_depois: {
					subtipo,
					data_inicio,
					data_fim: dataFim,
					nup: nup.formatado,
					tipo_cid: parsed.data.tipo_cid || null
				},
				...contexto
			},
			{ env }
		);
		await avisarOutroLado(db, u, {
			cartao: 'servidores',
			tipo: 'afastamento_corrigido',
			titulo: `Afastamento de ${alvo.nome} corrigido pelo DPI SUL`,
			texto: `${LABEL_SUBTIPO_AFASTAMENTO[subtipo]}: ${data_inicio} a ${dataFim ?? '(sem prazo)'}`,
			link: `/servidores/${id}`,
			lotacoes: [alvo.lotacao]
		});
		return { success: true };
	},

	/** EXCLUIR um afastamento lançado errado — só o Admin Geral. */
	excluirAfastamento: async (event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { u, db, id, alvo } = auth;
		if (!isAdminGeral(u))
			return fail(403, { error: 'Só o Administrador Geral exclui lançamentos.' });

		const formData = await event.request.formData();
		const eventoId = inteiroNaFaixa(formData, 'historico_id', 1, 99_999_999);
		if (!eventoId) return fail(400, { error: 'Afastamento inválido.' });
		const ev = await buscarEventoHistorico(db, eventoId);
		if (!ev || ev.policial_id !== id) return fail(404, { error: 'Afastamento não encontrado.' });
		const apagado = await excluirAfastamento(db, eventoId);
		if (!apagado) return fail(409, { error: 'Férias se excluem pelo cartão Férias.' });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'registrar_afastamento',
				usuario: u,
				entidade: 'policial',
				entidade_id: id,
				alvo_tipo: 'policial',
				alvo_id: id,
				alvo_nome: alvo.nome,
				detalhes: `Afastamento EXCLUÍDO (lançado errado): ${LABEL_SUBTIPO_AFASTAMENTO[apagado.subtipo as keyof typeof LABEL_SUBTIPO_AFASTAMENTO] ?? apagado.subtipo} ${apagado.data_inicio} a ${apagado.data_fim ?? '(sem prazo)'}`,
				dados_antes: {
					subtipo: apagado.subtipo,
					data_inicio: apagado.data_inicio,
					data_fim: apagado.data_fim,
					nup: apagado.nup
				},
				...contexto
			},
			{ env }
		);
		await avisarOutroLado(db, u, {
			cartao: 'servidores',
			tipo: 'afastamento_excluido',
			titulo: `Afastamento de ${alvo.nome} excluído pelo DPI SUL (lançado errado)`,
			texto: `${LABEL_SUBTIPO_AFASTAMENTO[apagado.subtipo as keyof typeof LABEL_SUBTIPO_AFASTAMENTO] ?? apagado.subtipo}: ${apagado.data_inicio} a ${apagado.data_fim ?? '(sem prazo)'}`,
			link: `/servidores/${id}`,
			lotacoes: [alvo.lotacao]
		});
		return { success: true };
	},

	// ---- Desvinculação: baixa do policial (inativa e registra) ----
	registrarDesvinculacao: async (event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { alvo, modo } = auth;
		if (modo !== 'direto') {
			return fail(403, { error: 'Movimentação e desvinculação são feitas pelo DPI SUL.' });
		}

		const formData = await event.request.formData();
		const parsed = desvinculacaoSchema.safeParse({
			destino: formData.get('destino')?.toString() || '',
			data_evento: formData.get('data_evento')?.toString() || '',
			nup: formData.get('nup')?.toString() || ''
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });

		return concluirAcaoRH(event, auth, formData, {
			acao: {
				tipo: 'desvinculacao',
				descricao: parsed.data.destino,
				unidade_origem: alvo.lotacao || '',
				unidade_destino: parsed.data.destino,
				data_evento: parsed.data.data_evento,
				nup: parsed.data.nup || null
			},
			resumo: `${alvo.nome} (mat. ${alvo.matricula}) → ${parsed.data.destino}`,
			metadados: { nup: parsed.data.nup || null, data: parsed.data.data_evento },
			// Modo direto só: nada a recarregar ao lado do painel.
			recarregar: () => Promise.resolve(null)
		});
	},

	// ---- Férias: frações do Guardião, reprogramação à COGEP e abono ----
	...actionsFerias
};

/** As três ações de RH divergem só nisto; o resto do caminho é comum. */
interface PedidoRH {
	acao: AcaoRH;
	/** Frase curta do ato, para a trilha de auditoria. */
	resumo: string;
	metadados: Record<string, unknown>;
	/** No modo solicitação, a lista que a tela repõe sem `invalidateAll`. */
	recarregar: () => Promise<unknown>;
	/**
	 * O pedido não pede motivo à parte (afastamento: tipo, período e NUP já
	 * são o pedido — decisão dele, 20/09). Grava justificativa vazia.
	 */
	justificativaDispensada?: boolean;
	/** Avisos que não travam (art. 16 do abono…): vão no toast de quem registrou. */
	avisos?: string[];
}

/**
 * O trecho comum das três ações de RH: sobe o anexo, e então EXECUTA (modo
 * `direto`) ou REGISTRA O PEDIDO (modo `solicitacao`), auditando o que
 * aconteceu.
 *
 * A justificativa só é exigida no modo `solicitacao` — no `direto` não há a quem
 * justificar: o ato já é a decisão de quem tem poder para tomá-la, e a trilha de
 * auditoria registra quem o tomou. Ela é lida ANTES do upload de propósito:
 * pedido sem motivo não deve deixar PDF no bucket.
 */
async function concluirAcaoRH(
	event: RequestEvent,
	auth: FichaAutorizada,
	formData: FormData,
	pedido: PedidoRH
) {
	const { u, db, id, alvo, modo } = auth;

	let justificativa = '';
	if (modo === 'solicitacao' && !pedido.justificativaDispensada) {
		const lida = lerJustificativa(formData);
		if ('erro' in lida) return fail(400, { error: lida.erro });
		justificativa = lida.texto;
	}

	let doc: { key: string; nome: string } | null;
	try {
		doc = await uploadDocumento(event, formData, id);
	} catch (e) {
		return fail(400, { error: mensagemDeErro(e, 'Falha no upload do documento') });
	}

	const acao: AcaoRH = {
		...pedido.acao,
		documento_r2_key: doc?.key ?? null,
		documento_nome: doc?.nome ?? null
	};

	try {
		if (modo === 'direto') {
			await executarAcaoRH(db, id, acao, { id: u.id, nome: u.nome });
		} else {
			await criarSolicitacaoAcao(db, {
				policial_id: id,
				...acao,
				justificativa,
				solicitante_id: u.id,
				solicitante_nome: u.nome
			});
		}
	} catch (e) {
		return await abortarComLimpezaR2(event, doc, e, acao.tipo);
	}

	const ACAO_AUDIT = {
		movimentacao: 'registrar_movimentacao',
		afastamento: 'registrar_afastamento',
		desvinculacao: 'desvincular_policial'
	} as const;

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: modo === 'direto' ? ACAO_AUDIT[acao.tipo] : 'solicitar_acao_policial',
			usuario: u,
			entidade: 'policial',
			entidade_id: id,
			alvo_tipo: 'policial',
			alvo_id: id,
			alvo_nome: alvo.nome,
			resultado: 'sucesso',
			detalhes:
				modo === 'direto'
					? `${ROTULO_ACAO[acao.tipo]}: ${pedido.resumo}`
					: `Solicitação de ${ROTULO_ACAO[acao.tipo].toLowerCase()}: ${pedido.resumo}`,
			metadados:
				modo === 'direto'
					? pedido.metadados
					: { ...pedido.metadados, tipo: acao.tipo, justificativa },
			...contexto
		},
		{ env }
	);

	// O aviso (E59): no modo direto a delegacia fica sabendo do ato do DPI SUL
	// (na movimentação, a de origem E a de destino). No modo solicitação a
	// fila já é a pendência do Admin Geral — só a LTS por CID-F vira notícia
	// também, porque a Portaria 39 não espera a homologação para valer.
	const ehCidF = acao.tipo === 'afastamento' && acao.tipo_cid === 'CID-F';
	if (modo === 'direto' || ehCidF) {
		await avisarOutroLado(db, u, {
			cartao: 'servidores',
			tipo: ehCidF ? 'afastamento_cid_f' : `rh_${acao.tipo}`,
			titulo: ehCidF
				? `LTS por CID-F: ${alvo.nome} — Portaria 39/2026 (recolher o armamento)`
				: `${ROTULO_ACAO[acao.tipo]} de ${alvo.nome} registrada pelo DPI SUL`,
			texto: pedido.resumo,
			link: `/servidores/${id}`,
			lotacoes: [alvo.lotacao, acao.unidade_destino]
		});
	}

	const solicitacoesAcao = await pedido.recarregar();
	return { success: true, tipo: acao.tipo, modo, solicitacoesAcao, avisos: pedido.avisos ?? [] };
}

/** O nome do ato em PT-BR — a mesma palavra na trilha e na tela. */
const ROTULO_ACAO: Record<AcaoRH['tipo'], string> = {
	movimentacao: 'Movimentação',
	afastamento: 'Afastamento',
	desvinculacao: 'Desvinculação'
};

function formData2Bool(v: FormDataEntryValue | null): boolean {
	const s = String(v ?? '').toLowerCase();
	return s === '1' || s === 'true' || s === 'on';
}
