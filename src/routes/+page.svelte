<script lang="ts">
	import { page } from '$app/state';
	import Entry from '$lib/components/Entry.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import StreamNav from '$lib/components/StreamNav.svelte';
	import StreamFilter from '$lib/components/StreamFilter.svelte';
	import DayHeading from '$lib/components/DayHeading.svelte';
	import { groupByDay, streamDate } from '$lib/dates';
	import { withPending } from '$lib/stream.svelte';
	import { applyFilter, filter } from '$lib/filter.svelte';
	import { loadStream, saveStream } from '$lib/cache.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The last stream that loaded, kept on this device. Only consulted when the
	// server couldn't answer — an empty list then means "the request failed",
	// not "you've written nothing", and showing nothing would be a lie.
	let fallback = $state<typeof data.notes | null>(null);
	$effect(() => {
		if (data.ok) {
			const fresh = data.notes;
			fallback = null;
			// Off the critical path: writing a few hundred KB of JSON is not
			// worth a frame of the stream appearing.
			const write =
				typeof requestIdleCallback === 'function'
					? requestIdleCallback(() => saveStream(fresh))
					: null;
			return () => {
				if (write !== null) cancelIdleCallback(write);
			};
		}
		fallback = loadStream();
	});

	let loaded = $derived(data.ok || !fallback ? data.notes : fallback);

	// Anything captured but not yet acknowledged by the server is folded in
	// here, so a new thought is on screen the moment it's written.
	let notes = $derived(withPending(loaded));

	// A line of context under the masthead. Both numbers come from the stream
	// that's already on screen, so there's no second query behind them — and
	// they're deliberately recent-window counts rather than a lifetime total,
	// which the loaded stream can't honestly claim to know.
	let recent = $derived.by(() => {
		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
		const weekAgo = startOfToday - 6 * 86_400_000;
		let today = 0;
		let week = 0;
		for (const note of notes) {
			const at = new Date(streamDate(note)).getTime();
			if (at >= startOfToday) today++;
			if (at >= weekAgo) week++;
		}
		return { today, week };
	});

	let subtitle = $derived(
		notes.length === 0
			? ''
			: recent.today > 0
				? `${recent.today} today · ${recent.week} this week`
				: recent.week > 0
					? `${recent.week} this week`
					: 'Nothing new this week'
	);

	let activeTags = $derived(page.url.searchParams.getAll('tag'));
	let visible = $derived(applyFilter(notes, activeTags, filter.q));
	let groups = $derived(groupByDay(visible));

	// The bar stays up whenever a filter is actually doing something, so
	// arriving on /?tag=blog explains itself instead of just showing you a
	// short stream with no reason given.
	let showFilter = $derived(filter.open || activeTags.length > 0 || filter.q.trim().length > 0);
	let filtering = $derived(activeTags.length > 0 || filter.q.trim().length > 0);
</script>

<svelte:head><title>NoteMCP</title></svelte:head>

<div class="safe-top mx-auto min-h-screen max-w-2xl pb-36">
	<StreamNav {subtitle} />

	{#if showFilter}
		<StreamFilter tags={data.allTags} total={notes.length} showing={visible.length} />
	{/if}

	<div class="px-[22px]">
		{#if groups.length === 0}
			<p
				class="pt-24 text-center text-[1.05rem] leading-[1.5] font-medium tracking-[-0.015em]"
				style="color: var(--color-ink-muted);"
			>
				{#if filtering}
					Nothing here matches. Try fewer words, or a different tag.
				{:else}
					Nothing yet. Write something — you can sort it out later.
				{/if}
			</p>
		{:else}
			{#each groups as group (group.key)}
				<DayHeading label={group.label} />
				{#each group.notes as note (note.id)}
					<Entry {note} showTime />
				{/each}
			{/each}
		{/if}
	</div>
</div>

<Composer recentTags={data.recentTags} />
