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
	vincularAdminGeral,
	desvincularAdminGeral,
	buscarModulosAdminVinculado,
	atualizarModuloAdminVinculado,
	atualizarPolicialComHistorico,
	listarHistoricoPolicial,
	afastamentoVigente,
	criarSolicitacoesCadastro,
	criarSolicitacaoAcao,
	listarSolicitacoesDoPolicial,
	listarSolicitacoesAcaoDoPolicial,
	auditar,
	contextoDeEvento,
	listarCredenciaisDoDono,
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
import { isAdminGeral } from '$lib/auth';
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
import { hojeBrasilISO } from '$lib/utils/datas';
import type { RequestEvent } from './$types';
import { mensagemDeErro } from '$lib/utils/erro';

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
		modulosAdmin,
		historico,
		credenciaisPasskey,
		solicitacoesCampo,
		solicitacoesAcao
	] = await Promise.all([
		// A lista de destinos de MOVIMENTAÇÃO é a corporação inteira nos dois
		// modos, e para o admin com escopo isso é deliberado: transferir servidor
		// para FORA da unidade é o caso comum, e no modo `solicitacao` quem decide
		// é o Admin Geral. Restringir aos destinos que ele já administra tornaria
		// impossível pedir a saída de alguém da unidade.
		listarLotacoes(db),
		listarUnidades(db),
		buscarModulosAdminVinculado(db, id),
		listarHistoricoPolicial(db, id),
		// A credencial pertence à PESSOA: quem tem conta admin vinculada tem duas
		// linhas, e consultar pelo par cru mostraria "sem chave" para quem tem.
		resolverCredencial(db, 'policial', id).then((c) => listarCredenciaisDoDono(db, c.dono)),
		listarSolicitacoesDoPolicial(db, id),
		listarSolicitacoesAcaoDoPolicial(db, id)
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
		modo,
		isAdmin: isAdm,
		ehAdminGeral,
		modulosAdmin,
		historico,
		solicitacoesCampo,
		solicitacoesAcao,
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

/** Campos que mudam com frequência técnica e não interessam ao histórico funcional. */
const CAMPOS_IGNORAR_DIFF = new Set(['updated_at', 'created_at', 'id']);

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
			const mudanca = { ...parsed.data, email: data.email ?? undefined };
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

			const atual = (alvo as unknown as Record<string, string | null>)[campo] ?? null;
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
	registrarMovimentacao: async (event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { db, id, alvo, modo } = auth;

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
			// Recarrega para devolver o que a tela mostra ao lado do painel.
			recarregar: () =>
				modo === 'solicitacao' ? listarSolicitacoesAcaoDoPolicial(db, id) : Promise.resolve(null)
		});
	},

	// ---- Afastamento: férias/licenças (apenas registra na linha do tempo) ----
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
		const parsed = afastamentoSchema.safeParse({
			subtipo: formData.get('subtipo')?.toString() || '',
			descricao: formData.get('descricao')?.toString() || '',
			data_inicio: formData.get('data_inicio')?.toString() || '',
			data_fim: formData.get('data_fim')?.toString() || '',
			qtd_dias: qtdRaw === '' ? undefined : qtdRaw,
			nup: formData.get('nup')?.toString() || ''
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		if (parsed.data.data_fim < parsed.data.data_inicio) {
			return fail(400, { error: 'A data final não pode ser anterior à data inicial.' });
		}

		return concluirAcaoRH(event, auth, formData, {
			acao: {
				tipo: 'afastamento',
				subtipo: parsed.data.subtipo,
				descricao: parsed.data.descricao || null,
				data_inicio: parsed.data.data_inicio,
				data_fim: parsed.data.data_fim,
				qtd_dias: parsed.data.qtd_dias ?? null,
				nup: parsed.data.nup || null
			},
			resumo: `${LABEL_SUBTIPO_AFASTAMENTO[parsed.data.subtipo]}: ${parsed.data.data_inicio} a ${parsed.data.data_fim}`,
			metadados: { subtipo: parsed.data.subtipo, nup: parsed.data.nup || null },
			recarregar: () =>
				modo === 'solicitacao' ? listarSolicitacoesAcaoDoPolicial(db, id) : Promise.resolve(null)
		});
	},

	// ---- Desvinculação: baixa do policial (inativa e registra) ----
	registrarDesvinculacao: async (event) => {
		const auth = await carregarFichaDoPolicial(
			getDB(event.platform),
			event.locals.usuario,
			event.params.id
		);
		if ('erro' in auth) return auth.erro;
		const { db, id, alvo, modo } = auth;

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
			recarregar: () =>
				modo === 'solicitacao' ? listarSolicitacoesAcaoDoPolicial(db, id) : Promise.resolve(null)
		});
	}
};

/** As três ações de RH divergem só nisto; o resto do caminho é comum. */
interface PedidoRH {
	acao: AcaoRH;
	/** Frase curta do ato, para a trilha de auditoria. */
	resumo: string;
	metadados: Record<string, unknown>;
	/** No modo solicitação, a lista que a tela repõe sem `invalidateAll`. */
	recarregar: () => Promise<unknown>;
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
	if (modo === 'solicitacao') {
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

	const solicitacoesAcao = await pedido.recarregar();
	return { success: true, tipo: acao.tipo, modo, solicitacoesAcao };
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
