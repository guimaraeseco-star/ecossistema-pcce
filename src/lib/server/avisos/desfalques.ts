/**
 * "Escala desfalcada" (E60): quando um afastamento — férias em gozo ou
 * qualquer outro — é registrado ou aprovado sobre datas em que o servidor JÁ
 * está escalado, o sistema avisa. Não desescala: é o admin da escala quem
 * decide substituir.
 *
 * O aviso vai a três lugares: ao toast de quem registrou (o texto que esta
 * função devolve), à caixa de avisos da unidade dona de cada escala (notícia,
 * regra do outro lado) e à própria escala (faixa, calculada ao vivo por
 * `desfalquesDaEscala`/`desfalquesDaGise`).
 */
import { escalasDoServidorNoPeriodo } from '$lib/db/policiais/afastamento-escalas';
import { criarAvisos, type NovoAviso } from '$lib/db/avisos';
import type { Database } from '$lib/db/core';
import { isAdminGeral, type UsuarioLogado } from '$lib/auth';
import { formatarData } from '$lib/utils/datas';
import { logger } from '$lib/server/logger';

/**
 * Procura as escalas do servidor dentro do afastamento e avisa. Devolve as
 * frases para o toast; nunca lança.
 */
export async function avisarDesfalques(
	db: Database,
	autor: UsuarioLogado,
	servidor: { id: number; nome: string; lotacao: string },
	afastamento: { rotulo: string; inicio: string; fim: string | null }
): Promise<string[]> {
	try {
		const escalas = await escalasDoServidorNoPeriodo(
			db,
			servidor.id,
			afastamento.inicio,
			afastamento.fim
		);
		if (escalas.length === 0) return [];
		const frases = escalas.map(
			(e) => `${e.titulo} de ${formatarData(e.data)} fica desfalcada (${servidor.nome} escalado).`
		);
		// A unidade dona da escala fica sabendo; se o autor é da ponta, o DPI SUL
		// também — a regra do outro lado, aplicada escala a escala.
		const avisos: NovoAviso[] = [];
		const lotacoes = new Set(
			escalas.map((e) => e.lotacao ?? servidor.lotacao).filter((l): l is string => !!l)
		);
		const cartao = 'escalas';
		const titulo = `Escala desfalcada: ${servidor.nome} afastado (${afastamento.rotulo})`;
		const texto = frases.join(' ');
		const link = escalas[0].link;
		if (isAdminGeral(autor)) {
			for (const lotacao of lotacoes) {
				avisos.push({
					destinatario: { tipo: 'lotacao', lotacao },
					cartao,
					tipo: 'escala_desfalcada',
					titulo,
					texto,
					link,
					autor: { id: autor.id, nome: autor.nome }
				});
			}
		} else {
			avisos.push({
				destinatario: { tipo: 'admin_geral' },
				cartao,
				tipo: 'escala_desfalcada',
				titulo,
				texto,
				link,
				autor: { id: autor.id, nome: autor.nome }
			});
			for (const lotacao of lotacoes) {
				if (lotacao === autor.lotacao) continue;
				avisos.push({
					destinatario: { tipo: 'lotacao', lotacao },
					cartao,
					tipo: 'escala_desfalcada',
					titulo,
					texto,
					link,
					autor: { id: autor.id, nome: autor.nome }
				});
			}
		}
		await criarAvisos(db, avisos);
		return frases;
	} catch (e) {
		logger.warn('[avisos] falha ao avisar desfalques', { erro: String(e) });
		return [];
	}
}
