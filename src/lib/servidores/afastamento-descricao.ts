/**
 * A frase de um afastamento — "LTS de 15/09/2026 a 29/09/2026" — para a
 * recusa ao escalar e para a faixa "escala desfalcada". Mora em `lib/` (e não
 * em `lib/db/`) porque a faixa a lê no navegador.
 */
import { rotuloAfastamento } from './afastamentos';

/** O período e o que é, em português. */
export function descreverAfastamento(a: {
	subtipo: string;
	data_inicio: string;
	data_fim: string | null;
}): string {
	const de = a.data_inicio.split('-').reverse().join('/');
	const ate = a.data_fim ? a.data_fim.split('-').reverse().join('/') : null;
	return `${a.subtipo === 'ferias' ? 'férias' : rotuloAfastamento(a.subtipo)} de ${de}${ate ? ` a ${ate}` : ' (em aberto)'}`;
}
