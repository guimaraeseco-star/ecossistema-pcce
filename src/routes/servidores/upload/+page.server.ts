/**
 * `/servidores/upload` — importação de servidores em massa por CSV (Admin Geral).
 *
 * O arquivo vem preenchido à mão pelas unidades, então o processamento é
 * TOLERANTE POR LINHA: cada linha inválida vira um item na lista de erros
 * devolvida à tela, com o número da linha, e a importação segue. Rejeitar o
 * arquivo inteiro por causa de uma matrícula repetida obrigaria o operador a
 * reeditar e reenviar tudo.
 *
 * Colunas esperadas: A Nome · B Matrícula · C Cargo (DPC/OIP) · D Lotação.
 * A senha inicial é aleatória — o servidor entra pelo fluxo de primeiro acesso.
 */

import { fail, redirect } from '@sveltejs/kit';
import { getDB, listarUnidades, auditar, contextoDeEvento } from '$lib/db';
import { policiais as policiaisTable } from '$lib/server/schema';
import { limparMatricula, normalizarTexto } from '$lib/utils/formato';
import { gerarSenhaAleatoriaHash, isAdminGeral } from '$lib/auth';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!isAdminGeral(locals.usuario)) {
		redirect(302, '/');
	}
};

/**
 * Casa o nome digitado na planilha com uma unidade cadastrada, ignorando
 * acentos, caixa e espaços (`normalizarTexto`). Sem correspondência devolve
 * string vazia: a lotação fica em branco e a linha é sinalizada, em vez de
 * cadastrar o servidor numa unidade inventada.
 */
function encontrarUnidade(nomeNaPlanilha: string, unidades: { nome: string }[]): string {
	const normalizado = normalizarTexto(nomeNaPlanilha);
	const encontrada = unidades.find((u) => normalizarTexto(u.nome) === normalizado);
	return encontrada ? encontrada.nome : '';
}

/**
 * Parser simples de CSV que suporta campos com aspas e vírgulas internas.
 * Retorna array de arrays de strings.
 *
 * Feito à mão de propósito: a alternativa seria carregar uma biblioteca de CSV
 * no bundle do Worker para ler um arquivo de 4 colunas. Cobre aspas duplas
 * escapadas (`""`) e quebra de linha CRLF/CR/LF; não cobre quebra de linha
 * DENTRO de campo entre aspas — caso que a planilha de origem não produz.
 */
function parseCSV(text: string): string[][] {
	const rows: string[][] = [];
	const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

	for (const line of lines) {
		if (!line.trim()) continue;
		const cells: string[] = [];
		let current = '';
		let inQuotes = false;

		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (ch === '"') {
				if (inQuotes && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = !inQuotes;
				}
			} else if (ch === ',' && !inQuotes) {
				cells.push(current.trim());
				current = '';
			} else {
				current += ch;
			}
		}
		cells.push(current.trim());
		rows.push(cells);
	}

	return rows;
}

export const actions = {
	/**
	 * Recebe o CSV e cadastra. Validações em camadas, da mais barata para a mais
	 * cara: papel → banco disponível → há unidades → extensão/MIME/tamanho (5 MB)
	 * → conteúdo linha a linha.
	 *
	 * Matrícula duplicada não é erro fatal: o INSERT usa `onConflictDoNothing` e a
	 * linha é reportada como "já cadastrada — registro ignorado", o que torna o
	 * reenvio do mesmo arquivo seguro (idempotente).
	 */
	upload: async (event) => {
		const { request, platform, locals } = event;
		if (!isAdminGeral(locals.usuario)) {
			return fail(403, { error: 'Não autorizado', errorType: 'auth' });
		}
		let db;
		try {
			db = getDB(platform);
		} catch {
			return fail(500, {
				error: 'Banco de dados não disponível. Verifique se o D1 está configurado.',
				errorType: 'database'
			});
		}

		const unidades = await listarUnidades(db);
		if (unidades.length === 0) {
			return fail(400, {
				error: 'Nenhuma unidade policial cadastrada. Cadastre pelo menos uma.',
				errorType: 'no_units'
			});
		}

		const formData = await request.formData();
		const file = formData.get('file') as File;

		if (!file || !file.name) {
			return fail(400, { error: 'Nenhum arquivo enviado.', errorType: 'validation' });
		}

		const fileName = file.name.toLowerCase();
		const ext = fileName.substring(fileName.lastIndexOf('.'));
		if (ext !== '.csv') {
			return fail(400, {
				error: `Formato de arquivo não suportado: "${ext}". Envie um arquivo CSV (.csv).`,
				errorType: 'validation'
			});
		}

		const validMimeTypes = [
			'text/csv',
			'text/plain',
			'application/octet-stream',
			'application/csv'
		];
		if (file.type && !validMimeTypes.includes(file.type)) {
			return fail(400, {
				error: `Tipo de arquivo inválido. Envie um arquivo CSV válido.`,
				errorType: 'validation'
			});
		}

		const MAX_SIZE = 5 * 1024 * 1024;
		if (file.size > MAX_SIZE) {
			return fail(400, {
				error: 'Arquivo muito grande. O tamanho máximo permitido é 5 MB.',
				errorType: 'validation'
			});
		}

		let rows: string[][];
		try {
			const text = await file.text();
			rows = parseCSV(text);
		} catch {
			return fail(400, {
				error: `Não foi possível ler o arquivo "${file.name}". Verifique se é um CSV válido.`,
				errorType: 'parse'
			});
		}

		if (rows.length <= 1) {
			return fail(400, {
				error:
					'O arquivo está vazio ou contém apenas o cabeçalho. Adicione dados a partir da linha 2.',
				errorType: 'validation'
			});
		}

		// Pula linha de cabeçalho; espera colunas: nome, matricula, cargo, telefone, lotacao
		const dataRows = rows.slice(1);

		let imported = 0;
		let skipped = 0;
		const errors: { row: number; nome: string; message: string }[] = [];

		for (let i = 0; i < dataRows.length; i++) {
			const cells = dataRows[i];
			const rowNum = i + 2;

			const [nomeRaw, matriculaRaw, cargoRaw, telefoneRaw, lotacaoRaw] = cells;
			const nome = nomeRaw?.trim() ?? '';

			const missing: string[] = [];
			if (!nome) missing.push('Nome (coluna A)');
			if (!matriculaRaw?.trim()) missing.push('Matrícula (coluna B)');
			if (!cargoRaw?.trim()) missing.push('Cargo (coluna C)');

			if (missing.length > 0) {
				errors.push({
					row: rowNum,
					nome: nome || '(vazio)',
					message: `Campos obrigatórios faltando: ${missing.join(', ')}`
				});
				continue;
			}

			const cargo = cargoRaw.toUpperCase().trim();
			if (!['DPC', 'OIP'].includes(cargo)) {
				errors.push({
					row: rowNum,
					nome,
					message: `Cargo "${cargoRaw}" inválido. Use "DPC" ou "OIP".`
				});
				continue;
			}

			let lotacaoFinal = '';
			if (lotacaoRaw?.trim()) {
				lotacaoFinal = encontrarUnidade(lotacaoRaw.trim(), unidades);
			}

			// Só Admin Geral chega aqui (gate no topo). O ramo "policial só a
			// própria lotação" era morto e convidava a afrouxar o gate sem
			// perceber a armadilha (FLW-AUT-018).

			const matriculaLimpa = limparMatricula(matriculaRaw.trim());

			try {
				const senhaHash = await gerarSenhaAleatoriaHash();
				const result = await db
					.insert(policiaisTable)
					.values({
						nome,
						matricula: matriculaLimpa,
						cargo: cargo as 'DPC' | 'OIP',
						telefone: telefoneRaw?.trim() ?? '',
						lotacao: lotacaoFinal,
						senha: senhaHash,
						primeiro_acesso: 1
					})
					.onConflictDoNothing()
					.returning({ id: policiaisTable.id });

				if (result.length === 0) {
					skipped++;
					errors.push({
						row: rowNum,
						nome,
						message: `Matrícula "${matriculaLimpa}" já cadastrada — registro ignorado.`
					});
				} else {
					imported++;
					if (lotacaoRaw?.trim() && !lotacaoFinal) {
						errors.push({
							row: rowNum,
							nome,
							message: `Lotação "${lotacaoRaw}" não encontrada no sistema — importado sem lotação.`
						});
					}
				}
			} catch {
				errors.push({
					row: rowNum,
					nome,
					message: 'Erro ao salvar no banco de dados.'
				});
			}
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'importar_policiais',
				usuario: locals.usuario,
				entidade: 'policial',
				resultado: imported > 0 ? 'sucesso' : 'falha',
				detalhes: `Importação em massa de policiais: ${imported} importado(s), ${skipped} ignorado(s), ${errors.length} erro(s)`,
				metadados: {
					imported,
					skipped,
					erros: errors.length,
					total: dataRows.length,
					arquivo: file.name
				},
				...contexto
			},
			{ env }
		);

		return { success: true, imported, skipped, errors, total: dataRows.length };
	}
} satisfies Actions;
