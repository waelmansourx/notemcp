<script lang="ts">
	import type { Note } from '$lib/types';
	import { timeOfDay, hostname } from '$lib/dates';
	import { excerpt, extractLeadingImage } from '$lib/markdown';
	import TagChip from './TagChip.svelte';
	import { keepSelection } from '$lib/selection';

	let {
		note,
		href = null,
		onnavigate = null,
		max = 400
	}: {
		note: Note;
		/** Null makes the block inert — used for a thought that hasn't synced,
		 *  and for the one you're already looking at. */
		href?: string | null;
		/** Handle a plain click locally instead of following `href`. Used
		 *  inside a thread you're already reading, so tapping a peer thought
		 *  swaps it in in place rather than loading a whole new page around
		 *  it. `href` is kept regardless — middle-click, cmd-click and "open
		 *  in new tab" still work, and so does a screen reader with no JS. */
		onnavigate?: ((id: string, coords?: { x: number; y: number }) => void) | null;
		max?: number;
	} = $props();

	function onclick(event: MouseEvent) {
		keepSelection(event);
		if (event.defaultPrevented || !onnavigate) return;
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();
		onnavigate(note.id, { x: event.clientX, y: event.clientY });
	}

	let { image: embedded, rest } = $derived(extractLeadingImage(note.content_markdown));
	let image = $derived(note.source_image || embedded);
	let heading = $derived(note.source_title?.trim() || '');
	let body = $derived(excerpt(rest, max));
</script>

<!--
	One thought, drawn the same way every other thought is drawn — and drawn
	as its own card.

	There is deliberately no indent rail, no smaller type and no "reply"
	styling: inside a thread every thought is a peer, and the only thing that
	orders them is the timestamp. The moment a continuation is rendered as a
	comment on the first note, the first note becomes a document you have to
	maintain — which is the exact weight this app exists to avoid.

	The border is what makes a stack of peers actually read as a stack: this
	is the same component the editor uses for the thoughts before/after the
	one you're editing, and that the list uses for a thread expanded in
	place, so the card is what a "thought" looks like everywhere it appears —
	not an editor-only or a list-only affordance.
-->
<svelte:element
	this={href ? 'a' : 'div'}
	href={href ?? undefined}
	role={href ? 'link' : onnavigate ? 'button' : undefined}
	tabindex={onnavigate && !href ? 0 : undefined}
	onkeydown={onnavigate && !href
		? (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onnavigate(note.id);
				}
			}
		: undefined}
	onclick={onclick}
	class="block rounded-[var(--radius-lg)] p-4 {href || onnavigate ? 'active:opacity-65 cursor-pointer' : ''}"
	style="background: var(--color-surface); {href
		? `view-transition-name: note-${note.id};`
		: ''}"
>
	<p class="text-[0.72rem] font-bold tabular-nums" style="color: var(--color-ink-faint);">
		{timeOfDay(note.created_at)}
	</p>

	<div class="mt-1 flex items-start gap-3.5">
		{#if image}
			<img
				src={image}
				alt=""
				loading="lazy"
				class="h-[60px] w-[60px] shrink-0 rounded-[17px] object-cover"
				style="background: var(--color-surface-2);"
			/>
		{/if}
		<div class="min-w-0 flex-1">
			{#if heading}
				<p
					class="line-clamp-2 font-serif text-[1.02rem] leading-[1.32] font-semibold tracking-[-0.015em]"
				>
					{heading}
				</p>
			{/if}
			{#if body}
				<p
					class="font-serif text-[1.06rem] leading-[1.48] tracking-[-0.012em] whitespace-pre-wrap"
					class:mt-1={heading}
					style={heading ? 'color: var(--color-ink-2);' : ''}
				>
					{body}
				</p>
			{:else if !heading}
				<p class="font-serif text-[1.06rem] italic" style="color: var(--color-ink-faint);">
					Untitled
				</p>
			{/if}
		</div>
	</div>

	{#if note.tags.length > 0 || note.source_url}
		<div class="mt-1.5 flex items-center gap-2 text-[0.75rem] font-bold">
			{#each note.tags as tag (tag.id)}
				<TagChip {tag} />
			{/each}
			{#if note.source_url}
				<span class="truncate" style="color: var(--color-ink-faint);"
					>{hostname(note.source_url)}</span
				>
			{/if}
		</div>
	{/if}
</svelte:element>
