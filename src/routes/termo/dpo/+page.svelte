<script lang="ts">
	// Sem import de logo: o brasão do Estado do Ceará é servido do R2
	// (assets/logo_ceara.jpg) pela rota pública /api/validar/logo.
	import { CORPORACAO_PROSA } from '$lib/institucional';
</script>

<svelte:head>
	<title>Encarregado de Dados (DPO) | Ecossistema PCCE</title>
</svelte:head>

<div
	class="min-h-screen bg-surface-50 dark:bg-surface-900 flex flex-col items-center justify-start p-3 sm:p-6"
>
	<div
		class="w-full max-w-2xl bg-white dark:bg-surface-800 shadow-xl border border-primary-500/20 rounded-2xl sm:rounded-3xl overflow-hidden"
	>
		<header
			class="flex flex-col items-center p-4 sm:p-6 border-b border-surface-200 dark:border-white/5"
		>
			<img
				src="/api/validar/logo"
				alt="Brasão do Estado do Ceará"
				width="200"
				height="200"
				class="h-16 sm:h-24 w-auto mb-2 drop-shadow-md"
			/>
			<h1
				class="text-lg sm:text-xl font-black uppercase tracking-tighter text-surface-900 dark:text-white text-center"
			>
				Encarregado de Dados (DPO)
			</h1>
			<p class="text-xs text-surface-600 dark:text-surface-400 mt-1 text-center">
				Polícia Civil do Estado do Ceará · Ecossistema PCCE
			</p>
		</header>

		<div class="p-4 sm:p-8 space-y-6 text-sm text-surface-700 dark:text-surface-200">
			<section>
				<h2 class="text-base font-bold text-surface-900 dark:text-white mb-2">
					Sobre o Encarregado de Dados
				</h2>
				<p class="leading-relaxed">
					Nos termos do art. 41 da Lei nº 13.709/2018 (LGPD), a Polícia Civil do Estado do Ceará
					designou um <strong>Encarregado pelo Tratamento de Dados Pessoais (DPO)</strong> responsável
					por atuar como canal de comunicação entre os titulares de dados, a PCCE e a Autoridade Nacional
					de Proteção de Dados (ANPD).
				</p>
			</section>

			<section
				class="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700/40 rounded-xl p-4 sm:p-5"
			>
				<h2 class="text-base font-bold text-primary-800 dark:text-primary-300 mb-3">
					Contato do DPO
				</h2>
				<dl class="space-y-2">
					<div class="flex flex-col sm:flex-row sm:gap-3">
						<dt class="font-semibold text-surface-600 dark:text-surface-400 sm:w-28 shrink-0">
							E-mail
						</dt>
						<dd>
							<a
								href="mailto:dpis@pc.ce.gov.br?subject=Direitos%20do%20Titular%20%E2%80%93%20LGPD"
								class="text-primary-700 dark:text-primary-400 underline underline-offset-2 hover:text-primary-900 dark:hover:text-primary-200 font-medium"
							>
								dpis@pc.ce.gov.br
							</a>
						</dd>
					</div>
					<div class="flex flex-col sm:flex-row sm:gap-3">
						<dt class="font-semibold text-surface-600 dark:text-surface-400 sm:w-28 shrink-0">
							Assunto
						</dt>
						<dd class="font-mono text-xs bg-surface-100 dark:bg-surface-700 px-2 py-1 rounded">
							Direitos do Titular – LGPD
						</dd>
					</div>
					<div class="flex flex-col sm:flex-row sm:gap-3">
						<dt class="font-semibold text-surface-600 dark:text-surface-400 sm:w-28 shrink-0">
							Endereço
						</dt>
						<dd class="leading-snug">
							Secretaria de Segurança Pública e Defesa Social do Estado do Ceará<br />
							{CORPORACAO_PROSA} — Setor de Proteção de Dados<br />
							Av. Bezerra de Menezes, 581 — São Gerardo<br />
							Fortaleza/CE — CEP 60325-003
						</dd>
					</div>
					<div class="flex flex-col sm:flex-row sm:gap-3">
						<dt class="font-semibold text-surface-600 dark:text-surface-400 sm:w-28 shrink-0">
							Prazo
						</dt>
						<dd>
							15 dias úteis a partir do recebimento, prorrogável por igual período (art. 18, §5º,
							LGPD)
						</dd>
					</div>
				</dl>
			</section>

			<section>
				<h2 class="text-base font-bold text-surface-900 dark:text-white mb-2">
					Direitos do Titular (art. 18 da LGPD)
				</h2>
				<p class="mb-2 leading-relaxed">
					Você pode exercer os seguintes direitos em relação aos seus dados pessoais tratados pelo
					Ecossistema PCCE:
				</p>
				<ul class="list-disc list-inside space-y-1 leading-relaxed">
					<li>Confirmação da existência de tratamento e acesso aos dados;</li>
					<li>Correção de dados incompletos, inexatos ou desatualizados;</li>
					<li>Anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos;</li>
					<li>Portabilidade dos dados a outro fornecedor, mediante requisição expressa;</li>
					<li>
						Eliminação dos dados tratados com base no consentimento, salvo obrigação legal de
						retenção;
					</li>
					<li>Informação sobre compartilhamento com terceiros;</li>
					<li>Revogação do consentimento, nos termos do art. 8º, §5º, da LGPD;</li>
					<li>Oposição ao tratamento realizado com fundamento em legítimo interesse.</li>
				</ul>
				<p class="mt-3 text-xs text-surface-600 dark:text-surface-400 leading-relaxed">
					<strong>Atenção:</strong> alguns dados são retidos por obrigação legal ou para o exercício regular
					de direitos em processo judicial, administrativo ou arbitral, e não podem ser eliminados durante
					o período mínimo de retenção (art. 16 da LGPD e Decreto nº 10.748/2021).
				</p>
			</section>

			<section>
				<h2 class="text-base font-bold text-surface-900 dark:text-white mb-2">
					Como enviar sua solicitação
				</h2>
				<ol class="list-decimal list-inside space-y-1 leading-relaxed">
					<li>
						Envie e-mail para <strong>dpis@pc.ce.gov.br</strong> com o assunto “Direitos do Titular –
						LGPD”;
					</li>
					<li>Identifique-se com nome completo, matrícula funcional e CPF;</li>
					<li>Descreva o direito que deseja exercer e os dados envolvidos;</li>
					<li>Aguarde confirmação de recebimento em até 2 dias úteis.</li>
				</ol>
			</section>

			<div
				class="border-t border-surface-200 dark:border-white/10 pt-4 flex flex-col sm:flex-row gap-3 sm:justify-between items-center"
			>
				<a
					href="/termo/1.1"
					class="text-xs text-primary-600 dark:text-primary-400 underline underline-offset-2 hover:text-primary-800"
				>
					← Ver Termo de Uso e Política de Privacidade (v1.1)
				</a>
				<p class="text-3xs text-surface-600 dark:text-surface-400">
					Base legal: art. 41 da Lei nº 13.709/2018 (LGPD)
				</p>
			</div>
		</div>
	</div>
</div>
