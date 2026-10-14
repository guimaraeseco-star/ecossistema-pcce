<script lang="ts">
	/**
	 * Fundo da tela de entrada — o mesmo desenho da entrada do Plantão Eleições
	 * (DPI SUL), nas cores do Ecossistema (pedido de 14/10/2026):
	 *
	 * - brasão da Polícia Civil à esquerda e do Ceará à direita, grandes e
	 *   translúcidos, saindo pelas bordas e flutuando devagar;
	 * - luz difusa ("aurora"): o azul primário atrás do cartão, o dourado da
	 *   Polícia Civil e o verde do Ceará (o `tertiary` do tema) embaixo;
	 * - grade de pontos que some no centro.
	 *
	 * Traz também o botão de modo claro/escuro: antes de entrar não há barra
	 * lateral, e o tema só trocava depois do login. Usa a MESMA chave
	 * (`color-theme` no localStorage, classe `.dark` no `<html>`) do botão da
	 * sidebar e do `static/init.js` — a escolha feita aqui vale depois de entrar.
	 *
	 * Fica atrás de tudo (`fixed`, sem eventos de ponteiro); o conteúdo da página
	 * sobe para `z-10` e o botão fica em `z-20` (escala do README §10). O
	 * `prefers-reduced-motion` global do `app.css` desliga o movimento.
	 */
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';

	// O tema mora no navegador (o servidor não sabe qual é): os dois ícones vão no
	// HTML e a classe `.dark` do <html> mostra um e esconde o outro (CSS abaixo).
	function alternarTema() {
		const escuro = document.documentElement.classList.toggle('dark');
		try {
			localStorage.setItem('color-theme', escuro ? 'dark' : 'light');
		} catch {
			// localStorage bloqueado (modo privado): o tema vale só nesta página.
		}
	}
</script>

<div class="fundo-entrada" aria-hidden="true">
	<div class="aurora aurora-azul"></div>
	<div class="aurora aurora-ouro"></div>
	<div class="aurora aurora-verde"></div>
	<div class="fundo-grade"></div>
	<img class="logo-fundo logo-pcce" src="/fundo-pcce.webp" alt="" decoding="async" />
	<img class="logo-fundo logo-ceara" src="/fundo-ceara.webp" alt="" decoding="async" />
</div>

<button
	type="button"
	class="tema-entrada fixed z-20"
	onclick={alternarTema}
	title="Modo claro / escuro"
	aria-label="Alternar entre modo claro e modo escuro"
>
	<Moon class="icone-lua w-5 h-5" aria-hidden="true" />
	<Sun class="icone-sol w-5 h-5" aria-hidden="true" />
</button>

<style>
	/* Cores: azul = primary-500, verde = tertiary-500 (theme.css); dourado do
	   brasão da Polícia Civil, como na entrada do Plantão Eleições. */
	.fundo-entrada {
		--fundo: linear-gradient(
			160deg,
			oklch(98.4% 0.003 247.9deg) 0%,
			oklch(95.6% 0.018 255deg) 55%,
			oklch(95.8% 0.022 95deg) 100%
		);
		--aurora-azul: oklch(62.3% 0.214 259.8deg / 0.26);
		--aurora-ouro: rgb(191 167 92 / 0.3);
		--aurora-verde: oklch(62% 0.16 150deg / 0.2);
		--logo-opacidade: 0.2;
		--grade-ponto: oklch(15% 0.03 265deg / 0.09);

		position: fixed;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		background: var(--fundo);
	}
	:global(.dark) .fundo-entrada {
		--fundo: linear-gradient(
			160deg,
			oklch(13% 0.03 265deg) 0%,
			oklch(17% 0.045 264deg) 55%,
			oklch(16% 0.025 150deg) 100%
		);
		--aurora-azul: oklch(62.3% 0.214 259.8deg / 0.3);
		--aurora-ouro: rgb(191 167 92 / 0.18);
		--aurora-verde: oklch(62% 0.16 150deg / 0.2);
		--logo-opacidade: 0.14;
		--grade-ponto: rgb(255 255 255 / 0.07);
	}

	.aurora {
		position: absolute;
		width: 60vmax;
		height: 60vmax;
		border-radius: 50%;
		filter: blur(90px);
		will-change: transform;
	}
	/* A luz azul tem o tamanho do cartão e fica centralizada atrás dele. */
	.aurora-azul {
		width: min(680px, 92vw);
		height: min(560px, 74vh);
		top: 50%;
		left: 50%;
		margin-left: calc(min(680px, 92vw) / -2);
		margin-top: calc(min(560px, 74vh) / -2);
		filter: blur(70px);
		background: var(--aurora-azul);
		animation: aurora-a 22s ease-in-out infinite alternate;
	}
	.aurora-ouro {
		background: var(--aurora-ouro);
		bottom: -26vmax;
		left: -14vmax;
		animation: aurora-b 32s ease-in-out infinite alternate;
	}
	.aurora-verde {
		background: var(--aurora-verde);
		bottom: -24vmax;
		right: -16vmax;
		animation: aurora-c 29s ease-in-out infinite alternate;
	}
	@keyframes aurora-a {
		to {
			transform: translateY(2vh) scale(1.06);
		}
	}
	@keyframes aurora-b {
		to {
			transform: translate(10vw, -8vh) scale(1.08);
		}
	}
	@keyframes aurora-c {
		to {
			transform: translate(-9vw, -10vh) scale(1.15);
		}
	}

	.fundo-grade {
		position: absolute;
		inset: 0;
		background-image: radial-gradient(var(--grade-ponto) 1px, transparent 1.4px);
		background-size: 22px 22px;
		-webkit-mask-image: radial-gradient(ellipse at center, transparent 22%, #000 75%);
		mask-image: radial-gradient(ellipse at center, transparent 22%, #000 75%);
	}

	.logo-fundo {
		position: absolute;
		top: 50%;
		height: min(78vh, 720px);
		width: auto;
		opacity: var(--logo-opacidade);
		filter: saturate(0.9) drop-shadow(0 30px 60px rgb(15 23 43 / 0.25));
		-webkit-mask-image: linear-gradient(var(--lado-mascara), #000 45%, transparent 100%);
		mask-image: linear-gradient(var(--lado-mascara), #000 45%, transparent 100%);
	}
	.logo-pcce {
		--lado-mascara: to right;
		left: -6vw;
		transform: translateY(-50%) rotate(-8deg);
		animation: flutua-esq 14s ease-in-out infinite alternate;
	}
	.logo-ceara {
		--lado-mascara: to left;
		right: -6vw;
		transform: translateY(-50%) rotate(8deg);
		animation: flutua-dir 16s ease-in-out infinite alternate;
	}
	@keyframes flutua-esq {
		to {
			transform: translateY(calc(-50% - 14px)) rotate(-6deg);
		}
	}
	@keyframes flutua-dir {
		to {
			transform: translateY(calc(-50% + 14px)) rotate(6deg);
		}
	}

	.tema-entrada {
		top: calc(16px + env(safe-area-inset-top, 0px));
		right: 16px;
		width: 42px;
		height: 42px;
		border-radius: 12px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: oklch(37% 0.03 260deg);
		background: oklch(100% 0 0deg / 0.7);
		border: 1px solid oklch(15% 0.03 265deg / 0.12);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		cursor: pointer;
	}
	:global(.dark) .tema-entrada {
		color: oklch(90% 0.01 260deg);
		background: oklch(21% 0.04 265deg / 0.7);
		border-color: rgb(255 255 255 / 0.12);
	}
	/* Claro mostra a lua (ir para o escuro); escuro mostra o sol. */
	.tema-entrada :global(.icone-sol) {
		display: none;
	}
	:global(.dark) .tema-entrada :global(.icone-sol) {
		display: block;
	}
	:global(.dark) .tema-entrada :global(.icone-lua) {
		display: none;
	}
	.tema-entrada:hover,
	.tema-entrada:focus-visible {
		border-color: oklch(62.3% 0.214 259.8deg / 0.6);
	}

	/* Celular: brasões menores, nos cantos (o do Ceará embaixo), sem ocupar o cartão. */
	@media (max-width: 767px) {
		.logo-fundo {
			height: 42vh;
			top: auto;
		}
		.logo-pcce {
			top: -6vh;
			left: -18vw;
			transform: rotate(-10deg);
			animation: none;
		}
		.logo-ceara {
			bottom: -8vh;
			right: -18vw;
			transform: rotate(10deg);
			animation: none;
		}
		.aurora {
			filter: blur(70px);
		}
	}
</style>
