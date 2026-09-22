<script lang="ts">
	/**
	 * Ficha administrativa do servidor — o outro lado de `/perfil`.
	 *
	 * A MESMA tela serve a dois poderes, e `data.modo` é o que os separa:
	 *
	 *  - **`direto`** (Admin Geral): o formulário SALVA, e os quadros de Papel
	 *    Administrativo e de Admin Geral são controles de verdade;
	 *  - **`solicitacao`** (admin de seccional / de unidade): o mesmo formulário
	 *    SOLICITA — com justificativa obrigatória —, e os dois quadros aparecem
	 *    apenas informativos. Ver o quadro, mesmo sem poder mexer, é o que responde
	 *    "por que este servidor administra a minha unidade?" sem obrigar ninguém a
	 *    perguntar ao Admin Geral.
	 *
	 * Duas ausências no modo `solicitacao` são regra, não acaso:
	 *
	 *  - **lotação** não é editável nem solicitável aqui: transferir servidor é
	 *    MOVIMENTAÇÃO, no quadro "Afastar / Movimentar Servidor", que exige data,
	 *    NUP e portaria. Um segundo caminho produziria transferência sem portaria,
	 *    indistinguível de uma com portaria depois de gravada;
	 *  - **CPF** não é exibido a quem não edita direto. O campo fica em branco e
	 *    serve só para PEDIR um novo número — ler o atual nunca foi necessário para
	 *    isso (minimização, LGPD art. 6º III).
	 *
	 * O `$effect` que copia `data.policial` para os campos re-sincroniza a cada
	 * `invalidateAll()`: depois de salvar, o formulário deve mostrar o que ficou
	 * gravado, não o rascunho.
	 */
	import type { PageProps } from './$types';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { cartaoChaveVisivel } from '$lib/chave-assinatura-ui';
	import { invalidateShared } from '$lib/cross-tab-invalidate';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { limparCPF, limparTelefone, formatarCPF } from '$lib/utils/formato';
	import { loading } from '$lib/loading.svelte';
	import { MAX_JUSTIFICATIVA } from '$lib/cadastro-campos';
	import type { ActionResult } from '@sveltejs/kit';
	import PainelAcoesServidor from './_components/PainelAcoesServidor.svelte';
	import HistoricoServidor from './_components/HistoricoServidor.svelte';
	import CartaoPasskeyServidor from './_components/CartaoPasskeyServidor.svelte';
	import CartaoAdminGeral from './_components/CartaoAdminGeral.svelte';
	import SolicitacoesServidor from './_components/SolicitacoesServidor.svelte';
	import CartaoFerias from './_components/CartaoFerias.svelte';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import { COR_SITUACAO, rotuloAfastamento } from '$lib/servidores/afastamentos';
	import { formatarData } from '$lib/utils/datas';

	const { data }: PageProps = $props();

	const isAdmin = $derived(data.isAdmin);
	// Derivado gravável: espelha o load, mas admite o que a action devolve.
	let feriasDaFicha = $derived(data.ferias);
	const solicitando = $derived(data.modo === 'solicitacao');
	/** "Trabalha em" (E66): vazio = a sede da lotação. Só o Admin Geral edita. */
	let localId = $state('');
	/** O que a unidade liberou para o colaborador (E61); tudo `true` para os demais. */
	const acessos = $derived(data.acessos);
	const seccionaisParaPapel = $derived(
		data.unidades.filter((u: { tipo: string }) => u.tipo === 'seccional')
	);
	const unidadesParaAdmin = $derived(
		data.unidades.filter((u: { tipo: string }) => u.tipo !== 'seccional')
	);

	let nome = $state('');
	let matricula = $state('');
	let cargo = $state('');
	let cpf = $state('');
	let telefone = $state('');
	let classe = $state('');
	let regime = $state('');
	let lotacao = $state('');
	let email = $state('');
	/** Id do catálogo como TEXTO — é o que o `<select>` e o `FormData` trafegam. */
	let designacaoId = $state('');
	/** Devolver a caneta à folha de pessoal (só aparece quando a tela a tomou). */
	let seguirPlanilha = $state(false);
	let papel = $state<string | null>(null);
	let papelUnidadeId = $state<number | null>(null);
	let justificativa = $state('');

	$effect(() => {
		if (data?.policial) {
			nome = data.policial.nome;
			matricula = data.policial.matricula;
			cargo = data.policial.cargo;
			// Modo solicitação não recebe o CPF do servidor: o campo nasce vazio e só
			// vale se preenchido.
			cpf = formatarCPF(data.policial.cpf || '');
			telefone = limparTelefone(data.policial.telefone || '');
			classe = ((data.policial as Record<string, unknown>).classe as string) || '';
			regime = data.policial.regime || 'plantao';
			lotacao = data.policial.lotacao;
			email = data.policial.email || '';
			designacaoId = data.policial.designacao_id ? String(data.policial.designacao_id) : '';
			localId = data.policial.local_id ? String(data.policial.local_id) : '';
			seguirPlanilha = false;
			papel = data.policial.papel;
			papelUnidadeId = data.policial.papel_unidade_id;
		}
	});

	/**
	 * Avisa que esta designação foi decidida AQUI e que a carga da planilha não
	 * a desfaz (0089) — sem isso, o Admin Geral não teria como saber se o valor
	 * que ele vê sobrevive à próxima folha.
	 */
	const designacaoDaTela = $derived(
		data.policial.designacao_origem === 'sistema'
			? 'definida nesta tela; a planilha não sobrescreve'
			: ''
	);

	/**
	 * Há o que pedir? Compara o formulário com o cadastro, com a MESMA
	 * normalização do servidor — telefone por dígitos, o resto por texto. O CPF
	 * conta como mudança sempre que preenchido, porque o valor atual não vem para
	 * a tela e não há com o que comparar.
	 */
	const houveMudanca = $derived(
		nome.trim() !== data.policial.nome ||
			matricula.trim() !== data.policial.matricula ||
			cargo !== data.policial.cargo ||
			limparCPF(cpf) !== '' ||
			telefone !== limparTelefone(data.policial.telefone || '') ||
			classe !== (((data.policial as Record<string, unknown>).classe as string) || '') ||
			regime !== (data.policial.regime || 'plantao') ||
			email.trim() !== (data.policial.email || '') ||
			designacaoId !== (data.policial.designacao_id ? String(data.policial.designacao_id) : '')
	);

	const podeSolicitar = $derived(houveMudanca && justificativa.trim().length > 0);

	function handleSalvar() {
		loading.show('Salvando dados do policial...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				toaster.create({ title: 'Policial atualizado com sucesso!', type: 'success' });
				goto('/servidores');
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				if (d?.error) toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}

	function handleSolicitar() {
		loading.show('Enviando solicitação...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				toaster.create({
					title: 'Solicitação enviada',
					description: 'As alterações aguardam aprovação do Administrador Geral.',
					type: 'success'
				});
				justificativa = '';
				cpf = '';
				await invalidateShared(`policial:${data.policial.id}`, 'app:policiais');
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				if (d?.error) toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}

	function handleSalvarPapel() {
		loading.show('Atualizando papel administrativo...');
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				toaster.create({ title: 'Papel atualizado com sucesso!', type: 'success' });
				await invalidateShared(`policial:${data.policial.id}`, 'app:policiais');
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				if (d?.error) toaster.create({ title: String(d.error), type: 'error' });
			}
		};
	}

	const classesDisponiveis = $derived(
		cargo === 'DPC' ? ['1ª', '2ª', '3ª', 'ESPECIAL'] : ['A', 'B', 'C', 'D']
	);

	// Papel administrativo SEMPRE exige a unidade/seccional de responsabilidade —
	// papel sem alcance deixa o escopo do RBAC indefinido, e `salvarPapel` recusa.
	// Havia aqui uma exceção para o admin de unidade nomeando outro admin da
	// própria unidade ("será nomeado para a sua própria unidade"), que o servidor
	// nunca implementou: o formulário submetia sem `papel_unidade_id` e levava 400.
	// Com o quadro restrito ao Admin Geral a exceção perdeu até o sujeito.
	const papelSemUnidade = $derived(!!papel && papelUnidadeId == null);

	const ROTULO_PAPEL: Record<string, string> = {
		admin_seccional: 'Admin Seccional',
		admin_unidade: 'Admin Unidade'
	};
	const nomeUnidadeDoPapel = $derived(
		data.unidades.find((u: { id: number }) => u.id === data.policial.papel_unidade_id)?.nome ?? null
	);
</script>

<svelte:head>
	<title>{solicitando ? 'Ficha do servidor' : 'Editar policial'} | Ecossistema PCCE</title>
</svelte:head>

<div class="mb-6 space-y-3">
	<BotaoVoltar onclick={() => goto('/servidores')} />

	<h1 class="h1 text-2xl font-bold">{solicitando ? 'Ficha do Servidor' : 'Editar Policial'}</h1>
	<!-- Situação de hoje ao lado do nome: férias em dourado, afastado em vermelho
	     (pedido de 15/09/2026). Detalhe e base legal ficam na linha do tempo. -->
	<p class="text-sm">
		<span class="font-semibold text-surface-900 dark:text-surface-50">{data.policial.nome}</span>
		{#if data.afastamentoAtual}
			{@const ferias = data.afastamentoAtual.subtipo === 'ferias'}
			<span class="ml-2 font-semibold {ferias ? COR_SITUACAO.ferias : COR_SITUACAO.afastado}"
				>· {ferias ? 'De férias' : rotuloAfastamento(data.afastamentoAtual.subtipo)}
				{data.afastamentoAtual.data_fim
					? `até ${formatarData(data.afastamentoAtual.data_fim)}`
					: `desde ${formatarData(data.afastamentoAtual.data_inicio)}`}</span
			>
		{:else}
			<span class="ml-2 {COR_SITUACAO.ativo}">· Ativo</span>
		{/if}
	</p>

	{#if solicitando}
		<div
			class="rounded-xl bg-primary-500/10 border-l-4 border-primary-500 px-4 py-3 text-sm text-surface-700 dark:text-surface-200"
		>
			Nesta tela você <b>solicita</b> alterações: nada muda no cadastro até o Administrador Geral
			aprovar. Todo pedido exige justificativa. A troca de <b>lotação</b> e a desvinculação são feitas
			pelo DPI SUL.
		</div>
	{/if}
</div>

<div class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6">
	<form
		method="POST"
		action={solicitando ? '?/solicitarAlteracao' : '?/salvar'}
		use:enhance={solicitando ? handleSolicitar : handleSalvar}
		class="space-y-4"
	>
		<!-- Linha 1 -->
		<div class="grid grid-cols-1 sm:grid-cols-12 gap-x-2 gap-y-4">
			<label class="label sm:col-span-4">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
					>Nome completo (Conforme Certificado Digital)</span
				>
				<input
					class="input py-1 px-3 text-sm"
					type="text"
					name="nome"
					bind:value={nome}
					required={!solicitando}
				/>
			</label>
			<label class="label sm:col-span-2">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Matrícula</span>
				<input
					class="input py-1 px-3 text-sm"
					type="text"
					name="matricula"
					bind:value={matricula}
					required={!solicitando}
				/>
			</label>
			<label class="label sm:col-span-3">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Cargo</span>
				<select class="select py-1 px-3 text-sm" name="cargo" bind:value={cargo}>
					<option value="DPC">DPC - Delegado</option>
					<option value="OIP">OIP - Investigador</option>
				</select>
			</label>
			<label class="label sm:col-span-3">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Telefone</span>
				<input
					class="input py-1 px-3 text-sm"
					type="text"
					inputmode="numeric"
					name="telefone"
					value={telefone}
					oninput={(e) => (telefone = limparTelefone(e.currentTarget.value))}
					placeholder="Somente números (DDD + número)"
					maxlength="11"
				/>
			</label>
			<label class="label sm:col-span-3">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
					>CPF (Obrigatório para Token)</span
				>
				<input
					class="input py-1 px-3 text-sm"
					type="text"
					name="cpf"
					value={cpf}
					oninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}
					placeholder={solicitando
						? data.policial.temCpfCadastrado
							? 'Cadastrado — preencha só para alterar'
							: 'Não cadastrado — informe para solicitar'
						: '000.000.000-00'}
					maxlength="14"
				/>
			</label>
			<label class="label sm:col-span-5">
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
			<label class="label sm:col-span-4">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
					>E-mail pessoal (cadastrado pelo policial)</span
				>
				<input
					class="input py-1 px-3 text-sm bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75"
					type="email"
					value={data.policial?.email_pessoal || ''}
					placeholder="— não cadastrado —"
					readonly
				/>
			</label>
		</div>

		<!-- Linha 2 -->
		<div class="grid grid-cols-1 sm:grid-cols-12 gap-x-2 gap-y-4">
			<label class="label sm:col-span-2">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Classe</span>
				<select
					class="select py-1 px-3 text-sm"
					name="classe"
					bind:value={classe}
					required={!solicitando}
				>
					<option value="" disabled>-</option>
					{#each classesDisponiveis as c (c)}
						<option value={c}>{c}</option>
					{/each}
					{#if classe && !classesDisponiveis.includes(classe)}
						<option value={classe}>{classe} (Atual)</option>
					{/if}
				</select>
			</label>
			<label class="label sm:col-span-3">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1"
					>Regime de Trabalho</span
				>
				<select class="select py-1 px-3 text-sm" name="regime" bind:value={regime}>
					<option value="plantao">Plantão</option>
					<option value="expediente">Expediente</option>
				</select>
			</label>
			<!-- Designação = a FUNÇÃO exercida (catálogo `designacoes`). O Admin
			     Geral troca direto; o administrador de seccional/unidade PROPÕE, e
			     o Admin Geral homologa (E50) — quem sabe que o servidor passou a
			     chefiar o cartório é a delegacia, não o departamento. -->
			<label class="label sm:col-span-7">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">
					Designação
					{#if designacaoDaTela}
						<span class="normal-case font-normal opacity-70">— {designacaoDaTela}</span>
					{/if}
				</span>
				<select class="select py-1 px-3 text-sm" name="designacao_id" bind:value={designacaoId}>
					<!-- No modo solicitação "sem designação" não é pedido: campo vazio
					     quer dizer "não quero mudar isto", a mesma convenção dos demais. -->
					<option value="" disabled={solicitando}>— Sem designação —</option>
					{#each data.designacoes as d (d.id)}
						<option value={String(d.id)}>{d.nome}{d.simbolo ? ` (${d.simbolo})` : ''}</option>
					{/each}
				</select>
			</label>
			<!-- A VOLTA. Sem ela, o primeiro salvamento tirava o servidor da folha
			     para sempre neste campo, e só o banco o devolveria. -->
			{#if isAdmin && data.policial.designacao_origem === 'sistema'}
				<label class="label sm:col-span-12 flex-row items-center gap-2">
					<input
						class="checkbox"
						type="checkbox"
						name="designacao_seguir_planilha"
						value="1"
						bind:checked={seguirPlanilha}
					/>
					<span class="text-2xs opacity-80">
						Voltar a seguir a planilha de pessoal nesta designação
					</span>
				</label>
			{/if}
			<label class="label sm:col-span-12">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">
					Lotação
					{#if solicitando}
						<span class="normal-case font-normal opacity-70">— altere por Movimentação</span>
					{/if}
				</span>
				{#if isAdmin}
					<select class="select py-1 px-3 text-sm" name="lotacao" bind:value={lotacao}>
						<option value="">— Sem lotação —</option>
						{#each data.lotacoes as u (u)}
							<option value={u}>{u}</option>
						{/each}
					</select>
				{:else}
					<!-- Sem `name`: no modo solicitação a lotação não é enviada, para não
					     existir um segundo caminho de transferência sem portaria. -->
					<input
						class="input py-1 px-3 text-sm bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75"
						type="text"
						value={lotacao}
						readonly
					/>
				{/if}
			</label>

			<!-- Trabalha em (E66): a lotação é o vínculo; o local é onde a pessoa
			     fica. Só aparece quando a lotação TEM subunidade — sem posto nem
			     núcleo, a pergunta não existe. Só o Admin Geral edita. -->
			{#if data.locais.length > 1}
				<label class="label sm:col-span-12">
					<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">
						Trabalha em
						<span class="normal-case font-normal opacity-70"
							>— a lotação continua sendo {lotacao}</span
						>
					</span>
					{#if isAdmin}
						<select class="select py-1 px-3 text-sm" name="local_id" bind:value={localId}>
							{#each data.locais as l (l.id)}
								<option value={l.sede ? '' : String(l.id)}>{l.nome}{l.sede ? ' (sede)' : ''}</option
								>
							{/each}
						</select>
					{:else}
						<input
							class="input py-1 px-3 text-sm bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75"
							type="text"
							value={data.locais.find((l) => String(l.id) === localId)?.nome ?? lotacao}
							readonly
						/>
					{/if}
				</label>
			{/if}
		</div>

		{#if solicitando}
			<label class="label">
				<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">
					Justificativa do pedido
				</span>
				<textarea
					class="textarea py-1 px-3 text-sm"
					name="justificativa"
					bind:value={justificativa}
					rows="2"
					maxlength={MAX_JUSTIFICATIVA}
					required
					placeholder="Ex.: correção do telefone informada pelo servidor, conforme ofício nº ..."
				></textarea>
				<span class="text-2xs opacity-60 ml-1 self-end tabular-nums">
					{justificativa.length}/{MAX_JUSTIFICATIVA}
				</span>
			</label>
		{/if}

		<div class="flex justify-end gap-2 pt-1 border-t border-surface-200 dark:border-white/5 mt-2">
			<a href="/servidores" class="btn btn-sm preset-outlined-surface-500">Cancelar</a>
			{#if !acessos.cadastro}
				<span class="self-center text-2xs text-surface-500"
					>A unidade não liberou a proposta de alteração de cadastro para você.</span
				>
			{/if}
			<button
				type="submit"
				class="btn btn-sm sm:btn-md preset-filled-primary-500 flex items-center gap-2 disabled:opacity-40"
				disabled={loading.active || (solicitando && !podeSolicitar) || !acessos.cadastro}
			>
				{#if loading.active}
					{solicitando ? 'Enviando...' : 'Guardando...'}
				{:else}
					{solicitando ? 'Solicitar alteração' : 'Salvar'}
				{/if}
			</button>
		</div>
	</form>
</div>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 items-stretch">
	<div class="card-elevated rounded-2xl shadow-sm p-4 sm:p-6 flex flex-col">
		<h2 class="text-base font-bold mb-1 text-surface-700 dark:text-surface-300">
			Papel Administrativo
			{#if solicitando}
				<span class="text-2xs font-bold uppercase opacity-60 ml-1">informativo</span>
			{/if}
		</h2>
		<p class="text-xs text-surface-600 dark:text-surface-400 mb-3">
			Papel de gestão <b>restrito a uma seccional ou unidade</b>: gerencia escalas e policiais
			apenas do próprio escopo. Diferente do Admin Geral, não concede acesso global.
		</p>

		{#if solicitando}
			<!-- Informativo: conceder papel é conceder PERMISSÃO, e isso não é
			     "corrigir um dado" — não entra no fluxo de solicitação. A action
			     `salvarPapel` recusa quem não é Admin Geral, então aqui não há
			     formulário nenhum a submeter. -->
			<div class="mt-auto space-y-1">
				<p class="text-sm">
					<span class="font-semibold">
						{data.policial.papel ? ROTULO_PAPEL[data.policial.papel] : 'Servidor (sem papel)'}
					</span>
					{#if nomeUnidadeDoPapel}
						<span class="text-surface-600 dark:text-surface-400"> · {nomeUnidadeDoPapel}</span>
					{/if}
				</p>
				<p class="text-2xs text-surface-600 dark:text-surface-400">
					Somente o Administrador Geral concede ou revoga papéis.
				</p>
			</div>
		{:else}
			<form
				method="POST"
				action="?/salvarPapel"
				use:enhance={handleSalvarPapel}
				class="space-y-3 mt-auto"
			>
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-x-2 gap-y-4">
					<label class="label sm:col-span-5">
						<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">Papel</span>
						<select class="select py-1 px-3 text-sm" name="papel" bind:value={papel}>
							<option value={null}>Servidor (sem papel)</option>
							<option value="admin_seccional">Admin Seccional</option>
							<option value="admin_unidade">Admin Unidade</option>
						</select>
					</label>
					{#if papel}
						<label class="label sm:col-span-7">
							<span class="label-text text-2xs font-bold uppercase opacity-70 ml-1">
								{papel === 'admin_seccional'
									? 'Seccional de responsabilidade'
									: 'Unidade de responsabilidade'}
							</span>
							<select
								class="select py-1 px-3 text-sm"
								name="papel_unidade_id"
								bind:value={papelUnidadeId}
							>
								<option value={null}>Selecionar...</option>
								{#each papel === 'admin_seccional' ? seccionaisParaPapel : unidadesParaAdmin as u (u.id)}
									<option value={u.id}>{u.nome}</option>
								{/each}
							</select>
						</label>
					{/if}
				</div>
				<div
					class="flex items-center justify-end gap-2 pt-1 border-t border-surface-200 dark:border-white/5 mt-2"
				>
					{#if papelSemUnidade}
						<span class="text-3xs text-error-600 dark:text-error-400 mr-auto">
							Selecione a unidade de responsabilidade.
						</span>
					{/if}
					<button
						type="submit"
						class="btn btn-sm preset-filled-primary-500 flex items-center gap-2"
						disabled={loading.active || papelSemUnidade}
					>
						{loading.active ? 'Salvando...' : 'Salvar papel'}
					</button>
				</div>
			</form>
		{/if}
	</div>

	<!-- Chave de assinatura do servidor: só na tela com a exigência ligada, a
	     MESMA regra do cartão em Meu Perfil (ver `cartaoChaveVisivel`) — o
	     administrador não deve ver um cartão que o titular não vê. Continua
	     exclusiva do Admin Geral: revogar chave é ato de credencial, não
	     correção de cadastro. -->
	{#if isAdmin && cartaoChaveVisivel(page.data)}
		<CartaoPasskeyServidor
			policialId={data.policial.id}
			nome={data.policial.nome}
			passkey={data.passkey}
			chavesAnteriores={data.chavesAnteriores}
		/>
	{/if}

	<CartaoAdminGeral
		policialId={data.policial.id}
		ehAdminGeral={data.ehAdminGeral}
		moduloEscalas={data.modulosAdmin?.escalas ?? false}
		moduloGise={data.modulosAdmin?.gise ?? false}
		disabled={loading.active}
		somenteLeitura={solicitando}
	/>
</div>

{#if acessos.afastamento}
	<PainelAcoesServidor
		policial={{
			id: data.policial.id,
			nome: data.policial.nome,
			matricula: data.policial.matricula,
			lotacao: data.policial.lotacao
		}}
		lotacoes={data.lotacoes}
		modo={data.modo}
		ocupados={data.ocupados}
		semTitular={data.semTitular}
		cargo={data.policial.cargo}
	/>
{/if}

<SolicitacoesServidor
	designacoes={data.designacoes}
	campos={data.solicitacoesCampo}
	acoes={data.solicitacoesAcao}
	policialId={data.policial.id}
	podePedirRetorno={acessos.afastamento}
/>

<!-- Férias: frações do Guardião, o assistente do NUP e o abono (E56). O que a
     action devolve substitui `ferias` sem recarregar a ficha inteira. -->
<div class="mt-4">
	<CartaoFerias
		bind:ferias={feriasDaFicha}
		feriados={data.feriados}
		dataPosse={data.dataPosse}
		ocupados={data.ocupados}
		{isAdmin}
		podeDarCiencia={acessos.ferias}
		podeAgir={acessos.ferias}
	/>
</div>

<HistoricoServidor
	historico={data.historico}
	afastamentoVigenteId={data.afastamentoVigenteId}
	unidades={data.unidades}
	designacoes={data.designacoes}
	policialId={data.policial.id}
	{isAdmin}
/>
