<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { filter, closeFilter } from '$lib/filter.svelte';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import type { Tag } from '$lib/types';

	let {
		tags = [],
		total = 0,
		showing = 0
	}: { tags?: (Tag & { count: number })[]; total?: number; showing?: number } = $props();

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

	function toggle(name: string) {
		setTags(active.includes(name) ? active.filter((t) => t !== name) : [...active, name]);
	}

	function clearAll() {
		filter.q = '';
		if (active.length > 0) setTags([]);
		closeFilter();
	}

	let filtering = $derived(active.length > 0 || filter.q.trim().length > 0);
</script>

<div
	class="sticky top-0 z-20 px-[22px] pt-1 pb-2.5"
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

	{#if tags.length > 0}
		<div class="mt-2 flex items-center gap-3 overflow-x-auto pb-0.5" style="scrollbar-width: none;">
			{#each tags as tag (tag.id)}
				{@const on = active.includes(tag.name)}
				<button
					type="button"
					class="shrink-0 py-1 text-[0.88rem] font-bold whitespace-nowrap active:scale-95"
					style={on
						? 'color: var(--color-accent); text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 2px;'
						: 'color: var(--color-ink-faint);'}
					aria-pressed={on}
					onclick={() => toggle(tag.name)}
				>
					#{tag.name}
				</button>
			{/each}
		</div>
	{/if}

	{#if filtering}
		<p class="mt-2 text-[0.78rem] font-semibold" style="color: var(--color-ink-faint);">
			{showing}
			{showing === 1 ? 'thought' : 'thoughts'} of {total}
		</p>
	{/if}
</div>
