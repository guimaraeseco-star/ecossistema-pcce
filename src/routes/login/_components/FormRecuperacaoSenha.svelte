<script lang="ts">
	/**
	 * Fluxo 4: recuperação de senha em dois passos visíveis (`recuperacaoEtapa`).
	 * Identificação e Código cabem no cartão; "Concluído" não entra no stepper —
	 * a senha só muda depois do link no e-mail (`/redefinir-senha`). A tela de
	 * aviso pós-código é instrução, não fase. Respostas genéricas — não revela se
	 * a matrícula/login/CPF existe. No modo colaborador (E55) o identificador é
	 * o CPF e o link vai ao e-mail pessoal — ele não tem funcional.
	 */
	import Mail from '@lucide/svelte/icons/mail';
	import { loading as loadingService } from '$lib/loading.svelte';
	import CodigoTimer from '$lib/components/CodigoTimer.svelte';
	import { Steps } from '@skeletonlabs/skeleton-svelte';
	import SeletorPolicialAdmin from './SeletorPolicialAdmin.svelte';

	const ETAPAS = ['Identificação', 'Código'] as const;

	let {
		tipo = $bindable(),
		comoColaborador = false,
		identificadorRec = $bindable(),
		codigoRec = $bindable(),
		recuperacaoEtapa,
		recuperacaoResultado,
		currentRecStep,
		emailMascaradoRec,
		solicitarRecuperacao,
		confirmarRecuperacao,
		onSair
	}: {
		tipo: 'policial' | 'admin';
		/** Modo colaborador: CPF no lugar da matrícula/login; sem alternador. */
		comoColaborador?: boolean;
		identificadorRec: string;
		codigoRec: string;
		recuperacaoEtapa: 'identificador' | 'codigo' | 'concluida';
		recuperacaoResultado: 'codigo' | 'link';
		currentRecStep: number;
		emailMascaradoRec: string;
		solicitarRecuperacao: () => Promise<void>;
		confirmarRecuperacao: () => Promise<void>;
		onSair: () => void;
	} = $props();
</script>

{#if recuperacaoEtapa !== 'concluida'}
	<Steps step={currentRecStep} count={2} class="mb-6">
		<Steps.List class="flex w-full min-w-0 items-center justify-center gap-2">
			{#each ETAPAS as label, i (label)}
				<Steps.Item index={i} class="min-w-0">
					<Steps.Trigger
						tabindex={-1}
						class="flex min-w-0 items-center gap-2 text-xs font-semibold data-[current]:text-primary-500 data-[complete]:text-success-500 text-surface-400 pointer-events-none"
					>
						<Steps.Indicator
							class="w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center text-3xs"
							>{i + 1}</Steps.Indicator
						>
						<span class="truncate">{label}</span>
					</Steps.Trigger>
					{#if i < ETAPAS.length - 1}
						<Steps.Separator class="w-8 sm:w-12 h-px bg-surface-300 dark:bg-surface-700" />
					{/if}
				</Steps.Item>
			{/each}
		</Steps.List>
	</Steps>
{/if}
{#if recuperacaoEtapa === 'identificador'}
	<div class="text-center mb-6">
		<h1 class="h1 text-2xl font-bold mb-2">Recuperar senha</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400">
			Informe {comoColaborador ? 'seu CPF' : tipo === 'policial' ? 'sua matrícula' : 'seu login'} para
			receber um código de validação por e-mail.
		</p>
	</div>

	<div class="flex flex-col gap-5">
		{#if !comoColaborador}
			<SeletorPolicialAdmin bind:tipo aoTrocar={() => (identificadorRec = '')} class="mb-4" />
		{/if}

		<label class="label">
			<span class="label-text"
				>{comoColaborador ? 'CPF' : tipo === 'policial' ? 'Matrícula' : 'Login'}</span
			>
			<input
				class="input"
				type="text"
				bind:value={identificadorRec}
				placeholder={comoColaborador
					? 'Digite seu CPF (só números)'
					: tipo === 'policial'
						? 'Digite sua matrícula'
						: 'Digite seu login'}
				maxlength={comoColaborador ? 14 : tipo === 'policial' ? 8 : undefined}
				inputmode={comoColaborador ? 'numeric' : 'text'}
			/>
		</label>

		<button
			type="button"
			class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
			disabled={loadingService.active || !identificadorRec.trim()}
			onclick={solicitarRecuperacao}
		>
			{loadingService.active ? 'Enviando...' : 'Enviar código de validação'}
		</button>

		<button type="button" class="btn preset-outlined-surface-500 w-full" onclick={onSair}
			>Sair</button
		>
	</div>
{:else if recuperacaoEtapa === 'codigo'}
	<div class="text-center mb-6">
		<Mail
			class="w-12 h-12 mx-auto mb-3 text-surface-600 dark:text-surface-400"
			aria-hidden="true"
		/>
		<p class="font-semibold mb-1">Código de validação</p>
	</div>

	<div class="flex flex-col gap-5">
		<label class="label">
			<span class="label-text text-center block">Código de validação</span>
			<input
				class="input text-center text-3xl font-bold tracking-[0.4em] py-3"
				type="text"
				value={codigoRec}
				oninput={(e) => (codigoRec = e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
				placeholder="000000"
				maxlength="6"
				inputmode="numeric"
				autocomplete="one-time-code"
			/>
		</label>

		<CodigoTimer emailMascarado={emailMascaradoRec} onReenviar={solicitarRecuperacao} />

		<button
			type="button"
			class="btn preset-filled-primary-500 w-full py-3 flex items-center justify-center gap-2"
			disabled={loadingService.active || codigoRec.length !== 6}
			onclick={confirmarRecuperacao}
		>
			{loadingService.active ? 'Validando...' : 'Confirmar código'}
		</button>

		<button type="button" class="btn preset-outlined-surface-500 w-full" onclick={onSair}
			>Sair</button
		>
	</div>
{:else}
	<div class="text-center">
		<h1 class="h1 text-2xl font-bold mb-2">
			{recuperacaoResultado === 'link' ? 'Link enviado!' : 'Código enviado!'}
		</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mb-6">
			{#if recuperacaoResultado === 'link'}
				Dentro de instantes você receberá em seu e-mail {comoColaborador ? 'pessoal' : 'funcional'} um
				link de redefinição de senha. O código pode demorar até 5 minutos para chegar. Verifique também
				sua caixa de spam.
			{:else}
				Você receberá um código de validação em instantes.
			{/if}
		</p>
		<button type="button" class="btn preset-outlined-surface-500 w-full" onclick={onSair}
			>Sair</button
		>
	</div>
{/if}
