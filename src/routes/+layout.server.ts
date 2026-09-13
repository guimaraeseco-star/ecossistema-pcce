/**
 * `load` do layout raiz: flags de navegação (papel GISE, evidências de
 * assinatura, alternância admin↔usuário) para a sessão inteira.
 * Mutações invalidam chaves pontuais — este load não deve rodar a cada exclusão
 * de escala.
 */
import type { LayoutServerLoad } from './$types';
import { getDB, ehAdminGeralVinculado, buscarCredencialAtiva } from '$lib/db';
import { temCadastro } from '$lib/auth';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { lerFlagsAssinatura } from '$lib/server/assinatura/cfg-ass-cache';
import { lerPapelGise } from '$lib/server/gise/papel-cache';
import { lerTemLinhaBasePendente } from '$lib/server/operacoes/linha-base-cache';
import { resumoRecebidosAdmin } from '$lib/server/escalas/sync-estado';
import { trilhaDaUnidade } from '$lib/server/unidades/escopo';
import { logger } from '$lib/server/logger';
import { mensagemDeErro } from '$lib/utils/erro';
import {
	resolverPreferenciaModulo,
	temAmbosModulos,
	type AdminModuloPreferencia
} from '$lib/server/auth/admin-modulos';

export const load: LayoutServerLoad = async ({ locals, platform, cookies, depends }) => {
	const u = locals.usuario;

	let isSupervisorGise = false;
	let isMembroGise = false;
	let isSupervisaoGise = false;
	let temGiseHistorico = false;
	let temPresencaGisePendente = false;
	/** Administra unidade participante de operação que pede linha de base — abre a aba "Dados base". */
	let temLinhaBasePendente = false;
	let exigirFotoAssinatura = true;
	let exigirGpsAssinatura = true;
	let exigirCodigoEmailAssinatura = false;
	let restringirSmartphone = false;
	let exigirPasskeyAssinatura = false;
	let temChaveAssinatura = false;
	let recebidosNaoVistos = 0;
	// Alternância de acesso (ADM Geral ↔ Usuário) para a MESMA pessoa vinculada.
	// admin → usuário: exige a sessão admin ter policial vinculado (adminPolicialId).
	// usuário → admin: exige o policial ter conta Admin Geral vinculada.
	const podeAlternarParaUsuario = u?.tipo === 'admin' && u.adminPolicialId != null;
	let podeAlternarParaAdmin = false;
	// Barra do topo: "Polícia Civil do Ceará - DPI SUL - seccional - delegacia".
	let trilhaUnidade: string[] = [];

	if (u) {
		try {
			// Flags vêm do cache server-side (Cache API edge, TTL 5min). Antes
			// usávamos cookie do cliente, mas como não era assinado, o usuário
			// podia editá-lo e desligar exigências de selfie/GPS/código.
			// Esses valores são EXIBIÇÃO; toda decisão de aceitar/dispensar
			// evidência DEVE chamar `lerFlagsAssinatura` no próprio endpoint.
			//
			// Papel GISE vem do cache edge (TTL 60s). Mutações diretas
			// (mudar supervisor, add/remove membro) invalidam o cache no
			// próprio handler, então o stale window real é só para
			// cascatas raras (ex.: deletar uma seccional inteira).
			const db = getDB(platform);
			// Contador da sidebar + flags de assinatura (conf-ass) — chaves
			// segmentadas para não invalidar o layout inteiro à toa.
			if (u.tipo === 'admin') depends('app:recebidos-badge');
			depends('app:assinatura-flags');
			depends('app:chave-assinatura');
			if (u.tipo === 'policial') depends('app:papel-gise');
			const [flags, papel, vinculadoAdmin, recebidos, linhaBasePendente, credencial, trilha] =
				await Promise.all([
					lerFlagsAssinatura(platform),
					u.tipo === 'policial' ? lerPapelGise(db, u.id) : Promise.resolve(null),
					u.tipo === 'policial' ? ehAdminGeralVinculado(db, u.id) : Promise.resolve(false),
					u.tipo === 'admin' ? resumoRecebidosAdmin(db) : Promise.resolve(null),
					// Cache próprio (TTL 60s): a resposta cruza operações ativas, modelos e
					// participação — cara demais para o `load` que roda a cada navegação.
					lerTemLinhaBasePendente(db, u),
					temCadastro(u)
						? buscarCredencialAtiva(db, credencialDoUsuario(u))
						: Promise.resolve(null),
					trilhaDaUnidade(db, u)
				]);
			trilhaUnidade = trilha;
			temLinhaBasePendente = linhaBasePendente;
			podeAlternarParaAdmin = vinculadoAdmin;
			exigirFotoAssinatura = flags.exigirFotoAssinatura;
			exigirGpsAssinatura = flags.exigirGpsAssinatura;
			exigirCodigoEmailAssinatura = flags.exigirCodigoEmailAssinatura;
			restringirSmartphone = flags.restringirSmartphone;
			exigirPasskeyAssinatura = flags.exigirPasskeyAssinatura;
			temChaveAssinatura = credencial !== null;
			if (recebidos) recebidosNaoVistos = recebidos.naoVistos;

			if (papel) {
				isSupervisorGise = papel.isSupervisor;
				isMembroGise = papel.isMembro;
				isSupervisaoGise = papel.isSupervisao;
				temGiseHistorico = papel.temHistorico;
				temPresencaGisePendente = papel.temPresencaPendente;
			}
		} catch (err) {
			// DB/edge cache indisponível — mantém defaults seguros (exige tudo)
			logger.warn('[layout] falha ao carregar flags/papel GISE', {
				err: mensagemDeErro(err)
			});
		}
	}

	// Preferência de tela do Admin Geral, recortada ao que a conta permite.
	// Conta com um módulo só: cookie inválido/do outro módulo é tratado como o
	// único liberado (sem regravar aqui — login e alternar-módulo já gravam certo).
	const rawAdminModulo = cookies.get('admin_modulo');
	const modulos = u?.tipo === 'admin' ? (u.modulosAdmin ?? { escalas: true, gise: true }) : null;
	const adminModulo: AdminModuloPreferencia = modulos
		? resolverPreferenciaModulo(modulos, rawAdminModulo)
		: rawAdminModulo === 'gise' || rawAdminModulo === 'escalas'
			? rawAdminModulo
			: 'ambas';
	const podeAlternarModulo =
		u?.tipo === 'admin' && !u.isSuperAdmin && !!modulos && temAmbosModulos(modulos);

	return {
		usuario: u,
		isSupervisorGise,
		isMembroGise,
		isSupervisaoGise,
		temGiseHistorico,
		temPresencaGisePendente,
		temLinhaBasePendente,
		exigirFotoAssinatura,
		exigirGpsAssinatura,
		exigirCodigoEmailAssinatura,
		restringirSmartphone,
		exigirPasskeyAssinatura,
		temChaveAssinatura,
		recebidosNaoVistos,
		adminModulo,
		podeAlternarModulo,
		podeAlternarParaUsuario,
		podeAlternarParaAdmin,
		trilhaUnidade
	};
};
