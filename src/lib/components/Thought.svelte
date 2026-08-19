<script lang="ts">
	import type { Note } from '$lib/types';
	import { timeOfDay, hostname } from '$lib/dates';
	import { excerpt, extractLeadingImage } from '$lib/markdown';
	import TagChip from './TagChip.svelte';

	let {
		note,
		href = null,
		max = 400
	}: {
		note: Note;
		/** Null makes the block inert — used for a thought that hasn't synced,
		 *  and for the one you're already looking at. */
		href?: string | null;
		max?: number;
	} = $props();

	let { image: embedded, rest } = $derived(extractLeadingImage(note.content_markdown));
	let image = $derived(note.source_image || embedded);
	let heading = $derived(note.source_title?.trim() || '');
	let body = $derived(excerpt(rest, max));
</script>

<!--
	One thought, drawn the same way every other thought is drawn.

	There is deliberately no indent rail, no smaller type and no "reply"
	styling: inside a group every note is a peer, and the only thing that orders
	them is the timestamp. The moment one of them is rendered as a comment on
	another, that other one becomes a document you have to maintain — which is
	the exact weight this app exists to avoid.
-->
<svelte:element
	this={href ? 'a' : 'div'}
	href={href ?? undefined}
	class="block {href ? 'active:opacity-65' : ''}"
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
