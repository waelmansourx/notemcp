<script lang="ts">
	import type { Tag, ThreadStub } from '$lib/types';
	import { relativeTime } from '$lib/dates';
	import { writeInto } from '$lib/composer.svelte';
	import { tagDisplay } from '$lib/tags';

	let {
		tag,
		count,
		notes,
		label = tagDisplay(tag.name)
	}: {
		tag: Tag;
		count: number;
		notes: ThreadStub[];
		/** Overrides the header text — used for a card nested under its parent,
		 *  where the levels above are the cards directly overhead and this one
		 *  only needs its own ("bug", not "notemcp/bug" again). */
		label?: string;
	} = $props();

	/** Three to a page. The next page peeks past the right edge, which is the
	 *  only thing that has to say "there's more" — no "See all" button, no
	 *  count to read, just a card that is visibly cut off. */
	let pages = $derived.by(() => {
		const out: ThreadStub[][] = [];
		for (let i = 0; i < notes.length; i += 3) out.push(notes.slice(i, i + 3));
		return out;
	});
</script>

<!-- A tag remains a useful place with several recognizable previews, but a
     divider does enough to separate it from the next one. Wrapping every tag
     in its own filled card made the page read like nested containers. -->
<section class="border-b py-4" style="border-color: var(--color-border);">
	<a
		href={`/?tag=${encodeURIComponent(tag.name)}`}
		class="flex items-center gap-2 active:opacity-60"
	>
		<span class="tag tag-lg min-w-0 truncate">#{label}</span>
		<span
			class="shrink-0 text-[0.82rem] font-bold tabular-nums"
			style="color: var(--color-ink-faint);">{count}</span
		>
		<span class="flex-1"></span>
		<span
			class="grid h-6 w-6 shrink-0 place-items-center"
			style="color: var(--color-ink-muted);"
			aria-hidden="true"
		>
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="m9 5 7 7-7 7" /></svg
			>
		</span>
	</a>

	<div
		class="mt-1.5 flex snap-x snap-mandatory gap-3 overflow-x-auto"
		style="scrollbar-width: none;"
	>
		{#each pages as pageNotes, i (i)}
			<div class="shrink-0 snap-start" style="width: {pages.length > 1 ? '89%' : '100%'};">
				{#each pageNotes as note (note.id)}
					<div class="flex items-center gap-3 py-1.5">
						<a
							href={`/note/${note.id}`}
							class="flex min-w-0 flex-1 items-center gap-3 active:opacity-60"
						>
							{#if note.image}
								<img
									src={note.image}
									alt=""
									loading="lazy"
									class="h-[52px] w-[52px] shrink-0 rounded-[15px] object-cover"
									style="background: var(--color-surface);"
								/>
							{:else}
								<span
									class="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[15px] font-serif text-[1.15rem] font-semibold"
									style="background: var(--color-surface); color: var(--color-accent);"
									aria-hidden="true">{note.label.slice(0, 1).toUpperCase()}</span
								>
							{/if}

							<span class="min-w-0 flex-1">
								<span
									class="line-clamp-2 text-[0.88rem] leading-[1.28] font-semibold tracking-[-0.015em]"
									>{note.label}</span
								>
								<!-- Two facts, never more. The App Store row can carry a
								     rating, a size and a price because you're comparing
								     things; you're not comparing your own notes. -->
								<span class="mt-1 flex items-center gap-1.5">
									{#if note.source}
										<span
											class="truncate text-[0.68rem] font-bold"
											style="color: var(--color-ink-muted);">{note.source}</span
										>
									{/if}
									{#if note.count > 0}
										<span
											class="shrink-0 text-[0.68rem] font-bold whitespace-nowrap"
											style="color: var(--color-accent);">{note.count} more</span
										>
									{:else}
										<span
											class="shrink-0 text-[0.68rem] font-bold"
											style="color: var(--color-ink-faint);">{relativeTime(note.at)}</span
										>
									{/if}
								</span>
							</span>
						</a>

						<!-- Where the App Store puts "View", because that's where your
						     thumb already is. Different verb: this one writes. -->
						<button
							type="button"
							aria-label={`Add a thought to "${note.label}"`}
							class="grid h-[30px] w-[30px] shrink-0 place-items-center active:scale-90"
							style="color: var(--color-accent);"
							onclick={() => writeInto(note)}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="3"
								stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg
							>
						</button>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</section>
