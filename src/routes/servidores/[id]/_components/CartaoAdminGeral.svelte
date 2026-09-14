<script lang="ts">
	/**
	 * Admin Geral na ficha do policial — vínculo + consoles liberados.
	 *
	 * Três chaves na mesma carta: a do vínculo (cria/remove a linha em
	 * `administradores`) e as dos módulos Escalas / GISE, que só aparecem com o
	 * vínculo ligado. Desligar o último módulo é recusado no servidor — quem quer
	 * zerar o acesso remove o Admin Geral.
	 *
	 * `somenteLeitura` é o que o administrador de seccional/unidade vê: o mesmo
	 * quadro, sem chave nenhuma. Conceder Admin Geral é conceder PERMISSÃO, e isso
	 * não é "corrigir um dado" — não entra no fluxo de solicitação, e por isso
	 * aqui não há nem formulário a submeter. Mostrar o estado, ainda assim,
	 * responde "por que esta pessoa administra tudo?" sem obrigar ninguém a
	 * perguntar.
	 */
	import { enhance } from '$app/forms';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { toaster } from '$lib/toast';
	import { loading } from '$lib/loading.svelte';
	import type { ActionResult } from '@sveltejs/kit';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';

	const {
		policialId,
		ehAdminGeral,
		moduloEscalas,
		moduloGise,
		disabled = false,
		somenteLeitura = false
	}: {
		policialId: number;
		ehAdminGeral: boolean;
		moduloEscalas: boolean;
		moduloGise: boolean;
		disabled?: boolean;
		somenteLeitura?: boolean;
	} = $props();

	/** Os consoles liberados, em texto — só faz sentido com o vínculo ligado. */
	const modulosEmTexto = $derived(
		[moduloEscalas && 'Escalas ordinárias', moduloGise && 'GISE (extra)']
			.filter((m): m is string => !!m)
			.join(' · ')
	);

	let formAdminGeral = $state<HTMLFormElement>();
	let formModuloEscalas = $state<HTMLFormElement>();
	let formModuloGise = $state<HTMLFormElement>();

	function enhanceToggle(tituloOk: string) {
		loading.show('Atualizando condição de Admin Geral...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				toaster.create({ title: tituloOk, type: 'success' });
				await invalidateShared(`policial:${policialId}`, 'app:policiais');
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				if (d?.error) toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}
</script>

<div class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6 flex flex-col">
	<h2 class="text-base font-bold mb-1 text-surface-700 dark:text-surface-300">
		Admin Geral
		{#if somenteLeitura}
			<span class="text-2xs font-bold uppercase opacity-60 ml-1">informativo</span>
		{/if}
	</h2>
	<p class="text-xs text-surface-600 dark:text-surface-400 mb-3">
		Concede acesso de Administrador Geral. A pessoa loga com a <b>mesma matrícula e senha</b>,
		escolhendo <b>"Administrador"</b> na tela de login. É cumulativo com o papel ao lado. Com o vínculo
		ligado, libere os consoles que esta pessoa vai administrar.
	</p>

	{#if somenteLeitura}
		<div class="mt-auto space-y-1">
			<p class="text-sm font-semibold">
				{ehAdminGeral ? 'É Admin Geral' : 'Não é Admin Geral'}
			</p>
			{#if ehAdminGeral}
				<p class="text-xs text-surface-600 dark:text-surface-400">
					Consoles liberados: {modulosEmTexto || 'nenhum'}
				</p>
			{/if}
			<p class="text-2xs text-surface-600 dark:text-surface-400">
				Somente o Administrador Geral concede ou revoga este acesso.
			</p>
		</div>
	{:else}
		<div class="mt-auto space-y-3">
			<form
				method="POST"
				action="?/toggleAdminGeral"
				use:enhance={() => enhanceToggle('Condição de Admin Geral atualizada!')}
				bind:this={formAdminGeral}
			>
				<input type="hidden" name="ativar" value={ehAdminGeral ? '0' : '1'} />
				<ToggleSwitch
					reverse
					checked={ehAdminGeral}
					{disabled}
					onCheckedChange={() => formAdminGeral?.requestSubmit()}
				>
					<span
						class="text-sm font-semibold {ehAdminGeral
							? 'text-success-700 dark:text-success-400'
							: 'text-surface-600 dark:text-surface-400'}"
					>
						{ehAdminGeral ? 'É Admin Geral' : 'Não é Admin Geral'}
					</span>
				</ToggleSwitch>
			</form>

			{#if ehAdminGeral}
				<form
					method="POST"
					action="?/toggleModuloAdmin"
					use:enhance={() => enhanceToggle('Módulo de Escalas atualizado!')}
					bind:this={formModuloEscalas}
				>
					<input type="hidden" name="modulo" value="escalas" />
					<input type="hidden" name="ativar" value={moduloEscalas ? '0' : '1'} />
					<ToggleSwitch
						reverse
						checked={moduloEscalas}
						{disabled}
						onCheckedChange={() => formModuloEscalas?.requestSubmit()}
					>
						<span
							class="text-sm font-semibold {moduloEscalas
								? 'text-success-700 dark:text-success-400'
								: 'text-surface-600 dark:text-surface-400'}"
						>
							{moduloEscalas ? 'Escalas ordinárias liberadas' : 'Escalas ordinárias bloqueadas'}
						</span>
					</ToggleSwitch>
				</form>

				<form
					method="POST"
					action="?/toggleModuloAdmin"
					use:enhance={() => enhanceToggle('Módulo GISE atualizado!')}
					bind:this={formModuloGise}
				>
					<input type="hidden" name="modulo" value="gise" />
					<input type="hidden" name="ativar" value={moduloGise ? '0' : '1'} />
					<ToggleSwitch
						reverse
						checked={moduloGise}
						{disabled}
						onCheckedChange={() => formModuloGise?.requestSubmit()}
					>
						<span
							class="text-sm font-semibold {moduloGise
								? 'text-success-700 dark:text-success-400'
								: 'text-surface-600 dark:text-surface-400'}"
						>
							{moduloGise ? 'GISE (extra) liberado' : 'GISE (extra) bloqueado'}
						</span>
					</ToggleSwitch>
				</form>
			{/if}
		</div>
	{/if}
</div>
