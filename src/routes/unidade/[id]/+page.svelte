<script lang="ts">
	/**
	 * A ficha da unidade (decisão E39, item 3.1).
	 *
	 * Blocos: identificação e contato (foto, endereço, telefone, e-mail — fase
	 * 2), efetivo por cargo e situação (cada número leva à lista de servidores
	 * já filtrada), os municípios atendidos com o plantão de cada um, as
	 * unidades vinculadas e o cartão de estrutura (xadrezes, tira-gravame e, como
	 * previstos, veículos e armas da fase 4).
	 */
	import type { PageProps } from './$types';
	import BotaoVoltar from '$lib/components/BotaoVoltar.svelte';
	import { rotuloTipoPlantao } from '$lib/unidades/plantao';
	import { COR_SITUACAO } from '$lib/servidores/afastamentos';
	import ModalEfetivo, { type PedidoEfetivo } from '../_components/ModalEfetivo.svelte';
	import CartaoDirecao from './_components/CartaoDirecao.svelte';

	const { data }: PageProps = $props();

	const u = $derived(data.unidade);
	const hrefServidores = $derived(`/servidores?lotacao=${encodeURIComponent(u.nome)}`);

	const regimes = $derived(
		[u.tem_plantao && 'Plantão', u.tem_expediente && 'Expediente', u.tem_fds && 'Fim de semana']
			.filter(Boolean)
			.join(' · ')
	);

	/** Quem administra uma unidade só não tem lista para voltar. */
	const voltarPara = $derived(data.ehRaizDoEscopo && data.filhas.length === 0 ? '/' : '/unidade');

	const PREVISTOS = [
		{ campo: 'Veículos', fase: 'fase 4 · Patrimônio' },
		{ campo: 'Armas e algemas', fase: 'fase 4 · Patrimônio' }
	];

	/** "Físico · DP de Iguatu" — ou "—" quando o município não tem plantão cadastrado. */
	const plantao = (p: { tipo: string; plantonista: string } | null) =>
		p ? `${rotuloTipoPlantao(p.tipo)}${p.plantonista ? ` · ${p.plantonista}` : ''}` : '—';

	// O painel "quem são" — abre ao clicar num número (pedido de 15/09/2026).
	let painelAberto = $state(false);
	let pedido = $state<PedidoEfetivo | null>(null);
	function abrirPainel(
		situacao: PedidoEfetivo['situacao'],
		cargo: PedidoEfetivo['cargo'],
		subarvore = false
	) {
		pedido = {
			unidadeId: u.id,
			unidadeNome: u.nome,
			unidadeRotulo: u.sigla || u.nome,
			situacao,
			cargo,
			subarvore
		};
		painelAberto = true;
	}
	const corDe = (situacao: PedidoEfetivo['situacao'], n: number) =>
		n === 0
			? 'text-surface-400'
			: situacao === 'ativos'
				? COR_SITUACAO.ativo
				: situacao === 'ferias'
					? COR_SITUACAO.ferias
					: COR_SITUACAO.afastado;
	const BOTAO_NUM =
		'cursor-pointer rounded px-1.5 text-lg font-bold tabular-nums hover:bg-surface-500/10';
</script>

<svelte:head>
	<title>{u.nome} | Ecossistema PCCE</title>
</svelte:head>

<BotaoVoltar href={voltarPara} />

<div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start">
	{#if u.temFoto}
		<img
			src="/api/unidades/{u.id}/foto"
			alt="Fachada de {u.nome}"
			class="h-32 w-full shrink-0 rounded-xl object-cover shadow-md sm:h-28 sm:w-44"
			loading="lazy"
			onerror={(e) => {
				// Link de origem fora do ar (Drive) e sem cópia no R2: some, em vez
				// de deixar o ícone de imagem quebrada na ficha.
				(e.currentTarget as HTMLImageElement).hidden = true;
			}}
		/>
	{/if}
	<div class="min-w-0">
		<p
			class="text-2xs font-semibold tracking-[0.18em] text-primary-700 uppercase dark:text-primary-400"
		>
			{u.tipoRotulo}{#if u.sigla}
				· {u.sigla}{/if}{#if u.ais}
				· {u.ais}{/if}
		</p>
		<h1 class="h1 mt-0.5 text-2xl font-bold">{u.nome}</h1>
		<p class="mt-1 text-sm text-surface-600 dark:text-surface-400">
			{#if u.cidade}{u.cidade} ·
			{/if}
			{#if data.pai}
				Vinculada a
				{#if data.pai.noEscopo}
					<a href="/unidade/{data.pai.id}" class="font-medium">{data.pai.nome}</a>
				{:else}
					<span class="font-medium">{data.pai.nome}</span>
				{/if}
				({data.pai.tipoRotulo})
			{:else}
				Sem unidade superior cadastrada
			{/if}
			{#if u.abrangencia === 'corporativa'}
				· abrangência corporativa{/if}
		</p>
		{#if u.endereco || u.telefone || u.email}
			<dl class="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
				{#if u.endereco}
					<dt class="text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase sm:pt-0.5">
						Endereço
					</dt>
					<dd class="text-surface-700 dark:text-surface-300">{u.endereco}</dd>
				{/if}
				{#if u.telefone}
					<dt class="text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase sm:pt-0.5">
						Telefone
					</dt>
					<dd class="text-surface-700 dark:text-surface-300">
						<a href="tel:{u.telefone.replace(/\D/g, '')}">{u.telefone}</a>
					</dd>
				{/if}
				{#if u.email}
					<dt class="text-2xs font-semibold tracking-[0.18em] text-surface-500 uppercase sm:pt-0.5">
						E-mail
					</dt>
					<dd class="text-surface-700 dark:text-surface-300">
						<a href="mailto:{u.email}">{u.email}</a>
					</dd>
				{/if}
			</dl>
		{/if}
	</div>
</div>

<!-- Pendências de férias: o que esta unidade (com as vinculadas) ainda tem de
     resolver. Alerta, não informação — fica até a causa sumir. -->
{#if data.pendenciasFerias.reprogramacoesPendentes > 0 || data.pendenciasFerias.abonosSemCiencia > 0}
	<div
		class="mb-4 rounded-xl border border-warning-500/40 bg-warning-500/10 p-3 text-sm text-warning-800 dark:text-warning-300"
		role="alert"
	>
		<span class="font-semibold">⚠ Férias com pendência:</span>
		{[
			data.pendenciasFerias.reprogramacoesPendentes > 0 &&
				`${data.pendenciasFerias.reprogramacoesPendentes} pedido${data.pendenciasFerias.reprogramacoesPendentes === 1 ? '' : 's'} de reprogramação aguardando a resposta da COGEP`,
			data.pendenciasFerias.abonosSemCiencia > 0 &&
				`${data.pendenciasFerias.abonosSemCiencia} abono${data.pendenciasFerias.abonosSemCiencia === 1 ? '' : 's'} deferido${data.pendenciasFerias.abonosSemCiencia === 1 ? '' : 's'} sem ciência da unidade — nesses dias o servidor trabalha`
		]
			.filter(Boolean)
			.join('; ')}.
		<a href={hrefServidores} class="ml-1 font-semibold">Ver servidores →</a>
	</div>
{/if}

<!-- Direção: vem ANTES do efetivo porque "quem dirige" é a primeira pergunta de
     quem abre a ficha de uma unidade. -->
<div class="mb-4">
	<CartaoDirecao
		unidadeNome={u.nome}
		direcao={data.direcao}
		sucessao={data.sucessao}
		modo={data.modoDirecao}
	/>
</div>

<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
	<!-- Efetivo -->
	<section class="card-elevated rounded-2xl p-5 lg:col-span-2" aria-labelledby="efetivo">
		<div class="mb-4 flex items-baseline justify-between gap-3">
			<h2 id="efetivo" class="text-base font-semibold text-surface-900 dark:text-surface-50">
				Efetivo
			</h2>
			<div class="flex gap-3">
				<a
					href="/unidade/{u.id}/ferias"
					class="text-xs font-semibold text-primary-700 dark:text-primary-400"
				>
					Férias do ano →
				</a>
				<a
					href={hrefServidores}
					class="text-xs font-semibold text-primary-700 dark:text-primary-400"
				>
					Ver servidores →
				</a>
			</div>
		</div>
		<!-- Uma linha por cargo: ativos hoje, de férias, afastados por outro motivo
		     e o total lotado. O número de ativos é link para a lista filtrada. -->
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr class="text-2xs">
						<th>Cargo</th>
						<th class="!text-center">Ativos</th>
						<th class="!text-center">Férias</th>
						<th class="!text-center">Afastados</th>
						<th class="!text-center">Lotados</th>
					</tr>
				</thead>
				<tbody>
					{#each [['dpc', 'Delegados (DPC)'], ['oip', 'Oficiais (OIP)']] as const as [cargo, rotulo] (cargo)}
						{@const c = data.efetivo[cargo]}
						{@const sigla = cargo === 'dpc' ? 'DPC' : 'OIP'}
						<tr>
							<td class="font-medium">{rotulo}</td>
							{#each [['ativos', c.ativos], ['ferias', c.ferias], ['afastados', c.afastados]] as const as [situacao, n] (situacao)}
								<td class="text-center">
									<button
										type="button"
										class="{BOTAO_NUM} {corDe(situacao, n)}"
										disabled={n === 0}
										title="Ver quem"
										onclick={() => abrirPainel(situacao, sigla)}>{n}</button
									>
								</td>
							{/each}
							<td class="text-center text-lg font-semibold tabular-nums">{c.total}</td>
						</tr>
					{/each}
					<tr class="text-sm font-semibold text-warning-600 dark:text-warning-400">
						<td>Total</td>
						{#each [['ativos', data.efetivo.dpc.ativos + data.efetivo.oip.ativos], ['ferias', data.efetivo.dpc.ferias + data.efetivo.oip.ferias], ['afastados', data.efetivo.dpc.afastados + data.efetivo.oip.afastados]] as const as [situacao, n] (situacao)}
							<td class="text-center tabular-nums">
								<button
									type="button"
									class="cursor-pointer rounded px-1.5 hover:bg-surface-500/10 disabled:cursor-default"
									disabled={n === 0}
									title="Ver quem"
									onclick={() => abrirPainel(situacao, undefined)}>{n}</button
								>
							</td>
						{/each}
						<td class="text-center font-semibold tabular-nums">{data.efetivo.total}</td>
					</tr>
				</tbody>
			</table>
		</div>
		{#if data.totalVinculadas > 0}
			<p class="mt-4 text-xs text-surface-500">
				Com as {data.totalVinculadas} unidade{data.totalVinculadas === 1 ? '' : 's'} vinculada{data.totalVinculadas ===
				1
					? ''
					: 's'}: {data.subtotal.total} lotados — DPC {data.subtotal.dpc.ativos} ativos, {data
					.subtotal.dpc.ferias} de férias, {data.subtotal.dpc.afastados} afastados; OIP {data
					.subtotal.oip.ativos} ativos, {data.subtotal.oip.ferias} de férias, {data.subtotal.oip
					.afastados} afastados.
			</p>
		{/if}
		{#if regimes}
			<p class="mt-2 text-xs text-surface-500">Regimes de escala: {regimes}.</p>
		{/if}
	</section>

	<!-- Estrutura e patrimônio: o que a unidade TEM (xadrezes, tira-gravame) e
	     o que a fase 4 ainda vai trazer (veículos, armas), no mesmo cartão a
	     pedido do responsável (15/09/2026). -->
	<section class="card-elevated rounded-2xl p-5" aria-labelledby="estrutura">
		<h2 id="estrutura" class="mb-3 text-base font-semibold text-surface-900 dark:text-surface-50">
			Estrutura e patrimônio
		</h2>
		<ul class="space-y-2">
			<li class="flex items-baseline justify-between gap-3 text-sm">
				<span class="text-surface-600 dark:text-surface-400">Xadrezes</span>
				<span class="font-semibold tabular-nums text-surface-900 dark:text-surface-50"
					>{u.xadrezes}</span
				>
			</li>
			<li class="flex items-baseline justify-between gap-3 text-sm">
				<span class="text-surface-600 dark:text-surface-400">Tira-gravame</span>
				<span class="font-semibold text-surface-900 dark:text-surface-50"
					>{u.tira_gravame ? 'Sim' : 'Não'}</span
				>
			</li>
			{#each PREVISTOS as p (p.campo)}
				<li class="flex items-baseline justify-between gap-3 text-sm">
					<span class="text-surface-600 dark:text-surface-400">{p.campo}</span>
					<span class="shrink-0 text-2xs text-surface-400 uppercase">{p.fase}</span>
				</li>
			{/each}
		</ul>
	</section>
</div>

{#if data.municipios.length > 0}
	<section
		class="card-elevated mt-4 rounded-2xl p-5"
		aria-labelledby="municipios-titulo"
		id="municipios"
	>
		<h2
			id="municipios-titulo"
			class="mb-1 text-base font-semibold text-surface-900 dark:text-surface-50"
		>
			Municípios atendidos
		</h2>
		<p class="mb-3 text-xs text-surface-500">
			{data.municipios.length} município{data.municipios.length === 1
				? ''
				: 's'}{#if data.populacaoAtendida > 0}
				· {new Intl.NumberFormat('pt-BR').format(data.populacaoAtendida)} habitantes{/if}{#if data.habPorPolicial != null}
				· 1 policial para {new Intl.NumberFormat('pt-BR').format(data.habPorPolicial)} hab.{/if}; o
			plantão é por município e pode mudar no fim de semana.
		</p>
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Município</th>
						<th>AIS</th>
						<th class="text-right">População</th>
						<th>Plantão na semana</th>
						<th>Plantão no fim de semana</th>
					</tr>
				</thead>
				<tbody>
					{#each data.municipios as m (m.ibge)}
						<tr>
							<td class="font-medium">{m.nome}</td>
							<td class="text-sm">{m.ais || '—'}</td>
							<td class="text-right text-sm tabular-nums"
								>{m.populacao != null
									? new Intl.NumberFormat('pt-BR').format(m.populacao)
									: '—'}</td
							>
							<td class="text-sm">{plantao(m.semana)}</td>
							<td class="text-sm">{plantao(m.fds)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}

{#if data.filhas.length > 0}
	<section class="card-elevated mt-4 rounded-2xl p-5" aria-labelledby="vinculadas">
		<h2 id="vinculadas" class="mb-3 text-base font-semibold text-surface-900 dark:text-surface-50">
			Unidades vinculadas
		</h2>
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Unidade</th>
						<th class="text-right">DPC ativos</th>
						<th class="text-right">OIP ativos</th>
						<th class="text-right">Férias</th>
						<th class="text-right">Afastados</th>
						<th class="text-right">Lotados</th>
					</tr>
				</thead>
				<tbody>
					{#each data.filhas as f (f.id)}
						<tr>
							<td>
								<a href="/unidade/{f.id}" class="font-medium no-underline hover:text-primary-700"
									>{f.nome}</a
								>
								<span class="ml-2 text-2xs text-surface-500 uppercase">{f.tipoRotulo}</span>
							</td>
							<td class="text-right tabular-nums">{f.efetivo.dpc.ativos}</td>
							<td class="text-right tabular-nums">{f.efetivo.oip.ativos}</td>
							<td class="text-right tabular-nums">{f.efetivo.dpc.ferias + f.efetivo.oip.ferias}</td>
							<td class="text-right tabular-nums"
								>{f.efetivo.dpc.afastados + f.efetivo.oip.afastados}</td
							>
							<td class="text-right font-semibold tabular-nums">{f.efetivo.total}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}

<ModalEfetivo bind:open={painelAberto} {pedido} />
