<script lang="ts">
	/**
	 * O selo de estado de uma solicitação — pendente, aprovada ou rejeitada.
	 *
	 * Vive em `$lib/components/` porque as duas pontas do fluxo o mostram: a ficha
	 * do servidor (`/servidores/[id]`, onde o administrador acompanha o que pediu) e
	 * a fila de decisão (`/solicitacoes`, do Admin Geral). Não são rotas irmãs nem
	 * pai e filha, então não há `_components/` que as cubra.
	 *
	 * A cor É a informação: verde e vermelho separam "entrou no cadastro" de "não
	 * entrou", e é a única coisa que quem varre a lista lê de longe.
	 */
	const { status }: { status: string } = $props();

	const ESTILO: Record<string, { rotulo: string; classe: string }> = {
		aprovada: {
			rotulo: 'Aprovada',
			classe: 'bg-success-500/15 text-success-700 dark:text-success-400'
		},
		rejeitada: {
			rotulo: 'Rejeitada',
			classe: 'bg-error-500/15 text-error-700 dark:text-error-400'
		},
		pendente: {
			rotulo: 'Pendente',
			classe: 'bg-warning-500/15 text-warning-700 dark:text-warning-400'
		}
	};

	const estilo = $derived(ESTILO[status] ?? ESTILO.pendente);
</script>

<span class="text-3xs font-bold uppercase px-2 py-0.5 rounded {estilo.classe}">
	{estilo.rotulo}
</span>
