<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { filter, closeFilter } from '$lib/filter.svelte';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { tagDisplay } from '$lib/tags';
	import { dayLabel } from '$lib/dates';
	import type { Tag } from '$lib/types';

	let {
		tags = [],
		total = 0,
		showing = 0,
		dateRange = null,
		onDateRangeChange
	}: {
		tags?: (Tag & { count: number })[];
		total?: number;
		showing?: number;
		dateRange?: [number, number] | null;
		onDateRangeChange?: (range: [number, number] | null) => void;
	} = $props();

	let active = $derived(page.url.searchParams.getAll('tag'));
	let field = $state<HTMLInputElement | null>(null);

	// Opening the bar should put the caret in it — you opened it to type.
	// Deep-linking to /?tag=x shouldn't, because the tag is already the query.
	$effect(() => {
		if (filter.open) queueMicrotask(() => field?.focus());
	});

	/* The home page's server load never reads the URL's search params, so
	   rewriting them here doesn't re-run it — this is a local re-render, not a
	   round trip, even though the filter is addressable. */
	function setTags(next: string[]) {
		const url = new URL(page.url);
		url.searchParams.delete('tag');
		for (const tag of next) url.searchParams.append('tag', tag);
		goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function toggleTag(name: string) {
		setTags(active.includes(name) ? active.filter((t) => t !== name) : [...active, name]);
	}

	function clearAll() {
		filter.q = '';
		if (active.length > 0) setTags([]);
		showCustomPicker = false;
		onDateRangeChange?.(null);
		closeFilter();
	}

	// ---- date quick filters ----
	// Today/Yesterday/a picked day, presented as chips in the same row as tags
	// rather than as a second control bolted on underneath — it's one more
	// way of narrowing the same stream, not a different kind of thing.
	function startOfDay(d: Date) {
		return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	}
	let todayMs = $derived(startOfDay(new Date()));
	let yesterdayMs = $derived(todayMs - 86_400_000);

	let dateKind = $derived.by((): 'today' | 'yesterday' | 'custom' | null => {
		if (!dateRange) return null;
		const [start, end] = dateRange;
		if (start === todayMs && end === todayMs + 86_400_000) return 'today';
		if (start === yesterdayMs && end === todayMs) return 'yesterday';
		return 'custom';
	});

	function pickToday() {
		onDateRangeChange?.(dateKind === 'today' ? null : [todayMs, todayMs + 86_400_000]);
	}
	function pickYesterday() {
		onDateRangeChange?.(dateKind === 'yesterday' ? null : [yesterdayMs, todayMs]);
	}
	function clearDate(e: MouseEvent) {
		e.stopPropagation();
		showCustomPicker = false;
		onDateRangeChange?.(null);
	}

	let customLabel = $derived(dateKind === 'custom' && dateRange ? dayLabel(dateRange[0]) : 'Date');

	// A native date input beats a "dd/mm/yyyy" text field every time — the
	// picker here is just where it lives, anchored under its own chip instead
	// of a page-wide modal, since picking one day doesn't need to take over
	// the screen.
	let showCustomPicker = $state(false);
	let customField = $state<HTMLInputElement | null>(null);

	function openCustomPicker() {
		showCustomPicker = !showCustomPicker;
		if (showCustomPicker) queueMicrotask(() => customField?.showPicker?.());
	}

	function pickCustom(e: Event) {
		const value = (e.target as HTMLInputElement).value; // yyyy-mm-dd
		if (!value) return;
		const [y, m, d] = value.split('-').map(Number);
		const start = new Date(y, m - 1, d).getTime();
		onDateRangeChange?.([start, start + 86_400_000]);
		showCustomPicker = false;
	}

	let filtering = $derived(active.length > 0 || filter.q.trim().length > 0 || dateKind !== null);
</script>

<div
	class="sticky top-0 z-20 px-[22px] pt-3 pb-2.5"
	style="background: var(--color-bg);"
	transition:fly={{ y: -12, duration: 200, easing: quintOut }}
>
	<div
		class="flex items-center gap-2.5 rounded-[1.1rem] px-3.5"
		style="background: var(--color-surface-2);"
	>
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			class="shrink-0"
			style="color: var(--color-ink-faint);"
			><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg
		>
		<input
			bind:this={field}
			bind:value={filter.q}
			type="search"
			placeholder="Search your thoughts…"
			autocapitalize="none"
			autocomplete="off"
			autocorrect="off"
			enterkeyhint="search"
			class="min-w-0 flex-1 bg-transparent py-3.5 text-[1.02rem] font-medium outline-none"
			style="color: var(--color-ink);"
			onkeydown={(e) => e.key === 'Escape' && clearAll()}
		/>
		<button
			type="button"
			aria-label="Close search"
			class="shrink-0 px-1 py-2 text-[0.85rem]"
			style="color: var(--color-ink-muted);"
			onclick={clearAll}
		>
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg
			>
		</button>
	</div>

	<div class="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5" style="scrollbar-width: none;">
		<button
			type="button"
			class="shrink-0 rounded-full border px-3 py-1.5 text-[0.82rem] font-semibold whitespace-nowrap active:scale-95"
			style={dateKind === 'today'
				? 'border-color: transparent; background: var(--color-accent-soft); color: var(--color-accent);'
				: 'border-color: var(--color-border); color: var(--color-ink-muted); background: none;'}
			aria-pressed={dateKind === 'today'}
			onclick={pickToday}
		>
			Today
		</button>
		<button
			type="button"
			class="shrink-0 rounded-full border px-3 py-1.5 text-[0.82rem] font-semibold whitespace-nowrap active:scale-95"
			style={dateKind === 'yesterday'
				? 'border-color: transparent; background: var(--color-accent-soft); color: var(--color-accent);'
				: 'border-color: var(--color-border); color: var(--color-ink-muted); background: none;'}
			aria-pressed={dateKind === 'yesterday'}
			onclick={pickYesterday}
		>
			Yesterday
		</button>

		<div
			class="relative shrink-0"
			onfocusout={(e) => {
				const next = e.relatedTarget as Node | null;
				if (!next || !e.currentTarget.contains(next)) showCustomPicker = false;
			}}
		>
			<button
				type="button"
				class="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[0.82rem] font-semibold whitespace-nowrap active:scale-95"
				style={dateKind === 'custom'
					? 'border-color: transparent; background: var(--color-accent-soft); color: var(--color-accent);'
					: 'border-color: var(--color-border); color: var(--color-ink-muted); background: none;'}
				aria-pressed={dateKind === 'custom'}
				onclick={openCustomPicker}
			>
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.2"
					stroke-linecap="round"
					stroke-linejoin="round"
					><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg
				>
				{customLabel}
				{#if dateKind === 'custom'}
					<span
						role="button"
						tabindex="0"
						aria-label="Clear date"
						class="-mr-0.5 ml-0.5 opacity-60"
						onclick={clearDate}
						onkeydown={(e) => e.key === 'Enter' && clearDate(e as unknown as MouseEvent)}
						>✕</span
					>
				{/if}
			</button>

			{#if showCustomPicker}
				<div
					class="absolute top-full left-0 z-50 mt-2 rounded-[0.9rem] border p-2 shadow-lg"
					style="background: var(--color-surface); border-color: var(--color-border);"
				>
					<input
						bind:this={customField}
						type="date"
						class="rounded-[0.6rem] border px-2.5 py-2 text-[0.85rem] outline-none"
						style="border-color: var(--color-border); background: var(--color-bg); color: var(--color-ink); color-scheme: light dark;"
						onchange={pickCustom}
					/>
				</div>
			{/if}
		</div>

		{#if tags.length > 0}
			<span class="mx-0.5 h-4 w-px shrink-0" style="background: var(--color-border);"></span>

			{#each tags as tag (tag.id)}
				{@const on = active.includes(tag.name)}
				<button
					type="button"
					class="shrink-0 rounded-full border px-3 py-1.5 text-[0.82rem] font-semibold whitespace-nowrap active:scale-95"
					style={on
						? 'border-color: transparent; background: var(--color-accent-soft); color: var(--color-accent);'
						: 'border-color: var(--color-border); color: var(--color-ink-muted); background: none;'}
					aria-pressed={on}
					onclick={() => toggleTag(tag.name)}
				>
					#{tagDisplay(tag.name)}
				</button>
			{/each}
		{/if}
	</div>

	{#if filtering}
		<p class="mt-2 text-[0.78rem] font-semibold" style="color: var(--color-ink-faint);">
			{showing}
			{showing === 1 ? 'thought' : 'thoughts'} of {total}
		</p>
	{/if}
</div>

<style>
	/* The search field opens by having focus forced onto it programmatically,
	   which browsers still paint as a focus-visible outline — a plain
	   rectangle that ignores the pill's rounded corners. Search already shows
	   its own state (border, caret, placeholder gone); it doesn't need a
	   second, uglier one on top. */
	input[type='search']:focus-visible {
		outline: none;
	}
</style>
