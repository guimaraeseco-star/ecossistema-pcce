/**
 * Barrel dos composables — e SÓ de composables.
 *
 * O critério é o nome: entra aqui o que é `use*` (estado reativo com runes) ou
 * o predicado que acompanha um deles. Nada mais, mesmo que as mesmas telas
 * importem as duas coisas.
 *
 * A regra existe porque a linha 2 deste arquivo já reexportou
 * `getSavedFilters` de `$lib/utils/localStorage`, e as cinco telas que a usam
 * (`escalas`, `policiais`, `painel`, `recebidos`, `unidades`) passaram a
 * importá-la daqui. O call site então dizia algo ERRADO: sugeria estado
 * reativo onde há um leitor síncrono de `localStorage`, lido uma vez na
 * montagem. Era o mesmo defeito que motivou desmontar o barrel de
 * `$lib/utils/` (ver `CLAUDE.md`), reintroduzido em miniatura — reexportar de
 * fora do diretório é justamente o que apaga a procedência.
 *
 * Se a função não mora nesta pasta, ela não sai por este arquivo.
 */
export { useAutorizacao } from './useAutorizacao.svelte';
export { useConfirmationDialog } from './useConfirmationDialog.svelte';
export { useMultiSelect } from './useMultiSelect.svelte';
export { useCharts } from './useCharts.svelte';
export { useMobile, useLarguraDesktop } from './useMobile.svelte';
export { useAssinaturaEscala } from './useAssinaturaEscala.svelte';
export { useScrollLock } from './useScrollLock.svelte';
export { useFiltrosPaginados } from './useFiltrosPaginados.svelte';
export { useVerificacaoEmailPessoal } from './useVerificacaoEmailPessoal.svelte';
export { useBuscaDebounce } from './useBuscaDebounce.svelte';
export { useInvalidateOnFocus } from './useInvalidateOnFocus.svelte';
export { useSamePathNavigating } from './useSamePathNavigating.svelte';
export { useOrigemDaNavegacao, registrarNavegacao } from './useOrigemDaNavegacao.svelte';
