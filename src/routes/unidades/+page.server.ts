/**
 * Cadastro de unidades (`/unidades`) — restrito ao SUPER ADMIN, não ao Admin
 * Geral: o nome da unidade é a chave que amarra lotação do policial, escala e
 * cabeçalho dos documentos, então renomear tem efeito em cascata pelo sistema
 * inteiro.
 *
 * **Unidade não se exclui.** Só se desativa (`definirAtivo`), e é por isso que
 * não há action de excluir aqui. `gise_assinaturas_relatorios.seccional_id`
 * referencia `unidades(id)` com `ON DELETE CASCADE`, e o D1 aplica FK de
 * verdade: um DELETE levava junto o registro do ato de assinar, e o portal
 * público `/validar` passava a negar um documento que alguém já tinha em mãos.
 * Escala e lotação, que ligam por NOME e sem FK, simplesmente ficavam órfãs sem
 * erro nenhum.
 *
 * O `load` usa `listarTodasUnidades` (inclui desativadas) porque esta é a tela
 * que as gerencia; todo o resto do sistema usa `listarUnidades`, que só devolve
 * ativas.
 *
 * A FK citada acima passou a `ON DELETE RESTRICT` na migração 0038 — o banco
 * agora recusa a exclusão mesmo por `wrangler d1 execute`. A ausência da action
 * de excluir aqui é a primeira barreira; a FK é a segunda.
 */
import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	tryGetR2,
	listarTodasUnidades,
	criarUnidade,
	atualizarUnidade,
	motivoParaRecusarSuperior,
	definirUnidadeAtiva,
	vinculosDaUnidade,
	descreverVinculosUnidade,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { unidadeSchema } from '$lib/schemas';
import { eq } from 'drizzle-orm';
import { unidades, type Unidade } from '$lib/server/schema';
import { ehViolacaoUnique, mensagemComCausas } from '$lib/server/db-errors';
import { ConflitoDeRenomeacaoUnidade } from '$lib/db/unidades';
import { logger } from '$lib/server/logger';
import { detectarTipoImagem } from '$lib/server/assinatura/selfie-upload';

/** Teto da foto da fachada: 3 MB já é uma foto de celular em boa resolução. */
const FOTO_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Lê e valida os campos de unidade do FormData (mesmos campos em criar/editar).
 * Os `tem_*` chegam como `'on'` porque o modal os envia por input oculto.
 */
function lerUnidadeDoForm(data: FormData) {
	const nome = data.get('nome')?.toString() || '';
	const tipo = data.get('tipo')?.toString() as Unidade['tipo'];
	const cidade = data.get('cidade')?.toString() || '';
	const parsed = unidadeSchema.safeParse({
		nome,
		tipo,
		seccional_id: data.get('seccional_id') ? Number(data.get('seccional_id')) : null,
		tem_plantao: data.get('tem_plantao') === 'on',
		tem_expediente: data.get('tem_expediente') === 'on',
		tem_fds: data.get('tem_fds') === 'on',
		cidade,
		sigla: data.get('sigla')?.toString() || '',
		// A ficha (0085). O modal de cadastro não envia estes campos: caem nos
		// padrões do schema.
		endereco: data.get('endereco')?.toString() ?? '',
		telefone: data.get('telefone')?.toString() ?? '',
		email: data.get('email')?.toString() ?? '',
		ais: data.get('ais')?.toString() ?? '',
		xadrezes: data.has('xadrezes') ? Number(data.get('xadrezes')) : 0,
		tira_gravame: data.get('tira_gravame') === 'on',
		foto_url: data.get('foto_url')?.toString() ?? ''
	});
	return { parsed, nome, tipo, cidade };
}

/**
 * A foto da fachada enviada pelo modal de edição, já validada pelo CONTEÚDO
 * (magic bytes de JPEG/PNG — o `type` do arquivo é declaração do navegador),
 * ou `null` quando não veio arquivo. `string` = motivo da recusa.
 */
async function lerFotoDoForm(
	data: FormData
): Promise<{ bytes: Uint8Array; ext: 'jpg' | 'png' } | null | string> {
	const foto = data.get('foto');
	if (!(foto instanceof File) || foto.size === 0) return null;
	if (foto.size > FOTO_MAX_BYTES) return 'A foto precisa ter no máximo 3 MB';
	const bytes = new Uint8Array(await foto.arrayBuffer());
	const ext = detectarTipoImagem(bytes);
	if (!ext) return 'A foto precisa ser JPEG ou PNG';
	return { bytes, ext };
}

/**
 * Nome ou sigla duplicados viram 409 legível; o resto é logado e sai como 500
 * genérico — a mensagem crua do Drizzle traz o SQL e os parâmetros, que não
 * devem chegar à tela.
 *
 * As duas colunas únicas se distinguem pela coluna que o SQLite nomeia na
 * mensagem ("UNIQUE constraint failed: unidades.sigla"); sem isso, sigla
 * repetida diria "este nome" e o admin procuraria o erro no campo errado.
 */
function falhaDeGravacao(e: unknown, acao: string) {
	if (ehViolacaoUnique(e)) {
		const coluna = /unidades\.sigla/.test(mensagemComCausas(e)) ? 'sigla' : 'nome';
		return fail(409, {
			error: `Já existe uma unidade com est${coluna === 'sigla' ? 'a' : 'e'} ${coluna}`
		});
	}
	// Renomeação concorrente: 409 com a mensagem da própria exceção, que já
	// explica o que aconteceu e o que fazer (FLW-UNIDADE-004).
	if (e instanceof ConflitoDeRenomeacaoUnidade) {
		return fail(409, { error: e.message });
	}
	logger.error(`[unidades/${acao}]`, { error: mensagemComCausas(e) });
	return fail(500, { error: 'Erro ao salvar a unidade. Tente novamente.' });
}

export const load: PageServerLoad = async ({ locals, platform, depends }) => {
	depends('app:unidades');

	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	if (!u.isSuperAdmin) {
		redirect(302, '/');
	}

	const db = getDB(platform);
	const lista = await listarTodasUnidades(db);

	return {
		unidades: lista
	};
};

export const actions: Actions = {
	criar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !u.isSuperAdmin)
			return fail(403, { error: 'Apenas o Super Administrador pode cadastrar unidades' });

		const { parsed, nome, tipo, cidade } = lerUnidadeDoForm(await request.formData());
		if (!parsed.success) {
			// Devolve os campos preenchidos para o modal não perder o que foi digitado.
			return fail(400, {
				error: parsed.error.issues[0].message,
				fields: { nome, tipo, cidade }
			});
		}

		const db = getDB(platform);
		try {
			await criarUnidade(db, parsed.data);
			// `criarUnidade` não devolve o id; recupera pelo nome (único) para
			// registrar o alvo na auditoria.
			const novaId =
				(
					await db
						.select({ id: unidades.id })
						.from(unidades)
						.where(eq(unidades.nome, nome.trim()))
						.get()
				)?.id ?? null;
			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'criar_unidade',
					usuario: u,
					entidade: 'unidade',
					entidade_id: novaId,
					alvo_tipo: 'unidade',
					alvo_id: novaId,
					alvo_nome: nome.trim(),
					detalhes: `Unidade criada: ${nome.trim()}`,
					dados_depois: parsed.data,
					...contexto
				},
				{ env }
			);
			return { success: true };
		} catch (e: unknown) {
			return falhaDeGravacao(e, 'criar');
		}
	},

	editar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !u.isSuperAdmin)
			return fail(403, { error: 'Apenas o Super Administrador pode editar unidades' });

		const data = await request.formData();
		const id = Number(data.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'ID inválido' });
		const { parsed } = lerUnidadeDoForm(data);
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message });
		}
		const foto = await lerFotoDoForm(data);
		if (typeof foto === 'string') return fail(400, { error: foto });
		const removerFoto = data.get('remover_foto') === 'on';

		const db = getDB(platform);
		// Trocar o pai é a única edição capaz de fechar um ciclo na árvore.
		const recusa = await motivoParaRecusarSuperior(db, id, parsed.data.seccional_id);
		if (recusa) return fail(400, { error: recusa });

		// Estado anterior para o diff da auditoria (a linha muda logo abaixo).
		const antes = await db.select().from(unidades).where(eq(unidades.id, id)).get();
		if (!antes) return fail(404, { error: 'Unidade não encontrada' });
		try {
			await atualizarUnidade(db, id, parsed.data);

			// A foto vai para o R2 na MESMA chave da importação
			// (`unidades/{id}/foto.<ext>`) e a ficha passa a servi-la por
			// `foto_key`; o link de origem fica como reserva. Remover apaga a
			// cópia e zera a chave — o link, se o admin o deixou, volta a valer.
			if (foto || removerFoto) {
				const r2 = tryGetR2(platform);
				if (!r2) return fail(503, { error: 'Armazenamento de fotos indisponível' });
				if (antes.foto_key) await r2.delete(antes.foto_key);
				let fotoKey: string | null = null;
				if (foto) {
					fotoKey = `unidades/${id}/foto.${foto.ext}`;
					await r2.put(fotoKey, foto.bytes, {
						httpMetadata: { contentType: foto.ext === 'png' ? 'image/png' : 'image/jpeg' }
					});
				}
				await db.update(unidades).set({ foto_key: fotoKey }).where(eq(unidades.id, id));
			}
			const { contexto, env } = contextoDeEvento(event);
			await auditar(
				db,
				{
					acao: 'editar_unidade',
					usuario: u,
					entidade: 'unidade',
					entidade_id: id,
					alvo_tipo: 'unidade',
					alvo_id: id,
					alvo_nome: parsed.data.nome.trim(),
					detalhes: `Unidade editada: ${parsed.data.nome.trim()}`,
					dados_antes: antes,
					dados_depois: {
						...parsed.data,
						foto: foto ? 'nova' : removerFoto ? 'removida' : 'mantida'
					},
					...contexto
				},
				{ env }
			);
			return { success: true };
		} catch (e: unknown) {
			return falhaDeGravacao(e, 'editar');
		}
	},

	/**
	 * Desativa ou reativa a unidade. **Não existe ação de excluir** — ver o
	 * cabeçalho: apagar a linha destruiria prova de documento assinado.
	 *
	 * Desativar nunca é recusado. Os vínculos são só informados na confirmação,
	 * porque continuam válidos depois: escala, lotação e assinatura antigas
	 * seguem resolvendo a unidade normalmente.
	 */
	definirAtivo: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !u.isSuperAdmin)
			return fail(403, { error: 'Apenas o Super Administrador pode desativar unidades' });

		const data = await request.formData();
		const id = Number(data.get('unidade_id'));
		if (isNaN(id)) return fail(400, { error: 'ID inválido' });
		const ativo = data.get('ativo') === 'true';

		const db = getDB(platform);
		const unidade = await db.select().from(unidades).where(eq(unidades.id, id)).get();
		if (!unidade) return fail(404, { error: 'Unidade não encontrada' });

		await definirUnidadeAtiva(db, id, ativo);

		const vinculos = ativo ? null : await vinculosDaUnidade(db, id);
		const resumo = vinculos ? descreverVinculosUnidade(vinculos) : null;

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: ativo ? 'reativar_unidade' : 'desativar_unidade',
				usuario: u,
				entidade: 'unidade',
				entidade_id: id,
				alvo_tipo: 'unidade',
				alvo_id: id,
				alvo_nome: unidade.nome,
				detalhes: ativo
					? `Unidade reativada: ${unidade.nome}`
					: `Unidade desativada: ${unidade.nome}${resumo ? ` (mantém ${resumo})` : ''}`,
				dados_antes: unidade,
				dados_depois: { ...unidade, ativo },
				...contexto
			},
			{ env }
		);
		return { success: true, ativo };
	}
};
