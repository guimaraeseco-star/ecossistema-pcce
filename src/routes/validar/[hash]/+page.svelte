<script lang="ts">
	/**
	 * A tela que o CIDADÃO vê ao conferir o código impresso no rodapé de um PDF
	 * assinado. Pública, sem sessão — é o único ponto do sistema desenhado para
	 * quem não tem conta.
	 *
	 * Ela é uma VISTA, não uma verificação: quem decide é o `+page.server.ts`
	 * (`verificarAssinaturaCompleta`, com cadeia ICP-Brasil, carimbo de tempo e
	 * revogação). Aqui só se desenha o veredito item por item, e nenhum dado
	 * novo é derivado do documento.
	 *
	 * Por isso o que chega em `data` já vem MINIMIZADO pelo servidor: CPF
	 * mascarado, nome reduzido, IP/user-agent/GPS ausentes. Quem valida não é o
	 * titular do dado (LGPD art. 6º). Nada de novo deve ser exibido aqui sem que
	 * o servidor tenha decidido, antes, que aquilo pode sair.
	 *
	 * O botão de baixar o PDF íntegro e o recorte da chave de assinatura
	 * aparecem só para autenticado, mas isso é cosmético: a permissão real do
	 * download é do endpoint `/api/validar/[hash]/download`. O recorte não
	 * desce ao anônimo (LGPD).
	 */
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Check from '@lucide/svelte/icons/check';
	import Download from '@lucide/svelte/icons/download';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import X from '@lucide/svelte/icons/x';
	import { formatarData } from '$lib/utils/datas';
	import { baixarBlob } from '$lib/utils/download';
	import { apiFetchResponse } from '$lib/api-fetch';
	import { toaster } from '$lib/toast';
	import Spinner from '$lib/components/Spinner.svelte';
	import LinhaVeredito from './_components/LinhaVeredito.svelte';
	import type { PageProps } from './$types';
	import { mensagemDeErro } from '$lib/utils/erro';

	interface DocumentoComAuditoria {
		assinante_nome: string;
		assinante_cpf?: string; // já mascarado pelo servidor (LGPD)
		created_at: string;
		tipo: string;
	}

	const { data }: PageProps = $props();
	const documento = $derived(data.documento as DocumentoComAuditoria);
	const chaveAssinatura = $derived(data.encontrado ? data.chaveAssinatura : null);

	const textoSituacaoChave: Record<'ativa' | 'revogada' | 'ausente', string> = {
		ativa: 'Ainda cadastrada — o recorte bate com a chave ativa na ficha do servidor.',
		revogada:
			'Revogada depois desta assinatura. O documento continua válido; na ficha o recorte aparece em chaves anteriores.',
		ausente: 'Não encontrada no cadastro (titular excluído, ou registro anterior à chave).'
	};

	function formatarDataHora(dateStr: string | null) {
		if (!dateStr) return 'Não informada';
		// SQLite datetime('now') retorna "YYYY-MM-DD HH:MM:SS" sem indicador de fuso.
		// Adicionamos " UTC" para forçar a interpretação como UTC antes de converter.
		const d = new Date(dateStr.includes('T') ? dateStr : dateStr + ' UTC');
		return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
	}

	let baixando = $state(false);

	async function handleDownload() {
		if (baixando) return;
		baixando = true;
		try {
			const res = await apiFetchResponse(`/api/validar/${data.hash}/download`);
			baixarBlob(await res.blob(), `relatorio_${data.hash}.pdf`);
		} catch (err) {
			toaster.create({
				title: 'Erro ao baixar o documento',
				description: mensagemDeErro(err, 'Tente novamente em instantes.'),
				type: 'error'
			});
		} finally {
			baixando = false;
		}
	}
</script>

<svelte:head>
	<title>Validação de Documento | Ecossistema PCCE</title>
</svelte:head>

<div
	class="min-h-screen bg-surface-50 dark:bg-surface-900 flex flex-col items-center justify-center p-3 sm:p-4"
>
	<div
		class="card w-full max-w-2xl bg-white dark:bg-surface-800 shadow-xl border rounded-2xl sm:rounded-3xl overflow-hidden p-4 sm:p-8
		{data.encontrado ? 'border-primary-500/20' : 'border-error-500/20'}"
	>
		{#if data.encontrado}
			{@const v = data.verificacao}
			{@const tipoAss = data.documento.tipo_assinatura}
			{@const ehQualificada =
				tipoAss === 'webpki' || tipoAss === 'serpro' || (tipoAss === null && v !== null)}
			<!-- ✅ DOCUMENTO VÁLIDO -->
			<div class="flex flex-col items-center mb-6 sm:mb-10">
				<img
					src="/api/validar/logo"
					alt="Brasão do Estado do Ceará"
					width="200"
					height="200"
					class="w-14 sm:w-20 mb-3 sm:mb-4 drop-shadow-md"
				/>
				<div
					class="w-12 h-12 sm:w-16 sm:h-16 rounded-full preset-tonal-success flex items-center justify-center mb-3 sm:mb-4"
				>
					<ShieldCheck
						class="w-7 h-7 sm:w-9 sm:h-9 text-success-600"
						aria-hidden="true"
						strokeWidth={2.5}
					/>
				</div>
				<h1
					class="text-xl sm:text-2xl font-black text-success-600 dark:text-success-400 uppercase tracking-tighter text-center"
				>
					Autenticidade Confirmada
				</h1>
				<p
					class="text-surface-600 dark:text-surface-400 font-medium text-center text-sm sm:text-base mt-1"
				>
					Este documento é autêntico e foi assinado digitalmente
				</p>
			</div>

			<div class="space-y-4 sm:space-y-6">
				<!-- Status criptográfico (CAdES-LT) -->
				<section
					class="p-4 sm:p-6 bg-surface-100 dark:bg-surface-700/50 rounded-xl sm:rounded-2xl border border-surface-200 dark:border-white/5"
				>
					<div class="flex items-center justify-between mb-3 sm:mb-4 flex-wrap gap-2">
						<h2
							class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-widest"
						>
							Status Criptográfico
						</h2>
						<div class="flex gap-2 flex-wrap">
							{#if ehQualificada}
								<span
									class="text-3xs font-black uppercase px-2 py-0.5 rounded-full preset-tonal-primary tracking-wider"
									>ICP-Brasil</span
								>
							{:else}
								<span
									class="text-3xs font-black uppercase px-2 py-0.5 rounded-full preset-tonal-warning tracking-wider"
									>Avançada (Lei 14.063/2020)</span
								>
							{/if}
							{#if v?.padesLt?.presente}
								<span
									class="text-3xs font-black uppercase px-2 py-0.5 rounded-full preset-tonal-success tracking-wider"
									title="DSS Dictionary embarcado: certificados e OCSP dentro do próprio PDF (ETSI EN 319 142-1)"
									>PAdES-LT</span
								>
							{/if}
						</div>
					</div>
					<div class="space-y-2 text-xs sm:text-sm">
						<!-- Integridade do arquivo -->
						{#if data.hashConfere === true}
							<LinhaVeredito estado="ok">
								<strong>Integridade do arquivo:</strong> hash do PDF confere com o registro original.
							</LinhaVeredito>
						{:else if data.hashConfere === false}
							<LinhaVeredito estado="falha">
								O arquivo armazenado foi alterado após a assinatura.
							</LinhaVeredito>
						{:else}
							<LinhaVeredito estado="indisponivel">
								Verificação de integridade indisponível (registro antigo).
							</LinhaVeredito>
						{/if}

						{#if v}
							<!-- Cadeia ICP-Brasil -->
							{#if v.checks.cadeiaIcpBrasil === true}
								<LinhaVeredito estado="ok">
									<strong>Cadeia ICP-Brasil:</strong> certificado encadeia até uma AC Raiz reconhecida.
								</LinhaVeredito>
							{:else if v.checks.cadeiaIcpBrasil === 'indisponivel'}
								<LinhaVeredito estado="indisponivel">
									Cadeia ICP-Brasil não validada (trust store ainda não populado).
								</LinhaVeredito>
							{:else}
								<LinhaVeredito estado="falha">Cadeia ICP-Brasil inválida.</LinhaVeredito>
							{/if}
							<!-- Assinatura RSA -->
							{#if v.checks.assinaturaRsa}
								<LinhaVeredito estado="ok">
									<strong>Assinatura RSA:</strong> SignedAttributes íntegros e assinados pela chave do
									certificado.
								</LinhaVeredito>
							{:else}
								<LinhaVeredito estado="falha">Assinatura RSA inválida.</LinhaVeredito>
							{/if}
							<!-- Carimbo de tempo -->
							{#if v.checks.timestampQualificado}
								<LinhaVeredito estado="ok">
									<strong>Carimbo de tempo qualificado:</strong> ACT/ICP-Brasil (RFC 3161){#if v.timestamp},
										em {formatarDataHora(v.timestamp.momento)}{/if}.
								</LinhaVeredito>
							{:else if v.timestamp?.tipo === 'tsa_externa'}
								<LinhaVeredito estado="ressalva">
									<strong>Carimbo de tempo:</strong> TSA externa não-ICP (RFC 3161){#if v.timestamp},
										em {formatarDataHora(v.timestamp.momento)}{/if}. Assinatura do carimbo
									verificada, mas sem a presunção ICP-Brasil.
								</LinhaVeredito>
							{:else}
								<LinhaVeredito estado="ressalva">
									<strong>Carimbo de tempo:</strong> apenas hora do servidor (sem ACT/ICP).
								</LinhaVeredito>
							{/if}
							<!-- Política de assinatura -->
							{#if v.politica}
								{#if v.politica.conforme}
									<LinhaVeredito estado="ok">
										<strong>Política de assinatura:</strong>
										{v.politica.nome} (ICP-Brasil).
									</LinhaVeredito>
								{:else if v.politica.presente}
									<LinhaVeredito estado="ressalva">
										<strong>Política de assinatura:</strong> declarada, mas o OID/hash não confere com
										a PA-AD-RB v2.3.
									</LinhaVeredito>
								{:else}
									<LinhaVeredito estado="ressalva">
										<strong>Política de assinatura:</strong> não aplicada (sem id-aa-ets-sigPolicyId).
									</LinhaVeredito>
								{/if}
							{/if}
							<!-- Revogação -->
							{#if v.checks.revogacao === 'good'}
								<LinhaVeredito estado="ok">
									<strong>Revogação:</strong> certificado válido (snapshot OCSP{#if data.documento.ocsp_consultado_em}
										de {formatarDataHora(data.documento.ocsp_consultado_em)}{/if}).
								</LinhaVeredito>
							{:else if v.checks.revogacao === 'revoked'}
								<LinhaVeredito estado="falha">
									Certificado REVOGADO pela Autoridade Certificadora.
								</LinhaVeredito>
							{:else}
								<LinhaVeredito estado="indisponivel">
									Verificação OCSP indisponível para este documento (assinado antes da migração de
									auditoria).
								</LinhaVeredito>
							{/if}
							{#if v.certificado}
								<div
									class="pt-2 mt-2 border-t border-surface-200 dark:border-white/5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-2xs text-surface-600 dark:text-surface-400"
								>
									<div><strong>Emissor:</strong> {v.certificado.issuer || '—'}</div>
									<div>
										<strong>Série:</strong>
										{v.certificado.serial.slice(0, 16)}{v.certificado.serial.length > 16 ? '…' : ''}
									</div>
									<div><strong>Válido de:</strong> {formatarDataHora(v.certificado.validoDe)}</div>
									<div>
										<strong>Válido até:</strong>
										{formatarDataHora(v.certificado.validoAte)}
									</div>
								</div>
							{/if}
							{#if v.assinaturasAdicionais && v.assinaturasAdicionais.length > 0}
								<div class="pt-2 mt-2 border-t border-surface-200 dark:border-white/5">
									<p
										class="text-2xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-wider mb-1"
									>
										Assinaturas anteriores ({v.assinaturasAdicionais.length})
									</p>
									<ul class="space-y-0.5">
										{#each v.assinaturasAdicionais as ass (ass.ordem)}
											<li class="flex items-center gap-2 text-2xs">
												{#if ass.integridade && ass.assinaturaRsa}
													<Check class="w-3 h-3 shrink-0 text-success-600" aria-hidden="true" />
												{:else}
													<X class="w-3 h-3 shrink-0 text-error-600" aria-hidden="true" />
												{/if}
												<span class="text-surface-700 dark:text-surface-300 truncate">
													#{ass.ordem + 1}
													{ass.signerCN || '(signatário desconhecido)'}
												</span>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
							{#if !v.valid && v.erros.length > 0}
								<div
									class="mt-2 p-2 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-700/30 rounded text-2xs text-error-700 dark:text-error-300"
								>
									<strong>Falhas detectadas:</strong>
									<ul class="list-disc pl-4 mt-1">
										{#each v.erros as e (e)}
											<li>{e}</li>
										{/each}
									</ul>
								</div>
							{/if}
							<!--
								Ressalvas SEM `!v.valid`, de propósito: são achados que não reprovam
								o documento e por isso convivem com o veredito positivo — carimbo
								anexado que não verifica, co-assinatura anterior que deixou de
								fechar. Enquanto viviam em `v.erros`, a condição acima os escondia
								exatamente nos casos em que o veredito era favorável, que é quando
								quem confere o papel mais precisa saber deles.
							-->
							{#if v.avisos.length > 0}
								<div
									class="mt-2 p-2 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700/30 rounded text-2xs text-warning-800 dark:text-warning-200"
								>
									<strong>Ressalvas:</strong>
									<ul class="list-disc pl-4 mt-1">
										{#each v.avisos as a (a)}
											<li>{a}</li>
										{/each}
									</ul>
								</div>
							{/if}
						{:else if !ehQualificada}
							{#if data.selo?.presente}
								<!-- Selo institucional (CMS autoassinado, não-ICP) -->
								{#if data.selo.integro}
									<LinhaVeredito estado="ok">
										<strong>Selo institucional:</strong> documento íntegro e à prova de adulteração{#if data.selo.autentico},
											certificado confere com o selo oficial{/if}.
									</LinhaVeredito>
								{:else}
									<LinhaVeredito estado="falha">
										Selo institucional inválido — documento adulterado após a assinatura.
									</LinhaVeredito>
								{/if}
								{#if data.selo.tipoCarimboTempo && data.selo.tipoCarimboTempo !== 'servidor'}
									<LinhaVeredito estado="ok">
										<strong>Carimbo de tempo:</strong> RFC 3161 (TSA externa, não-ICP){#if data.selo.momento},
											em {formatarDataHora(data.selo.momento)}{/if}.
									</LinhaVeredito>
								{/if}
								<p class="text-2xs text-surface-600 dark:text-surface-400 italic pt-1">
									Avançada (Lei 14.063/2020 art. 4º, II) com selo criptográfico da instituição. Não
									é ICP-Brasil — sem a presunção do art. 10 §1º da MP 2.200-2/2001.
								</p>
							{:else}
								<p class="text-2xs text-surface-600 dark:text-surface-400 italic pt-1">
									Assinatura avançada (selfie + GPS + IP). Validade jurídica conforme Lei
									14.063/2020 art. 4º, II.
								</p>
							{/if}
						{/if}
					</div>
				</section>

				<!-- Informações do Documento -->
				<section
					class="p-4 sm:p-6 bg-surface-100 dark:bg-surface-700/50 rounded-xl sm:rounded-2xl border border-surface-200 dark:border-white/5"
				>
					<h2
						class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-widest mb-3 sm:mb-4"
					>
						Informações do Documento
					</h2>
					<div class="grid grid-cols-1 gap-3 sm:gap-6">
						<div>
							<span
								class="block text-3xs uppercase font-bold text-surface-600 dark:text-surface-400"
								>Título / Tipo</span
							>
							<span
								class="text-base sm:text-lg font-bold text-surface-800 dark:text-white leading-tight"
								>{data.escala.titulo}</span
							>
						</div>
						<div>
							<span
								class="block text-3xs uppercase font-bold text-surface-600 dark:text-surface-400"
								>Unidade / Cidade</span
							>
							<span
								class="text-base sm:text-lg font-bold text-surface-800 dark:text-white leading-tight"
								>{data.escala.lotacao} — {data.escala.cidade}</span
							>
						</div>
						<div>
							<span
								class="block text-3xs uppercase font-bold text-surface-600 dark:text-surface-400"
								>Período</span
							>
							<span class="text-base sm:text-lg font-bold text-surface-800 dark:text-white">
								{formatarData(data.escala.data_inicio)} a {formatarData(data.escala.data_fim ?? '')}
							</span>
						</div>
					</div>
				</section>

				<!-- Informações da Assinatura (Supervisor) -->
				<section
					class="p-4 sm:p-6 border-l-4 border-primary-500 bg-primary-50/30 dark:bg-primary-500/10 rounded-r-xl sm:rounded-r-2xl"
				>
					<h2
						class="text-3xs font-bold text-primary-600 dark:text-primary-400 uppercase tracking-widest mb-3 sm:mb-4"
					>
						Assinatura Certificadora (Supervisor)
					</h2>
					<div class="space-y-3 sm:space-y-4">
						<div class="flex items-start gap-3 sm:gap-4">
							<div
								class="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-500 shrink-0"
							>
								<ShieldCheck class="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
							</div>
							<div class="min-w-0">
								<span
									class="block text-3xs uppercase font-bold text-surface-600 dark:text-surface-400"
									>Assinado Digitalmente por</span
								>
								<span
									class="text-lg sm:text-xl font-black text-surface-900 dark:text-white uppercase leading-none break-words"
									>{documento.assinante_nome}</span
								>
								{#if documento.assinante_cpf}
									<span class="block text-xs text-surface-600 dark:text-surface-400 mt-1"
										>CPF: {documento.assinante_cpf}</span
									>
								{/if}
								{#if chaveAssinatura}
									<span
										class="block text-3xs uppercase font-bold text-surface-600 dark:text-surface-400 mt-3"
										>Chave de assinatura (como no manifesto)</span
									>
									<span
										class="block font-mono text-sm tracking-wide text-surface-900 dark:text-white break-all select-all mt-0.5"
										>{chaveAssinatura.identificador}</span
									>
									<span class="block text-xs text-surface-600 dark:text-surface-400 mt-1">
										{textoSituacaoChave[chaveAssinatura.situacao]}
									</span>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
							<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
								/>
							</svg>
							<span>Data e Hora: <strong>{formatarDataHora(documento.created_at)}</strong></span>
						</div>
					</div>
				</section>

				<!-- Confirmações de Presença (Equipe) — agregado (LGPD: sem roster nominal) -->
				{#if data.equipeResumo && data.equipeResumo.total > 0}
					<section class="space-y-3">
						<h2
							class="text-3xs font-bold text-surface-600 dark:text-surface-400 uppercase tracking-widest px-1"
						>
							Confirmações de Presença (Equipe)
						</h2>
						<div
							class="p-4 bg-surface-100 dark:bg-surface-700/50 rounded-xl sm:rounded-2xl border border-surface-200 dark:border-white/5"
						>
							<p class="text-sm text-surface-700 dark:text-surface-300">
								<strong class="text-surface-900 dark:text-white"
									>{data.equipeResumo.confirmados}</strong
								>
								de
								<strong class="text-surface-900 dark:text-white">{data.equipeResumo.total}</strong>
								integrantes confirmaram presença.
							</p>
							<p class="text-3xs text-surface-600 dark:text-surface-400 mt-1.5">
								Nomes e horários individuais são restritos e não exibidos na validação pública.
							</p>
						</div>
					</section>
				{/if}

				<!-- Download do Documento -->
				<section
					class="p-4 sm:p-6 preset-tonal-primary border border-primary-500/20 rounded-xl sm:rounded-2xl"
				>
					<h2
						class="text-3xs font-bold text-primary-700 dark:text-primary-400 uppercase tracking-widest mb-2 sm:mb-3"
					>
						Documento Original
					</h2>
					{#if data.autenticado}
						<p class="text-sm text-surface-700 dark:text-surface-300 mb-3 sm:mb-4">
							Faça o download do documento digital assinado e compare com o documento impresso que
							você possui. As informações devem ser idênticas.
						</p>
						<button
							type="button"
							onclick={handleDownload}
							disabled={baixando}
							class="btn preset-filled-primary-500 w-full sm:w-auto font-bold rounded-xl text-sm touch-manipulation flex items-center justify-center gap-2"
						>
							{#if baixando}
								<Spinner size="md" class="text-white" />
								<span>PROCESSANDO...</span>
							{:else}
								<Download class="w-5 h-5 shrink-0" aria-hidden="true" />
								<span>Baixar Documento Assinado (PDF)</span>
							{/if}
						</button>
					{:else}
						<p class="text-sm text-surface-700 dark:text-surface-300 mb-3 sm:mb-4">
							A autenticidade deste documento já está comprovada acima — assinante, data,
							certificado e hash. O <strong>documento assinado na íntegra</strong> contém dados restritos
							e está disponível apenas para usuários autenticados.
						</p>
						<a
							href="/login"
							class="btn preset-filled-primary-500 w-full sm:w-auto font-bold rounded-xl text-sm touch-manipulation inline-flex items-center justify-center gap-2"
						>
							<svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
								/>
							</svg>
							<span>Faça login para baixar o documento</span>
						</a>
					{/if}
				</section>

				<!-- Instrução de Comparação -->
				<div
					class="flex items-start gap-3 p-4 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700/30 rounded-xl sm:rounded-2xl"
				>
					<svg
						class="w-5 h-5 text-warning-600 dark:text-warning-400 shrink-0 mt-0.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<p class="text-sm text-warning-800 dark:text-warning-300">
						<strong>Como verificar:</strong> Baixe o documento digital acima e compare seu conteúdo com
						o documento impresso. Verifique se os nomes, períodos, datas e demais informações são idênticos.
						Qualquer divergência deve ser comunicada à unidade responsável.
					</p>
				</div>

				<!-- Validador ITI: oferece conferência cruzada para assinaturas qualificadas. -->
				{#if ehQualificada}
					<div
						class="flex items-start gap-3 p-4 bg-primary-50/50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700/30 rounded-xl sm:rounded-2xl"
					>
						<svg
							class="w-5 h-5 text-primary-600 dark:text-primary-400 shrink-0 mt-0.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
							/>
						</svg>
						<div class="flex-1">
							<p class="text-sm text-primary-800 dark:text-primary-300 mb-2">
								<strong>Validação independente:</strong> esta assinatura pode ser conferida no validador
								oficial do Instituto Nacional de Tecnologia da Informação (ITI).
							</p>
							<a
								href="https://validar.iti.gov.br"
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex items-center gap-1.5 text-xs font-bold text-primary-700 dark:text-primary-300 hover:underline"
							>
								Abrir Validador ITI
								<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
									/>
								</svg>
							</a>
							<p class="text-3xs text-surface-600 dark:text-surface-400 mt-1">
								Faça upload do PDF baixado acima para conferir independentemente.
							</p>
						</div>
					</div>
				{/if}
			</div>

			<footer
				class="mt-6 sm:mt-10 pt-4 sm:pt-6 border-t border-surface-200 dark:border-white/5 text-center"
			>
				<p
					class="text-3xs text-surface-600 dark:text-surface-400 uppercase font-black tracking-widest"
				>
					Ponto de Preservação Digital - PC-CE
				</p>
				<p
					class="text-3xs text-surface-600 dark:text-surface-400 mt-2 max-w-md mx-auto leading-relaxed"
				>
					Esta conferência confirma que o arquivo digital carregado corresponde integralmente ao
					teor da escala gerenciada pelo sistema oficial em {formatarDataHora(
						data.documento.created_at
					)}.
				</p>
			</footer>
		{:else}
			<!-- ❌ DOCUMENTO NÃO ENCONTRADO / ERRO -->
			{@const excedido = data.motivo === 'rate_limit'}
			<!-- `semVeredito` reúne os estados em que o sistema NÃO afirma nada sobre o
			     documento: erro interno e teto de consultas. É a distinção que importa
			     nesta tela — o outro ramo diz "pode ser falso ou adulterado", e dizer
			     isso a quem só esbarrou num limite de requisições seria acusar um
			     documento legítimo por causa da nossa contagem. -->
			{@const erroInterno =
				data.motivo === 'erro_db' || data.motivo === 'erro_consulta' || excedido}

			<div class="flex flex-col items-center mb-6 sm:mb-10">
				<img
					src="/api/validar/logo"
					alt="Brasão do Estado do Ceará"
					width="200"
					height="200"
					class="w-14 sm:w-20 mb-3 sm:mb-4 drop-shadow-md"
				/>
				<div
					class="w-12 h-12 sm:w-16 sm:h-16 rounded-full {erroInterno
						? 'bg-warning-500/10'
						: 'bg-error-500/10'} flex items-center justify-center mb-3 sm:mb-4"
				>
					{#if erroInterno}
						<AlertCircle
							class="w-7 h-7 sm:w-9 sm:h-9 text-warning-600"
							aria-hidden="true"
							strokeWidth={2.5}
						/>
					{:else}
						<svg
							class="w-7 h-7 sm:w-9 sm:h-9 text-error-600"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2.5"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
					{/if}
				</div>
				<h1
					class="text-xl sm:text-2xl font-black {erroInterno
						? 'text-warning-600 dark:text-warning-400'
						: 'text-error-600 dark:text-error-400'} uppercase tracking-tighter text-center"
				>
					{#if excedido}Muitas Consultas{:else if erroInterno}Erro ao Consultar{:else}Documento Não
						Encontrado{/if}
				</h1>
				<p
					class="text-surface-600 dark:text-surface-400 font-medium text-center mt-2 text-sm sm:text-base"
				>
					{#if excedido}
						Foram feitas muitas consultas a partir desta rede. Aguarde alguns minutos e tente
						novamente — <strong>isto não diz nada sobre o documento</strong>.
					{:else if erroInterno}
						Ocorreu um erro interno ao consultar o sistema. Tente novamente em alguns instantes.
					{:else}
						O código de verificação informado não corresponde a nenhum documento registrado no
						sistema.
					{/if}
				</p>
			</div>

			<div
				class="p-4 sm:p-6 {erroInterno
					? 'bg-warning-50 dark:bg-warning-900/20 border-warning-200 dark:border-warning-700/30'
					: 'bg-error-50 dark:bg-error-900/20 border-error-200 dark:border-error-700/30'} border rounded-xl sm:rounded-2xl text-center space-y-3"
			>
				{#if excedido}
					<p class="text-sm text-warning-800 dark:text-warning-300">
						O limite de consultas por rede foi atingido. A verificação deste documento
						<strong>não foi realizada</strong> — repita em alguns minutos.
					</p>
				{:else if erroInterno}
					<p class="text-sm text-warning-800 dark:text-warning-300">
						Não foi possível verificar a autenticidade neste momento. Por favor, tente novamente ou
						contate o suporte.
					</p>
				{:else}
					<p class="text-sm text-error-800 dark:text-error-300">
						Este documento pode ser <strong>falso ou adulterado</strong>. Não utilize este
						documento.
					</p>
					<p class="text-xs text-surface-600 dark:text-surface-400">
						Se você acredita que há um erro, entre em contato com a unidade que emitiu o documento.
					</p>
				{/if}
			</div>

			<footer
				class="mt-6 sm:mt-10 pt-4 sm:pt-6 border-t border-surface-200 dark:border-white/5 text-center"
			>
				<p
					class="text-3xs text-surface-600 dark:text-surface-400 uppercase font-black tracking-widest"
				>
					Ponto de Preservação Digital - PC-CE
				</p>
			</footer>
		{/if}
	</div>

	<p class="mt-6 text-xs text-surface-600 dark:text-surface-400">
		SISTEMA GERENCIADOR DE ESCALAS © 2026
	</p>
</div>
