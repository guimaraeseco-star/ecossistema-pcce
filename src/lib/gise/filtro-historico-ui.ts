/**
 * Tokens visuais das barras de filtro do projeto.
 *
 * A régua é a caixa de `/operacoes/produtividade`: contorno 1px `surface-200`, fundo da
 * folha, rótulo `text-3xs` e campo `text-xs` / `py-2.5`. A busca detalhada do
 * histórico GISE (`/operacoes/presenca`, `/operacoes/gise/finalizadas`) e as listagens reusam estes
 * tokens para não voltar o drift de `h-11` / `text-sm` / fundo cinza.
 */

export const OPCOES_TIPO_EQUIPE = [
	['', 'Todos'],
	['operacional', 'Operacional'],
	['seint', 'SEINT']
] as const;

export const OPCOES_PERIODO = [
	['ciclo', 'Ciclo'],
	['mes', 'Mês'],
	['data', 'Data específica']
] as const;

/** "Data específica" não cabe no segmento do telefone; o campo abaixo já diz o nome. */
export const ROTULO_PERIODO_DATA_MOBILE = 'Data';

/** Título da barra ("Filtros", "Busca detalhada"), fora da caixa. */
export const CLASSE_TITULO_FILTRO =
	'text-xs font-bold uppercase tracking-widest text-surface-400 dark:text-surface-500';

export const CLASSE_ROTULO_FILTRO =
	'text-3xs font-black uppercase tracking-widest text-surface-400 dark:text-surface-500 pl-0.5';

/** Contorno e fundo da caixa — sem padding, para o slide de `/operacoes/produtividade`. */
export const CLASSE_CAIXA_FILTRO_CROMO =
	'rounded-2xl sm:rounded-3xl border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900';

/** Só o chrome da caixa — listagens que já têm o próprio `flex`/`grid` por dentro. */
export const CLASSE_CAIXA_FILTRO = `${CLASSE_CAIXA_FILTRO_CROMO} p-3 sm:p-5`;

/** Form GET de `/auditoria` e `/auditoria/logs` — a visibilidade (`grid` / `hidden lg:grid`) fica no call site. */
export const CLASSE_FORM_FILTRO_GET = `${CLASSE_CAIXA_FILTRO} grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3`;

export const CLASSE_BARRA_FILTRO = `${CLASSE_CAIXA_FILTRO} flex flex-col sm:flex-row sm:flex-wrap xl:flex-nowrap sm:items-end gap-3 sm:gap-4`;

/** Override do input interno do `SearchableSelect` na barra de filtros. */
export const CLASSE_INPUT_SEARCHABLE = '[&_input]:!px-3 [&_input]:!py-2.5 [&_input]:!text-xs';

export const CLASSE_CAMPO_FILTRO = 'flex w-full min-w-0 flex-col gap-1.5 sm:w-auto sm:shrink-0';

export const CLASSE_INPUT_FILTRO =
	'box-border block min-w-0 px-3 py-2.5 text-xs font-bold rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:ring-2 focus:ring-primary-500 transition-all';

/**
 * Campo Ciclo (ano + número). Pode encolher: o `<select>` nativo toma a
 * largura do option mais longo ("Ciclo 9  (21/Ago – 20/Set)") e, com
 * `sm:shrink-0` + `xl:flex-nowrap`, fura a barra. O fechado recorta; o
 * dropdown aberto continua com o texto inteiro.
 */
export const CLASSE_CAMPO_CICLO = 'flex w-full min-w-0 flex-col gap-1.5 sm:w-auto sm:min-w-0';

export const CLASSE_LINHA_CICLO = 'flex w-full min-w-0 items-center gap-1.5';

/** Ano YYYY. Quatro dígitos cabem em 5.5rem com o padding do input. */
export const CLASSE_SELECT_ANO_CICLO = `${CLASSE_INPUT_FILTRO} w-[5.5rem] shrink-0`;

/**
 * Envelope do número do ciclo: largura teto + `overflow-hidden`. Sem o
 * envelope, `width` no `<select>` perde para o min-content das options.
 */
export const CLASSE_ENVOLVE_SELECT_CICLO = 'min-w-0 w-[12rem] max-w-[12rem] shrink overflow-hidden';

export const CLASSE_SELECT_NUMERO_CICLO = `${CLASSE_INPUT_FILTRO} w-full max-w-full truncate [field-sizing:fixed]`;

export const CLASSE_SELETOR_SEGMENTO = 'w-full sm:w-fit';

/** Trilho do segmento em largura cheia (cargo em `/servidores`). */
export const CLASSE_CONTROLE_SEGMENTO_LARGO =
	'inline-flex items-center w-full min-w-0 overflow-hidden rounded-xl bg-surface-100 dark:bg-surface-800 p-1 gap-0.5';

export const CLASSE_CONTROLE_SEGMENTO = `${CLASSE_CONTROLE_SEGMENTO_LARGO} sm:w-fit`;

/** Item que divide o trilho em partes iguais. */
export const CLASSE_ITEM_SEGMENTO_LARGO =
	'flex flex-1 min-w-0 items-center justify-center px-3 py-1.5 text-center text-xs font-bold leading-tight whitespace-nowrap rounded-lg cursor-pointer select-none transition-colors duration-200 text-surface-600 dark:text-surface-400 data-[state=checked]:bg-primary-500 data-[state=checked]:text-white data-[state=checked]:shadow-md data-[state=checked]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200';

export const CLASSE_ITEM_SEGMENTO = `${CLASSE_ITEM_SEGMENTO_LARGO} sm:flex-none`;
