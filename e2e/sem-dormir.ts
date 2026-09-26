/**
 * Mantém o Windows acordado enquanto a suíte e2e roda — e só enquanto ela roda.
 *
 * Nasceu de uma corrida de 25/09 que levou 5,4 horas em vez de 33 minutos: o
 * notebook entrou em espera moderna um minuto e meio depois de a suíte começar
 * e ficou lá das 16:03 às 20:36. Em espera, o Windows põe os processos em câmera
 * lenta; a suíte não parou, e cada teste que estava no meio de um passo quando a
 * máquina cochilou estourou os 30 segundos. Seis "falhas", nenhuma de código.
 *
 * O pedido é feito pela API do próprio Windows (`SetThreadExecutionState`), que
 * existe para isto: um programa avisa "não durma enquanto eu trabalho". Ele NÃO
 * muda nenhuma configuração de energia do usuário, e acaba sozinho quando o
 * processo que o fez termina — é a garantia de que uma suíte que morre no meio
 * não deixa a máquina acordada para sempre.
 *
 * `ES_DISPLAY_REQUIRED` entra de propósito, e não só `ES_SYSTEM_REQUIRED`: nos
 * notebooks com espera moderna, é o APAGAR DA TELA que leva à espera, e o
 * pedido de "sistema" sozinho não segura a máquina depois disso. O custo é a
 * tela acesa durante a suíte.
 *
 * O que ele não impede: fechar a tampa. Isso continua mandando dormir, porque é
 * uma ordem do usuário, não ociosidade — e deve continuar.
 */
import { spawn } from 'node:child_process';

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;
const ES_DISPLAY_REQUIRED = 0x00000002;

/**
 * Sobe um PowerShell que faz o pedido e espera o processo `paiPid` terminar.
 *
 * O pedido vale para a THREAD que o fez, e some quando ela morre. Por isso o
 * PowerShell fica vivo, parado em `Wait-Process`, exatamente o tempo de vida do
 * runner do Playwright — nem um minuto a mais.
 *
 * **NÃO destacar o filho** (`detached: false`), e isso foi medido, não
 * suposto. No Windows, o libuv põe todo filho NÃO destacado num job object com
 * `KILL_ON_JOB_CLOSE`: quando o runner morre — inclusive morto à força —, o
 * próprio Windows encerra o PowerShell, e o pedido acaba junto. Na conferência
 * de 25/09 o PowerShell morreu sem imprimir a linha seguinte ao `Wait-Process`,
 * ou seja, foi o job que o matou; o `Wait-Process` fica como segunda linha de
 * defesa. E com `detached: true` o PowerShell NEM CHEGAVA A RODAR: não
 * imprimia nem a primeira linha, e o pedido nunca era feito — a primeira
 * versão deste arquivo passava por funcionando sem funcionar.
 *
 * Fora do Windows, ou na CI, não faz nada: o runner do GitHub não dorme, e lá
 * não há o que segurar.
 */
export function manterAcordadoEnquantoVivo(paiPid: number = process.pid): void {
	if (process.platform !== 'win32' || process.env.CI) return;

	const flags = (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED) >>> 0;
	const script = [
		'Add-Type -Namespace SemDormir -Name Api -MemberDefinition \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);\'',
		`[void][SemDormir.Api]::SetThreadExecutionState(${flags})`,
		`Wait-Process -Id ${paiPid} -ErrorAction SilentlyContinue`
	].join('; ');

	try {
		const filho = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
			detached: false,
			stdio: 'ignore',
			windowsHide: true
		});
		// Sem `unref`, o runner esperaria o PowerShell para sair — e o PowerShell
		// espera o runner. Cada um segurando o outro. Com `unref`, o runner sai
		// quando quiser, e o job object encerra o PowerShell na saída.
		filho.unref();
		console.log('[e2e] pedido ao Windows para não dormir durante a suíte.');
	} catch (err) {
		// Não ter o pedido não é motivo para a suíte não rodar: só avisa.
		console.warn('[e2e] não consegui pedir ao Windows para não dormir:', err);
	}
}
