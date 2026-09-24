<script lang="ts">
	/**
	 * Edição de unidade (`/unidades`, Super Admin) — estrutura E ficha num
	 * formulário só (fase 2-B, decisão E39 item 3.1).
	 *
	 * Estrutura: nome, tipo, unidade superior, cidade, sigla e regimes. Ficha
	 * (migração 0085): endereço, telefone, e-mail, AIS, xadrezes, tira-gravame e
	 * a foto da fachada — link de origem e/ou arquivo, que o servidor copia para
	 * o R2. Até a fase 2-A esses dados só entravam pela importação da planilha;
	 * sem esta tela ninguém corrigia um telefone.
	 *
	 * A unidade superior oferece qualquer unidade ativa MENOS a própria e as que
	 * já estão abaixo dela — fechar um ciclo é a única forma de a árvore perder
	 * a raiz, e o servidor recusa de novo (`motivoParaRecusarSuperior`).
	 */
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { toaster } from '$lib/toast';
	import { CIDADES_CEARA } from '$lib/constants/cidades';
	import { TIPOS_UNIDADE, nivelTipoUnidade } from '$lib/unidades/tipos';
	import type { Unidade } from '$lib/types';

	let {
		open = $bindable(false),
		unidade,
		unidades
	}: {
		open: boolean;
		/** A unidade em edição; `null` enquanto o modal está fechado. */
		unidade: Unidade | null;
		/** Todas as unidades (a lista da tela), para o combo de superior. */
		unidades: Unidade[];
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	const datalistId = `${uid}-cidades`;

	let nome = $state('');
	let tipo = $state<Unidade['tipo']>('delegacia');
	let superiorId = $state<number | null>(null);
	let cidade = $state('');
	let sigla = $state('');
	/** O código da unidade na COTIC (0101) — identificador externo, opcional. */
	let idCotic = $state('');
	let temPlantao = $state(false);
	let temExpediente = $state(false);
	let temFds = $state(false);
	let endereco = $state('');
	let telefone = $state('');
	let email = $state('');
	let ais = $state('');
	let xadrezes = $state(0);
	let tiraGravame = $state(false);
	let fotoUrl = $state('');
	let removerFoto = $state(false);
	let pending = $state(false);
	let inputFoto = $state<HTMLInputElement | undefined>();

	// Recarrega os campos toda vez que o modal abre. O formulário fica no DOM
	// entre uma abertura e outra, e o <input type="file"> guardaria o arquivo do
	// envio anterior — reenviando-o junto com um "remover foto".
	$effect(() => {
		if (!open || !unidade) return;
		if (inputFoto) inputFoto.value = '';
		nome = unidade.nome;
		tipo = unidade.tipo;
		superiorId = unidade.seccional_id;
		cidade = unidade.cidade ?? '';
		sigla = unidade.sigla ?? '';
		idCotic = unidade.id_cotic ?? '';
		temPlantao = unidade.tem_plantao ?? false;
		temExpediente = unidade.tem_expediente ?? false;
		temFds = unidade.tem_fds ?? false;
		endereco = unidade.endereco ?? '';
		telefone = unidade.telefone ?? '';
		email = unidade.email ?? '';
		ais = unidade.ais ?? '';
		xadrezes = unidade.xadrezes ?? 0;
		tiraGravame = unidade.tira_gravame ?? false;
		fotoUrl = unidade.foto_url ?? '';
		removerFoto = false;
	});

	/** Ids da própria unidade e de tudo abaixo dela — não podem ser o superior. */
	const excluidosDoSuperior = $derived.by(() => {
		// Set local, devolvido pronto: não é estado, é o resultado do derivado.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const ids = new Set<number>();
		if (!unidade) return ids;
		const fila = [unidade.id];
		while (fila.length) {
			const atual = fila.shift() as number;
			if (ids.has(atual)) continue;
			ids.add(atual);
			for (const u of unidades) if (u.seccional_id === atual) fila.push(u.id);
		}
		return ids;
	});

	const opcoesSuperior = $derived(
		unidades
			.filter((u) => u.ativo && !excluidosDoSuperior.has(u.id))
			.sort(
				(a, b) =>
					nivelTipoUnidade(a.tipo) - nivelTipoUnidade(b.tipo) ||
					a.nome.localeCompare(b.nome, 'pt-BR')
			)
	);

	const ehDepartamento = $derived(tipo === 'departamento' || tipo === 'sub_departamento');

	function handleEditar() {
		pending = true;
		return async ({ result }: { result: ActionResult }) => {
			pending = false;
			if (result.type === 'success') {
				await invalidateShared('app:unidades');
				toaster.create({ title: 'Unidade atualizada com sucesso!', type: 'success' });
				open = false;
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao atualizar unidade'), type: 'error' });
			}
		};
	}

	const CAMPO = 'input text-sm w-full';
	const ROTULO = 'label-text text-xs font-semibold text-surface-600 dark:text-surface-400';
	const SECAO = 'text-2xs font-semibold text-surface-500 mt-2';
</script>

<ModalShell bind:open title="Editar unidade" largura="2xl" {pending} cancelLabel="Cancelar">
	{#if unidade}
		<form
			id={formId}
			method="POST"
			action="?/editar"
			enctype="multipart/form-data"
			use:enhance={handleEditar}
			class="flex flex-col gap-3"
		>
			<input type="hidden" name="id" value={unidade.id} />
			<!-- Os checkboxes vão como 'on' (o servidor lê `=== 'on'`); o superior
			     vazio vai como '' para o schema receber null. -->
			<input type="hidden" name="seccional_id" value={superiorId ?? ''} />

			<p class={SECAO}>Estrutura</p>
			<label class="label">
				<span class={ROTULO}>Nome</span>
				<input class={CAMPO} type="text" name="nome" maxlength="200" bind:value={nome} required />
			</label>
			<div class="grid gap-3 sm:grid-cols-2">
				<label class="label">
					<span class={ROTULO}>Tipo</span>
					<select class="select text-sm" name="tipo" bind:value={tipo}>
						{#each TIPOS_UNIDADE as t (t.valor)}
							<option value={t.valor}>{t.rotulo}</option>
						{/each}
					</select>
				</label>
				<label class="label">
					<span class={ROTULO}>Unidade superior</span>
					<select class="select text-sm" bind:value={superiorId}>
						<option value={null}>Nenhuma (raiz da árvore)</option>
						{#each opcoesSuperior as u (u.id)}
							<option value={u.id}>{u.sigla || u.nome}</option>
						{/each}
					</select>
				</label>
				<label class="label">
					<span class={ROTULO}>Cidade</span>
					<input
						class={CAMPO}
						type="text"
						name="cidade"
						maxlength="200"
						list={datalistId}
						bind:value={cidade}
					/>
					<datalist id={datalistId}>
						{#each CIDADES_CEARA as c (c)}
							<option value={c}></option>
						{/each}
					</datalist>
				</label>
				{#if ehDepartamento}
					<!-- Sigla é atributo de departamento; delegacia e seccional não têm. -->
					<label class="label">
						<span class={ROTULO}>Sigla</span>
						<input
							class={CAMPO}
							type="text"
							name="sigla"
							maxlength="20"
							bind:value={sigla}
							placeholder="DPI SUL"
						/>
					</label>
				{:else}
					<input type="hidden" name="sigla" value="" />
				{/if}
				<!-- O código na COTIC (0101): preenchido quando a lista oficial chegar.
				     Fica aqui, junto da sigla, porque é da mesma natureza — um
				     identificador externo da unidade, não a identidade dela aqui. -->
				<label class="label">
					<span class={ROTULO}>
						Código na COTIC
						<span class="font-normal normal-case opacity-70">— opcional</span>
					</span>
					<input
						class={CAMPO}
						type="text"
						name="id_cotic"
						maxlength="30"
						bind:value={idCotic}
						placeholder="ainda não informado"
					/>
				</label>
			</div>
			<div class="flex flex-wrap items-center gap-4 text-sm">
				<span class={ROTULO}>Regimes:</span>
				<label class="flex items-center gap-1.5"
					><input class="checkbox" type="checkbox" name="tem_plantao" bind:checked={temPlantao} />
					<span>Plantão</span></label
				>
				<label class="flex items-center gap-1.5"
					><input
						class="checkbox"
						type="checkbox"
						name="tem_expediente"
						bind:checked={temExpediente}
					/> <span>Expediente</span></label
				>
				<label class="flex items-center gap-1.5"
					><input class="checkbox" type="checkbox" name="tem_fds" bind:checked={temFds} />
					<span>Fim de semana</span></label
				>
			</div>

			<p class={SECAO}>Ficha</p>
			<label class="label">
				<span class={ROTULO}>Endereço</span>
				<input class={CAMPO} type="text" name="endereco" maxlength="300" bind:value={endereco} />
			</label>
			<div class="grid gap-3 sm:grid-cols-3">
				<label class="label">
					<span class={ROTULO}>Telefone</span>
					<input class={CAMPO} type="text" name="telefone" maxlength="60" bind:value={telefone} />
				</label>
				<label class="label sm:col-span-2">
					<span class={ROTULO}>E-mail</span>
					<input class={CAMPO} type="email" name="email" maxlength="120" bind:value={email} />
				</label>
				<label class="label">
					<span class={ROTULO}>AIS</span>
					<input
						class={CAMPO}
						type="text"
						name="ais"
						maxlength="20"
						bind:value={ais}
						placeholder="AIS 15"
					/>
				</label>
				<label class="label">
					<span class={ROTULO}>Xadrezes</span>
					<input
						class={CAMPO}
						type="number"
						name="xadrezes"
						min="0"
						max="99"
						step="1"
						bind:value={xadrezes}
					/>
				</label>
				<label class="flex items-center gap-1.5 self-end pb-2 text-sm"
					><input class="checkbox" type="checkbox" name="tira_gravame" bind:checked={tiraGravame} />
					<span>Tira-gravame</span></label
				>
			</div>

			<p class={SECAO}>Foto da fachada</p>
			{#if unidade.foto_key || unidade.foto_url}
				<div class="flex items-start gap-3">
					<img
						src="/api/unidades/{unidade.id}/foto"
						alt="Fachada atual de {unidade.nome}"
						class="h-20 w-28 rounded-lg object-cover"
						onerror={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)}
					/>
					<label class="flex items-center gap-1.5 text-sm"
						><input
							class="checkbox"
							type="checkbox"
							name="remover_foto"
							bind:checked={removerFoto}
						/> <span>Remover a cópia guardada</span></label
					>
				</div>
			{/if}
			<div class="grid gap-3 sm:grid-cols-2">
				<label class="label">
					<span class={ROTULO}>Enviar arquivo (JPEG ou PNG, até 3 MB)</span>
					<input
						bind:this={inputFoto}
						class="input text-sm"
						type="file"
						name="foto"
						accept="image/jpeg,image/png"
					/>
				</label>
				<label class="label">
					<span class={ROTULO}>Link de origem (reserva)</span>
					<input
						class={CAMPO}
						type="url"
						name="foto_url"
						maxlength="500"
						bind:value={fotoUrl}
						placeholder="https://…"
					/>
				</label>
			</div>
		</form>
	{/if}

	{#snippet footer()}
		<button
			type="submit"
			form={formId}
			class="btn preset-filled-primary-500"
			disabled={pending || !nome.trim()}
		>
			{pending ? 'Salvando...' : 'Salvar'}
		</button>
	{/snippet}
</ModalShell>
