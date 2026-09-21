<script lang="ts">
	/**
	 * Tela de LOGIN — quatro fluxos numa página, cada um com sua máquina de
	 * estados (UI em `_components/`):
	 *
	 *   1. senha → 2FA por e-mail (`pendente2FA`, `desafioId`);
	 *   2. certificado digital (Token A3 via SERPRO), que dispensa o 2FA porque
	 *      já é posse criptográfica;
	 *   3. primeiro acesso — pede o link por matrícula;
	 *   4. recuperação de senha, em dois passos visíveis (`recuperacaoEtapa`:
	 *      identificação → código). O aviso pós-código não é fase — a senha só
	 *      muda no e-mail (`/redefinir-senha`).
	 *
	 * Ficam juntos porque são a mesma decisão do usuário ("não consigo entrar") e
	 * porque nenhum deles pode revelar se a matrícula existe: as respostas de
	 * primeiro acesso e recuperação são genéricas por desenho, e a tela apenas
	 * repete o que o servidor devolve.
	 *
	 * Dois cuidados que parecem detalhe e não são:
	 *
	 * - o erro de login é exibido por `erroDeLoginExibido()`, que lê o estado do
	 *   cliente OU o `page.form` do submit sem JS. A tela precisa funcionar com
	 *   JavaScript bloqueado pelo CSP;
	 * - `?resetado=1` é removido com `replaceState`, não com `goto()`: uma
	 *   navegação de cliente aqui corre com o `goto` pós-2FA e pode deixar o
	 *   layout sem `usuario` — a sidebar desaparece e a página parece sem estilo.
	 */
	import { browser } from '$app/environment';
	import { goto, replaceState } from '$app/navigation';
	import { applyAction } from '$app/forms';
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { apiFetch } from '$lib/api-fetch';
	import { apagarReauth } from '$lib/assinatura-reauth';
	import { loading as loadingService } from '$lib/loading.svelte';
	import { conectarSerproParaLogin } from '$lib/serpro';
	import { CORPORACAO_PROSA } from '$lib/institucional';
	import type { ActionResult } from '@sveltejs/kit';
	import FormCredenciais from './_components/FormCredenciais.svelte';
	import Form2FA from './_components/Form2FA.svelte';
	import FormPrimeiroAcesso from './_components/FormPrimeiroAcesso.svelte';
	import FormRecuperacaoSenha from './_components/FormRecuperacaoSenha.svelte';
	import { mensagemDeErro } from '$lib/utils/erro';

	type ActionData = Record<string, unknown> | undefined;
	type FormResult = ActionResult<ActionData, ActionData>;

	async function navegarAposLogin(destino: string, invalidateAll = false) {
		// Funil único dos três fluxos de login (senha+2FA, certificado): é o
		// ponto que garante que a sessão nova nunca herda a janela de senha da
		// sessão anterior, guardada em `sessionStorage` (sobrevive a
		// logout+login e a expiração natural de sessão na mesma aba — só
		// fecha com o `exp` embutido ou quando a aba fecha). Sem isto, um id
		// de outra sessão ainda parece válido no cliente e o pad de assinatura
		// pula o passo de senha, indo direto para o 2FA.
		apagarReauth();
		await goto(destino, invalidateAll ? { invalidateAll: true } : undefined);
	}

	let tipo = $state<'policial' | 'admin'>('policial');
	/** Modo colaborador (terceira identidade): CPF no lugar da matrícula (E55). */
	let comoColaborador = $state(false);
	let matricula = $state('');
	let senha = $state('');

	// Estado do passo 2FA
	let pendente2FA = $state(false);
	let desafioId = $state('');
	let codigo2FA = $state('');
	let emailMascarado = $state('');

	// Estado do primeiro acesso
	let primeiroAcesso = $state(false);
	let matriculaPrimeiroAcesso = $state('');
	let primeiroAcessoEnviado = $state(false);

	// Estado de recuperação de senha
	let recuperacao = $state(false);
	let identificadorRec = $state('');
	let recuperacaoEtapa = $state<'identificador' | 'codigo' | 'concluida'>('identificador');
	let recuperacaoResultado = $state<'codigo' | 'link'>('codigo');
	let desafioIdRec = $state('');
	let codigoRec = $state('');
	let emailMascaradoRec = $state('');

	const currentRecStep = $derived(recuperacaoEtapa === 'codigo' ? 1 : 0);
	const tituloDaAba = $derived(
		primeiroAcesso ? 'Primeiro acesso' : recuperacao ? 'Recuperar senha' : 'Login'
	);

	// Erro inline de login (fallback para quando JS estiver bloqueado pelo CSP)
	let loginError = $state<string | null>(null);

	let mostrarBannerResetado = $state(page.url.searchParams.get('resetado') === '1');
	let resetadoParamConsumido = false;

	// Erro do último attempt — JS (`loginError`) ou submit sem JS (`page.form`).
	// Função lida pelo template, não `$derived` de `page`: na saída do login o
	// `page` global atualiza depois da árvore já destruída, e o derived inerte
	// dispara `derived_inert`.
	function erroDeLoginExibido(): string | null {
		return loginError ?? (page.form as { error?: string } | null)?.error ?? null;
	}

	// Remove `?resetado=1` sem `goto()`: uma navegação cliente extra aqui pode correr com o
	// `goto` pós-2FA e deixar o layout sem `usuario` (sidebar some, parece sem estilo).
	$effect(() => {
		if (!browser || resetadoParamConsumido || page.url.searchParams.get('resetado') !== '1') return;

		resetadoParamConsumido = true;

		const url = new URL(page.url);
		url.searchParams.delete('resetado');
		replaceState(url, page.state ?? {});
	});

	function handleLogin({ formData, cancel }: { formData: FormData; cancel: () => void }) {
		loginError = null;
		const mat = String(formData.get('matricula') ?? '').trim();
		const pw = String(formData.get('senha') ?? '');
		if (!mat) {
			loginError = 'Matrícula é obrigatória';
			cancel();
			return;
		}
		if (!pw) {
			loginError = 'Senha é obrigatória';
			cancel();
			return;
		}
		loadingService.show('Autenticando...');
		return async ({ result }: { result: FormResult }) => {
			try {
				if (result.type === 'redirect') {
					await navegarAposLogin(result.location, true);
					return;
				}

				if (result.type === 'success') {
					const d = result.data;
					if (d?.pendente2FA) {
						desafioId = String(d.desafioId || '');
						emailMascarado = String(d.emailMascarado || '');
						pendente2FA = true;
						loginError = null;
						toaster.create({ title: 'Código enviado para o seu e-mail!', type: 'success' });
						return;
					}

					if (d?.redirect) {
						await navegarAposLogin(String(d.redirect), true);
						return;
					}

					loginError = 'Não foi possível concluir o login. Tente novamente.';
					toaster.create({ title: loginError, type: 'error' });
					return;
				}

				if (result.type === 'failure') {
					await applyAction(result);
					const d = result.data;
					loginError = String(d?.error || 'Credenciais inválidas');
					toaster.create({ title: loginError, type: 'error' });
					return;
				}

				loginError = 'Erro inesperado ao autenticar. Tente novamente.';
				toaster.create({ title: loginError, type: 'error' });
			} catch {
				loginError = 'Não foi possível concluir o login. Tente novamente.';
				toaster.create({ title: loginError, type: 'error' });
			} finally {
				loadingService.hide();
			}
		};
	}

	function handleVerificar2FA({ cancel }: { cancel: () => void }) {
		if (codigo2FA.length !== 6) {
			toaster.create({ title: 'Informe o código de 6 dígitos', type: 'error' });
			cancel();
			return;
		}
		loadingService.show('Verificando código...');
		return async ({ result }: { result: FormResult }) => {
			try {
				if (result.type === 'redirect') {
					await navegarAposLogin(result.location, true);
					return;
				}

				if (result.type === 'success') {
					const d = result.data;
					if (d?.redirect) {
						await navegarAposLogin(String(d.redirect), true);
						return;
					}

					toaster.create({
						title: 'Não foi possível concluir a verificação. Tente novamente.',
						type: 'error'
					});
					return;
				}

				if (result.type === 'failure') {
					await applyAction(result);
					const d = result.data;
					toaster.create({ title: String(d?.error || 'Código inválido'), type: 'error' });
					if (d?.expirado || d?.esgotado) voltarLogin();
					return;
				}

				toaster.create({
					title: 'Erro inesperado ao verificar o código. Tente novamente.',
					type: 'error'
				});
			} catch {
				toaster.create({
					title: 'Não foi possível concluir a verificação. Tente novamente.',
					type: 'error'
				});
			} finally {
				loadingService.hide();
			}
		};
	}

	function handlePrimeiroAcesso() {
		loadingService.show('Processando primeiro acesso...');
		return async ({ result }: { result: ActionResult }) => {
			loadingService.hide();
			if (result.type === 'success') {
				primeiroAcessoEnviado = true;
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.create({
					title: String(d?.error || 'Erro ao processar solicitação.'),
					type: 'error'
				});
			}
		};
	}

	async function reenviarCodigo2FA() {
		try {
			const data = await apiFetch<{ desafioId?: string; emailMascarado?: string }>(
				'/api/auth/reenviar-codigo',
				{ method: 'POST', body: JSON.stringify({ desafioId }) }
			);
			desafioId = String(data.desafioId || desafioId);
			emailMascarado = String(data.emailMascarado || emailMascarado);
			toaster.create({ title: 'Código reenviado com sucesso!', type: 'success' });
		} catch (e: unknown) {
			toaster.create({
				title: mensagemDeErro(e, 'Erro ao reenviar código'),
				type: 'error'
			});
			// Repassa o erro para o CodigoTimer não reiniciar a contagem.
			throw e;
		}
	}

	function voltarLogin() {
		pendente2FA = false;
		desafioId = '';
		codigo2FA = '';
	}

	async function fazerLoginComCertificado(comoAdmin = false, comoColaboradorCert = false) {
		let serproClient: Awaited<ReturnType<typeof conectarSerproParaLogin>> | null = null;
		try {
			// 1. Conectar ao SERPRO PRIMEIRO — sem loading overlay sobre o modal.
			//    Mostra feedback durante a sondagem silenciosa; esconde antes do modal aparecer.
			loadingService.show('Conectando ao Assinador SERPRO...');
			serproClient = await conectarSerproParaLogin(() => loadingService.hide());

			// 2. Gerar desafio no servidor
			const { desafioId: did, nonce } = await apiFetch<{ desafioId: string; nonce: string }>(
				'/api/auth/certificado/iniciar',
				{ method: 'POST', body: JSON.stringify({}) }
			);

			// 3. Computar SHA-256 do nonce e assinar via type:'hash' (igual à assinatura de documentos)
			const nonceBytes = new Uint8Array(nonce.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
			const hashBuffer = await crypto.subtle.digest('SHA-256', nonceBytes);
			const hashBase64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

			loadingService.show('Aguardando confirmação no Assinador SERPRO...');
			const resultado = await serproClient.sign(hashBase64);
			serproClient.disconnect();
			serproClient = null;

			// 4. Verificar no servidor. Na aba Administrador, sinaliza `comoAdmin`
			//    — o servidor cria sessão admin se o CPF tiver conta vinculada,
			//    recorta o módulo ao que a conta permite e devolve a rota no `redirect`.
			loadingService.show('Verificando certificado...');
			const data = await apiFetch<{
				success?: boolean;
				primeiro_acesso?: boolean;
				nome?: string;
				redirect?: string;
			}>('/api/auth/certificado/verificar', {
				method: 'POST',
				body: JSON.stringify({
					desafioId: did,
					cmsBase64: resultado.rawSignature,
					comoAdmin,
					comoColaborador: comoColaboradorCert
				})
			});

			// 5. Redirecionar
			const dest = data.redirect ?? (data.primeiro_acesso ? '/alterar-senha' : '/escalas');
			await navegarAposLogin(dest, true);
		} catch (err: unknown) {
			const msg = mensagemDeErro(err, 'Erro ao autenticar com certificado digital.');
			loginError = msg;
			toaster.create({ title: msg, type: 'error' });
		} finally {
			serproClient?.disconnect();
			loadingService.hide();
		}
	}

	function voltarParaLogin() {
		primeiroAcesso = false;
		primeiroAcessoEnviado = false;
		matriculaPrimeiroAcesso = '';
	}

	function resetarRecuperacao() {
		recuperacaoEtapa = 'identificador';
		identificadorRec = '';
		recuperacaoResultado = 'codigo';
		desafioIdRec = '';
		codigoRec = '';
		emailMascaradoRec = '';
	}

	function abrirRecuperacao() {
		resetarRecuperacao();
		mostrarBannerResetado = false;
		recuperacao = true;
	}

	function sairDaRecuperacao() {
		recuperacao = false;
		resetarRecuperacao();
		mostrarBannerResetado = false;
	}

	async function solicitarRecuperacao() {
		if (!identificadorRec.trim()) return;
		loadingService.show('Enviando código de validação...');
		try {
			const data = await apiFetch<{
				requerCodigo?: boolean;
				desafioId?: string;
				emailMascarado?: string;
			}>('/api/auth/solicitar-redefinicao', {
				method: 'POST',
				body: JSON.stringify({
					identificador: identificadorRec.trim(),
					tipo: comoColaborador ? 'colaborador' : tipo
				})
			});
			if (data?.requerCodigo && data?.desafioId) {
				desafioIdRec = String(data.desafioId);
				emailMascaradoRec = String(data.emailMascarado || '');
				codigoRec = '';
				recuperacaoEtapa = 'codigo';
			} else {
				recuperacaoResultado = 'codigo';
				recuperacaoEtapa = 'concluida';
			}
		} catch {
			recuperacaoResultado = 'codigo';
			recuperacaoEtapa = 'concluida'; // não revelar erros internos
		} finally {
			loadingService.hide();
		}
	}

	async function confirmarRecuperacao() {
		if (codigoRec.length !== 6) {
			toaster.create({ title: 'Informe o código de 6 dígitos', type: 'error' });
			return;
		}
		loadingService.show('Validando código...');
		try {
			await apiFetch('/api/auth/confirmar-redefinicao', {
				method: 'POST',
				body: JSON.stringify({ desafioId: desafioIdRec, codigo: codigoRec })
			});
			recuperacaoResultado = 'link';
			recuperacaoEtapa = 'concluida';
			desafioIdRec = '';
			codigoRec = '';
		} catch (e: unknown) {
			toaster.create({
				title: mensagemDeErro(e, 'Código inválido ou expirado.'),
				type: 'error'
			});
		} finally {
			loadingService.hide();
		}
	}
</script>

<svelte:head>
	<title>{tituloDaAba} | Ecossistema PCCE</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center p-4">
	<!-- `p-6 sm:p-8`, brasão `h-20` e `mb-4`: a tela inteira tem de caber em
	     720 px de altura sem rolar (pedido de 13/09/2026). -->
	<div class="w-full max-w-xl p-6 sm:p-8 rounded-3xl card-glass-auth">
		{#if !recuperacao && !primeiroAcesso}
			<div class="text-center mb-4">
				<!-- Brasão institucional (static/brasao-pcce.png, 273×360, fundo
				     transparente): a mesma identidade dos demais sistemas do
				     departamento. O subtítulo é a corporação, não o departamento —
				     departamento é dado, não constante (E19). -->
				<img
					src="/brasao-pcce.png"
					alt="Brasão da Polícia Civil do Estado do Ceará"
					class="h-20 w-auto mx-auto mb-2 drop-shadow-md"
					width="273"
					height="360"
					decoding="async"
				/>
				<h1 class="h1 text-xl font-bold mb-1">Ecossistema PCCE</h1>
				<p class="text-xs text-surface-600 dark:text-surface-400 tracking-wide">
					{CORPORACAO_PROSA}
				</p>
			</div>
		{/if}

		{#if mostrarBannerResetado && !recuperacao}
			<div
				class="flex items-start gap-2.5 p-3 mb-5 rounded-xl bg-success-500/10 border border-success-500/25 text-success-700 dark:text-success-300 text-sm"
			>
				<svg
					class="w-4 h-4 mt-0.5 shrink-0"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
				</svg>
				<span>Senha redefinida com sucesso! Faça login com sua nova senha.</span>
			</div>
		{/if}

		{#if !pendente2FA && !primeiroAcesso && !recuperacao}
			<FormCredenciais
				bind:tipo
				bind:comoColaborador
				bind:matricula
				bind:senha
				loginErrorDisplay={erroDeLoginExibido()}
				{handleLogin}
				{fazerLoginComCertificado}
				onPrimeiroAcesso={() => {
					primeiroAcesso = true;
				}}
				onRecuperacao={abrirRecuperacao}
			/>
		{:else if recuperacao}
			<FormRecuperacaoSenha
				bind:tipo
				{comoColaborador}
				bind:identificadorRec
				bind:codigoRec
				{recuperacaoEtapa}
				{recuperacaoResultado}
				{currentRecStep}
				{emailMascaradoRec}
				{solicitarRecuperacao}
				{confirmarRecuperacao}
				onSair={sairDaRecuperacao}
			/>
		{:else if primeiroAcesso}
			<FormPrimeiroAcesso
				bind:matriculaPrimeiroAcesso
				{primeiroAcessoEnviado}
				{handlePrimeiroAcesso}
				onVoltar={voltarParaLogin}
			/>
		{:else}
			<Form2FA
				{desafioId}
				bind:codigo2FA
				{emailMascarado}
				{handleVerificar2FA}
				{reenviarCodigo2FA}
				onVoltar={voltarLogin}
			/>
		{/if}
	</div>
</div>
