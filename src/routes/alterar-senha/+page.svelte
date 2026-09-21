<script lang="ts">
	/**
	 * Troca de senha — e, no PRIMEIRO ACESSO, o portão obrigatório do sistema.
	 * É uma das `ROTAS_SEM_SIDEBAR` do layout justamente por isso: enquanto o
	 * usuário está aqui, ele ainda não entrou.
	 *
	 * A tela tem dois modos no mesmo formulário. Troca voluntária pede só a
	 * senha; primeiro acesso exige TAMBÉM verificar o e-mail pessoal por código
	 * (`useVerificacaoEmailPessoal`) antes de liberar. O e-mail é o canal de
	 * recuperação e de 2FA — sem ele confirmado, uma senha perdida deixa a conta
	 * inacessível, e é essa a razão de o passo ser bloqueante e não um lembrete.
	 * O COLABORADOR pula a verificação: o e-mail dele já é o pessoal e o 2FA do
	 * login acabou de prová-lo (E55); no lugar, a tela pergunta se ele quer
	 * outro endereço para recuperar a senha (opcional).
	 *
	 * A validação daqui é de USABILIDADE, não de segurança: `podeAlterarSenha`
	 * desabilita o botão e `handleAlterarSenha` cancela o submit com mensagem,
	 * mas quem decide é a action do servidor. `validarForcaSenha` vem de
	 * `CamposNovaSenha` para que a régua exibida seja a mesma em todas as telas
	 * de senha.
	 *
	 * A tela NÃO oferece o cadastro da chave de assinatura. Já ofereceu, e o
	 * convite chegava fora de hora: `exigir_passkey_assinatura` é opcional e
	 * costuma estar DESLIGADA, então a maioria via um passo de "assinatura" no
	 * dia em que ainda estava definindo a senha, sem nada para assinar. O
	 * convite vive onde a falta da chave morde — na hora de assinar, e só com a
	 * exigência ligada: `ConviteChaveAssinatura` + `avancadaEmTelaDoLayout`
	 * levam a Meu Perfil a partir do próprio documento.
	 *
	 * Sem sidebar, fechar a aba não encerra a sessão: o cookie sobrevive e o
	 * hook devolve para cá. "Sair e voltar ao login" é a action `sair` (POST),
	 * a mesma higiene de `/api/auth/logout` — GET no endpoint não destrói nada.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { loading } from '$lib/loading.svelte';
	import { useVerificacaoEmailPessoal } from '$lib/composables';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import CamposNovaSenha, { validarForcaSenha } from '$lib/components/CamposNovaSenha.svelte';
	import CabecalhoAuth from '$lib/components/CabecalhoAuth.svelte';
	import { apagarReauth } from '$lib/assinatura-reauth';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';

	let senhaAtual = $state('');
	let novaSenha = $state('');
	let confirmarSenha = $state('');
	let error = $state('');

	const primeiroAcesso = $derived(page.data.primeiro_acesso);
	const colaborador = $derived(page.data.colaborador === true);
	let emailRecuperacao = $state('');

	// --- E-mail pessoal (apenas no primeiro acesso) ---
	const verificacaoEmail = useVerificacaoEmailPessoal();

	async function enviarCodigoEmailPessoal() {
		loading.show('Enviando código de verificação...');
		try {
			await verificacaoEmail.enviarCodigo();
		} finally {
			loading.hide();
		}
	}

	async function confirmarCodigoEmailPessoal() {
		loading.show('Verificando código...');
		try {
			await verificacaoEmail.confirmarCodigo();
		} finally {
			loading.hide();
		}
	}

	const forca = $derived(validarForcaSenha(novaSenha, confirmarSenha));
	const senhaOk = $derived(forca.senhaOk);
	const emailPessoalOk = $derived(
		!primeiroAcesso || colaborador || verificacaoEmail.etapa === 'verificado'
	);
	const podeAlterarSenha = $derived(senhaOk && forca.confirmaOk && emailPessoalOk);

	function handleAlterarSenha({ cancel }: { cancel: () => void }) {
		error = '';

		if (primeiroAcesso && !colaborador && verificacaoEmail.etapa !== 'verificado') {
			error = 'Confirme seu e-mail pessoal para continuar o primeiro acesso.';
			cancel();
			return;
		}

		if (novaSenha !== confirmarSenha) {
			error = 'As senhas não conferem.';
			cancel();
			return;
		}

		if (!senhaOk) {
			error = 'A senha não atende aos requisitos mínimos.';
			cancel();
			return;
		}

		loading.show('Alterando sua senha...');

		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				// Senha definida encerra a fase 1 do onboarding. O destino é `/`;
				// quem ainda deve o aceite do Termo vigente é desviado por
				// `hooks.server.ts` para `/aceitar-termo` — o portão do termo só
				// passa a valer agora (ver `impoeAceiteDoTermo`).
				goto('/');
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				error = String(d?.error || 'Erro ao alterar a senha.');
			}
		};
	}

	const handleSair: SubmitFunction = () => {
		error = '';
		apagarReauth();
		loading.show('Saindo...');
		return async ({ result, update }) => {
			if (result.type === 'failure') {
				loading.hide();
				const d = result.data as Record<string, unknown> | undefined;
				error = String(d?.error || 'Não foi possível sair.');
				return;
			}
			try {
				await update();
			} finally {
				loading.hide();
			}
		};
	};
</script>

<svelte:head>
	<title>{primeiroAcesso ? 'Defina sua senha' : 'Alterar Senha'} | Ecossistema PCCE</title>
</svelte:head>

<div class="min-h-[80vh] flex items-center justify-center p-4">
	<div class="w-full max-w-sm">
		<!-- Card -->
		<div class="p-6 sm:p-8 rounded-3xl card-glass-auth">
			<CabecalhoAuth
				titulo={primeiroAcesso ? 'Defina sua nova senha' : 'Alterar Senha'}
				descricao={primeiroAcesso
					? 'Confirme seu e-mail pessoal e escolha uma senha segura para continuar.'
					: 'Preencha os campos abaixo para alterar sua senha.'}
				mostrarIcone={!primeiroAcesso}
			/>

			<!-- First-access warning banner -->
			{#if primeiroAcesso}
				<div
					class="p-3 mb-5 rounded-xl bg-warning-500/10 border border-warning-500/25 text-warning-700 dark:text-warning-300 text-sm"
				>
					Este é seu <strong>primeiro acesso</strong>. Confirme seu e-mail pessoal e defina uma
					senha para continuar.
				</div>
			{/if}

			<!-- Seção de e-mail pessoal (apenas no primeiro acesso) -->
			{#if primeiroAcesso && colaborador}
				<!-- Colaborador (E55): o e-mail já está provado pelo 2FA; só a
				     pergunta do endereço alternativo, que vai no MESMO formulário
				     da senha (campo `email_recuperacao`, lido pela action). -->
				<div
					class="mb-5 p-4 rounded-2xl bg-surface-100/80 dark:bg-surface-800/50 border border-surface-200 dark:border-white/5 space-y-2"
				>
					<p
						class="text-xs font-semibold text-surface-600 dark:text-surface-300 uppercase tracking-wider mb-0.5"
					>
						E-mail de recuperação
					</p>
					<p class="text-xs text-surface-600 dark:text-surface-400 leading-relaxed">
						Seu e-mail pessoal <strong>{page.data.emailPessoalMascarado}</strong> já está confirmado pelo
						código que você digitou. Se quiser receber o código de recuperação de senha em outro endereço,
						informe abaixo — é opcional.
					</p>
				</div>
			{:else if primeiroAcesso}
				<div
					class="mb-5 p-4 rounded-2xl bg-surface-100/80 dark:bg-surface-800/50 border border-surface-200 dark:border-white/5 space-y-3"
				>
					<div>
						<p
							class="text-xs font-semibold text-surface-600 dark:text-surface-300 uppercase tracking-wider mb-0.5"
						>
							E-mail pessoal obrigatório
						</p>
						<p class="text-xs text-surface-600 dark:text-surface-400 leading-relaxed">
							Você deve confirmar seu e-mail pessoal para recuperar sua senha no futuro e continuar
							o primeiro acesso.
						</p>
					</div>

					{#if verificacaoEmail.etapa === 'verificado'}
						<div
							class="flex items-center gap-2 text-success-600 dark:text-success-400 text-sm font-medium"
						>
							<svg
								class="w-4 h-4 shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2.5"
							>
								<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
							</svg>
							E-mail pessoal verificado com sucesso!
						</div>
					{:else if verificacaoEmail.etapa === 'dados'}
						<div class="flex flex-col gap-2">
							<input
								class="input w-full text-sm"
								type="email"
								placeholder="seu@email.com"
								bind:value={verificacaoEmail.email}
								disabled={loading.active}
							/>
							<button
								type="button"
								class="btn preset-filled-primary-500 w-full py-2.5 text-sm font-semibold"
								onclick={enviarCodigoEmailPessoal}
								disabled={loading.active || !verificacaoEmail.email.trim()}
							>
								{loading.active ? 'Enviando...' : 'Enviar código'}
							</button>
						</div>
					{:else if verificacaoEmail.etapa === 'codigo'}
						<p class="text-xs text-surface-600 dark:text-surface-400">
							Código enviado para <strong>{verificacaoEmail.emailMascarado}</strong>. Válido por 10
							minutos.
						</p>
						<div class="flex flex-col xs:flex-row gap-2">
							<input
								class="input flex-1 text-center text-xl font-bold tracking-[0.3em]"
								type="text"
								placeholder="000000"
								maxlength="6"
								inputmode="numeric"
								bind:value={verificacaoEmail.codigo}
								oninput={(e) =>
									(verificacaoEmail.codigo = e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
								disabled={loading.active}
							/>
							<button
								type="button"
								class="btn preset-filled-primary-500 py-2.5 text-sm font-semibold xs:shrink-0"
								onclick={confirmarCodigoEmailPessoal}
								disabled={loading.active}
							>
								{loading.active ? 'Verificando...' : 'Confirmar'}
							</button>
						</div>
						<button
							type="button"
							class="text-xs text-surface-600 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 underline underline-offset-2"
							onclick={verificacaoEmail.voltarParaDados}
						>
							Usar outro e-mail
						</button>
					{/if}

					{#if verificacaoEmail.erro}
						<p class="text-xs text-error-600 dark:text-error-400">{verificacaoEmail.erro}</p>
					{/if}

					{#if verificacaoEmail.etapa !== 'verificado'}
						<p class="text-3xs text-surface-600 dark:text-surface-400 italic">
							A alteração da senha ficará disponível após a confirmação do e-mail pessoal.
						</p>
					{/if}
				</div>
			{/if}

			<!-- Error message -->
			{#if error}
				<div
					class="flex items-center gap-2 p-3 mb-4 rounded-xl bg-error-500/10 border border-error-500/25 text-error-700 dark:text-error-300 text-sm"
				>
					<AlertCircle class="w-4 h-4 shrink-0" aria-hidden="true" />
					{error}
				</div>
			{/if}

			<!-- Form -->
			<form
				method="POST"
				action="?/alterar"
				use:enhance={handleAlterarSenha}
				class="flex flex-col gap-4"
			>
				{#if primeiroAcesso && colaborador}
					<label class="label">
						<span class="label-text font-medium">Outro e-mail para recuperação (opcional)</span>
						<input
							class="input"
							type="email"
							name="email_recuperacao"
							bind:value={emailRecuperacao}
							placeholder="Deixe em branco para usar o e-mail pessoal"
							maxlength="254"
							autocomplete="email"
						/>
					</label>
				{/if}

				{#if !primeiroAcesso}
					<label class="label">
						<span class="label-text font-medium">Senha atual</span>
						<input
							class="input"
							type="password"
							name="senha_atual"
							bind:value={senhaAtual}
							placeholder="Digite a senha atual"
							required
						/>
					</label>
				{/if}

				<CamposNovaSenha
					bind:novaSenha
					bind:confirmarSenha
					placeholderNova="Digite a nova senha"
					placeholderConfirmar="Confirme a nova senha"
				/>

				<button
					type="submit"
					class="btn preset-filled-primary-500 w-full py-3 mt-1 font-semibold tracking-wide flex items-center justify-center gap-2"
					disabled={loading.active || !podeAlterarSenha}
				>
					{loading.active
						? 'Salvando...'
						: primeiroAcesso
							? 'Definir senha e continuar'
							: 'Salvar nova senha'}
				</button>
			</form>

			<form method="POST" action="?/sair" use:enhance={handleSair} class="mt-3">
				<button
					type="submit"
					class="btn preset-outlined-surface-500 w-full py-3 font-semibold tracking-wide"
					disabled={loading.active}
				>
					Sair e voltar ao login
				</button>
			</form>
		</div>
	</div>
</div>
