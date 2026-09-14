<script lang="ts">
	/**
	 * Um cartão da HOME DE MÓDULOS (`/`): ícone, título, descrição, chamada e
	 * os atalhos secundários (ex.: "Solicitações" dentro de Servidores).
	 *
	 * Duas formas, decididas pelo dado e não por prop: com `href` é uma âncora
	 * inteira clicável, como `BemVindoCardAcao`; sem `href` é PLANEJADO e vem
	 * desligado — `<div>` com opacidade reduzida e o selo "Em breve · fase N",
	 * como no protótipo que originou o Ecossistema (`aria-disabled` para o
	 * leitor de tela dizer o mesmo que o olho vê).
	 *
	 * A cor é a de gestão (#104862, token `gestao`) nos dois temas, com o texto
	 * em branco — pedido do responsável em 13/09/2026, igual à dos cartões
	 * grandes do Início.
	 *
	 * Mora em `routes/_components/` e não em `$lib/components/` porque só a
	 * home o consome.
	 */
	import { ICONE } from '$lib/constants/icones';
	import IconeSvg from '$lib/components/bem-vindo/IconeSvg.svelte';
	import type { CartaoHome } from './home-modulos';

	const { cartao }: { cartao: CartaoHome } = $props();

	const base =
		'flex h-full flex-col gap-4 rounded-2xl bg-gestao p-5 text-white shadow-lg shadow-black/15';
	const ativo =
		'group transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gestao';
</script>

{#snippet corpo()}
	<div class="flex items-start gap-3">
		<span
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white"
		>
			<IconeSvg paths={cartao.icone} class="h-5 w-5" />
		</span>
		<div class="min-w-0 flex-1 space-y-1">
			<h3 class="text-base font-semibold text-white">
				{cartao.titulo}
			</h3>
			<p class="text-xs leading-relaxed text-white/80 sm:text-sm">
				{cartao.descricao}
			</p>
		</div>
	</div>
{/snippet}

{#if cartao.href}
	<div class="{base} {ativo}">
		<a
			href={cartao.href}
			data-sveltekit-preload-data="hover"
			class="flex flex-1 flex-col gap-4 no-underline outline-none"
		>
			{@render corpo()}
			<span class="mt-auto inline-flex items-center gap-1.5 text-xs font-semibold text-white">
				{cartao.cta}
				<IconeSvg
					paths={ICONE.setaDireita}
					class="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
				/>
			</span>
		</a>
		{#if cartao.atalhos.length > 0}
			<ul class="flex flex-wrap gap-2 border-t border-white/20 pt-3">
				{#each cartao.atalhos as atalho (atalho.href)}
					<li>
						<a
							href={atalho.href}
							data-sveltekit-preload-data="hover"
							class="inline-flex items-center rounded-md border border-white/30 bg-white/10 px-2.5 py-1 text-2xs font-medium text-white no-underline transition-colors hover:bg-white/25"
						>
							{atalho.rotulo}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{:else}
	<div class="{base} opacity-55" aria-disabled="true">
		{@render corpo()}
		<span
			class="mt-auto inline-flex w-fit items-center gap-1.5 rounded-md border border-white/30 px-2 py-0.5 text-2xs font-semibold tracking-wide text-white/80 uppercase"
		>
			{cartao.cta}{#if cartao.fase}
				<span class="font-normal normal-case">· fase {cartao.fase}</span>{/if}
		</span>
	</div>
{/if}
