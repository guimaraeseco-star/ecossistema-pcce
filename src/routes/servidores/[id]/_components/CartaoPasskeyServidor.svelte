<script lang="ts">
	/**
	 * Chave de assinatura do servidor, na visão do Admin Geral — e o botão de
	 * revogar, que é o procedimento de "perdi o celular".
	 *
	 * **Só revoga.** Não existe cadastrar aqui, e isso não é lacuna: um
	 * administrador que pudesse registrar a chave de outra pessoa esvaziaria o
	 * controle exclusivo (Lei 14.063/2020 art. 4º II "b") que a passkey existe
	 * para provar. Depois da revogação, quem cadastra a nova é o titular, no
	 * aparelho dele, em Meu Perfil.
	 *
	 * O recorte do identificador é o mesmo do manifesto (`CHAVE DE ASSINATURA`):
	 * o operador confronta o papel com esta ficha sem abrir o banco. O id
	 * completo e a chave pública não descem ao cliente.
	 *
	 * O texto tem de dizer as duas coisas que o operador precisa saber antes de
	 * clicar — que documentos já assinados NÃO são afetados, e que revogar não
	 * devolve o acesso sozinho. Sem isso, a dúvida vira ticket ou, pior, vira
	 * hesitação em usar o único caminho de recuperação que existe.
	 */
	import { toaster } from '$lib/toast';
	import { loading } from '$lib/loading.svelte';
	import { apiFetch } from '$lib/api-fetch';
	import { invalidateAll } from '$app/navigation';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { mensagemChaveNoCartaoAdmin, notaProvedorDeclarado } from '$lib/chave-assinatura-ui';
	import { mensagemDeErro } from '$lib/utils/erro';

	type ChaveAnterior = {
		identificador: string;
		criadoEm: string;
		revogadoEm: string;
		apelido: string | null;
		provedor: string | null;
	};

	const {
		policialId,
		nome,
		passkey,
		chavesAnteriores = []
	}: {
		policialId: number;
		nome: string;
		passkey: {
			identificador: string;
			criadoEm: string;
			ultimoUso: string | null;
			vinculo: string;
			apelido: string | null;
			provedor: string | null;
		} | null;
		chavesAnteriores?: ChaveAnterior[];
	} = $props();

	let confirmando = $state(false);

	const formatar = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : null);

	async function revogar() {
		loading.show('Revogando chave...');
		try {
			await apiFetch(`/api/policiais/${policialId}/passkey`, { method: 'DELETE' });
			confirmando = false;
			await invalidateAll();
			toaster.create({
				title: 'Chave de assinatura revogada.',
				description: 'Um aviso foi enviado ao e-mail funcional do servidor.',
				type: 'success'
			});
		} catch (e: unknown) {
			toaster.create({
				title: mensagemDeErro(e, 'Erro ao revogar a chave.'),
				type: 'error'
			});
		} finally {
			loading.hide();
		}
	}
</script>

<ModalShell
	bind:open={confirmando}
	title="Revogar chave de assinatura?"
	largura="sm"
	pending={loading.active}
	cancelLabel="Cancelar"
>
	{#snippet description()}
		A chave de <strong>{nome}</strong> deixa de valer para novas assinaturas. Use quando o aparelho
		for perdido, furto ou trocado.
		<span class="block mt-2">
			Os <strong>documentos já assinados continuam válidos</strong> — revogar é ato futuro.
		</span>
		<span class="block mt-2">
			A revogação <strong>não cadastra</strong> a chave nova: quem cadastra é o próprio servidor, em Meu
			Perfil, pelo celular dele. Um aviso chega no e-mail funcional dele.
		</span>
	{/snippet}

	{#snippet footer()}
		<button
			type="button"
			class="btn btn-sm preset-filled-error-500 flex items-center gap-2 transition-colors"
			onclick={revogar}
			disabled={loading.active}
		>
			{loading.active ? 'Revogando...' : 'Revogar chave'}
		</button>
	{/snippet}
</ModalShell>

<div class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6 flex flex-col">
	<h2 class="text-base font-bold mb-1 text-surface-700 dark:text-surface-300">
		Chave de assinatura
	</h2>
	<p class="text-xs text-surface-600 dark:text-surface-400 mb-3">
		{mensagemChaveNoCartaoAdmin()} O recorte abaixo é o mesmo da linha
		<strong>CHAVE DE ASSINATURA</strong> no manifesto do PDF.
	</p>

	{#if passkey}
		<div class="p-3 rounded-xl bg-success-500/5 border border-success-500/20 mb-3">
			{#if passkey.apelido}
				<p class="text-base font-bold text-success-700 dark:text-success-400">{passkey.apelido}</p>
				<p class="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
					Registrada em {formatar(passkey.criadoEm)}
					{#if passkey.provedor}
						· {passkey.provedor} ({notaProvedorDeclarado()})
					{/if}
				</p>
			{:else}
				<p class="text-sm font-semibold text-surface-900 dark:text-white">
					Registrada em {formatar(passkey.criadoEm)}
					{#if passkey.provedor}
						· {passkey.provedor} ({notaProvedorDeclarado()})
					{/if}
				</p>
			{/if}
			<p
				class="mt-2 font-mono text-xs tracking-wide text-surface-500 dark:text-surface-500 break-all select-all"
			>
				{passkey.identificador}
			</p>
			<p class="text-xs text-surface-600 dark:text-surface-400 mt-2">
				Credencial {passkey.vinculo}.
				{#if formatar(passkey.ultimoUso)}
					Último uso em {formatar(passkey.ultimoUso)}.
				{:else}
					Ainda não usada para assinar.
				{/if}
			</p>
		</div>
		<button
			type="button"
			class="btn btn-sm preset-outlined-error-500 mt-auto"
			onclick={() => (confirmando = true)}
		>
			Revogar chave
		</button>
	{:else}
		<p
			class="text-sm text-surface-600 dark:text-surface-400 {chavesAnteriores.length
				? 'mb-3'
				: 'mt-auto'}"
		>
			Este servidor não tem chave de assinatura registrada. Se a exigência de chave estiver ativa,
			ele não conseguirá assinar até cadastrar uma em Meu Perfil.
		</p>
	{/if}

	{#if chavesAnteriores.length > 0}
		<div class="mt-3 pt-3 border-t border-surface-200 dark:border-white/10">
			<p
				class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-2"
			>
				Chaves anteriores (revogadas)
			</p>
			<p class="text-xs text-surface-600 dark:text-surface-400 mb-2">
				Documentos já assinados com elas continuam válidos. Compare o recorte do manifesto.
			</p>
			<ul class="space-y-2">
				{#each chavesAnteriores as ant (`${ant.identificador}-${ant.revogadoEm}`)}
					<li class="text-xs text-surface-700 dark:text-surface-300">
						<p class="font-mono text-sm tracking-wide break-all select-all">
							{ant.identificador}{#if ant.apelido}
								— {ant.apelido}{/if}
						</p>
						<p class="text-surface-600 dark:text-surface-400">
							Cadastrada em {formatar(ant.criadoEm)} · revogada em {formatar(ant.revogadoEm)}
							{#if ant.provedor}
								· {ant.provedor}
							{/if}
						</p>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
