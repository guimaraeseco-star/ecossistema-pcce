<script lang="ts">
	/**
	 * Página inicial do módulo de escalas — o que cada usuário vê ao entrar.
	 *
	 * **Os quadros não moram mais aqui.** Eles vêm de `cardsBemVindoDaPagina`,
	 * derivados das MESMAS flags que montam a navegação lateral
	 * (`_components/bem-vindo-cards.ts`). Antes eram uma lista escrita à mão, e
	 * ela divergiu do menu: admin de unidade e de seccional tinham
	 * "Produtividade" na barra e nenhum card, "Dados base" não existia em card
	 * nenhum, e o Admin Geral com os dois módulos ligados via 7 destinos na barra
	 * contra 4 cards. Agora um destino sem card reprova no teste de paridade.
	 *
	 * O que ficou: a `descricao` do cabeçalho, que é o único texto que depende do
	 * papel sem ser um card. O portal atende papéis com atribuições OPOSTAS —
	 * DPC confere e assina, OIP cria e solicita a assinatura (é o servidor que
	 * separa, em `server/escalas/permissao.ts`) — e a frase de entrada precisa
	 * dizer a que veio.
	 */
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import BemVindoPagina from '$lib/components/bem-vindo/BemVindoPagina.svelte';
	import BemVindoCabecalho from '$lib/components/bem-vindo/BemVindoCabecalho.svelte';
	import BemVindoGradeAcoes from '$lib/components/bem-vindo/BemVindoGradeAcoes.svelte';
	import { cardsBemVindoDaPagina } from '../../_components/bem-vindo-cards';

	const { data }: PageProps = $props();
	const usuario = $derived(data.usuario);

	const acoes = $derived(cardsBemVindoDaPagina(usuario, page.data));

	const isDpc = $derived(usuario?.cargo === 'DPC');
	const local = $derived(
		usuario?.papel === 'admin_seccional' ? 'da sua seccional' : 'da sua unidade'
	);
	const isSubAdmin = $derived(
		usuario?.papel === 'admin_seccional' || usuario?.papel === 'admin_unidade'
	);

	const descricao = $derived.by(() => {
		if (usuario?.tipo === 'admin') {
			return 'Você está no ambiente de gestão de escalas do Ecossistema PCCE. Use as áreas abaixo para acompanhar a conformidade das escalas e cuidar do que chega na caixa de entrada.';
		}
		if (isSubAdmin && isDpc) {
			return `Você está no ambiente ${local}. Aqui você confere e assina as escalas de plantão e expediente, e acompanha o que ainda está pendente.`;
		}
		if (usuario?.papel === 'admin_seccional') {
			return 'Você está no ambiente administrativo da seccional. Monte e envie as escalas ordinárias, acompanhe as assinaturas e cuide da escalação para as operações extraordinárias.';
		}
		if (usuario?.papel === 'admin_unidade') {
			return 'Você está no ambiente administrativo da sua unidade. Monte as escalas de plantão, expediente e fim de semana, e peça ao delegado a assinatura de cada uma.';
		}
		return 'Você está no ambiente de gestão de escalas do Ecossistema PCCE. Use as áreas abaixo para acompanhar as escalas da sua unidade.';
	});
</script>

<svelte:head>
	<title>Bem-vindo às Escalas | Ecossistema PCCE</title>
</svelte:head>

<BemVindoPagina>
	<BemVindoCabecalho modulo="Módulo de Escalas" {usuario} {descricao} accent="primary" />

	<BemVindoGradeAcoes {acoes} accent="primary" />
</BemVindoPagina>
