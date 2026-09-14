/**
 * Os tipos de plantão de um município (fase 2, migração 0086) e o rótulo de
 * cada um. Mora em `lib/` e não em `lib/db/` porque a ficha da unidade (tela,
 * cliente) também precisa do rótulo, e módulo de `lib/db/` importa o schema do
 * servidor — o SvelteKit recusa levá-lo ao navegador.
 */
export const TIPOS_PLANTAO = ['fisico', 'virtual', 'fisico_misto', 'sem_atendimento'] as const;
export type TipoPlantao = (typeof TIPOS_PLANTAO)[number];

const ROTULOS: Record<TipoPlantao, string> = {
	fisico: 'Físico',
	virtual: 'Virtual',
	fisico_misto: 'Físico misto',
	sem_atendimento: 'Sem atendimento'
};

/** Rótulo para a interface; tipo desconhecido volta como está, para não esconder dado. */
export function rotuloTipoPlantao(tipo: string): string {
	return ROTULOS[tipo as TipoPlantao] ?? tipo;
}
