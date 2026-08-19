<script lang="ts">
	import type { Tag, ThreadStub } from '$lib/types';
	import { relativeTime } from '$lib/dates';
	import { writeInto } from '$lib/composer.svelte';

	let {
		tag,
		count,
		notes
	}: {
		tag: Tag;
		count: number;
		notes: ThreadStub[];
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

<!--
	A tag as a place rather than a row.

	The list this replaced gave a tag one line and one preview, which told you
	a tag existed but nothing about what was in it. Here the tag keeps its own
	card and its notes keep a constant shape — picture, your words, two facts —
	so the eye scans the left column of thumbnails and never re-learns the
	layout. Recognition is the point: you remember the red YouTube square long
	before you remember what you typed under it.
-->
<section class="mb-3 rounded-[22px] px-3.5 pt-3 pb-2.5" style="background: var(--color-surface-2);">
	<a
		href={`/?tag=${encodeURIComponent(tag.name)}`}
		class="flex items-center gap-2 active:opacity-60"
	>
		<span class="tag tag-lg min-w-0 truncate">#{tag.name}</span>
		<span
			class="shrink-0 text-[0.82rem] font-bold tabular-nums"
			style="color: var(--color-ink-faint);">{count}</span
		>
		<span class="flex-1"></span>
		<span
			class="grid h-6 w-6 shrink-0 place-items-center rounded-full"
			style="background: var(--color-surface); color: var(--color-ink-muted);"
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
											class="truncate rounded-full px-1.5 py-0.5 text-[0.68rem] font-bold"
											style="background: var(--color-surface); color: var(--color-ink-muted);"
											>{note.source}</span
										>
									{/if}
									{#if note.count > 0}
										<span
											class="shrink-0 rounded-full px-1.5 py-0.5 text-[0.68rem] font-bold whitespace-nowrap"
											style="background: var(--color-accent-soft); color: var(--color-accent);"
											>{note.count} more</span
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
							class="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full active:scale-90"
							style="background: var(--color-surface); color: var(--color-ink-muted);"
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
