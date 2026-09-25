/**
 * GET /api/sync/estado — carimbos leves para decidir se vale invalidar o `load`.
 *
 * Query: `?giseId=` (detalhe GISE), `?escalaId=` (detalhe escala).
 * Fatias por papel: admin → recebidos/painel/resGise; policial → resGise;
 * DPC admin → escalas; com vínculo GISE → giseList.
 *
 * ## Autorização
 *
 * Este endpoint aplica os MESMOS gates das telas que ele serve, e não apenas
 * `requireAuth`. O motivo é que os carimbos não são opacos: eles são a
 * concatenação dos campos que mudam. O de uma GISE traz
 * `status|data|hora_entrada|hora_saida|supervisor_id`; o de uma escala traz
 * `policial_id:data:horário` de cada escalado. Sem os gates, qualquer
 * autenticado enumerava `?giseId=1..N` e montava o calendário de operações e a
 * escala de trabalho de terceiros — coisas que `/operacoes/gise/[id]` e `/escalas/[id]`
 * recusam pelos helpers abaixo.
 *
 * Quem não pode ver recebe o corpo SEM aquele campo, não um 403: um erro
 * distinto revelaria a existência do recurso, que é justamente o que se quer
 * esconder.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, buscarEscala } from '$lib/db';
import { requireAuth, badRequest, serverError } from '$lib/server/api';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { unidadesAdministradas } from '$lib/server/policial-permissao';
import { verificarPermissaoGise } from '$lib/server/gise/permissao';
import { verificarPermissaoEscala } from '$lib/server/escalas/permissao';
import { lerPapelGise } from '$lib/server/gise/papel-cache';
import { resumoEscalasPendentes, carimboEscala } from '$lib/server/escalas/sync-estado';
import { carimboGise, carimboResGise } from '$lib/server/gise/sync-estado';
// Carimbos GLOBAIS (iguais para todo usuário) vêm da variante cacheada: sem
// ela, N abas abertas produzem N varreduras idênticas das mesmas tabelas a cada
// tique. Os carimbos POR USUÁRIO e POR RECURSO acima ficam sem cache — ver o
// cabeçalho de `escalas/sync-estado-cache.ts`.
import { carimboPainelDoPoll, resumoRecebidosDoPoll } from '$lib/server/escalas/sync-estado-cache';
import { carimboGiseListDoPoll } from '$lib/server/gise/sync-estado-cache';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	try {
		const db = getDB(platform);
		const giseIdRaw = url.searchParams.get('giseId');
		const giseId = giseIdRaw ? Number(giseIdRaw) : NaN;
		if (giseIdRaw && (!Number.isInteger(giseId) || giseId <= 0)) {
			return badRequest('giseId inválido');
		}
		const escalaIdRaw = url.searchParams.get('escalaId');
		const escalaId = escalaIdRaw ? Number(escalaIdRaw) : NaN;
		if (escalaIdRaw && (!Number.isInteger(escalaId) || escalaId <= 0)) {
			return badRequest('escalaId inválido');
		}

		const body: {
			recebidos?: { stamp: string; naoVistos: number };
			escalas?: { stamp: string; pendentes: number };
			gise?: { stamp: string };
			giseList?: { stamp: string };
			painel?: { stamp: string };
			resGise?: { stamp: string };
			escala?: { stamp: string };
		} = {};

		const tasks: Promise<void>[] = [];

		// `giseList` carrega os ids e status de TODAS as GISEs. Só vai para quem a
		// tela `/operacoes/gise` deixaria entrar — lá, quem não tem vínculo nenhum é
		// redirecionado para `/`.
		tasks.push(
			(async () => {
				let temVinculoGise = isAdminGeral(u) || isAdminSeccional(u);
				if (!temVinculoGise && u.tipo === 'policial') {
					const papel = await lerPapelGise(db, u.id);
					temVinculoGise = papel.isSupervisor || papel.isMembro;
				}
				if (temVinculoGise) body.giseList = { stamp: await carimboGiseListDoPoll(db) };
			})()
		);

		if (u.tipo === 'admin') {
			tasks.push(
				resumoRecebidosDoPoll(db).then((r) => {
					body.recebidos = r;
				}),
				carimboPainelDoPoll(db).then((stamp) => {
					body.painel = { stamp };
				}),
				carimboResGise(db, null).then((stamp) => {
					body.resGise = { stamp };
				})
			);
		}

		if (u.tipo === 'policial') {
			tasks.push(
				carimboResGise(db, u.id).then((stamp) => {
					body.resGise = { stamp };
				})
			);
		}

		if (
			u.tipo === 'policial' &&
			u.cargo === 'DPC' &&
			(u.papel === 'admin_seccional' || u.papel === 'admin_unidade')
		) {
			tasks.push(
				(async () => {
					// O escopo em IDS (E51): `null` é o Super Admin, que não cai neste
					// ramo — só admin_seccional e admin_unidade chegam aqui.
					const escopo = await unidadesAdministradas(db, u);
					body.escalas = await resumoEscalasPendentes(db, u, escopo ? [...escopo] : []);
				})()
			);
		}

		if (Number.isInteger(giseId) && giseId > 0) {
			tasks.push(
				(async () => {
					const gise = await buscarGiseEscala(db, giseId);
					if (!gise) return;
					const perm = await verificarPermissaoGise(db, gise, u);
					if (!perm.permitido) return;
					const stamp = await carimboGise(db, giseId);
					if (stamp) body.gise = { stamp };
				})()
			);
		}

		if (Number.isInteger(escalaId) && escalaId > 0) {
			tasks.push(
				(async () => {
					const escala = await buscarEscala(db, escalaId);
					if (!escala) return;
					// Mesmo gate do `load` de `/escalas/[id]`: lotação própria, ou o
					// escopo de administração resolvido pelo helper.
					if (u.tipo !== 'admin' && escala.lotacao !== u.lotacao) {
						const perm = await verificarPermissaoEscala(db, escalaId, escala.lotacao, u);
						if (!perm.permitido) return;
					}
					const stamp = await carimboEscala(db, escalaId);
					if (stamp) body.escala = { stamp };
				})()
			);
		}

		await Promise.all(tasks);
		return json(body);
	} catch (err) {
		return serverError('[sync/estado] Falha ao montar carimbos', err);
	}
};
