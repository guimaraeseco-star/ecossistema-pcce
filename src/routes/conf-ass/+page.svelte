<script lang="ts">
	/**
	 * Política de assinatura EM TELA (a avançada, Lei 14.063/2020) — os
	 * requisitos que o sistema exige de quem assina pelo celular.
	 *
	 * Mexer aqui muda o valor probatório de documento futuro, então a tela
	 * separa três coisas que parecem iguais e não são:
	 *   - REQUISITOS SEMPRE ATIVOS — não têm interruptor;
	 *   - OBRIGATÓRIOS da avançada — o código por e-mail, fixo em `true`. Está
	 *     como `const` e não `$state` de propósito: desligar rebaixaria a
	 *     assinatura a simples, e isso não é escolha de tela;
	 *   - REFORÇOS OPCIONAIS — foto, GPS, restrição a smartphone e passkey.
	 *     Somam prova, mas NÃO mudam a classificação legal, e é isso que o
	 *     "score" informa. A passkey é o único que toca o inciso "b" do art. 4º
	 *     II (controle exclusivo dos dados de criação). Vale para escala de
	 *     serviço, GISE, relatório extraordinário e termo de presença; o Token
	 *     A3 no desktop não entra nessa flag.
	 *
	 * A classificação (`nivelEfetivo`) e a base legal vêm calculadas do
	 * servidor (`signature-level`), nunca deduzidas aqui — o mesmo cálculo
	 * decide o texto impresso no rodapé e no manifesto do PDF. Declarar na tela
	 * um nível diferente do que o PDF carimba é afirmar uma qualificação falsa.
	 *
	 * Documento já assinado não é afetado: a política vale para os próximos.
	 */
	import Check from '@lucide/svelte/icons/check';
	import Lock from '@lucide/svelte/icons/lock';
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { apiFetch } from '$lib/api-fetch';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { loading } from '$lib/loading.svelte';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import { mensagemDeErro } from '$lib/utils/erro';

	let exigirFoto = $state(page.data.exigirFoto as boolean);
	let exigirGps = $state(page.data.exigirGps as boolean);
	// `exigirCodigoEmail` é fixo `true` (requisito legal da assinatura avançada);
	// mantido como const local para o body do PUT (idempotente).
	const exigirCodigoEmail = true;
	let restringirSmartphone = $state(page.data.restringirSmartphone as boolean);
	let exigirPasskey = $state(page.data.exigirPasskey as boolean);

	// Após invalidate externo, realinha os toggles ao load (evita divergência).
	$effect(() => {
		exigirFoto = page.data.exigirFoto as boolean;
		exigirGps = page.data.exigirGps as boolean;
		restringirSmartphone = page.data.restringirSmartphone as boolean;
		exigirPasskey = page.data.exigirPasskey as boolean;
	});

	// Metadados vindos do +page.server.ts — referência legal e classificação.
	const nivelEfetivo = page.data.nivelEfetivo as 'simples' | 'avancada';
	const baseLegalAtual = page.data.baseLegalAtual as string;
	const requisitosSempreAtivos = page.data.requisitosSempreAtivos as Array<{
		id: string;
		descricao: string;
		baseLegal: string;
	}>;
	const requisitosObrigatorios = page.data.requisitosObrigatorios as Array<{
		id: string;
		flag: string;
		descricao: string;
		baseLegal: string;
	}>;
	const reforcosOpcionais = page.data.reforcosOpcionais as Array<{
		id: string;
		flag: string;
		descricao: string;
		valorProbatorio: string;
		notas: string;
	}>;

	async function salvar() {
		loading.show('Salvando configurações...');
		try {
			await apiFetch('/api/configuracoes/assinatura', {
				method: 'PUT',
				body: JSON.stringify({
					exigirFoto,
					exigirGps,
					exigirCodigoEmail,
					restringirSmartphone,
					exigirPasskey
				})
			});
			await invalidateShared('app:assinatura-flags');
			toaster.create({ title: 'Configurações salvas com sucesso.', type: 'success' });
		} catch (e: unknown) {
			toaster.create({
				title: mensagemDeErro(e, 'Erro ao salvar.'),
				type: 'error'
			});
		} finally {
			loading.hide();
		}
	}

	// Score de reforços opcionais (informativo — não altera a classificação legal).
	const reforcoScore = $derived(
		(exigirFoto ? 1 : 0) +
			(exigirGps ? 1 : 0) +
			(restringirSmartphone ? 1 : 0) +
			(exigirPasskey ? 1 : 0)
	);
	const reforcoNivel = $derived(
		reforcoScore >= 4
			? 'Máximo'
			: reforcoScore >= 2
				? 'Médio'
				: reforcoScore >= 1
					? 'Básico'
					: 'Mínimo'
	);
	const reforcoCor = $derived(
		reforcoScore >= 4
			? 'text-success-600 dark:text-success-400 bg-success-500/10'
			: reforcoScore >= 1
				? 'text-warning-600 dark:text-warning-400 bg-warning-500/10'
				: 'text-surface-600 dark:text-surface-400 bg-surface-500/10'
	);
</script>

<svelte:head>
	<title>Conf. Assinatura | Ecossistema PCCE</title>
</svelte:head>

<div class="space-y-6">
	<header>
		<h1 class="h1 text-2xl font-bold">Configurações de Assinatura</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400">
			Parâmetros globais que afetam todas as assinaturas em tela do sistema.
		</p>
	</header>

	<!-- Painel de classificação legal: indica o nível efetivo das assinaturas
	     em tela e os requisitos legais que NÃO podem ser desligados. -->
	<div class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6">
		<div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
			<div>
				<p
					class="text-3xs font-bold uppercase tracking-widest text-surface-600 dark:text-surface-400"
				>
					Nível Legal das Assinaturas em Tela
				</p>
				<p class="h1 text-xl font-bold mt-1">
					{nivelEfetivo === 'avancada' ? 'AVANÇADA' : 'SIMPLES'}
				</p>
				<p class="text-2xs text-surface-600 dark:text-surface-400 italic mt-0.5">
					Base legal: {baseLegalAtual}
				</p>
			</div>
			<span
				class="badge font-bold px-3 py-1.5 rounded-full text-2xs uppercase whitespace-nowrap
				{nivelEfetivo === 'avancada'
					? 'text-success-600 dark:text-success-400 bg-success-500/10'
					: 'text-warning-600 dark:text-warning-400 bg-warning-500/10'}"
			>
				{nivelEfetivo === 'avancada' ? 'Lei 14.063/20 art. 4º II' : 'Lei 14.063/20 art. 4º I'}
			</span>
		</div>

		<!-- Sempre ativos -->
		<details class="text-2xs mt-3">
			<summary
				class="cursor-pointer font-bold text-surface-600 dark:text-surface-400 hover:text-primary-500"
			>
				Garantias sempre ativas no sistema ({requisitosSempreAtivos.length})
			</summary>
			<ul class="mt-2 space-y-1 pl-4">
				{#each requisitosSempreAtivos as r (r.id)}
					<li class="text-surface-700 dark:text-surface-300">
						<Check class="inline w-3.5 h-3.5 -mt-0.5 text-success-600" aria-hidden="true" />
						{r.descricao}
						<br />
						<span class="text-surface-600 dark:text-surface-400 italic ml-3">{r.baseLegal}</span>
					</li>
				{/each}
			</ul>
		</details>

		<!-- Obrigatórios para Avançada -->
		<details class="text-2xs mt-2" open>
			<summary
				class="cursor-pointer font-bold text-surface-600 dark:text-surface-400 hover:text-primary-500"
			>
				Requisitos mínimos para AVANÇADA (bloqueados) ({requisitosObrigatorios.length})
			</summary>
			<ul class="mt-2 space-y-1 pl-4">
				{#each requisitosObrigatorios as r (r.id)}
					<li class="text-surface-700 dark:text-surface-300">
						<Lock class="inline w-3.5 h-3.5 -mt-0.5 text-primary-600" aria-hidden="true" />
						{r.descricao}
						<br />
						<span class="text-surface-600 dark:text-surface-400 italic ml-3">{r.baseLegal}</span>
					</li>
				{/each}
			</ul>
		</details>

		<!-- Reforços opcionais -->
		<details class="text-2xs mt-2">
			<summary
				class="cursor-pointer font-bold text-surface-600 dark:text-surface-400 hover:text-primary-500"
			>
				Reforços opcionais ({reforcosOpcionais.length}) — não alteram a classificação legal
			</summary>
			<ul class="mt-2 space-y-1 pl-4">
				{#each reforcosOpcionais as r (r.id)}
					<li class="text-surface-700 dark:text-surface-300">
						{r.descricao}
						<span
							class="text-3xs uppercase font-bold ml-1 px-1 rounded bg-surface-200 dark:bg-surface-700"
						>
							valor {r.valorProbatorio}
						</span>
						<br />
						<span class="text-surface-600 dark:text-surface-400 italic ml-3">{r.notas}</span>
					</li>
				{/each}
			</ul>
		</details>
	</div>

	<div class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6 space-y-4 sm:space-y-6">
		<!-- Exigir foto -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5">Exigir foto do assinante (Prova de Vida)</p>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					Quando ativado, o sistema solicita que o assinante tire uma selfie via câmera com detecção
					de rosto antes de confirmar a assinatura em tela. Desativando, a prova de vida por imagem
					não será solicitada.
				</p>
			</div>
			<ToggleSwitch cor="primary" checked={exigirFoto} onCheckedChange={(v) => (exigirFoto = v)} />
		</div>

		<div class="border-t border-surface-200 dark:border-white/10"></div>

		<!-- Exigir GPS -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5">Exigir geolocalização (GPS)</p>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					Quando ativado, o sistema tenta capturar as coordenadas GPS do assinante no momento da
					assinatura em tela. Desativando, nenhuma localização é solicitada ao dispositivo.
				</p>
			</div>
			<ToggleSwitch cor="primary" checked={exigirGps} onCheckedChange={(v) => (exigirGps = v)} />
		</div>

		<div class="border-t border-surface-200 dark:border-white/10"></div>

		<!-- Exigir Código via E-mail — BLOQUEADO (requisito legal Lei 14.063/2020 art. 4º II "b") -->
		<div class="flex items-start justify-between gap-4 opacity-90">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5 flex items-center gap-1.5">
					Exigir código via E-mail
					<span
						class="text-3xs uppercase font-bold px-1.5 py-0.5 rounded bg-primary-500/15 text-primary-700 dark:text-primary-300 tracking-widest"
						title="Requisito legal — Lei 14.063/2020 art. 4º II"
					>
						<Lock class="inline w-3 h-3 -mt-0.5" aria-hidden="true" /> Obrigatório
					</span>
				</p>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					Confirmação por código numérico de 6 dígitos no e-mail cadastrado. Este requisito é o que
					caracteriza a assinatura como
					<strong>AVANÇADA</strong> nos termos da
					<strong>Lei 14.063/2020 art. 4º II "b"</strong> (controle exclusivo dos dados de criação).
					Sem ele, as assinaturas em tela seriam classificadas como
					<strong>SIMPLES</strong> (art. 4º I), exigindo aceite expresso da contraparte para serem
					oponíveis (art. 5º I) — por isso não pode ser desligado.
					<strong class="text-error-500 block mt-1"
						>Atenção: Os usuários precisam ter e-mail funcional cadastrado no perfil.</strong
					>
				</p>
			</div>
			<ToggleSwitch cor="primary" checked={true} disabled />
		</div>

		<div class="border-t border-surface-200 dark:border-white/10"></div>

		<!-- Restringir a Smartphone -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5">Restringir assinatura em tela a Smartphone</p>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					Quando ativado, o desktop deixa de oferecer o desenho da assinatura (passa a oferecer o
					Token A3) e o servidor <strong>recusa</strong> assinaturas cujo navegador não se
					identifica como móvel — inclusive por POST direto.
					<strong
						>Recomendado para assinaturas que exigem geolocalização e prova de vida confiáveis</strong
					>: no celular o GPS é GNSS e a câmera está na mão de quem assina. A verificação é sobre o
					user-agent <em>declarado</em> — é indício, e não vincula o aparelho ao assinante.
				</p>
			</div>
			<ToggleSwitch
				cor="primary"
				checked={restringirSmartphone}
				onCheckedChange={(v) => (restringirSmartphone = v)}
			/>
		</div>

		<div class="border-t border-surface-200 dark:border-white/10"></div>

		<!-- Exigir passkey -->
		<div class="flex items-start justify-between gap-4">
			<div class="flex-1">
				<p class="font-semibold text-sm mb-0.5">Exigir chave de assinatura do celular (passkey)</p>
				<p class="text-xs text-surface-600 dark:text-surface-400">
					A assinatura avançada em tela — escala de serviço, GISE, relatório extraordinário e termo
					de presença — passa a exigir uma chave guardada no celular do signatário, liberada por
					biometria ou PIN a cada uso. É o único reforço que atende ao <strong
						>controle exclusivo dos dados de criação</strong
					>
					(Lei 14.063/2020, art. 4º II "b"). Sem chave em Meu Perfil, não é possível assinar em tela.
					O Token A3 no desktop continua disponível.
					<strong class="text-error-500 block mt-1"
						>Antes de ligar: quem não tiver registrado a chave em Meu Perfil não conseguirá assinar.
						Exige celular com bloqueio de tela configurado.</strong
					>
				</p>
			</div>
			<ToggleSwitch
				cor="primary"
				checked={exigirPasskey}
				onCheckedChange={(v) => (exigirPasskey = v)}
			/>
		</div>

		<div
			class="p-4 sm:p-5 border-t border-surface-200 dark:border-white/10 bg-surface-100/30 dark:bg-surface-800/20 rounded-b-2xl space-y-4"
		>
			<div class="flex items-center justify-between gap-4">
				<div class="flex flex-col gap-0.5">
					<div class="flex items-center gap-2">
						<span
							class="text-3xs font-bold uppercase tracking-wider text-surface-600 dark:text-surface-400"
							>Reforços ativos:</span
						>
						<span class="badge {reforcoCor} font-bold px-3 py-1 rounded-full text-3xs uppercase"
							>{reforcoNivel} ({reforcoScore}/4)</span
						>
					</div>
					<span class="text-3xs text-surface-600 dark:text-surface-400 italic">
						Não alteram a classificação legal (sempre AVANÇADA), apenas o valor probatório em juízo.
					</span>
				</div>
				<button
					type="button"
					class="btn preset-filled-primary-500 py-2.5 px-4 text-sm flex items-center gap-2"
					onclick={salvar}
					disabled={loading.active}
				>
					{loading.active ? 'Gravando...' : 'Salvar'}
				</button>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
				{#if restringirSmartphone}
					<div
						class="flex items-start gap-2 p-2 rounded-xl bg-success-500/5 border border-success-500/10"
					>
						<svg
							class="w-4 h-4 text-success-500 shrink-0 mt-0.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
							/></svg
						>
						<p class="text-3xs text-surface-600 dark:text-surface-400 leading-tight">
							<strong>Antifraude Físico:</strong> Recusa, no servidor, assinatura de navegador que não
							se identifica como móvel. Não vincula o aparelho ao assinante.
						</p>
					</div>
				{:else}
					<div
						class="flex items-start gap-2 p-2 rounded-xl bg-warning-500/5 border border-warning-500/10"
					>
						<svg
							class="w-4 h-4 text-warning-500 shrink-0 mt-0.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
							/></svg
						>
						<p class="text-3xs text-surface-600 dark:text-surface-400 leading-tight">
							<strong>Modo Conveniência:</strong> Assinatura permitida em computadores compartilhados
							ou desktops.
						</p>
					</div>
				{/if}

				{#if exigirFoto}
					<div
						class="flex items-start gap-2 p-2 rounded-xl bg-secondary-500/5 border border-secondary-500/10"
					>
						<svg
							class="w-4 h-4 text-secondary-500 shrink-0 mt-0.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
							/><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
							/></svg
						>
						<p class="text-3xs text-surface-600 dark:text-surface-400 leading-tight">
							<strong>Prova de Vida:</strong> Uma selfie com reconhecimento facial será capturada no memento
							da assinatura.
						</p>
					</div>
				{/if}

				{#if exigirGps}
					<div
						class="flex items-start gap-2 p-2 rounded-xl bg-error-500/5 border border-error-500/10"
					>
						<svg
							class="w-4 h-4 text-error-500 shrink-0 mt-0.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
							/><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
							/></svg
						>
						<p class="text-3xs text-surface-600 dark:text-surface-400 leading-tight">
							<strong>Geolocalização:</strong> As coordenadas geográficas serão registradas para auditoria
							de local.
						</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
