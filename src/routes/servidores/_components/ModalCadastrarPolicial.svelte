<script lang="ts">
	/**
	 * Cadastro de policial (`/servidores`).
	 *
	 * O formulário PODE conceder papel administrativo já na criação — e aí
	 * `papel_unidade_id` é obrigatório, porque papel sem alcance deixa o escopo
	 * indefinido (`papelSemUnidade` trava o submit). A única exceção é o admin
	 * de unidade cadastrando outro admin da própria unidade, onde o alcance é
	 * implícito. Alterar papel depois é na tela do policial (`/servidores/[id]`).
	 *
	 * Formulário longo com grade de campos e blocos condicionais de papel —
	 * cabe no ModalShell (`largura="2xl"`) sem ampliar a API do primitive.
	 */
	import { enhance } from '$app/forms';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { toaster } from '$lib/toast';
	import { apiFetch } from '$lib/api-fetch';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { limparTelefone, formatarCPF, limparCPF } from '$lib/utils/formato';
	import type { Unidade } from '$lib/types';
	import type { ActionResult } from '@sveltejs/kit';

	let {
		open = $bindable(false),
		unidades,
		isAdmin,
		isAdminOrSeccional,
		isAdminUnidade,
		lotacaoUsuario = null,
		semTitular = []
	}: {
		open: boolean;
		unidades: Unidade[];
		isAdmin: boolean;
		isAdminOrSeccional: boolean;
		isAdminUnidade: boolean;
		lotacaoUsuario?: string | null;
		/** Ids das unidades SEM direção vigente — o atalho "designar como titular" (E66). */
		semTitular?: number[];
	} = $props();

	const formId = $props.id();

	let nome = $state('');
	let matricula = $state('');
	let cargo = $state<'DPC' | 'OIP'>('OIP');
	let cpf = $state('');
	let telefone = $state('');
	let classe = $state('');
	let regime = $state<'plantao' | 'expediente'>('plantao');
	/** Lotação escolhida pelo Admin Geral (SearchableSelect). Demais papéis usam `lotacaoUsuario`. */
	let lotacaoAdmin = $state('');
	let email = $state('');

	/** "Trabalha em" (E66): vazio = a sede da lotação. */
	let localId = $state('');
	/** Atalho da E66: o delegado recém-cadastrado assume a unidade sem titular. */
	let designarTitular = $state(false);
	let titularDesde = $state('');
	let titularNup = $state('');

	let papel = $state<string | null>(null);
	let papelUnidadeId = $state<number | null>(null);
	// Chave "Conceder Admin Geral" no cadastro (submetida via input hidden).
	let concederAdminGeral = $state(false);
	let moduloEscalas = $state(true);
	let moduloGise = $state(true);
	let pending = $state(false);

	const seccionaisParaPapel = $derived(unidades.filter((u) => u.tipo === 'seccional'));
	const unidadesParaAdmin = $derived(unidades.filter((u) => u.tipo !== 'seccional'));

	// Admin Geral escolhe; demais papéis herdam a lotação do escopo (readonly).
	const lotacaoInput = $derived(isAdmin ? lotacaoAdmin : (lotacaoUsuario ?? ''));

	/** A unidade da lotação escolhida, quando o nome casa com uma cadastrada. */
	const unidadeDaLotacao = $derived(unidades.find((u) => u.nome === lotacaoInput) ?? null);
	/**
	 * Os locais possíveis (E66): a sede e as subunidades dela. Um nível basta na
	 * tela — posto dentro de posto não existe no organograma.
	 */
	const locais = $derived(
		unidadeDaLotacao
			? unidades
					.filter((u) => u.seccional_id === unidadeDaLotacao.id)
					.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
			: []
	);
	/** O atalho só aparece para DELEGADO em unidade que está sem titular. */
	const podeDesignarTitular = $derived(
		isAdmin && cargo === 'DPC' && !!unidadeDaLotacao && semTitular.includes(unidadeDaLotacao.id)
	);

	// Papel administrativo exige a unidade/seccional de responsabilidade.
	const papelPrecisaUnidade = $derived(!!papel && !(isAdminUnidade && papel === 'admin_unidade'));
	const papelSemUnidade = $derived(papelPrecisaUnidade && papelUnidadeId == null);

	const classesDisponiveis = $derived(
		cargo === 'DPC' ? ['1ª', '2ª', '3ª', 'ESPECIAL'] : ['A', 'B', 'C', 'D']
	);
	const lotacaoSelectedOption = $derived(
		lotacaoAdmin ? { value: lotacaoAdmin, label: lotacaoAdmin } : null
	);

	function reset() {
		nome = '';
		matricula = '';
		cargo = 'OIP';
		cpf = '';
		telefone = '';
		classe = '';
		regime = 'plantao';
		lotacaoAdmin = '';
		localId = '';
		designarTitular = false;
		titularDesde = '';
		titularNup = '';
		email = '';
		papel = null;
		papelUnidadeId = null;
		concederAdminGeral = false;
		moduloEscalas = true;
		moduloGise = true;
	}

	function handleSalvar() {
		pending = true;
		return async ({ result }: { result: ActionResult }) => {
			pending = false;
			if (result.type === 'success') {
				await invalidateShared('app:policiais');
				toaster.create({ title: 'Policial cadastrado com sucesso!', type: 'success' });
				reset();
				open = false;
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				if (d?.error) toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}

	async function loadLotacoes(query: string, signal: AbortSignal) {
		// Lotação inclui delegacias (unidades operacionais) E seccionais,
		// pois as seccionais têm efetivo próprio.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams({
			tipo: 'delegacia,seccional',
			limit: '30'
		});
		if (query.trim()) params.set('q', query.trim());

		const dataRes = await apiFetch<{ items?: { nome: string }[] }>(
			`/api/unidades/search?${params.toString()}`,
			{ signal }
		);
		const baseOptions = (dataRes.items || []).map((u: { nome: string }) => ({
			value: u.nome,
			label: u.nome
		}));
		return [{ value: '', label: '— Sem lotação —' }, ...baseOptions];
	}
</script>

<ModalShell
	bind:open
	title="Cadastrar Novo Policial"
	largura="2xl"
	{pending}
	cancelLabel="Cancelar"
	onOpenChange={(aberto) => {
		if (!aberto) reset();
	}}
>
	<form
		id={formId}
		method="POST"
		action="?/criar"
		use:enhance={handleSalvar}
		class="cadastro-policial-modal space-y-3"
	>
		<!-- Campos hidden -->
		<input type="hidden" name="cpf" value={limparCPF(cpf)} />
		<input type="hidden" name="telefone" value={telefone} />
		<input type="hidden" name="lotacao" value={lotacaoInput} />
		<input type="hidden" name="local_id" value={localId} />
		<input
			type="hidden"
			name="designar_titular"
			value={podeDesignarTitular && designarTitular ? '1' : ''}
		/>
		<input type="hidden" name="regime" value={regime} />
		<input type="hidden" name="papel" value={papel ?? ''} />
		<input type="hidden" name="papel_unidade_id" value={papelUnidadeId ?? ''} />

		<!-- Linha 1: Nome (7), Matrícula (2), Cargo (3) -->
		<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
			<label class="label sm:col-span-7">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
					>Nome completo (Conforme Certificado Digital)</span
				>
				<input class="input py-1 px-3 text-sm" type="text" name="nome" bind:value={nome} required />
			</label>
			<label class="label sm:col-span-2">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Matrícula</span>
				<input
					class="input py-1 px-3 text-sm"
					type="text"
					name="matricula"
					bind:value={matricula}
					maxlength="10"
					required
				/>
			</label>
			<label class="label sm:col-span-3">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Cargo</span>
				<select class="select py-1 px-3 text-sm" name="cargo" bind:value={cargo}>
					<option value="DPC">DPC - Delegado</option>
					<option value="OIP">OIP - Investigador</option>
				</select>
			</label>
		</div>

		<!-- Linha 2: CPF (4), E-mail funcional (8). O e-mail pessoal é cadastrado
					 pelo próprio policial (recuperação de senha) — não vai no cadastro. -->
		<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
			<label class="label sm:col-span-4">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
					>CPF (Obrigatório para Token)</span
				>
				<input
					class="input py-1 px-3 text-sm"
					type="text"
					value={cpf}
					oninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}
					placeholder="000.000.000-00"
					maxlength="14"
				/>
			</label>
			<label class="label sm:col-span-8">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
					>E-mail funcional (para 2FA)</span
				>
				<input
					class="input py-1 px-3 text-sm"
					type="email"
					name="email"
					bind:value={email}
					placeholder="exemplo@gmail.com"
				/>
			</label>
		</div>

		<!-- Linha 3: Telefone (3), Classe (2), Regime (3), Lotação (4) -->
		<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
			<label class="label sm:col-span-3">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Telefone</span>
				<input
					class="input py-1 px-3 text-sm"
					type="text"
					inputmode="numeric"
					value={telefone}
					oninput={(e) => (telefone = limparTelefone(e.currentTarget.value))}
					placeholder="Somente números (DDD + número)"
					maxlength="11"
				/>
			</label>
			<label class="label sm:col-span-2">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Classe</span>
				<select class="select py-1 px-3 text-sm" name="classe" bind:value={classe} required>
					<option value="" disabled>-</option>
					{#each classesDisponiveis as c (c)}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</label>
			<label class="label sm:col-span-3">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
					>Regime de Trabalho</span
				>
				<select class="select py-1 px-3 text-sm" bind:value={regime}>
					<option value="plantao">Plantão</option>
					<option value="expediente">Expediente</option>
				</select>
			</label>
			<label class="label sm:col-span-4">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Lotação</span>
				{#if isAdmin}
					<SearchableSelect
						bind:value={lotacaoAdmin}
						loadOptions={loadLotacoes}
						selectedOption={lotacaoSelectedOption}
						class="lotacao-searchable"
						debounceMs={250}
						minSearchChars={0}
						placeholder="Buscar lotação..."
					/>
				{:else}
					<input
						class="input py-1 px-3 text-sm bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75"
						type="text"
						value={lotacaoInput}
						readonly
					/>
				{/if}
			</label>

			<!-- Trabalha em (E66): só quando a lotação tem subunidade (posto, núcleo).
			     A lotação continua sendo a unidade; isto é só onde a pessoa fica. -->
			{#if locais.length > 0}
				<label class="label sm:col-span-12">
					<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">
						Trabalha em
						<span class="normal-case font-normal opacity-70">— a lotação continua a mesma</span>
					</span>
					<select class="select py-1 px-3 text-sm" bind:value={localId}>
						<option value="">{lotacaoInput} (sede)</option>
						{#each locais as l (l.id)}
							<option value={String(l.id)}>{l.nome}</option>
						{/each}
					</select>
				</label>
			{/if}
		</div>

		<!-- Atalho da E66: lotar um delegado numa unidade SEM titular e designá-lo
		     no mesmo ato — eram dois atos e o segundo era esquecido. -->
		{#if podeDesignarTitular}
			<div class="mt-1 rounded-xl border border-warning-500/30 bg-warning-500/5 p-3">
				<label class="flex items-start gap-2 text-sm">
					<input type="checkbox" class="checkbox mt-0.5" bind:checked={designarTitular} />
					<span>
						<span class="font-medium">Designar como titular de {lotacaoInput}</span>
						<span class="block text-xs text-surface-600 dark:text-surface-400">
							A unidade está sem direção vigente. A designação fica registrada com vigência e NUP,
							como na ficha da unidade.
						</span>
					</span>
				</label>
				{#if designarTitular}
					<div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
						<label class="label">
							<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Desde</span>
							<input
								class="input py-1 px-3 text-sm"
								type="date"
								name="titular_desde"
								bind:value={titularDesde}
							/>
						</label>
						<label class="label">
							<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
								>NUP do processo</span
							>
							<input
								class="input py-1 px-3 text-sm"
								type="text"
								name="titular_nup"
								bind:value={titularNup}
								maxlength="40"
								placeholder="00000.000000/0000-00"
							/>
						</label>
					</div>
				{/if}
			</div>
		{/if}

		<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1 items-stretch">
			{#if isAdminOrSeccional || isAdminUnidade}
				<div
					class="p-3 rounded-xl bg-surface-500/5 border border-surface-500/10 space-y-2 flex flex-col"
				>
					<h4 class="text-2xs font-bold uppercase opacity-50">Papel Administrativo (Opcional)</h4>
					<p class="text-xs text-surface-600 dark:text-surface-400 leading-snug">
						Papel de gestão restrito a uma seccional ou unidade: gerencia escalas e policiais apenas
						do próprio escopo. Diferente do Admin Geral, não concede acesso global.
					</p>
					<label class="label">
						<span class="label-text text-2xs font-bold opacity-70 ml-1">Papel</span>
						<select class="select py-1 px-3 text-sm" bind:value={papel}>
							<option value={null}>Servidor (sem papel)</option>
							{#if isAdminOrSeccional}
								<option value="admin_seccional">Admin Seccional</option>
							{/if}
							<option value="admin_unidade">Admin Unidade</option>
						</select>
					</label>
					{#if papel && !(isAdminUnidade && papel === 'admin_unidade')}
						<label class="label">
							<span class="label-text text-2xs font-bold opacity-70 ml-1">
								{papel === 'admin_seccional' ? 'Seccional de resp.' : 'Unidade de resp.'}
							</span>
							<select class="select py-1 px-3 text-sm" bind:value={papelUnidadeId}>
								<option value={null}>Selecionar...</option>
								{#each papel === 'admin_seccional' ? seccionaisParaPapel : unidadesParaAdmin as u (u.id)}
									<option value={u.id}>{u.nome}</option>
								{/each}
							</select>
							{#if papelSemUnidade}
								<span class="text-3xs text-error-600 dark:text-error-400 ml-1 mt-0.5">
									Obrigatório para o papel escolhido.
								</span>
							{/if}
						</label>
					{:else if papel === 'admin_unidade' && isAdminUnidade}
						<p class="text-3xs text-surface-600 dark:text-surface-400 ml-1 italic">
							Será nomeado para a sua própria unidade.
						</p>
					{/if}
				</div>
			{/if}

			{#if isAdmin}
				<div
					class="p-3 rounded-xl bg-surface-500/5 border border-surface-500/10 flex flex-col gap-3"
				>
					<h4 class="text-2xs font-bold uppercase opacity-50">Admin Geral (Opcional)</h4>
					<p class="text-xs text-surface-600 dark:text-surface-400 leading-snug">
						Cria a conta de Administrador Geral vinculada. A pessoa loga com a mesma matrícula/senha
						escolhendo "Administrador". Cumulativo com o papel. Libere os consoles que esta pessoa
						vai administrar.
					</p>
					<input
						type="hidden"
						name="conceder_admin_geral"
						value={concederAdminGeral ? '1' : '0'}
						form={formId}
					/>
					<input
						type="hidden"
						name="modulo_escalas"
						value={concederAdminGeral && moduloEscalas ? '1' : '0'}
						form={formId}
					/>
					<input
						type="hidden"
						name="modulo_gise"
						value={concederAdminGeral && moduloGise ? '1' : '0'}
						form={formId}
					/>
					<ToggleSwitch
						reverse
						checked={concederAdminGeral}
						onCheckedChange={(v) => {
							concederAdminGeral = v;
							if (v && !moduloEscalas && !moduloGise) {
								moduloEscalas = true;
								moduloGise = true;
							}
						}}
					>
						<span
							class="text-xs font-semibold {concederAdminGeral
								? 'text-success-700 dark:text-success-400'
								: 'text-surface-600 dark:text-surface-400'}"
						>
							{concederAdminGeral ? 'Conceder Admin Geral' : 'Não conceder'}
						</span>
					</ToggleSwitch>
					{#if concederAdminGeral}
						<ToggleSwitch
							reverse
							checked={moduloEscalas}
							onCheckedChange={(v) => (moduloEscalas = v)}
						>
							<span
								class="text-xs font-semibold {moduloEscalas
									? 'text-success-700 dark:text-success-400'
									: 'text-surface-600 dark:text-surface-400'}"
							>
								{moduloEscalas ? 'Escalas ordinárias liberadas' : 'Escalas ordinárias bloqueadas'}
							</span>
						</ToggleSwitch>
						<ToggleSwitch reverse checked={moduloGise} onCheckedChange={(v) => (moduloGise = v)}>
							<span
								class="text-xs font-semibold {moduloGise
									? 'text-success-700 dark:text-success-400'
									: 'text-surface-600 dark:text-surface-400'}"
							>
								{moduloGise ? 'GISE (extra) liberado' : 'GISE (extra) bloqueado'}
							</span>
						</ToggleSwitch>
					{/if}
				</div>
			{/if}
		</div>
	</form>

	{#snippet footer()}
		<button
			type="submit"
			form={formId}
			class="btn btn-sm sm:btn-md preset-filled-primary-500 flex items-center justify-center gap-2"
			disabled={pending || papelSemUnidade || (concederAdminGeral && !moduloEscalas && !moduloGise)}
		>
			{pending ? 'Cadastrando...' : 'Cadastrar Policial'}
		</button>
	{/snippet}
</ModalShell>

<style>
	:global(.cadastro-policial-modal .input),
	:global(.cadastro-policial-modal .select),
	:global(.cadastro-policial-modal .lotacao-searchable input),
	:global(.cadastro-policial-modal .lotacao-searchable button) {
		background-color: var(--color-surface-50);
	}

	:global(.dark .cadastro-policial-modal .input),
	:global(.dark .cadastro-policial-modal .select),
	:global(.dark .cadastro-policial-modal .lotacao-searchable input),
	:global(.dark .cadastro-policial-modal .lotacao-searchable button) {
		background-color: var(--color-surface-800);
	}
</style>
