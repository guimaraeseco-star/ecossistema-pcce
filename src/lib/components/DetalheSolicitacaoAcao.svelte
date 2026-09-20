<script lang="ts">
	/**
	 * TODO o conteúdo de um pedido de ação de RH — movimentação, afastamento ou
	 * desvinculação —, incluindo o link para baixar a portaria anexada.
	 *
	 * Existe porque as duas pontas do fluxo mostram exatamente o mesmo: quem pediu
	 * confere na ficha do servidor o que enviou, e o Admin Geral precisa ver tudo
	 * ANTES de aprovar, em `/solicitacoes`. Duas versões desta lista divergiriam no
	 * campo que só uma delas mostrasse — e o campo que falta na tela de quem decide
	 * é o campo que ninguém confere.
	 *
	 * O anexo é servido por `/api/policiais/solicitacoes/[id]/documento`, que
	 * repete no servidor a mesma permissão desta tela: Admin Geral, ou
	 * administrador da unidade/seccional do servidor alvo.
	 */
	import { formatarData } from '$lib/utils/datas';
	import { LABEL_SUBTIPO_AFASTAMENTO } from '$lib/schemas/policial-historico';
	import type { PolicialAcaoSolicitacao } from '$lib/types';
	import { PORTARIA_39 } from '$lib/servidores/afastamentos';
	import FileText from '@lucide/svelte/icons/file-text';

	const {
		solicitacao: s,
		compacto = false
	}: { solicitacao: PolicialAcaoSolicitacao; compacto?: boolean } = $props();

	/** Rótulo do subtipo do afastamento; o valor cru vira fallback legível. */
	const subtipo = $derived(
		s.subtipo
			? (LABEL_SUBTIPO_AFASTAMENTO[s.subtipo as keyof typeof LABEL_SUBTIPO_AFASTAMENTO] ??
					s.subtipo)
			: null
	);

	/** Só os campos preenchidos: linha vazia num pedido é ruído, não informação. */
	const linhas = $derived(
		[
			s.tipo === 'movimentacao' && {
				rotulo: 'Unidade atual',
				valor: s.unidade_origem || '— Sem lotação —'
			},
			s.tipo === 'movimentacao' && { rotulo: 'Unidade destino', valor: s.unidade_destino ?? '' },
			s.tipo === 'desvinculacao' && { rotulo: 'Destino', valor: s.unidade_destino ?? '' },
			// Direção: o pedido é sobre a UNIDADE, e é ela que precisa aparecer
			// primeiro — quem lê a fila decide "quem passa a dirigir o quê".
			s.tipo === 'direcao' && { rotulo: 'Unidade', valor: s.unidade_destino ?? '' },
			s.tipo === 'direcao' && {
				rotulo: 'Papel',
				valor: s.subtipo === 'respondente' ? 'Respondente' : 'Titular'
			},
			s.tipo === 'afastamento' && subtipo && { rotulo: 'Tipo', valor: subtipo },
			s.tipo === 'afastamento' && s.tipo_cid && { rotulo: 'CID', valor: s.tipo_cid },
			s.tipo === 'afastamento' && s.descricao && { rotulo: 'Descrição/Motivo', valor: s.descricao },
			s.data_evento && { rotulo: 'Data', valor: formatarData(s.data_evento) },
			s.data_inicio && { rotulo: 'Início', valor: formatarData(s.data_inicio) },
			s.data_fim && { rotulo: 'Término', valor: formatarData(s.data_fim) },
			s.qtd_dias != null && { rotulo: 'Dias', valor: String(s.qtd_dias) },
			s.nup && { rotulo: 'NUP', valor: s.nup }
		].filter((l): l is { rotulo: string; valor: string } => !!l)
	);
</script>

<div class="space-y-3">
	<dl
		class="grid grid-cols-2 {compacto
			? 'sm:grid-cols-3'
			: 'sm:grid-cols-4'} gap-x-4 gap-y-2 text-sm"
	>
		{#each linhas as linha (linha.rotulo)}
			<div>
				<dt class="text-2xs uppercase font-bold opacity-60">{linha.rotulo}</dt>
				<dd class="font-semibold break-words">{linha.valor}</dd>
			</div>
		{/each}
	</dl>

	<!-- CID-F: quem decide precisa ver a Portaria 39 ANTES de aprovar — aprovar
	     é também assumir o recolhimento do armamento. -->
	{#if s.tipo_cid === 'CID-F'}
		<div
			class="rounded-lg border border-error-500/40 bg-error-500/10 px-3 py-2 text-xs text-error-700 dark:text-error-300"
			role="alert"
		>
			<p class="font-bold">⚠ {PORTARIA_39.titulo}</p>
			<ul class="mt-1 list-disc pl-4 space-y-0.5">
				{#each PORTARIA_39.providencias as prov (prov)}
					<li>{prov}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- O afastamento não tem justificativa à parte (o NUP é o fundamento). -->
	{#if s.justificativa}
		<div class="rounded-lg bg-surface-500/10 border-l-4 border-primary-500 px-3 py-2">
			<p class="text-2xs uppercase font-bold opacity-60">Justificativa</p>
			<p class="text-sm whitespace-pre-wrap break-words">{s.justificativa}</p>
		</div>
	{/if}

	{#if s.documento_r2_key}
		<a
			href="/api/policiais/solicitacoes/{s.id}/documento"
			target="_blank"
			rel="noopener"
			class="btn btn-sm preset-outlined-surface-500 inline-flex items-center gap-2"
		>
			<FileText size={16} aria-hidden="true" />
			{s.documento_nome || 'Baixar documento (PDF)'}
		</a>
	{/if}
</div>
