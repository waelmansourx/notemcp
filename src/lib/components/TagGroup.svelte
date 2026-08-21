<script lang="ts">
	import type { Tag, ThreadStub } from '$lib/types';
	import { relativeTime } from '$lib/dates';
	import { tagDisplay } from '$lib/tags';

	let {
		tag,
		count,
		notes: initialNotes,
		label = tagDisplay(tag.name)
	}: {
		tag: Tag;
		count: number;
		notes: ThreadStub[];
		label?: string;
	} = $props();

	let notes = $state<ThreadStub[]>(initialNotes);
	let loadingMore = $state(false);
	let exhausted = $state(initialNotes.length >= count);

	let visual = $derived(notes.some((note) => Boolean(note.image)));
	let pages = $derived.by(() => {
		const out: ThreadStub[][] = [];
		for (let i = 0; i < notes.length; i += 3) out.push(notes.slice(i, i + 3));
		return out;
	});

	async function loadMore() {
		if (loadingMore || exhausted) return;
		loadingMore = true;
		try {
			const params = new URLSearchParams({
				name: tag.name,
				offset: String(notes.length),
				limit: '9'
			});
			const response = await fetch(`/api/tags?${params}`);
			if (!response.ok) return;
			const payload: { notes: ThreadStub[]; hasMore: boolean } = await response.json();
			const seen = new Set(notes.map((note) => note.id));
			const incoming = payload.notes.filter((note) => !seen.has(note.id));
			notes = [...notes, ...incoming];
			exhausted = !payload.hasMore || incoming.length === 0;
		} finally {
			loadingMore = false;
		}
	}

	function onShelfScroll(event: Event) {
		const el = event.currentTarget as HTMLElement;
		if (el.scrollWidth - el.scrollLeft - el.clientWidth < 220) loadMore();
	}
</script>

<section class="min-w-0 border-b py-3.5" style="border-color: var(--color-border);">
	<div class="flex min-w-0 items-baseline gap-2.5">
		<a href={`/tags/${encodeURIComponent(tag.name)}`} class="min-w-0 active:opacity-60">
			<span class="tag tag-lg block truncate"><span style="color: #c8c0b0; font-weight: 400;">#</span>{label}</span>
		</a>
		<span class="flex-1"></span>
		{#if count > 3}
			<a
				href={`/tags/${encodeURIComponent(tag.name)}`}
				class="shrink-0 text-[0.72rem] active:opacity-60"
				style="color: var(--color-ink-faint);"
			>
				See all
			</a>
		{/if}
	</div>

	{#if visual}
		<div class="shelf-scroll mt-3 flex max-w-full gap-3 overflow-x-auto pb-1" onscroll={onShelfScroll}>
			{#each notes as note (note.id)}
				<a href={`/note/${note.id}`} class="w-[152px] max-w-[44vw] shrink-0 active:opacity-65">
					<div
						class="aspect-[19/12] w-full overflow-hidden rounded-[12px]"
						style="background: var(--color-surface-2);"
					>
						{#if note.image}
							<img
								src={note.image}
								alt=""
								loading="lazy"
								class="h-full w-full object-contain object-center"
							/>
						{:else}
							<div
								class="grid h-full w-full place-items-center font-serif text-[1.4rem]"
								style="color: var(--color-ink-faint);"
							>
								{note.label.slice(0, 1).toUpperCase()}
							</div>
						{/if}
					</div>
					<p class="mt-2 line-clamp-2 text-[0.78rem] leading-[1.35] font-medium">{note.label}</p>
					<p class="mt-1 truncate text-[0.66rem]" style="color: var(--color-ink-faint);">
						{note.source ? `${note.source} · ` : ''}{relativeTime(note.at)}
					</p>
				</a>
			{/each}
			{#if loadingMore}
				<div class="w-8 shrink-0" aria-label="Loading more notes"></div>
			{/if}
		</div>
	{:else}
		<div class="shelf-scroll mt-2.5 flex max-w-full gap-5 overflow-x-auto pb-1" onscroll={onShelfScroll}>
			{#each pages as pageNotes, i (i)}
				<div class="w-[min(316px,88vw)] shrink-0">
					{#each pageNotes as note, j (note.id)}
						<a href={`/note/${note.id}`} class="block py-2 active:opacity-60">
							<p class="line-clamp-2 text-[0.82rem] leading-[1.4]">{note.label}</p>
							<p class="mt-1 text-[0.66rem]" style="color: var(--color-ink-faint);">{relativeTime(note.at)}</p>
						</a>
						{#if j < pageNotes.length - 1}
							<div class="h-px" style="background: var(--color-border);"></div>
						{/if}
					{/each}
				</div>
			{/each}
			{#if loadingMore}
				<div class="w-8 shrink-0" aria-label="Loading more notes"></div>
			{/if}
		</div>
	{/if}
</section>
