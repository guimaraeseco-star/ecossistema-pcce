/**
 * Datas e calendário no padrão brasileiro — puro, compartilhado por servidor E
 * cliente (sem import de `$lib/server`, sem acesso a banco, sem estado).
 *
 * Duas convenções do projeto que valem para todo o arquivo:
 *
 * - **Data é string `YYYY-MM-DD`**, não `Date` — e a regra que importa é NÃO
 *   MISTURAR CONVENÇÃO dentro de uma mesma função. Quem só EXIBE concatena
 *   `'T00:00:00'` para ler em horário local (sem isso a string é lida como UTC
 *   e, em UTC-3, "2026-01-15" vira 14/01 na tela). Quem faz ARITMÉTICA de data
 *   fica inteiro em UTC (`Date.UTC` → `setUTCDate` → `toISOString`), porque ali
 *   não existe "agora" e nenhum fuso deveria entrar na conta. Ler em local e
 *   devolver com `toISOString()` é o erro que se compensa em UTC-3 e quebra em
 *   fuso positivo;
 * - **entrada inválida devolve valor neutro** (`''`, a própria entrada, 0), sem
 *   lançar. São funções chamadas em meio a markup e a laços de formatação, onde
 *   uma exceção derrubaria a tela inteira por causa de um campo vazio.
 */

/**
 * Formata uma data no formato "YYYY-MM-DD" para "DD/MM/YYYY".
 *
 * Entrada fora do formato volta COMO VEIO. A versão anterior devolvia
 * `"undefined/undefined/abc"` nesse caso — e esta função escreve dentro de PDF,
 * DOCX e XLSX, então o valor cru é sempre menos ruim que a palavra `undefined`
 * num documento oficial.
 */
export function formatarData(dateStr: string): string {
	if (!dateStr) return '';
	const [ano, mes, dia] = dateStr.split('-');
	if (!ano || !mes || !dia) return dateStr;
	return `${dia}/${mes}/${ano}`;
}

/**
 * Data e hora no fuso de Brasília, no formato pt-BR (`01/08/2026, 14:30:00`).
 * Devolve `''` para entrada inválida, deixando o fallback a cargo do chamador.
 *
 * O `timeZone` explícito é obrigatório e não é preciosismo: o Worker roda em
 * UTC, então sem ele o termo de presença, o PDF de auditoria e o carimbo do
 * relatório exibiriam três horas a menos — o horário em que nada aconteceu.
 * Estava reimplementado inline em quatro geradores de documento.
 */
/**
 * Dia e mês de uma data ISO `YYYY-MM-DD`, sem o ano (`05/08`).
 *
 * Rótulo curto de calendário e de tabela de plantão, onde o ano já está no
 * cabeçalho. Estava copiada em três componentes de escala.
 */
export function formatarDiaMes(iso: string): string {
	const [, mes, dia] = iso.split('-');
	return `${dia}/${mes}`;
}

export function dataHoraBrasilia(entrada: string | Date): string {
	const d = typeof entrada === 'string' ? new Date(entrada) : entrada;
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Retorna a data do dia seguinte no formato "YYYY-MM-DD". */
function proximoDia(dateStr: string): string {
	return adicionarDias(dateStr, 1);
}

/**
 * Retorna a data de saída efetiva: se horaSaida ≤ horaEntrada, avança um dia.
 * Hora vazia conta como meia-noite ('00'); com ambas vazias, mantém a data.
 * Implementação ÚNICA — `$lib/rotacao` re-exporta daqui (achado D1 do antigo ARQUIVOS.md — ver docs/HISTORICO.md).
 */
export function calcularDataSaida(
	dataInicio: string,
	horaEntrada: string,
	horaSaida: string
): string {
	if (!horaEntrada && !horaSaida) return dataInicio;
	const he = parseInt(horaEntrada.split(':')[0] || '0', 10);
	const hs = parseInt(horaSaida.split(':')[0] || '0', 10);
	return hs <= he ? proximoDia(dataInicio) : dataInicio;
}

/**
 * Nomes dos meses em português, índice 0 = Janeiro (mesma base de
 * `Date.getMonth()`). Para mês 1-12 vindo do banco/URL, use `MESES_PT[mes - 1]`.
 *
 * Fonte única: a lista estava redeclarada em 13 arquivos (calendários, tabelas,
 * PDFs, painel de compliance) com nomes diferentes (MESES, MESES_PT, MESES_CAL).
 */
export const MESES_PT = [
	'Janeiro',
	'Fevereiro',
	'Março',
	'Abril',
	'Maio',
	'Junho',
	'Julho',
	'Agosto',
	'Setembro',
	'Outubro',
	'Novembro',
	'Dezembro'
] as const;

/**
 * Rótulo de um fim de semana na listagem de compliance/painel:
 * `FDS DD/MM–DD/MM`, a partir das pontas ISO (`YYYY-MM-DD`).
 */
export function labelFds(inicioISO: string, fimISO: string): string {
	const ddmm = (iso: string) => {
		const [, mes, dia] = iso.split('-');
		return `${dia}/${mes}`;
	};
	return `FDS ${ddmm(inicioISO)}–${ddmm(fimISO)}`;
}

/**
 * Dias da semana abreviados, índice 0 = domingo (base de `Date.getDay()`).
 * Também estava redeclarado em 6 arquivos (calendários e formatadores).
 */
export const DIAS_SEMANA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

/** Dias da semana por extenso, índice 0 = domingo. */
const DIAS_SEMANA_EXTENSO = [
	'Domingo',
	'Segunda-feira',
	'Terça-feira',
	'Quarta-feira',
	'Quinta-feira',
	'Sexta-feira',
	'Sábado'
] as const;

/**
 * O dia da semana por extenso de uma data ISO — "Terça-feira".
 *
 * O plano operacional imprime isto ao lado da data na capa. Existe além de
 * `diaSemana` (`$lib/gise/formatters`, que devolve "Ter") porque documento
 * oficial não abrevia.
 *
 * A conta sai de `Date.UTC` + `getUTCDay`, sem string local no caminho: é
 * aritmética de calendário pura, e o resultado não depende de fuso nem de como
 * a engine resolve um horário local inexistente numa virada de horário de
 * verão. Mesmo raciocínio de `$lib/planos/horas-extras`.
 */
export function diaSemanaExtenso(iso: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
	const [ano, mes, dia] = iso.split('-').map(Number);
	return DIAS_SEMANA_EXTENSO[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()];
}

/**
 * Opções de mês para `<select>`, na ordem 1-12, com uma entrada inicial "Todos"
 * (valor 0). `valorTexto` devolve os valores como string (formulários que
 * comparam com `string`).
 */
export function opcoesMeses(): Array<{ value: number; label: string }>;
export function opcoesMeses(valorTexto: true): Array<{ value: string; label: string }>;
export function opcoesMeses(valorTexto = false) {
	const todos = valorTexto ? { value: 'todos', label: 'Todos' } : { value: 0, label: 'Todos' };
	return [
		todos,
		...MESES_PT.map((label, i) => ({ value: valorTexto ? String(i + 1) : i + 1, label }))
	];
}

/**
 * Monta a data ISO `YYYY-MM-DD` a partir de ano, mês e dia.
 *
 * **`mes` é 1–12**, como no banco e como se fala — não o 0–11 de
 * `Date.getMonth()`. Quem vem de um `Date` passa `d.getMonth() + 1`, e o `+ 1`
 * fica visível no call site de propósito: existiam cinco cópias desta função
 * espalhadas pelos calendários, metade com base 0 e metade com base 1, e a
 * diferença só aparecia como data errada de um mês.
 *
 * Constrói a string diretamente, sem passar por `Date`: `toISOString()` converte
 * para UTC e, em UTC-3, devolveria o dia anterior.
 */
export function isoData(ano: number, mes: number, dia: number): string {
	return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Quantos dias tem o mês (`mes` 1–12). Dia 0 do mês seguinte é o último deste. */
export function diasNoMes(ano: number, mes: number): number {
	return new Date(ano, mes, 0).getDate();
}

/**
 * Formata uma data por extenso. Ex: "01 de Janeiro de 2025".
 */
export function formatarDataExtenso(date: Date): string {
	const d = date.getDate();
	const m = MESES_PT[date.getMonth()];
	const a = date.getFullYear();
	return `${String(d).padStart(2, '0')} de ${m} de ${a}`;
}

/**
 * Soma `dias` a uma data ISO `YYYY-MM-DD` e devolve o resultado no mesmo
 * formato. Aceita valores negativos. Retorna a entrada se ela for inválida.
 *
 * A conta inteira roda em UTC — `Date.UTC` para entrar, `setUTCDate` para
 * somar, `toISOString` para sair. Não é preciosismo: a versão anterior lia a
 * data em horário LOCAL (`iso + 'T00:00:00'`) e a devolvia em UTC, misturando
 * as duas convenções na mesma função. Em UTC-3 as pontas se compensavam e
 * ninguém via; em qualquer fuso POSITIVO o resultado voltava um dia — a ponto
 * de `adicionarDias(x, 1)` devolver o próprio `x`.
 *
 * Como aqui não existe noção de "agora", nenhum fuso deveria participar do
 * cálculo, e agora nenhum participa.
 */
export function adicionarDias(iso: string, dias: number): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
	const [ano, mes, dia] = iso.split('-').map(Number);
	const d = new Date(Date.UTC(ano, mes - 1, dia));
	d.setUTCDate(d.getUTCDate() + dias);
	return d.toISOString().slice(0, 10);
}

/**
 * Todas as datas de `inicio` a `fim`, INCLUSIVE, em `YYYY-MM-DD`.
 *
 * Devolve `[]` quando `fim < inicio` ou quando alguma data é inválida — nunca
 * lança e nunca entra em laço infinito.
 *
 * Existiam três cópias deste laço (a lista de FDS, a grade da escala e o
 * `getDaysInRange` do servidor), todas construindo `new Date(iso+'T00:00:00')`
 * e devolvendo `toISOString()`: local na entrada, UTC na saída. Aqui não há
 * `Date` nenhum — comparação de string ISO é lexicográfica, e a soma vem de
 * `adicionarDias`, que já é independente de fuso.
 */
export function intervaloDeDatas(inicio: string, fim: string): string[] {
	const ISO = /^\d{4}-\d{2}-\d{2}$/;
	if (!ISO.test(inicio) || !ISO.test(fim)) return [];
	const dias: string[] = [];
	let cur = inicio;
	while (cur <= fim) {
		dias.push(cur);
		cur = adicionarDias(cur, 1);
	}
	return dias;
}

/**
 * Hoje em `YYYY-MM-DD`, no fuso DO APARELHO. Para uso no NAVEGADOR.
 *
 * `new Date().toISOString().slice(0,10)` devolveria a data em UTC: das 21h à
 * meia-noite no horário de Brasília, "hoje" já é amanhã em UTC. Era o defeito
 * em duas cópias de `hoje()` (os modais de data da GISE), quebrando três horas
 * por dia no fuso da corporação.
 *
 * NÃO use no servidor. O Worker roda em UTC, onde "local" não é o fuso de
 * ninguém — lá a data de hoje precisa do offset de Brasília explícito.
 */
/**
 * Devolve a data se ela for `YYYY-MM-DD`; `null` caso contrário.
 *
 * Para parâmetro de URL, que é entrada de fora: `?inicio=abc` não pode virar
 * predicado SQL nem janela silenciosamente vazia. O chamador decide o default
 * quando vem `null` — validar e defaultar são decisões diferentes.
 *
 * Só valida a FORMA. `2026-13-45` passa aqui e o SQLite simplesmente não casa
 * nenhuma linha, que é o comportamento certo para filtro: recorte vazio, não
 * erro. Quem precisa de data existente usa `new Date` e confere.
 *
 * Nasceu inline em `/operacoes/presenca` (SEC-08) e virou função no segundo call site,
 * a janela do painel de produtividade (B-1).
 */
export function dataISOValida(v: string | null | undefined): string | null {
	return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function hojeLocalISO(): string {
	const d = new Date();
	return isoData(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Hoje em `YYYY-MM-DD` no fuso de Brasília (UTC-3). Para uso no SERVIDOR.
 *
 * O Worker roda em UTC: `hojeLocalISO()` seguiria o relógio do isolate, não o
 * da corporação. `getNowBR()` desloca 3h e o `toISOString().slice(0, 10)`
 * daí é a data civil de Fortaleza — o par server de `hojeLocalISO`.
 */
export function hojeBrasilISO(): string {
	return getNowBR().toISOString().slice(0, 10);
}

/**
 * Agora em `YYYY-MM-DDTHH:MM:SS` no fuso de Brasília — o carimbo de "atualizado
 * em" que o servidor grava em texto (mesma forma do `datetime('now', '-3 hours')`
 * do SQLite, com o `T`).
 */
export function agoraBrasilISO(): string {
	return getNowBR().toISOString().slice(0, 19);
}

/**
 * Diferença INCLUSIVA em dias entre duas datas ISO (`fim` >= `inicio`):
 * "2026-01-01" a "2026-01-01" = 1 dia. Retorna 0 se as datas forem inválidas
 * ou se `fim` < `inicio`.
 */
export function diffDiasInclusivo(inicio: string, fim: string): number {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) return 0;
	const ms = new Date(fim + 'T00:00:00').getTime() - new Date(inicio + 'T00:00:00').getTime();
	if (ms < 0) return 0;
	return Math.round(ms / 86_400_000) + 1;
}

/**
 * Retorna a data/hora atual ajustada para o fuso de Brasília/Fortaleza (UTC-3).
 * Útil para ambientes como Cloudflare Workers que operam em UTC.
 */
export function getNowBR(): Date {
	return new Date(Date.now() - 3 * 3600 * 1000);
}
