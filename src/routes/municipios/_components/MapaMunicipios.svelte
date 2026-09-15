<script lang="ts">
	/**
	 * O mapa dos municípios do departamento (`/municipios/mapa`, fase 2-B) —
	 * SVG desenhado aqui mesmo, sem biblioteca de mapa e sem fundo de ruas:
	 * são ~80 polígonos com ~4 mil vértices, e um mapa temático (cor por AIS ou
	 * por seccional) não precisa de mais. Decisão do responsável em 16/09/2026:
	 * sem OpenStreetMap — nada sai para terceiros e a CSP fica como está.
	 *
	 * A malha vem de `/api/mapas/ce-municipios` (IBGE, guardada no R2); os
	 * DADOS de cada município vêm do banco pela mesma carga da lista
	 * (`carregar.ts`) — nunca do arquivo do mapa antigo, para não divergir.
	 * Os municípios do Ceará fora do departamento aparecem em cinza, sem
	 * interação, como contexto.
	 *
	 * Projeção: equiretangular com o cosseno da latitude média — para o
	 * Ceará (3°–8° S) a distorção é invisível a olho. Zoom pela roda (em torno
	 * do cursor) e arrasto pelo ponteiro, tudo em cima do `viewBox`.
	 */
	import { apiFetch } from '$lib/api-fetch';
	import { rotuloTipoPlantao } from '$lib/unidades/plantao';
	import type { MalhaMunicipios } from '$lib/server/municipios/malha';
	import type { MunicipioDaTela } from './carregar';

	const {
		municipios,
		corPor = 'ais'
	}: {
		municipios: MunicipioDaTela[];
		/** Critério da cor: AIS do município ou seccional de quem atende. */
		corPor?: 'ais' | 'seccional';
	} = $props();

	/** A paleta das AIS é a do mapa que o responsável já usava — cores conhecidas. */
	const CORES_AIS: Record<string, string> = {
		'AIS 01': '#2B6CB0',
		'AIS 02': '#F28E2B',
		'AIS 09': '#8E63B5',
		'AIS 10': '#D55D5A',
		'AIS 13': '#8A6F61',
		'AIS 30': '#39B8C4',
		'AIS 31': '#63B658',
		'AIS 32': '#E7B07A',
		'AIS 33': '#C779B7',
		'AIS 34': '#D9364D'
	};
	const CORES_SECCIONAL = ['#2B6CB0', '#F28E2B', '#63B658', '#8E63B5', '#D55D5A', '#39B8C4'];
	const SEM_COR = '#9CA3AF';

	let malha = $state<MalhaMunicipios | null>(null);
	let erro = $state('');
	let selecionado = $state<string | null>(null);
	let pairado = $state<{ ibge: string; x: number; y: number } | null>(null);
	let categoriaDestacada = $state<string | null>(null);

	const porIbge = $derived(new Map(municipios.map((m) => [m.ibge, m])));
	const fmt = new Intl.NumberFormat('pt-BR');

	$effect(() => {
		apiFetch<MalhaMunicipios>('/api/mapas/ce-municipios')
			.then((m) => (malha = m))
			.catch((e: Error) => (erro = e.message));
	});

	/** A categoria (rótulo da legenda) de um município, no critério escolhido. */
	const categoriaDe = (m: MunicipioDaTela) =>
		corPor === 'ais' ? m.ais || 'Sem AIS' : m.unidades[0]?.seccional || 'Sem seccional';

	const categorias = $derived.by(() => {
		const lista = [...new Set(municipios.map(categoriaDe))].sort((a, b) =>
			a.localeCompare(b, 'pt-BR', { numeric: true })
		);
		return lista.map((rotulo, i) => ({
			rotulo,
			cor:
				corPor === 'ais'
					? (CORES_AIS[rotulo] ?? SEM_COR)
					: (CORES_SECCIONAL[i % CORES_SECCIONAL.length] ?? SEM_COR),
			quantos: municipios.filter((m) => categoriaDe(m) === rotulo).length
		}));
	});
	const corDe = (m: MunicipioDaTela) =>
		categorias.find((c) => c.rotulo === categoriaDe(m))?.cor ?? SEM_COR;

	// ---- projeção e caminhos SVG ----
	type Anel = number[][];
	const aneisDe = (g: MalhaMunicipios['features'][number]['geometry']): Anel[] =>
		g.type === 'Polygon'
			? (g.coordinates as Anel[])
			: (g.coordinates as Anel[][]).flatMap((poligono) => poligono);

	const desenho = $derived.by(() => {
		if (!malha) return null;
		const proprios = malha.features.filter((f) => porIbge.has(f.properties.ibge));
		const todos = proprios.length ? proprios : malha.features;
		let minLat = 90,
			maxLat = -90;
		for (const f of todos)
			for (const anel of aneisDe(f.geometry))
				for (const [, lat] of anel) {
					if (lat < minLat) minLat = lat;
					if (lat > maxLat) maxLat = lat;
				}
		const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
		const px = (lon: number) => lon * k * 100;
		const py = (lat: number) => -lat * 100;
		const caminho = (f: MalhaMunicipios['features'][number]) =>
			aneisDe(f.geometry)
				.map(
					(anel) =>
						'M' +
						anel.map(([lon, lat]) => `${px(lon).toFixed(2)} ${py(lat).toFixed(2)}`).join('L') +
						'Z'
				)
				.join('');
		const centro = (f: MalhaMunicipios['features'][number]) => {
			// O centróide do anel maior — bom o bastante para posicionar o nome.
			const anel = aneisDe(f.geometry).sort((a, b) => b.length - a.length)[0];
			let sx = 0,
				sy = 0;
			for (const [lon, lat] of anel) {
				sx += px(lon);
				sy += py(lat);
			}
			return { x: sx / anel.length, y: sy / anel.length };
		};
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		for (const f of todos)
			for (const anel of aneisDe(f.geometry))
				for (const [lon, lat] of anel) {
					const x = px(lon),
						y = py(lat);
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
		const margem = Math.max(maxX - minX, maxY - minY) * 0.04;
		return {
			caixa: {
				x: minX - margem,
				y: minY - margem,
				w: maxX - minX + 2 * margem,
				h: maxY - minY + 2 * margem
			},
			contexto: malha.features
				.filter((f) => !porIbge.has(f.properties.ibge))
				.map((f) => ({ ibge: f.properties.ibge, d: caminho(f) })),
			proprios: proprios.map((f) => ({
				ibge: f.properties.ibge,
				d: caminho(f),
				centro: centro(f),
				m: porIbge.get(f.properties.ibge)!
			}))
		};
	});

	// ---- zoom e arrasto sobre o viewBox ----
	let vista = $state<{ x: number; y: number; w: number; h: number } | null>(null);
	const viewBox = $derived.by(() => {
		const v = vista ?? desenho?.caixa;
		return v ? `${v.x} ${v.y} ${v.w} ${v.h}` : '0 0 100 100';
	});
	const zoomAtual = $derived(desenho && vista ? desenho.caixa.w / vista.w : 1);
	let svg = $state<SVGSVGElement | undefined>();
	let arrasto = $state<{ x: number; y: number; vx: number; vy: number } | null>(null);

	/** Ponto do ponteiro em coordenadas do desenho. */
	function pontoDe(e: PointerEvent | WheelEvent) {
		const v = vista ?? desenho?.caixa;
		if (!svg || !v) return { x: 0, y: 0 };
		const r = svg.getBoundingClientRect();
		// `meet`: a escala é a menor das duas, e o desenho fica centrado.
		const escala = Math.min(r.width / v.w, r.height / v.h);
		const dx = (r.width - v.w * escala) / 2;
		const dy = (r.height - v.h * escala) / 2;
		return {
			x: v.x + (e.clientX - r.left - dx) / escala,
			y: v.y + (e.clientY - r.top - dy) / escala
		};
	}
	function ampliar(fator: number, foco?: { x: number; y: number }) {
		const v = vista ?? desenho?.caixa;
		if (!v || !desenho) return;
		const w = Math.min(desenho.caixa.w * 1.5, Math.max(desenho.caixa.w / 12, v.w / fator));
		const h = (w * v.h) / v.w;
		const f = foco ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
		const tx = (f.x - v.x) / v.w;
		const ty = (f.y - v.y) / v.h;
		vista = { x: f.x - tx * w, y: f.y - ty * h, w, h };
	}
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		ampliar(e.deltaY < 0 ? 1.25 : 0.8, pontoDe(e));
	}
	function onPointerDown(e: PointerEvent) {
		const v = vista ?? desenho?.caixa;
		if (!v) return;
		arrasto = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y };
	}
	function onPointerMove(e: PointerEvent) {
		if (!arrasto || !svg) return;
		const v = vista ?? desenho?.caixa;
		if (!v) return;
		const r = svg.getBoundingClientRect();
		const escala = Math.min(r.width / v.w, r.height / v.h);
		vista = {
			...v,
			x: arrasto.vx - (e.clientX - arrasto.x) / escala,
			y: arrasto.vy - (e.clientY - arrasto.y) / escala
		};
	}
	/**
	 * Soltar o ponteiro sem ter arrastado (menos de 4 px) é o CLIQUE num
	 * município. Decidido aqui, e não num `onclick` do path, porque o arrasto
	 * também começa em cima de um path — e o clique não pode selecionar no fim
	 * de um arrasto.
	 */
	function onPointerUp(e: PointerEvent) {
		const a = arrasto;
		arrasto = null;
		if (!a || Math.hypot(e.clientX - a.x, e.clientY - a.y) > 4) return;
		const ibge = (e.target as Element).closest('path[data-ibge]')?.getAttribute('data-ibge');
		if (ibge) selecionado = selecionado === ibge ? null : ibge;
	}

	const selecionadoM = $derived(selecionado ? (porIbge.get(selecionado) ?? null) : null);
	const plantao = (
		p: { tipo: string; plantonista: string; plantonistaId: number | null } | null,
		m: MunicipioDaTela
	) => {
		if (!p) return '—';
		const propria = m.unidades.some((u) => u.id === p.plantonistaId);
		return `${rotuloTipoPlantao(p.tipo)}${p.plantonista && !propria ? ` · ${p.plantonista}` : ''}`;
	};
	const opaco = (m: MunicipioDaTela) =>
		!categoriaDestacada || categoriaDe(m) === categoriaDestacada ? 1 : 0.25;
	/** Tamanho do nome em unidades do desenho: encolhe conforme o zoom. */
	const fonte = $derived(desenho ? desenho.caixa.w / 95 / Math.sqrt(zoomAtual) : 1);
</script>

<div class="grid gap-4 lg:grid-cols-[1fr_18rem]">
	<div
		class="relative min-h-[28rem] overflow-hidden rounded-2xl border border-surface-200 bg-surface-50 dark:border-white/10 dark:bg-surface-900"
	>
		{#if erro}
			<p class="p-6 text-sm text-error-600">{erro}</p>
		{:else if !desenho}
			<p class="p-6 text-sm text-surface-500">Carregando a malha dos municípios…</p>
		{:else}
			<svg
				bind:this={svg}
				{viewBox}
				preserveAspectRatio="xMidYMid meet"
				class="h-[28rem] w-full touch-none select-none lg:h-[36rem] {arrasto
					? 'cursor-grabbing'
					: 'cursor-grab'}"
				role="img"
				aria-label="Mapa dos municípios do departamento"
				onwheel={onWheel}
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={() => (arrasto = null)}
				onpointerleave={() => {
					pairado = null;
					arrasto = null;
				}}
			>
				<!-- O resto do Ceará, como contexto -->
				{#each desenho.contexto as c (c.ibge)}
					<path
						d={c.d}
						class="fill-surface-200 stroke-white dark:fill-surface-800 dark:stroke-surface-700"
						stroke-width={fonte * 0.08}
					/>
				{/each}
				{#each desenho.proprios as p (p.ibge)}
					<path
						d={p.d}
						fill={corDe(p.m)}
						fill-opacity={opaco(p.m)}
						class="stroke-white outline-none transition-[fill-opacity] dark:stroke-surface-950"
						stroke-width={fonte * 0.12}
						data-ibge={p.ibge}
						role="button"
						tabindex="0"
						aria-label={p.m.nome}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') selecionado = p.ibge;
						}}
						onpointerenter={(e) => (pairado = { ibge: p.ibge, x: e.clientX, y: e.clientY })}
						onpointermove={(e) => {
							if (pairado?.ibge === p.ibge) pairado = { ibge: p.ibge, x: e.clientX, y: e.clientY };
						}}
					/>
				{/each}
				{#each desenho.proprios as p (p.ibge)}
					<text
						x={p.centro.x}
						y={p.centro.y}
						font-size={fonte}
						text-anchor="middle"
						dominant-baseline="middle"
						class="pointer-events-none fill-white font-semibold"
						style="paint-order: stroke; stroke: rgba(0,0,0,.55); stroke-width: {fonte * 0.18}px"
						>{p.m.nome}</text
					>
				{/each}
				<!-- O contorno do selecionado vai POR CIMA de tudo (o SVG pinta na
				     ordem): desenhado junto com o polígono, os vizinhos pintados
				     depois cobriam metade da borda. O anel de foco do navegador no
				     path (`outline-none`) era a "moldura" retangular que aparecia em
				     volta do município clicado — o destaque é esta borda, não o foco. -->
				{#each desenho.proprios.filter((p) => p.ibge === selecionado) as p (p.ibge)}
					<path
						d={p.d}
						fill="none"
						class="pointer-events-none stroke-surface-900 dark:stroke-white"
						stroke-width={fonte * 0.32}
						stroke-linejoin="round"
					/>
				{/each}
			</svg>
			<div class="absolute top-3 right-3 flex flex-col gap-1">
				<button
					type="button"
					class="btn-icon preset-filled-surface-100-900 h-8 w-8 text-lg"
					aria-label="Aproximar"
					onclick={() => ampliar(1.5)}>+</button
				>
				<button
					type="button"
					class="btn-icon preset-filled-surface-100-900 h-8 w-8 text-lg"
					aria-label="Afastar"
					onclick={() => ampliar(1 / 1.5)}>−</button
				>
				<button
					type="button"
					class="btn-icon preset-filled-surface-100-900 h-8 w-8 text-xs"
					aria-label="Enquadrar"
					title="Enquadrar"
					onclick={() => (vista = null)}>⌂</button
				>
			</div>
			{#if pairado && porIbge.get(pairado.ibge)}
				{@const m = porIbge.get(pairado.ibge)!}
				<div
					class="pointer-events-none fixed z-30 rounded-lg bg-surface-900 px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-surface-50 dark:text-surface-900"
					style="left: {pairado.x + 14}px; top: {pairado.y + 14}px"
				>
					<span class="font-semibold">{m.nome}</span>
					{#if m.unidades.length}<br />{m.unidades.map((u) => u.nome).join(' · ')}{/if}
					{#if m.ais}<br />{m.ais}{/if}
				</div>
			{/if}
		{/if}
	</div>

	<aside class="flex flex-col gap-4">
		{#if selecionadoM}
			<section class="card-elevated rounded-2xl p-4" aria-live="polite">
				<div class="flex items-start justify-between gap-2">
					<h2 class="text-base font-semibold text-surface-900 dark:text-surface-50">
						{selecionadoM.nome}
					</h2>
					<button
						type="button"
						class="text-xs text-surface-500 hover:underline"
						onclick={() => (selecionado = null)}>fechar</button
					>
				</div>
				<dl class="mt-2 space-y-1.5 text-sm">
					<div>
						<dt class="text-2xs text-surface-500">Atendido por</dt>
						<dd>
							{#each selecionadoM.unidades as un, i (un.id)}
								{#if i > 0}<br />{/if}
								<a href="/unidade/{un.id}" class="font-medium">{un.nome}</a>
								{#if un.seccional}<span class="text-xs text-surface-500">
										· {un.seccional}</span
									>{/if}
							{:else}—{/each}
						</dd>
					</div>
					<div>
						<dt class="text-2xs text-surface-500">AIS</dt>
						<dd>{selecionadoM.ais || '—'}</dd>
					</div>
					<div>
						<dt class="text-2xs text-surface-500">Plantão na semana</dt>
						<dd>{plantao(selecionadoM.semana, selecionadoM)}</dd>
					</div>
					<div>
						<dt class="text-2xs text-surface-500">Plantão no fim de semana</dt>
						<dd>{plantao(selecionadoM.fds, selecionadoM)}</dd>
					</div>
					<div>
						<dt class="text-2xs text-surface-500">População</dt>
						<dd>
							{selecionadoM.populacao != null
								? `${fmt.format(selecionadoM.populacao)} (${selecionadoM.populacaoFonte})`
								: '—'}
						</dd>
					</div>
					<div>
						<dt class="text-2xs text-surface-500">Efetivo · hab. por policial</dt>
						<dd>
							{selecionadoM.efetivo > 0 ? selecionadoM.efetivo : '—'} ·
							{selecionadoM.habPorPolicial != null ? fmt.format(selecionadoM.habPorPolicial) : '—'}
						</dd>
					</div>
				</dl>
				<a
					href="/municipios/{selecionadoM.ibge}"
					class="btn btn-sm preset-outlined-surface-500 mt-3 w-full">Abrir a ficha</a
				>
			</section>
		{:else}
			<p class="text-xs text-surface-500">
				Passe o ponteiro para ver o município; clique para abrir os dados. Roda do mouse aproxima;
				arraste para mover.
			</p>
		{/if}

		<section class="card-elevated rounded-2xl p-4">
			<h2 class="mb-2 text-sm font-semibold text-surface-900 dark:text-surface-50">
				{corPor === 'ais' ? 'AIS' : 'Seccionais'}
			</h2>
			<ul class="space-y-1">
				{#each categorias as c (c.rotulo)}
					<li>
						<button
							type="button"
							class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-surface-100 dark:hover:bg-surface-800 {categoriaDestacada ===
							c.rotulo
								? 'bg-surface-100 dark:bg-surface-800'
								: ''}"
							onclick={() =>
								(categoriaDestacada = categoriaDestacada === c.rotulo ? null : c.rotulo)}
						>
							<span class="inline-block h-3 w-3 shrink-0 rounded-sm" style="background: {c.cor}"
							></span>
							<span class="flex-1 truncate">{c.rotulo}</span>
							<span class="text-surface-500">{c.quantos}</span>
						</button>
					</li>
				{/each}
			</ul>
		</section>
	</aside>
</div>
