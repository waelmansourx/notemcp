<script lang="ts">
	import type { Note } from '$lib/types';
	import { timeOfDay, hostname, streamDate } from '$lib/dates';
	import { firstLine, snippet, excerpt, extractLeadingImage } from '$lib/markdown';
	import { isPending } from '$lib/stream.svelte';
	import TagChip from './TagChip.svelte';

	let { note, showTime = false }: { note: Note; showTime?: boolean } = $props();

	// A shared link reads as a headline + your own caption. A typed thought is
	// just the text — no title field, because being asked to name an idea is
	// the thing that stops you writing it down.
	let isLink = $derived(Boolean(note.source_url));
	let { image: embeddedImage, rest: textOnly } = $derived(
		extractLeadingImage(note.content_markdown)
	);
	let hasEmbeddedImage = $derived(!isLink && Boolean(embeddedImage));
	let heading = $derived(note.source_title?.trim() || note.title.trim() || '');
	let caption = $derived(snippet(note.content_markdown));
	let body = $derived(excerpt(textOnly) || firstLine(note.title) || 'Untitled');
	let hasMeta = $derived(note.tags.length > 0 || isLink || showTime);

	// A note that's still syncing has no server id behind it, so it reads as
	// part of the stream but isn't something you can open yet.
	let queued = $derived(isPending(note));
</script>

<a
	href={queued ? undefined : `/note/${note.id}`}
	class="entry block py-[15px] active:opacity-65"
	style={queued ? 'opacity: 0.5;' : ''}
	aria-busy={queued || undefined}
>
	{#if isLink}
		<div class="flex items-start gap-3.5">
			<div class="min-w-0 flex-1">
				{#if heading}
					<h3 class="line-clamp-2 text-[0.97rem] leading-[1.34] font-semibold tracking-[-0.019em]">
						{heading}
					</h3>
				{/if}
				{#if caption}
					<p
						class="mt-[5px] line-clamp-2 text-[0.905rem] leading-[1.4] tracking-[-0.012em]"
						style="color: var(--color-ink-2);"
					>
						{caption}
					</p>
				{/if}
			</div>
			{#if note.source_image}
				<img
					src={note.source_image}
					alt=""
					loading="lazy"
					class="h-14 w-14 shrink-0 rounded-[var(--radius-lg)] object-cover"
					style="background: var(--color-surface-2);"
				/>
			{/if}
		</div>
	{:else if hasEmbeddedImage}
		<div class="flex items-start gap-3.5">
			<img
				src={embeddedImage}
				alt=""
				loading="lazy"
				class="h-14 w-14 shrink-0 rounded-[var(--radius-lg)] object-cover"
				style="background: var(--color-surface-2);"
			/>
			{#if textOnly.trim()}
				<p
					class="line-clamp-3 min-w-0 flex-1 text-[1rem] leading-[1.44] tracking-[-0.016em] whitespace-pre-wrap"
				>
					{excerpt(textOnly, 200)}
				</p>
			{/if}
		</div>
	{:else}
		<!-- Clamped: a note is as long as it needs to be, but a *list* of notes
		     is only useful if you can see more than one of them at a time. -->
		<p class="line-clamp-6 text-[1rem] leading-[1.44] tracking-[-0.016em] whitespace-pre-wrap">
			{body}
		</p>
	{/if}

	{#if hasMeta}
		<div
			class="mt-[9px] flex items-center gap-1.5 text-[0.75rem]"
			style="color: var(--color-ink-faint);"
		>
			{#each note.tags as tag (tag.id)}
				<TagChip {tag} />
			{/each}
			<span class="flex-1"></span>
			{#if isLink && note.source_url}
				<span class="truncate" style="color: var(--color-ink-muted);"
					>{hostname(note.source_url)}</span
				>
			{/if}
			{#if showTime}
				{#if isLink}<span aria-hidden="true">·</span>{/if}
				<span class="whitespace-nowrap">{timeOfDay(streamDate(note))}</span>
			{/if}
		</div>
	{/if}
</a>
