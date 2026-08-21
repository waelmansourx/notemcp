<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Entry from '$lib/components/Entry.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import StreamNav from '$lib/components/StreamNav.svelte';
	import StreamFilter from '$lib/components/StreamFilter.svelte';
	import DayHeading from '$lib/components/DayHeading.svelte';
	import { groupByDay, streamDate } from '$lib/dates';
	import { withPending } from '$lib/stream.svelte';
	import { applyFilter, filter } from '$lib/filter.svelte';
	import { loadStream, loadAllTags, saveStream, saveAllTags } from '$lib/cache';
	import type { Note } from '$lib/types';
	import type { TagCount } from '$lib/cache';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Date range filter state: [startMs, endMs)
	let dateRange = $state<[number, number] | null>(null);

	/* ---------------- what you're looking at while it loads ----------------

	   The stream's data is streamed rather than awaited (+page.server.ts), so
	   this component renders before it has any. What fills the gap is the last
	   stream that loaded on this device: read once here, rendered immediately,
	   and replaced the moment the server answers.

	   That's the whole of "make it offline-first on read". The notes you had
	   are on screen on the first paint after hydration rather than one
	   Supabase round trip later, which is what navigating between pages — and
	   sitting on the PWA splash screen — was actually waiting for.

	   Read in onMount rather than at init because the server rendered the
	   pending shell: filling the list during hydration would be a mismatch. */
	let cachedNotes = $state<Note[] | null>(null);
	let cachedTags = $state<TagCount[]>([]);
	onMount(() => {
		cachedNotes = loadStream();
		cachedTags = loadAllTags() ?? [];
	});

	// The server's answer, once it lands. Null while in flight — and after a
	// failed query, which is why the cache stays on screen instead of the page
	// claiming you've written nothing.
	let served = $state<{ notes: Note[]; allTags: TagCount[] } | null>(null);
	let failed = $state(false);

	$effect(() => {
		// Re-runs on invalidateAll(), which hands us a fresh promise.
		const stream = data.stream;
		let live = true;

		stream.then((payload) => {
			if (!live) return;
			failed = !payload.ok;
			if (!payload.ok) return;

			served = { notes: payload.notes, allTags: payload.allTags };

			// Off the critical path: writing a few hundred KB of JSON is not
			// worth a frame of the stream appearing.
			if (typeof requestIdleCallback === 'function') {
				requestIdleCallback(() => saveStream(payload.notes));
			} else {
				saveStream(payload.notes);
			}
			saveAllTags(payload.allTags);
		});

		return () => {
			live = false;
		};
	});

	let loaded = $derived(served?.notes ?? cachedNotes ?? []);
	let allTags = $derived(served?.allTags ?? cachedTags);

	// True only in the one case where we genuinely have nothing to show yet and
	// no answer either: a first run on this device. Everywhere else the cache
	// is already standing in, so there's nothing to wait for on screen.
	let awaiting = $derived(!served && !failed && cachedNotes === null);

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
	let filtered = $derived(applyFilter(notes, activeTags, filter.q));
	let visible = $derived.by(() => {
		if (!dateRange) return filtered;
		const [startMs, endMs] = dateRange;
		return filtered.filter((note) => {
			const noteTime = new Date(streamDate(note)).getTime();
			return noteTime >= startMs && noteTime < endMs;
		});
	});
	let groups = $derived(groupByDay(visible));

	// The bar stays up whenever a filter is actually doing something, so
	// arriving on /?tag=blog explains itself instead of just showing you a
	// short stream with no reason given.
	let showFilter = $derived(
		filter.open || activeTags.length > 0 || filter.q.trim().length > 0 || dateRange !== null
	);
	let filtering = $derived(
		activeTags.length > 0 || filter.q.trim().length > 0 || dateRange !== null
	);
</script>

<svelte:head><title>NoteMCP</title></svelte:head>

<!-- One reading column on a phone; a quiet navigation rail beside that same
     measure on desktop. The stream never stretches into long unreadable
     lines just because the window has room, but it also no longer looks like
     the phone layout was dropped in the middle of a monitor. -->
<div
	class="safe-top mx-auto min-h-screen max-w-[72rem] pb-36 lg:grid lg:grid-cols-[13rem_minmax(0,42rem)] lg:justify-center lg:gap-12 lg:px-8"
>
	<StreamNav {subtitle} minimal={showFilter} />

	<main class="min-w-0">
		{#if showFilter}
			<StreamFilter
				tags={allTags}
				total={notes.length}
				showing={visible.length}
				{dateRange}
				onDateRangeChange={(range) => (dateRange = range)}
			/>
		{/if}

		<div class="px-[22px] lg:px-0">
			{#if awaiting}
				<!-- Only ever seen on a first run on this device: after that the
			     cached stream renders in place of this. Deliberately shaped
			     like entries rather than a spinner — a spinner says "wait", a
			     page taking its shape says "nearly there". -->
				<div class="pt-6" aria-hidden="true">
					{#each [0.9, 0.55, 0.75] as width, i (i)}
						<div class="mb-8 animate-pulse" style="animation-delay: {i * 120}ms;">
							<div
								class="mb-3 h-3 w-16 rounded-full"
								style="background: var(--color-border);"
							></div>
							<div
								class="h-4 rounded-full"
								style="width: {width * 100}%; background: var(--color-border);"
							></div>
						</div>
					{/each}
				</div>
			{:else if groups.length === 0}
				<p
					class="pt-24 text-center text-[1.05rem] leading-[1.5] font-medium tracking-[-0.015em]"
					style="color: var(--color-ink-muted);"
				>
					{#if filtering}
						Nothing here matches. Try fewer words, or a different tag.
					{:else if failed}
						Couldn't reach your notes, and there's no copy on this device yet. They're safe — try
						again when you have a connection.
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
	</main>
</div>

<Composer />
