<script lang="ts">
	/**
	 * "Meu perfil" — o que o próprio servidor vê sobre si, e as duas únicas
	 * coisas que ele muda daqui.
	 *
	 * A distinção central mudou de lado em ago/2026. O servidor nunca editou o
	 * próprio cadastro; agora ele também não o SOLICITA. Telefone, classe, regime
	 * e lotação aparecem em somente leitura, e quem pede a correção é o
	 * administrador da unidade ou da seccional dele, na ficha administrativa — com
	 * justificativa e sujeito à aprovação do Admin Geral. Por isso o quadro diz
	 * PARA QUEM reclamar: uma tela que só mostra o dado errado, sem dizer quem o
	 * conserta, é um beco.
	 *
	 * Identificação e dados cadastrais moram num quadro SÓ. Eram dois enquanto um
	 * deles era formulário; sem o formulário, a divisão passou a separar campos
	 * que respondem à mesma pergunta ("o que o sistema sabe sobre mim?").
	 *
	 * O que continua sendo do titular: o e-mail pessoal (troca com senha + código
	 * enviado ao novo endereço) e a chave de assinatura. Os dois vão por API e
	 * refletem na hora — daí o espelho local em `$state` depois do sucesso.
	 *
	 * **A vida funcional (E53)**, desde 24/09: a linha do tempo e as férias do
	 * titular, nos MESMOS componentes da ficha administrativa, com as ações
	 * desligadas — nada de corrigir, pedir ou dar ciência por aqui. Reusar os
	 * componentes em vez de escrever versões "de leitura" é o que garante que o
	 * servidor veja exatamente o que o administrador vê sobre ele: duas telas
	 * paralelas divergiriam na primeira mudança.
	 */
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { cartaoChaveVisivel } from '$lib/chave-assinatura-ui';
	import CartaoPasskey from './_components/CartaoPasskey.svelte';
	import HistoricoServidor from '../servidores/[id]/_components/HistoricoServidor.svelte';
	import CartaoFerias from '../servidores/[id]/_components/CartaoFerias.svelte';
	import MinhasEscalas from './_components/MinhasEscalas.svelte';
	import ModalAlterarEmailPessoal from './_components/ModalAlterarEmailPessoal.svelte';
	import { limparTelefone } from '$lib/utils/formato';

	const { data }: PageProps = $props();

	const perfil = $derived(data.perfil);

	const REGIME_ROTULO: Record<string, string> = {
		plantao: 'Plantão',
		expediente: 'Expediente',
		ambos: 'Plantão e expediente'
	};

	const telefone = $derived(limparTelefone(perfil.telefone));
	const regime = $derived(perfil.regime ? (REGIME_ROTULO[perfil.regime] ?? perfil.regime) : '');

	// --- E-mail pessoal (cadastro/troca com OTP; espelho local pós-sucesso) ---
	let alterandoEmail = $state(false);
	let emailPessoal = $state(untrack(() => data.perfil.email_pessoal ?? null));
	let emailPessoalVerificado = $state(untrack(() => !!data.perfil.email_pessoal_verificado));
</script>

<svelte:head><title>Meu perfil</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="h1 text-2xl font-bold">Meu perfil</h1>
		<p class="text-sm text-surface-600 dark:text-surface-400 mt-1">
			Dados do seu cadastro. O e-mail pessoal é o único que você altera por aqui.
		</p>
	</div>

	<!--
		Identificação e dados cadastrais num quadro só: para o servidor eles são a
		MESMA pergunta ("o que o sistema sabe sobre mim?"), e a divisão em duas
		seções só existia enquanto uma delas era um formulário.

		O texto abaixo abre com a EXCEÇÃO de propósito. Unir os dois grupos colocou o
		e-mail pessoal — o único campo que o titular altera — debaixo de "mantidos
		pela administração", e a frase passaria a contradizer o botão logo ao lado.
	-->
	<section class="card-elevated rounded-2xl p-4 sm:p-6">
		<h2
			class="font-semibold text-sm uppercase tracking-wider text-surface-600 dark:text-surface-400 mb-1"
		>
			Identificação/Dados cadastrais
		</h2>
		<p class="text-xs text-surface-600 dark:text-surface-400 mb-4">
			Com exceção do <strong>e-mail pessoal</strong>, estes dados são mantidos pela administração.
			Encontrou algo desatualizado? Procure o
			<strong>administrador da sua unidade ou da sua seccional</strong>: é ele quem registra o
			pedido de correção, que passa pela aprovação do Administrador Geral.
		</p>

		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			<div class="sm:col-span-2">
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block">Nome</span>
				<p class="font-semibold">{perfil.nome}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block"
					>Matrícula</span
				>
				<p class="font-semibold tabular-nums">{perfil.matricula}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block">Cargo</span>
				<p class="font-semibold">{perfil.cargo}</p>
			</div>

			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block">Telefone</span
				>
				<p class="font-semibold tabular-nums">{telefone || '—'}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block">Classe</span>
				<p class="font-semibold">{perfil.classe || '—'}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block"
					>Regime de trabalho</span
				>
				<p class="font-semibold">{regime || '—'}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block">Lotação</span>
				<p class="font-semibold">{perfil.lotacao || '—'}</p>
			</div>

			<div class="sm:col-span-2">
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block"
					>E-mail funcional</span
				>
				<p class="font-semibold break-words">{perfil.email || '—'}</p>
			</div>
			<div class="sm:col-span-2">
				<span class="label-text text-xs text-surface-600 dark:text-surface-400 block"
					>E-mail pessoal</span
				>
				<div class="flex items-center gap-2 flex-wrap">
					<p class="font-semibold break-words">
						{emailPessoal || '—'}
						{#if emailPessoal}
							<span
								class="ml-1 text-3xs font-bold uppercase px-1.5 py-0.5 rounded {emailPessoalVerificado
									? 'bg-success-500/15 text-success-700 dark:text-success-400'
									: 'bg-warning-500/15 text-warning-700 dark:text-warning-400'}"
							>
								{emailPessoalVerificado ? 'Verificado' : 'Não verificado'}
							</span>
						{/if}
					</p>
					<button
						type="button"
						class="btn btn-sm preset-outlined-surface-500 text-xs"
						onclick={() => (alterandoEmail = true)}
					>
						{emailPessoal ? 'Alterar' : 'Cadastrar'}
					</button>
				</div>
				{#if emailPessoal}
					<p class="text-2xs text-surface-600 dark:text-surface-400 mt-1">
						A troca exige sua senha e um código enviado ao novo endereço.
					</p>
				{/if}
			</div>
		</div>
	</section>

	<!-- Chave de assinatura (passkey): responde "o que preciso ter cadastrado
	     para assinar?". Só existe na tela com a exigência ligada (ver
	     `cartaoChaveVisivel`). -->
	{#if cartaoChaveVisivel(page.data)}
		<CartaoPasskey credencialAtual={data.passkey} />
	{/if}
</div>

<!-- Minha vida funcional (E53): o mesmo cartão de férias e a mesma linha do
     tempo da ficha administrativa, em leitura. `podeAgir`, `isAdmin` e
     `podeDarCiencia` desligados tiram TODOS os botões; a correção continua
     vindo do administrador da unidade. -->
<section class="mt-4" aria-labelledby="minha-vida-funcional">
	<h2
		id="minha-vida-funcional"
		class="mb-2 text-base font-semibold text-surface-900 dark:text-surface-50"
	>
		Minha vida funcional
	</h2>
	<p class="mb-3 text-xs text-surface-600 dark:text-surface-400">
		Férias, afastamentos, movimentações e designações — o que o sistema registra sobre você. Para
		corrigir algo, fale com quem administra a sua unidade.
	</p>
	<div class="space-y-4">
		<CartaoFerias
			ferias={data.ferias}
			feriados={data.feriados}
			dataPosse={data.perfil.data_posse}
			ocupados={data.ocupados}
			isAdmin={false}
			podeDarCiencia={false}
			podeAgir={false}
		/>
		<HistoricoServidor
			historico={data.historico}
			afastamentoVigenteId={data.afastamentoVigenteId}
			unidades={data.unidades}
			designacoes={data.designacoes}
			policialId={data.perfil.id}
			isAdmin={false}
		/>
	</div>
</section>

<!-- Minhas escalas (E53): em que dias ele está escalado, mês a mês. -->
<MinhasEscalas escalas={data.escalas} />

<ModalAlterarEmailPessoal
	bind:open={alterandoEmail}
	emailAtual={emailPessoal}
	onConfirmado={(novo) => {
		emailPessoal = novo;
		emailPessoalVerificado = true;
	}}
/>
