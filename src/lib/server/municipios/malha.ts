/**
 * A MALHA dos municípios do Ceará — os polígonos que o mapa de Municípios
 * desenha (`/municipios/mapa`, fase 2-B). Vem da API de malhas do IBGE
 * (GeoJSON, qualidade INTERMEDIÁRIA: 184 municípios, ~14 mil vértices — a
 * mínima, com ~4 mil, simplifica cada município por si e os vizinhos passam a
 * se sobrepor; Jaguaribe invadia Pereiro) e fica guardada no R2 (`mapas/ce-municipios.geojson`): o IBGE é consultado
 * UMA vez, e o mapa nunca depende de ele estar no ar.
 *
 * Só se guarda o que o mapa usa — `codarea` (o IBGE) e a geometria, com as
 * coordenadas em 4 casas (≈ 11 m; o IBGE manda 13). Qualquer
 * outra propriedade que o IBGE mande é descartada, e uma resposta que não
 * seja FeatureCollection com `codarea` em toda feature é recusada em vez de
 * guardada: malha errada no R2 seria um erro permanente.
 */

export const CHAVE_MALHA_CE = 'mapas/ce-municipios.geojson';

/** UF 23 = Ceará; `intrarregiao=municipio` divide a UF em municípios. */
const URL_MALHA_CE =
	'https://servicodados.ibge.gov.br/api/v3/malhas/estados/23?formato=application/vnd.geo%2Bjson&qualidade=intermediaria&intrarregiao=municipio';

/** Arredonda toda coordenada (em qualquer profundidade) a 4 casas. */
function arredondar(c: unknown): unknown {
	if (typeof c === 'number') return Math.round(c * 1e4) / 1e4;
	return Array.isArray(c) ? c.map(arredondar) : c;
}

interface FeatureMunicipio {
	type: 'Feature';
	properties: { ibge: string };
	geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

export interface MalhaMunicipios {
	type: 'FeatureCollection';
	features: FeatureMunicipio[];
}

/** Valida e enxuga a resposta do IBGE; `null` quando não é uma malha de municípios. */
export function normalizarMalha(resposta: unknown): MalhaMunicipios | null {
	const r = resposta as { type?: string; features?: unknown[] } | null;
	if (!r || r.type !== 'FeatureCollection' || !Array.isArray(r.features) || r.features.length === 0)
		return null;
	const features: FeatureMunicipio[] = [];
	for (const f of r.features as Array<{
		properties?: { codarea?: unknown };
		geometry?: { type?: string; coordinates?: unknown };
	}>) {
		const ibge = String(f?.properties?.codarea ?? '');
		const tipo = f?.geometry?.type;
		if (!/^\d{7}$/.test(ibge) || (tipo !== 'Polygon' && tipo !== 'MultiPolygon')) return null;
		features.push({
			type: 'Feature',
			properties: { ibge },
			geometry: { type: tipo, coordinates: arredondar(f.geometry?.coordinates) }
		});
	}
	return { type: 'FeatureCollection', features };
}

/** O recorte de R2 que este módulo usa — injetável no teste. */
interface R2Minimo {
	get(key: string): Promise<{ text(): Promise<string> } | null>;
	put(key: string, value: string, options?: Record<string, unknown>): Promise<unknown>;
}
type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * A malha como texto JSON: do R2 quando já está lá, senão do IBGE (e aí guarda).
 * Lança quando o IBGE falha ou responde algo que não é malha — quem chama
 * decide o status.
 */
export async function malhaDoCeara(r2: R2Minimo, fetchFn: Fetch): Promise<string> {
	const guardada = await r2.get(CHAVE_MALHA_CE);
	if (guardada) return guardada.text();

	const resposta = await fetchFn(URL_MALHA_CE);
	if (!resposta.ok) throw new Error(`IBGE (malhas) respondeu ${resposta.status}`);
	const malha = normalizarMalha(await resposta.json());
	if (!malha) throw new Error('IBGE (malhas) devolveu algo que não é a malha de municípios');
	const texto = JSON.stringify(malha);
	await r2.put(CHAVE_MALHA_CE, texto, { httpMetadata: { contentType: 'application/geo+json' } });
	return texto;
}
