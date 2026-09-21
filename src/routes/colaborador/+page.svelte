<script lang="ts">
	/**
	 * A área do colaborador. Com lotação e chaves liberadas pela unidade (E61)
	 * mostra os atalhos do que ele pode; sem elas, diz isso em vez de mostrar
	 * uma grade vazia. Nada aqui decide acesso — a lista é a mesma que o portão
	 * de rotas confere.
	 *
	 * Um cartão por DESTINO, não por chave (pedido dele, 21/09): as três
	 * chaves de servidores acontecem na mesma ficha, então viram uma linha
	 * dentro do cartão "Servidores"; férias tem destino próprio (o panorama
	 * da unidade). Os cartões são os MESMOS do Início dos servidores
	 * (`HomeCartaoModulo`, azul de gestão) — decisão dele: um padrão só.
	 */
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import HomeCartaoModulo from '../_components/HomeCartaoModulo.svelte';
	import type { CartaoHome } from '../_components/home-modulos';
	import { ICONE } from '$lib/constants/icones';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);
	const tem = (chave: string) => data.acessos.some((a) => a.chave === chave && a.liberado);
	const porCartao = $derived((page.data.avisosResumo?.porCartao ?? {}) as Record<string, number>);

	/** O que ele pode fazer na ficha do servidor — a linha do cartão. */
	const naFicha = $derived(
		[
			tem('servidores.ver') ? 'ver a ficha' : null,
			tem('servidores.cadastro') ? 'propor alteração de cadastro' : null,
			tem('servidores.afastamento') ? 'propor afastamento e retorno antecipado' : null,
			tem('servidores.ferias') ? 'lançar e reprogramar férias' : null
		].filter((x): x is string => !!x)
	);

	const cartoes = $derived<CartaoHome[]>(
		(
			[
				tem('servidores.ver')
					? {
							id: 'servidores',
							titulo: 'Servidores',
							descricao: `Lista e ficha dos servidores lotados na unidade. Você pode: ${naFicha.join(' · ')}.`,
							icone: ICONE.pessoas,
							href: '/servidores',
							cta: 'Ver servidores',
							atalhos: []
						}
					: null,
				tem('servidores.ferias')
					? {
							id: 'ferias',
							titulo: 'Férias',
							descricao:
								'Quem está de férias em cada mês na unidade: o teto de 15 % do 1º período, os pedidos na COGEP e os abonos sem ciência.',
							icone: ICONE.calendario,
							href: '/ferias',
							cta: 'Ver as férias',
							atalhos: []
						}
					: null,
				tem('escalas.ver')
					? {
							id: 'escalas',
							titulo: 'Escalas ordinárias',
							descricao:
								'Só leitura das escalas de plantão e expediente da unidade — não monta nem altera.',
							icone: ICONE.calendario,
							href: '/colaborador/escalas',
							cta: 'Ver escalas',
							atalhos: []
						}
					: null,
				tem('avisos.ler')
					? {
							id: 'avisos',
							titulo: 'Avisos',
							descricao: 'A caixa de avisos e pendências da unidade; você pode marcar como lido.',
							icone: ICONE.sino,
							href: '/avisos',
							cta: 'Abrir a caixa',
							atalhos: []
						}
					: null
			] as (CartaoHome | null)[]
		).filter((c): c is CartaoHome => !!c)
	);
</script>

<svelte:head>
	<title>Colaborador | Ecossistema PCCE</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho
		modulo="Área do colaborador"
		{usuario}
		descricao={data.unidade
			? `Lotado(a) na ${data.unidade.nome}${usuario.vinculo ? ` · ${usuario.vinculo}` : ''}. O que você pode fazer aqui é definido pela unidade.`
			: `${usuario.vinculo ? `Conta vinculada a ${usuario.vinculo}. ` : ''}Você ainda não está lotado(a) em uma unidade — o Administrador Geral faz esse vínculo.`}
		accent="primary"
	/>

	{#if data.unidade && cartoes.length > 0}
		<div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each cartoes as cartao (cartao.id)}
				<HomeCartaoModulo
					{cartao}
					avisos={cartao.id === 'avisos'
						? (page.data.avisosResumo?.total ?? 0)
						: (porCartao[cartao.id] ?? 0)}
				/>
			{/each}
		</div>
	{:else}
		<div
			class="mt-6 p-5 rounded-2xl border border-surface-200 dark:border-white/10 bg-surface-100/50 dark:bg-surface-800/50 text-sm text-surface-600 dark:text-surface-400"
		>
			{#if data.unidade}
				A {data.unidade.nome} ainda não liberou nenhuma ação para esta conta. Quando o admin da unidade
				marcar o que você pode fazer, os atalhos aparecem aqui.
			{:else}
				Nenhuma ação liberada para esta conta ainda. Quando você for lotado(a) em uma unidade e ela
				liberar o que você pode fazer, os atalhos aparecem aqui.
			{/if}
		</div>
	{/if}
</BemVindoPagina>
