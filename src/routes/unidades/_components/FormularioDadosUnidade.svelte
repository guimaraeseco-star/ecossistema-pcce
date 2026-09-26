<script lang="ts">
	/**
	 * Os DADOS da unidade — o ato "Editar os dados" do guia (E73, tudo no Guia).
	 *
	 * Era a janela de editar da tela `/unidades`, que misturava os dados e a
	 * unidade-mãe num formulário só. Com tudo no Guia (decisão dele em 26/09),
	 * cada ato tem o seu caminho: aqui se editam os dados; a mãe se troca SÓ pelo
	 * guia de transferir. Por isso não há campo de mãe — ela vai no envio sem
	 * mudar, e o servidor recusa se mudar (`/unidades?/editar`).
	 *
	 * Dois avisos aparecem só quando o campo muda, porque é aí que a pessoa
	 * precisa da explicação: o que a renomeação atualiza (e o que não), e que
	 * mudar o TIPO é corrigir cadastro, não promover — promover é criar a nova,
	 * mover as pessoas e desativar a antiga, a ordem que ele corrigiu na E73.
	 *
	 * Envia para a MESMA action da tela (`/unidades?/editar`): mesmas validações,
	 * mesmo tratamento de renomeação concorrente, mesma foto no R2, mesma
	 * auditoria. O guia não tem caminho próprio de gravação.
	 */
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { CIDADES_CEARA } from '$lib/constants/cidades';
	import { TIPOS_UNIDADE } from '$lib/unidades/tipos';
	import type { Unidade } from '$lib/types';
	import RecusaDaEstrutura from './RecusaDaEstrutura.svelte';

	const { unidade, onSalvo }: { unidade: Unidade; onSalvo?: () => void } = $props();

	const uid = $props.id();
	const datalistId = `${uid}-cidades`;

	// O ponto de partida é a unidade como está. É leitura ÚNICA, de propósito:
	// o formulário é o rascunho da pessoa, e não deve ser reescrito por baixo
	// dela enquanto digita. Ao salvar, a página recarrega com o valor novo.
	// svelte-ignore state_referenced_locally
	const inicial = unidade;
	let nome = $state(inicial.nome);
	let tipo = $state<Unidade['tipo']>(inicial.tipo);
	let cidade = $state(inicial.cidade ?? '');
	let sigla = $state(inicial.sigla ?? '');
	let idCotic = $state(inicial.id_cotic ?? '');
	let temPlantao = $state(inicial.tem_plantao ?? false);
	let temExpediente = $state(inicial.tem_expediente ?? false);
	let temFds = $state(inicial.tem_fds ?? false);
	let endereco = $state(inicial.endereco ?? '');
	let telefone = $state(inicial.telefone ?? '');
	let email = $state(inicial.email ?? '');
	let ais = $state(inicial.ais ?? '');
	let xadrezes = $state(inicial.xadrezes ?? 0);
	let tiraGravame = $state(inicial.tira_gravame ?? false);
	let fotoUrl = $state(inicial.foto_url ?? '');
	let removerFoto = $state(false);
	let pending = $state(false);
	let recusa = $state<string | null>(null);

	const ehDepartamento = $derived(tipo === 'departamento' || tipo === 'sub_departamento');
	const renomeando = $derived(nome.trim() !== unidade.nome);
	const mudandoTipo = $derived(tipo !== unidade.tipo);

	function aoSalvar() {
		pending = true;
		recusa = null;
		return async ({ result, update }: { result: ActionResult; update: () => Promise<void> }) => {
			pending = false;
			if (result.type === 'success') {
				await invalidateShared('app:unidades');
				await update();
				onSalvo?.();
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				recusa = String(d?.error || 'Não foi possível salvar os dados.');
			}
		};
	}

	const CAMPO = 'input text-sm w-full';
	const ROTULO = 'label-text text-xs font-semibold text-surface-600 dark:text-surface-400';
	const SECAO = 'text-2xs font-semibold text-surface-500 mt-2';
	const AVISO =
		'rounded-lg border border-surface-300 dark:border-surface-600 bg-surface-100 dark:bg-surface-800 p-2 text-xs';
</script>

{#if recusa}
	<RecusaDaEstrutura texto={recusa} />
{/if}

<form
	method="POST"
	action="/unidades?/editar"
	enctype="multipart/form-data"
	use:enhance={aoSalvar}
	class="flex flex-col gap-3"
>
	<input type="hidden" name="id" value={unidade.id} />
	<!-- A mãe vai como está: ela se troca pelo guia de transferir. -->
	<input type="hidden" name="seccional_id" value={unidade.seccional_id ?? ''} />

	<p class={SECAO}>Identificação</p>
	<label class="label">
		<span class={ROTULO}>Nome</span>
		<input class={CAMPO} type="text" name="nome" maxlength="200" bind:value={nome} required />
	</label>
	{#if renomeando}
		<p class={AVISO}>
			<strong>Ao renomear:</strong> o nome novo passa a aparecer nas fichas dos servidores lotados aqui
			e nas escalas desta unidade. Os avisos já enviados guardam o nome que ela tinha na época — eles
			são o registro do que se disse, e continuam na caixa da unidade.
		</p>
	{/if}
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
	</div>
	{#if mudandoTipo}
		<p class={AVISO}>
			<strong>Mudar o tipo serve para corrigir um cadastro errado.</strong> Não é assim que se promove
			um posto a delegacia: o caminho certo é criar a delegacia nova, mover as pessoas para ela e depois
			desativar o posto. Mudar o tipo aqui reescreveria o passado da unidade — os relatórios antigos passariam
			a chamá-la pelo tipo novo.
		</p>
	{/if}
	<div class="grid gap-3 sm:grid-cols-2">
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
			><input class="checkbox" type="checkbox" name="tem_expediente" bind:checked={temExpediente} />
			<span>Expediente</span></label
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
				><input class="checkbox" type="checkbox" name="remover_foto" bind:checked={removerFoto} />
				<span>Remover a cópia guardada</span></label
			>
		</div>
	{/if}
	<div class="grid gap-3 sm:grid-cols-2">
		<label class="label">
			<span class={ROTULO}>Enviar arquivo (JPEG ou PNG, até 3 MB)</span>
			<input class="input text-sm" type="file" name="foto" accept="image/jpeg,image/png" />
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

	<div>
		<button type="submit" class="btn preset-filled-primary-500" disabled={pending || !nome.trim()}>
			{pending ? 'Salvando...' : 'Salvar os dados'}
		</button>
	</div>
</form>
