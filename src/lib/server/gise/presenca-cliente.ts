/**
 * O recorte das presenças GISE que pode SAIR do servidor para o navegador.
 *
 * `buscarPresencasGise` devolve a linha de evidência COMPLETA, e é o que os
 * geradores de PDF precisam: nome, matrícula, CPF decifrado, cargo, classe,
 * lotação, IP, user-agent, latitude, longitude e as chaves R2 das selfies. Esse
 * conjunto é exatamente o **manifesto forense** que o resto do sistema trata
 * como o dado mais restrito que existe aqui — `podeBaixarForense` o limita ao
 * Super Admin, e a página pública `/validar` o omite por escrito ("IP,
 * user-agent e GPS: omitidos — desnecessários para validação pública e permitem
 * rastreamento individual").
 *
 * O `load` de `/operacoes/gise/[id]` devolvia essa linha INTEIRA ao cliente. Ela descia no
 * payload de hidratação — CPF, IP, GPS e chave de selfie de cada integrante da
 * operação — para o Admin Geral, para o admin de seccional participante e para o
 * SUPERVISOR, que é policial comum. Nada disso aparecia na interface, e é o que
 * tornava o vazamento difícil de ver: quem lia a tela não tinha por que suspeitar
 * do payload.
 *
 * A tela precisa de TRÊS campos, e isso não é suposição — três tipos
 * independentes já o declaravam: `PresencaGiseLinha` (o quadro de supervisão),
 * `PresencaMin` (`$lib/gise/supervisao-extra`) e `PresencaRodagem` (o marcador
 * de entrada/saída). Todo consumidor no cliente responde à mesma pergunta:
 * este integrante confirmou entrada e saída?
 *
 * Por isso a função devolve um objeto NOVO, campo a campo, em vez de deletar as
 * chaves indesejadas do original: um campo novo em `buscarPresencasGise`
 * (evidência é o tipo de coluna que cresce) não passa a viajar de graça — ele
 * fica de fora até alguém decidir, aqui, que a tela precisa dele.
 */

/** O que o cliente vê de uma presença: confirmou entrada? confirmou saída? */
export interface PresencaGiseCliente {
	policial_id: number;
	entrada_timestamp: string | null;
	saida_timestamp: string | null;
}

/**
 * Recorta as presenças para serialização ao cliente.
 *
 * Use em TODO `load` que devolva presenças à tela. Quem gera PDF/manifesto
 * continua usando o retorno cru de `buscarPresencasGise` — ali o dado forense é
 * o produto, não um excesso.
 */
export function presencasParaCliente(
	presencas: readonly PresencaGiseCliente[]
): PresencaGiseCliente[] {
	return presencas.map((p) => ({
		policial_id: p.policial_id,
		entrada_timestamp: p.entrada_timestamp,
		saida_timestamp: p.saida_timestamp
	}));
}
