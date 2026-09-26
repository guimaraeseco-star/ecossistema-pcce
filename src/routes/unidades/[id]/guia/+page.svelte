<script lang="ts">
	/**
	 * O guia passo a passo dos atos de estrutura (E73, parte 2) — ver o
	 * cabeçalho do `+page.server.ts`. Aqui só a apresentação: cada passo com o
	 * seu estado, cada pessoa com o link para a ficha, e o ato final quando nada
	 * mais impede. Os textos são para quem nunca viu o sistema por dentro.
	 */
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import RecusaDaEstrutura from '../../_components/RecusaDaEstrutura.svelte';

	const { data, form }: { data: PageData; form: ActionData } = $props();

	let pending = $state(false);

	const titulo = $derived(
		data.ato === 'desativar'
			? `Desativar ${data.unidade.nome}`
			: data.ato === 'transferir'
				? `Transferir ${data.unidade.nome} para outra unidade-mãe`
				: data.unidade.nome
	);

	const d = $derived(data.desativar);
	const desativacaoLiberada = $derived(
		d != null && d.lotados.length + d.trabalhando.length + d.filhasAtivas.length === 0
	);
	const t = $derived(data.transferir);
	const transferenciaLiberada = $derived(
		t != null && !t.recusa && t.pendencias != null && t.pendencias.perdemOLocal.length === 0
	);
	const nomeDaNovaMae = $derived(
		t ? (data.opcoesDeMae.find((o) => o.id === t.para)?.nome ?? '') : ''
	);

	function aoConcluir() {
		pending = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			pending = false;
		};
	}

	const CARTAO =
		'rounded-xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800/40 p-4 mb-4';
	const FEITO =
		'text-2xs font-bold uppercase tracking-wide rounded px-2 py-0.5 bg-success-100 text-success-800 dark:bg-success-900/40 dark:text-success-300';
	const FALTA =
		'text-2xs font-bold uppercase tracking-wide rounded px-2 py-0.5 bg-warning-100 text-warning-900 dark:bg-warning-900/40 dark:text-warning-200';
	const LINK = 'text-primary-600 dark:text-primary-400 underline underline-offset-2';
</script>

<svelte:head>
	<title>Guia: {titulo} | Ecossistema PCCE</title>
</svelte:head>

{#snippet estado(feito: boolean)}
	<span class={feito ? FEITO : FALTA}>{feito ? 'Feito' : 'Falta'}</span>
{/snippet}

{#snippet pessoas(lista: { id: number; nome: string; lotacao: string }[], oQueFazer: string)}
	<p class="text-sm text-surface-700 dark:text-surface-300 mb-2">{oQueFazer}</p>
	<ul class="space-y-1">
		{#each lista as p (p.id)}
			<li class="text-sm flex flex-wrap items-baseline gap-x-3">
				<span class="font-semibold">{p.nome}</span>
				<span class="text-xs text-surface-500">lotado em {p.lotacao || '—'}</span>
				<a class={LINK} href="/servidores/{p.id}" target="_blank" rel="noopener">Abrir a ficha</a>
			</li>
		{/each}
	</ul>
{/snippet}

<a href="/unidades" class="{LINK} text-sm">← Voltar para Unidades</a>

<h1 class="h1 text-2xl font-bold mt-3 mb-1">{titulo}</h1>
<p class="text-xs text-surface-500 mb-2">Hoje: {data.trilhaAtual.join(' › ')}</p>
{#if data.ato && data.unidade.ativo && !form?.concluido}
	<p class="text-xs mb-6">
		Quer fazer outra coisa com esta unidade?
		{#if data.ato === 'desativar'}
			<a class={LINK} href="?ato=transferir">Transferir para outra unidade-mãe</a>
		{:else}
			<a class={LINK} href="?ato=desativar">Desativar</a>
		{/if}
	</p>
{:else}
	<div class="mb-6"></div>
{/if}

{#if form?.concluido}
	<div
		role="status"
		class="rounded-xl border border-success-400 bg-success-50 dark:bg-success-950/40 p-4 mb-4 text-sm"
	>
		{#if form.concluido === 'desativar'}
			<p class="font-semibold">Pronto: {data.unidade.nome} foi desativada.</p>
			<p>Ela sai das listas de escolha. Nada foi apagado, e ela pode ser reativada.</p>
		{:else}
			<p class="font-semibold">Pronto: {data.unidade.nome} mudou de unidade-mãe.</p>
			<p>A posição dela agora é: {data.trilhaAtual.join(' › ')}.</p>
		{/if}
		<p class="mt-2"><a class={LINK} href="/unidades">Voltar para Unidades</a></p>
	</div>
{:else if !data.unidade.ativo}
	<div class={CARTAO}>
		<p class="text-sm">
			Esta unidade está <strong>desativada</strong>. Para transferi-la, reative-a antes na tela de
			Unidades.
		</p>
	</div>
{:else if !data.ato}
	<div class={CARTAO}>
		<p class="text-sm mb-3">O que você quer fazer com esta unidade?</p>
		<div class="flex flex-wrap gap-2">
			<a class="btn btn-sm preset-tonal-primary" href="?ato=transferir">
				Transferir para outra unidade-mãe
			</a>
			<a class="btn btn-sm preset-tonal-warning" href="?ato=desativar">Desativar</a>
		</div>
	</div>
{:else if data.ato === 'desativar' && d}
	<p class="text-sm mb-4 max-w-3xl">
		Para desativar uma unidade, <strong>nada pode estar dependendo dela</strong>: nem servidor
		lotado ou trabalhando nela, nem unidade ativa abaixo dela. Resolva o que estiver marcado como
		<strong>Falta</strong> e volte a esta página — a lista se atualiza sozinha.
	</p>

	<section class={CARTAO}>
		<div class="flex items-center gap-2 mb-2">
			{@render estado(d.lotados.length === 0)}
			<h2 class="font-bold">1. Servidores lotados aqui</h2>
		</div>
		{#if d.lotados.length === 0}
			<p class="text-sm text-surface-600">Ninguém está lotado aqui.</p>
		{:else}
			{@render pessoas(
				d.lotados,
				'Na ficha de cada um, registre a movimentação para a nova lotação (ato de RH, com NUP).'
			)}
		{/if}
	</section>

	<section class={CARTAO}>
		<div class="flex items-center gap-2 mb-2">
			{@render estado(d.trabalhando.length === 0)}
			<h2 class="font-bold">2. Quem trabalha aqui sendo lotado em outra unidade</h2>
		</div>
		{#if d.trabalhando.length === 0}
			<p class="text-sm text-surface-600">Ninguém.</p>
		{:else}
			{@render pessoas(
				d.trabalhando,
				'Na ficha de cada um, mude o campo "trabalha em" para outro lugar.'
			)}
		{/if}
	</section>

	<section class={CARTAO}>
		<div class="flex items-center gap-2 mb-2">
			{@render estado(d.filhasAtivas.length === 0)}
			<h2 class="font-bold">3. Unidades abaixo desta</h2>
		</div>
		{#if d.filhasAtivas.length === 0}
			<p class="text-sm text-surface-600">Nenhuma unidade ativa abaixo desta.</p>
		{:else}
			<p class="text-sm text-surface-700 dark:text-surface-300 mb-2">
				Cada uma precisa ir para outra unidade-mãe, ou ser desativada — cada uma tem o seu guia.
			</p>
			<ul class="space-y-1">
				{#each d.filhasAtivas as f (f.id)}
					<li class="text-sm flex flex-wrap items-baseline gap-x-3">
						<span class="font-semibold">{f.nome}</span>
						<a class={LINK} href="/unidades/{f.id}/guia?ato=transferir">Transferir</a>
						<a class={LINK} href="/unidades/{f.id}/guia?ato=desativar">Desativar</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if d.escalasNaoEncerradas > 0}
		<p class="text-sm mb-4 max-w-3xl">
			<strong>Aviso:</strong> esta unidade tem {d.escalasNaoEncerradas}
			{d.escalasNaoEncerradas === 1
				? 'escala que ainda não terminou'
				: 'escalas que ainda não terminaram'}. Elas continuam valendo depois de desativar.
		</p>
	{/if}

	<section class={CARTAO}>
		<div class="flex items-center gap-2 mb-2">
			{@render estado(false)}
			<h2 class="font-bold">4. Desativar</h2>
		</div>
		{#if desativacaoLiberada}
			<p class="text-sm mb-3">
				Nada mais impede. Ao desativar, <strong>{data.unidade.nome}</strong> sai das listas de escolha
				(nova escala, lotação, GISE). Nada é apagado, e ela pode ser reativada depois.
			</p>
			<form method="POST" action="?/concluir" use:enhance={aoConcluir}>
				<input type="hidden" name="ato" value="desativar" />
				<button type="submit" class="btn preset-filled-warning-500" disabled={pending}>
					{pending ? 'Desativando...' : `Desativar ${data.unidade.nome}`}
				</button>
			</form>
		{:else}
			<p class="text-sm text-surface-600">Resolva os passos acima primeiro.</p>
		{/if}
	</section>
{:else if data.ato === 'transferir'}
	<section class={CARTAO}>
		<div class="flex items-center gap-2 mb-2">
			{@render estado(t != null && !t.recusa)}
			<h2 class="font-bold">1. Escolha a nova unidade-mãe</h2>
		</div>
		<form method="GET" class="flex flex-wrap items-end gap-2">
			<input type="hidden" name="ato" value="transferir" />
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-xs font-semibold text-surface-600">Nova unidade-mãe</span>
				<select name="para" class="select text-sm min-w-72" value={t?.para ?? ''}>
					<option value="" disabled>Escolha…</option>
					{#each data.opcoesDeMae as o (o.id)}
						{#if o.id !== data.unidade.seccional_id}
							<option value={o.id}>{o.nome}</option>
						{/if}
					{/each}
				</select>
			</label>
			<button type="submit" class="btn btn-sm preset-tonal-primary">Ver o que é preciso</button>
		</form>
		{#if t?.recusa}
			<div class="mt-3"><RecusaDaEstrutura texto={t.recusa} /></div>
		{/if}
	</section>

	{#if t && !t.recusa && t.pendencias}
		<p class="text-sm mb-4">Nova posição: <strong>{t.novaTrilha.join(' › ')}</strong></p>

		<section class={CARTAO}>
			<div class="flex items-center gap-2 mb-2">
				{@render estado(t.pendencias.perdemOLocal.length === 0)}
				<h2 class="font-bold">2. Quem ficaria com o "trabalha em" fora da lotação</h2>
			</div>
			{#if t.pendencias.perdemOLocal.length === 0}
				<p class="text-sm text-surface-600">
					Ninguém — a troca não afeta o local de trabalho de ninguém.
				</p>
			{:else}
				{@render pessoas(
					t.pendencias.perdemOLocal,
					'Com a troca, o local de trabalho destes servidores deixaria de pertencer à lotação deles. Na ficha de cada um, mude o "trabalha em" — ou mova a lotação (ato de RH, com NUP).'
				)}
			{/if}
		</section>

		<section class={CARTAO}>
			<div class="flex items-center gap-2 mb-2">
				{@render estado(false)}
				<h2 class="font-bold">3. Trocar a unidade-mãe</h2>
			</div>
			{#if transferenciaLiberada}
				<p class="text-sm mb-3">
					Nada mais impede. <strong>{data.unidade.nome}</strong> passa a ficar abaixo de
					<strong>{nomeDaNovaMae}</strong>, levando junto tudo o que está abaixo dela.
				</p>
				<form method="POST" action="?/concluir" use:enhance={aoConcluir}>
					<input type="hidden" name="ato" value="transferir" />
					<input type="hidden" name="para" value={t.para} />
					<button type="submit" class="btn preset-filled-primary-500" disabled={pending}>
						{pending ? 'Trocando...' : `Trocar a mãe para ${nomeDaNovaMae}`}
					</button>
				</form>
			{:else}
				<p class="text-sm text-surface-600">Resolva o passo acima primeiro.</p>
			{/if}
		</section>
	{/if}
{/if}

{#if form?.error}
	<RecusaDaEstrutura texto={form.error} />
{/if}
