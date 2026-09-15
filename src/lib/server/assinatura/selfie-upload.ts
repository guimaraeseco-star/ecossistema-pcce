/**
 * Upload de selfie/foto biométrica para o R2 com validação defensiva.
 *
 * Aplicado a quatro caminhos: presença GISE (entrada e saída), assinatura
 * simples GISE e assinatura simples de relatório extraordinário. Antes,
 * cada um repetia o mesmo bloco com 3 fraquezas:
 *
 *  1. Confiança no prefixo `data:image/...` — atacante podia mandar
 *     `data:image/jpeg;base64,<bytes_de_qualquer_coisa>` e o R2 guardava
 *     tranquilamente. Agora checamos os magic bytes do conteúdo.
 *  2. Sem limite de tamanho — `Buffer.from(b64, 'base64')` poderia inflar
 *     a memória do worker e consumir cota do R2. Limitamos a 5 MB.
 *  3. Chave previsível (`${prefixBase}_selfie.jpg`) baseada em ID
 *     sequencial — combinado com a entropia fraca anterior do
 *     `verificationHash` (Math.random), permitia adivinhar URLs.
 *     Trocada por UUID v4 aleatório no nome do arquivo.
 *
 * Nota: este módulo NÃO lida com ACL do bucket. Confirme no Cloudflare
 * Console que `escalas_docs` não é público (acesso só via binding/Worker).
 */

/**
 * Subset estrutural mínimo dos bindings R2 — só precisa `put` aceitando
 * bytes. Tipado com `unknown` no value para não depender da variância do
 * `R2Bucket` de workers-types. O caller já passa um `Buffer` (criado por
 * `Buffer.from(b64, 'base64')`), que o binding aceita.
 */
interface R2Putable {
	put(key: string, value: unknown, options?: Record<string, unknown>): Promise<unknown>;
}

export const SELFIE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const DATA_URI_RE = /^data:image\/(jpeg|png|jpg);base64,/i;

/** Resultado do upload. `null` se a selfie veio vazia (caller decide se isso é erro). */
type SelfieUploadResult =
	| { ok: true; key: string }
	| { ok: false; reason: 'formato-invalido' | 'magic-mismatch' | 'too-large' };

/**
 * Magic bytes mínimos para PNG e JPEG. Suficiente para barrar arquivos fora do
 * tipo — o prefixo `data:image/...` é declaração do cliente, não evidência.
 *
 * Export desde set/2026: a foto da fachada da unidade (`/unidades`, editar)
 * usa a mesma checagem — o que NÃO se faz é reescrever os magic bytes numa
 * segunda cópia (foi assim que uma delas nasceu mais fraca).
 */
export function detectarTipoImagem(bytes: Uint8Array): 'png' | 'jpg' | null {
	if (bytes.length < 4) return null;
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return 'png';
	}
	// JPEG: FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'jpg';
	}
	return null;
}

/** `%PDF` no começo do arquivo — o `Content-Type` do cliente não conta (SEC-17). */
export function ePdf(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 4 &&
		bytes[0] === 0x25 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x44 &&
		bytes[3] === 0x46
	);
}

/**
 * Faz parse + valida + sobe a selfie no R2. Devolve a chave gerada.
 *
 * `prefixBase` é o "diretório lógico" — algo como `gise/2026-05/17/123/escala`.
 * O nome final terá um UUID aleatório para que ninguém adivinhe selfies
 * de terceiros tentando IDs sequenciais.
 *
 * @returns chave do objeto no R2, ou null se o input não atender ao prefixo
 *          de data URI (caller pode tratar como entrada vazia/silenciar).
 */
export async function uploadSelfieDataUri(
	r2: R2Putable,
	prefixBase: string,
	selfieBase64: string
): Promise<SelfieUploadResult> {
	const matches = selfieBase64.match(DATA_URI_RE);
	if (!matches) return { ok: false, reason: 'formato-invalido' };

	const dataBase64 = selfieBase64.replace(DATA_URI_RE, '');
	const bytes = Buffer.from(dataBase64, 'base64');

	if (bytes.length === 0 || bytes.length > SELFIE_MAX_BYTES) {
		return { ok: false, reason: 'too-large' };
	}

	const tipoReal = detectarTipoImagem(bytes);
	if (!tipoReal) {
		return { ok: false, reason: 'magic-mismatch' };
	}

	// Chave aleatória — esconde IDs e impede enumeração via URL. O R2 já
	// usa o `prefixBase` para organização lógica.
	const key = `${prefixBase}/${crypto.randomUUID()}.${tipoReal}`;
	await r2.put(key, bytes, {
		httpMetadata: { contentType: `image/${tipoReal}` }
	});
	return { ok: true, key };
}
