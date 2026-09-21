<script lang="ts">
	/**
	 * Gestão de colaboradores (`/colaboradores`, Admin Geral) — a terceira
	 * identidade: servidora administrativa e colaboradora terceirizada. Entra
	 * por CPF (E55), com 2FA no e-mail pessoal.
	 *
	 * A senha provisória aparece UMA vez, na caixa destacada depois de criar
	 * ou redefinir; fechar a caixa é perdê-la — os caminhos de volta são "Nova
	 * senha" aqui e "Esqueceu a senha?" na tela de login.
	 */
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { ActionResult } from '@sveltejs/kit';
	import type { PageProps } from './$types';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { toaster } from '$lib/toast';

	const { data }: PageProps = $props();

	let cadastroOpen = $state(false);
	let pending = $state(false);
	let nome = $state('');
	let cpf = $state('');
	let emailPessoal = $state('');
	let unidadeId = $state('');
	const nomeDaUnidade = (id: number | null) =>
		id == null ? null : (data.unidades.find((u) => u.id === id)?.nome ?? `#${id}`);
	let vinculo = $state('');
	const formId = $props.id();

	/** A senha provisória recém-gerada — só existe nesta tela, até ser fechada. */
	let senhaGerada = $state<{ nome: string; senha: string } | null>(null);

	function limpar() {
		nome = '';
		cpf = '';
		emailPessoal = '';
		unidadeId = '';
		vinculo = '';
	}

	function tratarResultado(sucessoMsg: string) {
		pending = true;
		return async ({ result }: { result: ActionResult }) => {
			pending = false;
			if (result.type === 'success') {
				const d = result.data as
					{ criado?: { nome: string }; senhaProvisoria?: string } | undefined;
				if (d?.criado && d.senhaProvisoria) {
					senhaGerada = { nome: d.criado.nome, senha: d.senhaProvisoria };
				}
				toaster.create({ title: sucessoMsg, type: 'success' });
				limpar();
				cadastroOpen = false;
				await invalidateAll();
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({ title: String(d?.error || 'Erro ao salvar'), type: 'error' });
			}
		};
	}

	async function copiar(texto: string) {
		try {
			await navigator.clipboard.writeText(texto);
			toaster.create({ title: 'Senha copiada', type: 'success' });
		} catch {
			toaster.create({ title: 'Não foi possível copiar — anote a senha', type: 'error' });
		}
	}
</script>

<svelte:head>
	<title>Colaboradores | Ecossistema PCCE</title>
</svelte:head>

<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
	<div>
		<h1 class="h1 text-2xl font-bold">Colaboradores</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
			Servidores administrativos e terceirizados. Entram com CPF e senha (ou e-CPF). Você os lota
			numa unidade; o que cada um pode fazer é a unidade que define, na ficha dela.
		</p>
	</div>
	<button
		type="button"
		class="btn btn-sm preset-filled-primary-500 transition-all"
		onclick={() => (cadastroOpen = true)}
	>
		Cadastrar
	</button>
</div>

{#if senhaGerada}
	<div
		class="mb-6 p-4 rounded-xl border border-warning-500/40 bg-warning-500/10"
		role="status"
		aria-live="polite"
	>
		<p class="text-sm font-semibold">
			Senha provisória de <strong>{senhaGerada.nome}</strong> — mostrada só agora:
		</p>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<code
				class="text-lg font-mono tracking-wider px-3 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-800"
				>{senhaGerada.senha}</code
			>
			<button
				type="button"
				class="btn btn-sm preset-outlined-surface-500"
				onclick={() => copiar(senhaGerada!.senha)}>Copiar</button
			>
			<button
				type="button"
				class="btn btn-sm preset-outlined-surface-500"
				onclick={() => (senhaGerada = null)}>Fechar</button
			>
		</div>
		<p class="text-xs text-surface-600 dark:text-surface-400 mt-2">
			Repasse à pessoa. Ela entra com o CPF; no primeiro acesso recebe um código no e-mail pessoal e
			é obrigada a trocar a senha.
		</p>
	</div>
{/if}

<div class="overflow-x-auto rounded-2xl border border-surface-200 dark:border-white/10">
	<table class="table w-full">
		<thead>
			<tr>
				<th>Nome</th>
				<th>E-mail pessoal</th>
				<th>Unidade</th>
				<th>Vínculo</th>
				<th>Situação</th>
				<th class="text-right">Ações</th>
			</tr>
		</thead>
		<tbody>
			{#if data.colaboradores.length === 0}
				<tr>
					<td colspan="6" class="text-center text-surface-600 dark:text-surface-400 py-8">
						Nenhum colaborador cadastrado.
					</td>
				</tr>
			{/if}
			{#each data.colaboradores as c (c.id)}
				<tr>
					<td class="font-medium {c.ativo ? '' : 'opacity-60 line-through'}">{c.nome}</td>
					<td class="text-sm">{c.email_pessoal}</td>
					<td class="text-sm">
						<form
							method="POST"
							action="?/definirUnidade"
							use:enhance={() => tratarResultado('Lotação salva')}
							class="flex items-center gap-1"
						>
							<input type="hidden" name="colaborador_id" value={c.id} />
							<select
								class="select w-48 py-1 text-xs"
								name="unidade_id"
								value={c.unidade_id ?? ''}
								onchange={(e) => e.currentTarget.form?.requestSubmit()}
								disabled={pending}
							>
								<option value="">— sem lotação —</option>
								{#each data.unidades as un (un.id)}
									<option value={un.id}>{un.nome}</option>
								{/each}
							</select>
							{#if c.unidade_id != null}
								<a
									href="/unidade/{c.unidade_id}"
									class="text-2xs text-primary-700 underline-offset-2 hover:underline dark:text-primary-400"
									title={nomeDaUnidade(c.unidade_id) ?? ''}>acessos</a
								>
							{/if}
						</form>
					</td>
					<td class="text-sm italic">{c.vinculo || '—'}</td>
					<td class="text-xs">
						{#if !c.ativo}
							<span
								class="inline-block font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-warning-500/20 text-warning-700 dark:text-warning-300"
								>Desativado</span
							>
						{:else if c.primeiro_acesso}
							<span
								class="inline-block font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-surface-200/80 dark:bg-surface-700/80"
								>Aguardando 1º acesso</span
							>
						{:else}
							<span
								class="inline-block font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-success-500/15 text-success-700 dark:text-success-300"
								>Ativo</span
							>
						{/if}
					</td>
					<td>
						<div class="flex gap-2 justify-end">
							{#if c.ativo}
								<form
									method="POST"
									action="?/redefinirSenha"
									use:enhance={() => tratarResultado('Senha provisória gerada')}
								>
									<input type="hidden" name="colaborador_id" value={c.id} />
									<button
										type="submit"
										class="btn btn-sm preset-outlined-surface-500"
										disabled={pending}>Nova senha</button
									>
								</form>
							{/if}
							<form
								method="POST"
								action="?/definirAtivo"
								use:enhance={() =>
									tratarResultado(c.ativo ? 'Colaborador desativado' : 'Colaborador reativado')}
							>
								<input type="hidden" name="colaborador_id" value={c.id} />
								<input type="hidden" name="ativo" value={c.ativo ? 'false' : 'true'} />
								<button
									type="submit"
									class="btn btn-sm {c.ativo
										? 'preset-outlined-surface-500'
										: 'preset-filled-success-500'} transition-all"
									disabled={pending}>{c.ativo ? 'Desativar' : 'Reativar'}</button
								>
							</form>
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<ModalShell
	bind:open={cadastroOpen}
	title="Cadastrar colaborador"
	largura="md"
	{pending}
	cancelLabel="Cancelar"
	onOpenChange={(aberto) => {
		if (!aberto) limpar();
	}}
>
	<form
		id={formId}
		method="POST"
		action="?/criar"
		use:enhance={() => tratarResultado('Colaborador cadastrado')}
		class="flex flex-col gap-4"
	>
		<label class="label">
			<span class="label-text">Nome completo</span>
			<input class="input" type="text" name="nome" bind:value={nome} maxlength="200" required />
		</label>
		<label class="label">
			<span class="label-text">CPF (será o login)</span>
			<input
				class="input"
				type="text"
				name="cpf"
				bind:value={cpf}
				maxlength="14"
				inputmode="numeric"
				autocomplete="off"
				required
			/>
		</label>
		<label class="label">
			<span class="label-text">E-mail pessoal (recebe o código de acesso)</span>
			<input
				class="input"
				type="email"
				name="email_pessoal"
				bind:value={emailPessoal}
				maxlength="254"
				autocomplete="off"
				required
			/>
		</label>
		<label class="label">
			<span class="label-text">Vínculo (empresa ou contrato)</span>
			<input class="input" type="text" name="vinculo" bind:value={vinculo} maxlength="120" />
		</label>
		<label class="label">
			<span class="label-text">Unidade em que está lotado(a)</span>
			<select class="select" name="unidade_id" bind:value={unidadeId}>
				<option value="">— definir depois —</option>
				{#each data.unidades as un (un.id)}
					<option value={un.id}>{un.nome}</option>
				{/each}
			</select>
			<span class="text-xs text-surface-600 dark:text-surface-400"
				>O que a pessoa pode fazer é definido pela unidade, na ficha dela.</span
			>
		</label>
		<p class="text-xs text-surface-600 dark:text-surface-400">
			A senha provisória é gerada ao salvar e mostrada uma única vez.
		</p>
	</form>

	{#snippet footer()}
		<button
			type="submit"
			form={formId}
			class="btn preset-filled-primary-500"
			disabled={pending || !nome.trim() || !cpf.trim() || !emailPessoal.trim()}
		>
			{pending ? 'Cadastrando...' : 'Cadastrar'}
		</button>
	{/snippet}
</ModalShell>
