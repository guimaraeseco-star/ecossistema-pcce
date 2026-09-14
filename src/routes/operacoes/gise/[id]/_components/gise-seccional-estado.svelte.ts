/**
 * Estado de UI da edição inline de uma seccional (GiseSeccional e filhos).
 *
 * Vive numa classe única — e não em `$state` locais de cada componente —
 * porque os fluxos de edição são MUTUAMENTE EXCLUSIVOS entre os slots e
 * equipes renderizados: abrir a edição de vagas de uma equipe fecha a das
 * demais (`editandoEquipe` guarda o id ativo), e os callbacks de sucesso do
 * composable `useGiseSeccionalActions` precisam resetar esses campos de fora
 * do componente que os exibe.
 */
export class GiseSeccionalEstado {
	modoEdicaoSeccional = $state(false);

	editandoHorariosSeccional = $state(false);
	editSecHoraEnt = $state('');
	editSecHoraSai = $state('');

	editandoEquipe = $state<number | null>(null);
	editSlotsDpc = $state(0);
	editSlotsOip = $state(0);

	editandoHorariosEquipeId = $state<number | null>(null);
	editEqHoraEnt = $state('');
	editEqHoraSai = $state('');

	selecionandoUnidadeSlotId = $state<number | null>(null);
	slotUnidadeId = $state<number | ''>('');

	equipeParaAdicionar = $state<number | null>(null);
	cargoParaAdicionar = $state<'OIP' | 'DPC' | null>(null);
	policialParaAdicionar = $state<number | ''>('');

	adicionandoEquipe = $state(false);
	adicionandoEquipeSlotId = $state<number | null>(null);
	novaEquipeTipo = $state<'operacional' | 'seint'>('operacional');
	novaEquipeDpc = $state(1);
	novaEquipeOip = $state(3);

	adicionandoSlot = $state(false);
	novoSlotUnidadeId = $state<number | ''>('');

	/**
	 * A ABA de unidade aberta no quadro da seccional (`GiseAbasUnidades`).
	 *
	 * `null` = ninguém escolheu ainda, e a primeira unidade abre. Guardar o id
	 * escolhido aqui — e não no componente da barra — é o que faz a aba
	 * sobreviver ao rerender que toda mutação provoca: adicionar membro
	 * revalida o `load`, e a aba voltaria para a primeira a cada equipe montada.
	 */
	abaSlotId = $state<number | null>(null);

	/**
	 * Pedido pendente de "abrir a ÚLTIMA aba", usado logo após adicionar uma
	 * unidade: o id do slot novo só existe depois do próximo `load`, então o que
	 * se guarda é a intenção. Qualquer clique em outra aba a cancela.
	 */
	abrirUltimaAba = $state(false);
}
